import type { EventCard, EventDetail, SeatMap, SeatMapElement, SeatMapTable, Showtime, Tier } from '@shared/catalog/types.js';
import { LAYOUT_SPACE, SEAT_DIAMETER } from '../../config.js';
import type { Db } from '../../db/pool.js';
import { pool } from '../../db/pool.js';
import { buildTierLegend } from '@shared/catalog/tier-palette.js';
import { SHOWTIME_HAS_AVAILABILITY, UPCOMING_SHOWTIME, VISIBLE_JOIN, VISIBLE_WHERE } from './visibility.js';

// Correlated subqueries reused in the list projection (event alias `e`).
const EARLIEST = `(SELECT min(s.starts_at) FROM showtimes s WHERE ${UPCOMING_SHOWTIME})`;
// Archived tiers are retired: never priced, never offered, never counted (006 FR-006).
const ACTIVE_TIER = `tt.archived_at IS NULL`;
const START_PRICE = `(SELECT min(tt.price_amount) FROM ticket_tiers tt JOIN showtimes s2 ON s2.id = tt.showtime_id WHERE s2.event_id = e.id AND ${ACTIVE_TIER})`;
const CITY = `(SELECT v.city FROM showtimes s3 JOIN venues v ON v.id = s3.venue_id WHERE s3.event_id = e.id ORDER BY s3.starts_at LIMIT 1)`;
const HAS_UPCOMING = `EXISTS (SELECT 1 FROM showtimes s WHERE ${UPCOMING_SHOWTIME})`;
const HAS_AVAILABLE = `EXISTS (SELECT 1 FROM showtimes s WHERE ${UPCOMING_SHOWTIME} AND ${SHOWTIME_HAS_AVAILABILITY})`;

type Row = {
  id: number;
  slug: string;
  title: string;
  image_url: string | null;
  trailer_url: string | null;
  category: string;
  category_label: string;
  earliest_showtime: string | null;
  starting_price: string | null;
  city: string | null;
  has_upcoming: boolean;
  has_available: boolean;
};

const toCard = (r: Row): EventCard => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  imageUrl: r.image_url,
  trailerUrl: r.trailer_url,
  category: r.category,
  categoryLabel: r.category_label,
  city: r.city,
  earliestShowtime: r.earliest_showtime,
  startingPrice: r.starting_price === null ? null : Number(r.starting_price),
  soldOut: r.has_upcoming && !r.has_available,
  hasUpcoming: r.has_upcoming,
});

export interface EventFilters {
  q?: string;
  category?: string;
  city?: string;
  date?: string;
  minPrice?: number;
  maxPrice?: number;
  availability?: 'available' | 'all';
  page?: number;
  pageSize?: number;
}

const PAGE_SIZE = 20;
/**
 * How many cards one request may carry.
 *
 * The browse page filters in the browser — categories, cities, availability, and a price rule whose
 * far end is the dearest of whatever survived the other filters — so it needs the whole catalog in
 * hand, not one page of it. Twenty at a time meant twenty-six round trips for the current 503; this
 * lets it be three. The ceiling is here so a caller cannot ask for the table.
 */
const MAX_PAGE_SIZE = 200;
const pageSizeOf = (requested: number | undefined): number =>
  requested === undefined || !Number.isFinite(requested)
    ? PAGE_SIZE
    : Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(requested)));

