import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { app } from '../helpers/app.js';
import { bearer, registerUser } from '../helpers/authFixture.js';
import * as wl from '../helpers/waitlistSeed.js';

const join = (token: string, body: Record<string, unknown>) =>
  request(app).post('/api/waitlists').set(bearer(token)).send(body);

describe('joining a waitlist — scope (US4, FR-002)', () => {
  it('queues for a sold-out tier while a sibling tier still sells', async () => {
    // The case the old showtime-wide availability test could not express: it refused this join
    // because *some other* tier had stock, which is exactly UC-09 A2's counter-example.
    const { showtimeId, soldOutTierId } = await wl.seedMixedGaShowtime();
    const user = await registerUser();

    const res = await join(user.token, { showtimeId, ticketTierId: soldOutTierId }).expect(201);

    expect(res.body.existing).toBe(false);
    expect(res.body.entry.ticketTierId).toBe(soldOutTierId);
    expect(res.body.entry.status).toBe('waiting');
    expect(res.body.entry.position).toBe(1);
  });

  it('refuses a tier that still sells and says to buy instead (UC-17 A3)', async () => {
    const { showtimeId, sellingTierId } = await wl.seedMixedGaShowtime();
    const user = await registerUser();

    const res = await join(user.token, { showtimeId, ticketTierId: sellingTierId });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('tickets_available');
    expect(await wl.getEntries(showtimeId)).toHaveLength(0);
  });

  it('refuses an any-tier place while any tier of the showtime still sells', async () => {
    const { showtimeId } = await wl.seedMixedGaShowtime();
    const user = await registerUser();

    const res = await join(user.token, { showtimeId });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('tickets_available');
  });

  it('accepts an any-tier place once every tier is exhausted', async () => {
    const { showtimeId } = await wl.seedSoldOutGaShowtime();
    const user = await registerUser();

    const res = await join(user.token, { showtimeId }).expect(201);

    expect(res.body.entry.ticketTierId).toBeNull();
    expect(res.body.entry.position).toBe(1);
  });

  it('reads a seated showtime with no seat map as sold out, whatever its tiers claim', async () => {
    // The catalog calls this sold out — a seated showtime sells seat rows, and it has none. The
    // join gate used to read the tiers' untouched capacity as stock and refuse, so the event page
    // offered a waitlist button that answered "vé vẫn còn" the moment it was pressed.
    const { showtimeId, tierId } = await wl.seedSeatedWithoutSeatMap();
    const user = await registerUser();

    await join(user.token, { showtimeId }).expect(201);

    const perTier = await registerUser();
    await join(perTier.token, { showtimeId, ticketTierId: tierId }).expect(201);
  });

  it('reads a seated showtime with no free seat as sold out', async () => {
    // The uncapped-tier branch of the availability judgement: with `total_quantity IS NULL` the
    // only truth is the seat rows.
    const { showtimeId, seatIds } = await wl.seedSoldOutSeated(2);
    const user = await registerUser();

    await join(user.token, { showtimeId }).expect(201);

    await wl.releaseSeat(seatIds[0]);
    const second = await registerUser();
    const res = await join(second.token, { showtimeId });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('tickets_available');
  });
});

describe('joining a waitlist — the cap of ten (US4, FR-003)', () => {
  it('accepts ten places and refuses the eleventh', async () => {
    const { showtimeId, soldOutTierId } = await wl.seedMixedGaShowtime();
    await wl.fillWaitlist(showtimeId, soldOutTierId, 10);
    const eleventh = await registerUser();

    const res = await join(eleventh.token, { showtimeId, ticketTierId: soldOutTierId });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('waitlist_full');
    expect(res.body.message).toContain('10');
    expect(await wl.getEntries(showtimeId)).toHaveLength(10);
  });

  it('counts a notified place against the cap but not an expired or converted one', async () => {
    const { showtimeId, soldOutTierId } = await wl.seedMixedGaShowtime();
    const filled = await wl.fillWaitlist(showtimeId, soldOutTierId, 10);
    // Being told does not vacate a place — the waiter may still lose the race (UC-17 A5).
    await pool.query(`UPDATE waitlists SET status = 'notified', notified_at = now() WHERE id = $1`, [
      filled[0].entryId,
    ]);

    const blocked = await registerUser();
    expect((await join(blocked.token, { showtimeId, ticketTierId: soldOutTierId })).status).toBe(409);

    // Served and unservable places are gone from the queue, so they free room.
    await pool.query(`UPDATE waitlists SET status = 'converted' WHERE id = $1`, [filled[1].entryId]);
    const admitted = await registerUser();
    await join(admitted.token, { showtimeId, ticketTierId: soldOutTierId }).expect(201);
  });

  it('admits exactly one of two joins racing for the last place (SC-003)', async () => {
    const { showtimeId, soldOutTierId } = await wl.seedMixedGaShowtime();
    await wl.fillWaitlist(showtimeId, soldOutTierId, 9);
    const [a, b] = await Promise.all([registerUser(), registerUser()]);

    const results = await Promise.all([
      join(a.token, { showtimeId, ticketTierId: soldOutTierId }),
      join(b.token, { showtimeId, ticketTierId: soldOutTierId }),
    ]);

    const created = results.filter((r) => r.status === 201);
    const refused = results.filter((r) => r.status === 409);
    expect(created).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0].body.error).toBe('waitlist_full');
    expect(await wl.getEntries(showtimeId)).toHaveLength(10);
  });
});

