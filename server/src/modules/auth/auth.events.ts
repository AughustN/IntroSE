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

/** Count recent login failures for one identifier hash — drives the progressive delay (R-5). */
export async function recentIdentifierFailures(identifierHash: string, windowMs: number, db: Db = pool): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM auth_events
      WHERE identifier_hash = $1 AND event = 'login_failure'
        AND created_at > now() - ($2::int * interval '1 millisecond')`,
    [identifierHash, windowMs],
  );
  return Number(rows[0]?.count ?? 0);
}
