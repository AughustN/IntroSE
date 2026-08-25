// Every query the AI domain makes. Moved out of ai.service.ts so that file reads as the decision
// flow it is, matching the repo/service split the admin, catalog, and holds modules already use.

import type { AICandidateEvent } from '@shared/ai/types.js';
import { embedQuery, toVectorLiteral } from './embedding/embedding.client.js';
import { AI_REQUEST_LIMIT } from '../../config.js';
import type { Db } from '../../db/pool.js';
import { pool, withTransaction } from '../../db/pool.js';
import { err } from '../../http.js';
import {
  SHOWTIME_HAS_AVAILABILITY,
  UPCOMING_SHOWTIME,
  VISIBLE_JOIN,
  VISIBLE_WHERE,
} from '../catalog/visibility.js';

/** The most candidates one answer may be built from. Small by design — see research.md on retrieval. */
export const CANDIDATE_LIMIT = 20;

/**
 * Where the cut goes, and why it is not a single number.
 *
 * An absolute floor alone does not work. Trigram similarity gives almost any pair of Vietnamese
 * strings a small non-zero score, so a question with no real subject — "có gì hay không" — can
 * scrape past a fixed threshold on exactly one event through shared syllables, and that one lucky
 * row then hides every other event on sale. The failure is silent and reads as "there is only one
 * thing on".
 *
 * So two tests instead. `SIGNAL_FLOOR` asks whether the *best* match means anything at all; below
 * it the question had no lexical subject and the whole soonest-first list stands. Above it,
 * `RELATIVE_FLOOR` keeps what is competitive with that best match and drops the long tail of
 * coincidental syllables.
 */
const SIGNAL_FLOOR = 0.08;
const RELATIVE_FLOOR = 0.25;

/**
 * The events an answer may mention, ranked against what was actually asked.
 *
 * This is the retrieval half of the assistant, and the part that decides what the model is even
 * capable of answering. It used to ignore the question entirely and hand over "the twenty soonest
 * events", which is indistinguishable from working while the catalog holds twenty sellable events
 * and silently wrong the moment it holds a hundred: the model can only rank what it was given, so
 * anything outside that window may as well not exist.
 *
 * Three signals, summed:
 *
 *  - **Full text** over the event's own words, weighted title > line-up/genre > blurb, matched with
 *    `websearch_to_tsquery` so a reader can type a phrase in quotes or a `-word` and have it mean
 *    what it means everywhere else.
 *  - **Trigram on the title**, for the half-remembered and the mistyped, where no whole token
 *    matches but the string is plainly the same one.
 *  - **Trigram on the venue city**, so "ha noi" reaches "Hà Nội" — both sides are unaccented, so
 *    the reader never has to type the tones.
 *
 * Retrieval never narrows the *eligibility* rules: the same visibility, upcoming and availability
 * predicates the public catalog uses are still `WHERE`, not scoring. Relevance decides the order
 * and the cut; it can never promote a draft, a finished event, or one with no tickets left.
 *
 * A question that matches nothing lexically — "có gì hay không" — falls back to soonest-first
 * rather than returning empty, because "nothing matched your words" is not the same answer as
 * "there is nothing on".
 */
/**
 * The dense half: events whose *meaning* is near the question, not whose words are.
 *
 * Lexical retrieval cannot connect "nhạc buồn nhẹ nhàng cuối tuần" to "Đêm nhạc Trịnh Công Sơn" —
 * they share one common noun and nothing else. This is the retriever that can, and it is the only
 * reason there is a model and a sidecar at all.
 *
 * Returns event ids in rank order, or `null` when no vector could be had. Null is not an error: the
 * caller falls back to lexical alone, which needs no model and no network. Ranked per chunk and
 * collapsed to events by best chunk, so an event is as findable as its most relevant part.
 */
async function denseRanking(query: string, limit: number, db: Db): Promise<number[] | null> {
  const vector = await embedQuery(query);
  if (!vector) return null;

  const { rows } = await db.query<{ id: number }>(
    `SELECT e.id
       FROM event_chunks c
       JOIN events e ON e.id = c.event_id ${VISIBLE_JOIN}
       JOIN showtimes s ON ${UPCOMING_SHOWTIME}
      WHERE c.embedding IS NOT NULL AND ${VISIBLE_WHERE} AND ${SHOWTIME_HAS_AVAILABILITY}
      GROUP BY e.id
      HAVING min(c.embedding <=> $1::vector) < 0.72
      ORDER BY min(c.embedding <=> $1::vector)
      LIMIT $2`,
    [toVectorLiteral(vector), limit],
  );
  return rows.map((row) => row.id);
}

