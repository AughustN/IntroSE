// Every query the reviews domain makes. Same repo/service/routes split the admin, catalog, holds
// and ai modules use.

import type { Review, ReviewSummary } from '@shared/reviews/types.js';
import type { Db } from '../../db/pool.js';
import { pool } from '../../db/pool.js';

/** Longest a review body may be. A product decision, so it lives here and not in a column type. */
export const MAX_BODY = 2_000;

export interface Eligibility {
  /** A paid, non-void ticket to this event exists for this account. */
  hasTicket: boolean;
  /** The event has started. Nobody can hold a view on something that has not happened. */
  hasStarted: boolean;
}

/**
 * May this account review this event, and if not, which rule stopped it?
 *
 * Re-derived on every write and stored nowhere. Recording eligibility on the review would leave a
 * rating standing behind a purchase that was later refunded, and would need a sweep to notice.
 *
 * The two conditions come back separately because a refusal the reader cannot act on is barely
 * better than no refusal: "you have no ticket" and "the event has not happened yet" call for
 * different things from them.
 *
 * `starts_at` is checked across the event's showtimes, not the one the ticket was for: an attendee
 * whose showtime has passed has been, and that is the whole question.
 */
export async function eligibility(userId: number, eventId: number, db: Db = pool): Promise<Eligibility> {
  const { rows } = await db.query<{ has_ticket: boolean; has_started: boolean }>(
    `SELECT
       EXISTS (
         SELECT 1
           FROM tickets t
           JOIN orders o ON o.id = t.order_id
           JOIN reservations r ON r.id = o.reservation_id
           JOIN showtimes s ON s.id = r.showtime_id
          WHERE o.user_id = $1 AND s.event_id = $2
            AND o.payment_status = 'paid'
            AND t.qr_status <> 'void'
       ) AS has_ticket,
       EXISTS (
         SELECT 1 FROM showtimes s WHERE s.event_id = $2 AND s.starts_at < now()
       ) AS has_started`,
    [userId, eventId],
  );
  return { hasTicket: rows[0]?.has_ticket ?? false, hasStarted: rows[0]?.has_started ?? false };
}

type Row = {
  id: number;
  event_id: number;
  rating: number;
  body: string | null;
  nickname: string | null;
  avatar_url: string | null;
  created_at: Date;
  edited: boolean;
  user_id: number | null;
};

const toReview = (row: Row, viewerId?: number): Review => ({
  id: row.id,
  eventId: row.event_id,
  rating: row.rating,
  body: row.body,
  // A null author is a deleted account, not a missing row: the review outlives the person.
  author: row.nickname === null ? null : { nickname: row.nickname, avatarUrl: row.avatar_url },
  createdAt: row.created_at.toISOString(),
  edited: row.edited,
  ...(viewerId !== undefined ? { mine: row.user_id === viewerId } : {}),
});

const SELECT = `
  SELECT r.id, r.event_id, r.rating, r.body, r.user_id,
         u.nickname, u.avatar_url,
         r.created_at, (r.updated_at > r.created_at) AS edited
    FROM event_reviews r
    LEFT JOIN users u ON u.id = r.user_id`;

/**
 * Create the account's review of this event, or replace the one it already has.
 *
 * `ON CONFLICT` against the partial unique index rather than a read followed by a write: the read
 * would leave a gap in which two simultaneous first submissions both find nothing and both insert.
 * It also gives UC-18 A2 for free — a second submission is an edit, not an error to explain.
 */
export async function upsert(
  userId: number,
  eventId: number,
  rating: number,
  body: string | null,
  db: Db = pool,
): Promise<Review> {
  /*
   * Two statements, not one.
   *
   * The obvious shape — a data-modifying CTE followed by a SELECT that reads the row back — does not
   * work: Postgres runs every part of a statement against the same snapshot, so the outer SELECT
   * cannot see what the CTE just inserted (it returns nothing) and sees the *old* values of what it
   * just updated. Both failures are silent in the sense that the SQL is valid.
   */
  const saved = await db.query<{ id: number }>(
    `INSERT INTO event_reviews (event_id, user_id, rating, body)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (event_id, user_id) WHERE user_id IS NOT NULL
     DO UPDATE SET rating = EXCLUDED.rating, body = EXCLUDED.body,
                   updated_at = now(), status = 'visible'
     RETURNING id`,
    [eventId, userId, rating, body],
  );
  const { rows } = await db.query<Row>(`${SELECT} WHERE r.id = $1`, [saved.rows[0]!.id]);
  return toReview(rows[0]!, userId);
}

