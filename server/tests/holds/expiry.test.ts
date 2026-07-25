import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../helpers/app.js';
import { bearer, registerUser } from '../helpers/authFixture.js';
import * as holds from '../helpers/holdsSeed.js';
import { sweepExpiredHolds } from '../../src/modules/holds/sweep.js';

describe('holds expire on their own (US2)', () => {
  it('releases every seat of an expired reservation together and marks it expired (FR-006/008)', async () => {
    const { showtimeId, seatIds } = await holds.seedSeatedShowtime(3);
    const user = await registerUser();

    const held = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, seatIds })
      .expect(201);

    await holds.expireReservation(held.body.id);
    expect(await sweepExpiredHolds()).toBe(1);

    for (const seatId of seatIds) {
      const seat = await holds.getSeat(seatId);
      expect(seat.status).toBe('available'); // the whole selection lapses together
      expect(seat.hold_owner_id).toBeNull();
      expect(seat.hold_expires_at).toBeNull();
    }
    expect((await holds.getReservationRow(held.body.id)).status).toBe('expired');
  });

  it('releases without the client — a closed browser keeps nothing (FR-007, SC-002)', async () => {
    const { showtimeId, seatIds } = await holds.seedSeatedShowtime();
    const gone = await registerUser();
    const next = await registerUser();

    const held = await request(app)
      .post('/api/reservations')
      .set(bearer(gone.token))
      .send({ showtimeId, seatIds: [seatIds[0]] })
      .expect(201);

    // No client action of any kind between the hold and the sweep.
    await holds.expireReservation(held.body.id);
    await sweepExpiredHolds();

    await request(app)
      .post('/api/reservations')
      .set(bearer(next.token))
      .send({ showtimeId, seatIds: [seatIds[0]] })
      .expect(201);
    expect((await holds.getSeat(seatIds[0])).hold_owner_id).toBe(next.userId);
  });

  it('leaves a live hold alone — the sweep only takes what has actually lapsed', async () => {
    const { showtimeId, seatIds } = await holds.seedSeatedShowtime();
    const user = await registerUser();

    const held = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, seatIds: [seatIds[0]] })
      .expect(201);

    expect(await sweepExpiredHolds()).toBe(0);
    expect((await holds.getSeat(seatIds[0])).status).toBe('held');
    expect((await holds.getReservationRow(held.body.id)).status).toBe('active');
  });

  it('tells the returning holder their reservation is over — nothing is silently still theirs', async () => {
    const { showtimeId, seatIds } = await holds.seedSeatedShowtime(2);
    const user = await registerUser();

    const held = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, seatIds: [seatIds[0]] })
      .expect(201);
    await holds.expireReservation(held.body.id);
    await sweepExpiredHolds();

    await request(app)
      .patch(`/api/reservations/${held.body.id}`)
      .set(bearer(user.token))
      .send({ removeSeatIds: [seatIds[0]] })
      .expect(404);

    // And a fresh selection opens a new reservation rather than resurrecting the old one.
    const fresh = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, seatIds: [seatIds[1]] })
      .expect(201);
    expect(fresh.body.id).not.toBe(held.body.id);
  });

  it('has no gateway-driven release path — a seat is freed only by expiry or its owner (FR-009)', async () => {
    const { showtimeId, seatIds } = await holds.seedSeatedShowtime();
    const user = await registerUser();

    const held = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, seatIds: [seatIds[0]] })
      .expect(201);

    // The seat lifecycle has no payment-pending state to wait in (DATA-03): status is `held`, and
    // the only stored deadline is the reservation's own TTL.
    expect((await holds.getSeat(seatIds[0])).status).toBe('held');
    const row = await holds.getReservationRow(held.body.id);
    expect(row.status).toBe('active');
    expect(row.expires_at.getTime()).toBeGreaterThan(Date.now());
  });
});
