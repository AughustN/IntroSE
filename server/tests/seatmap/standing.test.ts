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
