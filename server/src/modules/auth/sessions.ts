import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type pg from 'pg';
import type { Me } from '@shared/auth/types.js';
import {
  ACCESS_TOKEN_TTL_SEC,
  JWT_AUD,
  JWT_ISS,
  REFRESH_ABSOLUTE_MS,
  REFRESH_GRACE_MS,
  REFRESH_TTL_MS,
  config,
} from '../../config.js';
import { pool, withTransaction } from '../../db/pool.js';
import type { Db } from '../../db/pool.js';
import { hashToken, randomToken } from './crypto.js';
import { recordAuthEvent } from './auth.events.js';
import { findById, isApprovedOrganizer, toMe } from './auth.repo.js';

export type RevokeReason =
  | 'rotated'
  | 'logout'
  | 'logout_all'
  | 'reuse_detected'
  | 'password_changed'
  | 'password_reset'
  | 'account_suspended';

export interface SessionResult {
  accessToken: string;
  refreshToken: string; // raw, goes into the httpOnly cookie
  user: Me;
}

export class SessionError extends Error {
  constructor(
    public code: 'invalid_session' | 'session_expired' | 'session_revoked',
    public status: number,
  ) {
    super(code);
  }
}

// ---- Access token (identity only, Q7) ----

export function signAccessToken(userId: number, familyId: string): string {
  return jwt.sign({ fam: familyId }, config.jwtSecret, {
    subject: String(userId),
    expiresIn: ACCESS_TOKEN_TTL_SEC,
    issuer: JWT_ISS,
    audience: JWT_AUD,
  });
}

export function verifyAccessToken(token: string): { userId: number; familyId: string } {
  const payload = jwt.verify(token, config.jwtSecret, { issuer: JWT_ISS, audience: JWT_AUD }) as jwt.JwtPayload;
  return { userId: Number(payload.sub), familyId: String(payload.fam) };
}

// ---- Issue a brand-new session (a new family = a new login/device) ----

