import request from "supertest";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { app } from "../helpers/app.js";
import { bearer, makeApprovedOrganizer, registerUser } from "../helpers/authFixture.js";
import { bindAndGenerate, defaultLayoutOf } from "../helpers/seatmapSeed.js";
import { seedEvent, seedShowtime, seedVenue } from "../helpers/catalogSeed.js";

const soon = () => new Date(Date.now() + 86_400_000).toISOString();

async function organizer() {
  const o = await registerUser();
  await makeApprovedOrganizer(o.userId);
  return { ...o, h: bearer(o.token) };
}

/** Seated event with venue + one section of `seatCount` seats + a showtime + tier. */
async function seatedSetup(o: { h: Record<string, string> }, seatCount = 5) {
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
      .send({ name: "Khu A" })
      .expect(201)
  ).body.id;
  await request(app)
    .post(`/api/organizer/venues/${venue}/seats`)
    .set(o.h)
    .send({ sectionId: section, rowLabel: "A", count: seatCount })
    .expect(201);
  const ev = (
    await request(app)
      .post("/api/organizer/events")
      .set(o.h)
      .send({
        title: "Seated Show",
        categoryCode: "theatre",
        description: "d",
        eventType: "seated",
      })
      .expect(201)
  ).body.id;
  const showtime = (
    await request(app)
      .post(`/api/organizer/events/${ev}/showtimes`)
      .set(o.h)
      .send({ venueId: venue, startsAt: soon(), tiers: [{ label: "VIP", price: 500000 }] })
      .expect(201)
  ).body.id;
  const tierId = (
    await pool.query(`SELECT id FROM ticket_tiers WHERE showtime_id = $1 LIMIT 1`, [showtime])
  ).rows[0].id;
  const layoutId = await defaultLayoutOf(venue);
  return { venue, section, showtime, tierId, eventId: ev, layoutId };
}

describe("venue display details (0039 follow-up)", () => {
  it("renames a DRAFT event's venue; its showtimes follow the same ROW", async () => {
    const o = await organizer();
    const venue = (
      await request(app)
        .post("/api/organizer/venues")
        .set(o.h)
        .send({ name: "Nhà hát Cũ", city: "Hà Nội", rawAddress: "1 Đường A" })
        .expect(201)
    ).body.id;
    const ev = (
      await request(app)
        .post("/api/organizer/events")
        .set(o.h)
        .send({
          title: "Draft Show",
          categoryCode: "music",
          description: "d",
          eventType: "general_admission",
        })
        .expect(201)
    ).body.id;
    await request(app)
      .post(`/api/organizer/events/${ev}/showtimes`)
      .set(o.h)
      .send({ venueId: venue, startsAt: soon(), tiers: [{ label: "Thường", price: 100000 }] })
      .expect(201);

    await request(app)
      .patch(`/api/organizer/venues/${venue}`)
      .set(o.h)
      .send({ name: "Nhà hát Mới", rawAddress: "9 Đường B" })
      .expect(200);

    const row = (
      await pool.query(`SELECT name, city, raw_address FROM venues WHERE id = $1`, [venue])
    ).rows[0];
    expect(row.name).toBe("Nhà hát Mới");
    expect(row.city).toBe("Hà Nội"); // an untouched field survives
    expect(row.raw_address).toBe("9 Đường B");

    // The showtime follows automatically — it points at the same VENUE ROW, whose spelling changed.
    const st = (
      await pool.query(
        `SELECT v.name FROM showtimes s JOIN venues v ON v.id = s.venue_id WHERE s.event_id = $1`,
        [ev],
      )
    ).rows[0];
    expect(st.name).toBe("Nhà hát Mới");
  });

  it("freezes the venue once a PUBLISHED event holds a showtime there", async () => {
    const o = await organizer(); // already approved — a second makeApprovedOrganizer would 23505
    const venueId = await seedVenue(o.userId);
    const orgId = (await pool.query(`SELECT id FROM organizers WHERE user_id = $1`, [o.userId]))
      .rows[0].id;
    const ev = await seedEvent({ organizerId: orgId, status: "on_sale", moderation: "approved" });
    await seedShowtime(ev.id, venueId);

    const res = await request(app)
      .patch(`/api/organizer/venues/${venueId}`)
      .set(o.h)
      .send({ name: "Đổi Tên" })
      .expect(409);
    expect(res.body.error).toBe("venue_in_use");
  });

  it("refuses another organizer's venue (ownership)", async () => {
    const owner = await organizer();
    const venueId = await seedVenue(owner.userId);
    const stranger = await organizer();

    const res = await request(app)
      .patch(`/api/organizer/venues/${venueId}`)
      .set(stranger.h)
      .send({ name: "Chiếm Nhà" })
      .expect(403);
    expect(res.body.error).toBe("not_owner");
  });
});

