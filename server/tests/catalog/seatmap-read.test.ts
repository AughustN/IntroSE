import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../helpers/app.js';
import * as seed from '../helpers/catalogSeed.js';

describe('showtimes & read-only seat map (US3)', () => {
  it('returns a seated seat map with row/number/tier/status and integer price (FR-010)', async () => {
    const { showtimeId, seatCount } = await seed.seedSeatedEventWithMap();
    const res = await request(app).get(`/api/showtimes/${showtimeId}/seat-map`).expect(200);
    expect(res.body.eventType).toBe('seated');
    expect(res.body.seats).toHaveLength(seatCount);
    expect(res.body.seats[0]).toMatchObject({ row: 'A', tier: 'VIP', status: 'available' });
    expect(Number.isInteger(res.body.seats[0].price)).toBe(true);
  });

  it('returns GA tier remaining (FR-011)', async () => {
    const { showtimeId } = await seed.seedVisibleGaEvent();
    const res = await request(app).get(`/api/showtimes/${showtimeId}/seat-map`).expect(200);
    expect(res.body.eventType).toBe('general_admission');
    expect(res.body.tiers[0].remaining).toBe(100);
  });

  it('lists upcoming showtimes with availability (FR-007/013)', async () => {
    const { eventId } = await seed.seedVisibleGaEvent();
    const res = await request(app).get(`/api/events/${eventId}/showtimes`).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].availability).toBe('available');
  });

  it('404s the seat map of a hidden (draft) event — no leak (SC-004)', async () => {
    const org = await seed.seedOrganizer(await seed.seedUser());
    const venue = await seed.seedVenue(await seed.seedUser());
    const ev = await seed.seedEvent({ organizerId: org, status: 'draft', moderation: 'pending_review' });
    const st = await seed.seedShowtime(ev.id, venue);
    await request(app).get(`/api/showtimes/${st}/seat-map`).expect(404);
  });
});