export async function issueSession(
  client: pg.PoolClient,
  userId: number,
  ctx: { userAgent?: string | null; sourceIp?: string | null },
): Promise<{ accessToken: string; refreshToken: string; familyId: string }> {
  const familyId = randomUUID();
  const token = randomToken();
  await client.query(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, user_agent, source_ip)
     VALUES ($1, $2, $3, now() + ($4::int * interval '1 millisecond'), $5, $6)`,
    [userId, familyId, hashToken(token), REFRESH_TTL_MS, ctx.userAgent ?? null, ctx.sourceIp ?? null],
  );
  return { accessToken: signAccessToken(userId, familyId), refreshToken: token, familyId };
}

// ---- Rotation with idempotency-keyed grace + family-scoped reuse kill (R-12) ----

const inflight = new Map<string, Promise<SessionResult>>();
const graceCache = new Map<string, { result: SessionResult; expires: number }>();

async function buildMe(userId: number, db: Db): Promise<Me> {
  const user = await findById(userId, db);
  if (!user) throw new SessionError('invalid_session', 401);
  return toMe(user, await isApprovedOrganizer(userId, db));
}

export async function rotateSession(
  rawToken: string,
  ctx: { idempotencyKey?: string | null; userAgent?: string | null; sourceIp?: string | null },
): Promise<SessionResult> {
  const key = ctx.idempotencyKey;
  if (key) {
    const cached = graceCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.result;
    const flying = inflight.get(key);
    if (flying) return flying; // server-side single-flight: same-key concurrency awaits one rotation
    const p = doRotate(rawToken, ctx).finally(() => inflight.delete(key));
    inflight.set(key, p);
    const result = await p;
    graceCache.set(key, { result, expires: Date.now() + REFRESH_GRACE_MS });
    return result;
  }
  return doRotate(rawToken, ctx);
}

type RotateOutcome =
  | { kind: 'ok'; result: SessionResult }
  | { kind: 'reuse' }
  | { kind: 'expired' }
  | { kind: 'invalid' };

async function doRotate(
  rawToken: string,
  ctx: { userAgent?: string | null; sourceIp?: string | null },
): Promise<SessionResult> {
  const tokenHash = hashToken(rawToken);
  // Do all DB work inside the transaction and return an outcome; only throw AFTER
  // it commits, so a reuse family-kill is persisted rather than rolled back.
  const outcome: RotateOutcome = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, user_id, family_id, family_started_at, revoked_at, revoked_reason, expires_at
         FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row) return { kind: 'invalid' };

    if (new Date(row.expires_at).getTime() < Date.now()) return { kind: 'expired' };
    if (new Date(row.family_started_at).getTime() + REFRESH_ABSOLUTE_MS < Date.now()) return { kind: 'expired' };

    if (row.revoked_at) {
      // Superseded-by-rotation token re-presented outside the grace cache → a copy is
      // loose → kill the family (FR-019, family-scoped). Committed with this transaction.
      if (row.revoked_reason === 'rotated') {
        await client.query(
          `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = 'reuse_detected'
             WHERE family_id = $1 AND revoked_at IS NULL`,
          [row.family_id],
        );
        await recordAuthEvent(
          { event: 'session_reuse_detected', userId: row.user_id, sourceIp: ctx.sourceIp ?? null },
          client,
        );
        return { kind: 'reuse' };
      }
      // logout / logout_all / password_* / account_suspended → session simply ended.
      return { kind: 'invalid' };
    }

    // Live token → rotate: issue one child in the same family, revoke this one 'rotated'.
    const childToken = randomToken();
    await client.query(
      `INSERT INTO refresh_tokens (user_id, family_id, family_started_at, token_hash, parent_id, expires_at, user_agent, source_ip)
       VALUES ($1, $2, $3, $4, $5, now() + ($6::int * interval '1 millisecond'), $7, $8)`,
      [
        row.user_id,
        row.family_id,
        row.family_started_at,
        hashToken(childToken),
        row.id,
        REFRESH_TTL_MS,
        ctx.userAgent ?? null,
        ctx.sourceIp ?? null,
      ],
    );
    await client.query(`UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = 'rotated' WHERE id = $1`, [
      row.id,
    ]);

    return {
      kind: 'ok',
      result: {
        accessToken: signAccessToken(row.user_id, row.family_id),
        refreshToken: childToken,
        user: await buildMe(row.user_id, client),
      },
    };
  });

  switch (outcome.kind) {
    case 'ok':
      return outcome.result;
    case 'reuse':
      throw new SessionError('session_revoked', 401);
    case 'expired':
      throw new SessionError('session_expired', 401);
    default:
      throw new SessionError('invalid_session', 401);
  }
}

// ---- Revocation (immediate, source of truth in the DB — ADR 0001) ----

/** True while the session's family still has a live token (used by requireAuth). */
export async function familyHasLiveToken(familyId: string, db: Db = pool): Promise<boolean> {
  const { rows } = await db.query(`SELECT 1 FROM refresh_tokens WHERE family_id = $1 AND revoked_at IS NULL LIMIT 1`, [
    familyId,
  ]);
  return rows.length > 0;
}

/** End one session (this device). */
export async function revokeFamily(familyId: string, reason: RevokeReason, db: Db = pool): Promise<void> {
  await db.query(
    `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = $2 WHERE family_id = $1 AND revoked_at IS NULL`,
    [familyId, reason],
  );
}

/** End every session for an account (logout-all, password change/reset, suspend). */
export async function revokeAllForUser(userId: number, reason: RevokeReason, db: Db = pool): Promise<void> {
  await db.query(
    `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, reason],
  );
}

/** End every session EXCEPT the caller's family (password change keeps current — FR-057). */
export async function revokeAllExceptFamily(
  userId: number,
  keepFamilyId: string,
  reason: RevokeReason,
  db: Db = pool,
): Promise<void> {
  await db.query(
    `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = $3
       WHERE user_id = $1 AND family_id <> $2 AND revoked_at IS NULL`,
    [userId, keepFamilyId, reason],
  );
}
