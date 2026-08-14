import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { app } from '../helpers/app.js';
import { bearer, makeApprovedOrganizer, registerUser } from '../helpers/authFixture.js';

// Capacity zones (0027) — a standing area sold by COUNT rather than as one seat row per spectator.
//
// The rule this file exists to pin: a zone rides the EXISTING tier-quantity machinery, so the
// oversell guarantee is the one `ticket_tiers` already had (locked `FOR UPDATE`, CHECK on
// sold + reserved <= total). What is new is only the join — zone capacity becomes tier quantity at
// generation — and the two places that must refuse: a capacity below what is already committed, and a
// quantity sold against anything seat-shaped.

async function organizer() {
  const o = await registerUser();
  await makeApprovedOrganizer(o.userId);
  return { ...o, h: bearer(o.token) };
}

/** A venue whose chart is one standing zone of `capacity`, priced, bound to a fresh showtime. */
async function standingShowtime(o: { h: Record<string, string> }, capacity: number) {
  const venue = (
    await request(app).post('/api/organizer/venues').set(o.h)
      .send({ name: `V${Date.now()}${Math.random()}`, city: 'Hà Nội', rawAddress: 'a' }).expect(201)
  ).body.id;
  // Created explicitly: a venue on its own has no chart, and the lazy one other tests rely on is a
  // side effect of adding a section — which a standing-only venue never does.
  const layoutId = (
    await request(app).post(`/api/organizer/venues/${venue}/layouts`).set(o.h)
      .send({ name: 'Sơ đồ đứng' }).expect(201)
  ).body.id as number;

  const layout = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;

  // A fresh chart has no price class yet — one is minted here through the ordinary document path,
  // with the placeholder id the editor uses, alongside the zone that names it.
  const doc = {
    ...layout.document,
    categories: [{ id: -1, name: 'Đứng', color: '#D93025' }],
    blocks: [
      {
        key: 'z-1',
        kind: 'ga-zone',
        title: 'Sân đứng',
        x: 2000, y: 2000, rotation: 0, width: 3000, height: 2000,
        sectionId: null,
        categoryId: -1,
        capacity,
      },
    ],
  };
  const saved = (
    await request(app).put(`/api/organizer/layouts/${layoutId}`).set(o.h)
      .send({ version: layout.version, document: doc }).expect(200)
  ).body;
  const categoryId = saved.categories.find((c: { name: string }) => c.name === 'Đứng').id as number;
  await request(app).post(`/api/organizer/layouts/${layoutId}/publish`).set(o.h).expect(200);

  const ev = (
    await request(app).post('/api/organizer/events').set(o.h)
      .send({ title: 'S', categoryCode: 'theatre', description: 'd', eventType: 'seated' }).expect(201)
  ).body.id;
  const showtime = (
    await request(app).post(`/api/organizer/events/${ev}/showtimes`).set(o.h)
      .send({ venueId: venue, startsAt: new Date(Date.now() + 86_400_000).toISOString(), tiers: [{ label: 'Đứng', price: 200_000 }] })
      .expect(201)
  ).body.id;
  const tierId = (
    await pool.query<{ id: number }>(`SELECT id FROM ticket_tiers WHERE showtime_id = $1 LIMIT 1`, [showtime])
  ).rows[0].id;
  await pool.query(`UPDATE ticket_tiers SET category_id = $2 WHERE id = $1`, [tierId, categoryId]);

  return { venue, layoutId, categoryId, ev, showtime, tierId };
}

