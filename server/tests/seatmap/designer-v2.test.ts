import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { app } from '../helpers/app.js';
import { bearer, makeApprovedOrganizer, registerUser } from '../helpers/authFixture.js';

// Designer v2: capacity-driven areas, accessible seats, table booking modes, reference chart.

async function organizer() {
  const o = await registerUser();
  await makeApprovedOrganizer(o.userId);
  return { ...o, h: bearer(o.token) };
}

async function layoutWithSection(o: { h: Record<string, string> }) {
  const venue = (await request(app).post('/api/organizer/venues').set(o.h).send({ name: 'V', city: 'Hà Nội', rawAddress: 'a' }).expect(201)).body.id;
  const layoutId = (await request(app).post(`/api/organizer/venues/${venue}/layouts`).set(o.h).send({ name: 'L' }).expect(201)).body.id;
  const section = (await request(app).post(`/api/organizer/venues/${venue}/sections`).set(o.h).send({ name: 'Khu A' }).expect(201)).body.id;
  return { venue, layoutId, section };
}

const square = (size: number) => [
  { x: 1000, y: 1000 },
  { x: 1000 + size, y: 1000 },
  { x: 1000 + size, y: 1000 + size },
  { x: 1000, y: 1000 + size },
];

describe('standing areas sell by capacity (§3)', () => {
  it('records the capacity on the drawn area, and re-shaping regenerates the positions', async () => {
    const o = await organizer();
    const { layoutId, section } = await layoutWithSection(o);
    await request(app).post(`/api/organizer/layouts/${layoutId}/standing-area`).set(o.h)
      .send({ sectionId: section, rowLabel: 'ĐỨNG', count: 20, points: square(3000) }).expect(201);

    const before = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;
    const area = before.elements.find((e: { kind: string }) => e.kind === 'area');
    expect(area.capacity).toBe(20);
    expect(before.seats).toHaveLength(20);

    // A smaller shape holding more people — the polygon and the headcount move together.
    const after = (
      await request(app).patch(`/api/organizer/layouts/${layoutId}/areas/${area.id}`).set(o.h)
        .send({ points: square(2000), capacity: 35 }).expect(200)
    ).body;
    expect(after.created).toBe(35);
    expect(after.layout.seats).toHaveLength(35);
    const reshaped = after.layout.elements.find((e: { kind: string }) => e.kind === 'area');
    expect(reshaped.capacity).toBe(35);
    expect(reshaped.points).toEqual(square(2000));
  });

  it('refuses a shape too small for the headcount, and writes nothing', async () => {
    const o = await organizer();
    const { layoutId, section } = await layoutWithSection(o);
    await request(app).post(`/api/organizer/layouts/${layoutId}/standing-area`).set(o.h)
      .send({ sectionId: section, rowLabel: 'ĐỨNG', count: 10, points: square(3000) }).expect(201);
    const before = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;
    const area = before.elements.find((e: { kind: string }) => e.kind === 'area');

    await request(app).patch(`/api/organizer/layouts/${layoutId}/areas/${area.id}`).set(o.h)
      .send({ points: square(300), capacity: 500 })
      .expect(409)
      .expect((r) => expect(r.body.error).toBe('area_too_small'));

    const after = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;
    expect(after.seats).toHaveLength(10); // untouched
  });

  it('refuses re-shaping WHOLE when one position is already sold', async () => {
    const o = await organizer();
    const { layoutId, section } = await layoutWithSection(o);
    await request(app).post(`/api/organizer/layouts/${layoutId}/standing-area`).set(o.h)
      .send({ sectionId: section, rowLabel: 'ĐỨNG', count: 8, points: square(3000) }).expect(201);
    const before = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;
    const area = before.elements.find((e: { kind: string }) => e.kind === 'area');

    // Put one of those positions into a live map and sell it.
    const ev = (await request(app).post('/api/organizer/events').set(o.h).send({ title: 'S', categoryCode: 'theatre', description: 'd', eventType: 'seated' }).expect(201)).body.id;
    const venueId = before.venueId;
    const showtime = (await request(app).post(`/api/organizer/events/${ev}/showtimes`).set(o.h)
      .send({ venueId, startsAt: new Date(Date.now() + 86_400_000).toISOString(), tiers: [{ label: 'GA', price: 100_000 }] }).expect(201)).body.id;
    const tier = (await pool.query<{ id: number }>(`SELECT id FROM ticket_tiers WHERE showtime_id = $1`, [showtime])).rows[0].id;
    const seat = (await pool.query<{ id: number }>(`SELECT id FROM seats WHERE layout_id = $1 LIMIT 1`, [layoutId])).rows[0].id;
    await pool.query(
      `INSERT INTO showtime_seats (showtime_id, seat_id, ticket_tier_id, status) VALUES ($1, $2, $3, 'sold')`,
      [showtime, seat, tier],
    );

    await request(app).patch(`/api/organizer/layouts/${layoutId}/areas/${area.id}`).set(o.h)
      .send({ points: square(4000), capacity: 8 })
      .expect(409)
      .expect((r) => expect(r.body.error).toBe('seat_sold'));

    // Refused WHOLE: the polygon did not move either.
    const after = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;
    expect(after.elements.find((e: { kind: string }) => e.kind === 'area').points).toEqual(square(3000));
  });
});

