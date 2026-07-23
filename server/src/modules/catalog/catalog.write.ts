import type { Db } from '../../db/pool.js';
import { pool, withTransaction } from '../../db/pool.js';
import { generateUniqueSlug } from './slug.js';

/** The caller's approved organizer row id, or null (events bind to this — D-E). */
export async function getApprovedOrganizerId(userId: number, db: Db = pool): Promise<number | null> {
  const { rows } = await db.query(`SELECT id FROM organizers WHERE user_id = $1 AND status = 'approved' LIMIT 1`, [userId]);
  return rows[0]?.id ?? null;
}

export async function categoryExists(code: string, db: Db = pool): Promise<boolean> {
  return (await db.query(`SELECT 1 FROM event_categories WHERE code = $1`, [code])).rows.length > 0;
}

export interface CreateEventInput {
  categoryCode: string;
  title: string;
  description: string;
  eventType: 'general_admission' | 'seated';
  ageRestriction?: string;
  imageUrl?: string | null;
  refundPolicy?: string | null;
}

export async function createEvent(organizerId: number, input: CreateEventInput, db: Db = pool): Promise<{ id: number; slug: string }> {
  const slug = await generateUniqueSlug(input.title, db);
  const { rows } = await db.query(
    `INSERT INTO events (slug, organizer_id, category_id, title, description, event_type, age_restriction, image_url, refund_policy, status, moderation_status)
     VALUES ($1, $2, (SELECT id FROM event_categories WHERE code = $3), $4, $5, $6, $7, $8, $9, 'draft', 'pending_review')
     RETURNING id, slug`,
    [slug, organizerId, input.categoryCode, input.title, input.description, input.eventType, input.ageRestriction ?? 'all', input.imageUrl ?? null, input.refundPolicy ?? null],
  );
  return rows[0];
}

/** The user_id that owns an event (via its organizer row), or null if the event does not exist. */
export async function eventOwnerUserId(eventId: number, db: Db = pool): Promise<number | null> {
  const { rows } = await db.query(`SELECT o.user_id FROM events e JOIN organizers o ON o.id = e.organizer_id WHERE e.id = $1`, [eventId]);
  return rows[0]?.user_id ?? null;
}

export async function listMyEvents(userId: number, db: Db = pool) {
  const { rows } = await db.query(
    `SELECT e.id, e.slug, e.title, e.status, e.moderation_status AS moderation, e.review_note AS "reviewNote", e.image_url AS "imageUrl", ec.code AS category
       FROM events e JOIN organizers o ON o.id = e.organizer_id JOIN event_categories ec ON ec.id = e.category_id
      WHERE o.user_id = $1 ORDER BY e.created_at DESC`,
    [userId],
  );
  return rows;
}

/** Update editable fields; a material edit of an APPROVED event returns it to pending_review (D-C). Slug is never changed. */
export async function updateEvent(
  eventId: number,
  f: { title?: string; description?: string; imageUrl?: string | null; refundPolicy?: string | null },
  db: Db = pool,
) {
  const { rows } = await db.query(
    `UPDATE events SET
        title = COALESCE($2, title),
        description = COALESCE($3, description),
        image_url = COALESCE($4, image_url),
        refund_policy = COALESCE($5, refund_policy),
        moderation_status = CASE WHEN moderation_status = 'approved' THEN 'pending_review' ELSE moderation_status END,
        updated_at = now()
      WHERE id = $1
      RETURNING id, slug, title, status, moderation_status AS moderation`,
    [eventId, f.title ?? null, f.description ?? null, f.imageUrl ?? null, f.refundPolicy ?? null],
  );
  return rows[0];
}

/** Publish requires ≥1 upcoming showtime with ≥1 tier (FR-017); → on_sale + pending_review (D-C). */
export async function publishEvent(eventId: number, db: Db = pool): Promise<boolean> {
  const ready = await db.query(
    `SELECT 1 FROM showtimes s JOIN ticket_tiers tt ON tt.showtime_id = s.id WHERE s.event_id = $1 AND s.starts_at > now() LIMIT 1`,
    [eventId],
  );
  if (ready.rows.length === 0) return false;
  await db.query(`UPDATE events SET status = 'on_sale', moderation_status = 'pending_review', updated_at = now() WHERE id = $1`, [eventId]);
  return true;
}

export async function unpublishEvent(eventId: number, db: Db = pool): Promise<void> {
  await db.query(`UPDATE events SET status = 'draft', updated_at = now() WHERE id = $1`, [eventId]);
}

// ---- venues (US5, minimal — needed for showtimes) ----

export async function createVenue(userId: number, v: { name: string; city: string; rawAddress: string; guide?: string | null }, db: Db = pool): Promise<number> {
  const { rows } = await db.query(
    `INSERT INTO venues (created_by, name, city, raw_address, guide) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [userId, v.name, v.city, v.rawAddress, v.guide ?? null],
  );
  return rows[0].id;
}

export async function listMyVenues(userId: number, db: Db = pool) {
  return (await db.query(`SELECT id, name, city, raw_address AS "rawAddress", guide FROM venues WHERE created_by = $1 ORDER BY id DESC`, [userId])).rows;
}

export async function venueOwnerUserId(venueId: number, db: Db = pool): Promise<number | null> {
  const { rows } = await db.query(`SELECT created_by FROM venues WHERE id = $1`, [venueId]);
  return rows[0]?.created_by ?? null;
}

export async function addShowtimeWithTiers(
  eventId: number,
  input: { venueId: number; startsAt: string; tiers: { label: string; price: number; totalQuantity?: number | null }[] },
): Promise<number> {
  return withTransaction(async (client) => {
    const st = (await client.query(`INSERT INTO showtimes (event_id, venue_id, starts_at, status) VALUES ($1, $2, $3, 'on_sale') RETURNING id`, [eventId, input.venueId, input.startsAt])).rows[0].id;
    for (const t of input.tiers) {
      await client.query(`INSERT INTO ticket_tiers (showtime_id, label, price_amount, total_quantity) VALUES ($1, $2, $3, $4)`, [st, t.label, t.price, t.totalQuantity ?? 100]);
    }
    return st;
  });
}

// ---- admin moderation (US6) ----

export async function eventExists(eventId: number, db: Db = pool): Promise<boolean> {
  return (await db.query(`SELECT 1 FROM events WHERE id = $1`, [eventId])).rows.length > 0;
}

export async function setModeration(eventId: number, status: string, reviewNote: string | null, db: Db = pool): Promise<void> {
  await db.query(`UPDATE events SET moderation_status = $2, review_note = COALESCE($3, review_note), updated_at = now() WHERE id = $1`, [eventId, status, reviewNote]);
}

export async function pendingReviewQueue(db: Db = pool) {
  return (
    await db.query(
      `SELECT e.id, e.slug, e.title, e.status, o.display_name AS "organizer"
         FROM events e JOIN organizers o ON o.id = e.organizer_id
        WHERE e.moderation_status = 'pending_review' ORDER BY e.created_at`,
    )
  ).rows;
}

/** Immutable admin audit record (SEC-09, reuse feature 001's audit_logs). */
export async function writeAudit(actorUserId: number, action: string, eventId: number, detail: unknown, db: Db = pool): Promise<void> {
  await db.query(`INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, detail) VALUES ($1, $2, 'event', $3, $4)`, [
    actorUserId,
    action,
    eventId,
    JSON.stringify(detail ?? {}),
  ]);
}