/** Public catalog list (US1). Only visible events; sold-out shown & sorted last. */
export async function listEvents(f: EventFilters, db: Db = pool): Promise<{ events: EventCard[]; total: number; page: number }> {
  const where: string[] = [VISIBLE_WHERE];
  const params: unknown[] = [];
  const p = (v: unknown) => `$${params.push(v)}`;

  if (f.category) where.push(`ec.code = ${p(f.category)}`);
  if (f.city) where.push(`EXISTS (SELECT 1 FROM showtimes s JOIN venues v ON v.id = s.venue_id WHERE s.event_id = e.id AND v.city ILIKE ${p(f.city)})`);
  if (f.date) where.push(`EXISTS (SELECT 1 FROM showtimes s WHERE s.event_id = e.id AND s.starts_at::date = ${p(f.date)}::date)`);
  if (f.minPrice !== undefined) where.push(`${START_PRICE} >= ${p(f.minPrice)}`);
  if (f.maxPrice !== undefined) where.push(`${START_PRICE} <= ${p(f.maxPrice)}`);
  if (f.availability === 'available') where.push(HAS_AVAILABLE);

  let rank = '1';
  if (f.q) {
    const like = p(`%${f.q}%`);
    where.push(`(e.title ILIKE ${like} OR array_to_string(e.lineup, ' ') ILIKE ${like} OR e.description ILIKE ${like})`);
    rank = `CASE WHEN e.title ILIKE ${like} THEN 3 WHEN array_to_string(e.lineup, ' ') ILIKE ${like} THEN 2 ELSE 1 END`;
  }

  const whereSql = where.join(' AND ');
  const page = Math.max(1, f.page ?? 1);
  const size = pageSizeOf(f.pageSize);
  const offset = (page - 1) * size;

  const totalRes = await db.query<{ c: string }>(
    `SELECT count(*)::text AS c FROM events e ${VISIBLE_JOIN} JOIN event_categories ec ON ec.id = e.category_id WHERE ${whereSql}`,
    params,
  );

  const rows = await db.query<Row>(
    `SELECT e.id, e.slug, e.title, e.image_url, e.trailer_url, ec.code AS category, ec.label_vi AS category_label,
            ${EARLIEST} AS earliest_showtime, ${START_PRICE} AS starting_price, ${CITY} AS city,
            ${HAS_UPCOMING} AS has_upcoming, ${HAS_AVAILABLE} AS has_available, ${rank} AS rank
       FROM events e ${VISIBLE_JOIN} JOIN event_categories ec ON ec.id = e.category_id
      WHERE ${whereSql}
      ORDER BY has_available DESC, rank DESC, earliest_showtime ASC NULLS LAST, e.id
      LIMIT ${size} OFFSET ${offset}`,
    params,
  );

  return { events: rows.rows.map(toCard), total: Number(totalRes.rows[0]?.c ?? 0), page };
}

/** Public homepage curation. Hidden events disappear immediately through the live visibility predicate. */
export async function listFeaturedEvents(db: Db = pool): Promise<EventCard[]> {
  const { rows } = await db.query<Row>(
    `SELECT e.id, e.slug, e.title, e.image_url, e.trailer_url, ec.code AS category, ec.label_vi AS category_label,
            ${EARLIEST} AS earliest_showtime, ${START_PRICE} AS starting_price, ${CITY} AS city,
            ${HAS_UPCOMING} AS has_upcoming, ${HAS_AVAILABLE} AS has_available
       FROM featured_events f
       JOIN events e ON e.id = f.event_id
       ${VISIBLE_JOIN}
       JOIN event_categories ec ON ec.id = e.category_id
      WHERE ${VISIBLE_WHERE}
      ORDER BY f.display_order, f.event_id`,
  );
  return rows.map(toCard);
}

/** Public event detail by stable slug (US2). Null if not visible (never leaks drafts). */
/**
 * The buyer's event page.
 *
 * `asOwner` drops the public-visibility predicate so an organizer can see their own draft exactly as
 * a buyer would, BEFORE submitting it for review — which is the whole point of a preview and is
 * impossible while `VISIBLE_WHERE` demands `on_sale AND approved`.
 *
 * That flag is dangerous by construction, so it is deliberately not reachable from anything public:
 * `VISIBLE_WHERE` is untouched here and still guards every public read, and the only caller passing
 * `asOwner` is the organizer route, which sits behind `assertEventOwner`. The alternative —
 * teaching the public `/events/:slug` route about identity — would put an ownership branch inside
 * the anti-leak control itself (SC-004), which is the one place in this codebase that should have no
 * branches at all.
 */
