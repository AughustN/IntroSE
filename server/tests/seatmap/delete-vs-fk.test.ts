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

/** A published chart, applied to a showtime — the state that makes the row undeletable. */
async function appliedChart(o: { h: Record<string, string> }) {
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
    .send({ sectionId: section, rowLabel: "A", count: 4 })
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
  await request(app)
    .post(`/api/organizer/showtimes/${showtime}/apply-chart`)
    .set(o.h)
    .send({
      layoutId,
      mappings: [{ categoryId: layout.categories[0].id, tierId: tiers[0].id }],
    })
    .expect(201);

  return { venue, layoutId, showtime };
}

/**
 * Deletion answers to the foreign keys, not to the calendar.
 *
 * `showtimes.layout_id` was added with no `ON DELETE`, so any showtime that ever named a chart blocks
 * its removal. The library used `usageCount` — which lets go of finished runs — and so lit the delete
 * button up the moment a show was over, handing the organizer a raw foreign-key error.
 */
describe("layout deletion matches what the database will allow", () => {
  it("refuses to delete a chart whose showtime has FINISHED, and says to archive it", async () => {
    const o = await organizer();
    const s = await appliedChart(o);

    // The run has played out. `layoutInUse` stops counting it; the foreign key does not.
    await pool.query(`UPDATE showtimes SET status = 'finished' WHERE id = $1`, [s.showtime]);

    const res = await request(app)
      .delete(`/api/organizer/layouts/${s.layoutId}`)
      .set(o.h)
      .expect(409);
    expect(res.body.error).toBe("layout_in_use");
    expect(res.body.message).toContain("lưu trữ");

    // The row is still there — the refusal was a refusal, not a half-applied delete.
    const { rows } = await pool.query(`SELECT 1 FROM venue_layouts WHERE id = $1`, [s.layoutId]);
    expect(rows).toHaveLength(1);
  });

  it("still allows ARCHIVING that same chart — the action the message names", async () => {
    const o = await organizer();
    const s = await appliedChart(o);
    await pool.query(`UPDATE showtimes SET status = 'finished' WHERE id = $1`, [s.showtime]);

    const res = await request(app)
      .post(`/api/organizer/layouts/${s.layoutId}/archive`)
      .set(o.h)
      .expect(200);
    expect(res.body.status).toBe("archived");
  });

  it("still deletes a chart no showtime has ever named", async () => {
    const o = await organizer();
    const venue = (
      await request(app)
        .post("/api/organizer/venues")
        .set(o.h)
        .send({ name: `Free${Date.now()}${Math.random()}`, city: "Hà Nội", rawAddress: "a" })
        .expect(201)
    ).body.id;
    const layoutId = (
      await request(app)
        .post(`/api/organizer/venues/${venue}/layouts`)
        .set(o.h)
        .send({ name: "Chưa dùng" })
        .expect(201)
    ).body.id;

    await request(app).delete(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(204);
    const { rows } = await pool.query(`SELECT 1 FROM venue_layouts WHERE id = $1`, [layoutId]);
    expect(rows).toHaveLength(0);
  });
});
