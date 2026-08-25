import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { app } from '../helpers/app.js';
import { bearer, makeApprovedOrganizer, registerUser } from '../helpers/authFixture.js';

const soon = () => new Date(Date.now() + 86_400_000).toISOString();

async function organizer() {
  const o = await registerUser();
  await makeApprovedOrganizer(o.userId);
  return { ...o, h: bearer(o.token) };
}

/** Seated event with venue + one section of `seatCount` seats + a showtime + tier. */
async function seatedSetup(o: { h: Record<string, string> }, seatCount = 5) {
  const venue = (await request(app).post('/api/organizer/venues').set(o.h).send({ name: 'V', city: 'Hà Nội', rawAddress: 'a' }).expect(201)).body.id;
  const section = (await request(app).post(`/api/organizer/venues/${venue}/sections`).set(o.h).send({ name: 'Khu A' }).expect(201)).body.id;
  await request(app).post(`/api/organizer/venues/${venue}/seats`).set(o.h).send({ sectionId: section, rowLabel: 'A', count: seatCount }).expect(201);
  const ev = (await request(app).post('/api/organizer/events').set(o.h).send({ title: 'Seated Show', categoryCode: 'theatre', description: 'd', eventType: 'seated' }).expect(201)).body.id;
  const showtime = (await request(app).post(`/api/organizer/events/${ev}/showtimes`).set(o.h).send({ venueId: venue, startsAt: soon(), tiers: [{ label: 'VIP', price: 500000 }] }).expect(201)).body.id;
  const tierId = (await pool.query(`SELECT id FROM ticket_tiers WHERE showtime_id = $1 LIMIT 1`, [showtime])).rows[0].id;
  return { venue, section, showtime, tierId, eventId: ev };
}

describe('venues & seat-map generation (US5)', () => {
  it('generates one seat per physical seat, tier by section; regenerate → 409', async () => {
    const o = await organizer();
    const s = await seatedSetup(o, 5);

    const gen = await request(app).post(`/api/organizer/showtimes/${s.showtime}/seat-map`).set(o.h).send({ sectionTiers: [{ sectionId: s.section, ticketTierId: s.tierId }] }).expect(201);
    expect(gen.body.seats).toBe(5);
    const count = await pool.query(`SELECT count(*)::int AS c FROM showtime_seats WHERE showtime_id = $1 AND status = 'available'`, [s.showtime]);
    expect(count.rows[0].c).toBe(5);

    // regenerate over a live map → 409
    await request(app).post(`/api/organizer/showtimes/${s.showtime}/seat-map`).set(o.h).send({ sectionTiers: [{ sectionId: s.section, ticketTierId: s.tierId }] }).expect(409);
  });

  it('refuses a section with seats that has no tier mapping (400)', async () => {
    const o = await organizer();
    const s = await seatedSetup(o, 3);
    // map a non-existent section instead of the real one → the seated section is unmapped
    await request(app)
      .post(`/api/organizer/showtimes/${s.showtime}/seat-map`)
      .set(o.h)
      .send({ sectionTiers: [{ sectionId: 999999, ticketTierId: s.tierId }] })
      .expect(400)
      .expect((r) => expect(r.body.error).toBe('section_without_tier'));
  });

  it('refuses another organizer managing my venue, and deleting a seat in a live map (D-F, FR-024)', async () => {
    const a = await organizer();
    const s = await seatedSetup(a, 2);

    // org B cannot add a section to A's venue
    const b = await organizer();
    await request(app).post(`/api/organizer/venues/${s.venue}/sections`).set(b.h).send({ name: 'Hack' }).expect(403);

    // generate, then a seat in the live map cannot be deleted
    await request(app).post(`/api/organizer/showtimes/${s.showtime}/seat-map`).set(a.h).send({ sectionTiers: [{ sectionId: s.section, ticketTierId: s.tierId }] }).expect(201);
    const seatId = (await pool.query(`SELECT id FROM seats WHERE section_id = $1 LIMIT 1`, [s.section])).rows[0].id;
    await request(app).delete(`/api/organizer/seats/${seatId}`).set(a.h).expect(409);
  });
});
