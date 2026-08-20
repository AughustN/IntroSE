import type { Db } from '../../db/pool.js';
import { pool } from '../../db/pool.js';

export type AuthEventType =
  | 'login_success'
  | 'login_failure'
  | 'logout'
  | 'logout_all'
  | 'password_changed'
  | 'password_reset_requested'
  | 'password_reset_completed'
  | 'session_reuse_detected'
  | 'organizer_applied';

export interface AuthEventInput {
  event: AuthEventType;
  userId?: number | null;
  identifierHash?: string | null;
  sourceIp?: string | null;
  userAgent?: string | null;
}

/** Append an immutable auth event (FR-041/054/055/056). Never throws into the
 *  request path — logging must not break a sign-in. */
export async function recordAuthEvent(e: AuthEventInput, db: Db = pool): Promise<void> {
  try {
    await db.query(
      `INSERT INTO auth_events (user_id, identifier_hash, event, source_ip, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [e.userId ?? null, e.identifierHash ?? null, e.event, e.sourceIp ?? null, e.userAgent ?? null],
    );
  } catch {
    // swallow — an auth event failure must not fail the operation it records
  }
}

/** Count recent consecutive login failures for one identifier hash — drives the warning & lockout. */
/**
 * Failed sign-ins for one identifier since its last success, optionally narrowed to one source.
 *
 * `sourceIp` is not an optimisation — it is what keeps the count from becoming a weapon. Counted
 * across every source, the number says "this account has been attacked", and anything built on it
 * punishes the account: three failures from a stranger in another country put a CAPTCHA in front of
 * the owner at home, ten locked them out for fifteen minutes. Knowing somebody's email was enough
 * to keep them out of the platform, renewably, from anywhere — the account-denial that US7's
 * SC-009 and SC-013 were written to rule out.
 *
 * Narrowed to a source, the same number says "this source is guessing", which is the thing the
 * defences actually want to act on, and the owner arriving from their own address counts zero.
 * `idx_auth_events_source` is a partial index on exactly `(source_ip, created_at DESC)` for
 * `login_failure` — this reading was the one the schema was built for.
 */
export async function recentIdentifierFailures(
  identifierHash: string,
  windowMs: number,
  sourceIp?: string,
  db: Db = pool,
): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM auth_events
      WHERE identifier_hash = $1 AND event = 'login_failure'
        AND ($3::text IS NULL OR source_ip = $3::inet)
        AND created_at > now() - ($2::int * interval '1 millisecond')
        AND created_at > COALESCE((
          SELECT max(created_at) FROM auth_events
           WHERE identifier_hash = $1 AND event = 'login_success'
        ), '1970-01-01'::timestamptz)`,
    [identifierHash, windowMs, sourceIp ?? null],
  );
  return Number(rows[0]?.count ?? 0);
}
