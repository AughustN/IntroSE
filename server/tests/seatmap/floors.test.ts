import request from "supertest";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { app } from "../helpers/app.js";
import { bearer, makeApprovedOrganizer, registerUser } from "../helpers/authFixture.js";

/*
 * Floors (0044) — the last of the six starter NOTES.
 *
 * A floor hangs off a SECTION, not off a seat: a section cannot straddle two levels, and the buyer
 * already learns a seat's section by name through the snapshot, so the floor rides that key instead
 * of needing a column on `showtime_seats`.
 *
 * Null is the single implicit floor, which is what every chart drawn before this has.
 */

async function organizer() {
  const o = await registerUser();
  await makeApprovedOrganizer(o.userId);
  return { ...o, h: bearer(o.token) };
}

async function chart(o: { h: Record<string, string> }) {
  const venue = (
    await request(app)
      .post("/api/organizer/venues")
      .set(o.h)
      .send({ name: `V${Date.now()}${Math.random()}`, city: "Hà Nội", rawAddress: "a" })
      .expect(201)
  ).body.id;
  const layoutId = (
    await request(app)
      .post(`/api/organizer/venues/${venue}/layouts`)
      .set(o.h)
      .send({ name: "Nhà hát hai tầng" })
      .expect(201)
  ).body.id as number;
  const layout = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200))
    .body;
  return { venue, layoutId, layout };
}

