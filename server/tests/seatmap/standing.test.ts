import request from "supertest";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { app } from "../helpers/app.js";
import { bearer, makeApprovedOrganizer, registerUser } from "../helpers/authFixture.js";
import { isMixedShowtime } from "../../src/modules/seatmap/standing.js";
import { seedSeatedShowtime } from "../helpers/holdsSeed.js";

/**
 * Standing areas — the fan-zone substitute (US13, FR-080, SC-026).
 *
 * Two things are being pinned here, and the second matters more than the first.
 *
 * 1. A 200-position standing area can actually be drawn and sold, so the substitute is a real answer
 *    to the fan-zone gap rather than a note in the spec.
 * 2. **No showtime is ever both seated and general admission.** That invariant is the reason the
 *    substitute exists: feature 003 relies on a reservation being one or the other, and feature 004
 *    converts against it. If this test ever fails, the amendment has quietly reopened 003's
 *    concurrency work.
 */

async function organizer() {
  const o = await registerUser();
  await makeApprovedOrganizer(o.userId);
  return { ...o, h: bearer(o.token) };
}

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
      .send({ name: "Khu đứng" })
      .expect(201)
  ).body.id;
  const layoutId = (
    await pool.query<{ id: number }>(`SELECT id FROM venue_layouts WHERE venue_id = $1`, [venue])
  ).rows[0].id;
  return { venue, section, layoutId };
}

/** A square big enough for 200 positions at the generator's pitch. */
const BIG_SQUARE = [
  { x: 1000, y: 1000 },
  { x: 3000, y: 1000 },
  { x: 3000, y: 3000 },
  { x: 1000, y: 3000 },
];

describe("standing areas (FR-080)", () => {
  it("generates 200 standing positions inside the drawn shape", async () => {
    const o = await organizer();
    const { layoutId, section } = await layoutWithSection(o);

    const res = await request(app)
      .post(`/api/organizer/layouts/${layoutId}/standing-area`)
      .set(o.h)
      .send({ sectionId: section, rowLabel: "ĐỨNG", count: 200, points: BIG_SQUARE })
      .expect(201);

    expect(res.body.created).toBe(200);

    // Ordinary seats, of type `standing` — nothing about how they are claimed is new.
    const { rows } = await pool.query<{ n: string; types: string }>(
      `SELECT count(*)::text AS n, string_agg(DISTINCT seat_type, ',') AS types
         FROM seats WHERE layout_id = $1`,
      [layoutId],
    );
    expect(rows[0].n).toBe("200");
    expect(rows[0].types).toBe("standing");

    // Every position lies inside the polygon that was drawn.
    const { rows: outside } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM seats
        WHERE layout_id = $1 AND (pos_x < 1000 OR pos_x > 3000 OR pos_y < 1000 OR pos_y > 3000)`,
      [layoutId],
    );
    expect(outside[0].n).toBe("0");

    // The drawn area is stored with the positions, from the same polygon in the same transaction.
    const { rows: el } = await pool.query<{ kind: string; points: unknown }>(
      `SELECT kind, points FROM layout_elements WHERE layout_id = $1`,
      [layoutId],
    );
    expect(el).toHaveLength(1);
    expect(el[0].kind).toBe("area");
    expect(el[0].points).toHaveLength(4);
  });

  it("refuses an area too small to hold the positions asked for, and writes nothing", async () => {
    const o = await organizer();
    const { layoutId, section } = await layoutWithSection(o);

    const res = await request(app)
      .post(`/api/organizer/layouts/${layoutId}/standing-area`)
      .set(o.h)
      .send({
        sectionId: section,
        rowLabel: "ĐỨNG",
        count: 200,
        points: [
          { x: 1000, y: 1000 },
          { x: 1300, y: 1000 },
          { x: 1300, y: 1300 },
        ],
      })
      .expect(409);

    expect(res.body.error).toBe("area_too_small");

    // Refused WHOLE: no partial area, and no orphan shape either.
    const { rows } = await pool.query<{ seats: string; els: string }>(
      `SELECT (SELECT count(*) FROM seats WHERE layout_id = $1)::text AS seats,
              (SELECT count(*) FROM layout_elements WHERE layout_id = $1)::text AS els`,
      [layoutId],
    );
    expect(rows[0].seats).toBe("0");
    expect(rows[0].els).toBe("0");
  });

  it("refuses a shape with fewer than three points", async () => {
    const o = await organizer();
    const { layoutId, section } = await layoutWithSection(o);

    const res = await request(app)
      .post(`/api/organizer/layouts/${layoutId}/standing-area`)
      .set(o.h)
      .send({
        sectionId: section,
        rowLabel: "ĐỨNG",
        count: 10,
        points: [
          { x: 1000, y: 1000 },
          { x: 2000, y: 2000 },
        ],
      })
      .expect(400);

    expect(res.body.error).toBe("invalid_polygon");
  });

  it("refuses another organizer's layout (SEC-04)", async () => {
    const owner = await organizer();
    const stranger = await organizer();
    const { layoutId, section } = await layoutWithSection(owner);

    await request(app)
      .post(`/api/organizer/layouts/${layoutId}/standing-area`)
      .set(stranger.h)
      .send({ sectionId: section, rowLabel: "ĐỨNG", count: 10, points: BIG_SQUARE })
      .expect(403);

    // 403 `not_owner`, the same refusal every other layout route gives a stranger.
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM seats WHERE layout_id = $1`,
      [layoutId],
    );
    expect(rows[0].n).toBe("0");
  });
});

