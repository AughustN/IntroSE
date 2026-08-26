/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Gives ~50 catalogue events fresh upcoming showtimes, for a demo.
 *
 * The crawled catalogue is almost entirely stale: 766 approved events carry only the one showtime
 * they were imported with, already in the past, so most of the site (trending row, search results,
 * "sắp diễn ra") has nothing to show. This restocks a curated slice of it — general admission only,
 * so no seat map has to be invented — biased toward the events most likely to look good in a demo:
 * concerts and fan meetings with a named artist, stage shows, sport, then everything else.
 *
 * Each event keeps its own already-pinned venue (`events.venue_id`, backfilled by 0039) rather than
 * being reassigned one, so a real G-Dragon concert stays at the venue it was actually crawled at.
 *
 * DEMO DATA. Invented dates and prices, written to the shared dev database — everyone on the team
 * sees the result. `--undo` puts back exactly what it changed. Re-running clears its own previous
 * rows first, so nothing accumulates.
 *
 *   npx tsx --tsconfig tsconfig.server.json server/scripts/demo-restock-showtimes.ts
 *   npx tsx --tsconfig tsconfig.server.json server/scripts/demo-restock-showtimes.ts --category="Sân khấu"
 *   npx tsx --tsconfig tsconfig.server.json server/scripts/demo-restock-showtimes.ts --undo
 *
 * `--category` scopes the pick to one `event_categories.label_vi` exactly — without it every prior
 * run so far has exhausted "Âm nhạc" first (174 candidates, more than TARGET_COUNT alone), so a
 * plain re-run never reaches the categories after it. `--undo` still clears every marked row
 * regardless of which category produced it, since a single run's rows all carry the same marker.
 */

import { pool } from "../src/db/pool.js";

const TARGET_COUNT = 50;
const MARKER = "[demo-restock]";

/** Fallback for the rare candidate with no venue pinned yet (checked once before promoting). */
const FALLBACK_VENUE_NAME = "Nhà hát Hòa Bình";

type Candidate = {
  id: number;
  category: string;
  venue_id: number | null;
};

/** Cheapest to priciest by category, so a G-Dragon concert doesn't price like a workshop. */
function tierPrices(category: string): { regular: number; vip: number } {
  if (category === "Âm nhạc" || category === "Thể thao") return { regular: 250_000, vip: 550_000 };
  if (category === "Sân khấu") return { regular: 180_000, vip: 380_000 };
  return { regular: 120_000, vip: 250_000 };
}

/** The coming Friday (or today if it already is one) and a week after it, at two times each. */
function showtimeSlots(): Date[] {
  const now = new Date();
  const daysToFriday = (5 - now.getUTCDay() + 7) % 7; // Date#getUTCDay: 0=Sun..6=Sat, 5=Fri
  const friday = new Date(now);
  friday.setUTCDate(friday.getUTCDate() + daysToFriday);

  const at = (base: Date, hourUtc: number) => {
    const d = new Date(base);
    d.setUTCHours(hourUtc, 0, 0, 0);
    return d;
  };
  const nextFriday = new Date(friday);
  nextFriday.setUTCDate(nextFriday.getUTCDate() + 7);

  // 14:00 and 19:30 local (Asia/Ho_Chi_Minh, UTC+7) → 07:00 and 12:30 UTC.
  return [at(friday, 7), at(friday, 12), at(nextFriday, 7)];
}