describe('accessible seats (§9)', () => {
  it('round-trips the flag and carries it onto the bookable seat', async () => {
    const o = await organizer();
    const { layoutId, section } = await layoutWithSection(o);
    await request(app).post(`/api/organizer/layouts/${layoutId}/generate-seats`).set(o.h)
      .send({ sectionId: section, rowLabel: 'A', count: 4 }).expect(201);
    const current = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;

    const saved = (
      await request(app).put(`/api/organizer/layouts/${layoutId}`).set(o.h).send({
        version: current.version,
        sections: current.sections,
        categories: current.categories,
        seats: current.seats.map((s: object, i: number) => ({ ...s, isAccessible: i === 0 })),
        elements: [],
      }).expect(200)
    ).body;
    expect(saved.seats.filter((s: { isAccessible: boolean }) => s.isAccessible)).toHaveLength(1);
  });
});

describe('table booking mode (§3)', () => {
  it('stores whole_table and round-trips it', async () => {
    const o = await organizer();
    const { layoutId, section } = await layoutWithSection(o);
    await request(app).post(`/api/organizer/layouts/${layoutId}/tables`).set(o.h)
      .send({ sectionId: section, name: 'Bàn 1', shape: 'round', x: 5000, y: 5000, width: 600, height: 600, rotation: 0, seatCount: 6, bookingMode: 'whole_table' })
      .expect(201);

    const layout = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;
    expect(layout.tables[0].bookingMode).toBe('whole_table');
    // Still ordinary seats underneath — the mode is a selection rule, not a new inventory shape.
    expect(layout.seats).toHaveLength(6);
  });

  it('defaults to per_seat when the mode is not given', async () => {
    const o = await organizer();
    const { layoutId, section } = await layoutWithSection(o);
    await request(app).post(`/api/organizer/layouts/${layoutId}/tables`).set(o.h)
      .send({ sectionId: section, name: 'Bàn 1', shape: 'round', x: 5000, y: 5000, width: 600, height: 600, rotation: 0, seatCount: 4 })
      .expect(201);
    const layout = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;
    expect(layout.tables[0].bookingMode).toBe('per_seat');
  });
});

describe('reference chart (§4)', () => {
  it('is a SEPARATE layer from the buyer-facing plan, and never becomes one', async () => {
    const o = await organizer();
    const { layoutId } = await layoutWithSection(o);

    // 1×1 PNG, the same fixture shape the floor-plan tests use.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const ref = (
      await request(app).post(`/api/organizer/layouts/${layoutId}/reference`).set(o.h)
        .attach('file', png, 'plan.png').expect(200)
    ).body;
    expect(ref.url).toBeTruthy();

    const layout = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;
    expect(layout.referenceChart.url).toBe(ref.url);
    // The two layers are independent: uploading a tracing image does not give buyers a background.
    expect(layout.floorPlan.url).toBeNull();

    const aligned = (
      await request(app).patch(`/api/organizer/layouts/${layoutId}/reference`).set(o.h)
        .send({ scale: 1500, offsetX: 200, offsetY: -300, opacity: 40 }).expect(200)
    ).body;
    expect(aligned.scale).toBe(1500);
    expect(aligned.opacity).toBe(40);

    await request(app).delete(`/api/organizer/layouts/${layoutId}/reference`).set(o.h).expect(204);
    const gone = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;
    expect(gone.referenceChart.url).toBeNull();
  });

  it('REFUSES an SVG, exactly as the buyer-facing plan does', async () => {
    const o = await organizer();
    const { layoutId } = await layoutWithSection(o);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await request(app).post(`/api/organizer/layouts/${layoutId}/reference`).set(o.h)
      .attach('file', svg, 'plan.png')
      .expect(400)
      .expect((r) => expect(r.body.error).toBe('invalid_image'));
  });

  it("refuses another organizer's layout (SEC-04)", async () => {
    const owner = await organizer();
    const { layoutId } = await layoutWithSection(owner);
    const intruder = await organizer();
    await request(app).patch(`/api/organizer/layouts/${layoutId}/reference`).set(intruder.h)
      .send({ scale: 1000, offsetX: 0, offsetY: 0, opacity: 50 })
      .expect(403);
  });
});