/**
 * Edit or withdraw, scoped to the author in SQL.
 *
 * `user_id` is part of the `WHERE` rather than something checked first in application code: with the
 * check separate, every future caller has to remember it, and one that forgets edits anybody's
 * review. Zero rows affected is the caller's 404 — reported as "not found" and not "forbidden", so
 * walking ids reveals nothing about which reviews exist.
 */
export async function updateOwn(
  userId: number,
  reviewId: number,
  rating: number,
  body: string | null,
  db: Db = pool,
): Promise<Review | null> {
  // Same two-step as `upsert`, and for the same reason — a CTE's update is invisible to the SELECT
  // beside it, which would return the values as they were before the edit.
  const saved = await db.query<{ id: number }>(
    `UPDATE event_reviews
        SET rating = $3, body = $4, updated_at = now()
      WHERE id = $2 AND user_id = $1 AND status = 'visible'
      RETURNING id`,
    [userId, reviewId, rating, body],
  );
  if (!saved.rows[0]) return null;
  const { rows } = await db.query<Row>(`${SELECT} WHERE r.id = $1`, [saved.rows[0].id]);
  return rows[0] ? toReview(rows[0], userId) : null;
}

export async function deleteOwn(userId: number, reviewId: number, db: Db = pool): Promise<boolean> {
  const result = await db.query('DELETE FROM event_reviews WHERE id = $1 AND user_id = $2', [
    reviewId,
    userId,
  ]);
  return Boolean(result.rowCount);
}

export async function findByAuthor(
  userId: number,
  eventId: number,
  db: Db = pool,
): Promise<Review | null> {
  const { rows } = await db.query<Row>(
    `${SELECT} WHERE r.event_id = $2 AND r.user_id = $1 AND r.status = 'visible'`,
    [userId, eventId],
  );
  return rows[0] ? toReview(rows[0], userId) : null;
}

/**
 * A page of visible reviews, newest first.
 *
 * Keyset-paginated on `created_at` rather than by offset: with an offset, a review posted while the
 * reader is scrolling shifts every later page by one, so they see one review twice and never see
 * another. One row beyond the limit is fetched to answer `hasMore` without a second count query.
 */
export async function listForEvent(
  eventId: number,
  limit: number,
  before: string | null,
  viewerId: number | undefined,
  db: Db = pool,
): Promise<{ reviews: Review[]; hasMore: boolean }> {
  const { rows } = await db.query<Row>(
    `${SELECT}
      WHERE r.event_id = $1 AND r.status = 'visible'
        AND ($2::timestamptz IS NULL OR r.created_at < $2::timestamptz)
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT $3`,
    [eventId, before, limit + 1],
  );
  const hasMore = rows.length > limit;
  return { reviews: rows.slice(0, limit).map((row) => toReview(row, viewerId)), hasMore };
}

/**
 * The event's average and count, from the live rows.
 *
 * Derived rather than stored. A counter would have to be corrected on insert, edit, delete and
 * moderation removal — four paths, each able to drift silently — and SC-005 wants the displayed
 * average to equal the mean of visible reviews immediately after every one of them.
 */
export async function summary(eventId: number, db: Db = pool): Promise<ReviewSummary> {
  const { rows } = await db.query<{ n: string; avg: string | null }>(
    `SELECT count(*)::text AS n, avg(rating)::text AS avg
       FROM event_reviews WHERE event_id = $1 AND status = 'visible'`,
    [eventId],
  );
  const count = Number(rows[0]?.n ?? 0);
  return {
    // Null, never 0: an event nobody has rated has not been rated badly.
    rating: count === 0 ? null : Math.round(Number(rows[0]!.avg) * 10) / 10,
    reviewCount: count,
  };
}

/** Moderation's hide. Keeps the row so the report and the audit entry retain a readable subject. */
export async function setStatus(
  reviewId: number,
  status: 'visible' | 'removed',
  db: Db = pool,
): Promise<boolean> {
  const result = await db.query('UPDATE event_reviews SET status = $2 WHERE id = $1', [reviewId, status]);
  return Boolean(result.rowCount);
}

export async function visibleExists(reviewId: number, db: Db = pool): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM event_reviews WHERE id = $1 AND status = 'visible'`,
    [reviewId],
  );
  return rows.length > 0;
}
