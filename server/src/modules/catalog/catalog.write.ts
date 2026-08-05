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
    `SELECT e.id, e.slug, e.title, e.status, e.moderation_status AS moderation, e.review_note AS "reviewNote",
            e.image_url AS "imageUrl", e.event_type AS "eventType", ec.code AS category
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

// ---- sections / seats / seat-map generation (US5, R-7) ----

/** Find-or-create the venue's default layout. Seats and sections belong to a LAYOUT now (feature 005,
 *  FR-002); these venue-level helpers keep working by resolving to that default one. */
export async function defaultLayoutId(venueId: number, db: Db = pool): Promise<number> {
  const found = await db.query<{ id: number }>(
    `SELECT id FROM venue_layouts WHERE venue_id = $1 ORDER BY created_at LIMIT 1`,
    [venueId],
  );
  if (found.rows[0]) return found.rows[0].id;
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO venue_layouts (venue_id, name, status) VALUES ($1, 'Sơ đồ mặc định', 'ready') RETURNING id`,
    [venueId],
  );
  return rows[0].id;
}

export async function createSection(venueId: number, name: string, db: Db = pool): Promise<number> {
  const layoutId = await defaultLayoutId(venueId, db);
  const { rows } = await db.query(`INSERT INTO sections (layout_id, name) VALUES ($1, $2) RETURNING id`, [layoutId, name]);
  return rows[0].id;
}

/** Bulk-add seats to a section: rowLabel-1 .. rowLabel-count. Returns how many were created.
 *  Seeds each seat a grid position — geometry is required, and the grid is what buyers already see. */
export async function addSeats(venueId: number, sectionId: number, rowLabel: string, count: number, db: Db = pool): Promise<number> {
  const layoutId = await defaultLayoutId(venueId, db);
  const { rows: prior } = await db.query<{ max_y: number | null }>(
    `SELECT max(pos_y) AS max_y FROM seats WHERE layout_id = $1`,
    [layoutId],
  );
  const y = Math.min(10000, (prior[0].max_y ?? 1050) + 150);
  const startX = Math.max(0, Math.round(5000 - ((count - 1) * 150) / 2));
  await db.query(
    `INSERT INTO seats (layout_id, section_id, row_label, seat_number, pos_x, pos_y)
     SELECT $1, $2, $3, gs, LEAST(10000, $4::int + (gs - 1) * 150), $5 FROM generate_series(1, $6) AS gs
     ON CONFLICT (section_id, row_label, seat_number) DO NOTHING`,
    [layoutId, sectionId, rowLabel, startX, y, count],
  );
  return count;
}

export async function seatVenueOwnerUserId(seatId: number, db: Db = pool): Promise<number | null> {
  const { rows } = await db.query(
    `SELECT v.created_by FROM seats s
       JOIN venue_layouts l ON l.id = s.layout_id
       JOIN venues v ON v.id = l.venue_id
      WHERE s.id = $1`,
    [seatId],
  );
  return rows[0]?.created_by ?? null;
}

export async function seatInLiveMap(seatId: number, db: Db = pool): Promise<boolean> {
  return (await db.query(`SELECT 1 FROM showtime_seats WHERE seat_id = $1 LIMIT 1`, [seatId])).rows.length > 0;
}

export async function deleteSeat(seatId: number, db: Db = pool): Promise<void> {
  await db.query(`DELETE FROM seats WHERE id = $1`, [seatId]);
}

export interface ShowtimeInfo {
  venueId: number;
  eventType: 'general_admission' | 'seated';
  ownerUserId: number;
}
export async function showtimeInfo(showtimeId: number, db: Db = pool): Promise<ShowtimeInfo | null> {
  const { rows } = await db.query(
    `SELECT s.venue_id AS "venueId", e.event_type AS "eventType", o.user_id AS "ownerUserId"
       FROM showtimes s JOIN events e ON e.id = s.event_id JOIN organizers o ON o.id = e.organizer_id
      WHERE s.id = $1`,
    [showtimeId],
  );
  return rows[0] ?? null;
}

export async function listSections(venueId: number, db: Db = pool) {
  return (
    await db.query(
      `SELECT s.id, s.name, count(se.id)::int AS "seatCount"
         FROM sections s
         JOIN venue_layouts l ON l.id = s.layout_id
         LEFT JOIN seats se ON se.section_id = s.id
        WHERE l.venue_id = $1 GROUP BY s.id ORDER BY s.id`,
      [venueId],
    )
  ).rows;
}