it("binds an UNBOUND draft to a venue and cascades its showtimes (0039)", async () => {
  const o = await organizer();
  const orgId = (await pool.query(`SELECT id FROM organizers WHERE user_id = $1`, [o.userId]))
    .rows[0].id;
  const ev = await seedEvent({ organizerId: orgId, status: "draft" });
  const oldVenue = await seedVenue(o.userId);
  const newVenue = await seedVenue(o.userId);
  await seedShowtime(ev.id, oldVenue);

  await request(app)
    .put(`/api/organizer/events/${ev.id}/venue`)
    .set(o.h)
    .send({ venueId: newVenue })
    .expect(200);

  expect(
    (await pool.query(`SELECT venue_id FROM events WHERE id = $1`, [ev.id])).rows[0].venue_id,
  ).toBe(newVenue);
  // The cascade: the pre-existing showtime moved with the event.
  expect(
    (
      await pool.query(`SELECT DISTINCT venue_id FROM showtimes WHERE event_id = $1`, [ev.id])
    ).rows.map((r: { venue_id: number }) => r.venue_id),
  ).toEqual([newVenue]);
});

it("refuses binding on a NON-draft event", async () => {
  const o = await organizer();
  const orgId = (await pool.query(`SELECT id FROM organizers WHERE user_id = $1`, [o.userId]))
    .rows[0].id;
  const ev = await seedEvent({ organizerId: orgId, status: "on_sale", moderation: "approved" });
  const venueId = await seedVenue(o.userId);

  const res = await request(app)
    .put(`/api/organizer/events/${ev.id}/venue`)
    .set(o.h)
    .send({ venueId })
    .expect(409);
  expect(res.body.error).toBe("event_not_draft");
});

