import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../helpers/app.js';
import { bearer, registerUser } from '../helpers/authFixture.js';
import * as holds from '../helpers/holdsSeed.js';
import { HOLD_RATE_LIMIT } from '../../src/config.js';

describe('managing an in-progress selection (US5)', () => {
  async function selection(seatCount = 4) {
    const fixture = await holds.seedSeatedShowtime(seatCount);
    const user = await registerUser();
    const res = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId: fixture.showtimeId, seatIds: fixture.seatIds.slice(0, 2) })
      .expect(201);
    return { ...fixture, user, reservationId: res.body.id as number, expiresAt: res.body.expiresAt as string };
  }

  it('adds a seat to the same reservation without extending the window (FR-013/006)', async () => {
    const s = await selection();

    const patched = await request(app)
      .patch(`/api/reservations/${s.reservationId}`)
      .set(bearer(s.user.token))
      .send({ add: { seatIds: [s.seatIds[2]] } })
      .expect(200);

    expect(patched.body.id).toBe(s.reservationId);
    expect(patched.body.items).toHaveLength(3);
    expect(patched.body.expiresAt).toBe(s.expiresAt); // adding a seat buys no time
  });

  it('removes a seat, releasing it for everyone and keeping the rest (FR-013)', async () => {
    const s = await selection();

    const patched = await request(app)
      .patch(`/api/reservations/${s.reservationId}`)
      .set(bearer(s.user.token))
      .send({ removeSeatIds: [s.seatIds[0]] })
      .expect(200);

    expect(patched.body.items).toHaveLength(1);
    expect((await holds.getSeat(s.seatIds[0])).status).toBe('available');
    expect((await holds.getSeat(s.seatIds[1])).status).toBe('held');
  });

  it('reports the running total and expiry of the live selection (FR-015)', async () => {
    const s = await selection();

    const res = await request(app)
      .get(`/api/reservations/${s.reservationId}`)
      .set(bearer(s.user.token))
      .expect(200);

    expect(res.body.totalAmount).toBe(2 * s.price); // whole VND đồng (FR-026)
    expect(res.body.items).toHaveLength(2);
    expect(res.body.expiresAt).toBe(s.expiresAt);
  });

  it('cancels the reservation, releasing every seat at once (FR-014)', async () => {
    const s = await selection();

    await request(app).delete(`/api/reservations/${s.reservationId}`).set(bearer(s.user.token)).expect(204);

    expect((await holds.getSeat(s.seatIds[0])).status).toBe('available');
    expect((await holds.getSeat(s.seatIds[1])).status).toBe('available');
    expect((await holds.getReservationRow(s.reservationId)).status).toBe('cancelled');
  });

  it('refuses changes once the reservation is no longer active (FR-013)', async () => {
    const s = await selection();
    await request(app).delete(`/api/reservations/${s.reservationId}`).set(bearer(s.user.token)).expect(204);

    await request(app)
      .patch(`/api/reservations/${s.reservationId}`)
      .set(bearer(s.user.token))
      .send({ add: { seatIds: [s.seatIds[2]] } })
      .expect(404);
    await request(app).delete(`/api/reservations/${s.reservationId}`).set(bearer(s.user.token)).expect(404);
  });

  it('refuses to read or change another attendee’s reservation (FR-024)', async () => {
    const s = await selection();
    const stranger = await registerUser();

    await request(app).get(`/api/reservations/${s.reservationId}`).set(bearer(stranger.token)).expect(403);
    await request(app).delete(`/api/reservations/${s.reservationId}`).set(bearer(stranger.token)).expect(403);
  });

  it('exposes the caller’s live selection for a showtime, for resync (FR-022)', async () => {
    const s = await selection();

    const mine = await request(app)
      .get(`/api/reservations/active?showtimeId=${s.showtimeId}`)
      .set(bearer(s.user.token))
      .expect(200);
    expect(mine.body.id).toBe(s.reservationId);

    const stranger = await registerUser();
    const theirs = await request(app)
      .get(`/api/reservations/active?showtimeId=${s.showtimeId}`)
      .set(bearer(stranger.token))
      .expect(200);
    expect(theirs.body).toBeNull(); // someone else's hold is never handed out
  });

  it('rate-limits a burst of holds from one attendee (FR-017)', async () => {
    const fixture = await holds.seedSeatedShowtime(1);
    const user = await registerUser();

    // A burst, not a loop: hold-spam arrives all at once, and a sequential loop would outlast the
    // window on its own round-trips and never trip anything.
    const results = await Promise.all(
      Array.from({ length: HOLD_RATE_LIMIT + 5 }, () =>
        request(app)
          .post('/api/reservations')
          .set(bearer(user.token))
          .send({ showtimeId: fixture.showtimeId, seatIds: fixture.seatIds }),
      ),
    );

    expect(results.filter((r) => r.status === 429)).not.toHaveLength(0);
  });

  it('lets a normal selection pace through untouched (FR-017)', async () => {
    const fixture = await holds.seedSeatedShowtime(4);
    const user = await registerUser();

    // Four deliberate clicks — a real buyer picking seats must never see a throttle.
    for (const seatId of fixture.seatIds) {
      const res = await request(app)
        .post('/api/reservations')
        .set(bearer(user.token))
        .send({ showtimeId: fixture.showtimeId, seatIds: [seatId] });
      expect(res.status).toBe(201);
    }
  });
});
