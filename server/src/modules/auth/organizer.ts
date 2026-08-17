import type { Db } from '../../db/pool.js';
import { pool } from '../../db/pool.js';

export type OrganizerStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export interface OrganizerApplication {
  id: number;
  status: OrganizerStatus;
  display_name: string;
  description: string | null;
  review_note: string | null;
  applied_at: string;
}

/** The at-most-one LIVE application (pending/approved/suspended), or null. */
export async function getLiveApplication(userId: number, db: Db = pool): Promise<{ id: number; status: OrganizerStatus } | null> {
  const { rows } = await db.query<{ id: number; status: OrganizerStatus }>(
    `SELECT id, status FROM organizers
      WHERE user_id = $1 AND status IN ('pending', 'approved', 'suspended')
      LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function createApplication(
  userId: number,
  input: { displayName: string; description: string; logoUrl: string | null },
  db: Db = pool,
): Promise<{ id: number }> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO organizers (user_id, display_name, description, logo_url, status)
     VALUES ($1, $2, $3, $4, 'pending')
     RETURNING id`,
    [userId, input.displayName, input.description, input.logoUrl],
  );
  return rows[0];
}

/** Full application history for an account, newest first (FR-060). */
export async function listApplications(userId: number, db: Db = pool): Promise<OrganizerApplication[]> {
  const { rows } = await db.query<OrganizerApplication>(
    `SELECT id, status, display_name, description, review_note, applied_at
       FROM organizers WHERE user_id = $1 ORDER BY applied_at DESC`,
    [userId],
  );
  return rows;
}
