import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../helpers/app.js";
import { bearer, makeApprovedOrganizer, registerUser } from "../helpers/authFixture.js";
import { pool } from "../../src/db/pool.js";

async function organizer() {
  const o = await registerUser();
  await makeApprovedOrganizer(o.userId);
  return { ...o, h: bearer(o.token) };
}

async function layoutWithSection(o: { h: Record<string, string> }, name: string) {
  const venue = (
    await request(app)
      .post("/api/organizer/venues")
      .set(o.h)
      .send({ name: `${name}${Date.now()}${Math.random()}`, city: "Hà Nội", rawAddress: "a" })
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

const table = (sectionId: number, over: Record<string, unknown> = {}) => ({
  sectionId,
  name: "Bàn",
  shape: "round",
  x: 5000,
  y: 5000,
  width: 600,
  height: 600,
  rotation: 0,
  seatCount: 8,
  ...over,
});

const positionOf = async (tableId: number) =>
  (
    await pool.query<{ pos_x: number; pos_y: number }>(
      `SELECT pos_x, pos_y FROM layout_tables WHERE id = $1`,
      [tableId],
    )
  ).rows[0];

const tableCount = async (layoutId: number) =>
  Number(
    (
      await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM layout_tables WHERE layout_id = $1`,
        [layoutId],
      )
    ).rows[0].n,
  );

/**
 * A gesture on several tables is one commit.
 *
 * It used to be one request per table — `Promise.all` for moves, a sequential loop for deletes — so a
 * refusal partway left the earlier tables changed and the editor holding a document the database no
 * longer matched.
 */
describe("batch table operations are all-or-nothing", () => {
  it("moves no table when one id belongs to another layout", async () => {
    const o = await organizer();
    const a = await layoutWithSection(o, "A");
    const b = await layoutWithSection(o, "B");
    const t1 = (await request(app).post(`/api/organizer/layouts/${a.layoutId}/tables`).set(o.h).send(table(a.section, { x: 2000, name: "T1" })).expect(201)).body.id;
    const t2 = (await request(app).post(`/api/organizer/layouts/${a.layoutId}/tables`).set(o.h).send(table(a.section, { x: 3000, name: "T2" })).expect(201)).body.id;
    const stranger = (await request(app).post(`/api/organizer/layouts/${b.layoutId}/tables`).set(o.h).send(table(b.section, { name: "Lạ" })).expect(201)).body.id;

    const before1 = await positionOf(t1);
    const before2 = await positionOf(t2);

    await request(app)
      .patch(`/api/organizer/layouts/${a.layoutId}/tables`)
      .set(o.h)
      .send({
        updates: [
          { tableId: t1, patch: { x: 9000 } },
          { tableId: t2, patch: { x: 9100 } },
          { tableId: stranger, patch: { x: 9200 } },
        ],
      })
      .expect(400)
      .expect((r) => expect(r.body.error).toBe("validation_failed"));

    expect(await positionOf(t1), "T1 must not have moved").toEqual(before1);
    expect(await positionOf(t2), "T2 must not have moved").toEqual(before2);
  });

  it("deletes no table when one id belongs to another layout", async () => {
    const o = await organizer();
    const a = await layoutWithSection(o, "DelA");
    const b = await layoutWithSection(o, "DelB");
    const t1 = (await request(app).post(`/api/organizer/layouts/${a.layoutId}/tables`).set(o.h).send(table(a.section, { x: 2000 })).expect(201)).body.id;
    const stranger = (await request(app).post(`/api/organizer/layouts/${b.layoutId}/tables`).set(o.h).send(table(b.section)).expect(201)).body.id;

    await request(app)
      .delete(`/api/organizer/layouts/${a.layoutId}/tables`)
      .set(o.h)
      .send({ tableIds: [t1, stranger] })
      .expect(400);

    expect(await tableCount(a.layoutId), "nothing deleted").toBe(1);
    expect(await tableCount(b.layoutId)).toBe(1);
  });

  it("moves every table when the batch is valid", async () => {
    const o = await organizer();
    const a = await layoutWithSection(o, "OK");
    const t1 = (await request(app).post(`/api/organizer/layouts/${a.layoutId}/tables`).set(o.h).send(table(a.section, { x: 2000 })).expect(201)).body.id;
    const t2 = (await request(app).post(`/api/organizer/layouts/${a.layoutId}/tables`).set(o.h).send(table(a.section, { x: 3000, name: "Hai" })).expect(201)).body.id;

    const res = await request(app)
      .patch(`/api/organizer/layouts/${a.layoutId}/tables`)
      .set(o.h)
      .send({ updates: [{ tableId: t1, patch: { x: 8000 } }, { tableId: t2, patch: { x: 8500 } }] })
      .expect(200);

    expect(res.body.tables).toHaveLength(2);
    expect((await positionOf(t1)).pos_x).toBe(8000);
    expect((await positionOf(t2)).pos_x).toBe(8500);
  });
});

/**
 * The refusal this batching exists for: a table whose seats are sold (FR-051/FR-052).
 *
 * The other cases here reach the same transaction through an ownership check. This one goes through
 * `assertNoCommittedSeats`, which is what the sequential delete loop used to hit on the SECOND table
 * after the first was already gone.
 */
describe("a sold seat stops the whole delete, not just its own table", () => {
  it("keeps both tables when one of them has sold inventory", async () => {
    const o = await organizer();
    const a = await layoutWithSection(o, "Sold");
    const keep = (await request(app).post(`/api/organizer/layouts/${a.layoutId}/tables`).set(o.h)
      .send(table(a.section, { x: 2000, name: "Bàn rảnh" })).expect(201)).body.id;
    const protectedTable = (await request(app).post(`/api/organizer/layouts/${a.layoutId}/tables`).set(o.h)
      .send(table(a.section, { x: 8000, name: "Bàn đã bán" })).expect(201)).body.id;
    await request(app).post(`/api/organizer/layouts/${a.layoutId}/publish`).set(o.h).expect(200);

    const ev = (await request(app).post("/api/organizer/events").set(o.h)
      .send({ title: "S", categoryCode: "theatre", description: "d", eventType: "seated" })
      .expect(201)).body.id;
    const showtime = (await request(app).post(`/api/organizer/events/${ev}/showtimes`).set(o.h)
      .send({ venueId: a.venue, startsAt: new Date(Date.now() + 86_400_000).toISOString(),
              tiers: [{ label: "VIP", price: 500_000 }] }).expect(201)).body.id;
    const layout = (await request(app).get(`/api/organizer/layouts/${a.layoutId}`).set(o.h)
      .expect(200)).body;
    const { rows: tiers } = await pool.query<{ id: number }>(
      `SELECT id FROM ticket_tiers WHERE showtime_id = $1 AND archived_at IS NULL`, [showtime]);
    await request(app).post(`/api/organizer/showtimes/${showtime}/apply-chart`).set(o.h)
      .send({ layoutId: a.layoutId,
              mappings: [{ categoryId: layout.categories[0].id, tierId: tiers[0].id }] })
      .expect(201);

    // One seat of the SECOND table is sold. Nothing else changes.
    const { rowCount } = await pool.query(
      `UPDATE showtime_seats SET status = 'sold'
        WHERE id = (SELECT ss.id FROM showtime_seats ss JOIN seats s ON s.id = ss.seat_id
                     WHERE ss.showtime_id = $1 AND s.table_id = $2 LIMIT 1)`,
      [showtime, protectedTable],
    );
    expect(rowCount, "the fixture must actually sell a seat").toBe(1);

    // The free table is named FIRST, so a sequential loop would delete it before hitting the refusal.
    // The free table is named FIRST, so a sequential loop would delete it before hitting the refusal.
    await request(app)
      .delete(`/api/organizer/layouts/${a.layoutId}/tables`)
      .set(o.h)
      .send({ tableIds: [keep, protectedTable] })
      .expect(409);

    expect(await tableCount(a.layoutId), "the free table survives the refusal too").toBe(2);

    /*
     * The seats of the FREE table are bound to the showtime too, and every table mutation rewrites
     * them. That used to be a bare 500: only sold and held seats were checked, so a chart with
     * nothing sold yet failed with no reason given at all.
     */
    const single = await request(app).delete(`/api/organizer/tables/${keep}`).set(o.h).expect(409);
    expect(single.body.error).toBe("seat_in_use");
    const moved = await request(app)
      .patch(`/api/organizer/tables/${keep}`)
      .set(o.h)
      .send({ x: 9000 })
      .expect(409);
    expect(moved.body.error, "moving rewrites the same seats").toBe("seat_in_use");

    expect(await tableCount(a.layoutId), "the free table survives the refusal too").toBe(2);
  });
});
