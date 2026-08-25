import type { Db } from '../../db/pool.js';
import { pool } from '../../db/pool.js';

export async function organizerQueue(db: Db = pool) {
  return (await db.query(`SELECT id, user_id AS "userId", display_name AS "displayName", description, status, review_note AS "reviewNote", applied_at AS "appliedAt" FROM organizers WHERE status IN ('pending', 'approved', 'suspended') ORDER BY applied_at`)).rows;
}

export async function eventQueue(db: Db = pool) {
  return (await db.query(`SELECT e.id, e.slug, e.title, e.status, e.moderation_status AS moderation, o.display_name AS organizer, e.review_note AS "reviewNote", e.created_at AS "createdAt" FROM events e JOIN organizers o ON o.id = e.organizer_id WHERE e.moderation_status IN ('pending_review', 'flagged', 'removed') ORDER BY e.created_at`)).rows;
}

export async function reportQueue(db: Db = pool) {
  return (await db.query(`SELECT id, target_type AS "targetType", target_id AS "targetId", reason, status, created_at AS "createdAt" FROM content_reports WHERE status = 'open' ORDER BY created_at`)).rows;
}

export async function lockOrganizer(id: number, db: Db) {
  const { rows } = await db.query(`SELECT * FROM organizers WHERE id = $1 FOR UPDATE`, [id]);
  return rows[0] ?? null;
}

export async function lockEvent(id: number, db: Db) {
  const { rows } = await db.query(`SELECT e.*, o.status AS organizer_status, o.user_id AS organizer_user_id FROM events e JOIN organizers o ON o.id = e.organizer_id WHERE e.id = $1 FOR UPDATE`, [id]);
  return rows[0] ?? null;
}

export async function updateOrganizer(id: number, status: string, reason: string | null, actorId: number, db: Db) {
  const { rows } = await db.query(`UPDATE organizers SET status = $2, review_note = $3, approved_at = CASE WHEN $2 = 'approved' THEN now() ELSE approved_at END, approved_by = CASE WHEN $2 = 'approved' THEN $4 ELSE approved_by END WHERE id = $1 RETURNING id, user_id AS "userId", status, review_note AS "reviewNote"`, [id, status, reason, actorId]);
  return rows[0];
}

export async function updateEvent(id: number, status: string, reason: string | null, db: Db) {
  const { rows } = await db.query(`UPDATE events SET moderation_status = $2, review_note = $3, updated_at = now() WHERE id = $1 RETURNING id, moderation_status AS moderation, review_note AS "reviewNote"`, [id, status, reason]);
  return rows[0];
}

/** Durable notification intent, committed with the moderation transaction (FR-004/FR-024).
 *  Delivery itself is out of scope — this row IS the intent (moderation_action_id stays null
 *  until the idempotency-keyed command path of T011/T018 lands). */
export async function insertNotification(db: Db, n: { recipientUserId: number; kind: string; targetType: string; targetId: number; payload: Record<string, unknown> }) {
  await db.query(`INSERT INTO moderation_notifications (recipient_user_id, kind, target_type, target_id, payload) VALUES ($1, $2, $3, $4, $5::jsonb)`, [n.recipientUserId, n.kind, n.targetType, n.targetId, JSON.stringify(n.payload)]);
}

export async function resolveReport(id: number, status: string, reason: string | null, adminId: number, db: Db) {
  const { rows } = await db.query(`UPDATE content_reports SET status = $2, resolution_note = $3, resolved_by = $4, resolved_at = now() WHERE id = $1 AND status = 'open' RETURNING id, target_type, target_id`, [id, status, reason, adminId]);
  return rows[0] ?? null;
}
