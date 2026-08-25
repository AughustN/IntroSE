import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../helpers/app.js';
import { bearer, registerUser } from '../helpers/authFixture.js';
import * as holds from '../helpers/holdsSeed.js';

describe('holding a seat (US1)', () => {
  it('holds an available seat for the signed-in caller, with an owner and an expiry (FR-001/002)', async () => {
    const { showtimeId, seatIds, price } = await holds.seedSeatedShowtime();
    const user = await registerUser();

    const res = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, seatIds: [seatIds[0]] })
      .expect(201);

    expect(res.body.status).toBe('active');
    expect(res.body.showtimeId).toBe(showtimeId);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].showtimeSeatId).toBe(seatIds[0]);
    expect(res.body.totalAmount).toBe(price); // VND integer, snapshot at hold time (STD-03)
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const seat = await holds.getSeat(seatIds[0]);
    expect(seat.status).toBe('held');
    expect(seat.hold_owner_id).toBe(user.userId); // no anonymous holds
    expect(seat.hold_expires_at).not.toBeNull();
  });

  it('refuses a guest — every hold has an owner (SC-007)', async () => {
    const { showtimeId, seatIds } = await holds.seedSeatedShowtime();

    await request(app).post('/api/reservations').send({ showtimeId, seatIds: [seatIds[0]] }).expect(401);

    expect((await holds.getSeat(seatIds[0])).status).toBe('available');
  });

  it('refuses a seat held by someone else, a sold seat and a blocked seat (FR-002)', async () => {
    const { showtimeId, seatIds } = await holds.seedSeatedShowtime(3);
    const owner = await registerUser();
    const other = await registerUser();

    await request(app)
      .post('/api/reservations')
      .set(bearer(owner.token))
      .send({ showtimeId, seatIds: [seatIds[0]] })
      .expect(201);
    await holds.setSeatStatus(seatIds[1], 'sold');
    await holds.setSeatStatus(seatIds[2], 'blocked');

    for (const seatId of seatIds) {
      const res = await request(app)
        .post('/api/reservations')
        .set(bearer(other.token))
        .send({ showtimeId, seatIds: [seatId] });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('seat_taken');
    }
  });

  it('treats a held row past its expiry as available, even before the sweep runs (edge case)', async () => {
    const { showtimeId, seatIds } = await holds.seedSeatedShowtime();
    const stale = await registerUser();
    const buyer = await registerUser();

    const held = await request(app)
      .post('/api/reservations')
      .set(bearer(stale.token))
      .send({ showtimeId, seatIds: [seatIds[0]] })
      .expect(201);
    await holds.expireReservation(held.body.id);

    await request(app)
      .post('/api/reservations')
      .set(bearer(buyer.token))
      .send({ showtimeId, seatIds: [seatIds[0]] })
      .expect(201);

    expect((await holds.getSeat(seatIds[0])).hold_owner_id).toBe(buyer.userId);
  });

  it('is idempotent when the caller re-holds a seat they already hold (FR-005)', async () => {
    const { showtimeId, seatIds } = await holds.seedSeatedShowtime();
    const user = await registerUser();

    const first = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, seatIds: [seatIds[0]] })
      .expect(201);

    const again = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, seatIds: [seatIds[0]] })
      .expect(200); // already held by me → success, not an error

    expect(again.body.id).toBe(first.body.id);
    expect(again.body.items).toHaveLength(1); // no duplicate item
  });

  it('joins the same active reservation on a second hold for the same showtime (FR-011)', async () => {
    const { showtimeId, seatIds } = await holds.seedSeatedShowtime();
    const user = await registerUser();

    const first = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, seatIds: [seatIds[0]] })
      .expect(201);
    const second = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, seatIds: [seatIds[1]] })
      .expect(201);

    expect(second.body.id).toBe(first.body.id);
    expect(second.body.items).toHaveLength(2);
    // Adding a seat never buys more time (FR-006).
    expect(second.body.expiresAt).toBe(first.body.expiresAt);
  });

  it('refuses a seat that belongs to another showtime and an empty selection (edge cases)', async () => {
    const a = await holds.seedSeatedShowtime();
    const b = await holds.seedSeatedShowtime();
    const user = await registerUser();

    const foreign = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId: a.showtimeId, seatIds: [b.seatIds[0]] });
    expect(foreign.status).toBe(422);
    expect(foreign.body.error).toBe('invalid_selection');

    const empty = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId: a.showtimeId, seatIds: [] });
    expect(empty.status).toBe(422);
  });

  it('caps one attendee at 8 tickets for a showtime, across requests (FR-016, SC-006)', async () => {
    const { showtimeId, seatIds } = await holds.seedSeatedShowtime(9);
    const user = await registerUser();

    await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, seatIds: seatIds.slice(0, 8) })
      .expect(201);

    // A second "tab" cannot exceed it — the cap counts the one active reservation server-side.
    const ninth = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, seatIds: [seatIds[8]] });
    expect(ninth.status).toBe(422);
    expect(ninth.body.error).toBe('cap_exceeded');

    expect((await holds.getSeat(seatIds[8])).status).toBe('available');
    expect((await holds.getSeat(seatIds[0])).status).toBe('held'); // existing holds untouched
  });

  it('refuses a hold on a showtime that is not on sale (edge case)', async () => {
    const { showtimeId, seatIds } = await holds.seedSeatedShowtime();
    const user = await registerUser();
    await holds.cancelShowtime(showtimeId);

    const res = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, seatIds: [seatIds[0]] });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('showtime_unavailable');
  });

  it('releases a seat for its owner and refuses to release someone else’s (FR-004)', async () => {
    const { showtimeId, seatIds } = await holds.seedSeatedShowtime(2);
    const owner = await registerUser();
    const other = await registerUser();

    const held = await request(app)
      .post('/api/reservations')
      .set(bearer(owner.token))
      .send({ showtimeId, seatIds })
      .expect(201);

    await request(app)
      .patch(`/api/reservations/${held.body.id}`)
      .set(bearer(other.token))
      .send({ removeSeatIds: [seatIds[0]] })
      .expect(403);

    const after = await request(app)
      .patch(`/api/reservations/${held.body.id}`)
      .set(bearer(owner.token))
      .send({ removeSeatIds: [seatIds[0]] })
      .expect(200);

    expect(after.body.items).toHaveLength(1);
    expect((await holds.getSeat(seatIds[0])).status).toBe('available');
    expect((await holds.getSeat(seatIds[1])).status).toBe('held');
  });
});