async function promote(onlyCategory: string | null): Promise<void> {
  const { rows: candidates } = await pool.query<Candidate>(
    `SELECT e.id, ec.label_vi AS category, e.venue_id
       FROM events e JOIN event_categories ec ON ec.id = e.category_id
      WHERE e.event_type = 'general_admission'
        AND e.moderation_status = 'approved'
        AND e.status <> 'cancelled'
        AND e.image_url IS NOT NULL
        AND ($2::text IS NULL OR ec.label_vi = $2)
        AND (SELECT count(*) FROM showtimes s WHERE s.event_id = e.id AND s.starts_at > now()) = 0
      ORDER BY
        CASE ec.label_vi
          WHEN 'Âm nhạc' THEN 0
          WHEN 'Sân khấu' THEN 1
          WHEN 'Thể thao' THEN 2
          ELSE 3
        END,
        e.trailer_url IS NULL,
        array_length(e.lineup, 1) IS NULL,
        e.id
      LIMIT $1`,
    [TARGET_COUNT, onlyCategory],
  );
  if (candidates.length === 0) throw new Error("No candidates found — is this the right database?");

  const { rows: fallback } = await pool.query<{ id: number }>(
    `SELECT id FROM venues WHERE name = $1 LIMIT 1`,
    [FALLBACK_VENUE_NAME],
  );
  const fallbackVenueId = fallback[0]?.id ?? null;

  const slots = showtimeSlots();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let created = 0;
    for (const c of candidates) {
      let venueId = c.venue_id;
      if (venueId === null) {
        if (fallbackVenueId === null) {
          console.warn(`  skip ${c.id} — no venue pinned and no fallback venue found`);
          continue;
        }
        venueId = fallbackVenueId;
        await client.query(`UPDATE events SET venue_id = $2 WHERE id = $1`, [c.id, venueId]);
      }

      await client.query(
        `UPDATE events
            SET status = 'on_sale', release_phase = 'upcoming', updated_at = now()
          WHERE id = $1`,
        [c.id],
      );

      const { regular, vip } = tierPrices(c.category);
      for (const startsAt of slots) {
        const endsAt = new Date(startsAt.getTime() + 150 * 60_000); // 2.5h, GA has no runtime column
        const { rows: showtime } = await client.query<{ id: number }>(
          `INSERT INTO showtimes (event_id, venue_id, starts_at, ends_at, status)
           VALUES ($1, $2, $3, $4, 'on_sale') RETURNING id`,
          [c.id, venueId, startsAt, endsAt],
        );
        await client.query(
          `INSERT INTO ticket_tiers (showtime_id, label, price_amount, total_quantity, description)
           VALUES ($1, 'Vé thường', $2, 300, $4),
                  ($1, 'Vé VIP',    $3,  80, $4)`,
          [showtime[0].id, regular, vip, MARKER],
        );
      }
      created += 1;
    }
    await client.query("COMMIT");
    console.log(`  ${created}/${candidates.length} event được cấp suất chiếu mới (3 suất/event).`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function undo(onlyCategory: string | null): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Scoped to `onlyCategory` when given, so promoting one more category on top of an earlier
    // run's own "clear mine first" does not also clear that earlier run's rows — the two calls are
    // additive, not a redo of the same slice.
    const { rows: mine } = await client.query<{ id: number; event_id: number }>(
      `SELECT DISTINCT s.id, s.event_id
         FROM showtimes s
         JOIN ticket_tiers t ON t.showtime_id = s.id
         JOIN events e ON e.id = s.event_id
         JOIN event_categories ec ON ec.id = e.category_id
        WHERE t.description = $1 AND ($2::text IS NULL OR ec.label_vi = $2)`,
      [MARKER, onlyCategory],
    );
    const showtimeIds = mine.map((r) => r.id);
    const eventIds = [...new Set(mine.map((r) => r.event_id))];

    await client.query(`DELETE FROM ticket_tiers WHERE showtime_id = ANY($1)`, [showtimeIds]);
    const { rowCount } = await client.query(`DELETE FROM showtimes WHERE id = ANY($1)`, [
      showtimeIds,
    ]);

    // Only events left with no OTHER showtime at all revert to 'finished' — one this script also
    // gave a real, organizer-added showtime to in the meantime is not this script's to touch.
    await client.query(
      `UPDATE events e SET status = 'finished', release_phase = 'now_showing', updated_at = now()
        WHERE e.id = ANY($1)
          AND NOT EXISTS (SELECT 1 FROM showtimes s WHERE s.event_id = e.id)`,
      [eventIds],
    );

    await client.query("COMMIT");
    console.log(`  gỡ ${rowCount} suất chiếu khỏi ${eventIds.length} event.`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const undoing = process.argv.includes("--undo");
  const categoryArg = process.argv.find((a) => a.startsWith("--category="));
  const onlyCategory = categoryArg ? categoryArg.slice("--category=".length) : null;
  console.log(
    undoing
      ? "Gỡ dữ liệu demo…"
      : `Cấp suất chiếu mới cho ~50 event${onlyCategory ? ` (${onlyCategory})` : ""}…`,
  );
  await undo(onlyCategory);
  if (!undoing) await promote(onlyCategory);
  await pool.end();
}

void main();
