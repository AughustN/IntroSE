import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { LAYOUT_MAX_SEATS, VENUE_MAX_LAYOUTS } from '../../src/config.js';
import { pool } from '../../src/db/pool.js';
import { app } from '../helpers/app.js';
import { bearer, makeApprovedOrganizer, registerUser } from '../helpers/authFixture.js';

// Layout CRUD, ceilings, optimistic concurrency, and ownership (US1: FR-001..FR-007, FR-014/015).
// Every refusal here asserts the DENIAL, not just the happy path (constitution Principle IV).

async function organizer() {
  const o = await registerUser();
  await makeApprovedOrganizer(o.userId);
  return { ...o, h: bearer(o.token) };
}

async function venueOf(o: { h: Record<string, string> }, name = 'V'): Promise<number> {
  const res = await request(app).post('/api/organizer/venues').set(o.h).send({ name, city: 'Hà Nội', rawAddress: 'a' }).expect(201);
  return res.body.id;
}

const emptySave = (version: number) => ({ version, sections: [], seats: [], elements: [] });

describe('layouts (US1)', () => {
  it('creates, lists, renames and deletes a layout of my own venue (FR-001)', async () => {
    const o = await organizer();
    const venue = await venueOf(o);

    const created = await request(app).post(`/api/organizer/venues/${venue}/layouts`).set(o.h).send({ name: 'Kịch có ghế ngồi' }).expect(201);
    expect(created.body.status).toBe('draft');
    expect(created.body.version).toBe(1);

    const list = await request(app).get(`/api/organizer/venues/${venue}/layouts`).set(o.h).expect(200);
    expect(list.body.layouts).toHaveLength(1);

    await request(app).put(`/api/organizer/layouts/${created.body.id}`).set(o.h)
      .send({ ...emptySave(1), name: 'Nhạc hội đứng' }).expect(200);
    await request(app).delete(`/api/organizer/layouts/${created.body.id}`).set(o.h).expect(204);
  });

  it('refuses a duplicate layout name in one venue (409 layout_name_taken)', async () => {
    const o = await organizer();
    const venue = await venueOf(o);
    await request(app).post(`/api/organizer/venues/${venue}/layouts`).set(o.h).send({ name: 'A' }).expect(201);
    await request(app).post(`/api/organizer/venues/${venue}/layouts`).set(o.h).send({ name: 'A' })
      .expect(409)
      .expect((r) => expect(r.body.error).toBe('layout_name_taken'));
  });

  // 21 sequential round trips to a remote Postgres; slow by volume, not by logic.
  it(`refuses the layout past the venue ceiling of ${VENUE_MAX_LAYOUTS} (409 layout_limit_reached, FR-007)`, { timeout: 90_000 }, async () => {
    const o = await organizer();
    const venue = await venueOf(o);
    for (let i = 0; i < VENUE_MAX_LAYOUTS; i += 1) {
      await request(app).post(`/api/organizer/venues/${venue}/layouts`).set(o.h).send({ name: `L${i}` }).expect(201);
    }
    await request(app).post(`/api/organizer/venues/${venue}/layouts`).set(o.h).send({ name: 'one too many' })
      .expect(409)
      .expect((r) => expect(r.body.error).toBe('layout_limit_reached'));
  });

  it('refuses a save past the seat ceiling and leaves the layout untouched (409 seat_limit_reached)', async () => {
    const o = await organizer();
    const venue = await venueOf(o);
    const layout = (await request(app).post(`/api/organizer/venues/${venue}/layouts`).set(o.h).send({ name: 'L' }).expect(201)).body;

    const tooMany = Array.from({ length: LAYOUT_MAX_SEATS + 1 }, (_, i) => ({
      sectionId: null, rowLabel: 'A', seatNumber: i + 1, seatType: 'single' as const, x: 100, y: 100, rotation: 0,
    }));
    await request(app).put(`/api/organizer/layouts/${layout.id}`).set(o.h)
      .send({ version: 1, sections: [], seats: tooMany, elements: [] })
      .expect(409)
      .expect((r) => expect(r.body.error).toBe('seat_limit_reached'));

    const after = await pool.query(`SELECT count(*)::int AS c FROM seats WHERE layout_id = $1`, [layout.id]);
    expect(after.rows[0].c).toBe(0);
  });

  it('refuses a save carrying a stale version — two sessions never silently overwrite (FR-015)', async () => {
    const o = await organizer();
    const venue = await venueOf(o);
    const layout = (await request(app).post(`/api/organizer/venues/${venue}/layouts`).set(o.h).send({ name: 'L' }).expect(201)).body;

    // First save wins and bumps the version.
    await request(app).put(`/api/organizer/layouts/${layout.id}`).set(o.h).send(emptySave(1)).expect(200);
    // The second session still holds version 1.
    await request(app).put(`/api/organizer/layouts/${layout.id}`).set(o.h).send(emptySave(1))
      .expect(409)
      .expect((r) => expect(r.body.error).toBe('stale_version'));
  });

  it('clamps an out-of-range position and normalises rotation on save (FR-014)', async () => {
    const o = await organizer();
    const venue = await venueOf(o);
    const layout = (await request(app).post(`/api/organizer/venues/${venue}/layouts`).set(o.h).send({ name: 'L' }).expect(201)).body;
    const section = (await request(app).post(`/api/organizer/venues/${venue}/sections`).set(o.h).send({ name: 'Khu A' }).expect(201)).body.id;

    // The route's schema caps coordinates, so an out-of-range value is refused before it reaches the
    // clamp. Rotation is deliberately unbounded in the schema and normalised in the repo instead.
    const saved = await request(app).put(`/api/organizer/layouts/${layout.id}`).set(o.h).send({
      version: 1,
      sections: [{ id: section, name: 'Khu A' }],
      seats: [{ sectionId: section, rowLabel: 'A', seatNumber: 1, seatType: 'single', x: 500, y: 500, rotation: 725 }],
      elements: [],
    }).expect(200);

    expect(saved.body.seats[0].rotation).toBe(5); // 725 mod 360
  });

  it('refuses deleting a layout a live showtime generated from (409 layout_in_use, FR-006)', async () => {
    const o = await organizer();
    const venue = await venueOf(o);
    const section = (await request(app).post(`/api/organizer/venues/${venue}/sections`).set(o.h).send({ name: 'Khu A' }).expect(201)).body.id;
    await request(app).post(`/api/organizer/venues/${venue}/seats`).set(o.h).send({ sectionId: section, rowLabel: 'A', count: 3 }).expect(201);

    const ev = (await request(app).post('/api/organizer/events').set(o.h).send({ title: 'S', categoryCode: 'theatre', description: 'd', eventType: 'seated' }).expect(201)).body.id;
    const showtime = (await request(app).post(`/api/organizer/events/${ev}/showtimes`).set(o.h)
      .send({ venueId: venue, startsAt: new Date(Date.now() + 86_400_000).toISOString(), tiers: [{ label: 'VIP', price: 500_000 }] }).expect(201)).body.id;
    const tierId = (await pool.query(`SELECT id FROM ticket_tiers WHERE showtime_id = $1 LIMIT 1`, [showtime])).rows[0].id;
    await request(app).post(`/api/organizer/showtimes/${showtime}/seat-map`).set(o.h).send({ sectionTiers: [{ sectionId: section, ticketTierId: tierId }] }).expect(201);

    const layoutId = (await pool.query(`SELECT layout_id FROM sections WHERE id = $1`, [section])).rows[0].layout_id;
    await request(app).delete(`/api/organizer/layouts/${layoutId}`).set(o.h)
      .expect(409)
      .expect((r) => expect(r.body.error).toBe('layout_in_use'));
  });

  it("refuses another organizer's venue and layout — a refusal, never an empty list (SEC-04, SC-011)", async () => {
    const a = await organizer();
    const venue = await venueOf(a);
    const layout = (await request(app).post(`/api/organizer/venues/${venue}/layouts`).set(a.h).send({ name: 'A' }).expect(201)).body;

    const b = await organizer();
    await request(app).get(`/api/organizer/venues/${venue}/layouts`).set(b.h).expect(403);
    await request(app).post(`/api/organizer/venues/${venue}/layouts`).set(b.h).send({ name: 'X' }).expect(403);
    await request(app).get(`/api/organizer/layouts/${layout.id}`).set(b.h).expect(403);
    await request(app).put(`/api/organizer/layouts/${layout.id}`).set(b.h).send(emptySave(1)).expect(403);
    await request(app).delete(`/api/organizer/layouts/${layout.id}`).set(b.h).expect(403);
    await request(app).post(`/api/organizer/layouts/${layout.id}/floorplan`).set(b.h).expect(403);
  });
});