/**
 * Reciprocal Rank Fusion.
 *
 * Two rankings produced on scales that have nothing to do with each other — `ts_rank_cd` counts
 * term proximity, cosine distance measures angle — cannot be added or averaged without inventing a
 * conversion nobody can justify. RRF ignores the scores entirely and uses only the positions, so
 * the question becomes "how near the top did each retriever put this?", which is comparable by
 * construction. `k` damps the difference between rank 1 and rank 2 so a single confident retriever
 * cannot dictate the whole list; 60 is the value the original paper uses and it is not tuned here.
 */
const RRF_K = 60;

function fuse(rankings: number[][]): number[] {
  const scores = new Map<number, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, index) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + index + 1));
    });
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

export async function candidates(
  query = '',
  limit = CANDIDATE_LIMIT,
  db: Db = pool,
  options?: { requireSignal?: boolean },
): Promise<AICandidateEvent[]> {
  const terms = query.trim();

  /*
   * A wider pool than we will return.
   *
   * The lexical query is the only place the eligibility predicate is expressed, so it is also the
   * only thing that can turn an id into a candidate — and a dense-only hit is by definition one the
   * lexical ranking placed low or cut. Fetching a multiple of the ceiling leaves the fused list
   * somewhere to promote from; without the headroom, dense retrieval could reorder the lexical top
   * twenty and never introduce anything, which is most of the reason it exists.
   */
  const { ranked, eligible, hasSignal } = await lexicalCandidates(terms, limit * 3, db);

  /*
   * Nothing matched, so send a sample rather than the shelf.
   *
   * With no lexical signal the list is every eligible event in date order — useful as background
   * for "có gì hay không", useless for "giữ ghế bao lâu thì hết hạn", and the same size for both.
   * That size is not free: nineteen events is four thousand characters of JSON the model must read
   * before it can answer a question that was never about events, and reading it is what pushed
   * platform questions past the timeout. Six is the most an answer may contain anyway, so beyond
   * six the extra rows can only cost latency.
   */
  const unfocused = Math.min(limit, 6);

  // No question, no fusion: an empty query has nothing to embed, and the lexical branch has already
  // fallen back to soonest-first, which is the right answer to "what is on".
  if (!terms) {
    return options?.requireSignal ? [] : ranked.slice(0, unfocused);
  }

  const dense = await denseRanking(terms, limit, db);
  if (!dense || !dense.length) {
    if (options?.requireSignal && !hasSignal) return [];
    return ranked.slice(0, hasSignal ? limit : unfocused);
  }

  const byId = new Map(eligible.map((event) => [event.id, event]));

  /*
   * The lexical list only joins the fusion when it actually matched something.
   *
   * With no lexical signal `ranked` is every eligible event in date order, and date order is not a
   * relevance ranking — feeding it to RRF hands the soonest event a rank-1 bonus on every question
   * ever asked. It showed up immediately: the earliest event in the catalog came first for "cần
   * cười thả ga" and for "xem diễn viên trên sân khấu" alike, having nothing to do with either.
   */
  const order = fuse(hasSignal ? [ranked.map((event) => event.id), dense] : [dense]);

  /*
   * Fusion decides the order. Membership is decided by `eligible`, which is the projection carrying
   * the visibility, upcoming and availability predicates — so an event the dense retriever ranks
   * first but which has sold out, finished, or lost approval simply has no row to resolve to and
   * falls out. Relevance never promotes something ineligible; that is the invariant the whole
   * feature rests on.
   */
  const fused = order.flatMap((id) => {
    const event = byId.get(id);
    return event ? [event] : [];
  });

  if (options?.requireSignal && !hasSignal && !fused.length) {
    return [];
  }

  /*
   * The lexical branch decides how many, because it is the only one that can say "no".
   *
   * Dense retrieval always returns a ranking — cosine orders every vector, however far away, so
   * "nothing here is relevant" is not an answer it can give. Sizing the list on whether *it* found
   * something therefore always returns the maximum, which is the bug that let "giữ ghế bao lâu thì
   * hết hạn" ship nineteen events to the model and time out. Lexical silence is the honest signal
   * that the question was not about a particular event, and six is the most an answer may contain.
   */
  const fallback = options?.requireSignal && !hasSignal ? [] : ranked;
  return (fused.length ? fused : fallback).slice(0, hasSignal || dense.length ? limit : unfocused);
}

