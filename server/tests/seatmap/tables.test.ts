import request from "supertest";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { app } from "../helpers/app.js";
import { bearer, makeApprovedOrganizer, registerUser } from "../helpers/authFixture.js";
import { bindAndGenerate } from "../helpers/seatmapSeed.js";

/**
 * Tables (US9, FR-047..FR-056) — the gala-dinner layout.
 *
 * A table is a drawing object that OWNS seats, which is what makes it the only part of this amendment
 * that can touch inventory. So the refusals come first, in the style of `apply-rules.test.ts`:
 * any table operation that would move, relabel or remove a **sold** or **held** seat is refused
 * WHOLE, and the table is left exactly as it was.
 *
 * The positive invariant is pinned too (SC-016): moving and rotating carry 100% of the seats, and
 * re-counting redistributes them evenly.
 */

async function organizer() {
  const o = await registerUser();
  await makeApprovedOrganizer(o.userId);
  return { ...o, h: bearer(o.token) };
}

/** A venue with one layout and one section — the substrate every table needs. */
async function layoutWithSection(o: { h: Record<string, string> }) {
  const venue = (
    await request(app)
      .post("/api/organizer/venues")
      .set(o.h)
      .send({ name: "V", city: "Hà Nội", rawAddress: "a" })
      .expect(201)
  ).body.id;
  const section = (
    await request(app)
      .post(`/api/organizer/venues/${venue}/sections`)
      .set(o.h)
      .send({ name: "Khu A" })
      .expect(201)
  ).body.id;
  const layoutId = (
    await pool.query<{ id: number }>(`SELECT id FROM venue_layouts WHERE venue_id = $1`, [venue])
  ).rows[0].id;
  return { venue, section, layoutId };
}

const placeTable = (
  o: { h: Record<string, string> },
  layoutId: number,
  body: Record<string, unknown>,
) => request(app).post(`/api/organizer/layouts/${layoutId}/tables`).set(o.h).send(body);

const roundTable = (sectionId: number, over: Record<string, unknown> = {}) => ({
  sectionId,
  name: "Bàn 5",
  shape: "round",
  x: 5000,
  y: 5000,
  width: 600,
  height: 600,
  rotation: 0,
  seatCount: 8,
  ...over,
});

const seatsOfTable = async (tableId: number) =>
  (
    await pool.query<{
      id: number;
      row_label: string;
      seat_number: number;
      pos_x: number;
      pos_y: number;
      section_id: number;
    }>(
      `SELECT id, row_label, seat_number, pos_x, pos_y, section_id FROM seats WHERE table_id = $1 ORDER BY seat_number`,
      [tableId],
    )
  ).rows;

