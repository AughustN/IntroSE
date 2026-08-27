import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../helpers/app.js";
import { bearer, makeApprovedOrganizer, registerUser } from "../helpers/authFixture.js";
import { pool } from "../../src/db/pool.js";

/**
 * Regressions for the second-pass flow audit (docs/ORGANIZER_SEATMAP_ADDITIONAL_FLOW_AUDIT.md).
 *
 * Findings 1, 3, 4, 5 and 7. Finding 2 is a React-state bug with no server seam, and finding 6 is a
 * product decision rather than a defect — neither is testable here.
 */

async function organizer() {
  const o = await registerUser();
  await makeApprovedOrganizer(o.userId);
  return { ...o, h: bearer(o.token) };
}

const uniq = () => `${Date.now()}${Math.random()}`.replace(".", "");

async function venue(o: { h: Record<string, string> }) {
  return (
    await request(app)
      .post("/api/organizer/venues")
      .set(o.h)
      .send({ name: `V${uniq()}`, city: "Hà Nội", rawAddress: "a" })
      .expect(201)
  ).body.id as number;
}

/** A published chart with two price classes, ten seats each. */
async function twoClassLayout(o: { h: Record<string, string> }, venueId: number, name: string) {
  const layoutId = (
    await request(app)
      .post(`/api/organizer/venues/${venueId}/layouts`)
      .set(o.h)
      .send({ name })
      .expect(201)
  ).body.id as number;
  const layout = (
    await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)
  ).body;
  const doc = {
    ...layout.document,
    // Publishing refuses a seat with no section (FR-030), so the block gets a real one.
    sections: [{ id: -1, name: "Khu A" }],
    categories: [
      { id: -1, name: "Thường", color: "#D93025" },
      { id: -2, name: "VIP", color: "#1A73E8" },
    ],
    blocks: [
      {
        key: "g-1",
        kind: "seating-block",
        title: "Khu A",
        x: 1000,
        y: 1000,
        rotation: 0,
        width: 1500,
        height: 150,
        sectionId: -1,
        categoryId: -1,
        seats: Array.from({ length: 10 }, (_, i) => ({
          seatId: -(i + 1),
          rowLabel: "A",
          seatNumber: i + 1,
          dx: i * 150,
          dy: 0,
          rotation: 0,
          sectionId: -1,
          categoryId: -1,
        })),
      },
    ],
  };
  const saved = (
    await request(app)
      .put(`/api/organizer/layouts/${layoutId}`)
      .set(o.h)
      .send({ version: layout.version, document: doc })
      .expect(200)
  ).body;
  await request(app).post(`/api/organizer/layouts/${layoutId}/publish`).set(o.h).expect(200);
  const catId = (n: string) =>
    saved.categories.find((c: { name: string }) => c.name === n).id as number;
  return {
    layoutId,
    standard: catId("Thường"),
    vip: catId("VIP"),
    sectionId: saved.sections[0].id as number,
  };
}

async function showtimeOn(
  o: { h: Record<string, string> },
  venueId: number,
  tiers: { label: string; price: number }[],
) {
  const ev = (
    await request(app)
      .post("/api/organizer/events")
      .set(o.h)
      .send({ title: `E${uniq()}`, categoryCode: "theatre", description: "d", eventType: "seated" })
      .expect(201)
  ).body.id as number;
  const showtime = (
    await request(app)
      .post(`/api/organizer/events/${ev}/showtimes`)
      .set(o.h)
      .send({
        venueId,
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        tiers,
      })
      .expect(201)
  ).body.id as number;
  const { rows } = await pool.query<{ id: number; label: string }>(
    `SELECT id, label FROM ticket_tiers WHERE showtime_id = $1 ORDER BY price_amount`,
    [showtime],
  );
  return { ev, showtime, tiers: rows };
}

describe("finding 4 — a server-owned geometry write moves the chart's lifecycle", () => {
  it("bumps the version and returns a published chart to draft when a table is added", async () => {
    const o = await organizer();
    const v = await venue(o);
    const { layoutId } = await twoClassLayout(o, v, `L${uniq()}`);

    const before = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h)).body;
    expect(before.status, "published by the fixture").toBe("ready");

    await request(app)
      .post(`/api/organizer/layouts/${layoutId}/tables`)
      .set(o.h)
      .send({
        sectionId: null,
        name: `Bàn ${uniq()}`.slice(0, 20),
        shape: "round",
        x: 5000,
        y: 5000,
        width: 400,
        height: 400,
        rotation: 0,
        seatCount: 4,
      })
      .expect(201);

    const after = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h)).body;
    // Unvalidated geometry must not stay assignable, and a second tab holding `before.version`
    // must not be able to save over the table write.
    expect(after.status, "a changed chart is not the chart that was published").toBe("draft");
    expect(after.version, "version moved, so a stale save is refused").toBeGreaterThan(
      before.version,
    );
  });
});

