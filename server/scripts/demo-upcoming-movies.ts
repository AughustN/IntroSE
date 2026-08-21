/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Puts ten shelved films back on sale with invented showtimes, for a demo.
 *
 * The catalogue holds 262 films that were imported as `finished` with no showtimes at all, against
 * 17 that are actually sellable — so "Phim sắp chiếu" on the landing page draws from a very thin
 * pool. This promotes ten of them so the band has something to show.
 *
 * DEMO DATA. It invents dates and prices that describe nothing real, and it writes to the shared
 * dev database, so everyone on the team sees the result. `--undo` puts back exactly what it
 * changed: the ten go back to `finished` and the showtimes and tiers this script created are
 * deleted. Nothing else is touched, and running it twice does not double up.
 *
 *   npx tsx --tsconfig tsconfig.server.json server/scripts/demo-upcoming-movies.ts
 *   npx tsx --tsconfig tsconfig.server.json server/scripts/demo-upcoming-movies.ts --undo
 */

import { pool } from "../src/db/pool.js";

/**
 * The ten, each already carrying a poster, a trailer and a real synopsis.
 *
 * The trailer is the part worth being strict about: it is what `HeroVideo` plays at the top of the
 * landing page, so a promoted film without one turns the hero into a still. Artwork and a synopsis
 * matter for the same reason at card size — a demo band of grey boxes shows the layout and nothing
 * else. 221 films in the catalogue meet all three, so there is no reason to settle for fewer.
 *
 * Pinned by id rather than picked by query at run time, so `--undo` reverses the same ten this run
 * promoted even if the catalogue moves underneath it.
 */
const MOVIE_IDS = [818, 815, 813, 812, 809, 801, 797, 794, 789, 781];

/** Cinemas, so an invented schedule at least names a plausible place. */
const VENUE_NAMES = [
  "Cụm Rạp Chiếu Phim CGV Landmark 81",
  "Nhà hát Hòa Bình",
  "Sân Vận Động Quân Khu 7",
];

/**
 * Marks every row this script creates.
 *
 * Showtimes carry no free-text column of their own, so the marker rides on the tiers' `description`
 * and the showtimes are found through them. Without a marker `--undo` would have to guess which
 * showtimes were invented and which an organizer added afterwards, and guessing wrong deletes
 * somebody's real work.
 */
const MARKER = "[demo-upcoming]";

/** 18:00 local (11:00Z) on the day `dayOffset` days from now, then every 3 hours. */
function showtimeStarts(dayOffset: number, slot: number): Date {
  const at = new Date();
  at.setUTCHours(11, 0, 0, 0);
  at.setUTCDate(at.getUTCDate() + dayOffset);
  at.setUTCHours(at.getUTCHours() + slot * 3);
  return at;
}

async function promote(): Promise<void> {
  const { rows: venues } = await pool.query<{ id: number }>(
    `SELECT id FROM venues WHERE name = ANY($1) ORDER BY id`,
    [VENUE_NAMES],
  );
  if (venues.length === 0) throw new Error("No demo venue found — is this the right database?");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const [index, eventId] of MOVIE_IDS.entries()) {
      const { rows: found } = await client.query<{ title: string; duration_minutes: number | null }>(
        `SELECT title, duration_minutes FROM events WHERE id = $1`,
        [eventId],
      );
      if (found.length === 0) {
        console.warn(`  skip ${eventId} — no such event`);
        continue;
      }
      const runtime = found[0].duration_minutes ?? 110;

      /*
       * General admission, not seated.
       *
       * The films already on sale are `seated` and hang off a seat-map layout each. Inventing ten
       * more of those means inventing ten seat maps, and a map full of seats nobody drew is a
       * worse lie than a ticket count. GA needs only a quantity, and the booking flow supports it
       * end to end.
       */
      await client.query(
        `UPDATE events
            SET status = 'on_sale', moderation_status = 'approved',
                event_type = 'general_admission', release_phase = 'upcoming', updated_at = now()
          WHERE id = $1`,
        [eventId],
      );

      // Three days out, three showings a day: enough for the date filter to have something to do.
      for (let day = 2; day <= 4; day += 1) {
        for (let slot = 0; slot < 3; slot += 1) {
          const startsAt = showtimeStarts(day + index, slot);
          const endsAt = new Date(startsAt.getTime() + runtime * 60_000);
          const venueId = venues[(index + day + slot) % venues.length].id;

          const { rows: showtime } = await client.query<{ id: number }>(
            `INSERT INTO showtimes (event_id, venue_id, starts_at, ends_at, status)
             VALUES ($1, $2, $3, $4, 'on_sale') RETURNING id`,
            [eventId, venueId, startsAt, endsAt],
          );

          await client.query(
            `INSERT INTO ticket_tiers (showtime_id, label, price_amount, total_quantity, description)
             VALUES ($1, 'Vé thường', 75000, 120, $2),
                    ($1, 'Vé VIP',   135000,  40, $2)`,
            [showtime[0].id, MARKER],
          );
        }
      }
      console.log(`  ${eventId}  ${found[0].title} — 9 suất`);
    }

    await client.query("COMMIT");
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

    /*
     * Tiers first, then the showtimes they hang off.
     *
     * `ticket_tiers.showtime_id` has no ON DELETE CASCADE, so deleting the showtime while its tiers
     * are still there is a foreign-key violation. It only shows up on the second run — the first
     * has nothing to undo and sails past.
     *
     * Both statements are narrowed to the marker, so a showtime an organizer added to one of these
     * films in the meantime has no marked tier, is not collected here, and is left alone.
     */
    const { rows: mine } = await client.query<{ id: number }>(
      `SELECT DISTINCT s.id
         FROM showtimes s
         JOIN ticket_tiers t ON t.showtime_id = s.id
        WHERE s.event_id = ANY($1) AND t.description = $2`,
      [MOVIE_IDS, MARKER],
    );
    const ids = mine.map((row) => row.id);

    await client.query(`DELETE FROM ticket_tiers WHERE showtime_id = ANY($1)`, [ids]);
    const { rowCount } = await client.query(`DELETE FROM showtimes WHERE id = ANY($1)`, [ids]);

    await client.query(
      `UPDATE events SET status = 'finished', event_type = 'seated',
              release_phase = 'now_showing', updated_at = now()
        WHERE id = ANY($1)`,
      [MOVIE_IDS],
    );

    await client.query("COMMIT");
    console.log(`  gỡ ${rowCount} suất chiếu, ${MOVIE_IDS.length} phim về 'finished'`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const undoing = process.argv.includes("--undo");
  console.log(undoing ? "Gỡ dữ liệu demo…" : "Đưa 10 phim thành sắp chiếu…");
  // Re-runnable: promoting always clears its own previous rows first, so nothing accumulates.
  await undo();
  if (!undoing) await promote();
  await pool.end();
}

void main();