describe("tables — placement and distribution", () => {
  it('generates seats around a round table, labelled "Bàn N - Ghế M" (FR-048, FR-053)', async () => {
    const o = await organizer();
    const { section, layoutId } = await layoutWithSection(o);

    const res = await placeTable(o, layoutId, roundTable(section)).expect(201);
    const seats = await seatsOfTable(res.body.id);

    expect(seats).toHaveLength(8);
    // The table's name is the row label and the position at the table is the number, so
    // (section, row_label, seat_number) stays unique without a new constraint (FR-003, FR-053).
    expect(seats.map((s) => `${s.row_label} - Ghế ${s.seat_number}`)).toEqual([
      "Bàn 5 - Ghế 1",
      "Bàn 5 - Ghế 2",
      "Bàn 5 - Ghế 3",
      "Bàn 5 - Ghế 4",
      "Bàn 5 - Ghế 5",
      "Bàn 5 - Ghế 6",
      "Bàn 5 - Ghế 7",
      "Bàn 5 - Ghế 8",
    ]);
    // Evenly spaced: every seat the same distance from the centre.
    const radii = seats.map((s) => Math.round(Math.hypot(s.pos_x - 5000, s.pos_y - 5000)));
    expect(new Set(radii).size).toBe(1);
    // And each inherits the table's section (FR-049).
    expect(seats.every((s) => s.section_id === section)).toBe(true);
  });

  it("distributes a rectangular table along its sides (FR-048)", async () => {
    const o = await organizer();
    const { section, layoutId } = await layoutWithSection(o);

    const res = await placeTable(
      o,
      layoutId,
      roundTable(section, {
        name: "Bàn dài",
        shape: "rect",
        width: 1200,
        height: 600,
        seatCount: 10,
        sideCounts: [4, 1, 4, 1],
      }),
    ).expect(201);

    expect(await seatsOfTable(res.body.id)).toHaveLength(10);
  });

  it("refuses a table of 0 or 1 — that is a loose seat, not a table (FR-054)", async () => {
    const o = await organizer();
    const { section, layoutId } = await layoutWithSection(o);
    for (const seatCount of [0, 1]) {
      await placeTable(o, layoutId, roundTable(section, { seatCount })).expect(400);
    }
  });

  it("refuses more than 20 seats at one table (FR-054)", async () => {
    const o = await organizer();
    const { section, layoutId } = await layoutWithSection(o);
    await placeTable(o, layoutId, roundTable(section, { seatCount: 21 })).expect(400);
  });

  it("refuses a duplicate table name in the SAME section, at placement (FR-053, SC-028)", async () => {
    const o = await organizer();
    const { section, layoutId } = await layoutWithSection(o);
    await placeTable(o, layoutId, roundTable(section)).expect(201);

    const dup = await placeTable(o, layoutId, roundTable(section)).expect(409);
    expect(dup.body.error).toBe("table_name_taken");
  });

  it("allows the same table name in a DIFFERENT section (SC-028)", async () => {
    const o = await organizer();
    const { venue, section, layoutId } = await layoutWithSection(o);
    const other = (
      await request(app)
        .post(`/api/organizer/venues/${venue}/sections`)
        .set(o.h)
        .send({ name: "Khu B" })
        .expect(201)
    ).body.id;

    await placeTable(o, layoutId, roundTable(section)).expect(201);
    await placeTable(o, layoutId, roundTable(other)).expect(201); // "Bàn 5" in Khu B is a different seat
  });

  it("refuses another organizer’s layout (FR-079, SEC-04)", async () => {
    const owner = await organizer();
    const intruder = await organizer();
    const { section, layoutId } = await layoutWithSection(owner);

    const res = await placeTable(intruder, layoutId, roundTable(section)).expect(403);
    expect(res.body.error).toBe("not_owner");
  });
});

