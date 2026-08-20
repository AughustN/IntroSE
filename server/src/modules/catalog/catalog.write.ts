import type { Db } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { generateUniqueSlug } from "./slug.js";
import { queueEventNotification } from "../notifications/notifications.service.js";
import { refreshSnapshot } from "../seatmap/apply.js";
import { defaultCategoryId } from "../seatmap/layouts.repo.js";
import { err } from "../../http.js";

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

export async function listMyEvents(userId: number, db: Db = pool) {
  const { rows } = await db.query(
    `SELECT e.id, e.slug, e.title, e.description, e.status, e.moderation_status AS moderation, e.review_note AS "reviewNote",
            e.image_url AS "imageUrl", e.event_type AS "eventType", ec.code AS category,
            COALESCE(e.is_high_demand, false) AS "isHighDemand",
            COALESCE(e.is_high_demand, false) AS is_high_demand,
            e.created_at AS "createdAt", e.updated_at AS "updatedAt",
            COALESCE((
              SELECT SUM(tt.total_quantity)
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
            ), 0)::bigint AS "totalRevenueVnd"
       FROM events e 
       JOIN organizers o ON o.id = e.organizer_id 
       JOIN event_categories ec ON ec.id = e.category_id
      WHERE o.user_id = $1 
      ORDER BY e.created_at DESC`,
    [userId],
  );

  for (const event of rows) {
    const tierRes = await db.query(
      `SELECT tt.id::text, tt.label, tt.price_amount AS price, tt.total_quantity AS capacity,
              COALESCE(COUNT(t.id), 0)::int AS "soldCount"
         FROM showtimes s
         JOIN ticket_tiers tt ON tt.showtime_id = s.id
         LEFT JOIN reservation_items ri ON ri.ticket_tier_id = tt.id
         LEFT JOIN tickets t ON t.reservation_item_id = ri.id AND t.qr_status != 'void'
         LEFT JOIN orders o ON o.id = t.order_id AND o.payment_status IN ('paid', 'completed')
        WHERE s.event_id = $1
        GROUP BY tt.id, tt.label, tt.price_amount, tt.total_quantity`,
      [event.id],
    );
    event.ticketTiers = tierRes.rows.map((r) => ({
      id: String(r.id),
      label: String(r.label),
      price: Number(r.price || 0),
      capacity: Number(r.capacity || 0),
      soldCount: Number(r.soldCount || 0),
      remaining: Math.max(0, Number(r.capacity || 0) - Number(r.soldCount || 0)),
      isArchived: false,
    }));
  }

  return rows;
}

/** Update editable fields; a material edit of an APPROVED event returns it to pending_review (D-C). Slug is never changed. */
export async function updateEvent(
  eventId: number,
  f: {
    title?: string;
    description?: string;
    imageUrl?: string | null;
    refundPolicy?: string | null;
    isHighDemand?: boolean;
    is_high_demand?: boolean;
  },
  db: Db = pool,
) {
  const isHighDemandProvided = f.isHighDemand !== undefined || f.is_high_demand !== undefined;
  const isHighDemandValue = f.isHighDemand ?? f.is_high_demand ?? false;

  return withTransaction(async (client) => {
    const { rows } = await client.query<{
      id: number;
      slug: string;
      title: string;
      status: string;
      moderation: string;
      updated_at: Date;
    }>(
      `UPDATE events SET
          title = COALESCE($2, title),
          description = COALESCE($3, description),
          image_url = COALESCE($4, image_url),
          refund_policy = COALESCE($5, refund_policy),
          is_high_demand = CASE WHEN $6::boolean THEN $7::boolean ELSE is_high_demand END,
          moderation_status = CASE WHEN moderation_status = 'approved' THEN 'pending_review' ELSE moderation_status END,
          updated_at = now()
        WHERE id = $1
        RETURNING id, slug, title, status, moderation_status AS moderation, updated_at`,
      [
        eventId,
        f.title ?? null,
        f.description ?? null,
        f.imageUrl ?? null,
        f.refundPolicy ?? null,
        isHighDemandProvided,
        isHighDemandValue,
      ],
    );
    const event = rows[0];
    if (event) {
      await queueEventNotification(
        client,
        event.id,
        "event_changed",
        "Thông tin sự kiện đã thay đổi. Vui lòng mở TixHub để xem nội dung mới nhất.",
        event.updated_at.toISOString(),
      );
    }
    return event;
  });
}

/** Publish requires ≥1 upcoming showtime with ≥1 tier (FR-017); → on_sale + pending_review (D-C). */
export async function publishEvent(eventId: number, db: Db = pool): Promise<boolean> {
  const ready = await db.query(
    `SELECT 1 FROM showtimes s JOIN ticket_tiers tt ON tt.showtime_id = s.id WHERE s.event_id = $1 AND s.starts_at > now() LIMIT 1`,
    [eventId],
  );
  if (ready.rows.length === 0) return false;
  await db.query(
    `UPDATE events SET status = 'on_sale', moderation_status = 'pending_review', updated_at = now() WHERE id = $1`,
    [eventId],
  );
  return true;
}

