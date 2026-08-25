import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../helpers/app.js';
import { bearer, registerUser } from '../helpers/authFixture.js';
import * as holds from '../helpers/holdsSeed.js';
import { extendOnce } from '../../src/modules/holds/holds.service.js';
import { HOLD_ABSOLUTE_MS } from '../../src/config.js';

/**
 * The one-time top-up grace (FR-010, schema D2 amendment). Feature 004 calls this when a wallet
 * top-up carries a reservationId; 003 owns the guard. It has to be *bounded* in both directions:
 * generous enough for a genuine buyer stuck on a slow VNPay page, cheap enough that an attacker
 * gains at most one grace on at most the seat cap.
 */
describe('one-time top-up grace (FR-010)', () => {
  async function heldReservation() {
    const { showtimeId, seatIds } = await holds.seedSeatedShowtime();
    const user = await registerUser();
    const res = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, seatIds: [seatIds[0]] })
      .expect(201);
    return { user, reservationId: res.body.id as number, before: res.body.expiresAt as string, seatId: seatIds[0] };
  }

  it('extends the window the first time and marks it spent', async () => {
    const { user, reservationId, before } = await heldReservation();

    const extended = await extendOnce(user.userId, reservationId);

    expect(new Date(extended.expiresAt).getTime()).toBeGreaterThan(new Date(before).getTime());
    expect(extended.extendedOnce).toBe(true);
  });

  it('refuses to extend a second time — the window still ends at its ceiling', async () => {
    const { user, reservationId } = await heldReservation();

    const first = await extendOnce(user.userId, reservationId);
    const second = await extendOnce(user.userId, reservationId);

    expect(second.expiresAt).toBe(first.expiresAt); // no extra time from a second top-up
    expect(second.extendedOnce).toBe(true);
  });

  it('never pushes the window past created_at + the absolute ceiling', async () => {
    const { user, reservationId } = await heldReservation();
    // Simulate a buyer who started the top-up late in the window.
    await holds.backdateReservation(reservationId, HOLD_ABSOLUTE_MS - 30_000);

    const extended = await extendOnce(user.userId, reservationId);

    const row = await holds.getReservationRow(reservationId);
    const ceiling = row.created_at.getTime() + HOLD_ABSOLUTE_MS;
    expect(new Date(extended.expiresAt).getTime()).toBeLessThanOrEqual(ceiling);
  });

  it('mirrors the extended expiry onto the held seats, so both clocks agree', async () => {
    const { user, reservationId, seatId } = await heldReservation();

    const extended = await extendOnce(user.userId, reservationId);

    const seat = await holds.getSeat(seatId);
    expect(seat.hold_expires_at?.toISOString()).toBe(extended.expiresAt);
  });

  it('cannot revive a reservation that already ended', async () => {
    const { user, reservationId } = await heldReservation();
    await holds.expireReservation(reservationId);

    await expect(extendOnce(user.userId, reservationId)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses to extend someone else’s reservation (FR-024)', async () => {
    const { reservationId } = await heldReservation();
    const stranger = await registerUser();

    await expect(extendOnce(stranger.userId, reservationId)).rejects.toMatchObject({ status: 403 });
  });
});
