import type { AdminOrganizerDetail } from '@shared/admin/types.js';
import type { Db } from '../../db/pool.js';
import { pool } from '../../db/pool.js';
import { err } from '../../http.js';

export async function organizerQueue(db: Db = pool) {
  return (
    await db.query(
      `SELECT o.id, o.user_id AS "userId", o.display_name AS "displayName", o.description, o.status, o.review_note AS "reviewNote", o.applied_at AS "appliedAt",
              (
                SELECT json_build_object(
                  'id', oa.id,
                  'organizerId', oa.organizer_id,
                  'userId', oa.user_id,
                  'reason', oa.reason,
                  'status', oa.status,
                  'reviewNote', oa.review_note,
                  'reviewedBy', oa.reviewed_by,
                  'reviewedAt', oa.reviewed_at,
                  'createdAt', oa.created_at
                )
                FROM organizer_appeals oa
                WHERE oa.organizer_id = o.id
                ORDER BY oa.created_at DESC
                LIMIT 1
              ) AS "latestAppeal"
         FROM organizers o
        WHERE o.status IN ('pending', 'approved', 'suspended')
        ORDER BY o.applied_at`,
    )
  ).rows;
}

/**
 * One organizer, in full, for the preview an admin reads before deciding (UC-33).
 *
 * Four reads rather than one join: the profile, the account's other applications, the events, and
 * the trading totals. Joining events to tickets in the same statement as the application history
 * would multiply one against the other and make every count wrong — and the shapes are genuinely
 * different lists, not columns of one row.
 *
 * The history is keyed on the USER, not on this row: `organizers` deliberately allows a user
 * several applications over time (0001), so a re-application after a rejection is a new row, and
 * what the last reviewer wrote is the thing this reviewer most needs to see.
 */
