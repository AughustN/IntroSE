import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../helpers/app.js';
import { bearer, registerUser } from '../helpers/authFixture.js';
import * as holds from '../helpers/holdsSeed.js';

/**
 * SC-001 / DATA-02 — the guarantee the whole feature exists for. These assert the *refusal*, not
 * the happy path: a clean demo proves nothing about contention.
 */
describe('concurrency — two buyers, one seat (SC-001)', () => {
  it('serializes parallel holds on one seat: exactly one wins, the rest get 409 (DATA-02)', async () => {
    const { showtimeId, seatIds } = await holds.seedSeatedShowtime(1);
    const buyers = await Promise.all([registerUser(), registerUser(), registerUser(), registerUser()]);

    const results = await Promise.all(
      buyers.map((b) =>
        request(app).post('/api/reservations').set(bearer(b.token)).send({ showtimeId, seatIds }),
      ),
    );

    const won = results.filter((r) => r.status === 201);
    const lost = results.filter((r) => r.status !== 201);
    expect(won).toHaveLength(1);
    expect(lost.every((r) => r.status === 409 && r.body.error === 'seat_taken')).toBe(true);

    // And the database agrees: held by exactly one of the contenders, never shared.
    const seat = await holds.getSeat(seatIds[0]);
    expect(seat.status).toBe('held');
    expect(buyers.map((b) => b.userId)).toContain(seat.hold_owner_id);

    // Only the winner ended up with a reservation for this showtime.
    const owners = await Promise.all(
      buyers.map(async (b) => ({
        userId: b.userId,
        active: (
          await request(app).get(`/api/reservations/active?showtimeId=${showtimeId}`).set(bearer(b.token))
        ).body,
      })),
    );
    expect(owners.filter((o) => o.active !== null)).toHaveLength(1);
    expect(owners.find((o) => o.active !== null)?.userId).toBe(seat.hold_owner_id);
  });

  it('never lets two buyers hold two different seats interfere with each other', async () => {
    const { showtimeId, seatIds } = await holds.seedSeatedShowtime(2);
    const [a, b] = await Promise.all([registerUser(), registerUser()]);

    const [ra, rb] = await Promise.all([
      request(app).post('/api/reservations').set(bearer(a.token)).send({ showtimeId, seatIds: [seatIds[0]] }),
      request(app).post('/api/reservations').set(bearer(b.token)).send({ showtimeId, seatIds: [seatIds[1]] }),
    ]);

    expect(ra.status).toBe(201);
    expect(rb.status).toBe(201);
    expect((await holds.getSeat(seatIds[0])).hold_owner_id).toBe(a.userId);
    expect((await holds.getSeat(seatIds[1])).hold_owner_id).toBe(b.userId);
  });

  it('refuses the whole multi-seat request when one of its seats is taken (all-or-nothing)', async () => {
    const { showtimeId, seatIds } = await holds.seedSeatedShowtime(3);
    const owner = await registerUser();
    const other = await registerUser();

    await request(app)
      .post('/api/reservations')
      .set(bearer(owner.token))
      .send({ showtimeId, seatIds: [seatIds[1]] })
      .expect(201);

    const res = await request(app)
      .post('/api/reservations')
      .set(bearer(other.token))
      .send({ showtimeId, seatIds });
    expect(res.status).toBe(409);

    // Nothing partially held — the transaction rolled back.
    expect((await holds.getSeat(seatIds[0])).status).toBe('available');
    expect((await holds.getSeat(seatIds[2])).status).toBe('available');
  });
});
