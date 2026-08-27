import type pg from "pg";
import type { Db } from "../../db/pool.js";
import { LAYOUT_SPACE, MAX_TIERS_PER_SHOWTIME } from "../../config.js";
import { pool, withTransaction } from "../../db/pool.js";
import { applyOrganizerEdit } from "../studio/moderation-guard.js";
import { generateUniqueSlug } from "./slug.js";
import { refreshSnapshot, syncCompanionLinks, writeZonePlan, zonePlan } from "../seatmap/apply.js";
import { defaultCategoryId } from "../seatmap/layouts.repo.js";
import { err } from "../../http.js";
import { CATEGORY_COLORS } from "@shared/catalog/tier-palette.js";
import { UPCOMING_SHOWTIME } from "./visibility.js";
import { lockEditableEvent } from "../studio/event-lifecycle.js";

/** The caller's approved organizer row id, or null (events bind to this — D-E). */
export async function getApprovedOrganizerId(
  userId: number,
  db: Db = pool,
): Promise<number | null> {
  const { rows } = await db.query(
    `SELECT id FROM organizers WHERE user_id = $1 AND status = 'approved' LIMIT 1`,
    [userId],
  );
  return rows[0]?.id ?? null;
}

export async function categoryExists(code: string, db: Db = pool): Promise<boolean> {
  return (await db.query(`SELECT 1 FROM event_categories WHERE code = $1`, [code])).rows.length > 0;
}

export interface CreateEventInput {
  categoryCode: string;
  title: string;
  description: string;
  eventType: "general_admission" | "seated";
  ageRestriction?: string;
  imageUrl?: string | null;
  refundPolicy?: string | null;
}

export async function createEvent(
  organizerId: number,
  input: CreateEventInput,
  db: Db = pool,
): Promise<{ id: number; slug: string }> {
  const slug = await generateUniqueSlug(input.title, db);
  const { rows } = await db.query(
    `INSERT INTO events (slug, organizer_id, category_id, title, description, event_type, age_restriction, image_url, refund_policy, status, moderation_status)
     VALUES ($1, $2, (SELECT id FROM event_categories WHERE code = $3), $4, $5, $6, $7, $8, $9, 'draft', 'pending_review')
     RETURNING id, slug`,
    [
      slug,
      organizerId,
      input.categoryCode,
      input.title,
      input.description,
      input.eventType,
      input.ageRestriction ?? "all",
      input.imageUrl ?? null,
      input.refundPolicy ?? null,
    ],
  );
  return rows[0];
}

/** The user_id that owns an event (via its organizer row), or null if the event does not exist. */
export async function eventOwnerUserId(eventId: number, db: Db = pool): Promise<number | null> {
  const { rows } = await db.query(
    `SELECT o.user_id FROM events e JOIN organizers o ON o.id = e.organizer_id WHERE e.id = $1`,
    [eventId],
  );
  return rows[0]?.user_id ?? null;
}

/** Persist the venue with the draft, not later when its first showtime happens to be created. */
export async function createEventWithVenue(
  organizerId: number,
  userId: number,
  input: CreateEventInput,
  venue: { name: string; city: string; rawAddress: string; guide?: string | null },
) {
  return withTransaction(async (client) => {
    const place = await createVenue(userId, venue, client);
    const event = await createEvent(organizerId, input, client);
    await client.query(`UPDATE events SET venue_id = $2 WHERE id = $1`, [event.id, place]);
    return { ...event, venueId: place };
  });
}

export async function listMyEvents(userId: number, db: Db = pool) {
  const { rows } = await db.query(
    `SELECT e.id, e.slug, e.title, e.description, e.status, e.moderation_status AS moderation, e.review_note AS "reviewNote",
            e.image_url AS "imageUrl", e.trailer_url AS "trailerUrl", e.event_type AS "eventType", ec.code AS category,
            COALESCE(e.is_high_demand, false) AS "isHighDemand",
            COALESCE(e.is_high_demand, false) AS is_high_demand,
            e.release_phase AS "releasePhase",
            e.venue_id AS "venueId",
            e.created_at AS "createdAt", e.updated_at AS "updatedAt",
            -- tt.total_quantity is NULL for seated tiers (0002_catalog.sql: "GA capacity; NULL for
            -- seated") -- their real capacity lives in showtime_seats, one row per assigned seat.
            -- Summing total_quantity alone silently zeroes out every seatmap-backed event.
            COALESCE((
              SELECT SUM(
                CASE
                  WHEN tt.total_quantity IS NOT NULL THEN tt.total_quantity
                  ELSE (
                    SELECT COUNT(*) FROM showtime_seats ss
                     WHERE ss.ticket_tier_id = tt.id AND ss.status <> 'blocked'
                  )
                END
              )
                FROM showtimes s2
                JOIN ticket_tiers tt ON tt.showtime_id = s2.id
               WHERE s2.event_id = e.id
            ), 0)::int AS "totalCapacity",
            COALESCE((
              SELECT COUNT(t2.id)
                FROM showtimes s2
                JOIN reservations r2 ON r2.showtime_id = s2.id
                JOIN orders o2 ON o2.reservation_id = r2.id AND o2.payment_status IN ('paid', 'completed')
                JOIN tickets t2 ON t2.order_id = o2.id AND t2.qr_status != 'void'
               WHERE s2.event_id = e.id
            ), 0)::int AS "soldTickets",
            COALESCE((
              SELECT SUM(t2.price_cents)
                FROM showtimes s2
                JOIN reservations r2 ON r2.showtime_id = s2.id
                JOIN orders o2 ON o2.reservation_id = r2.id AND o2.payment_status IN ('paid', 'completed', 'refunded', 'partially_refunded')
                JOIN tickets t2 ON t2.order_id = o2.id
               WHERE s2.event_id = e.id
            ), 0)::bigint AS "totalRevenueVnd",
            -- The showtime the row leads with. NEXT UPCOMING first, and only when there is none does
            -- it fall back to the latest past one: an organizer scanning the list is looking ahead,
            -- but a finished event that printed no date at all would read as an event with no dates
            -- rather than one that has already happened.
            --
            -- Ordered so both cases come out of one scan: future showtimes sort ahead of past ones,
            -- then future ascends (soonest) while past descends (most recent).
            (
              SELECT s3.starts_at
                FROM showtimes s3
               WHERE s3.event_id = e.id AND s3.status <> 'cancelled'
               ORDER BY (s3.starts_at < now()),
                        CASE WHEN s3.starts_at >= now() THEN s3.starts_at END ASC,
                        s3.starts_at DESC
               LIMIT 1
            ) AS "nextShowtimeAt",
            (
              SELECT v3.name
                FROM showtimes s3
                JOIN venues v3 ON v3.id = s3.venue_id
               WHERE s3.event_id = e.id AND s3.status <> 'cancelled'
               ORDER BY (s3.starts_at < now()),
                        CASE WHEN s3.starts_at >= now() THEN s3.starts_at END ASC,
                        s3.starts_at DESC
               LIMIT 1
            ) AS "showtimeVenueName",
            (SELECT name FROM venues WHERE id = e.venue_id) AS "boundVenueName",
            -- Separate from "nextShowtimeAt" on purpose: that field falls back to the latest PAST
            -- showtime so a finished event still prints a date, which makes it useless as a "still
            -- live" signal on its own — an event with only past showtimes read as indistinguishable
            -- from one still selling. This is the one column that actually answers it.
            EXISTS (SELECT 1 FROM showtimes s WHERE ${UPCOMING_SHOWTIME}) AS "hasUpcoming"
       FROM events e
       JOIN organizers o ON o.id = e.organizer_id
       JOIN event_categories ec ON ec.id = e.category_id
      WHERE o.user_id = $1
      ORDER BY e.created_at DESC`,
    [userId],
  );

  return rows.map(({ showtimeVenueName, boundVenueName, ...event }) => ({
    ...event,
    venueName: boundVenueName ?? showtimeVenueName,
  }));
}

