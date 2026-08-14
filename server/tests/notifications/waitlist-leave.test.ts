import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { notifyWaitlistForShowtime } from '../../src/modules/notifications/notifications.service.js';
import { app } from '../helpers/app.js';
import { bearer, registerUser } from '../helpers/authFixture.js';
import * as wl from '../helpers/waitlistSeed.js';

describe('leaving a waitlist (US3, UC-17 A4)', () => {
  it('removes the caller’s own place', async () => {
    const { showtimeId, tierId } = await wl.seedSoldOutGaShowtime();
    const [waiter] = await wl.fillWaitlistWithSessions(showtimeId, tierId, 1);

    await request(app)
      .delete(`/api/waitlists/${waiter.entryId}`)
      .set(bearer(waiter.token))
      .expect(204);

    expect(await wl.getEntries(showtimeId)).toHaveLength(0);
  });

  it('refuses somebody else’s place and leaves it standing (FR-006, SEC-04)', async () => {
    const { showtimeId, tierId } = await wl.seedSoldOutGaShowtime();
    const [waiter] = await wl.fillWaitlistWithSessions(showtimeId, tierId, 1);
    const stranger = await registerUser();

    const res = await request(app)
      .delete(`/api/waitlists/${waiter.entryId}`)
      .set(bearer(stranger.token));

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('waitlist_entry_not_found');
    expect(await wl.getEntries(showtimeId)).toHaveLength(1);
  });

  it('answers an unknown place the same way as somebody else’s', async () => {
    const user = await registerUser();
    const res = await request(app).delete('/api/waitlists/987654').set(bearer(user.token));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('waitlist_entry_not_found');
  });

  it('refuses an anonymous caller', async () => {
    const { showtimeId, tierId } = await wl.seedSoldOutGaShowtime();
    const [waiter] = await wl.fillWaitlistWithSessions(showtimeId, tierId, 1);

    await request(app).delete(`/api/waitlists/${waiter.entryId}`).expect(401);

    expect(await wl.getEntries(showtimeId)).toHaveLength(1);
  });
});

describe('the queue closes up behind somebody who leaves (US3)', () => {
  it('leaves the places of everybody else exactly as they were', async () => {
    // Nobody moves up, because there is nowhere to move up to: the queue keeps no order, only a
    // count of open places. What leaving must not do is disturb anybody else's place.
    const { showtimeId, tierId } = await wl.seedSoldOutGaShowtime();
    const [first, second, third] = await wl.fillWaitlistWithSessions(showtimeId, tierId, 3);

    await request(app).delete(`/api/waitlists/${first.entryId}`).set(bearer(first.token)).expect(204);

    const secondAfter = await request(app)
      .get(`/api/waitlists?showtimeId=${showtimeId}`)
      .set(bearer(second.token))
      .expect(200);
    const thirdAfter = await request(app)
      .get(`/api/waitlists?showtimeId=${showtimeId}`)
      .set(bearer(third.token))
      .expect(200);

    expect(secondAfter.body).toHaveLength(1);
    expect(secondAfter.body[0].id).toBe(second.entryId);
    expect(secondAfter.body[0].status).toBe('waiting');
    expect(secondAfter.body[0].position).toBeUndefined();
    expect(thirdAfter.body[0].id).toBe(third.entryId);
    expect(await wl.getEntries(showtimeId)).toHaveLength(2);
  });

  it('frees a place against the cap', async () => {
    const { showtimeId, tierId } = await wl.seedSoldOutGaShowtime();
    const queued = await wl.fillWaitlistWithSessions(showtimeId, tierId, 10);
    const newcomer = await registerUser();

    const refused = await request(app)
      .post('/api/waitlists')
      .set(bearer(newcomer.token))
      .send({ showtimeId, ticketTierId: tierId });
    expect(refused.status).toBe(409);

    await request(app)
      .delete(`/api/waitlists/${queued[0].entryId}`)
      .set(bearer(queued[0].token))
      .expect(204);

    await request(app)
      .post('/api/waitlists')
      .set(bearer(newcomer.token))
      .send({ showtimeId, ticketTierId: tierId })
      .expect(201);
  });

  it('sends nothing to the account that left', async () => {
    const { showtimeId, tierId } = await wl.seedSoldOutGaShowtime(10);
    const [gone, staying] = await wl.fillWaitlistWithSessions(showtimeId, tierId, 2);
    await request(app).delete(`/api/waitlists/${gone.entryId}`).set(bearer(gone.token)).expect(204);

    await wl.releaseGaQuantity(tierId, 1);
    await notifyWaitlistForShowtime(showtimeId);

    expect(await wl.getNotifications(gone.userId)).toHaveLength(0);
    expect(await wl.getNotifications(staying.userId)).toHaveLength(1);
  });
});

describe('reading your own places (US1, FR-005)', () => {
  it('returns only the caller’s open places, narrowed by showtime', async () => {
    const a = await wl.seedSoldOutGaShowtime();
    const b = await wl.seedSoldOutGaShowtime();
    const user = await registerUser();
    for (const fixture of [a, b]) {
      await request(app)
        .post('/api/waitlists')
        .set(bearer(user.token))
        .send({ showtimeId: fixture.showtimeId, ticketTierId: fixture.tierId })
        .expect(201);
    }
    await wl.fillWaitlist(a.showtimeId, a.tierId, 2); // other people's places

    const all = await request(app).get('/api/waitlists').set(bearer(user.token)).expect(200);
    const narrowed = await request(app)
      .get(`/api/waitlists?showtimeId=${a.showtimeId}`)
      .set(bearer(user.token))
      .expect(200);

    expect(all.body).toHaveLength(2);
    expect(narrowed.body).toHaveLength(1);
    expect(narrowed.body[0].showtimeId).toBe(a.showtimeId);
  });

  it('refuses an anonymous caller', async () => {
    await request(app).get('/api/waitlists').expect(401);
  });
});
