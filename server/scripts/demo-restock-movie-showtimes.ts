/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Gives 20 shelved films a full "sắp chiếu" schedule — 50 showtimes each, spread across 39 real
 * cinemas in 8 provinces and 9 days starting 29/08 — for a demo.
 *
 * The catalogue holds 279 approved films, 253 of them `seated` and crawled with a single showtime
 * already in the past. Same reasoning as `demo-upcoming-movies.ts` (that script's own comment
 * explains it fully): promoted films go to `general_admission` rather than getting an invented seat
 * map, because a map nobody drew is a worse lie than a ticket count.
 *
 * Unlike that script, this one gives each film SEVERAL cinemas across SEVERAL cities — a real film
 * plays at many cinemas at once, and `showtimes.venue_id` has always varied per row for these crawled
 * movies (the single-venue pin added in 0039 is an organizer-console rule for newly created events,
 * not retrofitted onto this legacy catalogue).
 *
 * DEMO DATA. Invented dates and prices, written to the shared dev database. `--undo` puts back
 * exactly what it changed. Re-running clears its own previous rows first.
 *
 *   npx tsx --tsconfig tsconfig.server.json server/scripts/demo-restock-movie-showtimes.ts
 *   npx tsx --tsconfig tsconfig.server.json server/scripts/demo-restock-movie-showtimes.ts --undo
 */

import { pool } from "../src/db/pool.js";

const MOVIE_COUNT = 20;
const SHOWTIMES_PER_MOVIE = 50;
const MARKER = "[demo-restock-movies]";
const REGULAR_PRICE = 75_000;
const VIP_PRICE = 135_000;

type Candidate = { id: number; title: string; duration_minutes: number | null };
type Venue = { id: number; city: string };

/** Local (Asia/Ho_Chi_Minh, UTC+7) showtimes a real cinema actually runs. */
const LOCAL_HOURS = [9, 11.5, 14, 16.5, 19, 21];

/** 29/08 of the current run's year, at each of the six daily slots, for nine days running. */
function slots(): Date[] {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), 7, 29)); // month 7 = August
  // If the 29th has already passed this year (script run in autumn), roll to next year so the
  // schedule is never invented in the past.
  if (start.getTime() < now.getTime()) start.setUTCFullYear(start.getUTCFullYear() + 1);

  const out: Date[] = [];
  for (let day = 0; day < 9; day += 1) {
    for (const localHour of LOCAL_HOURS) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + day);
      d.setUTCHours(Math.floor(localHour) - 7, (localHour % 1) * 60, 0, 0);
      out.push(d);
    }
  }
  return out.slice(0, SHOWTIMES_PER_MOVIE);
}

async function promote(): Promise<void> {
  const { rows: candidates } = await pool.query<Candidate>(
    `SELECT e.id, e.title, e.duration_minutes
       FROM events e JOIN event_categories ec ON ec.id = e.category_id
      WHERE ec.label_vi = 'Phim'
        AND e.moderation_status = 'approved'
        AND e.image_url IS NOT NULL AND e.trailer_url IS NOT NULL
        AND e.description IS NOT NULL AND length(e.description) > 20
        AND (SELECT count(*) FROM showtimes s WHERE s.event_id = e.id AND s.starts_at > now()) = 0
      ORDER BY e.id
      LIMIT $1`,
    [MOVIE_COUNT],
  );
  if (candidates.length === 0) throw new Error("No movie candidates found — is this the right database?");

  const { rows: cinemas } = await pool.query<Venue>(
    `SELECT id, city FROM venues
      WHERE name ILIKE '%CGV%' OR name ILIKE '%Lotte%' OR name ILIKE '%Cinestar%' OR name ILIKE '%Galaxy%'
         OR name ILIKE '%BHD%' OR name ILIKE '%rạp%' OR name ILIKE '%cinema%' OR name ILIKE '%chiếu phim%'
      ORDER BY id`,
  );
  if (cinemas.length === 0) throw new Error("No cinema venues found — is this the right database?");

  const slotTimes = slots();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const [index, movie] of candidates.entries()) {
      await client.query(
        `UPDATE events
            SET status = 'on_sale', moderation_status = 'approved',
                event_type = 'general_admission', release_phase = 'upcoming', updated_at = now()
          WHERE id = $1`,
        [movie.id],
      );

      const runtime = movie.duration_minutes ?? 110;
      for (const [slotIndex, startsAt] of slotTimes.entries()) {
        // Every film starts from a different point in the cinema list, so two films opening the
        // same day are not both premiering at the exact same set of theatres.
        const venue = cinemas[(index * 7 + slotIndex) % cinemas.length];
        const endsAt = new Date(startsAt.getTime() + runtime * 60_000);

        const { rows: showtime } = await client.query<{ id: number }>(
          `INSERT INTO showtimes (event_id, venue_id, starts_at, ends_at, status)
           VALUES ($1, $2, $3, $4, 'on_sale') RETURNING id`,
          [movie.id, venue.id, startsAt, endsAt],
        );
        await client.query(
          `INSERT INTO ticket_tiers (showtime_id, label, price_amount, total_quantity, description)
           VALUES ($1, 'Vé thường', $2, 120, $4),
                  ($1, 'Vé VIP',    $3,  40, $4)`,
          [showtime[0].id, REGULAR_PRICE, VIP_PRICE, MARKER],
        );
      }
      console.log(`  ${movie.id}  ${movie.title} — ${slotTimes.length} suất, ${cinemas.length} rạp`);
    }

    await client.query("COMMIT");
    console.log(`  ${candidates.length} phim được cấp lịch chiếu mới.`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function undo(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: mine } = await client.query<{ id: number; event_id: number }>(
      `SELECT DISTINCT s.id, s.event_id
         FROM showtimes s
         JOIN ticket_tiers t ON t.showtime_id = s.id
        WHERE t.description = $1`,
      [MARKER],
    );
    const showtimeIds = mine.map((r) => r.id);
    const eventIds = [...new Set(mine.map((r) => r.event_id))];

    await client.query(`DELETE FROM ticket_tiers WHERE showtime_id = ANY($1)`, [showtimeIds]);
    const { rowCount } = await client.query(`DELETE FROM showtimes WHERE id = ANY($1)`, [
      showtimeIds,
    ]);

    // Only revert events this script's own rows were the ONLY showtimes for — one that also
    // picked up a real, organizer-added showtime in the meantime keeps its current schedule.
    await client.query(
      `UPDATE events e SET status = 'finished', event_type = 'seated',
              release_phase = 'now_showing', updated_at = now()
        WHERE e.id = ANY($1)
          AND NOT EXISTS (SELECT 1 FROM showtimes s WHERE s.event_id = e.id)`,
      [eventIds],
    );

    await client.query("COMMIT");
    console.log(`  gỡ ${rowCount} suất chiếu khỏi ${eventIds.length} phim.`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const undoing = process.argv.includes("--undo");
  console.log(undoing ? "Gỡ lịch chiếu demo…" : "Cấp lịch chiếu mới cho 20 phim sắp chiếu…");
  await undo();
  if (!undoing) await promote();
  await pool.end();
}

void main();
