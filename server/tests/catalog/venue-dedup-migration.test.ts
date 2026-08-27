import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { makeApprovedOrganizer, registerUser } from "../helpers/authFixture.js";

/**
 * Migration 0046's merge, exercised as the SQL that actually ships.
 *
 * The file is read from disk rather than copied into the test, so a change to the migration that
 * breaks the merge fails here instead of passing against a stale duplicate of it.
 *
 * Everything runs inside ONE transaction that is always rolled back. That matters twice over: the
 * unique index the migration adds makes duplicate rows unseedable, so the test has to drop it to
 * create the mess it is testing the cleanup of — and a rolled-back transaction puts it back even if
 * an assertion throws. DDL is transactional in Postgres, which is what makes this safe.
 */
const MIGRATION = readFileSync(
  join(process.cwd(), "server/src/db/migrations/0046_venue_dedup.sql"),
  "utf8",
);
/** The merge half only. The CREATE INDEX at the end already ran; re-running it proves nothing. */
const MERGE = MIGRATION.slice(MIGRATION.indexOf("DO $$"), MIGRATION.indexOf("END $$;") + 7);

describe("0046 — merging duplicate venues", () => {
  it("keeps the lowest in-use row, repoints everything at it, and drops the rest", async () => {
    const owner = await registerUser();
    const organizerId = await makeApprovedOrganizer(owner.userId);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DROP INDEX uq_venues_owner_place");

      // Four rows for one hall — the shape the wizard made by being run four times. Typed slightly
      // differently each time, because that is how a person retypes an address.
      const ids: number[] = [];
      for (const [name, city, addr] of [
        ["Nhà hát Hoà Bình", "TP.HCM", "240 3 tháng 2"],
        ["nhà hát hoà bình", "tp.hcm", "240  3 tháng 2 "],
        ["  Nhà hát Hoà Bình", "TP.HCM ", "240 3 tháng 2"],
        ["NHÀ HÁT HOÀ BÌNH", "TP.HCM", " 240 3 tháng 2"],
      ]) {
        const { rows } = await client.query<{ id: number }>(
          `INSERT INTO venues (created_by, name, city, raw_address) VALUES ($1,$2,$3,$4) RETURNING id`,
          [owner.userId, name, city, addr],
        );
        ids.push(rows[0].id);
      }
      const [first, empty1, empty2, second] = ids;

      // Dependents on the FIRST and the LAST, with the two in the middle untouched — the live
      // branch's actual cluster, where both anchored rows carry a real event.
      const layoutOf = async (venueId: number, name: string) =>
        (
          await client.query<{ id: number }>(
            `INSERT INTO venue_layouts (venue_id, name) VALUES ($1,$2) RETURNING id`,
            [venueId, name],
          )
        ).rows[0].id;
      await layoutOf(first, "Sơ đồ chính");
      // Same NAME on the other venue: venue_layouts is UNIQUE (venue_id, name), so the merge has to
      // rename this one rather than fall over.
      const movedLayout = await layoutOf(second, "Sơ đồ chính");

      const eventOf = async (venueId: number, title: string) =>
        (
          await client.query<{ id: number }>(
            `INSERT INTO events (slug, organizer_id, category_id, title, description, venue_id, status)
             VALUES ($4, $1,
                     (SELECT id FROM event_categories ORDER BY id LIMIT 1),
                     $2, 'd', $3::bigint, 'draft') RETURNING id`,
            [organizerId, title, venueId, `${title}-${venueId}-${Date.now()}`],
          )
        ).rows[0].id;
      const eventA = await eventOf(first, "Đêm nhạc A");
      const eventB = await eventOf(second, "Đêm nhạc B");

      const showtimeOf = async (eventId: number, venueId: number) =>
        (
          await client.query<{ id: number }>(
            `INSERT INTO showtimes (event_id, venue_id, starts_at)
             VALUES ($1,$2, now() + interval '1 day') RETURNING id`,
            [eventId, venueId],
          )
        ).rows[0].id;
      const stA = await showtimeOf(eventA, first);
      const stB = await showtimeOf(eventB, second);

      await client.query(MERGE);

      const { rows: left } = await client.query<{ id: number }>(
        `SELECT id FROM venues WHERE created_by = $1 ORDER BY id`,
        [owner.userId],
      );
      expect(
        left.map((r) => Number(r.id)),
        "one row survives, and it is the lowest id already in use",
      ).toEqual([first]);

      // Nothing is orphaned: every dependent of every deleted row now names the survivor.
      for (const [table, id] of [
        ["events", eventA],
        ["events", eventB],
        ["showtimes", stA],
        ["showtimes", stB],
      ] as const) {
        const { rows } = await client.query<{ venue_id: number }>(
          `SELECT venue_id FROM ${table} WHERE id = $1`,
          [id],
        );
        expect(Number(rows[0].venue_id), `${table} #${id} follows the merge`).toBe(first);
      }

      const { rows: charts } = await client.query<{ id: number; venue_id: number; name: string }>(
        `SELECT id, venue_id, name FROM venue_layouts WHERE venue_id = $1 ORDER BY id`,
        [first],
      );
      expect(charts.length, "both charts moved across").toBe(2);
      const renamed = charts.find((c) => Number(c.id) === movedLayout);
      expect(renamed?.name, "the name clash is suffixed, not refused").toBe(
        `Sơ đồ chính (#${movedLayout})`,
      );

      // The two rows nothing pointed at are simply gone.
      const { rows: gone } = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM venues WHERE id = ANY($1::bigint[])`,
        [[empty1, empty2]],
      );
      expect(gone[0].n).toBe("0");
    } finally {
      // Always: the index is restored by the rollback, whether the assertions passed or threw.
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("leaves the unique index enforcing the rule afterwards", async () => {
    const owner = await registerUser();
    const place = ["Sân vận động Mỹ Đình", "Hà Nội", "1 Lê Đức Thọ"];
    await pool.query(
      `INSERT INTO venues (created_by, name, city, raw_address) VALUES ($1,$2,$3,$4)`,
      [owner.userId, ...place],
    );

    // Straight at the table, bypassing `createVenue` entirely — the constraint, not the application
    // rule, is what is under test here.
    await expect(
      pool.query(`INSERT INTO venues (created_by, name, city, raw_address) VALUES ($1,$2,$3,$4)`, [
        owner.userId,
        "  sân vận động MỸ ĐÌNH ",
        "hà nội",
        "1  Lê Đức Thọ",
      ]),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
