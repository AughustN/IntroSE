// Every query the reviews domain makes. Same repo/service/routes split the admin, catalog, holds
// and ai modules use.

import type { Review, ReviewSummary } from '@shared/reviews/types.js';
import type { Db } from '../../db/pool.js';
import { pool } from '../../db/pool.js';

/** Longest a review body may be. A product decision, so it lives here and not in a column type. */
export const MAX_BODY = 2_000;

export interface Eligibility {
  /** A paid, non-void ticket to this event exists for this account. The whole rule. */
  hasTicket: boolean;
}

/**
 * May this account review this event?
 *
 * Re-derived on every write and stored nowhere. Recording eligibility on the review would leave a
 * rating standing behind a purchase that was later refunded, and would need a sweep to notice.
 *
 * Holding a paid, non-void ticket is the whole rule. A second condition used to sit here — the
 * event had to have started — on the reasoning that nobody can hold a view on something that has
 * not happened. That is true of the performance and false of everything else a buyer has already
 * been through by then: the listing, the price, the seat map, the checkout. Making them wait until
 * showtime silenced the comments on exactly the events a prospective buyer is still deciding about.
 */
export async function eligibility(userId: number, eventId: number, db: Db = pool): Promise<Eligibility> {
  const { rows } = await db.query<{ has_ticket: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM tickets t
         JOIN orders o ON o.id = t.order_id
         JOIN reservations r ON r.id = o.reservation_id
         JOIN showtimes s ON s.id = r.showtime_id
        WHERE o.user_id = $1 AND s.event_id = $2
          AND o.payment_status = 'paid'
          AND t.qr_status <> 'void'
     ) AS has_ticket`,
    [userId, eventId],
  );
  return { hasTicket: rows[0]?.has_ticket ?? false };
}

type Row = {
  id: number;
  event_id: number;
  rating: number | null;
  body: string | null;
  parent_id: string | number | null;
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
  parentId: row.parent_id === null ? null : Number(row.parent_id),
  // A null author is a deleted account, not a missing row: the review outlives the person.
  author: row.nickname === null ? null : { nickname: row.nickname, avatarUrl: row.avatar_url },
  createdAt: row.created_at.toISOString(),
  edited: row.edited,
  ...(viewerId !== undefined ? { mine: row.user_id === viewerId } : {}),
});

const SELECT = `
  SELECT r.id, r.event_id, r.rating, r.body, r.parent_id, r.user_id,
         u.nickname, u.avatar_url,
         r.created_at, (r.updated_at > r.created_at) AS edited
    FROM event_reviews r
    LEFT JOIN users u ON u.id = r.user_id`;

/** Postgres' unique-violation code: someone else's insert won the race for this author's rating. */
export const DUPLICATE_RATING = '23505';

/**
 * Add a comment to an event: a rated one, a later unrated one, or a reply under another.
 *
 * An insert rather than 0020's upsert. The upsert was the whole of "one review per person", and
 * with that rule gone it would silently overwrite whatever the author last said — the exact thing
 * a comment section must not do.
 *
 * A second *rated* row still cannot exist: the partial unique index refuses it and this throws
 * `DUPLICATE_RATING`, which is the caller's cue to store the comment without stars. That is a
 * narrower promise than the old index and it is enforced in the same place, so two devices posting
 * a first comment at the same instant cannot leave an author with two votes.
 */
export async function insert(
  userId: number,
  eventId: number,
  rating: number | null,
  body: string | null,
  parentId: number | null,
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
    `INSERT INTO event_reviews (event_id, user_id, rating, body, parent_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [eventId, userId, rating, body, parentId],
  );
  const { rows } = await db.query<Row>(`${SELECT} WHERE r.id = $1`, [saved.rows[0]!.id]);
  return toReview(rows[0]!, userId);
}

/**
 * Has this account already cast its stars on this event?
 *
 * Deliberately blind to `status`: the unique index is too, so a rated comment an admin hid still
 * occupies the author's one vote. Reading it any other way would offer stars the insert then
 * refuses.
 */
export async function hasRated(userId: number, eventId: number, db: Db = pool): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM event_reviews
      WHERE user_id = $1 AND event_id = $2 AND rating IS NOT NULL LIMIT 1`,
    [userId, eventId],
  );
  return rows.length > 0;
}

/**
 * The comment a reply is being hung under, if it is visible and belongs to this event.
 *
 * `parent_id` comes back so the service can flatten: replying to a reply attaches to the comment
 * both are under, the way every comment section a reader has used already behaves. Threads nested
 * arbitrarily deep are a rendering problem nobody asked for.
 */
export async function findParent(
  parentId: number,
  eventId: number,
  db: Db = pool,
): Promise<{ id: number; parentId: number | null } | null> {
  const { rows } = await db.query<{ id: number; parent_id: string | number | null }>(
    `SELECT id, parent_id FROM event_reviews
      WHERE id = $1 AND event_id = $2 AND status = 'visible'`,
    [parentId, eventId],
  );
  const row = rows[0];
  return row ? { id: Number(row.id), parentId: row.parent_id === null ? null : Number(row.parent_id) } : null;
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
  rating: number | null,
  body: string | null,
  db: Db = pool,
): Promise<Review | null> {
  // Same two-step as `insert`, and for the same reason — a CTE's update is invisible to the SELECT
  // beside it, which would return the values as they were before the edit.
  //
  // Whether a row carries stars is fixed when it is written and an edit cannot change it: the rated
  // comment keeps its rating (and may change its value), while a later comment or a reply stays
  // prose however many stars the request arrives with. Otherwise editing would be a second door to
  // a second vote.
  const saved = await db.query<{ id: number }>(
    `UPDATE event_reviews
        SET rating = CASE WHEN rating IS NULL THEN NULL ELSE COALESCE($3::smallint, rating) END,
            body = $4::text, updated_at = now()
      WHERE id = $2 AND user_id = $1 AND status = 'visible'
        AND (rating IS NOT NULL OR $4::text IS NOT NULL)
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

