import type { Db } from "../../../db/pool.js";
import { pool } from "../../../db/pool.js";
import { AI_MIN_COMPARABLES } from "../../../config.js";
import { VISIBLE_JOIN, VISIBLE_WHERE } from "../../catalog/visibility.js";

/**
 * The price suggestion, computed in SQL (FR-033, R-6).
 *
 * The model is never asked for a price and never shown one to repeat back. A prompt that *asks* a
 * model not to invent a number is an instruction; a system that never lets it produce one is a
 * guarantee — and the price is the only genuinely factual value in the whole suggestion, so moving it
 * out of the model removes essentially all the grounding risk for the cost of one aggregate.
 *
 * It is also simply a better suggestion: a median of what comparable events actually charge is more
 * useful to an organizer than a language model's guess.
 */

export interface PriceSuggestion {
  price: number;
  basis: number;
}

/**
 * Median active-tier price across publicly-visible events in the same category and city that still
 * have an upcoming showtime. Returns null below `AI_MIN_COMPARABLES`, because a "median" of two
 * events is not a market rate — better to omit the suggestion than to invent confidence.
 */
export async function suggestPrice(
  categoryCode: string | undefined,
  city: string | undefined,
  db: Db = pool,
): Promise<PriceSuggestion | null> {
  if (!categoryCode) return null;

  const { rows } = await db.query<{ median: string | null; basis: number }>(
    `WITH comparable AS (
       SELECT DISTINCT e.id, tt.price_amount
         FROM events e
         ${VISIBLE_JOIN}
         JOIN event_categories ec ON ec.id = e.category_id
         JOIN showtimes s ON s.event_id = e.id
         JOIN venues v ON v.id = s.venue_id
         JOIN ticket_tiers tt ON tt.showtime_id = s.id
        WHERE ${VISIBLE_WHERE}
          AND ec.code = $1
          AND ($2::text IS NULL OR v.city = $2)
          AND s.starts_at > now()
          AND s.status NOT IN ('cancelled', 'finished')
          AND tt.archived_at IS NULL
          AND tt.price_amount > 0
     )
     SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY price_amount)::text AS median,
            count(DISTINCT id)::int AS basis
       FROM comparable`,
    [categoryCode, city ?? null],
  );

  const row = rows[0];
  if (!row || row.median === null || row.basis < AI_MIN_COMPARABLES) return null;

  // Whole đồng only — a median can land on a half (STD-03).
  return { price: Math.round(Number(row.median)), basis: row.basis };
}