describe('a capacity zone', () => {
  it('generates NO seat rows — it becomes the tier’s quantity instead', async () => {
    const o = await organizer();
    const { showtime, layoutId, tierId } = await standingShowtime(o, 5000);

    await request(app).post(`/api/organizer/showtimes/${showtime}/seat-map`).set(o.h)
      .send({ layoutId }).expect(201);

    // The whole point: 5,000 standing places, and not one row per person anywhere.
    const seats = await pool.query(`SELECT count(*)::int AS n FROM seats WHERE layout_id = $1`, [layoutId]);
    const inventory = await pool.query(`SELECT count(*)::int AS n FROM showtime_seats WHERE showtime_id = $1`, [showtime]);
    expect(seats.rows[0].n).toBe(0);
    expect(inventory.rows[0].n).toBe(0);

    const tier = await pool.query<{ total_quantity: number }>(
      `SELECT total_quantity FROM ticket_tiers WHERE id = $1`, [tierId],
    );
    expect(tier.rows[0].total_quantity).toBe(5000);
  });

  it('sums several zones that share one price class', async () => {
    const o = await organizer();
    const { showtime, layoutId, categoryId, tierId } = await standingShowtime(o, 1000);
    const layout = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;

    const twoWings = {
      ...layout.document,
      blocks: [
        { key: 'z-1', kind: 'ga-zone', title: 'Cánh trái', x: 1000, y: 2000, rotation: 0, width: 2000, height: 2000, sectionId: null, categoryId, capacity: 1000 },
        { key: 'z-2', kind: 'ga-zone', title: 'Cánh phải', x: 6000, y: 2000, rotation: 0, width: 2000, height: 2000, sectionId: null, categoryId, capacity: 400 },
      ],
    };
    await request(app).put(`/api/organizer/layouts/${layoutId}`).set(o.h)
      .send({ version: layout.version, document: twoWings }).expect(200);
    await request(app).post(`/api/organizer/layouts/${layoutId}/publish`).set(o.h).expect(200);
    await request(app).post(`/api/organizer/showtimes/${showtime}/seat-map`).set(o.h).send({ layoutId }).expect(201);

    const tier = await pool.query<{ total_quantity: number }>(
      `SELECT total_quantity FROM ticket_tiers WHERE id = $1`, [tierId],
    );
    expect(tier.rows[0].total_quantity).toBe(1400);
  });

  it('REFUSES a capacity below what is already sold or held', async () => {
    const o = await organizer();
    const { showtime, layoutId, categoryId, tierId } = await standingShowtime(o, 500);
    await request(app).post(`/api/organizer/showtimes/${showtime}/seat-map`).set(o.h).send({ layoutId }).expect(201);

    // 300 of the 500 committed, as a purchase would leave them.
    await pool.query(`UPDATE ticket_tiers SET sold_quantity = 200, reserved_quantity = 100 WHERE id = $1`, [tierId]);

    const layout = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;
    const shrunk = {
      ...layout.document,
      blocks: [{ key: 'z-1', kind: 'ga-zone', title: 'Sân đứng', x: 2000, y: 2000, rotation: 0, width: 3000, height: 2000, sectionId: null, categoryId, capacity: 250 }],
    };
    await request(app).put(`/api/organizer/layouts/${layoutId}`).set(o.h)
      .send({ version: layout.version, document: shrunk }).expect(200);
    await request(app).post(`/api/organizer/layouts/${layoutId}/publish`).set(o.h).expect(200);

    // Re-generating with 250 would mean 300 tickets against 250 places.
    const refused = await request(app).post(`/api/organizer/showtimes/${showtime}/seat-map`).set(o.h)
      .send({ layoutId }).expect(409);
    expect(refused.body.error).toBe('zone_capacity_below_sold');

    // And the refusal left the quantity alone rather than half-applying it.
    const tier = await pool.query<{ total_quantity: number }>(
      `SELECT total_quantity FROM ticket_tiers WHERE id = $1`, [tierId],
    );
    expect(tier.rows[0].total_quantity).toBe(500);
  });

  it('lets a buyer hold a quantity against it, and never more than it holds', async () => {
    const o = await organizer();
    const { ev, showtime, layoutId, tierId } = await standingShowtime(o, 3);
    await request(app).post(`/api/organizer/showtimes/${showtime}/seat-map`).set(o.h).send({ layoutId }).expect(201);
    await pool.query(`UPDATE events SET status = 'on_sale', moderation_status = 'approved' WHERE id = $1`, [ev]);

    const buyer = await registerUser();
    const bh = bearer(buyer.token);

    // A quantity against a zone tier is allowed even though the EVENT is seated — the old gate read
    // the event's type and made a standing floor on a seated chart unsellable.
    await request(app).post('/api/reservations').set(bh)
      .send({ showtimeId: showtime, ticketTierId: tierId, quantity: 2 }).expect(201);

    const after = await pool.query<{ reserved_quantity: number }>(
      `SELECT reserved_quantity FROM ticket_tiers WHERE id = $1`, [tierId],
    );
    expect(after.rows[0].reserved_quantity).toBe(2);

    // The third is fine; a fourth is one more than the zone holds.
    const other = await registerUser();
    await request(app).post('/api/reservations').set(bearer(other.token))
      .send({ showtimeId: showtime, ticketTierId: tierId, quantity: 2 }).expect(422);
  });

  it('refuses a quantity sold against a SEAT-backed tier', async () => {
    const o = await organizer();
    const venue = (
      await request(app).post('/api/organizer/venues').set(o.h)
        .send({ name: `Seated${Date.now()}`, city: 'Hà Nội', rawAddress: 'a' }).expect(201)
    ).body.id;
    const section = (
      await request(app).post(`/api/organizer/venues/${venue}/sections`).set(o.h).send({ name: 'Khu A' }).expect(201)
    ).body.id;
    const layoutId = (
      await pool.query<{ id: number }>(`SELECT layout_id AS id FROM sections WHERE id = $1`, [section])
    ).rows[0].id;
    await request(app).post(`/api/organizer/layouts/${layoutId}/generate-seats`).set(o.h)
      .send({ sectionId: section, rowLabel: 'A', count: 4 }).expect(201);

    const ev = (
      await request(app).post('/api/organizer/events').set(o.h)
        .send({ title: 'S', categoryCode: 'theatre', description: 'd', eventType: 'seated' }).expect(201)
    ).body.id;
    const showtime = (
      await request(app).post(`/api/organizer/events/${ev}/showtimes`).set(o.h)
        .send({ venueId: venue, startsAt: new Date(Date.now() + 86_400_000).toISOString(), tiers: [{ label: 'VIP', price: 500_000 }] })
        .expect(201)
    ).body.id;
    const tierId = (
      await pool.query<{ id: number }>(`SELECT id FROM ticket_tiers WHERE showtime_id = $1 LIMIT 1`, [showtime])
    ).rows[0].id;
    const layout = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;
    await pool.query(`UPDATE ticket_tiers SET category_id = $2 WHERE id = $1`, [tierId, layout.categories[0].id]);
    await request(app).post(`/api/organizer/layouts/${layoutId}/publish`).set(o.h).expect(200);
    await request(app).post(`/api/organizer/showtimes/${showtime}/seat-map`).set(o.h).send({ layoutId }).expect(201);
    await pool.query(`UPDATE events SET status = 'on_sale', moderation_status = 'approved' WHERE id = $1`, [ev]);

    const buyer = await registerUser();
    // Four real seats exist. Selling this tier by the ticket would hand out a ticket no seat reserves.
    const refused = await request(app).post('/api/reservations').set(bearer(buyer.token))
      .send({ showtimeId: showtime, ticketTierId: tierId, quantity: 2 }).expect(422);
    expect(refused.body.error).toBe('invalid_selection');
  });

  it('REFUSES to generate when a zone’s price class has no tier', async () => {
    // Found by review. The pre-flight asked `categoriesWithSeats`, which queries the `seats` table —
    // so a class that exists only on a ZONE was invisible to it, sailed through unpriced, and was then
    // silently skipped by the generator's `if (!tier) continue`. The organizer got 201 and a standing
    // floor that sold nothing, which is exactly the arena case zones were added for.
    const o = await organizer();
    const { showtime, layoutId, tierId } = await standingShowtime(o, 500);
    // Unbind the tier so the zone's class is priced by nothing.
    await pool.query(`UPDATE ticket_tiers SET category_id = NULL WHERE id = $1`, [tierId]);

    const refused = await request(app).post(`/api/organizer/showtimes/${showtime}/seat-map`).set(o.h)
      .send({ layoutId }).expect(400);
    expect(refused.body.error).toBe('category_without_tier');

    // And nothing was written: no half-generated showtime left behind.
    const inventory = await pool.query(`SELECT count(*)::int AS n FROM showtime_seats WHERE showtime_id = $1`, [showtime]);
    expect(inventory.rows[0].n).toBe(0);
  });
});
