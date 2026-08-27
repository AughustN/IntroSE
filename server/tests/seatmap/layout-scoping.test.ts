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

const venueOf = async (o: { h: Record<string, string> }, name: string) =>
  (
    await request(app)
      .post("/api/organizer/venues")
      .set(o.h)
      .send({ name: `${name}${Date.now()}${Math.random()}`, city: "Hà Nội", rawAddress: "a" })
      .expect(201)
  ).body.id as number;

const layoutOf = async (o: { h: Record<string, string> }, venue: number, name: string) =>
  (
    await request(app)
      .post(`/api/organizer/venues/${venue}/layouts`)
      .set(o.h)
      .send({ name })
      .expect(201)
  ).body.id as number;

const sectionOf = async (
  o: { h: Record<string, string> },
  venue: number,
  layoutId: number,
  name: string,
) =>
  (
    await request(app)
      .post(`/api/organizer/venues/${venue}/sections`)
      .set(o.h)
      .send({ layoutId, name })
      .expect(201)
  ).body.id as number;

/**
 * Quick tools write into ONE chart, and only into sections that chart owns.
 *
 * `seats.layout_id` and `seats.section_id` are independent foreign keys, so a row naming chart A and
 * a section of chart B satisfies both and the database takes it. Nothing else in the suite covers
 * these two endpoints at all, which is how the combination survived.
 */
describe("quick-tool writes stay inside one layout", () => {
  it("refuses a section that belongs to a DIFFERENT layout of the same venue", async () => {
    const o = await organizer();
    const venue = await venueOf(o, "QT");
    const a = await layoutOf(o, venue, "Sơ đồ A");
    const b = await layoutOf(o, venue, "Sơ đồ B");
    const sectionInB = await sectionOf(o, venue, b, "Khu của B");

    // Chart A, section of chart B: the pair that used to be stored without complaint.
    await request(app)
      .post(`/api/organizer/venues/${venue}/seats`)
      .set(o.h)
      .send({ layoutId: a, sectionId: sectionInB, rowLabel: "A", count: 4 })
      .expect(400)
      .expect((r) => expect(r.body.error).toBe("validation_failed"));

    // The same call against the section's OWN chart is accepted.
    await request(app)
      .post(`/api/organizer/venues/${venue}/seats`)
      .set(o.h)
      .send({ layoutId: b, sectionId: sectionInB, rowLabel: "A", count: 4 })
      .expect(201);
  });

  it("refuses a layout that belongs to another venue", async () => {
    const o = await organizer();
    const mine = await venueOf(o, "Mine");
    const other = await venueOf(o, "Other");
    const elsewhere = await layoutOf(o, other, "Sơ đồ nơi khác");

    await request(app)
      .post(`/api/organizer/venues/${mine}/sections`)
      .set(o.h)
      .send({ layoutId: elsewhere, name: "Khu A" })
      .expect(400)
      .expect((r) => expect(r.body.error).toBe("validation_failed"));
  });
});

/**
 * Applying a chart names it. The endpoint used to fall back to the venue's OLDEST chart, filtered by
 * nothing, so an organizer who published chart B could have chart A bound instead — and an archived
 * chart or a template could become the implicit target.
 */
describe("seat-map generation binds the chart the caller names", () => {
  it("refuses a request that names no layout at all", async () => {
    const o = await organizer();
    const venue = await venueOf(o, "NoLayout");
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

    await request(app)
      .post(`/api/organizer/showtimes/${showtime}/seat-map`)
      .set(o.h)
      .send({})
      .expect(400);
  });
});

/**
 * A quick-tool write is a chart edit, and the chart has to know it.
 *
 * These endpoints write `sections` and `seats` rows directly, outside the authoring document — the
 * same shape `tables.ts` and `standing.ts` use, and they call `geometryWritten` for it. These did not.
 * The editor therefore opened on a stored document that omitted the rows just added, and the next
 * document save wrote that stale picture back, archiving them. A `ready` chart also stayed `ready`,
 * so an edited chart could be bound to a showtime without being re-published.
 */
describe("quick-tool writes put the chart back into draft", () => {
  it("forgets the stored document and demotes a published chart", async () => {
    const o = await organizer();
    const venue = await venueOf(o, "Lifecycle");
    const layoutId = await layoutOf(o, venue, "Sơ đồ");
    const section = await sectionOf(o, venue, layoutId, "Khu A");
    await request(app)
      .post(`/api/organizer/layouts/${layoutId}/generate-seats`)
      .set(o.h)
      .send({ sectionId: section, rowLabel: "A", count: 4 })
      .expect(201);
    await request(app).post(`/api/organizer/layouts/${layoutId}/publish`).set(o.h).expect(200);

    const before = await pool.query<{ status: string }>(
      `SELECT status FROM venue_layouts WHERE id = $1`,
      [layoutId],
    );
    expect(before.rows[0].status).toBe("ready");

    await request(app)
      .post(`/api/organizer/venues/${venue}/seats`)
      .set(o.h)
      .send({ layoutId, sectionId: section, rowLabel: "B", count: 4 })
      .expect(201);

    const after = await pool.query<{ status: string; document: unknown }>(
      `SELECT status, document FROM venue_layouts WHERE id = $1`,
      [layoutId],
    );
    expect(after.rows[0].status, "an edited chart is no longer the published one").toBe("draft");
    expect(after.rows[0].document, "the stored document no longer describes the chart").toBeNull();

    // ...and the seats are visible to the editor, which reads through the same layout.
    const layout = (
      await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)
    ).body;
    expect(layout.seats).toHaveLength(8);
  });

  it("refuses to guess when the venue owns more than one chart", async () => {
    const o = await organizer();
    const venue = await venueOf(o, "Ambiguous");
    await layoutOf(o, venue, "Sơ đồ A");
    await layoutOf(o, venue, "Sơ đồ B");

    // No `layoutId`: with two charts, "the venue's oldest" is a coin toss, not an answer.
    await request(app)
      .post(`/api/organizer/venues/${venue}/sections`)
      .set(o.h)
      .send({ name: "Khu A" })
      .expect(400)
      .expect((r) => expect(r.body.error).toBe("validation_failed"));
  });
});