export async function getEventDetail(
  slug: string,
  db: Db = pool,
  opts: { asOwner?: boolean } = {},
): Promise<EventDetail | null> {
  const res = await db.query<Row & {
    description: string;
    age_restriction: string;
    lineup: string[];
    genre: string[];
    trailer_url: string | null;
    refund_policy: string | null;
    event_type: 'general_admission' | 'seated';
    seo_title: string | null;
    seo_description: string | null;
    category_id: number;
    venue_guide: string | null;
    is_high_demand: boolean;
  }>(
    `SELECT e.id, e.slug, e.title, e.image_url, ec.code AS category, ec.label_vi AS category_label, e.description, e.age_restriction,
            e.lineup, e.genre, e.trailer_url, e.refund_policy, e.event_type, e.seo_title, e.seo_description,
            e.category_id, COALESCE(e.is_high_demand, false) AS is_high_demand,
            ${EARLIEST} AS earliest_showtime, ${START_PRICE} AS starting_price, ${CITY} AS city,
            ${HAS_UPCOMING} AS has_upcoming, ${HAS_AVAILABLE} AS has_available,
            (SELECT v.guide FROM showtimes s JOIN venues v ON v.id = s.venue_id WHERE s.event_id = e.id ORDER BY s.starts_at LIMIT 1) AS venue_guide
       FROM events e ${VISIBLE_JOIN} JOIN event_categories ec ON ec.id = e.category_id
      WHERE e.slug = $1 AND ${opts.asOwner ? 'TRUE' : VISIBLE_WHERE}`,
    [slug],
  );
  const r = res.rows[0];
  if (!r) return null;

  // Distinct tier labels across the event's showtimes, cheapest price each (detail summary).
  const tiersRes = await db.query<{ label: string; price: string }>(
    `SELECT tt.label, min(tt.price_amount)::text AS price
       FROM ticket_tiers tt JOIN showtimes s ON s.id = tt.showtime_id
      WHERE s.event_id = $1 AND tt.archived_at IS NULL GROUP BY tt.label ORDER BY min(tt.price_amount)`,
    [r.id],
  );
  const tiers: Tier[] = tiersRes.rows.map((t, i) => ({ id: i, label: t.label, price: Number(t.price), remaining: null }));

  const relatedRes = await db.query<Row>(
    `SELECT e.id, e.slug, e.title, e.image_url, e.trailer_url, ec.code AS category, ec.label_vi AS category_label,
            ${EARLIEST} AS earliest_showtime, ${START_PRICE} AS starting_price, ${CITY} AS city,
            ${HAS_UPCOMING} AS has_upcoming, ${HAS_AVAILABLE} AS has_available
       FROM events e ${VISIBLE_JOIN} JOIN event_categories ec ON ec.id = e.category_id
      WHERE ${VISIBLE_WHERE} AND e.id <> $1 AND e.category_id = $2
      ORDER BY e.id LIMIT 4`,
    [r.id, r.category_id],
  );

  /*
   * The rating rides along with the detail rather than costing the screen a second request on open.
   * Null when nobody has rated it — an unrated event is not a zero-star event.
   */
  const ratingRow = await db.query<{ n: string; avg: string | null }>(
    // Rated rows only. Since 0021 an author's later comments and every reply carry no stars, so a
    // bare `count(*)` would report an event as rated by more people than voted on it.
    `SELECT count(*) FILTER (WHERE rating IS NOT NULL)::text AS n, avg(rating)::text AS avg
       FROM event_reviews WHERE event_id = $1 AND status = 'visible'`,
    [r.id],
  );
  const reviewCount = Number(ratingRow.rows[0]?.n ?? 0);

  return {
    ...toCard(r),
    rating: reviewCount === 0 ? null : Math.round(Number(ratingRow.rows[0]!.avg) * 10) / 10,
    reviewCount,
    description: r.description,
    ageRestriction: r.age_restriction,
    lineup: r.lineup,
    genre: r.genre,
    trailerUrl: r.trailer_url,
    refundPolicy: r.refund_policy,
    eventType: r.event_type,
    venueGuide: r.venue_guide,
    tiers,
    related: relatedRes.rows.map(toCard),
    seo: { title: r.seo_title ?? r.title, description: r.seo_description ?? r.description, imageUrl: r.image_url },
    isHighDemand: Boolean(r.is_high_demand),
  };
}

/** Upcoming showtimes with availability (US3). Empty if the event is not visible. */
export async function getShowtimes(eventId: number, db: Db = pool): Promise<Showtime[]> {
  const res = await db.query<{
    id: number;
    starts_at: string;
    name: string;
    city: string;
    chain_id: number | null;
    chain_code: string | null;
    chain_name: string | null;
    has_available: boolean;
  }>(
    /*
     * LEFT JOIN on the chain, never INNER: a chain is a property of cinemas only, and the concert
     * halls and stadiums that make up most of the estate have none. An inner join here would drop
     * every non-cinema showtime from the detail page.
     *
     * Ordered by place before time. The detail page narrows city → chain → venue before it shows a
     * day or a session, so handing it rows already grouped that way means its filter lists come out
     * in a stable order. `starts_at` stays the last key, so within one cinema the sessions still
     * read as a day's schedule.
     */
    `SELECT s.id, s.starts_at, v.name, v.city,
            ch.id AS chain_id, ch.code AS chain_code, ch.name AS chain_name,
            ${SHOWTIME_HAS_AVAILABILITY} AS has_available
       FROM showtimes s
       JOIN events e ON e.id = s.event_id ${VISIBLE_JOIN}
       JOIN venues v ON v.id = s.venue_id
       LEFT JOIN cinema_chains ch ON ch.id = v.chain_id
      WHERE s.event_id = $1 AND ${VISIBLE_WHERE}
        AND s.starts_at > now() AND s.status NOT IN ('cancelled', 'finished')
      ORDER BY v.city, ch.display_order NULLS FIRST, ch.name, v.name, s.starts_at`,
    [eventId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    startsAt: r.starts_at,
    venue: {
      name: r.name,
      city: r.city,
      chain: r.chain_id === null ? null : { id: r.chain_id, code: r.chain_code!, name: r.chain_name! },
    },
    availability: r.has_available ? 'available' : 'sold_out',
  }));
}

