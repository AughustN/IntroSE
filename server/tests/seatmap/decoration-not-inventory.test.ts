import request from "supertest";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { app } from "../helpers/app.js";
import { bearer, makeApprovedOrganizer, registerUser } from "../helpers/authFixture.js";
import { createTable } from "../../src/modules/seatmap/tables.js";
import { bindAndGenerate } from "../helpers/seatmapSeed.js";

/**
 * Decoration never becomes inventory (SC-018).
 *
 * This is the single assertion the whole amendment rests on. Tables, a hall boundary, dividers and
 * facility icons all made the layout richer; none of them may make it *bigger*. A layout carrying 100
 * tables, a boundary polygon and a dozen facility icons must generate a bookable-seat count exactly
 * equal to its seat count — no more, no fewer — because a decoration that quietly became a sellable
 * unit would sell a buyer a doorway.
 *
 * The tables here DO contribute seats, and that is the point: their seats are counted because they are
 * ordinary seats, while the shapes and icons beside them contribute nothing at all.
 */

async function organizer() {
  const o = await registerUser();
  await makeApprovedOrganizer(o.userId);
  return { ...o, h: bearer(o.token) };
}

const TABLES = 100;
const SEATS_PER_TABLE = 2;
const FACILITIES = [
  "exit",
  "restroom",
  "food_drink",
  "smoking",
  "first_aid",
  "lift_stairs",
  "wheelchair",
  "exit",
  "restroom",
  "door",
  "bar",
  "aisle",
] as const;

describe("decoration never becomes inventory (SC-018)", () => {
  it("generates a bookable-seat count equal to the layout's seat count, whatever is drawn beside them", async () => {
    const o = await organizer();
    const venue = (
      await request(app)
        .post("/api/organizer/venues")
        .set(o.h)
        .send({ name: "Sảnh tiệc", city: "Hà Nội", rawAddress: "a" })
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

    // 100 tables, placed through the service so this test is about counting rather than HTTP.
    for (let i = 1; i <= TABLES; i++) {
      await createTable(layoutId, {
        sectionId: section,
        name: `Bàn ${i}`,
        shape: i % 2 === 0 ? "rect" : "round",
        x: 500 + ((i - 1) % 10) * 900,
        y: 500 + Math.floor((i - 1) / 10) * 900,
        width: 700,
        height: 700,
        rotation: 0,
        seatCount: SEATS_PER_TABLE,
        sideCounts: null,
      });
    }

    // A hall outline, a divider, and a dozen facility icons — all of it decoration.
    await pool.query(
      `INSERT INTO layout_elements (layout_id, kind, pos_x, pos_y, width, height, rotation, label, points)
       VALUES ($1, 'boundary', 5000, 5000, 9000, 9000, 0, NULL,
               '[{"x":200,"y":200},{"x":9800,"y":200},{"x":9800,"y":9800},{"x":200,"y":9800}]'::jsonb),
              ($1, 'divider', 5000, 5000, 4000, 1, 0, NULL,
               '[{"x":3000,"y":5000},{"x":7000,"y":5000}]'::jsonb)`,
      [layoutId],
    );
    for (const kind of FACILITIES) {
      await pool.query(
        `INSERT INTO layout_elements (layout_id, kind, pos_x, pos_y, width, height, rotation, label)
         VALUES ($1, $2, 400, 400, 350, 350, 0, 'Lối ra')`,
        [layoutId, kind],
      );
    }

    const { rows: counts } = await pool.query<{ seats: string; tables: string; elements: string }>(
      `SELECT (SELECT count(*) FROM seats WHERE layout_id = $1)::text AS seats,
              (SELECT count(*) FROM layout_tables WHERE layout_id = $1)::text AS tables,
              (SELECT count(*) FROM layout_elements WHERE layout_id = $1)::text AS elements`,
      [layoutId],
    );
    expect(counts[0].tables).toBe(String(TABLES));
    expect(counts[0].elements).toBe(String(FACILITIES.length + 2));
    const seatCount = Number(counts[0].seats);
    expect(seatCount).toBe(TABLES * SEATS_PER_TABLE);

    // Now generate the showtime's map from that layout.
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
    await bindAndGenerate(o.h, { showtime, layoutId, publish: false });

    // The count that matters: bookable units === seats. Not seats + tables, not seats + icons.
    const { rows: bookable } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM showtime_seats WHERE showtime_id = $1`,
      [showtime],
    );
    expect(bookable[0].n).toBe(String(seatCount));

    // And the GA capacity path stays empty: nothing drawn created a quantity to sell.
    const { rows: capped } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ticket_tiers
        WHERE showtime_id = $1 AND total_quantity IS NOT NULL`,
      [showtime],
    );
    expect(capped[0].n).toBe("0");
  }, 120_000);
});