/**
 * Publish requires ≥1 upcoming showtime with ≥1 ACTIVE tier (FR-017); → on_sale + pending_review (D-C).
 *
 * `tt.archived_at IS NULL` is the load-bearing half. Without it this gate and the catalog's
 * `SHOWTIME_HAS_AVAILABILITY` (visibility.ts) disagree about what a sellable tier is, and the gap
 * between them is reachable: the `tier_last_active` guard in `removeTier` only fires while the event
 * is `on_sale`, so unpublishing (which sets `status = 'draft'`) lets the last tier be archived, and a
 * republish then matched the archived row. The event went back on sale carrying nothing anyone could
 * buy — visible as "đang bán" to the organizer and the admin, and absent from the catalog, because
 * visibility filters what this did not.
 */
export async function publishEvent(eventId: number): Promise<boolean> {
  return withTransaction(async (client) => {
    const event = await lockEditableEvent(client, eventId);
    if (["flagged", "removed"].includes(event.moderation_status)) {
      throw err.conflict(
        "event_under_moderation",
        "Sự kiện đang bị quản trị viên xử lý. Vui lòng liên hệ quản trị viên.",
      );
    }
    const { rows } = await client.query<{ ready: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM ticket_tiers tt WHERE tt.showtime_id = s.id AND tt.archived_at IS NULL
       ) AND (e.event_type <> 'seated' OR (
         EXISTS (SELECT 1 FROM showtime_seats ss JOIN ticket_tiers tt ON tt.id = ss.ticket_tier_id
                  WHERE ss.showtime_id = s.id AND ss.status <> 'blocked' AND tt.archived_at IS NULL)
         OR (s.layout_snapshot IS NOT NULL AND EXISTS (
           SELECT 1 FROM ticket_tiers tt WHERE tt.showtime_id = s.id AND tt.archived_at IS NULL
             AND tt.category_id IS NOT NULL AND tt.total_quantity > 0
         ))
       )) AS ready
       FROM showtimes s JOIN events e ON e.id = s.event_id
       WHERE s.event_id = $1 AND s.starts_at > now() AND s.status NOT IN ('cancelled', 'finished')`,
      [eventId],
    );
    if (rows.length === 0 || rows.some((row) => !row.ready)) return false;
    // Repeating a successful submission must not remove an already-approved listing.
    if (event.status !== "on_sale") {
      await client.query(
        `UPDATE events SET status = 'on_sale', moderation_status = 'pending_review', review_note = NULL, updated_at = now() WHERE id = $1`,
        [eventId],
      );
    }
    return true;
  });
}

export async function unpublishEvent(eventId: number): Promise<void> {
  await withTransaction(async (client) => {
    await lockEditableEvent(client, eventId);
    await client.query(`UPDATE events SET status = 'draft', updated_at = now() WHERE id = $1`, [
      eventId,
    ]);
  });
}

/**
 * Mark an event as finished (Hoàn Tất). Only a published (on_sale) event whose
 * owner organizer initiates it may be finished. Finishing is irreversible — no
 * ticket sales or edits are allowed once the status is 'finished'.
 *
 * Unlike cancellation, no refunds are issued: attendees already attended.
 * The DB enum only allows 'draft' | 'on_sale' | 'finished' | 'cancelled', so
 * 'finished' is the correct value (not 'completed', which is a frontend alias).
 */
export async function finishEvent(eventId: number): Promise<void> {
  return withTransaction(async (db) => {
    const { rows } = await db.query<{ status: string }>(
      `SELECT status FROM events WHERE id = $1 FOR UPDATE`,
      [eventId],
    );
    if (!rows[0]) throw err.notFound("not_found", "Không tìm thấy sự kiện.");
    if (rows[0].status === "finished") return; // idempotent
    if (rows[0].status === "cancelled") {
      throw err.conflict("already_cancelled", "Sự kiện đã bị hủy, không thể hoàn tất.");
    }
    if (rows[0].status === "draft") {
      throw err.conflict("not_published", "Chỉ có thể hoàn tất sự kiện đang đăng bán.");
    }
    const future = await db.query(
      `SELECT 1 FROM showtimes WHERE event_id = $1 AND starts_at > now() AND status NOT IN ('cancelled', 'finished') LIMIT 1`,
      [eventId],
    );
    if (future.rows.length)
      throw err.conflict(
        "event_has_upcoming",
        "Còn suất chưa diễn. Nếu ngừng tổ chức, hãy hủy sự kiện để hoàn tiền cho người mua.",
      );
    await db.query(`UPDATE events SET status = 'finished', updated_at = now() WHERE id = $1`, [
      eventId,
    ]);
    // Mark all future showtimes (if any remain) as finished too.
    await db.query(
      `UPDATE showtimes SET status = 'finished' WHERE event_id = $1 AND status NOT IN ('cancelled', 'finished')`,
      [eventId],
    );
  });
}

// ---- venues (US5, minimal — needed for showtimes) ----

/**
 * One venue per real place, not one per attempt to name it.
 *
 * SQL half of the same rule `dedupedVenues` applies on the client: trim, collapse runs of whitespace,
 * lowercase. Written once here so the server's idea of "the same place" and the picker's cannot drift
 * — the picker collapsing two rows the server treats as distinct is how an organizer ends up choosing an
 * id nothing was built on.
 */
const SAME_TEXT = (col: string, param: string) =>
  `lower(regexp_replace(btrim(${col}), '\\s+', ' ', 'g')) = lower(regexp_replace(btrim(${param}), '\\s+', ' ', 'g'))`;

/**
 * Find this organizer's venue, or create it.
 *
 * It used to be a bare INSERT, and the create-event wizard calls it unconditionally with three
 * free-text fields — so every event made at the same place minted another row. `dedupedVenues` was
 * added to hide the result in the picker, but hiding is not the same as not making it: its own Rule 0
 * un-hides any duplicate something already points at, so once each twin has a showtime they all come
 * back, told apart only by id. This is the half that stops them being made.
 *
 * Measured, because the two available figures mean different things and the larger one is the wrong
 * justification for this. `dedupedVenues` cites 216 duplicates — that is by NAME ALONE across all
 * owners, which is the case for collapsing the picker, not for collapsing rows: two organizers each
 * with an "Online" venue are not one row typed twice. By the key this function actually uses, the
 * live branch holds 522 venues over 519 distinct places — 3 redundant rows in one cluster. Small,
 * and the cluster is exactly the shape this prevents: four rows for one hall, made by running the
 * wizard four times. `server/src/db/venue-duplicates.ts` re-measures both on demand.
 *
 * Scoped to `created_by`, deliberately. Two organizers naming the same hall are two rows: a venue
 * carries an owner and an edit permission, and collapsing across owners would hand one organizer's
 * row to another.
 *
 * The lookup alone would leave a race — two simultaneous creates both find nothing and both insert —
 * so the insert is `ON CONFLICT DO NOTHING` against the unique index migration 0046 adds, and a
 * conflict falls back to reading the row the other request won with. Nothing is refused: the caller
 * asked for "the venue for this place", and either path answers that.
 */
export async function createVenue(
  userId: number,
  v: { name: string; city: string; rawAddress: string; guide?: string | null },
  db: Db = pool,
): Promise<number> {
  const { rows: found } = await db.query<{ id: number; guide: string | null }>(
    `SELECT id, guide FROM venues
      WHERE created_by = $1
        AND ${SAME_TEXT("name", "$2")}
        AND ${SAME_TEXT("city", "$3")}
        AND ${SAME_TEXT("raw_address", "$4")}
      -- The lowest id is the original; any higher ones are repeats made before this rule existed.
      ORDER BY id LIMIT 1`,
    [userId, v.name, v.city, v.rawAddress],
  );

  if (found[0]) {
    /*
     * Reuse keeps the stored row as it is, with one exception: a guide it does not have yet.
     *
     * Filling a NULL is purely additive and cannot lose anything the organizer wrote earlier, while
     * discarding a guide they just typed silently would. Overwriting an existing one is the opposite
     * trade and is left to `updateVenue`, which is the deliberate way to change a venue.
     */
    const guide = v.guide?.trim();
    if (guide && !found[0].guide) {
      await db.query(`UPDATE venues SET guide = $2 WHERE id = $1 AND guide IS NULL`, [
        found[0].id,
        guide,
      ]);
    }
    return found[0].id;
  }

  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO venues (created_by, name, city, raw_address, guide) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING RETURNING id`,
    [userId, v.name, v.city, v.rawAddress, v.guide ?? null],
  );
  if (rows[0]) return rows[0].id;

  // Lost the race: the row now exists because someone else's request created it a moment ago. Read
  // it back rather than reporting a conflict the caller can do nothing useful with.
  const { rows: raced } = await db.query<{ id: number }>(
    `SELECT id FROM venues
      WHERE created_by = $1
        AND ${SAME_TEXT("name", "$2")}
        AND ${SAME_TEXT("city", "$3")}
        AND ${SAME_TEXT("raw_address", "$4")}
      ORDER BY id LIMIT 1`,
    [userId, v.name, v.city, v.rawAddress],
  );
  if (raced[0]) return raced[0].id;
  // Neither inserted nor found: the conflict was on some OTHER constraint, and swallowing it would
  // return a venue id that does not exist. Surface it instead.
  throw err.badRequest("validation_failed", "Không thể tạo địa điểm.");
}

export async function listMyVenues(userId: number, db: Db = pool) {
  return (
    await db.query(
      // `inUse` marks a venue something already points at — a showtime, or a chart drawn for it.
      // The picker collapses look-alike venues, and a row that is already a write target must never
      // be the one collapsed away: an event whose showtime names the hidden duplicate could not have
      // a chart made for it, and a chart made for the visible twin was refused at apply time.
      `SELECT v.id, v.name, v.city, v.raw_address AS "rawAddress", v.guide,
              (EXISTS (SELECT 1 FROM showtimes s WHERE s.venue_id = v.id)
                OR EXISTS (SELECT 1 FROM venue_layouts l WHERE l.venue_id = v.id)) AS "inUse"
         FROM venues v WHERE v.created_by = $1 ORDER BY v.id DESC`,
      [userId],
    )
  ).rows;
}

export async function venueOwnerUserId(venueId: number, db: Db = pool): Promise<number | null> {
  const { rows } = await db.query(`SELECT created_by FROM venues WHERE id = $1`, [venueId]);
  return rows[0]?.created_by ?? null;
}

/**
 * Edit a venue's display details — name, city, address.
 *
 * Allowed while the venue is only serving DRAFT events. The moment a published event holds a
 * showtime here, the row is frozen: buyers bought "Nhà hát Hòa Bình", and a seller quietly renaming
 * it out from under their tickets is exactly the kind of drift the moderation model exists to
 * prevent. A draft has nobody to surprise, so its venue stays as editable as the event is.
 *
 * Ownership mirrors `venueOwnerUserId`'s contract: the caller must be the venue's creator.
 */
export async function updateVenue(
  userId: number,
  venueId: number,
  input: { name?: string; city?: string; rawAddress?: string },
  db: Db = pool,
): Promise<void> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ created_by: number }>(
      `SELECT created_by FROM venues WHERE id = $1 FOR UPDATE`,
      [venueId],
    );
    if (!rows[0]) throw err.notFound("not_found", "Không tìm thấy địa điểm.");
    if (rows[0].created_by !== userId)
      throw err.forbidden("not_owner", "Bạn không sở hữu địa điểm này.");

    const { rows: used } = await client.query<{ n: string }>(
      `SELECT COUNT(DISTINCT e.id)::text AS n
         FROM showtimes s JOIN events e ON e.id = s.event_id
        WHERE s.venue_id = $1 AND e.status <> 'draft'`,
      [venueId],
    );
    if (Number(used[0].n) > 0) {
      throw err.conflict(
        "venue_in_use",
        "Địa điểm đang được một sự kiện đã xuất bản sử dụng — không thể chỉnh sửa.",
      );
    }

    await client.query(
      `UPDATE venues
          SET name        = COALESCE($2, name),
              city        = COALESCE($3, city),
              raw_address = COALESCE($4, raw_address)
        WHERE id = $1`,
      [venueId, input.name ?? null, input.city ?? null, input.rawAddress ?? null],
    );
  });
}