/** The decoration half of a showtime's layout snapshot (feature 005, FR-005). Display only — nothing
 *  here is ever inventory, and the floor plan never determines a seat's status (Principle I). */
interface SeatMapSnapshot {
  elements: SeatMapElement[];
  /** Tables the showtime snapshotted with its geometry (FR-081). Absent on pre-amendment snapshots. */
  tables?: SeatMapTable[];
  /** Per-section seat shape and size, keyed by section name (FR-064). Absent before the amendment. */
  sectionStyles?: { name: string; seatShape: 'circle' | 'square'; seatSizeMultiplier: number }[];
  planUrl: string | null;
  planScale: number;
  planOffsetX: number;
  planOffsetY: number;
  planOpacity: number;
  planVisibleToBuyers: boolean;
  /** Absent on snapshots written before 0037; the buyer's picker falls back to `balanced`. */
  orphanRule?: 'balanced' | 'strict';
}

/**
 * Decoration out of a snapshot, in the shape the buyer's renderer reads.
 *
 * Snapshots are frozen at apply time, so rows written by OLD builders survive indefinitely — and
 * one such builder (since replaced: `generateSeatMap` now defers to `refreshSnapshot`) wrote the
 * database column names `pos_x`/`pos_y` where the renderer reads `x`/`y`. The renderer got
 * `undefined`, turned it into `NaN` through the extent maths, and emitted
 * `viewBox="NaN NaN NaN NaN"` — which blanks the ENTIRE map, seats included. A showtime with 106
 * sellable seats showed the buyer nothing at all.
 *
 * So the legacy key is accepted as a fallback rather than the element being dropped: the position
 * is right there in the row, and a stage that draws beats a stage that vanishes. Anything still
 * lacking a finite position after that IS dropped — it cannot be placed, and must never again be
 * allowed to decide where the map is.
 *
 * Re-applying a layout rewrites the snapshot in the current shape and retires the fallback for that
 * showtime. This exists so a stale row is a cosmetic debt, never a blank map.
 */
function readSnapshotElements(raw: SeatMapSnapshot['elements'] | undefined): SeatMapElement[] {
  return (raw ?? [])
    .map((e) => {
      const legacy = e as Partial<SeatMapElement> & { pos_x?: number; pos_y?: number };
      return { ...e, x: e.x ?? legacy.pos_x, y: e.y ?? legacy.pos_y } as SeatMapElement;
    })
    .filter((e) => Number.isFinite(e.x) && Number.isFinite(e.y));
}

