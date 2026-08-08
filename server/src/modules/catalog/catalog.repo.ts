import type { EventCard, EventDetail, SeatMap, Showtime, Tier } from '@shared/catalog/types.js';
import type { Db } from '../../db/pool.js';
import { pool } from '../../db/pool.js';
import { SHOWTIME_HAS_AVAILABILITY, UPCOMING_SHOWTIME, VISIBLE_JOIN, VISIBLE_WHERE } from './visibility.js';

// Correlated subqueries reused in the list projection (event alias `e`).
const EARLIEST = `(SELECT min(s.starts_at) FROM showtimes s WHERE ${UPCOMING_SHOWTIME})`;
const START_PRICE = `(SELECT min(tt.price_amount) FROM ticket_tiers tt JOIN showtimes s2 ON s2.id = tt.showtime_id WHERE s2.event_id = e.id)`;
const CITY = `(SELECT v.city FROM showtimes s3 JOIN venues v ON v.id = s3.venue_id WHERE s3.event_id = e.id ORDER BY s3.starts_at LIMIT 1)`;
const HAS_UPCOMING = `EXISTS (SELECT 1 FROM showtimes s WHERE ${UPCOMING_SHOWTIME})`;
const HAS_AVAILABLE = `EXISTS (SELECT 1 FROM showtimes s WHERE ${UPCOMING_SHOWTIME} AND ${SHOWTIME_HAS_AVAILABILITY})`;

type Row = {
  id: number;
  slug: string;
  title: string;
  image_url: string | null;
  category: string;
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
  category: r.category,
  city: r.city,
  earliestShowtime: r.earliest_showtime,
  startingPrice: r.starting_price === null ? null : Number(r.starting_price),
  soldOut: r.has_upcoming && !r.has_available,
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
}

const PAGE_SIZE = 20;

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
  const offset = (page - 1) * PAGE_SIZE;

  const totalRes = await db.query<{ c: string }>(
    `SELECT count(*)::text AS c FROM events e ${VISIBLE_JOIN} JOIN event_categories ec ON ec.id = e.category_id WHERE ${whereSql}`,
    params,
  );

  const rows = await db.query<Row>(
    `SELECT e.id, e.slug, e.title, e.image_url, ec.code AS category,
            ${EARLIEST} AS earliest_showtime, ${START_PRICE} AS starting_price, ${CITY} AS city,
            ${HAS_UPCOMING} AS has_upcoming, ${HAS_AVAILABLE} AS has_available, ${rank} AS rank
       FROM events e ${VISIBLE_JOIN} JOIN event_categories ec ON ec.id = e.category_id
      WHERE ${whereSql}
      ORDER BY has_available DESC, rank DESC, earliest_showtime ASC NULLS LAST, e.id
      LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    params,
  );

  return { events: rows.rows.map(toCard), total: Number(totalRes.rows[0]?.c ?? 0), page };
}

/** Public homepage curation. Hidden events disappear immediately through the live visibility predicate. */
export async function listFeaturedEvents(db: Db = pool): Promise<EventCard[]> {
  const { rows } = await db.query<Row>(
    `SELECT e.id, e.slug, e.title, e.image_url, ec.code AS category,
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
export async function getEventDetail(slug: string, db: Db = pool): Promise<EventDetail | null> {
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
  }>(
    `SELECT e.id, e.slug, e.title, e.image_url, ec.code AS category, e.description, e.age_restriction,
            e.lineup, e.genre, e.trailer_url, e.refund_policy, e.event_type, e.seo_title, e.seo_description,
            e.category_id,
            ${EARLIEST} AS earliest_showtime, ${START_PRICE} AS starting_price, ${CITY} AS city,
            ${HAS_UPCOMING} AS has_upcoming, ${HAS_AVAILABLE} AS has_available,
            (SELECT v.guide FROM showtimes s JOIN venues v ON v.id = s.venue_id WHERE s.event_id = e.id ORDER BY s.starts_at LIMIT 1) AS venue_guide
       FROM events e ${VISIBLE_JOIN} JOIN event_categories ec ON ec.id = e.category_id
      WHERE e.slug = $1 AND ${VISIBLE_WHERE}`,
    [slug],
  );
  const r = res.rows[0];
  if (!r) return null;

  // Distinct tier labels across the event's showtimes, cheapest price each (detail summary).
  const tiersRes = await db.query<{ label: string; price: string }>(
    `SELECT tt.label, min(tt.price_amount)::text AS price
       FROM ticket_tiers tt JOIN showtimes s ON s.id = tt.showtime_id
      WHERE s.event_id = $1 GROUP BY tt.label ORDER BY min(tt.price_amount)`,
    [r.id],
  );
  const tiers: Tier[] = tiersRes.rows.map((t, i) => ({ id: i, label: t.label, price: Number(t.price), remaining: null }));

  const relatedRes = await db.query<Row>(
    `SELECT e.id, e.slug, e.title, e.image_url, ec.code AS category,
            ${EARLIEST} AS earliest_showtime, ${START_PRICE} AS starting_price, ${CITY} AS city,
            ${HAS_UPCOMING} AS has_upcoming, ${HAS_AVAILABLE} AS has_available
       FROM events e ${VISIBLE_JOIN} JOIN event_categories ec ON ec.id = e.category_id
      WHERE ${VISIBLE_WHERE} AND e.id <> $1 AND e.category_id = $2
      ORDER BY e.id LIMIT 4`,
    [r.id, r.category_id],
  );

  return {
    ...toCard(r),
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
  };
}

