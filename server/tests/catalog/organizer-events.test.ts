import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../helpers/app.js';
import { bearer, makeApprovedOrganizer, registerUser } from '../helpers/authFixture.js';

const soon = () => new Date(Date.now() + 86_400_000).toISOString();

async function organizer() {
  const o = await registerUser();
  await makeApprovedOrganizer(o.userId);
  return o;
}

describe('organizer events (US4)', () => {
  it('creates a draft, needs showtime+tier to publish, then submits for review (not public, FR-030)', async () => {
    const o = await organizer();
    const h = bearer(o.token);
    const ev = await request(app)
      .post('/api/organizer/events')
      .set(h)
      .send({ title: 'My Gig', categoryCode: 'music', description: 'desc', eventType: 'general_admission' })
      .expect(201);
    expect(ev.body.slug).toBeTruthy();

    // not public as a draft
    let list = await request(app).get('/api/events').expect(200);
    expect(list.body.events.find((e: { title: string }) => e.title === 'My Gig')).toBeUndefined();

    // publish with no showtime → 422
    await request(app).post(`/api/organizer/events/${ev.body.id}/publish`).set(h).expect(422);

    const venue = await request(app).post('/api/organizer/venues').set(h).send({ name: 'V', city: 'Hà Nội', rawAddress: 'addr' }).expect(201);
    await request(app)
      .post(`/api/organizer/events/${ev.body.id}/showtimes`)
      .set(h)
      .send({ venueId: venue.body.id, startsAt: soon(), tiers: [{ label: 'Thường', price: 100000 }] })
      .expect(201);

    await request(app).post(`/api/organizer/events/${ev.body.id}/publish`).set(h).expect(200);

    // published but pending review → still not public
    list = await request(app).get('/api/events').expect(200);
    expect(list.body.events.find((e: { title: string }) => e.title === 'My Gig')).toBeUndefined();
  });

  it('refuses a non-organizer create and a cross-organizer edit (FR-018, SC-007)', async () => {
    const plain = await registerUser();
    await request(app)
      .post('/api/organizer/events')
      .set(bearer(plain.token))
      .send({ title: 'X', categoryCode: 'music', description: 'd', eventType: 'general_admission' })
      .expect(403);

    const a = await organizer();
    const b = await organizer();
    const ev = await request(app).post('/api/organizer/events').set(bearer(a.token)).send({ title: 'A Event', categoryCode: 'music', description: 'd', eventType: 'general_admission' }).expect(201);
    await request(app).patch(`/api/organizer/events/${ev.body.id}`).set(bearer(b.token)).send({ title: 'Hacked' }).expect(403);
  });

  it('keeps the slug on a title edit and rejects a fractional price (SC-010/009)', async () => {
    const o = await organizer();
    const h = bearer(o.token);
    const ev = await request(app).post('/api/organizer/events').set(h).send({ title: 'Original Title', categoryCode: 'music', description: 'd', eventType: 'general_admission' }).expect(201);
    const patched = await request(app).patch(`/api/organizer/events/${ev.body.id}`).set(h).send({ title: 'New Title' }).expect(200);
    expect(patched.body.slug).toBe(ev.body.slug); // slug stable across title edit

    const venue = await request(app).post('/api/organizer/venues').set(h).send({ name: 'V', city: 'Hà Nội', rawAddress: 'a' }).expect(201);
    await request(app)
      .post(`/api/organizer/events/${ev.body.id}/showtimes`)
      .set(h)
      .send({ venueId: venue.body.id, startsAt: soon(), tiers: [{ label: 'T', price: 99.5 }] })
      .expect(400); // fractional VND refused
  });

  /*
   * The list row has to be able to answer "how is it selling" and "when and where" without opening
   * the event. The sales aggregates were always computed and sent; the showtime and venue are new.
   */
  describe('the list row carries what the console renders', () => {
    it('leads with the next showtime and its venue, and reports capacity', async () => {
      const o = await organizer();
      const h = bearer(o.token);
      const ev = await request(app)
        .post('/api/organizer/events')
        .set(h)
        .send({ title: 'Có lịch', categoryCode: 'music', description: 'd', eventType: 'general_admission' })
        .expect(201);
      const venue = await request(app)
        .post('/api/organizer/venues')
        .set(h)
        .send({ name: 'Nhà hát Lớn', city: 'Hà Nội', rawAddress: 'addr' })
        .expect(201);
      const startsAt = soon();
      await request(app)
        .post(`/api/organizer/events/${ev.body.id}/showtimes`)
        .set(h)
        .send({ venueId: venue.body.id, startsAt, tiers: [{ label: 'Thường', price: 100000, totalQuantity: 50 }] })
        .expect(201);

      const list = await request(app).get('/api/organizer/events').set(h).expect(200);
      const row = list.body.find((e: { id: number }) => e.id === ev.body.id);
      expect(new Date(row.nextShowtimeAt).toISOString()).toBe(new Date(startsAt).toISOString());
      expect(row.venueName).toBe('Nhà hát Lớn');
      expect(row.totalCapacity).toBe(50);
      expect(row.soldTickets).toBe(0);
      expect(Number(row.totalRevenueVnd)).toBe(0);
    });

    it('returns nulls for an event with no showtime rather than omitting the fields', async () => {
      // The client renders the date line only when there is one, so it needs a definite "none"
      // rather than an absent key it would have to treat as undefined.
      const o = await organizer();
      const h = bearer(o.token);
      const ev = await request(app)
        .post('/api/organizer/events')
        .set(h)
        .send({ title: 'Chưa xếp lịch', categoryCode: 'music', description: 'd', eventType: 'general_admission' })
        .expect(201);

      const list = await request(app).get('/api/organizer/events').set(h).expect(200);
      const row = list.body.find((e: { id: number }) => e.id === ev.body.id);
      expect(row.nextShowtimeAt).toBeNull();
      expect(row.venueName).toBeNull();
    });

    it('no longer ships the per-event tier breakdown nothing reads', async () => {
      // It cost one query per event on every dashboard load. Pinned so it does not come back by
      // accident along with the N+1 that produced it.
      const o = await organizer();
      const h = bearer(o.token);
      await request(app)
        .post('/api/organizer/events')
        .set(h)
        .send({ title: 'Không có tiers', categoryCode: 'music', description: 'd', eventType: 'general_admission' })
        .expect(201);

      const list = await request(app).get('/api/organizer/events').set(h).expect(200);
      expect(list.body[0]).not.toHaveProperty('ticketTiers');
    });
  });
});