/**
 * A page of visible top-level comments, newest first, each carrying its thread.
 *
 * Keyset-paginated on `created_at` rather than by offset: with an offset, a comment posted while the
 * reader is scrolling shifts every later page by one, so they see one twice and never see another.
 * One row beyond the limit is fetched to answer `hasMore` without a second count query.
 *
 * The wall is comments only: no reply travels with it, just a count per comment. A thread is an
 * exchange between two people about one remark, and printing the start of every one of them turned
 * a page of ten comments into a page of thirty rows most readers scrolled past. The count is what
 * the "xem N trả lời" control needs, and the replies themselves are fetched by whoever presses it.
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
      WHERE r.event_id = $1 AND r.status = 'visible' AND r.parent_id IS NULL
        AND ($2::timestamptz IS NULL OR r.created_at < $2::timestamptz)
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT $3`,
    [eventId, before, limit + 1],
  );
  const hasMore = rows.length > limit;
  const parents = rows.slice(0, limit).map((row) => toReview(row, viewerId));
  if (parents.length === 0) return { reviews: parents, hasMore };

  // One grouped count for the whole page, not a row per reply and not a query per comment.
  const { rows: counts } = await db.query<{ parent_id: string; n: string }>(
    `SELECT parent_id, count(*)::text AS n
       FROM event_reviews
      WHERE parent_id = ANY($1::bigint[]) AND status = 'visible'
      GROUP BY parent_id`,
    [parents.map((parent) => parent.id)],
  );
  const threadSizes = new Map(counts.map((row) => [Number(row.parent_id), Number(row.n)]));

  return {
    reviews: parents.map((parent) => ({
      ...parent,
      replyCount: threadSizes.get(parent.id) ?? 0,
    })),
    hasMore,
  };
}

/**
 * One batch of a thread, oldest first, from a cursor.
 *
 * The same keyset shape as the wall and for the same reason, only forwards: a conversation is read
 * in the order it happened, so the cursor walks down it and a reply posted mid-read cannot shift
 * what the next press returns.
 *
 * The cursor is the last reply's **id**, not its timestamp, and the ordering matches it. A
 * timestamp cursor does not survive the round trip: `created_at` is microsecond-precision in
 * Postgres and the JSON carries `toISOString()`, which is milliseconds, so `created_at > cursor`
 * still matched the very row the cursor came from and every batch repeated its first reply. Within
 * one thread `id` is chronological anyway — `BIGSERIAL` and `now()` increase together — so ordering
 * by it costs nothing and cannot be rounded.
 */
export async function listReplies(
  parentId: number,
  limit: number,
  afterId: number | null,
  viewerId: number | undefined,
  db: Db = pool,
): Promise<{ replies: Review[]; hasMore: boolean }> {
  const { rows } = await db.query<Row>(
    `${SELECT}
      WHERE r.parent_id = $1 AND r.status = 'visible'
        AND ($2::bigint IS NULL OR r.id > $2::bigint)
      ORDER BY r.id ASC
      LIMIT $3`,
    [parentId, afterId, limit + 1],
  );
  return {
    replies: rows.slice(0, limit).map((row) => toReview(row, viewerId)),
    hasMore: rows.length > limit,
  };
}

/**
 * The event's average and count, from the live rows.
 *
 * Derived rather than stored. A counter would have to be corrected on insert, edit, delete and
 * moderation removal — four paths, each able to drift silently — and SC-005 wants the displayed
 * average to equal the mean of visible reviews immediately after every one of them.
 */
export async function summary(eventId: number, db: Db = pool): Promise<ReviewSummary> {
  // Two counts, because they answer different questions. `rated` is how many people scored the
  // event — one row per person, guaranteed by the unique index — and drives the average. `all` is
  // how much has been said, threads included, which belongs beside the comments and not beside the
  // score: a busy argument under one comment is not evidence that more people rated the event.
  // The histogram rides along in the same pass — five more `FILTER` clauses over rows already being
  // scanned, rather than a second round trip for a panel that is always drawn next to the average.
  const { rows } = await db.query<{
    rated: string;
    all: string;
    avg: string | null;
    s1: string;
    s2: string;
    s3: string;
    s4: string;
    s5: string;
  }>(
    `SELECT count(*) FILTER (WHERE rating IS NOT NULL)::text AS rated,
            count(*)::text AS all,
            avg(rating)::text AS avg,
            count(*) FILTER (WHERE rating = 1)::text AS s1,
            count(*) FILTER (WHERE rating = 2)::text AS s2,
            count(*) FILTER (WHERE rating = 3)::text AS s3,
            count(*) FILTER (WHERE rating = 4)::text AS s4,
            count(*) FILTER (WHERE rating = 5)::text AS s5
       FROM event_reviews WHERE event_id = $1 AND status = 'visible'`,
    [eventId],
  );
  const row = rows[0];
  const rated = Number(row?.rated ?? 0);
  return {
    // Null, never 0: an event nobody has rated has not been rated badly.
    rating: rated === 0 ? null : Math.round(Number(row!.avg) * 10) / 10,
    reviewCount: rated,
    commentCount: Number(row?.all ?? 0),
    distribution: [
      Number(row?.s1 ?? 0),
      Number(row?.s2 ?? 0),
      Number(row?.s3 ?? 0),
      Number(row?.s4 ?? 0),
      Number(row?.s5 ?? 0),
    ],
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