/*
 * The area a standing path draws must never ALSO be sold by head count.
 *
 * `layout_elements.capacity` means exactly one thing — "sold by head count against this class's tier"
 * (0027). The standing path used to write the generated position count there as a note to itself, and
 * the two readings collided: generation turned the note into the tier's quantity while every position
 * stayed its own seat row, so a 200-place area came out of `POST /seat-map` as `{"seats": 400}`. It
 * also left an area with a capacity and no class, which `zone_without_category` refuses — a standing
 * area could not be published at all.
 */
describe("a standing area is inventory ONCE", () => {
  it("writes no capacity, so the drawn area is not a zone sold by head count", async () => {
    const o = await organizer();
    const { layoutId, section } = await layoutWithSection(o);
    await request(app)
      .post(`/api/organizer/layouts/${layoutId}/standing-area`)
      .set(o.h)
      .send({ sectionId: section, rowLabel: "ĐỨNG", count: 200, points: BIG_SQUARE })
      .expect(201);

    const { rows } = await pool.query<{ capacity: number | null }>(
      `SELECT capacity FROM layout_elements WHERE layout_id = $1 AND kind = 'area'`,
      [layoutId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].capacity).toBeNull();
  });

  it("publishes — the capacity it used to write made every standing area unpublishable", async () => {
    const o = await organizer();
    const { layoutId, section } = await layoutWithSection(o);
    await request(app)
      .post(`/api/organizer/layouts/${layoutId}/standing-area`)
      .set(o.h)
      .send({ sectionId: section, rowLabel: "ĐỨNG", count: 200, points: BIG_SQUARE })
      .expect(201);

    const v = await request(app)
      .post(`/api/organizer/layouts/${layoutId}/validate`)
      .set(o.h)
      .expect(200);
    expect(v.body.valid).toBe(true);
    await request(app).post(`/api/organizer/layouts/${layoutId}/publish`).set(o.h).expect(200);
  });

  it("generates one ticket per position, not two", async () => {
    const o = await organizer();
    const { venue, layoutId, section } = await layoutWithSection(o);
    await request(app)
      .post(`/api/organizer/layouts/${layoutId}/standing-area`)
      .set(o.h)
      .send({ sectionId: section, rowLabel: "ĐỨNG", count: 200, points: BIG_SQUARE })
      .expect(201);
    await request(app).post(`/api/organizer/layouts/${layoutId}/publish`).set(o.h).expect(200);

    const ev = (
      await request(app)
        .post("/api/organizer/events")
        .set(o.h)
        .send({ title: "S", categoryCode: "theatre", description: "d", eventType: "seated" })
        .expect(201)
    ).body.id;
    const showtime = (
      await request(app)
        .post(`/api/organizer/events/${ev}/showtimes`)
        .set(o.h)
        .send({
          venueId: venue,
          startsAt: new Date(Date.now() + 86_400_000).toISOString(),
          tiers: [{ label: "Đứng", price: 100_000 }],
        })
        .expect(201)
    ).body.id;
    const { rows: cat } = await pool.query<{ c: number }>(
      `SELECT DISTINCT category_id AS c FROM seats WHERE layout_id = $1`,
      [layoutId],
    );
    await pool.query(`UPDATE ticket_tiers SET category_id = $2 WHERE showtime_id = $1`, [
      showtime,
      cat[0].c,
    ]);

    const gen = await request(app)
      .post(`/api/organizer/showtimes/${showtime}/seat-map`)
      .set(o.h)
      .send({ layoutId })
      .expect(201);

    // 200 places on the floor, 200 tickets. This read 400 before the fix.
    expect(gen.body.seats).toBe(200);
    const inv = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM showtime_seats WHERE showtime_id = $1`,
      [showtime],
    );
    expect(inv.rows[0].n).toBe(200);
    const tq = await pool.query<{ total_quantity: number | null }>(
      `SELECT total_quantity FROM ticket_tiers WHERE showtime_id = $1`,
      [showtime],
    );
    expect(tq.rows[0].total_quantity).toBeNull();
  });
});

describe("no showtime is both seated and general admission (SC-026)", () => {
  it("holds across every showtime in the database", async () => {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT st.id::text AS id
         FROM showtimes st
        WHERE EXISTS (SELECT 1 FROM showtime_seats ss WHERE ss.showtime_id = st.id)
          AND EXISTS (SELECT 1 FROM ticket_tiers tt
                       WHERE tt.showtime_id = st.id AND tt.total_quantity IS NOT NULL
                     -- In step with isMixedShowtime: a capacity zone's tier (0027) carries a class and
                     -- is legitimately quantity-backed on a seated showtime, so only a classless one is
                     -- the GA leftover SC-026 forbids.
                     AND tt.category_id IS NULL)`,
    );
    expect(rows).toEqual([]);
  });

  it("reports a mixed showtime as mixed, so the guard cannot silently pass everything", async () => {
    // The sweep above proves nothing unless the detector can also say "yes". A mixed showtime is
    // forced here with raw SQL — deliberately bypassing the API, because the API is exactly what
    // makes it unreachable — and the row is removed again so the sweep stays honest.
    const seated = await seedSeatedShowtime(2);
    expect(await isMixedShowtime(seated.showtimeId, pool)).toBe(false);

    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO ticket_tiers (showtime_id, label, price_amount, total_quantity)
       VALUES ($1, 'Vé đứng', 100000, 50) RETURNING id`,
      [seated.showtimeId],
    );
    expect(await isMixedShowtime(seated.showtimeId, pool)).toBe(true);

    await pool.query(`DELETE FROM ticket_tiers WHERE id = $1`, [rows[0].id]);
    expect(await isMixedShowtime(seated.showtimeId, pool)).toBe(false);
  });
});

describe("a reshape claims only the seats inside its own polygon", () => {
  /** Two disjoint squares — far enough apart that even their bounding boxes never touch. */
  const LEFT_SQUARE = [
    { x: 1000, y: 1000 },
    { x: 3000, y: 1000 },
    { x: 3000, y: 3000 },
    { x: 1000, y: 3000 },
  ];
  const RIGHT_SQUARE = [
    { x: 5000, y: 1000 },
    { x: 7000, y: 1000 },
    { x: 7000, y: 3000 },
    { x: 5000, y: 3000 },
  ];

  /**
   * Two standing areas sharing the row label the editor always sends ("ĐỨNG"), in different
   * sections. Under the old label-only matching these two could destroy each other.
   */
  async function twoAreas(o: { h: Record<string, string> }) {
    const { layoutId, section, venue } = await layoutWithSection(o);
    const sectionB = (
      await request(app)
        .post(`/api/organizer/venues/${venue}/sections`)
        .set(o.h)
        .send({ name: "Khu đứng B" })
        .expect(201)
    ).body.id;
    await request(app)
      .post(`/api/organizer/layouts/${layoutId}/standing-area`)
      .set(o.h)
      .send({ sectionId: section, rowLabel: "ĐỨNG", count: 20, points: LEFT_SQUARE })
      .expect(201);
    await request(app)
      .post(`/api/organizer/layouts/${layoutId}/standing-area`)
      .set(o.h)
      .send({ sectionId: sectionB, rowLabel: "ĐỨNG", count: 20, points: RIGHT_SQUARE })
      .expect(201);
    const areas = (
      await pool.query<{ id: number }>(
        `SELECT id FROM layout_elements WHERE layout_id = $1 AND kind = 'area' ORDER BY id`,
        [layoutId],
      )
    ).rows;
    return { layoutId, section, sectionB, leftArea: areas[0].id, rightArea: areas[1].id };
  }

  const seatsOf = (layoutId: number) =>
    pool.query<{ id: number; section_id: number | null; pos_x: number; pos_y: number }>(
      `SELECT id, section_id, pos_x, pos_y FROM seats
        WHERE layout_id = $1 AND seat_type = 'standing' ORDER BY id`,
      [layoutId],
    );

  /** Sell one physical seat on an otherwise unrelated showtime, the way a purchase would leave it. */
  async function sellSeat(seatId: number) {
    const seeded = await seedSeatedShowtime(1);
    await pool.query(
      `INSERT INTO showtime_seats (showtime_id, seat_id, ticket_tier_id, status, pos_x, pos_y, rotation, row_label, seat_number)
       SELECT $1, s.id, $3, 'sold', s.pos_x, s.pos_y, 0, s.row_label, s.seat_number
         FROM seats s WHERE s.id = $2`,
      [seeded.showtimeId, seatId, seeded.tierId],
    );
  }

  it("reshaping one area leaves the other area's seats byte-identical", async () => {
    const o = await organizer();
    const m = await twoAreas(o);
    const before = (await seatsOf(m.layoutId)).rows;

    // Shrink the LEFT area to 8 places inside a smaller polygon.
    await request(app)
      .patch(`/api/organizer/layouts/${m.layoutId}/areas/${m.leftArea}`)
      .set(o.h)
      .send({
        points: [
          { x: 1200, y: 1200 },
          { x: 2400, y: 1200 },
          { x: 2400, y: 2400 },
          { x: 1200, y: 2400 },
        ],
        capacity: 8,
      })
      .expect(200);

    const after = (await seatsOf(m.layoutId)).rows;
    // The right area's seats are untouched — same ids, same positions, same section.
    expect(after.filter((s) => s.pos_x > 4000)).toEqual(before.filter((s) => s.pos_x > 4000));
    // The left area was regenerated: 8 seats, all still in its own section.
    const left = after.filter((s) => s.pos_x <= 4000);
    expect(left).toHaveLength(8);
    expect(left.every((s) => s.section_id === m.section)).toBe(true);
  });

  it("a sale in the OTHER area neither blocks the reshape nor is disturbed by it", async () => {
    const o = await organizer();
    const m = await twoAreas(o);
    const rightSeat = (
      await pool.query<{ id: number }>(
        `SELECT id FROM seats WHERE layout_id = $1 AND seat_type = 'standing' AND pos_x > 4000 LIMIT 1`,
        [m.layoutId],
      )
    ).rows[0];
    await sellSeat(rightSeat.id);

    // The old label-only guard refused here; the polygon-scoped one does not.
    await request(app)
      .patch(`/api/organizer/layouts/${m.layoutId}/areas/${m.leftArea}`)
      .set(o.h)
      .send({ points: LEFT_SQUARE, capacity: 10 })
      .expect(200);

    const sold = await pool.query(`SELECT status FROM showtime_seats WHERE seat_id = $1`, [
      rightSeat.id,
    ]);
    expect(sold.rows[0].status).toBe("sold");
  });

  it("still refuses when THIS area holds a sold seat", async () => {
    const o = await organizer();
    const m = await twoAreas(o);
    const leftSeat = (
      await pool.query<{ id: number }>(
        `SELECT id FROM seats WHERE layout_id = $1 AND seat_type = 'standing' AND pos_x <= 4000 LIMIT 1`,
        [m.layoutId],
      )
    ).rows[0];
    await sellSeat(leftSeat.id);

    const res = await request(app)
      .patch(`/api/organizer/layouts/${m.layoutId}/areas/${m.leftArea}`)
      .set(o.h)
      .send({ points: LEFT_SQUARE, capacity: 10 })
      .expect(409);
    expect(res.body.error).toBe("seat_sold");
  });

  it("refuses creating an area that overlaps an existing one", async () => {
    const o = await organizer();
    const { layoutId, section } = await layoutWithSection(o);
    await request(app)
      .post(`/api/organizer/layouts/${layoutId}/standing-area`)
      .set(o.h)
      .send({ sectionId: section, rowLabel: "ĐỨNG", count: 10, points: LEFT_SQUARE })
      .expect(201);

    // Overlaps the first square's bounding box (its minX 2000 is below the first's maxX 3000).
    const res = await request(app)
      .post(`/api/organizer/layouts/${layoutId}/standing-area`)
      .set(o.h)
      .send({
        sectionId: section,
        rowLabel: "ĐỨNG",
        count: 10,
        points: [
          { x: 2000, y: 1000 },
          { x: 4000, y: 1000 },
          { x: 4000, y: 3000 },
          { x: 2000, y: 3000 },
        ],
      })
      .expect(409);
    expect(res.body.error).toBe("area_overlaps");

    // Refused whole: no second shape, no orphan seats.
    const els = await pool.query(
      `SELECT count(*)::int AS n FROM layout_elements WHERE layout_id = $1 AND kind = 'area'`,
      [layoutId],
    );
    expect(els.rows[0].n).toBe(1);
  });
});