/**
 * Bind an event's ONE venue (`events.venue_id`) — the missing half for drafts created before the
 * binding existed, which have `venue_id = NULL` and therefore no venue details to edit.
 *
 * Draft-only: once submitted, buyers may already be reading the venue. The cascade moves every
 * existing showtime WITH the event, but only while none of them has sold/held tickets or a
 * generated seat map — those are bound to the OLD venue's layout and would silently lie.
 */
export async function bindEventVenue(
  eventId: number,
  venueId: number,
  db: Db = pool,
): Promise<void> {
  return withTransaction(async (client) => {
    const { rows: ev } = await client.query<{ status: string }>(
      `SELECT status FROM events WHERE id = $1 FOR UPDATE`,
      [eventId],
    );
    if (!ev[0]) throw err.notFound("not_found", "Không tìm thấy sự kiện.");
    if (ev[0].status !== "draft") {
      throw err.conflict("event_not_draft", "Chỉ sự kiện bản nháp mới được gán lại địa điểm.");
    }

    const { rows: v } = await client.query<{ created_by: number }>(
      `SELECT created_by FROM venues WHERE id = $1`,
      [venueId],
    );
    if (!v[0]) throw err.badRequest("validation_failed", "Địa điểm không tồn tại.");

    const { rows: inv } = await client.query<{
      sold: number;
      held: number;
      with_map: number;
    }>(
      `SELECT
         COALESCE(SUM(tt.sold_quantity), 0)::int AS sold,
         COALESCE(SUM(tt.reserved_quantity), 0)::int AS held,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM showtime_seats ss WHERE ss.showtime_id = s.id
         ))::int AS with_map
       FROM showtimes s
       LEFT JOIN ticket_tiers tt ON tt.showtime_id = s.id
       WHERE s.event_id = $1`,
      [eventId],
    );

    if ((inv[0]?.sold ?? 0) > 0 || (inv[0]?.held ?? 0) > 0) {
      throw err.conflict(
        "showtime_has_sales",
        "Sự kiện đã có vé bán hoặc đang giữ — không thể gán lại địa điểm.",
      );
    }
    if ((inv[0]?.with_map ?? 0) > 0) {
      throw err.conflict(
        "seat_map_locks_venue",
        "Có suất chiếu đã áp dụng sơ đồ ghế lấy từ địa điểm cũ. Hãy xoá suất đó trước khi gán địa điểm khác.",
      );
    }

    await client.query(`UPDATE events SET venue_id = $1 WHERE id = $2`, [venueId, eventId]);
    // The cascade: existing showtimes move WITH the event.
    await client.query(`UPDATE showtimes SET venue_id = $1 WHERE event_id = $2`, [
      venueId,
      eventId,
    ]);
  });
}

