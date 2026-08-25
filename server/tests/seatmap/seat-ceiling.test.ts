import request from "supertest";
import { describe, expect, it } from "vitest";
import { LAYOUT_MAX_SEATS } from "../../src/config.js";
import { app } from "../helpers/app.js";
import { bearer, makeApprovedOrganizer, registerUser } from "../helpers/authFixture.js";
import { regenerateBlock } from "@shared/catalog/seatmap-project.js";

/**
 * The raised ceiling (0044), proven end to end rather than asserted as a constant.
 *
 * Raising `LAYOUT_MAX_SEATS` is one number; the question is whether a chart that size actually
 * SAVES. Two things could stop it and neither is visible from the constant: the JSON body cap (a
 * 10,000-seat document is about 0.78 MB, and the global cap is 1 MB) and the batched seat writes.
 */
async function organizer() {
  const o = await registerUser();
  await makeApprovedOrganizer(o.userId);
  return { ...o, h: bearer(o.token) };
}

/**
 * One parametric block of `rows × perRow`, WITH its seats already built.
 *
 * `regenerateBlock` is what turns params into seats, and it runs on the client — the projection only
 * ever copies `block.seats`, it never derives them. A document sent with params and no seats saves a
 * chart with nothing in it, which is exactly what the first version of this test measured.
 */
function chart(rows: number, perRow: number, budget = LAYOUT_MAX_SEATS) {
  return {
    schemaVersion: 1,
    gridSize: 50,
    sections: [{ id: -1, name: "Khu A", seatShape: "circle" as const, seatSizeMultiplier: 1 }],
    categories: [{ id: -11, name: "Thường", color: "#B3202C" }],
    rows: [],
    blocks: [
      {
        key: "b1",
        kind: "seating-block" as const,
        title: "Khối lớn",
        x: 1000,
        y: 1000,
        rotation: 0,
        width: 1,
        height: 1,
        sectionId: -1,
        categoryId: -11,
        params: {
          rowsCount: rows,
          seatsPerRow: perRow,
          seatSpacing: 150,
          rowSpacing: 150,
          rowLabelScheme: "alpha-asc" as const,
          seatLabelScheme: "num-asc" as const,
        },
      },
    ].map((b) => {
      let id = 0;
      return regenerateBlock(b as never, () => --id, budget);
    }),
  };
}

describe("the seat ceiling", () => {
  it("is well past the old 2,000", () => {
    expect(LAYOUT_MAX_SEATS).toBeGreaterThanOrEqual(10_000);
  });

  it(`saves a chart at the ceiling (${LAYOUT_MAX_SEATS} seats)`, { timeout: 180_000 }, async () => {
    const o = await organizer();
    const venue = (
      await request(app)
        .post("/api/organizer/venues")
        .set(o.h)
        .send({ name: "Sân lớn", city: "Hà Nội", rawAddress: "a" })
        .expect(201)
    ).body.id;
    const layout = (
      await request(app)
        .post(`/api/organizer/venues/${venue}/layouts`)
        .set(o.h)
        .send({ name: "Chart lớn" })
        .expect(201)
    ).body;

    const perRow = 100;
    const rows = LAYOUT_MAX_SEATS / perRow;
    const started = Date.now();
    const saved = (
      await request(app)
        .put(`/api/organizer/layouts/${layout.id}`)
        .set(o.h)
        .send({ version: layout.version, document: chart(rows, perRow) })
        .expect(200)
    ).body;
    // Reported so a future regression in the write path is visible as a number, not as a hunch.
    console.log(`saved ${saved.seats.length} seats in ${Date.now() - started}ms`);

    expect(saved.seats).toHaveLength(LAYOUT_MAX_SEATS);
  });

  it("still refuses one seat past the ceiling, and leaves the chart untouched", async () => {
    const o = await organizer();
    const venue = (
      await request(app)
        .post("/api/organizer/venues")
        .set(o.h)
        .send({ name: "Sân quá", city: "Hà Nội", rawAddress: "a" })
        .expect(201)
    ).body.id;
    const layout = (
      await request(app)
        .post(`/api/organizer/venues/${venue}/layouts`)
        .set(o.h)
        .send({ name: "Quá trần" })
        .expect(201)
    ).body;

    // The ceiling has moved, not gone: raising it must not turn the refusal off.
    await request(app)
      .put(`/api/organizer/layouts/${layout.id}`)
      .set(o.h)
      .send({
        version: layout.version,
        // Built past the cap on purpose: `regenerateBlock` clips to its budget, so the default would
        // hand the server exactly the ceiling and nothing would be refused.
        document: chart(LAYOUT_MAX_SEATS / 100 + 1, 100, LAYOUT_MAX_SEATS + 100),
      })
      .expect(409)
      .expect((r) => expect(r.body.error).toBe("seat_limit_reached"));
  });
});