describe("finding 7 — referenced ids are scoped to the aggregate they are written into", () => {
  it("refuses a table placed into another chart's section", async () => {
    const o = await organizer();
    const v = await venue(o);
    const mine = await twoClassLayout(o, v, `A${uniq()}`);
    const other = await twoClassLayout(o, v, `B${uniq()}`);

    // A real section — of the OTHER chart. Nothing but the new check stops it being used here.
    const foreign = other.sectionId;

    await request(app)
      .post(`/api/organizer/layouts/${mine.layoutId}/tables`)
      .set(o.h)
      .send({
        sectionId: foreign,
        name: "Bàn lạ",
        shape: "round",
        x: 5000,
        y: 5000,
        width: 400,
        height: 400,
        rotation: 0,
        seatCount: 4,
      })
      .expect(400);
  });

  it("refuses a direct map edit naming another showtime's tier", async () => {
    const o = await organizer();
    const v = await venue(o);
    const l = await twoClassLayout(o, v, `L${uniq()}`);
    const a = await showtimeOn(o, v, [{ label: "Thường", price: 100_000 }]);
    const b = await showtimeOn(o, v, [{ label: "Thường", price: 100_000 }]);

    await request(app)
      .post(`/api/organizer/showtimes/${a.showtime}/apply-chart`)
      .set(o.h)
      .send({ layoutId: l.layoutId, mappings: [{ categoryId: l.standard, tierId: a.tiers[0].id }] })
      .expect(201);

    const map = (
      await request(app).get(`/api/organizer/showtimes/${a.showtime}/seat-map`).set(o.h).expect(200)
    ).body;
    const seat = map.seats[0];

    // The route authorises showtime A; the tier belongs to showtime B. Nothing in the schema ties
    // them together, so only this check stands between the two showtimes' inventory accounting.
    await request(app)
      .put(`/api/organizer/showtimes/${a.showtime}/seat-map`)
      .set(o.h)
      .send({
        seats: [
          {
            showtimeSeatId: seat.id,
            seatId: seat.seatId,
            rowLabel: seat.rowLabel,
            seatNumber: seat.seatNumber,
            sectionName: seat.sectionName ?? null,
            ticketTierId: b.tiers[0].id,
            x: seat.x,
            y: seat.y,
            rotation: 0,
          },
        ],
      })
      .expect(400);
  });

  it("refuses two lines naming one seat, rather than letting preview and write disagree", async () => {
    const o = await organizer();
    const v = await venue(o);
    const l = await twoClassLayout(o, v, `L${uniq()}`);
    const a = await showtimeOn(o, v, [{ label: "Thường", price: 100_000 }]);

    await request(app)
      .post(`/api/organizer/showtimes/${a.showtime}/apply-chart`)
      .set(o.h)
      .send({ layoutId: l.layoutId, mappings: [{ categoryId: l.standard, tierId: a.tiers[0].id }] })
      .expect(201);

    const map = (
      await request(app).get(`/api/organizer/showtimes/${a.showtime}/seat-map`).set(o.h).expect(200)
    ).body;
    const seat = map.seats[0];
    const line = (x: number) => ({
      showtimeSeatId: seat.id,
      seatId: seat.seatId,
      rowLabel: seat.rowLabel,
      seatNumber: seat.seatNumber,
      sectionName: seat.sectionName ?? null,
      ticketTierId: a.tiers[0].id,
      x,
      y: seat.y,
      rotation: 0,
    });

    await request(app)
      .put(`/api/organizer/showtimes/${a.showtime}/seat-map`)
      .set(o.h)
      .send({ seats: [line(2000), line(3000)] })
      .expect(400);
  });
});

describe("finding 5 — a confirm can only confirm the preview that was shown", () => {
  it("refuses a confirm whose source token is stale", async () => {
    const o = await organizer();
    const v = await venue(o);
    const l = await twoClassLayout(o, v, `L${uniq()}`);
    const a = await showtimeOn(o, v, [{ label: "Thường", price: 100_000 }]);

    await request(app)
      .post(`/api/organizer/showtimes/${a.showtime}/apply-chart`)
      .set(o.h)
      .send({ layoutId: l.layoutId, mappings: [{ categoryId: l.standard, tierId: a.tiers[0].id }] })
      .expect(201);

    const preview = (
      await request(app)
        .post(`/api/organizer/showtimes/${a.showtime}/seat-map/reapply`)
        .set(o.h)
        .send({ dryRun: true })
        .expect(200)
    ).body;
    expect(preview.source.layoutId).toBe(l.layoutId);

    // The organizer edits the source chart in another tab AFTER reading the preview.
    const layout = (await request(app).get(`/api/organizer/layouts/${l.layoutId}`).set(o.h)).body;
    await request(app)
      .put(`/api/organizer/layouts/${l.layoutId}`)
      .set(o.h)
      .send({
        version: layout.version,
        document: {
          ...layout.document,
          blocks: layout.document.blocks.map((b: { x: number }) => ({ ...b, x: b.x + 500 })),
        },
      })
      .expect(200);

    // Confirming the preview they read must not silently apply the state they did not.
    await request(app)
      .post(`/api/organizer/showtimes/${a.showtime}/seat-map/reapply`)
      .set(o.h)
      .send({ dryRun: false, source: preview.source })
      .expect(409)
      .expect((r) => expect(r.body.error).toBe("stale_preview"));
  });
});