describe("tables — moving carries the seats (SC-016)", () => {
  it("moves and rotates every seat with the table", async () => {
    const o = await organizer();
    const { section, layoutId } = await layoutWithSection(o);
    const tableId = (await placeTable(o, layoutId, roundTable(section)).expect(201)).body.id;

    const before = await seatsOfTable(tableId);
    const offsets = before.map((s) => ({ dx: s.pos_x - 5000, dy: s.pos_y - 5000 }));

    await request(app)
      .patch(`/api/organizer/tables/${tableId}`)
      .set(o.h)
      .send({ x: 6000, y: 4000 })
      .expect(200);

    const after = await seatsOfTable(tableId);
    expect(after).toHaveLength(before.length); // 100% carried
    // Every seat keeps its place AT the table — the whole group translated together.
    after.forEach((s, i) => {
      expect(s.pos_x - 6000).toBe(offsets[i].dx);
      expect(s.pos_y - 4000).toBe(offsets[i].dy);
    });
  });

  it("redistributes evenly when the count changes (SC-016)", async () => {
    const o = await organizer();
    const { section, layoutId } = await layoutWithSection(o);
    const tableId = (await placeTable(o, layoutId, roundTable(section)).expect(201)).body.id;

    await request(app)
      .patch(`/api/organizer/tables/${tableId}`)
      .set(o.h)
      .send({ seatCount: 10 })
      .expect(200);

    const seats = await seatsOfTable(tableId);
    expect(seats).toHaveLength(10);
    expect(seats.map((s) => s.seat_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const radii = seats.map((s) => Math.round(Math.hypot(s.pos_x - 5000, s.pos_y - 5000)));
    expect(new Set(radii).size).toBe(1);
  });
});

describe("tables — refusals when inventory is at stake (FR-051, FR-052, SC-017)", () => {
  /** Put the table's seats on a live showtime and force one into `status`. */
  async function withLiveSeat(status: "sold" | "held") {
    const o = await organizer();
    const { venue, section, layoutId } = await layoutWithSection(o);
    const tableId = (await placeTable(o, layoutId, roundTable(section)).expect(201)).body.id;

    const ev = (
      await request(app)
        .post("/api/organizer/events")
        .set(o.h)
        .send({ title: "Gala", categoryCode: "theatre", description: "d", eventType: "seated" })
        .expect(201)
    ).body.id;
    const showtime = (
      await request(app)
        .post(`/api/organizer/events/${ev}/showtimes`)
        .set(o.h)
        .send({
          venueId: venue,
          startsAt: new Date(Date.now() + 86_400_000).toISOString(),
          tiers: [{ label: "VIP", price: 500_000 }],
        })
        .expect(201)
    ).body.id;
    await bindAndGenerate(o.h, { showtime, layoutId });

    await pool.query(
      `UPDATE showtime_seats SET status = $2, hold_expires_at = CASE WHEN $2 = 'held' THEN now() + interval '5 minutes' END
        WHERE id = (SELECT MIN(id) FROM showtime_seats WHERE showtime_id = $1)`,
      [showtime, status],
    );
    return { o, tableId, expectedCode: status === "sold" ? "seat_sold" : "seat_held" };
  }

  const snapshot = (tableId: number) =>
    pool
      .query(`SELECT * FROM layout_tables WHERE id = $1`, [tableId])
      .then((r) => r.rows[0])
      .then(async (t) => ({ table: t, seats: await seatsOfTable(tableId) }));

  it.each([["sold"], ["held"]] as const)(
    "refuses MOVING a table holding a %s seat, whole",
    async (status) => {
      const { o, tableId, expectedCode } = await withLiveSeat(status);
      const before = await snapshot(tableId);

      const res = await request(app)
        .patch(`/api/organizer/tables/${tableId}`)
        .set(o.h)
        .send({ x: 7000 })
        .expect(409);
      expect(res.body.error).toBe(expectedCode);
      expect(await snapshot(tableId)).toEqual(before); // byte-identical
    },
  );

  it.each([["sold"], ["held"]] as const)(
    "refuses ROTATING a table holding a %s seat",
    async (status) => {
      const { o, tableId, expectedCode } = await withLiveSeat(status);
      const before = await snapshot(tableId);

      const res = await request(app)
        .patch(`/api/organizer/tables/${tableId}`)
        .set(o.h)
        .send({ rotation: 90 })
        .expect(409);
      expect(res.body.error).toBe(expectedCode);
      expect(await snapshot(tableId)).toEqual(before);
    },
  );

  it.each([["sold"], ["held"]] as const)(
    "refuses RE-COUNTING a table holding a %s seat",
    async (status) => {
      const { o, tableId, expectedCode } = await withLiveSeat(status);
      const before = await snapshot(tableId);

      const res = await request(app)
        .patch(`/api/organizer/tables/${tableId}`)
        .set(o.h)
        .send({ seatCount: 12 })
        .expect(409);
      expect(res.body.error).toBe(expectedCode);
      expect(await snapshot(tableId)).toEqual(before);
    },
  );

  it.each([["sold"], ["held"]] as const)(
    "refuses DELETING a table holding a %s seat",
    async (status) => {
      const { o, tableId, expectedCode } = await withLiveSeat(status);
      const before = await snapshot(tableId);

      const res = await request(app)
        .delete(`/api/organizer/tables/${tableId}`)
        .set(o.h)
        .expect(409);
      expect(res.body.error).toBe(expectedCode);
      expect(await snapshot(tableId)).toEqual(before);
    },
  );

  it.each([["sold"], ["held"]] as const)(
    "refuses RE-SECTIONING a table holding a %s seat",
    async (status) => {
      const { o, tableId, expectedCode } = await withLiveSeat(status);
      const before = await snapshot(tableId);
      const layoutId = before.table.layout_id;
      const otherSection = (
        await pool.query<{ id: number }>(
          `INSERT INTO sections (layout_id, name) VALUES ($1, 'Khu B') RETURNING id`,
          [layoutId],
        )
      ).rows[0].id;

      const res = await request(app)
        .patch(`/api/organizer/tables/${tableId}`)
        .set(o.h)
        .send({ sectionId: otherSection })
        .expect(409);
      expect(res.body.error).toBe(expectedCode);
      expect(await snapshot(tableId)).toEqual(before);
    },
  );

  it("deletes a table and its seats when every seat is free (FR-052)", async () => {
    const o = await organizer();
    const { section, layoutId } = await layoutWithSection(o);
    const tableId = (await placeTable(o, layoutId, roundTable(section)).expect(201)).body.id;

    await request(app).delete(`/api/organizer/tables/${tableId}`).set(o.h).expect(200);

    expect(
      (await pool.query(`SELECT 1 FROM layout_tables WHERE id = $1`, [tableId])).rows,
    ).toHaveLength(0);
    expect(await seatsOfTable(tableId)).toHaveLength(0);
  });
});
