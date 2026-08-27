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

async function standingShowtime(o: { h: Record<string, string> }, capacity: number) {
  const venue = (await request(app).post("/api/organizer/venues").set(o.h)
    .send({ name: `V${Date.now()}${Math.random()}`, city: "Hà Nội", rawAddress: "a" }).expect(201)).body.id;
  const layoutId = (await request(app).post(`/api/organizer/venues/${venue}/layouts`).set(o.h)
    .send({ name: "Sơ đồ đứng" }).expect(201)).body.id as number;
  const layout = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;
  const doc = {
    ...layout.document,
    categories: [{ id: -1, name: "Đứng", color: "#D93025" }],
    blocks: [{ key: "z-1", kind: "ga-zone", title: "Sân đứng", x: 2000, y: 2000, rotation: 0,
               width: 3000, height: 2000, sectionId: null, categoryId: -1, capacity }],
  };
  const saved = (await request(app).put(`/api/organizer/layouts/${layoutId}`).set(o.h)
    .send({ version: layout.version, document: doc }).expect(200)).body;
  const categoryId = saved.categories.find((c: { name: string }) => c.name === "Đứng").id as number;
  await request(app).post(`/api/organizer/layouts/${layoutId}/publish`).set(o.h).expect(200);
  const ev = (await request(app).post("/api/organizer/events").set(o.h)
    .send({ title: "S", categoryCode: "theatre", description: "d", eventType: "seated" }).expect(201)).body.id;
  const showtime = (await request(app).post(`/api/organizer/events/${ev}/showtimes`).set(o.h)
    .send({ venueId: venue, startsAt: new Date(Date.now() + 86_400_000).toISOString(),
            tiers: [{ label: "Đứng", price: 200_000 }] }).expect(201)).body.id;
  const tierId = (await pool.query<{ id: number }>(
    `SELECT id FROM ticket_tiers WHERE showtime_id = $1 LIMIT 1`, [showtime])).rows[0].id;
  return { venue, layoutId, categoryId, ev, showtime, tierId };
}

/**
 * "Applied" means inventory exists, and a capacity zone is inventory with no seat rows.
 *
 * `hasSeatMap` and `bookableSeats` were both read from `showtime_seats` alone, so a standing-only
 * chart generated its tier quantity and then went on reporting "chưa áp dụng sơ đồ" — the organizer
 * applied it again and again and the flow never moved off that step.
 */
describe("a capacity-zone chart reports itself APPLIED", () => {
  it("says hasSeatMap after apply, even with no seat rows", async () => {
    const o = await organizer();
    const s = await standingShowtime(o, 5000);

    await request(app).post(`/api/organizer/showtimes/${s.showtime}/apply-chart`).set(o.h)
      .send({ layoutId: s.layoutId, mappings: [{ categoryId: s.categoryId, tierId: s.tierId }] })
      .expect(201);

    const rows = (await request(app).get(`/api/organizer/events/${s.ev}/showtimes-manage`)
      .set(o.h).expect(200)).body;
    const st = rows.find((r: { id: number }) => r.id === s.showtime);
    expect(st.hasSeatMap, "a zone-only chart IS applied").toBe(true);
    expect(st.zoneCapacity, "and its capacity is reported").toBe(5000);
  });
});