describe("finding 1 — re-apply prices a seat by its own class", () => {
  it("re-prices a seat moved into another class instead of keeping the old tier", async () => {
    const o = await organizer();
    const v = await venue(o);
    const l = await twoClassLayout(o, v, `L${uniq()}`);
    const a = await showtimeOn(o, v, [
      { label: "Thường", price: 100_000 },
      { label: "VIP", price: 300_000 },
    ]);
    const standardTier = a.tiers.find((t) => t.label === "Thường")!.id;
    const vipTier = a.tiers.find((t) => t.label === "VIP")!.id;

    await request(app)
      .post(`/api/organizer/showtimes/${a.showtime}/apply-chart`)
      .set(o.h)
      .send({
        layoutId: l.layoutId,
        mappings: [
          { categoryId: l.standard, tierId: standardTier },
          { categoryId: l.vip, tierId: vipTier },
        ],
      })
      .expect(201);

    // Move the whole block into VIP on the source chart.
    const layout = (
      await request(app).get(`/api/organizer/layouts/${l.layoutId}`).set(o.h).expect(200)
    ).body;
    await request(app)
      .put(`/api/organizer/layouts/${l.layoutId}`)
      .set(o.h)
      .send({
        version: layout.version,
        document: {
          ...layout.document,
          blocks: layout.document.blocks.map((b: { seats?: object[] }) => ({
            ...b,
            categoryId: l.vip,
            // The SEAT carries the class the projection writes to `seats.category_id`; changing only
            // the block would leave every seat in the old class and prove nothing.
            seats: (b.seats ?? []).map((sd: object) => ({ ...sd, categoryId: l.vip })),
          })),
        },
      })
      .expect(200);
    await request(app).post(`/api/organizer/layouts/${l.layoutId}/publish`).set(o.h).expect(200);

    const preview = (
      await request(app)
        .post(`/api/organizer/showtimes/${a.showtime}/seat-map/reapply`)
        .set(o.h)
        .send({ dryRun: true })
        .expect(200)
    ).body;
    expect(
      preview.changes.filter((c: { kind: string }) => c.kind === "retier").length,
      "the class change IS a repricing, and the preview says so",
    ).toBeGreaterThan(0);

    await request(app)
      .post(`/api/organizer/showtimes/${a.showtime}/seat-map/reapply`)
      .set(o.h)
      .send({ dryRun: false, source: preview.source })
      .expect(200);

    const { rows } = await pool.query<{ ticket_tier_id: number; category_name: string }>(
      `SELECT ticket_tier_id, category_name FROM showtime_seats WHERE showtime_id = $1`,
      [a.showtime],
    );
    expect(rows.length).toBeGreaterThan(0);
    // Both halves: the price, and the class name the buyer's legend reads.
    expect(rows.every((r) => Number(r.ticket_tier_id) === vipTier), "repriced to VIP").toBe(true);
    expect(rows.every((r) => r.category_name === "VIP"), "and relabelled VIP").toBe(true);
  });
});

describe("finding 3 — each assignable chart carries its own price classes", () => {
  it("returns categories per assignable layout, not only for the display default", async () => {
    const o = await organizer();
    const v = await venue(o);
    const a = await twoClassLayout(o, v, `A${uniq()}`);
    const b = await twoClassLayout(o, v, `B${uniq()}`);
    const st = await showtimeOn(o, v, [{ label: "Thường", price: 100_000 }]);

    const rows = (
      await request(app)
        .get(`/api/organizer/events/${st.ev}/showtimes-manage`)
        .set(o.h)
        .expect(200)
    ).body;
    const row = rows.find((r: { id: number }) => r.id === st.showtime);

    expect(row.assignableLayouts.length, "both published charts are offered").toBe(2);
    for (const id of [a.layoutId, b.layoutId]) {
      const entry = row.assignableLayouts.find((l: { id: number }) => l.id === id);
      expect(entry, `chart ${id} is offered`).toBeTruthy();
      // Without this the picker changed an id while the pricing controls kept reading the display
      // default's classes, and submitting the other chart was refused by the apply boundary.
      expect(
        entry.categories.filter((c: { hasInventory: boolean }) => c.hasInventory).length,
        "and carries its OWN stocked classes",
      ).toBeGreaterThan(0);
    }
  });
});