describe("floors round-trip through the document", () => {
  it("creates floors and the sections standing on them, resolving placeholders in ONE save", async () => {
    const o = await organizer();
    const { layoutId, layout } = await chart(o);

    // Every id here is a placeholder the editor minted this session — floors included. The section
    // points at a floor that does not exist yet, which is the case that orders the writer: floors
    // must be reconciled before sections or this foreign key cannot resolve.
    const doc = {
      ...layout.document,
      floors: [
        { id: -1, name: "Tầng trệt", displayOrder: 0 },
        { id: -2, name: "Ban công", displayOrder: 1 },
      ],
      sections: [
        { id: -10, name: "Khu A", floorId: -1 },
        { id: -11, name: "Khu ban công", floorId: -2 },
        { id: -12, name: "Không tầng", floorId: null },
      ],
      categories: [{ id: -20, name: "Thường", color: "#E69F00" }],
      blocks: [],
    };
    const saved = (
      await request(app)
        .put(`/api/organizer/layouts/${layoutId}`)
        .set(o.h)
        .send({ version: layout.version, document: doc })
        .expect(200)
    ).body;

    expect(saved.floors.map((f: { name: string }) => f.name)).toEqual(["Tầng trệt", "Ban công"]);
    const byName = new Map(
      saved.sections.map((s: { name: string; floorId: number | null }) => [s.name, s.floorId]),
    );
    const floorId = new Map(saved.floors.map((f: { name: string; id: number }) => [f.name, f.id]));
    expect(byName.get("Khu A")).toBe(floorId.get("Tầng trệt"));
    expect(byName.get("Khu ban công")).toBe(floorId.get("Ban công"));
    // Null survives as null — it is a meaning (the implicit single floor), not a missing value.
    expect(byName.get("Không tầng")).toBeNull();
  });

  it("moves a section back OFF a floor — null has to be writable, not just readable", async () => {
    const o = await organizer();
    const { layoutId, layout } = await chart(o);
    const first = (
      await request(app)
        .put(`/api/organizer/layouts/${layoutId}`)
        .set(o.h)
        .send({
          version: layout.version,
          document: {
            ...layout.document,
            floors: [{ id: -1, name: "Ban công", displayOrder: 1 }],
            sections: [{ id: -10, name: "Khu A", floorId: -1 }],
            categories: [],
            blocks: [],
          },
        })
        .expect(200)
    ).body;
    expect(first.sections[0].floorId).not.toBeNull();

    const back = (
      await request(app)
        .put(`/api/organizer/layouts/${layoutId}`)
        .set(o.h)
        .send({
          version: first.version,
          document: {
            ...first.document,
            sections: first.document.sections.map((s: object) => ({ ...s, floorId: null })),
          },
        })
        .expect(200)
    ).body;
    expect(back.sections[0].floorId).toBeNull();
  });

  it("deleting a floor keeps the seats standing on it — ON DELETE SET NULL, never CASCADE", async () => {
    const o = await organizer();
    const { layoutId, layout } = await chart(o);
    const seats = [];
    for (let i = 0; i < 6; i++)
      seats.push({
        seatId: 0,
        rowLabel: "A",
        seatNumber: i + 1,
        dx: i * 120,
        dy: 0,
        rotation: 0,
        categoryId: -20,
      });
    const first = (
      await request(app)
        .put(`/api/organizer/layouts/${layoutId}`)
        .set(o.h)
        .send({
          version: layout.version,
          document: {
            ...layout.document,
            floors: [{ id: -1, name: "Ban công", displayOrder: 1 }],
            sections: [{ id: -10, name: "Khu ban công", floorId: -1 }],
            categories: [{ id: -20, name: "Thường", color: "#E69F00" }],
            blocks: [
              {
                key: "b1",
                kind: "seating-block",
                title: "Ban công",
                x: 2000,
                y: 2000,
                rotation: 0,
                width: 720,
                height: 100,
                sectionId: -10,
                categoryId: -20,
                seats,
              },
            ],
          },
        })
        .expect(200)
    ).body;
    expect(first.seats).toHaveLength(6);

    const after = (
      await request(app)
        .put(`/api/organizer/layouts/${layoutId}`)
        .set(o.h)
        .send({ version: first.version, document: { ...first.document, floors: [] } })
        .expect(200)
    ).body;

    // The level is gone; the inventory that stood on it is not.
    expect(after.floors).toHaveLength(0);
    expect(after.seats).toHaveLength(6);
    expect(after.sections[0].floorId).toBeNull();
    const live = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM seats WHERE layout_id = $1 AND archived_at IS NULL`,
      [layoutId],
    );
    expect(live.rows[0].n).toBe(6);
  });

  it("a chart with no floors reads back as a single-floor chart, unchanged", async () => {
    const o = await organizer();
    const { layoutId, layout } = await chart(o);
    expect(layout.floors).toEqual([]);
    const saved = (
      await request(app)
        .put(`/api/organizer/layouts/${layoutId}`)
        .set(o.h)
        .send({
          version: layout.version,
          document: {
            ...layout.document,
            sections: [{ id: -10, name: "Khu A" }],
            categories: [],
            blocks: [],
          },
        })
        .expect(200)
    ).body;
    expect(saved.floors).toEqual([]);
    expect(saved.sections[0].floorId).toBeNull();
  });
});

/*
 * The buyer's half.
 *
 * The point of hanging a floor off the section is that it reaches the buyer through the snapshot's
 * `sectionStyles`, keyed by name — the only section identity a `showtime_seats` row carries. If that
 * is right, floors cost the buyer's side one lookup and no schema change at all.
 */
describe("floors reach the buyer through the snapshot", () => {
  it("labels every seat with its floor, and lists the floors in order", async () => {
    const o = await organizer();
    const { venue, layoutId, layout } = await chart(o);

    const seatsOn = (n: number, sectionId: number) =>
      Array.from({ length: 4 }, (_, i) => ({
        seatId: 0,
        rowLabel: n === 1 ? "A" : "B",
        seatNumber: i + 1,
        dx: i * 150,
        dy: 0,
        rotation: 0,
        categoryId: -20,
        sectionId,
      }));

    const first = (
      await request(app)
        .put(`/api/organizer/layouts/${layoutId}`)
        .set(o.h)
        .send({
          version: layout.version,
          document: {
            ...layout.document,
            floors: [
              { id: -1, name: "Tầng trệt", displayOrder: 0 },
              { id: -2, name: "Ban công", displayOrder: 1 },
            ],
            sections: [
              { id: -10, name: "Khu sàn", floorId: -1 },
              { id: -11, name: "Khu ban công", floorId: -2 },
            ],
            categories: [{ id: -20, name: "Thường", color: "#E69F00" }],
            blocks: [
              {
                key: "b1",
                kind: "seating-block",
                title: "Sàn",
                x: 2000,
                y: 4000,
                rotation: 0,
                width: 600,
                height: 100,
                sectionId: -10,
                categoryId: -20,
                seats: seatsOn(1, -10),
              },
              {
                key: "b2",
                kind: "seating-block",
                title: "Ban công",
                x: 2000,
                y: 2000,
                rotation: 0,
                width: 600,
                height: 100,
                sectionId: -11,
                categoryId: -20,
                seats: seatsOn(2, -11),
              },
              {
                key: "s1",
                kind: "stage",
                title: "Sân khấu",
                x: 2300,
                y: 5200,
                rotation: 0,
                width: 1200,
                height: 300,
                sectionId: -10,
                categoryId: null,
              },
            ],
          },
        })
        .expect(200)
    ).body;
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
          tiers: [{ label: "Thường", price: 100_000 }],
        })
        .expect(201)
    ).body.id;
    const cat = first.categories[0].id;
    await pool.query(`UPDATE ticket_tiers SET category_id = $2 WHERE showtime_id = $1`, [
      showtime,
      cat,
    ]);
    await request(app)
      .post(`/api/organizer/showtimes/${showtime}/seat-map`)
      .set(o.h)
      .send({ layoutId })
      .expect(201);

    const snap = await pool.query<{ s: { floors?: unknown[] } }>(
      `SELECT layout_snapshot AS s FROM showtimes WHERE id = $1`,
      [showtime],
    );
    expect(snap.rows[0].s.floors).toEqual([
      { name: "Tầng trệt", displayOrder: 0 },
      { name: "Ban công", displayOrder: 1 },
    ]);

    // The buyer's read is gated on public visibility: on sale, admin approved, organizer approved.
    await pool.query(
      `UPDATE events SET status = 'on_sale', moderation_status = 'approved' WHERE id = $1`,
      [ev],
    );
    await pool.query(`UPDATE organizers SET status = 'approved' WHERE user_id = $1`, [o.userId]);

    // What the BUYER receives — no auth, the public read.
    const map = (await request(app).get(`/api/showtimes/${showtime}/seat-map`).expect(200)).body;
    const floorOf = new Map<string, string | null>(
      map.seats.map((s: { section: string; floor: string | null }) => [s.section, s.floor]),
    );
    expect(floorOf.get("Khu sàn")).toBe("Tầng trệt");
    expect(floorOf.get("Khu ban công")).toBe("Ban công");
    expect(map.floors).toEqual([
      { name: "Tầng trệt", displayOrder: 0 },
      { name: "Ban công", displayOrder: 1 },
    ]);

    // Decoration carries its floor too, or a stage drawn on the stalls would also be drawn over the
    // balcony on every floor the buyer switched to.
    const stage = map.elements.find((e: { kind: string }) => e.kind === "stage");
    expect(stage.floor).toBe("Tầng trệt");
  });
});

describe("the two-tier stadium bowl", () => {
  it("gives each deck its OWN sections, because a floor hangs off a section", async () => {
    const { STARTERS } = await import("@shared/catalog/seatmap-starters.js");
    const bowl = STARTERS.find((s: { id: string }) => s.id === "stadium")!;
    const doc = bowl.build("l");

    expect(doc.floors?.map((f: { name: string }) => f.name)).toEqual(["Tầng 1", "Tầng 2"]);
    const t1 = doc.floors!.find((f: { name: string }) => f.name === "Tầng 1")!.id;
    const t2 = doc.floors!.find((f: { name: string }) => f.name === "Tầng 2")!.id;

    // Eight stands per deck, sixteen sections, and no section on both levels.
    const lower = doc.sections.filter((s: { floorId?: number | null }) => s.floorId === t1);
    const upper = doc.sections.filter((s: { floorId?: number | null }) => s.floorId === t2);
    expect(lower).toHaveLength(8);
    expect(upper).toHaveLength(8);
    expect(new Set(doc.sections.map((s: { id: number }) => s.id)).size).toBe(16);
    expect(upper.every((s: { name: string }) => s.name.endsWith("T2"))).toBe(true);
  });

  it("draws the upper deck as an OUTER ring, not stacked on the lower one", async () => {
    const { STARTERS } = await import("@shared/catalog/seatmap-starters.js");
    const { projectDocument } = await import("@shared/catalog/seatmap-project.js");
    const bowl = STARTERS.find((s: { id: string }) => s.id === "stadium")!;
    const projected = projectDocument(bowl.build("l"));

    const floorOf = new Map(projected.sections.map((s) => [s.id as number, s.floorId ?? null]));
    const t2 = bowl.build("l").floors!.find((f: { name: string }) => f.name === "Tầng 2")!.id;
    const centre = { x: 15000, y: 15000 };
    const radius = (s: { x: number; y: number }) => Math.hypot(s.x - centre.x, s.y - centre.y);

    const upperSeats = projected.seats.filter((s) => floorOf.get(s.sectionId as number) === t2);
    const lowerSeats = projected.seats.filter((s) => floorOf.get(s.sectionId as number) !== t2);
    expect(upperSeats.length).toBeGreaterThan(0);
    // Every upper seat is further from the pitch than every lower one — that is what "outer ring"
    // means, and it is what keeps the whole bowl legible with both decks shown at once.
    expect(Math.min(...upperSeats.map(radius))).toBeGreaterThan(
      Math.max(...lowerSeats.map(radius)),
    );
  });

  it("is publishable — the two-tier bowl is the shape the floor-blind overlap rule used to refuse", async () => {
    const o = await organizer();
    const { layoutId, layout } = await chart(o);
    const { STARTERS } = await import("@shared/catalog/seatmap-starters.js");
    const bowl = STARTERS.find((s: { id: string }) => s.id === "stadium")!;

    const saved = (
      await request(app)
        .put(`/api/organizer/layouts/${layoutId}`)
        .set(o.h)
        .send({ version: layout.version, document: bowl.build("l") })
        .expect(200)
    ).body;
    expect(saved.floors.map((f: { name: string }) => f.name)).toEqual(["Tầng 1", "Tầng 2"]);

    const v = await request(app)
      .post(`/api/organizer/layouts/${layoutId}/validate`)
      .set(o.h)
      .expect(200);
    const blocking = (v.body.issues ?? []).filter(
      (i: { severity?: string }) => i.severity !== "warning",
    );
    expect(blocking).toEqual([]);
    await request(app).post(`/api/organizer/layouts/${layoutId}/publish`).set(o.h).expect(200);
  });
});

/*
 * The round trip, which is where floors actually broke.
 *
 * `upgradeDocument` rebuilds the document FIELD BY FIELD so an unknown key cannot survive a schema
 * change — a deliberate design with a sharp edge its own comment names: a new field must be added
 * there too, or it reads back as nothing. `floors` was added to the type and to every writer but not
 * to that rebuild, so a saved two-tier chart came back to the editor with no levels at all: no layer
 * picker, and sections pointing at floors the document no longer declared.
 */
describe("floors survive a save and a reload", () => {
  it("comes back with its levels, and its sections still standing on them", async () => {
    const o = await organizer();
    const { layoutId, layout } = await chart(o);
    const { STARTERS } = await import("@shared/catalog/seatmap-starters.js");
    const bowl = STARTERS.find((s: { id: string }) => s.id === "stadium")!;

    await request(app)
      .put(`/api/organizer/layouts/${layoutId}`)
      .set(o.h)
      .send({ version: layout.version, document: bowl.build("xl") })
      .expect(200);

    // Re-READ, which is the step that used to lose them.
    const back = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200))
      .body;

    expect(back.document.floors.map((f: { name: string }) => f.name)).toEqual(["Tầng 1", "Tầng 2"]);
    // Real ids, not the editor placeholders the starter minted.
    for (const f of back.document.floors) expect(f.id).toBeGreaterThan(0);

    // Every section still points at a floor the document declares — the check that catches both a
    // dropped `floors` array and a placeholder that was never translated.
    const declared = new Set(back.document.floors.map((f: { id: number }) => f.id));
    const onFloor = back.document.sections.filter(
      (x: { floorId?: number | null }) => x.floorId !== null && x.floorId !== undefined,
    );
    expect(onFloor).toHaveLength(16);
    for (const sec of onFloor) expect(declared.has(sec.floorId)).toBe(true);
  });

  it("survives a SECOND save without re-minting its levels", async () => {
    const o = await organizer();
    const { layoutId, layout } = await chart(o);
    const { STARTERS } = await import("@shared/catalog/seatmap-starters.js");
    const bowl = STARTERS.find((s: { id: string }) => s.id === "stadium")!;

    const first = (
      await request(app)
        .put(`/api/organizer/layouts/${layoutId}`)
        .set(o.h)
        .send({ version: layout.version, document: bowl.build("xl") })
        .expect(200)
    ).body;
    const ids = first.floors.map((f: { id: number }) => f.id).sort();

    const second = (
      await request(app)
        .put(`/api/organizer/layouts/${layoutId}`)
        .set(o.h)
        .send({ version: first.version, document: first.document })
        .expect(200)
    ).body;
    // Same rows, not a fresh pair — re-minting would orphan every section on the old ones.
    expect(second.floors.map((f: { id: number }) => f.id).sort()).toEqual(ids);
    expect(
      second.sections.filter((x: { floorId: number | null }) => x.floorId !== null),
    ).toHaveLength(16);
  });
});

describe("the STACKED two-tier bowl", () => {
  it("really does overlap in 2D — otherwise this proves nothing", async () => {
    const { STARTERS } = await import("@shared/catalog/seatmap-starters.js");
    const { projectDocument } = await import("@shared/catalog/seatmap-project.js");
    const bowl = STARTERS.find((s: { id: string }) => s.id === "stadium")!;
    const doc = bowl.build("xl");
    const p = projectDocument(doc);
    const floorOf = new Map(p.sections.map((s) => [s.id as number, s.floorId ?? null]));
    const t2 = doc.floors!.find((f: { name: string }) => f.name === "Tầng 2")!.id;
    const upper = p.seats.filter((s) => floorOf.get(s.sectionId as number) === t2);
    const lower = p.seats.filter((s) => floorOf.get(s.sectionId as number) !== t2);

    // At least one upper seat sits within a seat's width of a lower one — the exact condition the
    // old floor-blind rule reported as `overlapping_seats`.
    const collides = upper.some((u) => lower.some((l) => Math.hypot(u.x - l.x, u.y - l.y) < 100));
    expect(collides).toBe(true);
  });

  it("publishes anyway, because two seats one storey apart share no space", async () => {
    const o = await organizer();
    const { layoutId, layout } = await chart(o);
    const { STARTERS } = await import("@shared/catalog/seatmap-starters.js");
    const bowl = STARTERS.find((s: { id: string }) => s.id === "stadium")!;

    await request(app)
      .put(`/api/organizer/layouts/${layoutId}`)
      .set(o.h)
      .send({ version: layout.version, document: bowl.build("xl") })
      .expect(200);

    const v = await request(app)
      .post(`/api/organizer/layouts/${layoutId}/validate`)
      .set(o.h)
      .expect(200);
    const overlaps = (v.body.issues ?? []).filter(
      (i: { code: string }) => i.code === "overlapping_seats",
    );
    expect(overlaps).toEqual([]);
    await request(app).post(`/api/organizer/layouts/${layoutId}/publish`).set(o.h).expect(200);
  });
});

describe("the theatre starter ships a real balcony", () => {
  it("builds two levels, with the balcony section on the upper one", async () => {
    const { STARTERS } = await import("@shared/catalog/seatmap-starters.js");
    const theatre = STARTERS.find((s: { id: string }) => s.id === "theatre");
    expect(theatre).toBeDefined();
    const doc = theatre!.build();
    expect(doc.floors?.map((f: { name: string }) => f.name)).toEqual(["Tầng trệt", "Ban công"]);
    const upper = doc.floors!.find((f: { name: string }) => f.name === "Ban công")!;
    const balcony = doc.sections.find((s: { name: string }) => s.name === "Ban công")!;
    expect(balcony.floorId).toBe(upper.id);
    // The stalls are NOT on it — the note's symptom was both sharing one plane.
    const stalls = doc.sections.find((s: { name: string }) => s.name === "Khán đài")!;
    expect(stalls.floorId).not.toBe(upper.id);
  });
});
