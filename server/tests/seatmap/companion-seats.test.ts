import request from "supertest";
import { describe, expect, it } from "vitest";
import type { ChartDocument } from "@shared/catalog/seatmap-document.js";
import { CHART_DOCUMENT_SCHEMA } from "@shared/catalog/seatmap-document.js";
import { pool } from "../../src/db/pool.js";
import { app } from "../helpers/app.js";
import { bearer, makeApprovedOrganizer, registerUser } from "../helpers/authFixture.js";
import { bindAndGenerate } from "../helpers/seatmapSeed.js";

// Companion seats (0036), through the two persistence boundaries: the chart's own rows and the
// per-showtime snapshot.
//
// The pointer travels: editor document -> `seats.companion_seat_id` on save -> copied onto
// `showtime_seats.companion_seat_id` at generation, because a showtime OWNS its map from then on
// (FR-005) and must carry the pairing with it.

async function organizer() {
  const o = await registerUser();
  await makeApprovedOrganizer(o.userId);
  return { ...o, h: bearer(o.token) };
}

/**
 * A free (non-parametric) block with one wheelchair seat (A1) and its companion (A2 -> A1), using
 * editor-minted placeholder ids exactly as `ChartEditor` does before the first save. If the save
 * path dropped the pointer here, because both ends were negative at send-time, this test is the
 * one that says so.
 */
function pairedDoc(): ChartDocument {
  return {
    schemaVersion: CHART_DOCUMENT_SCHEMA,
    gridSize: 50,
    sections: [{ id: -1, name: "Khu A" }],
    categories: [{ id: -2, name: "VIP", color: "#B3453C" }],
    blocks: [
      {
        key: "b1",
        kind: "seating-block",
        title: "Khu A",
        x: 1000,
        y: 1000,
        rotation: 0,
        width: 500,
        height: 150,
        sectionId: -1,
        categoryId: -2,
        seats: [
          {
            seatId: -201,
            rowLabel: "A",
            seatNumber: 1,
            dx: 0,
            dy: 0,
            rotation: 0,
            isAccessible: true,
          },
          {
            seatId: -202,
            rowLabel: "A",
            seatNumber: 2,
            dx: 150,
            dy: 0,
            rotation: 0,
            companionSeatId: -201,
          },
        ],
      },
    ],
    rows: [],
  };
}

const save = (o: { h: Record<string, string> }, layoutId: number, body: Record<string, unknown>) =>
  request(app).put(`/api/organizer/layouts/${layoutId}`).set(o.h).send(body);

describe("companion seats on the chart's rows", () => {
  it("persists a paired document through save-and-read-back, resolving both placeholder ids", async () => {
    const o = await organizer();
    const venue = (
      await request(app)
        .post("/api/organizer/venues")
        .set(o.h)
        .send({ name: "V", city: "Hà Nội", rawAddress: "a" })
        .expect(201)
    ).body.id;
    const layout = (
      await request(app)
        .post(`/api/organizer/venues/${venue}/layouts`)
        .set(o.h)
        .send({ name: "Sơ đồ cặp đôi" })
        .expect(201)
    ).body;

    const saved = (
      await save(o, layout.id, { version: layout.version, document: pairedDoc() }).expect(200)
    ).body;
    expect(saved.seats).toHaveLength(2);

    // The READ comes back through the API's own mapping, not a hand-written SELECT.
    const reread = (
      await request(app).get(`/api/organizer/layouts/${layout.id}`).set(o.h).expect(200)
    ).body as {
      seats: {
        id: number;
        rowLabel: string;
        seatNumber: number;
        isAccessible?: boolean;
        companionSeatId?: number | null;
      }[];
    };

    const wheelchair = reread.seats.find((s) => s.seatNumber === 1)!;
    const companion = reread.seats.find((s) => s.seatNumber === 2)!;
    expect(wheelchair.isAccessible).toBe(true);
    expect(wheelchair.companionSeatId ?? null).toBeNull();
    expect(companion.isAccessible).toBeFalsy();
    // The pointer names the REAL id of the wheelchair seat — both placeholders resolved.
    expect(companion.companionSeatId).toBe(wheelchair.id);
  });
});

describe("companion seats onto a showtime's snapshot", () => {
  it("generateSeatMap copies the pairing onto the showtime's own rows, both ends", async () => {
    const o = await organizer();
    const venue = (
      await request(app)
        .post("/api/organizer/venues")
        .set(o.h)
        .send({ name: "V", city: "Hà Nội", rawAddress: "a" })
        .expect(201)
    ).body.id;
    const layout = (
      await request(app)
        .post(`/api/organizer/venues/${venue}/layouts`)
        .set(o.h)
        .send({ name: "Sơ đồ cặp đôi" })
        .expect(201)
    ).body;
    await save(o, layout.id, { version: layout.version, document: pairedDoc() }).expect(200);

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
          tiers: [{ label: "VIP", price: 500_000 }],
        })
        .expect(201)
    ).body.id;

    await bindAndGenerate(o.h, { showtime, layoutId: layout.id });

    // One row per seat, and the link between the two.
    const { rows } = await pool.query<{
      seat_number: number;
      is_accessible: boolean;
      companion_seat_id: number | null;
      id: number;
    }>(
      `SELECT id, seat_number, is_accessible, companion_seat_id
         FROM showtime_seats WHERE showtime_id = $1 ORDER BY seat_number`,
      [showtime],
    );
    expect(rows).toHaveLength(2);
    const wheelchair = rows.find((r) => r.seat_number === 1)!;
    const companion = rows.find((r) => r.seat_number === 2)!;
    expect(wheelchair.is_accessible).toBe(true);
    expect(wheelchair.companion_seat_id).toBeNull();
    // The showtime's pointer is a self-reference onto the SHOWTIME's rows, not the chart's.
    expect(companion.companion_seat_id).toBe(wheelchair.id);
  });
});