/**
 * The lexical ranking, and the pool it was drawn from.
 *
 * Two lists out of one query: `ranked` is what full-text and trigram scoring chose, `eligible` is
 * every row that passed the predicates before relevance had an opinion. Fusion needs both — the
 * first as a ranking to fuse, the second as the set it is allowed to draw from.
 */
async function lexicalCandidates(
  query: string,
  limit: number,
  db: Db,
): Promise<{ ranked: AICandidateEvent[]; eligible: AICandidateEvent[]; hasSignal: boolean }> {
  const terms = query.trim();

  const { rows } = await db.query<AICandidateEvent & { relevance: number }>(
    /*
     * `websearch_to_tsquery`, which ANDs the terms. That is stricter than a conversational question
     * usually satisfies, and OR-ing was tried to widen it — measurably worse.
     *
     * The reason is `unaccent`. Stripping tones collapses distinct Vietnamese words onto the same
     * token: "cuối" and "cười" are both `cuoi`. Under AND that costs nothing, because the rest of
     * the query has to match too. Under OR every function word — sự, tôi, cần, có — becomes an
     * independent chance to collide, and "nhạc buồn nhẹ nhàng **cuối** tuần" started retrieving
     * "Đêm **Cười**". Precision fell faster than recall rose.
     *
     * So the lexical branch stays strict and simply stays quiet when a question is phrased rather
     * than keyword-like. That is what the dense retriever is there for, and quiet is handled: a
     * branch with no signal contributes no ranking to the fusion at all.
     */
    `WITH q AS (
       SELECT
         websearch_to_tsquery('simple', immutable_unaccent($1)) AS tsq,
         immutable_unaccent($1) AS raw,
         length(btrim($1)) > 0 AS asked
     )
     SELECT e.id, e.slug, e.title, ec.code AS category, min(v.city) AS city,
            min(s.starts_at)::text AS "startsAt",
            min(tt.price_amount)::bigint AS "startingPrice",
            CASE WHEN (SELECT asked FROM q) THEN
              ts_rank_cd(e.search_doc, (SELECT tsq FROM q))
              + 0.4 * similarity(immutable_unaccent(e.title), (SELECT raw FROM q))
              + 0.3 * max(similarity(immutable_unaccent(v.city), (SELECT raw FROM q)))
            ELSE 0 END AS relevance
       FROM events e ${VISIBLE_JOIN}
       JOIN event_categories ec ON ec.id = e.category_id
       JOIN showtimes s ON ${UPCOMING_SHOWTIME}
       JOIN venues v ON v.id = s.venue_id
       LEFT JOIN ticket_tiers tt ON tt.showtime_id = s.id
      WHERE ${VISIBLE_WHERE} AND ${SHOWTIME_HAS_AVAILABILITY}
      GROUP BY e.id, e.slug, e.title, e.search_doc, ec.code
      ORDER BY relevance DESC, min(s.starts_at), e.id
      LIMIT $2`,
    [terms, limit],
  );

  /*
   * The query is already ordered by relevance, so the best score is the first row's.
   *
   * Below the signal floor, relevance is not merely too weak to filter on — it is too weak to
   * *order* on. Leaving the SQL ordering in place there lets a coincidental syllable float a distant
   * event above the one happening tomorrow, which is the wrong answer to "có gì hay không" even
   * though every event is present. So the fallback re-sorts by what the reader actually meant:
   * soonest first.
   */
  const best = Number(rows[0]?.relevance ?? 0);
  const chosen =
    best < SIGNAL_FLOOR
      ? [...rows].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id - b.id)
      : rows.filter((row) => Number(row.relevance) >= best * RELATIVE_FLOOR);

  // `bigint` arrives as a string from pg; money crosses this boundary as a number and never a float.
  // `relevance` is retrieval's own working, not part of the contract, so it stops here.
  const clean = (row: (typeof rows)[number]): AICandidateEvent => {
    const { relevance: _relevance, ...rest } = row;
    return { ...rest, startingPrice: rest.startingPrice === null ? null : Number(rest.startingPrice) };
  };

  return { ranked: chosen.map(clean), eligible: rows.map(clean), hasSignal: best >= SIGNAL_FLOOR };
}