export async function organizerDetail(id: number, db: Db = pool): Promise<AdminOrganizerDetail> {
  const profile = (
    await db.query<{
      id: number;
      user_id: number;
      display_name: string;
      description: string | null;
      logo_url: string | null;
      status: string;
      review_note: string | null;
      applied_at: Date;
      approved_at: Date | null;
      owner_email: string;
      owner_name: string | null;
      owner_joined_at: Date;
    }>(
      `SELECT o.id, o.user_id, o.display_name, o.description, o.logo_url, o.status,
              o.review_note, o.applied_at, o.approved_at,
              u.email AS owner_email, u.nickname AS owner_name, u.created_at AS owner_joined_at
         FROM organizers o
         JOIN users u ON u.id = o.user_id
        WHERE o.id = $1`,
      [id],
    )
  ).rows[0];
  if (!profile) throw err.notFound('not_found', 'Không tìm thấy ban tổ chức này.');

  const history = await db.query<{
    id: number;
    status: string;
    review_note: string | null;
    applied_at: Date;
  }>(
    `SELECT id, status, review_note, applied_at
       FROM organizers WHERE user_id = $1 ORDER BY applied_at DESC LIMIT 10`,
    [profile.user_id],
  );

  const events = await db.query<{
    id: number;
    title: string;
    slug: string;
    status: string;
    moderation: string;
    created_at: Date;
  }>(
    `SELECT id, title, slug, status, moderation_status AS moderation, created_at
       FROM events WHERE organizer_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [id],
  );

  // Sold, unvoided tickets across everything they have run — the figure that says whether a
  // suspension would strand real buyers.
  const totals = (
    await db.query<{ event_count: number; tickets_sold: number; revenue: string }>(
      `SELECT (SELECT count(*)::int FROM events WHERE organizer_id = $1) AS event_count,
              count(t.id)::int AS tickets_sold,
              COALESCE(SUM(t.price_cents), 0)::text AS revenue
         FROM tickets t
         JOIN orders ord ON ord.id = t.order_id
         JOIN reservations r ON r.id = ord.reservation_id
         JOIN showtimes s ON s.id = r.showtime_id
         JOIN events e ON e.id = s.event_id
        WHERE e.organizer_id = $1 AND t.qr_status <> 'void'
          AND ord.payment_status IN ('paid', 'partially_refunded')`,
      [id],
    )
  ).rows[0]!;

  const appeals = await db.query<{
    id: number;
    organizer_id: number;
    user_id: number;
    reason: string;
    status: "pending" | "approved" | "rejected";
    review_note: string | null;
    reviewed_by: number | null;
    reviewed_at: Date | null;
    created_at: Date;
  }>(
    `SELECT id, organizer_id, user_id, reason, status, review_note, reviewed_by, reviewed_at, created_at
       FROM organizer_appeals
      WHERE organizer_id = $1
      ORDER BY created_at DESC`,
    [id],
  );

  return {
    id: profile.id,
    displayName: profile.display_name,
    description: profile.description,
    logoUrl: profile.logo_url,
    status: profile.status,
    reviewNote: profile.review_note,
    appliedAt: profile.applied_at.toISOString(),
    approvedAt: profile.approved_at?.toISOString() ?? null,
    ownerEmail: profile.owner_email,
    ownerName: profile.owner_name,
    ownerJoinedAt: profile.owner_joined_at.toISOString(),
    history: history.rows.map((row) => ({
      id: row.id,
      status: row.status,
      reviewNote: row.review_note,
      appliedAt: row.applied_at.toISOString(),
    })),
    appeals: appeals.rows.map((row) => ({
      id: row.id,
      organizerId: row.organizer_id,
      userId: row.user_id,
      reason: row.reason,
      status: row.status,
      reviewNote: row.review_note,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
    })),
    events: events.rows.map((row) => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      status: row.status,
      moderation: row.moderation,
      createdAt: row.created_at.toISOString(),
    })),
    eventCount: totals.event_count,
    ticketsSold: totals.tickets_sold,
    revenue: Number(totals.revenue),
  };
}

/*
 * The approval queue only (UC-34). Flagged and removed events moved to `approvedEvents` —
 * the inbox is a decision, not a registry, and the two screens no longer share one list.
 */
export async function eventQueue(db: Db = pool) {
  return (await db.query(`SELECT e.id, e.slug, e.title, e.status, e.moderation_status AS moderation, o.display_name AS organizer, e.review_note AS "reviewNote", e.created_at AS "createdAt" FROM events e JOIN organizers o ON o.id = e.organizer_id WHERE e.moderation_status = 'pending_review' AND e.status = 'on_sale' ORDER BY e.created_at`)).rows;
}

/**
 * Every event that has been approved. Approving is the entry ticket — flagged and removed rows
 * stay here because they once carried an approval, and the screen needs them exactly to watch or
 * take them down (UC-34 list view).
 */
export async function approvedEvents(db: Db = pool) {
  return (await db.query(`SELECT e.id, e.slug, e.title, e.status, e.moderation_status AS moderation, o.display_name AS organizer, e.review_note AS "reviewNote", e.created_at AS "createdAt" FROM events e JOIN organizers o ON o.id = e.organizer_id WHERE e.moderation_status IN ('approved', 'flagged', 'removed') ORDER BY e.created_at DESC`)).rows;
}

/*
 * The open reports, each carrying enough of what was reported to be judged on the spot.
 *
 * A queue of ids and reasons is not reviewable: deciding whether a comment should come down means
 * reading the comment, and an admin who has to go and find it on the event page will either guess
 * or not act. The two joins are `LEFT` because a target may since have been deleted by its own
 * author, and a report whose subject is gone still has to be dismissible rather than invisible.
 */
export async function reportQueue(db: Db = pool) {
  return (await db.query(`
    SELECT c.id, c.target_type AS "targetType", c.target_id AS "targetId", c.reason, c.status,
           c.created_at AS "createdAt",
           COALESCE(e.title, ev.title) AS "targetTitle",
           r.body AS "targetBody",
           r.status AS "targetStatus",
           u.nickname AS "targetAuthor"
      FROM content_reports c
      LEFT JOIN events e ON c.target_type = 'event' AND e.id = c.target_id
      LEFT JOIN event_reviews r ON c.target_type = 'review' AND r.id = c.target_id
      LEFT JOIN users u ON u.id = r.user_id
      LEFT JOIN events ev ON ev.id = r.event_id
     WHERE c.status = 'open'
     ORDER BY c.created_at`)).rows;
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

export async function listCategories(db: Db = pool) {
  const { rows } = await db.query(`SELECT id, code, label_vi AS "labelVi", label_en AS "labelEn" FROM event_categories ORDER BY label_vi, id`);
  return rows;
}

export async function insertCategory(labelVi: string, labelEn: string | null, code: string, db: Db) {
  const { rows } = await db.query(`INSERT INTO event_categories (code, label_vi, label_en) VALUES ($1, $2, $3) RETURNING id, code, label_vi AS "labelVi", label_en AS "labelEn"`, [code, labelVi, labelEn]);
  return rows[0];
}

export async function updateCategory(id: number, labelVi: string, labelEn: string | null, db: Db) {
  const { rows } = await db.query(`UPDATE event_categories SET label_vi = $2, label_en = $3 WHERE id = $1 RETURNING id, code, label_vi AS "labelVi", label_en AS "labelEn"`, [id, labelVi, labelEn]);
  return rows[0] ?? null;
}

export async function deleteCategory(id: number, db: Db) {
  const used = await db.query(`SELECT 1 FROM events WHERE category_id = $1 LIMIT 1`, [id]);
  if (used.rowCount) return false;
  const result = await db.query(`DELETE FROM event_categories WHERE id = $1`, [id]);
  return result.rowCount === 1;
}

export async function listFeatured(db: Db = pool) {
  const { rows } = await db.query(`SELECT f.event_id AS "eventId", f.display_order AS "displayOrder", e.slug, e.title, e.image_url AS "imageUrl" FROM featured_events f JOIN events e ON e.id = f.event_id ORDER BY f.display_order, f.event_id`);
  return rows;
}

export async function replaceFeatured(events: Array<{ eventId: number; displayOrder: number }>, db: Db) {
  const ids = events.map((entry) => entry.eventId);
  if (new Set(ids).size !== ids.length || new Set(events.map((entry) => entry.displayOrder)).size !== events.length) throw err.conflict('featured_conflict');
  if (ids.length) {
    const result = await db.query(`SELECT e.id FROM events e JOIN organizers o ON o.id = e.organizer_id WHERE e.id = ANY($1::bigint[]) AND e.status = 'on_sale' AND e.moderation_status = 'approved' AND o.status = 'approved' FOR UPDATE`, [ids]);
    if (result.rowCount !== ids.length) throw err.conflict('featured_unavailable', 'Sự kiện không còn đủ điều kiện nổi bật.');
  }
  await db.query('DELETE FROM featured_events');
  for (const entry of events) await db.query('INSERT INTO featured_events (event_id, display_order) VALUES ($1, $2)', [entry.eventId, entry.displayOrder]);
  return listFeatured(db);
}
