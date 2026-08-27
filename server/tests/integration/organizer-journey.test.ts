import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../helpers/app.js";
import { bearer, makeApprovedOrganizer, registerUser } from "../helpers/authFixture.js";
import { pool } from "../../src/db/pool.js";

/**
 * The organizer journey, end to end, at the seam where the screens actually meet.
 *
 * Every gate in this flow already had a test of its own. What none of them covered is the CHAIN: the
 * audit's findings were all failures of one step handing off to the next — a chart chosen in the
 * editor and a different one applied, prices written without the map they were for, an applied chart
 * still reporting itself unapplied. Those live between the tests, not inside them.
 *
 * So this walks the whole thing once, in order, asserting the state the CONSOLE would read after each
 * step rather than the row a repository wrote.
 */

async function organizer() {
  const o = await registerUser();
  await makeApprovedOrganizer(o.userId);
  return { ...o, h: bearer(o.token) };
}

type H = Record<string, string>;

const venueOf = async (o: { h: H }, name: string) =>
  (
    await request(app)
      .post("/api/organizer/venues")
      .set(o.h)
      .send({ name: `${name}${Date.now()}${Math.random()}`, city: "Hà Nội", rawAddress: "a" })
      .expect(201)
  ).body.id as number;

/** A chart with `count` seats in one section, left unpublished. */
async function drawChart(o: { h: H }, venue: number, name: string, count = 6) {
  const layoutId = (
    await request(app)
      .post(`/api/organizer/venues/${venue}/layouts`)
      .set(o.h)
      .send({ name })
      .expect(201)
  ).body.id as number;
  const section = (
    await request(app)
      .post(`/api/organizer/venues/${venue}/sections`)
      .set(o.h)
      .send({ layoutId, name: `Khu ${name}` })
      .expect(201)
  ).body.id as number;
  await request(app)
    .post(`/api/organizer/layouts/${layoutId}/generate-seats`)
    .set(o.h)
    .send({ sectionId: section, rowLabel: "A", count })
    .expect(201);
  return { layoutId, section };
}

const manage = async (o: { h: H }, eventId: number) =>
  (await request(app).get(`/api/organizer/events/${eventId}/showtimes-manage`).set(o.h).expect(200))
    .body as {
    id: number;
    hasSeatMap: boolean;
    bookableSeats: number;
    zoneCapacity: number;
    layoutStatus: string | null;
    assignableLayouts: { id: number; name: string }[];
    categories: { id: number; hasInventory: boolean }[];
    tiers: { id: number }[];
  }[];

async function seatedEvent(o: { h: H }, venue: number) {
  const ev = (
    await request(app)
      .post("/api/organizer/events")
      .set(o.h)
      .send({ title: "Hành trình", categoryCode: "theatre", description: "d", eventType: "seated" })
      .expect(201)
  ).body.id as number;
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
  ).body.id as number;
  return { ev, showtime };
}