/**
 * What this attendee has bought, saved, or looked at, as category codes.
 *
 * `userId` is the server-injected session identity and the only parameter. The model never supplies
 * an identifier and no caller may pass one from a request body, so no prompt can widen the scope of
 * these reads (Principle II, Principle III).
 */
export async function categoryContext(
  userId: number,
  source: 'purchased' | 'saved' | 'viewed',
  db: Db = pool,
): Promise<string[]> {
  const sql =
    source === 'purchased'
      ? `SELECT ec.code FROM tickets t
           JOIN orders o ON o.id = t.order_id
           JOIN reservation_items ri ON ri.id = t.reservation_item_id
           JOIN ticket_tiers tt ON tt.id = ri.ticket_tier_id
           JOIN showtimes s ON s.id = tt.showtime_id
           JOIN events e ON e.id = s.event_id
           JOIN event_categories ec ON ec.id = e.category_id
          WHERE o.user_id = $1 GROUP BY ec.code ORDER BY count(*) DESC`
      : source === 'saved'
        ? `SELECT ec.code FROM user_event_bookmarks b
             JOIN events e ON e.id = b.event_id
             JOIN event_categories ec ON ec.id = e.category_id
            WHERE b.user_id = $1 GROUP BY ec.code ORDER BY max(b.created_at) DESC`
        : `SELECT ec.code FROM user_event_views h
             JOIN events e ON e.id = h.event_id
             JOIN event_categories ec ON ec.id = e.category_id
            WHERE h.user_id = $1 GROUP BY ec.code ORDER BY max(h.viewed_at) DESC`;
  return (await db.query<{ code: string }>(sql, [userId])).rows.map((row) => row.code);
}

/**
 * The outcome of asking for permission to make a model call.
 *
 * Three states rather than a boolean plus an exception, because the two refusals mean opposite
 * things to the caller: a personal one is the attendee's own limit and is reported as a 429, a
 * platform one is an operational ceiling nobody should see as an error (UC-10 A2 vs A3).
 */
export type AllowanceResult = { ok: true } | { ok: false; reason: 'user' | 'platform' };

/**
 * The start of the platform window a given instant falls in.
 *
 * Epoch-aligned so the boundary is deterministic and identical in every process: with a 24-hour
 * window every server agrees on the same midnight UTC, and changing the setting simply re-buckets
 * from the next request onward without needing a migration or a reset.
 */
export function platformWindowStart(windowHours: number, at: number = Date.now()): Date {
  const windowMs = Math.max(1, windowHours) * 60 * 60 * 1000;
  return new Date(Math.floor(at / windowMs) * windowMs);
}

/**
 * Consume one unit of the attendee's hourly allowance and one of the platform window's.
 *
 * Both counters move inside one transaction under row locks, so two concurrent requests cannot both
 * read nine and both write ten, and the two numbers can never disagree about whether a call was
 * authorised. Callers must only reach here after a cache miss — the allowance exists to bound model
 * cost, and a cached answer costs nothing (UC-10 A1).
 */