/** Read-only seat map (seated) or tier availability (GA) for a showtime (US3). Null if not visible. */
export async function getSeatMap(showtimeId: number, db: Db = pool): Promise<SeatMap | null> {
  const evRes = await db.query<{ event_type: 'general_admission' | 'seated'; is_high_demand: boolean }>(
    `SELECT e.event_type, COALESCE(e.is_high_demand, false) AS is_high_demand FROM showtimes s JOIN events e ON e.id = s.event_id ${VISIBLE_JOIN}
      WHERE s.id = $1 AND ${VISIBLE_WHERE}`,
    [showtimeId],
  );
  const ev = evRes.rows[0];
  if (!ev) return null;

  if (ev.event_type === 'seated') {
    // Geometry comes off `showtime_seats` — the showtime's own SNAPSHOT of the layout, on the row this
    // query already reads, so coordinates cost no extra join (feature 005, research R-2).
    // Ordered section → row → number: that ordering is the buyer map's tab order and is part of the
    // contract, not an implementation detail of either renderer (FR-039a).
    const seats = await db.query<{
      id: number;
      row_label: string;
      seat_number: number;
      label: string;
      price: string;
      status: 'available' | 'held' | 'sold' | 'blocked';
      pos_x: number | null;
      pos_y: number | null;
      rotation: number;
      section: string | null;
      category: string | null;
      tier_id: number;
      is_accessible: boolean;
      table_id: number | null;
      table_booking_mode: 'per_seat' | 'whole_table' | null;
    }>(
      `SELECT ss.id, ss.row_label, ss.seat_number, tt.label, tt.price_amount::text AS price, ss.status,
              ss.pos_x, ss.pos_y, ss.rotation, ss.section_name AS section,
              ss.category_name AS category, tt.id AS tier_id,
              ss.is_accessible, ss.table_id, ss.table_booking_mode
         FROM showtime_seats ss
         JOIN ticket_tiers tt ON tt.id = ss.ticket_tier_id
        WHERE ss.showtime_id = $1
        ORDER BY ss.section_name NULLS FIRST, ss.row_label, ss.seat_number`,
      [showtimeId],
    );

    const snap = await db.query<{ layout_snapshot: SeatMapSnapshot | null }>(
      `SELECT layout_snapshot FROM showtimes WHERE id = $1`,
      [showtimeId],
    );
    const s = snap.rows[0]?.layout_snapshot ?? null;

    // Colour by price, derived at read time from the showtime's tiers (FR-067). Nothing is stored and
    // no ticket-tier column exists for it — feature 006 owns that table — so the map re-colours itself
    // whenever a price changes, and the two buyer renderers cannot disagree about a value that is not
    // persisted anywhere.
    const tiers = await db.query<{ id: number; label: string; price: string; color: string | null }>(
      `SELECT tt.id, tt.label, tt.price_amount::text AS price, c.color
         FROM ticket_tiers tt
         LEFT JOIN layout_categories c ON c.id = tt.category_id
        WHERE tt.showtime_id = $1 AND tt.archived_at IS NULL`,
      [showtimeId],
    );
    // Style is looked up by section NAME: that is the only section identity a seat row carries, and
    // the snapshot is what makes the lookup safe — both sides came from the same apply.
    const styleOf = new Map((s?.sectionStyles ?? []).map((st) => [st.name, st]));

    const tierLegend = buildTierLegend(
      tiers.rows.map((t) => ({ id: t.id, label: t.label, price: Number(t.price), color: t.color })),
    );

    return {
      eventType: 'seated',
      tierLegend,
      // Snapshotted tables, so a seat labelled "Bàn 5 - Ghế 3" is drawn at the table it names (FR-082).
      tables: s?.tables ?? [],
      space: { width: LAYOUT_SPACE, height: LAYOUT_SPACE, seatDiameter: SEAT_DIAMETER },
      seats: seats.rows.map((r) => ({
        id: r.id,
        row: r.row_label,
        number: r.seat_number,
        tier: r.label,
        price: Number(r.price),
        status: r.status,
        x: r.pos_x ?? 0,
        y: r.pos_y ?? 0,
        rotation: r.rotation,
        section: r.section,
        category: r.category,
        tierId: r.tier_id,
        isAccessible: r.is_accessible,
        tableId: r.table_id,
        tableBookingMode: r.table_booking_mode,
        shape: r.section ? styleOf.get(r.section)?.seatShape : undefined,
        sizeMultiplier: r.section ? styleOf.get(r.section)?.seatSizeMultiplier : undefined,
      })),
      elements: readSnapshotElements(s?.elements),
      orphanRule: s?.orphanRule ?? 'balanced',
      // Omitted entirely unless the organizer made the plan buyer-visible (FR-026). The toggle governs
      // display; the file itself is unguessable rather than access-controlled (FR-026a).
      floorPlan:
        s?.planUrl && s.planVisibleToBuyers
          ? {
              url: s.planUrl,
              scale: s.planScale,
              offsetX: s.planOffsetX,
              offsetY: s.planOffsetY,
              opacity: s.planOpacity,
            }
          : null,
      isHighDemand: Boolean(ev.is_high_demand),
    };
  }

  const tiers = await db.query<{ id: number; label: string; price: string; remaining: string | null }>(
    `SELECT id, label, price_amount::text AS price,
            CASE WHEN total_quantity IS NULL THEN NULL
                 ELSE (total_quantity - sold_quantity - reserved_quantity)::text END AS remaining
       FROM ticket_tiers WHERE showtime_id = $1 AND archived_at IS NULL ORDER BY price_amount`,
    [showtimeId],
  );
  return {
    eventType: 'general_admission',
    isHighDemand: Boolean(ev.is_high_demand),
    tiers: tiers.rows.map((t) => ({
      id: t.id,
      label: t.label,
      price: Number(t.price),
      remaining: t.remaining === null ? null : Number(t.remaining),
    })),
  };
}