/** Upcoming showtimes with availability (US3). Empty if the event is not visible. */
export async function getShowtimes(eventId: number, db: Db = pool): Promise<Showtime[]> {
  const res = await db.query<{ id: number; starts_at: string; name: string; city: string; has_available: boolean }>(
    `SELECT s.id, s.starts_at, v.name, v.city,
            ${SHOWTIME_HAS_AVAILABILITY} AS has_available
       FROM showtimes s
       JOIN events e ON e.id = s.event_id ${VISIBLE_JOIN}
       JOIN venues v ON v.id = s.venue_id
      WHERE s.event_id = $1 AND ${VISIBLE_WHERE}
        AND s.starts_at > now() AND s.status NOT IN ('cancelled', 'finished')
      ORDER BY s.starts_at`,
    [eventId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    startsAt: r.starts_at,
    venue: { name: r.name, city: r.city },
    availability: r.has_available ? 'available' : 'sold_out',
  }));
}

/** Read-only seat map (seated) or tier availability (GA) for a showtime (US3). Null if not visible. */
export async function getSeatMap(showtimeId: number, db: Db = pool): Promise<SeatMap | null> {
  const evRes = await db.query<{ event_type: 'general_admission' | 'seated' }>(
    `SELECT e.event_type FROM showtimes s JOIN events e ON e.id = s.event_id ${VISIBLE_JOIN}
      WHERE s.id = $1 AND ${VISIBLE_WHERE}`,
    [showtimeId],
  );
  const ev = evRes.rows[0];
  if (!ev) return null;

  if (ev.event_type === 'seated') {
    const seats = await db.query<{ id: number; row_label: string; seat_number: number; label: string; price: string; status: 'available' | 'held' | 'sold' | 'blocked' }>(
      `SELECT ss.id, se.row_label, se.seat_number, tt.label, tt.price_amount::text AS price, ss.status
         FROM showtime_seats ss
         JOIN seats se ON se.id = ss.seat_id
         JOIN ticket_tiers tt ON tt.id = ss.ticket_tier_id
        WHERE ss.showtime_id = $1
        ORDER BY se.row_label, se.seat_number`,
      [showtimeId],
    );
    return {
      eventType: 'seated',
      seats: seats.rows.map((s) => ({
        id: s.id,
        row: s.row_label,
        number: s.seat_number,
        tier: s.label,
        price: Number(s.price),
        status: s.status as 'available' | 'held' | 'sold' | 'blocked',
      })),
    };
  }

  const tiers = await db.query<{ id: number; label: string; price: string; remaining: string | null }>(
    `SELECT id, label, price_amount::text AS price,
            CASE WHEN total_quantity IS NULL THEN NULL
                 ELSE (total_quantity - sold_quantity - reserved_quantity)::text END AS remaining
       FROM ticket_tiers WHERE showtime_id = $1 ORDER BY price_amount`,
    [showtimeId],
  );
  return {
    eventType: 'general_admission',
    tiers: tiers.rows.map((t) => ({
      id: t.id,
      label: t.label,
      price: Number(t.price),
      remaining: t.remaining === null ? null : Number(t.remaining),
    })),
  };
}