describe("venues & seat-map generation (US5)", () => {
  it("generates one seat per physical seat, tier by section; regenerate → 409", async () => {
    const o = await organizer();
    const s = await seatedSetup(o, 5);

    await bindAndGenerate(o.h, { showtime: s.showtime, layoutId: s.layoutId, publish: false });
    const count = await pool.query(
      `SELECT count(*)::int AS c FROM showtime_seats WHERE showtime_id = $1 AND status = 'available'`,
      [s.showtime],
    );
    expect(count.rows[0].c).toBe(5);

    // regenerate over a live map → 409
    await request(app)
      .post(`/api/organizer/showtimes/${s.showtime}/seat-map`)
      .set(o.h)
      .send({ layoutId: s.layoutId })
      .expect(409);
  });

  it("refuses a category with seats that no tier prices (400)", async () => {
    const o = await organizer();
    const s = await seatedSetup(o, 3);
    // The tier exists but names no category, so the seats it would have to price are unreachable.
    await request(app)
      .post(`/api/organizer/showtimes/${s.showtime}/seat-map`)
      .set(o.h)
      .send({ layoutId: s.layoutId })
      .expect(400)
      .expect((r) => expect(r.body.error).toBe("category_without_tier"));
  });

  it("refuses generating from a layout that is still a draft (409 layout_not_published)", async () => {
    const o = await organizer();
    const s = await seatedSetup(o, 3);
    const category = (
      await request(app).get(`/api/organizer/layouts/${s.layoutId}`).set(o.h).expect(200)
    ).body.categories[0];
    await pool.query(`UPDATE ticket_tiers SET category_id = $2 WHERE id = $1`, [
      s.tierId,
      category.id,
    ]);
    // A draft is a work in progress: binding one would sell seats the organizer is still moving.
    await pool.query(`UPDATE venue_layouts SET status = 'draft' WHERE id = $1`, [s.layoutId]);

    await request(app)
      .post(`/api/organizer/showtimes/${s.showtime}/seat-map`)
      .set(o.h)
      .send({ layoutId: s.layoutId })
      .expect(409)
      .expect((r) => expect(r.body.error).toBe("layout_not_published"));

    // Publishing it makes the same call succeed.
    await request(app).post(`/api/organizer/layouts/${s.layoutId}/publish`).set(o.h).expect(200);
    await request(app)
      .post(`/api/organizer/showtimes/${s.showtime}/seat-map`)
      .set(o.h)
      .send({ layoutId: s.layoutId })
      .expect(201);
  });

  it("refuses another organizer managing my venue, and deleting a seat in a live map (D-F, FR-024)", async () => {
    const a = await organizer();
    const s = await seatedSetup(a, 2);

    // org B cannot add a section to A's venue
    const b = await organizer();
    await request(app)
      .post(`/api/organizer/venues/${s.venue}/sections`)
      .set(b.h)
      .send({ name: "Hack" })
      .expect(403);

    // generate, then a seat in the live map cannot be deleted
    await bindAndGenerate(a.h, { showtime: s.showtime, layoutId: s.layoutId, publish: false });
    const seatId = (
      await pool.query(`SELECT id FROM seats WHERE section_id = $1 LIMIT 1`, [s.section])
    ).rows[0].id;
    await request(app).delete(`/api/organizer/seats/${seatId}`).set(a.h).expect(409);
  });

  it("refuses a COUNT-BACKED tier naming no class — GA leftover on a seated showtime (SC-026)", async () => {
    const o = await organizer();
    const s = await seatedSetup(o, 2);
    // Bind the class so the unpriced gate passes, then give a SECOND, unbound tier a quantity:
    // head-count inventory beside seat inventory is exactly the mixed showtime SC-026 forbids.
    const category = (
      await request(app).get(`/api/organizer/layouts/${s.layoutId}`).set(o.h).expect(200)
    ).body.categories[0];
    await pool.query(`UPDATE ticket_tiers SET category_id = $2 WHERE id = $1`, [
      s.tierId,
      category.id,
    ]);
    await pool.query(
      `INSERT INTO ticket_tiers (showtime_id, label, price_amount, total_quantity)
       VALUES ($1, 'Vé lẻ', 100000, 50)`,
      [s.showtime],
    );

    await request(app)
      .post(`/api/organizer/showtimes/${s.showtime}/seat-map`)
      .set(o.h)
      .send({ layoutId: s.layoutId })
      .expect(400)
      .expect((r) => expect(r.body.error).toBe("seated_tier_without_category"));

    // The inert shape passes: same tier without a quantity is nobody's price and nobody's count.
    await pool.query(`DELETE FROM ticket_tiers WHERE label = 'Vé lẻ' AND showtime_id = $1`, [
      s.showtime,
    ]);
    await pool.query(
      `INSERT INTO ticket_tiers (showtime_id, label, price_amount) VALUES ($1, 'Vé lẻ', 100000)`,
      [s.showtime],
    );
    await request(app)
      .post(`/api/organizer/showtimes/${s.showtime}/seat-map`)
      .set(o.h)
      .send({ layoutId: s.layoutId })
      .expect(201);
  });
});