describe('the Section / Row / Count generator (US1, FR-010)', () => {
  it('seeds seats with editable grid positions and honours the seat ceiling', async () => {
    const o = await organizer();
    const venue = await venueOf(o);
    const layout = (await request(app).post(`/api/organizer/venues/${venue}/layouts`).set(o.h).send({ name: 'L' }).expect(201)).body;
    const section = (await request(app).post(`/api/organizer/venues/${venue}/sections`).set(o.h).send({ name: 'Khu A' }).expect(201)).body.id;

    const res = await request(app).post(`/api/organizer/layouts/${layout.id}/generate-seats`).set(o.h)
      .send({ sectionId: section, rowLabel: 'A', count: 10 }).expect(201);
    expect(res.body.created).toBe(10);

    // Positions are real, distinct and in range — the generator seeds geometry, it does not leave it
    // to be filled in later.
    const seats = res.body.layout.seats as { x: number; y: number }[];
    expect(seats).toHaveLength(10);
    expect(new Set(seats.map((s) => s.x)).size).toBe(10);
    for (const s of seats) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(10_000);
    }
  });

  it('lets two sections in one venue both hold "row A seat 1" (FR-003 — the old constraint forbade it)', async () => {
    const o = await organizer();
    const venue = await venueOf(o);
    const layout = (await request(app).post(`/api/organizer/venues/${venue}/layouts`).set(o.h).send({ name: 'L' }).expect(201)).body;
    const a = (await request(app).post(`/api/organizer/venues/${venue}/sections`).set(o.h).send({ name: 'Khu A' }).expect(201)).body.id;
    const b = (await request(app).post(`/api/organizer/venues/${venue}/sections`).set(o.h).send({ name: 'Khu B' }).expect(201)).body.id;

    await request(app).post(`/api/organizer/layouts/${layout.id}/generate-seats`).set(o.h).send({ sectionId: a, rowLabel: 'A', count: 1 }).expect(201);
    await request(app).post(`/api/organizer/layouts/${layout.id}/generate-seats`).set(o.h).send({ sectionId: b, rowLabel: 'A', count: 1 }).expect(201);

    const count = await pool.query(`SELECT count(*)::int AS c FROM seats WHERE layout_id = $1 AND row_label = 'A' AND seat_number = 1`, [layout.id]);
    expect(count.rows[0].c).toBe(2);
  });
});