describe("the organizer journey, one step handing off to the next", () => {
  it("walks draft → showtime → chart → publish → apply → sellable", async () => {
    const o = await organizer();
    const venue = await venueOf(o, "J");
    const { layoutId } = await drawChart(o, venue, "Chính", 6);
    const { ev, showtime } = await seatedEvent(o, venue);

    // ── Before publishing: the console can see the chart, and refuses to bind it.
    let rows = await manage(o, ev);
    expect(rows[0].layoutStatus, "drawn but not published").toBe("draft");
    expect(rows[0].assignableLayouts, "nothing is bindable yet").toHaveLength(0);
    expect(rows[0].hasSeatMap).toBe(false);

    const tier = rows[0].tiers[0].id;
    await request(app)
      .post(`/api/organizer/showtimes/${showtime}/apply-chart`)
      .set(o.h)
      .send({ layoutId, mappings: [] })
      .expect(409)
      .expect((r) => expect(r.body.error).toBe("layout_not_published"));

    // ── Publish. Now — and only now — the chart is offered as bindable.
    await request(app).post(`/api/organizer/layouts/${layoutId}/publish`).set(o.h).expect(200);
    rows = await manage(o, ev);
    expect(rows[0].layoutStatus).toBe("ready");
    expect(rows[0].assignableLayouts.map((l) => l.id)).toEqual([layoutId]);

    // ── Applying without pricing the stocked class is refused, and writes nothing.
    await request(app)
      .post(`/api/organizer/showtimes/${showtime}/apply-chart`)
      .set(o.h)
      .send({ layoutId, mappings: [] })
      .expect(400)
      .expect((r) => expect(r.body.error).toBe("category_without_tier"));
    expect((await manage(o, ev))[0].hasSeatMap, "a refusal leaves nothing behind").toBe(false);

    // ── Price it and apply. One call, and the console reads sellable afterwards.
    const stocked = rows[0].categories.filter((c) => c.hasInventory);
    expect(stocked).toHaveLength(1);
    const applied = await request(app)
      .post(`/api/organizer/showtimes/${showtime}/apply-chart`)
      .set(o.h)
      .send({ layoutId, mappings: [{ categoryId: stocked[0].id, tierId: tier }] })
      .expect(201);
    expect(applied.body.seats).toBe(6);

    rows = await manage(o, ev);
    expect(rows[0].hasSeatMap, "the step the organizer is waiting to see go green").toBe(true);
    expect(rows[0].bookableSeats).toBe(6);

    // ── And the chart cannot be deleted out from under a showtime that now sells from it.
    await request(app)
      .delete(`/api/organizer/layouts/${layoutId}`)
      .set(o.h)
      .expect(409)
      .expect((r) => expect(r.body.error).toBe("layout_in_use"));
  });

  it("applies the chart the caller NAMES when the venue owns two", async () => {
    const o = await organizer();
    const venue = await venueOf(o, "Two");
    // A is drawn first, so it is the one every "oldest layout" fallback used to reach for.
    const a = await drawChart(o, venue, "A", 4);
    const b = await drawChart(o, venue, "B", 9);
    await request(app).post(`/api/organizer/layouts/${a.layoutId}/publish`).set(o.h).expect(200);
    await request(app).post(`/api/organizer/layouts/${b.layoutId}/publish`).set(o.h).expect(200);
    const { ev, showtime } = await seatedEvent(o, venue);

    const rows = await manage(o, ev);
    expect(rows[0].assignableLayouts.map((l) => l.id).sort()).toEqual(
      [a.layoutId, b.layoutId].sort(),
    );

    // Choose B. Its class, its tier, its seat count — nothing of A may reach the showtime.
    const bLayout = (
      await request(app).get(`/api/organizer/layouts/${b.layoutId}`).set(o.h).expect(200)
    ).body;
    await request(app)
      .post(`/api/organizer/showtimes/${showtime}/apply-chart`)
      .set(o.h)
      .send({
        layoutId: b.layoutId,
        mappings: [{ categoryId: bLayout.categories[0].id, tierId: rows[0].tiers[0].id }],
      })
      .expect(201);

    const after = await manage(o, ev);
    expect(after[0].bookableSeats, "B's nine seats, not A's four").toBe(9);
    const { rows: bound } = await pool.query<{ layout_id: number }>(
      `SELECT layout_id FROM showtimes WHERE id = $1`,
      [showtime],
    );
    expect(bound[0].layout_id).toBe(b.layoutId);
  });

  it("never offers an archived chart or a template, however old they are", async () => {
    const o = await organizer();
    const venue = await venueOf(o, "Old");
    // Both drawn BEFORE the real chart, so an oldest-first fallback would land on one of them.
    const archived = await drawChart(o, venue, "Cũ", 3);
    await request(app).post(`/api/organizer/layouts/${archived.layoutId}/publish`).set(o.h).expect(200);
    await request(app).post(`/api/organizer/layouts/${archived.layoutId}/archive`).set(o.h).expect(200);

    const template = await drawChart(o, venue, "Mẫu", 3);
    await request(app).post(`/api/organizer/layouts/${template.layoutId}/publish`).set(o.h).expect(200);
    await pool.query(`UPDATE venue_layouts SET is_template = true WHERE id = $1`, [
      template.layoutId,
    ]);

    const real = await drawChart(o, venue, "Thật", 5);
    await request(app).post(`/api/organizer/layouts/${real.layoutId}/publish`).set(o.h).expect(200);

    const { ev, showtime } = await seatedEvent(o, venue);
    const rows = await manage(o, ev);
    expect(rows[0].assignableLayouts.map((l) => l.id), "only the real chart").toEqual([
      real.layoutId,
    ]);

    // Naming one explicitly is refused too — the list is not the only guard.
    await request(app)
      .post(`/api/organizer/showtimes/${showtime}/apply-chart`)
      .set(o.h)
      .send({ layoutId: template.layoutId, mappings: [] })
      .expect(400);
    await request(app)
      .post(`/api/organizer/showtimes/${showtime}/apply-chart`)
      .set(o.h)
      .send({ layoutId: archived.layoutId, mappings: [] })
      .expect(409)
      .expect((r) => expect(r.body.error).toBe("layout_not_published"));
  });

  it("tells an APPROVED event's organizer that pricing sent it back for review", async () => {
    const o = await organizer();
    const venue = await venueOf(o, "Live");
    const { layoutId } = await drawChart(o, venue, "Chart", 4);
    await request(app).post(`/api/organizer/layouts/${layoutId}/publish`).set(o.h).expect(200);
    const { ev, showtime } = await seatedEvent(o, venue);

    // The event is live: an admin approved it and it is on sale.
    await pool.query(
      `UPDATE events SET status = 'on_sale', moderation_status = 'approved' WHERE id = $1`,
      [ev],
    );

    const rows = await manage(o, ev);
    const layout = (
      await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)
    ).body;
    const res = await request(app)
      .post(`/api/organizer/showtimes/${showtime}/apply-chart`)
      .set(o.h)
      .send({
        layoutId,
        mappings: [{ categoryId: layout.categories[0].id, tierId: rows[0].tiers[0].id }],
      })
      .expect(201);

    // Binding a tier's class is a MATERIAL edit. The console used to discard this answer and say
    // "ghế đã sẵn sàng để bán" about an event that had just left sale.
    expect(res.body.returnedToReview, "the organizer has to be told").toBe(true);
    const { rows: ev2 } = await pool.query<{ moderation_status: string }>(
      `SELECT moderation_status FROM events WHERE id = $1`,
      [ev],
    );
    expect(ev2[0].moderation_status).toBe("pending_review");
  });
});
