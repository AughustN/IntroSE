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

/** A published one-class chart, a seated showtime, and its single tier. */
async function scene(o: { h: Record<string, string> }) {
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
      .send({ name: "Sơ đồ" })
      .expect(201)
  ).body.id;
  const section = (
    await request(app)
      .post(`/api/organizer/venues/${venue}/sections`)
      .set(o.h)
      .send({ layoutId, name: "Khu A" })
      .expect(201)
  ).body.id;
  await request(app)
    .post(`/api/organizer/layouts/${layoutId}/generate-seats`)
    .set(o.h)
    .send({ sectionId: section, rowLabel: "A", count: 6 })
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
        tiers: [{ label: "VIP", price: 500_000 }],
      })
      .expect(201)
  ).body.id;

  const layout = (
    await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)
  ).body;
  const { rows: tiers } = await pool.query<{ id: number }>(
    `SELECT id FROM ticket_tiers WHERE showtime_id = $1 AND archived_at IS NULL`,
    [showtime],
  );
  return { venue, layoutId, showtime, tier: tiers[0].id, categoryId: layout.categories[0].id };
}

const boundCategory = async (tierId: number) =>
  (
    await pool.query<{ category_id: number | null }>(
      `SELECT category_id FROM ticket_tiers WHERE id = $1`,
      [tierId],
    )
  ).rows[0].category_id;

const mapSize = async (showtimeId: number) =>
  Number(
    (
      await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM showtime_seats WHERE showtime_id = $1`,
        [showtimeId],
      )
    ).rows[0].n,
  );

/**
 * Pricing and binding are one commit.
 *
 * The console used to PATCH each tier and then generate, so a refusal in the middle left bindings
 * written against a showtime with no map — invisible on screen, and re-entered by hand on the retry.
 */
describe("apply-chart commits pricing and generation together", () => {
  it("refuses the same tier for two classes, and writes nothing", async () => {
    const o = await organizer();
    const s = await scene(o);

    await request(app)
      .post(`/api/organizer/showtimes/${s.showtime}/apply-chart`)
      .set(o.h)
      .send({
        layoutId: s.layoutId,
        mappings: [
          { categoryId: s.categoryId, tierId: s.tier },
          { categoryId: s.categoryId, tierId: s.tier },
        ],
      })
      .expect(400)
      .expect((r) => expect(r.body.error).toBe("duplicate_tier_mapping"));

    expect(await boundCategory(s.tier), "no tier was bound").toBeNull();
    expect(await mapSize(s.showtime), "no map was generated").toBe(0);
  });

  it("refuses a tier that belongs to another showtime, leaving both untouched", async () => {
    const o = await organizer();
    const a = await scene(o);
    const b = await scene(o);

    await request(app)
      .post(`/api/organizer/showtimes/${a.showtime}/apply-chart`)
      .set(o.h)
      .send({ layoutId: a.layoutId, mappings: [{ categoryId: a.categoryId, tierId: b.tier }] })
      .expect(400)
      .expect((r) => expect(r.body.error).toBe("validation_failed"));

    expect(await boundCategory(a.tier)).toBeNull();
    expect(await boundCategory(b.tier)).toBeNull();
    expect(await mapSize(a.showtime)).toBe(0);
  });

  it("binds the class, generates the map, and reports the moderation outcome", async () => {
    const o = await organizer();
    const s = await scene(o);

    const res = await request(app)
      .post(`/api/organizer/showtimes/${s.showtime}/apply-chart`)
      .set(o.h)
      .send({ layoutId: s.layoutId, mappings: [{ categoryId: s.categoryId, tierId: s.tier }] })
      .expect(201);

    expect(res.body.seats).toBe(6);
    // A draft has nothing to return TO, so the flag is false here — but it is now reported at all,
    // which is the half the console used to discard.
    expect(res.body).toHaveProperty("returnedToReview");
    expect(await boundCategory(s.tier)).toBe(s.categoryId);
    expect(await mapSize(s.showtime)).toBe(6);
  });
});