export async function addShowtimeWithTiers(
  actorUserId: number,
  eventId: number,
  input: {
    venueId: number;
    startsAt: string;
    tiers: {
      label: string;
      price: number;
      totalQuantity?: number | null;
      /** Seated only: the chart class this tier prices, the durable half of the category↔price join. */
      categoryId?: number | null;
    }[];
  },
): Promise<{ id: number; returnedToReview: boolean }> {
  if (input.tiers.length < 1 || input.tiers.length > MAX_TIERS_PER_SHOWTIME) {
    throw err.badRequest(
      "tier_limit_reached",
      `Mỗi suất cần từ 1 đến ${MAX_TIERS_PER_SHOWTIME} hạng vé.`,
    );
  }
  return withTransaction(async (client) => {
    await lockEditableEvent(client, eventId);
    if (!Number.isFinite(Date.parse(input.startsAt)) || Date.parse(input.startsAt) <= Date.now()) {
      throw err.badRequest("showtime_in_past", "Ngày và giờ diễn phải ở tương lai.");
    }
    // A SEATED showtime's capacity is the seat map, so its tiers carry NULL capacity — the schema
    // says so ("NULL for seated") and UC-26 A4 refuses manual capacity there. Defaulting every tier
    // to 100 wrote a phantom ceiling onto seated tiers, which then capped the map at 100 through the
    // `sold + reserved <= total_quantity` CHECK regardless of how many seats were drawn (006 FR-005).
    //
    // THE VENUE IS NOT A CHOICE EITHER. An event is bound to ONE venue (`events.venue_id`, 0039) —
    // the one collected when the event was created. A mismatching venueId is refused, not silently
    // re-pointed; a still-NULL event (legacy rows) PINS on this first showtime.
    const { rows: ev } = await client.query<{
      event_type: "general_admission" | "seated";
      venue_id: number | null;
    }>(`SELECT event_type, venue_id FROM events WHERE id = $1`, [eventId]);
    if (!ev[0]) throw err.notFound("event_not_found", "Không tìm thấy sự kiện.");
    const seated = ev[0].event_type === "seated";
    if (ev[0].venue_id !== null && ev[0].venue_id !== input.venueId) {
      throw err.conflict(
        "venue_mismatch",
        "Sự kiện chỉ tổ chức tại địa điểm đã đăng ký — không thể thêm suất ở địa điểm khác.",
      );
    }

    const st = (
      await client.query(
        `INSERT INTO showtimes (event_id, venue_id, starts_at, status) VALUES ($1, $2, $3, 'on_sale') RETURNING id`,
        [eventId, input.venueId, input.startsAt],
      )
    ).rows[0].id;

    // The event's first showtime fixes its venue — the server-side half of "never ask again".
    if (ev[0].venue_id === null) {
      await client.query(`UPDATE events SET venue_id = $1 WHERE id = $2`, [input.venueId, eventId]);
    }

    for (const t of input.tiers) {
      await client.query(
        `INSERT INTO ticket_tiers (showtime_id, label, price_amount, total_quantity, category_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [st, t.label, t.price, seated ? null : (t.totalQuantity ?? 100), t.categoryId ?? null],
      );
    }
    const { returnedToReview } = await applyOrganizerEdit(client, eventId, actorUserId, [
      "showtime.created",
    ]);
    return { id: st, returnedToReview };
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

/**
 * Create a section in ONE NAMED layout, never in whichever the venue happens to own first.
 *
 * `defaultLayoutId` used to pick the target here — the venue's oldest chart — while the picker that
 * fed this call listed sections from EVERY chart at the venue (`listSections` joins on `venue_id`).
 * A venue with two charts could therefore have a section created in chart A and, on the next call,
 * seats written into A that named a section belonging to B: `seats.layout_id` and `seats.section_id`
 * are independent foreign keys, so nothing in the database refused it.
 */
/**
 * Which chart a quick-tool write lands in, with the ambiguous case refused rather than guessed.
 *
 * `defaultLayoutId` — the venue's oldest chart — is kept only for the one case where it cannot be
 * wrong: a venue with no chart at all, or exactly one. The moment a venue owns two, "the oldest"
 * stops being an answer and starts being a coin toss, which is the half of finding 1 that lived on
 * this path after the apply endpoint stopped guessing. The console always names its chart; this is
 * for older callers and for the venue-level helper paths the test suite is built on.
 */
async function resolveTargetLayout(
  venueId: number,
  layoutId: number | undefined,
  db: Db = pool,
): Promise<number> {
  if (layoutId !== undefined) {
    await assertLayoutInVenue(layoutId, venueId, db);
    return layoutId;
  }
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM venue_layouts WHERE venue_id = $1`,
    [venueId],
  );
  if (Number(rows[0].n) > 1)
    throw err.badRequest(
      "validation_failed",
      "Địa điểm này có nhiều sơ đồ — hãy nêu rõ sơ đồ cần thêm vào.",
    );
  return defaultLayoutId(venueId, db);
}

/**
 * The rows changed outside the document, so the document no longer describes the chart — and a
 * published chart no longer matches what was published.
 *
 * `geometryWritten` is the pattern the other server-owned writers already use (`tables.ts`,
 * `standing.ts`): the next read adopts a fresh document from the rows instead of showing one that
 * omits the seats just added. Without it the editor opened on a chart missing them, and the next
 * document save wrote that stale picture back — archiving the quick-added rows.
 *
 * The demotion is the other half. `saveLayout` returns a `ready` chart to `draft` because a chart
 * that changed is not the chart that was published; adding seats through this path changed it just
 * as much, and leaving it `ready` let an unrepublished chart be bound to a showtime.
 *
 * Gated on a revision EXISTING, which is what separates "was published" from "was born ready".
 * `defaultLayoutId` mints the venue's first chart as `ready` so the venue-level helper paths can
 * generate a map without a publish step — demoting that one turns every such path into
 * `layout_not_published`. A chart nobody ever published has no published version to fall out of.
 */
async function quickToolWroteRows(layoutId: number, db: Db = pool): Promise<void> {
  await db.query(`UPDATE venue_layouts SET document = NULL WHERE id = $1`, [layoutId]);
  await db.query(
    `UPDATE venue_layouts SET status = 'draft', updated_at = now()
      WHERE id = $1 AND status = 'ready'
        AND EXISTS (SELECT 1 FROM layout_revisions r WHERE r.layout_id = $1)`,
    [layoutId],
  );
}

/** The layout exists and belongs to this venue — the precondition both quick-tool writes share. */
async function assertLayoutInVenue(
  layoutId: number,
  venueId: number,
  db: Db = pool,
): Promise<void> {
  const { rows } = await db.query(`SELECT 1 FROM venue_layouts WHERE id = $1 AND venue_id = $2`, [
    layoutId,
    venueId,
  ]);
  if (rows.length === 0)
    throw err.badRequest("validation_failed", "Sơ đồ không thuộc địa điểm này.");
}

export async function createSection(
  venueId: number,
  layoutId: number | undefined,
  name: string,
  db: Db = pool,
): Promise<number> {
  const target = await resolveTargetLayout(venueId, layoutId, db);
  const { rows } = await db.query(
    // Default the colour by position: FR-066 blocks publishing without one, and this path predates
    // the colour picker, so a section created here must not be born unpublishable. The ARRAY is
    // built from the SHARED palette — the same constant the editor and buyer legend read — so the
    // database and the chart can never hand out different defaults (Principle VI).
    `INSERT INTO sections (layout_id, name, color)
     VALUES ($1, $2, (ARRAY[${CATEGORY_COLORS.map((c) => `'${c}'`).join(",")}])[(SELECT count(*) FROM sections WHERE layout_id = $1)::int % ${CATEGORY_COLORS.length} + 1])
     RETURNING id`,
    [target, name],
  );
  return rows[0].id;
}

/** Bulk-add seats to a section: rowLabel-1 .. rowLabel-count. Returns how many were created.
 *  Seeds each seat a grid position — geometry is required, and the grid is what buyers already see. */
export async function addSeats(
  venueId: number,
  layoutId: number | undefined,
  sectionId: number,
  rowLabel: string,
  count: number,
  db: Db = pool,
): Promise<number> {
  const target = await resolveTargetLayout(venueId, layoutId, db);
  // The section must belong to the layout being written, or the row lands with a `section_id` from
  // one chart and a `layout_id` from another — the cross-chart state nothing else would refuse.
  const { rows: owned } = await db.query(
    `SELECT 1 FROM sections WHERE id = $1 AND layout_id = $2`,
    [sectionId, target],
  );
  if (owned.length === 0)
    throw err.badRequest("validation_failed", "Khu vực không thuộc sơ đồ đang chọn.");
  const { rows: prior } = await db.query<{ max_y: number | null }>(
    `SELECT max(pos_y) AS max_y FROM seats WHERE layout_id = $1`,
    [target],
  );
  // Both ceilings read LAYOUT_SPACE rather than a literal: a hard-coded 10000 here would go on
  // clamping generated seats to the OLD edge of the map after the space was widened, so the setting
  // would appear to take effect everywhere except the rows this path creates.
  const y = Math.min(LAYOUT_SPACE, (prior[0].max_y ?? 1050) + 150);
  const startX = Math.max(0, Math.round(LAYOUT_SPACE / 2 - ((count - 1) * 150) / 2));
  const res = await db.query(
    `INSERT INTO seats (layout_id, section_id, category_id, row_label, seat_number, pos_x, pos_y)
     SELECT $1, $2, $7, $3, gs, LEAST($8::int, $4::int + (gs - 1) * 150), $5 FROM generate_series(1, $6) AS gs
     ON CONFLICT (section_id, row_label, seat_number) DO NOTHING`,
    [
      target,
      sectionId,
      rowLabel,
      startX,
      y,
      count,
      await defaultCategoryId(target, db),
      LAYOUT_SPACE,
    ],
  );
  await quickToolWroteRows(target, db);
  // What was CREATED, not what was asked for: re-adding an existing row conflicts and is skipped,
  // and the organizer should hear the real number rather than the requested one.
  return res.rowCount ?? 0;
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
  return (
    (await db.query(`SELECT 1 FROM showtime_seats WHERE seat_id = $1 LIMIT 1`, [seatId])).rows
      .length > 0
  );
}

export async function deleteSeat(seatId: number, db: Db = pool): Promise<void> {
  await db.query(`DELETE FROM seats WHERE id = $1`, [seatId]);
}

export interface ShowtimeInfo {
  venueId: number;
  eventType: "general_admission" | "seated";
  ownerUserId: number;
}
export async function showtimeInfo(
  showtimeId: number,
  db: Db = pool,
): Promise<ShowtimeInfo | null> {
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
         -- Archived seats have left the chart, so they must not be counted in what the organizer
         -- is shown as the section's size (§18, §42 Rule 7).
         LEFT JOIN seats se ON se.section_id = s.id AND se.archived_at IS NULL
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
      `SELECT s.id, s.status, s.starts_at AS "startsAt", s.venue_id AS "venueId", v.name AS "venueName",
              -- APPLIED means inventory exists, and a capacity ZONE is inventory with no seat rows:
              -- it becomes its tier quantity instead. Reading showtime_seats alone made a
              -- standing-only chart report "chua ap dung" forever, however many times it was applied.
              -- Quantity AND a class together is the zone signature: manual capacity is refused on a
              -- seated showtime, and strayQuantityTiers refuses a quantity with no class.
              (EXISTS (SELECT 1 FROM showtime_seats ss WHERE ss.showtime_id = s.id)
                OR EXISTS (SELECT 1 FROM ticket_tiers tt
                            WHERE tt.showtime_id = s.id AND tt.archived_at IS NULL
                              AND tt.category_id IS NOT NULL
                              AND tt.total_quantity IS NOT NULL)) AS "hasSeatMap",
              (SELECT count(*)::int FROM showtime_seats ss JOIN ticket_tiers tt ON tt.id = ss.ticket_tier_id
                 WHERE ss.showtime_id = s.id AND ss.status <> 'blocked' AND tt.archived_at IS NULL) AS "bookableSeats",
              -- Reported beside the seat count rather than folded into it: a chart may hold both, and
              -- "5000 ghế" about a standing floor is a different lie from the one just fixed.
              COALESCE((SELECT sum(tt.total_quantity)::int FROM ticket_tiers tt
                         WHERE tt.showtime_id = s.id AND tt.archived_at IS NULL
                           AND tt.category_id IS NOT NULL
                           AND tt.total_quantity IS NOT NULL), 0) AS "zoneCapacity"
         FROM showtimes s JOIN venues v ON v.id = s.venue_id WHERE s.event_id = $1 ORDER BY s.starts_at`,
      [eventId],
    )
  ).rows as {
    id: number;
    startsAt: string;
    venueId: number;
    venueName: string;
    hasSeatMap: boolean;
    bookableSeats: number;
    zoneCapacity: number;
    tiers?: unknown;
    sections?: unknown;
    layoutId?: number | null;
    layoutStatus?: string | null;
    assignableLayouts?: {
      id: number;
      name: string;
      seatCount: number;
      categories: {
        id: number;
        name: string;
        color: string;
        seatCount: number;
        hasInventory: boolean;
      }[];
    }[];
    categories?: unknown;
  }[];
  for (const st of showtimes) {
    // Deliberately the OPPOSITE of the buyer reads: archived tiers stay visible here, flagged, with
    // their live inventory. "Hidden from buyers" and "hidden from everyone" are different rules, and
    // conflating them would make restore unreachable from the console (006 FR-006, FR-009).
    st.tiers = (
      await db.query(
        `SELECT id, label, price_amount::int AS price, total_quantity AS capacity,
                sold_quantity AS sold, reserved_quantity AS held, category_id AS "categoryId",
                (archived_at IS NOT NULL) AS archived
           FROM ticket_tiers WHERE showtime_id = $1
          ORDER BY archived_at NULLS FIRST, price_amount`,
        [st.id],
      )
    ).rows;
    st.sections = await listSections(st.venueId, db);

    // The chart this showtime would bind to, and its price classes. An already-generated showtime
    // keeps the layout it was generated from; one that has not generated yet defaults to the venue's.
    const { rows: chart } = await db.query<{ id: number; status: string }>(
      `SELECT l.id, l.status FROM venue_layouts l
        WHERE l.id = COALESCE(
                (SELECT layout_id FROM showtimes WHERE id = $1),
                -- The fallback is a DISPLAY default only — the apply endpoint now requires the
                -- caller to name its chart. It still excludes archived charts and templates, so the
                -- screen never opens on a chart the organizer would be refused for choosing.
                --
                -- READY first (0035 finding 3). Ordering by age alone meant a venue whose oldest
                -- chart was a draft opened on that draft, and the console hides the whole picker when
                -- the displayed chart is not ready — so a perfectly good published chart beside it was
                -- unreachable. This makes the display default agree with assignableLayouts, which
                -- has always required status = ready, whenever such a chart exists at all.
                (SELECT id FROM venue_layouts
                  WHERE venue_id = $2 AND status <> 'archived' AND is_template = false
                  ORDER BY (status = 'ready') DESC, created_at LIMIT 1))`,
      [st.id, st.venueId],
    );
    st.layoutId = chart[0]?.id ?? null;
    st.layoutStatus = chart[0]?.status ?? null;
    /*
     * Every chart this showtime may actually be bound to.
     *
     * The organizer picks one explicitly now, so the screen has to offer the real set rather than
     * let the server guess: published, not archived, not a template. A showtime already generated
     * keeps its own chart and is not re-bound, so the list is only meaningful before that.
     */
    const assignable = (
      await db.query<{ id: number; name: string; seat_count: string }>(
        `SELECT l.id, l.name,
                (SELECT count(*) FROM seats s WHERE s.layout_id = l.id AND s.archived_at IS NULL)
                  AS seat_count
           FROM venue_layouts l
          WHERE l.venue_id = $1 AND l.status = 'ready' AND l.is_template = false
          ORDER BY l.created_at`,
        [st.venueId],
      )
    ).rows;
    /*
     * Each entry carries its OWN price classes (0035 finding 3).
     *
     * The picker used to change nothing but an id while the pricing controls below it kept reading
     * `st.categories`, which is computed from the display-default chart. Choosing chart B therefore
     * showed chart A's classes, and submitting B with A's class ids was refused by the apply boundary
     * — a dead end reachable purely by using the picker as intended.
     */
    st.assignableLayouts = await Promise.all(
      assignable.map(async (r) => ({
        id: r.id,
        name: r.name,
        seatCount: Number(r.seat_count),
        categories: await layoutCategories(r.id, db),
      })),
    );
    /*
     * Which classes actually hold inventory — the SAME answer `generate-seat-map` gates on.
     *
     * `seatCount` alone cannot be that answer: a class drawn as a capacity ZONE has no seats, so it
     * reads as empty here while `categoriesWithInventory` (seats UNION zones) still demands a price
     * for it. The console then showed the chart ready to apply and the apply refused
     * `category_without_tier`. One predicate, computed once on the server, rather than two that
     * drift (Principle VI).
     */
    st.categories = chart[0]
      ? (st.assignableLayouts.find((l) => l.id === chart[0].id)?.categories ??
        (await layoutCategories(chart[0].id, db)))
      : [];
  }
  return showtimes;
}

/**
 * One chart's price classes, with the inventory predicate the apply gate actually uses.
 *
 * Reached from `assignableLayouts` for every selectable chart and from `st.categories` for the one on
 * display, so the picker and the pricing controls beneath it can never describe different charts.
 */
async function layoutCategories(
  layoutId: number,
  db: Db,
): Promise<
  { id: number; name: string; color: string; seatCount: number; hasInventory: boolean }[]
> {
  const stocked = new Set(await categoriesWithInventory(layoutId, db));
  const { rows } = await db.query<{
    id: number;
    name: string;
    color: string;
    seatCount: number;
  }>(
    `SELECT c.id, c.name, c.color,
            -- Without archived_at IS NULL a class whose seats have all left the chart still reports
            -- inventory, and the seat map builder then requires a price for a class that can sell
            -- nothing before it will apply the chart.
            (SELECT count(*)::int FROM seats s
              WHERE s.category_id = c.id AND s.archived_at IS NULL) AS "seatCount"
       FROM layout_categories c WHERE c.layout_id = $1 ORDER BY c.name`,
    [layoutId],
  );
  return rows.map((c) => ({ ...c, hasInventory: stocked.has(c.id) }));
}

/** Categories this showtime has put a price on — the event half of the category↔price join. */
export async function pricedCategories(showtimeId: number, db: Db = pool): Promise<number[]> {
  const { rows } = await db.query<{ category_id: number }>(
    `SELECT DISTINCT category_id FROM ticket_tiers
      WHERE showtime_id = $1 AND archived_at IS NULL AND category_id IS NOT NULL`,
    [showtimeId],
  );
  return rows.map((r) => r.category_id);
}

/**
 * Count-BACKED tiers of this showtime that name no price class — the GA leftover SC-026 forbids
 * on a seated event.
 *
 * A class-less tier with `total_quantity NULL` on a seated showtime is inert: seats carry their own
 * tier, so nothing ever points at it and it cannot be bought. But one WITH a quantity sells by head
 * count on a showtime whose inventory is otherwise seats — the mixed shape feature 003's reservation
 * invariant depends on never existing. Generation refuses naming it, rather than minting a seated
 * map with a standing counter beside it.
 */
export async function strayQuantityTiers(
  showtimeId: number,
  db: Db = pool,
): Promise<{ id: number; label: string }[]> {
  const { rows } = await db.query<{ id: number; label: string }>(
    `SELECT id, label FROM ticket_tiers
      WHERE showtime_id = $1 AND archived_at IS NULL AND category_id IS NULL
        AND total_quantity IS NOT NULL`,
    [showtimeId],
  );
  return rows;
}

export async function showtimeHasSeatMap(showtimeId: number, db: Db = pool): Promise<boolean> {
  return (
    (await db.query(`SELECT 1 FROM showtime_seats WHERE showtime_id = $1 LIMIT 1`, [showtimeId]))
      .rows.length > 0
  );
}

/**
 * Generate the seated seat map: one showtime_seat per physical seat, priced by its CATEGORY (R-7).
 *
 * The category→tier mapping is no longer an argument. It lives on `ticket_tiers.category_id`, so it
 * is a durable property of the showtime rather than something re-typed at every generation and then
 * discarded — which is what lets one chart back many showtimes at many prices (FR-005).
 *
 * Feature 005: this SNAPSHOTS the layout onto the showtime. Each seat's geometry AND its identity —
 * row, number, section, category — is copied onto its `showtime_seats` row, and the layout's
 * decoration and background are frozen into `showtimes.layout_snapshot`. From here the showtime owns
 * its map; a later layout edit reaches it only through an explicit, previewed re-apply.
 */
/**
 * `reuse` lets a CALLER own the transaction.
 *
 * Applying a chart is not one write: it maps every price class onto a tier, then generates, then
 * snapshots, then records the moderation consequence. Those ran as separate requests, so a failure
 * anywhere past the first left tier bindings committed against a showtime with no map — state the
 * organizer could not see and had to re-enter by hand. Passing the client in lets the whole sequence
 * commit or roll back together.
 */
export async function generateSeatMap(
  showtimeId: number,
  layoutId: number,
  reuse?: pg.PoolClient,
): Promise<number> {
  const run = async (client: pg.PoolClient) => {
    const { rows: tiers } = await client.query<{ id: number; category_id: number }>(
      `SELECT id, category_id FROM ticket_tiers
        WHERE showtime_id = $1 AND archived_at IS NULL AND category_id IS NOT NULL`,
      [showtimeId],
    );

    let total = 0;
    for (const tier of tiers) {
      const res = await client.query(
        `INSERT INTO showtime_seats (showtime_id, seat_id, ticket_tier_id, status,
                                     pos_x, pos_y, rotation, row_label, seat_number, section_name,
                                     category_name, is_accessible, table_id, table_booking_mode)
         SELECT $1, s.id, $2, 'available', s.pos_x, s.pos_y, s.rotation, s.row_label, s.seat_number,
                (SELECT sec.name FROM sections sec WHERE sec.id = s.section_id),
                (SELECT c.name FROM layout_categories c WHERE c.id = s.category_id),
                s.is_accessible, s.table_id,
                (SELECT t.booking_mode FROM layout_tables t WHERE t.id = s.table_id)
           -- The invariant archiving rests on: a seat kept only because an EARLIER showtime sold it
           -- must not become bookable inventory on the next one bound to this chart.
           FROM seats s
          WHERE s.layout_id = $3 AND s.category_id = $4 AND s.archived_at IS NULL`,
        [showtimeId, tier.id, layoutId, tier.category_id],
      );
      total += res.rowCount ?? 0;
    }

    /*
     * Companion links (0036): copied from `seats` onto the showtime's own rows, through the shared
     * sync the re-apply path uses. Run AFTER every tier's INSERTs — a pair straddles two physical
     * seats, so both halves of every link must already exist as `showtime_seats` rows before either
     * end can resolve its partner.
     */
    await syncCompanionLinks(showtimeId, layoutId, client);

    /*
     * Capacity zones (0027): a zone sells by COUNT, so its capacity becomes its tier's quantity
     * instead of becoming seat rows.
     *
     * Written per class by summing every zone that names it, because one price class may be drawn as
     * several zones (two standing wings at the same price). The guard is the one that matters: a
     * regeneration must never set a quantity below what is already sold or held, or the CHECK on
     * `ticket_tiers` would reject it — and if it did not, the showtime would have oversold.
     * `GREATEST` is deliberately NOT used to paper over that; the refusal is explicit and names the
     * class, because silently keeping the old capacity would leave the organizer believing an edit
     * took effect.
     *
     * Computed by `zonePlan`, which the re-apply path also uses. It used to be a loop inlined here,
     * and inlining it is exactly why re-apply never wrote zone quantities at all (0035 finding 1):
     * the only code that knew a zone was inventory lived on the generation path.
     */
    const zones = await zonePlan(showtimeId, layoutId, client);
    const blocked = zones.filter((z) => z.blocked);
    if (blocked.length > 0) {
      const z = blocked[0];
      throw err.conflict(
        "zone_capacity_below_sold",
        `Khu "${z.categoryName}" chỉ còn ${z.to} chỗ nhưng đã bán hoặc giữ ${z.taken}.`,
      );
    }
    total += await writeZonePlan(showtimeId, zones, client);

    // One snapshot writer, not two. This used to inline its own `jsonb_build_object` that omitted
    // `points`, `tables` and `sectionStyles`, so a freshly generated map rendered without its
    // polygons, tables and per-section styling until someone happened to run a re-apply.
    await refreshSnapshot(showtimeId, layoutId, client);
    return total;
  };
  return reuse ? run(reuse) : withTransaction(run);
}

/**
 * Category ids of a layout that hold INVENTORY — each must be priced before generation.
 *
 * Both kinds of inventory, and that second half was missing. A capacity zone (0027) carries its class on
 * `layout_elements.category_id` and produces no `seats` rows at all, so a class living only on a zone was
 * invisible to this query: it passed the unpriced-class gate, and the generator then found no tier for it
 * and skipped it. The showtime came back 201 with the standing floor silently absent — on exactly the
 * arena-with-a-floor shape zones were added for.
 */
export interface ChartMapping {
  categoryId: number;
  tierId: number;
}

/**
 * Bind a chart to a showtime — price every class, generate, snapshot, record the moderation
 * consequence — as ONE transaction.
 *
 * This replaces a client-side sequence: a `PATCH` per tier, then a separate generate call. Four
 * things were wrong with it and only a transaction fixes them together.
 *
 *   * A failure after the first PATCH left tier bindings committed against a showtime with no map.
 *     Nothing on screen showed it, and a retry after reload asked for every choice again.
 *   * `ticket_tiers.category_id` holds ONE class, so the same tier chosen for two classes silently
 *     kept the last write. Nothing refused it, because each PATCH was legal on its own.
 *   * Binding a tier's class is a MATERIAL edit: an approved event returns to `pending_review`. The
 *     old flow discarded that answer and reported "ghế đã sẵn sàng để bán" over an event that had
 *     just left sale.
 *   * Nothing held the showtime, so its map could appear between the checks and the generate.
 *
 * The showtime row is locked first, so every refusal below names numbers that are still true at
 * commit.
 */
export async function applyChart(
  actorUserId: number,
  showtimeId: number,
  layoutId: number,
  mappings: readonly ChartMapping[],
): Promise<{ seats: number; zoneCapacity: number; returnedToReview: boolean }> {
  return withTransaction(async (client) => {
    const { rows: st } = await client.query<{ event_id: number; venue_id: number }>(
      `SELECT event_id, venue_id FROM showtimes WHERE id = $1 FOR UPDATE`,
      [showtimeId],
    );
    if (!st[0]) throw err.notFound("not_found", "Không tìm thấy suất chiếu.");

    if (await showtimeHasSeatMap(showtimeId, client))
      throw err.conflict(
        "map_edit_refused",
        "Suất này đã có sơ đồ ghế. Hãy chỉnh sửa sơ đồ hiện có hoặc áp dụng lại bố cục nguồn.",
      );

    const binding = await layoutBinding(layoutId, client);
    if (!binding) throw err.notFound("not_found", "Không tìm thấy sơ đồ.");
    if (binding.venueId !== st[0].venue_id)
      throw err.badRequest("validation_failed", "Sơ đồ không thuộc địa điểm của suất chiếu này.");
    if (binding.isTemplate)
      throw err.badRequest("validation_failed", "Không thể áp dụng một sơ đồ mẫu cho suất chiếu.");
    if (binding.status !== "ready")
      throw err.conflict(
        "layout_not_published",
        "Sơ đồ chưa được phát hành. Hãy phát hành sơ đồ trước khi tạo bản đồ ghế.",
      );

    // Duplicates refused BEFORE any write: a tier holds one class, so the same tier named twice
    // would keep whichever mapping happened to be applied last and drop the other without a word.
    const tierIds = new Set<number>();
    for (const m of mappings) {
      if (tierIds.has(m.tierId))
        throw err.badRequest(
          "duplicate_tier_mapping",
          "Mỗi hạng vé chỉ được gán cho một hạng ghế.",
        );
      tierIds.add(m.tierId);
    }

    if (mappings.length > 0) {
      const { rows: live } = await client.query<{ id: number }>(
        `SELECT id FROM ticket_tiers
          WHERE showtime_id = $1 AND archived_at IS NULL AND id = ANY($2::bigint[])`,
        [showtimeId, [...tierIds]],
      );
      if (live.length !== tierIds.size)
        throw err.badRequest(
          "validation_failed",
          "Có hạng vé không thuộc suất chiếu này hoặc đã lưu trữ.",
        );

      // A class must belong to the chart being applied — otherwise the tier would price inventory
      // from a chart this showtime is not binding.
      const categoryIds = [...new Set(mappings.map((m) => m.categoryId))];
      const { rows: own } = await client.query<{ id: number }>(
        `SELECT id FROM layout_categories WHERE layout_id = $1 AND id = ANY($2::bigint[])`,
        [layoutId, categoryIds],
      );
      if (own.length !== categoryIds.length)
        throw err.badRequest("validation_failed", "Có hạng ghế không thuộc sơ đồ đang áp dụng.");

      for (const m of mappings) {
        await client.query(`UPDATE ticket_tiers SET category_id = $2 WHERE id = $1`, [
          m.tierId,
          m.categoryId,
        ]);
      }
    }

    // Seats AND capacity zones, the one predicate the whole flow gates on.
    const priced = new Set(await pricedCategories(showtimeId, client));
    const unpriced = (await categoriesWithInventory(layoutId, client)).filter(
      (c) => !priced.has(c),
    );
    if (unpriced.length > 0)
      throw err.badRequest("category_without_tier", "Mỗi hạng vé có ghế phải được gán một giá vé.");

    const stray = await strayQuantityTiers(showtimeId, client);
    if (stray.length > 0)
      throw err.badRequest(
        "seated_tier_without_category",
        `Hạng vé "${stray.map((t) => t.label).join('", "')}" đặt số lượng nhưng chưa gán hạng ghế của sơ đồ.`,
      );

    const seats = await generateSeatMap(showtimeId, layoutId, client);
    /*
     * Seats alone under-reports what was generated.
     *
     * A capacity ZONE becomes its tier's quantity rather than seat rows, so a standing-only chart
     * came back "0 ghế" from a call that had just created five thousand places. Both totals are
     * returned, and the console shows them side by side rather than summing two different units.
     */
    const { rows: zones } = await client.query<{ total: number | null }>(
      `SELECT sum(total_quantity)::int AS total FROM ticket_tiers
        WHERE showtime_id = $1 AND archived_at IS NULL
          AND category_id IS NOT NULL AND total_quantity IS NOT NULL`,
      [showtimeId],
    );
    const { returnedToReview } = await applyOrganizerEdit(
      client,
      st[0].event_id,
      actorUserId,
      mappings.length > 0 ? ["tier.category"] : [],
    );
    return { seats, zoneCapacity: Number(zones[0]?.total ?? 0), returnedToReview };
  });
}

export async function categoriesWithInventory(layoutId: number, db: Db = pool): Promise<number[]> {
  const { rows } = await db.query<{ category_id: number }>(
    // Archived seats are not inventory, so a class holding nothing but archived ones must not
    // report itself as stocked — this answer gates validation and publish.
    `SELECT DISTINCT category_id FROM seats
       WHERE layout_id = $1 AND category_id IS NOT NULL AND archived_at IS NULL
     UNION
     SELECT DISTINCT category_id FROM layout_elements
       WHERE layout_id = $1 AND kind = 'area' AND capacity IS NOT NULL AND category_id IS NOT NULL`,
    [layoutId],
  );
  return rows.map((r) => r.category_id);
}

/** The layout's venue and publish status, for the two checks generation makes before binding. */
export async function layoutBinding(
  layoutId: number,
  db: Db = pool,
): Promise<{ venueId: number; status: string; isTemplate: boolean } | null> {
  const { rows } = await db.query<{ venue_id: number; status: string; is_template: boolean }>(
    `SELECT venue_id, status, is_template FROM venue_layouts WHERE id = $1`,
    [layoutId],
  );
  return rows[0]
    ? { venueId: rows[0].venue_id, status: rows[0].status, isTemplate: rows[0].is_template }
    : null;
}