export async function consumeAllowance(
  userId: number,
  platformCeiling: number,
  windowHours: number,
): Promise<AllowanceResult> {
  const windowStart = platformWindowStart(windowHours);

  return withTransaction(async (db) => {
    await db.query(
      `INSERT INTO ai_usage_windows (window_started_at, request_count) VALUES ($1, 0)
       ON CONFLICT (window_started_at) DO NOTHING`,
      [windowStart],
    );
    const platform = await db.query<{ request_count: number }>(
      'SELECT request_count FROM ai_usage_windows WHERE window_started_at = $1 FOR UPDATE',
      [windowStart],
    );
    if ((platform.rows[0]?.request_count ?? 0) >= platformCeiling) return { ok: false, reason: 'platform' };

    await db.query(
      `INSERT INTO ai_request_limits (user_id, window_started_at, request_count)
       VALUES ($1, date_trunc('hour', now()), 0) ON CONFLICT (user_id) DO NOTHING`,
      [userId],
    );
    const { rows } = await db.query<{ window_started_at: string; request_count: number }>(
      'SELECT window_started_at, request_count FROM ai_request_limits WHERE user_id = $1 FOR UPDATE',
      [userId],
    );
    const current = rows[0]!;
    const sameHour =
      new Date(current.window_started_at).getTime() >= new Date(new Date().setMinutes(0, 0, 0)).getTime();
    if (sameHour && current.request_count >= AI_REQUEST_LIMIT) return { ok: false, reason: 'user' };

    await db.query(
      `UPDATE ai_request_limits
          SET window_started_at = CASE WHEN $2 THEN window_started_at ELSE date_trunc('hour', now()) END,
              request_count = CASE WHEN $2 THEN request_count + 1 ELSE 1 END
        WHERE user_id = $1`,
      [userId, sameHour],
    );
    await db.query(
      'UPDATE ai_usage_windows SET request_count = request_count + 1, updated_at = now() WHERE window_started_at = $1',
      [windowStart],
    );
    return { ok: true };
  });
}

export async function cacheGet<T>(
  kind: 'chat' | 'listing',
  userId: number,
  key: string,
  db: Db = pool,
): Promise<T | null> {
  const { rows } = await db.query<{ response: T }>(
    `SELECT response FROM ai_response_cache
      WHERE kind = $1 AND user_id = $2 AND cache_key = $3 AND expires_at > now()`,
    [kind, userId, key],
  );
  return rows[0]?.response ?? null;
}

export async function cachePut(
  kind: 'chat' | 'listing',
  userId: number,
  key: string,
  response: unknown,
  ttlMs: number,
  db: Db = pool,
): Promise<void> {
  await db.query(
    `INSERT INTO ai_response_cache (kind, user_id, cache_key, response, expires_at)
     VALUES ($1, $2, $3, $4::jsonb, now() + $5 * interval '1 millisecond')
     ON CONFLICT (kind, user_id, cache_key)
     DO UPDATE SET response = EXCLUDED.response, expires_at = EXCLUDED.expires_at, created_at = now()`,
    [kind, userId, key, JSON.stringify(response), ttlMs],
  );
}

/** Resolve a slug to an id, refusing anything the public catalog would not show. */
async function visibleEventId(slug: string, db: Db = pool): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT e.id FROM events e ${VISIBLE_JOIN} WHERE e.slug = $1 AND ${VISIBLE_WHERE}`,
    [slug],
  );
  if (!rows[0]) throw err.notFound('not_found', 'Không tìm thấy sự kiện.');
  return rows[0].id;
}

export async function toggleBookmark(userId: number, slug: string, db: Db = pool): Promise<{ saved: boolean }> {
  const eventId = await visibleEventId(slug, db);
  const removed = await db.query(
    'DELETE FROM user_event_bookmarks WHERE user_id = $1 AND event_id = $2 RETURNING event_id',
    [userId, eventId],
  );
  if (removed.rowCount) return { saved: false };
  await db.query('INSERT INTO user_event_bookmarks (user_id, event_id) VALUES ($1, $2)', [userId, eventId]);
  return { saved: true };
}

export async function listBookmarks(userId: number, db: Db = pool): Promise<string[]> {
  return (
    await db.query<{ slug: string }>(
      `SELECT e.slug FROM user_event_bookmarks b JOIN events e ON e.id = b.event_id ${VISIBLE_JOIN}
        WHERE b.user_id = $1 AND ${VISIBLE_WHERE} ORDER BY b.created_at DESC`,
      [userId],
    )
  ).rows.map((row) => row.slug);
}

export async function recordEventView(userId: number, slug: string, db: Db = pool): Promise<void> {
  const eventId = await visibleEventId(slug, db);
  await db.query(
    `INSERT INTO user_event_views (user_id, event_id, viewed_at) VALUES ($1, $2, now())
     ON CONFLICT (user_id, event_id) DO UPDATE SET viewed_at = EXCLUDED.viewed_at`,
    [userId, eventId],
  );
}