export async function unpublishEvent(eventId: number, db: Db = pool): Promise<void> {
  await db.query(`UPDATE events SET status = 'draft', updated_at = now() WHERE id = $1`, [eventId]);
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
export async function finishEvent(eventId: number, db: Db = pool): Promise<void> {
  const { rows } = await db.query<{ status: string }>(
    `SELECT status FROM events WHERE id = $1`,
    [eventId],
  );
  if (!rows[0]) throw err.notFound('not_found', 'Không tìm thấy sự kiện.');
  if (rows[0].status === 'finished') return; // idempotent
  if (rows[0].status === 'cancelled') {
    throw err.conflict('already_cancelled', 'Sự kiện đã bị hủy, không thể hoàn tất.');
  }
  if (rows[0].status === 'draft') {
    throw err.conflict('not_published', 'Chỉ có thể hoàn tất sự kiện đang đăng bán.');
  }
  await db.query(
    `UPDATE events SET status = 'finished', updated_at = now() WHERE id = $1`,
    [eventId],
  );
  // Mark all future showtimes (if any remain) as finished too.
  await db.query(
    `UPDATE showtimes SET status = 'finished' WHERE event_id = $1 AND status NOT IN ('cancelled', 'finished')`,
    [eventId],
  );
}

// ---- venues (US5, minimal — needed for showtimes) ----

export async function createVenue(
  userId: number,
  v: { name: string; city: string; rawAddress: string; guide?: string | null },
  db: Db = pool,
): Promise<number> {
  const { rows } = await db.query(
    `INSERT INTO venues (created_by, name, city, raw_address, guide) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [userId, v.name, v.city, v.rawAddress, v.guide ?? null],
  );
  return rows[0].id;
}

export async function listMyVenues(userId: number, db: Db = pool) {
  return (
    await db.query(
      `SELECT id, name, city, raw_address AS "rawAddress", guide FROM venues WHERE created_by = $1 ORDER BY id DESC`,
      [userId],
    )
  ).rows;
}

export async function venueOwnerUserId(venueId: number, db: Db = pool): Promise<number | null> {
  const { rows } = await db.query(`SELECT created_by FROM venues WHERE id = $1`, [venueId]);
  return rows[0]?.created_by ?? null;
}

export async function addShowtimeWithTiers(
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
): Promise<number> {
  return withTransaction(async (client) => {
    // A SEATED showtime's capacity is the seat map, so its tiers carry NULL capacity — the schema
    // says so ("NULL for seated") and UC-26 A4 refuses manual capacity there. Defaulting every tier
    // to 100 wrote a phantom ceiling onto seated tiers, which then capped the map at 100 through the
    // `sold + reserved <= total_quantity` CHECK regardless of how many seats were drawn (006 FR-005).
    const { rows: ev } = await client.query<{ event_type: "general_admission" | "seated" }>(
      `SELECT event_type FROM events WHERE id = $1`,
      [eventId],
    );
    const seated = ev[0]?.event_type === "seated";

    const st = (
      await client.query(
        `INSERT INTO showtimes (event_id, venue_id, starts_at, status) VALUES ($1, $2, $3, 'on_sale') RETURNING id`,
        [eventId, input.venueId, input.startsAt],
      )
    ).rows[0].id;
    for (const t of input.tiers) {
      await client.query(
        `INSERT INTO ticket_tiers (showtime_id, label, price_amount, total_quantity, category_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [st, t.label, t.price, seated ? null : (t.totalQuantity ?? 100), t.categoryId ?? null],
      );
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
  const { rows } = await db.query(
    // Default the colour by position: FR-066 blocks publishing without one, and this path predates
    // the colour picker, so a section created here must not be born unpublishable.
    `INSERT INTO sections (layout_id, name, color)
     VALUES ($1, $2, (ARRAY['#4C9A6B','#3E7CB1','#C9762F','#9B4D8E','#B3453C'])[(SELECT count(*) FROM sections WHERE layout_id = $1)::int % 5 + 1])
     RETURNING id`,
    [layoutId, name],
  );
  return rows[0].id;
}

/** Bulk-add seats to a section: rowLabel-1 .. rowLabel-count. Returns how many were created.
 *  Seeds each seat a grid position — geometry is required, and the grid is what buyers already see. */
export async function addSeats(
  venueId: number,
  sectionId: number,
  rowLabel: string,
  count: number,
  db: Db = pool,
): Promise<number> {
  const layoutId = await defaultLayoutId(venueId, db);
  const { rows: prior } = await db.query<{ max_y: number | null }>(
    `SELECT max(pos_y) AS max_y FROM seats WHERE layout_id = $1`,
    [layoutId],
  );
  const y = Math.min(10000, (prior[0].max_y ?? 1050) + 150);
  const startX = Math.max(0, Math.round(5000 - ((count - 1) * 150) / 2));
  await db.query(
    `INSERT INTO seats (layout_id, section_id, category_id, row_label, seat_number, pos_x, pos_y)
     SELECT $1, $2, $7, $3, gs, LEAST(10000, $4::int + (gs - 1) * 150), $5 FROM generate_series(1, $6) AS gs
     ON CONFLICT (section_id, row_label, seat_number) DO NOTHING`,
    [layoutId, sectionId, rowLabel, startX, y, count, await defaultCategoryId(layoutId, db)],
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
              EXISTS (SELECT 1 FROM showtime_seats ss WHERE ss.showtime_id = s.id) AS "hasSeatMap",
              (SELECT count(*)::int FROM showtime_seats ss WHERE ss.showtime_id = s.id) AS "bookableSeats"
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
    tiers?: unknown;
    sections?: unknown;
    layoutId?: number | null;
    layoutStatus?: string | null;
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
        WHERE l.id = COALESCE((SELECT layout_id FROM showtimes WHERE id = $1),
                              (SELECT id FROM venue_layouts WHERE venue_id = $2 ORDER BY created_at LIMIT 1))`,
      [st.id, st.venueId],
    );
    st.layoutId = chart[0]?.id ?? null;
    st.layoutStatus = chart[0]?.status ?? null;
    st.categories = chart[0]
      ? (
          await db.query(
            `SELECT c.id, c.name, c.color,
                    (SELECT count(*)::int FROM seats s WHERE s.category_id = c.id) AS "seatCount"
               FROM layout_categories c WHERE c.layout_id = $1 ORDER BY c.name`,
            [chart[0].id],
          )
        ).rows
      : [];
  }
  return showtimes;
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
export async function generateSeatMap(showtimeId: number, layoutId: number): Promise<number> {
  return withTransaction(async (client) => {
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
           FROM seats s WHERE s.layout_id = $3 AND s.category_id = $4`,
        [showtimeId, tier.id, layoutId, tier.category_id],
      );
      total += res.rowCount ?? 0;
    }

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
     */
    const { rows: zones } = await client.query<{ category_id: number; capacity: string; name: string }>(
      `SELECT e.category_id, sum(e.capacity)::bigint AS capacity, c.name
         FROM layout_elements e
         JOIN layout_categories c ON c.id = e.category_id
        WHERE e.layout_id = $1 AND e.kind = 'area' AND e.capacity IS NOT NULL
        GROUP BY e.category_id, c.name`,
      [layoutId],
    );

    for (const zone of zones) {
      const tier = tiers.find((t) => t.category_id === zone.category_id);
      // Unreachable in practice: `categoriesWithInventory` makes the gate refuse an unpriced zone
      // class before we get here. Kept as defence in depth rather than an assertion, because the
      // alternative to skipping is throwing on a path that has already taken money elsewhere.
      if (!tier) continue;
      const capacity = Number(zone.capacity);
      const { rows: committed } = await client.query<{ taken: string }>(
        `SELECT (sold_quantity + reserved_quantity)::bigint AS taken
           FROM ticket_tiers WHERE id = $1 FOR UPDATE`,
        [tier.id],
      );
      const taken = Number(committed[0]?.taken ?? 0);
      if (capacity < taken) {
        throw err.conflict(
          'zone_capacity_below_sold',
          `Khu "${zone.name}" chỉ còn ${capacity} chỗ nhưng đã bán hoặc giữ ${taken}.`,
        );
      }
      await client.query(`UPDATE ticket_tiers SET total_quantity = $2 WHERE id = $1`, [tier.id, capacity]);
      total += capacity;
    }

    // One snapshot writer, not two. This used to inline its own `jsonb_build_object` that omitted
    // `points`, `tables` and `sectionStyles`, so a freshly generated map rendered without its
    // polygons, tables and per-section styling until someone happened to run a re-apply.
    await refreshSnapshot(showtimeId, layoutId, client);
    return total;
  });
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
export async function categoriesWithInventory(layoutId: number, db: Db = pool): Promise<number[]> {
  const { rows } = await db.query<{ category_id: number }>(
    `SELECT DISTINCT category_id FROM seats WHERE layout_id = $1 AND category_id IS NOT NULL
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
): Promise<{ venueId: number; status: string } | null> {
  const { rows } = await db.query<{ venue_id: number; status: string }>(
    `SELECT venue_id, status FROM venue_layouts WHERE id = $1`,
    [layoutId],
  );
  return rows[0] ? { venueId: rows[0].venue_id, status: rows[0].status } : null;
}