describe('joining a waitlist — duplicates and preconditions (US4)', () => {
  it('returns the existing place instead of creating a second (UC-17 A1)', async () => {
    const { showtimeId, soldOutTierId } = await wl.seedMixedGaShowtime();
    const user = await registerUser();

    const first = await join(user.token, { showtimeId, ticketTierId: soldOutTierId }).expect(201);
    const second = await join(user.token, { showtimeId, ticketTierId: soldOutTierId }).expect(200);

    expect(second.body.existing).toBe(true);
    expect(second.body.entry.id).toBe(first.body.entry.id);
    expect(await wl.getEntries(showtimeId)).toHaveLength(1);
  });

  it('refuses an unknown, begun or cancelled showtime', async () => {
    const user = await registerUser();
    expect((await join(user.token, { showtimeId: 987654 })).status).toBe(404);

    const begun = await wl.seedSoldOutGaShowtime();
    await wl.beginShowtime(begun.showtimeId);
    const res = await join(user.token, { showtimeId: begun.showtimeId });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('showtime_not_found');

    const cancelled = await wl.seedSoldOutGaShowtime();
    await pool.query(`UPDATE showtimes SET status = 'cancelled' WHERE id = $1`, [
      cancelled.showtimeId,
    ]);
    expect((await join(user.token, { showtimeId: cancelled.showtimeId })).status).toBe(404);
  });

  it('refuses a tier belonging to another showtime', async () => {
    const a = await wl.seedSoldOutGaShowtime();
    const b = await wl.seedSoldOutGaShowtime();
    const user = await registerUser();

    const res = await join(user.token, { showtimeId: a.showtimeId, ticketTierId: b.tierId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_failed');
    expect(await wl.getEntries(a.showtimeId)).toHaveLength(0);
  });

  it('refuses an anonymous caller and writes nothing (SEC-04)', async () => {
    const { showtimeId, tierId } = await wl.seedSoldOutGaShowtime();

    const res = await request(app).post('/api/waitlists').send({ showtimeId, ticketTierId: tierId });

    expect(res.status).toBe(401);
    expect(await wl.getEntries(showtimeId)).toHaveLength(0);
  });
});

describe('position (US1, FR-005)', () => {
  it('counts from one, in the order people joined', async () => {
    const { showtimeId, soldOutTierId } = await wl.seedMixedGaShowtime();
    await wl.fillWaitlist(showtimeId, soldOutTierId, 2);
    const third = await registerUser();

    const res = await join(third.token, { showtimeId, ticketTierId: soldOutTierId }).expect(201);

    expect(res.body.entry.position).toBe(3);
  });

  it('reports the real position on a repeat request, not one', async () => {
    const { showtimeId, soldOutTierId } = await wl.seedMixedGaShowtime();
    await wl.fillWaitlist(showtimeId, soldOutTierId, 4);
    const user = await registerUser();
    await join(user.token, { showtimeId, ticketTierId: soldOutTierId }).expect(201);

    const again = await join(user.token, { showtimeId, ticketTierId: soldOutTierId }).expect(200);

    expect(again.body.entry.position).toBe(5);
  });

  it('is counted per queue, so a second tier starts again at one', async () => {
    // Two sold-out tiers on one showtime: the any-tier queue and each tier's queue are separate
    // lines, and a place in one says nothing about a place in another.
    const { showtimeId, soldOutTierId } = await wl.seedMixedGaShowtime();
    const otherTier = (
      await pool.query<{ id: number }>(
        `INSERT INTO ticket_tiers (showtime_id, label, price_amount, total_quantity, sold_quantity)
         VALUES ($1, 'Hạng C', 150000, 1, 1) RETURNING id`,
        [showtimeId],
      )
    ).rows[0].id;
    await wl.fillWaitlist(showtimeId, soldOutTierId, 3);
    const user = await registerUser();

    const res = await join(user.token, { showtimeId, ticketTierId: otherTier }).expect(201);

    expect(res.body.entry.position).toBe(1);
  });
});
