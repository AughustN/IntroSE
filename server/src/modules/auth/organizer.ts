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

export interface OrganizerAppeal {
  id: number;
  organizer_id: number;
  user_id: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  review_note: string | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  created_at: string;
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

export async function createAppeal(
  organizerId: number,
  userId: number,
  reason: string,
  db: Db = pool,
): Promise<OrganizerAppeal> {
  const { rows } = await db.query<OrganizerAppeal>(
    `INSERT INTO organizer_appeals (organizer_id, user_id, reason, status)
     VALUES ($1, $2, $3, 'pending')
     RETURNING id, organizer_id, user_id, reason, status, review_note, reviewed_by, reviewed_at, created_at`,
    [organizerId, userId, reason],
  );
  return rows[0];
}

export async function getLatestAppeal(organizerId: number, db: Db = pool): Promise<OrganizerAppeal | null> {
  const { rows } = await db.query<OrganizerAppeal>(
    `SELECT id, organizer_id, user_id, reason, status, review_note, reviewed_by, reviewed_at, created_at
       FROM organizer_appeals
      WHERE organizer_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [organizerId],
  );
  return rows[0] ?? null;
}

export async function listAppeals(organizerId: number, db: Db = pool): Promise<OrganizerAppeal[]> {
  const { rows } = await db.query<OrganizerAppeal>(
    `SELECT id, organizer_id, user_id, reason, status, review_note, reviewed_by, reviewed_at, created_at
       FROM organizer_appeals
      WHERE organizer_id = $1
      ORDER BY created_at DESC`,
    [organizerId],
  );
  return rows;
}