/** Everything the seat-map builder needs for an event: each showtime with its venue, tiers, and the
 *  venue's sections + whether a seat map already exists. */
export async function eventShowtimesManage(eventId: number, db: Db = pool) {
  const showtimes = (
    await db.query(
      `SELECT s.id, s.starts_at AS "startsAt", s.venue_id AS "venueId", v.name AS "venueName",
              EXISTS (SELECT 1 FROM showtime_seats ss WHERE ss.showtime_id = s.id) AS "hasSeatMap"
         FROM showtimes s JOIN venues v ON v.id = s.venue_id WHERE s.event_id = $1 ORDER BY s.starts_at`,
      [eventId],
    )
  ).rows as { id: number; startsAt: string; venueId: number; venueName: string; hasSeatMap: boolean; tiers?: unknown; sections?: unknown }[];
  for (const st of showtimes) {
    st.tiers = (await db.query(`SELECT id, label, price_amount::int AS price FROM ticket_tiers WHERE showtime_id = $1 ORDER BY price_amount`, [st.id])).rows;
    st.sections = await listSections(st.venueId, db);
  }
  return showtimes;
}

export async function sectionsWithSeats(venueId: number, db: Db = pool): Promise<number[]> {
  const { rows } = await db.query<{ section_id: number }>(
    `SELECT DISTINCT s.section_id FROM seats s
       JOIN venue_layouts l ON l.id = s.layout_id
      WHERE l.venue_id = $1 AND s.section_id IS NOT NULL`,
    [venueId],
  );
  return rows.map((r) => r.section_id);
}

export async function tiersOfShowtime(showtimeId: number, db: Db = pool): Promise<number[]> {
  const { rows } = await db.query<{ id: number }>(`SELECT id FROM ticket_tiers WHERE showtime_id = $1`, [showtimeId]);
  return rows.map((r) => r.id);
}

export async function showtimeHasSeatMap(showtimeId: number, db: Db = pool): Promise<boolean> {
  return (await db.query(`SELECT 1 FROM showtime_seats WHERE showtime_id = $1 LIMIT 1`, [showtimeId])).rows.length > 0;
}

/**
 * Generate the seated seat map: one showtime_seat per physical seat, tier assigned per section (R-7).
 *
 * Feature 005: this SNAPSHOTS the layout onto the showtime (FR-005). Each seat's geometry is copied
 * onto its `showtime_seats` row, and the layout's decoration and background are frozen into
 * `showtimes.layout_snapshot`. From here the showtime owns its map — a later layout edit reaches it
 * only through an explicit, previewed re-apply.
 */
export async function generateSeatMap(showtimeId: number, sectionTiers: { sectionId: number; ticketTierId: number }[]): Promise<number> {
  return withTransaction(async (client) => {
    let total = 0;
    let layoutId: number | null = null;
    for (const { sectionId, ticketTierId } of sectionTiers) {
      const res = await client.query(
        `INSERT INTO showtime_seats (showtime_id, seat_id, ticket_tier_id, status,
                                     pos_x, pos_y, rotation, row_label, seat_number, section_name)
         SELECT $1, s.id, $2, 'available', s.pos_x, s.pos_y, s.rotation, s.row_label, s.seat_number,
                (SELECT sec.name FROM sections sec WHERE sec.id = s.section_id)
           FROM seats s WHERE s.section_id = $3`,
        [showtimeId, ticketTierId, sectionId],
      );
      total += res.rowCount ?? 0;
      if (layoutId === null) {
        const { rows } = await client.query<{ layout_id: number }>(`SELECT layout_id FROM sections WHERE id = $1`, [sectionId]);
        layoutId = rows[0]?.layout_id ?? null;
      }
    }

    if (layoutId !== null) {
      await client.query(
        `UPDATE showtimes st
            SET layout_id = $2,
                layout_snapshot = jsonb_build_object(
                  'elements', COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                      'kind', e.kind, 'x', e.pos_x, 'y', e.pos_y,
                      'width', e.width, 'height', e.height, 'rotation', e.rotation, 'label', e.label))
                      FROM layout_elements e WHERE e.layout_id = l.id), '[]'::jsonb),
                  'planUrl', l.background_url,
                  'planScale', round(l.background_scale * 1000),
                  'planOffsetX', l.background_offset_x,
                  'planOffsetY', l.background_offset_y,
                  'planOpacity', round(l.background_opacity * 100),
                  'planVisibleToBuyers', l.background_public
                )
           FROM venue_layouts l
          WHERE st.id = $1 AND l.id = $2`,
        [showtimeId, layoutId],
      );
    }
    return total;
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
