import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { sweepExpiredWaitlists } from '../../src/modules/notifications/notifications.service.js';
import { checkout } from '../../src/modules/payments/wallet.service.js';
import { app } from '../helpers/app.js';
import { bearer, registerUser } from '../helpers/authFixture.js';
import * as wl from '../helpers/waitlistSeed.js';

/** Put money in an account's wallet so a checkout can complete. */
async function fundWallet(userId: number, amount: number): Promise<void> {
  await pool.query(
    `INSERT INTO wallets (user_id, balance_amount) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET balance_amount = EXCLUDED.balance_amount`,
    [userId, amount],
  );
}

describe('waitlist places close when they can no longer be served (US4, FR-010)', () => {
  it('expires the places of a showtime that has begun', async () => {
    const { showtimeId, tierId } = await wl.seedSoldOutGaShowtime();
    await wl.fillWaitlist(showtimeId, tierId, 3);
    await wl.beginShowtime(showtimeId);

    const closed = await sweepExpiredWaitlists();

    expect(closed).toBe(3);
    const rows = await wl.getEntries(showtimeId);
    expect(rows.every((row) => row.status === 'expired')).toBe(true);
  });

  it('leaves the places of an upcoming showtime alone', async () => {
    const { showtimeId, tierId } = await wl.seedSoldOutGaShowtime();
    await wl.fillWaitlist(showtimeId, tierId, 2);

    await sweepExpiredWaitlists();

    const rows = await wl.getEntries(showtimeId);
    expect(rows.every((row) => row.status === 'waiting')).toBe(true);
  });

  it('closes the places of a showtime inside the 24-hour cutoff', async () => {
    // Past the cutoff no ticket can be cancelled, so the queue's main source of stock is gone and
    // waiting on in silence would be waiting on nothing.
    const { showtimeId, tierId } = await wl.seedSoldOutGaShowtime();
    await wl.fillWaitlist(showtimeId, tierId, 2);
    await wl.enterCutoff(showtimeId);

    expect(await sweepExpiredWaitlists()).toBe(2);
    expect((await wl.getEntries(showtimeId)).every((row) => row.status === 'expired')).toBe(true);
  });

  it('closes the places of a cancelled showtime, however far off it is', async () => {
    const { showtimeId, tierId } = await wl.seedSoldOutGaShowtime();
    await wl.fillWaitlist(showtimeId, tierId, 2);
    await wl.cancelShowtime(showtimeId);

    expect(await sweepExpiredWaitlists()).toBe(2);
    expect((await wl.getEntries(showtimeId)).every((row) => row.status === 'expired')).toBe(true);
  });

  it('tells each holder why their place closed, and says it once', async () => {
    const { showtimeId, tierId, eventId } = await wl.seedSoldOutGaShowtime();
    const [waiter] = await wl.fillWaitlist(showtimeId, tierId, 1);
    await wl.enterCutoff(showtimeId);

    await sweepExpiredWaitlists();
    // A second sweep finds nothing open; even if it did, the message may not be sent twice.
    await sweepExpiredWaitlists();

    const messages = (await wl.getNotifications(waiter.userId)).filter(
      (message) => message.type === 'waitlist_closed',
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].event_id).toBe(eventId);
    const { rows } = await pool.query<{ payload: Record<string, string>; body: string }>(
      `SELECT payload, body FROM notifications WHERE user_id = $1 AND type = 'waitlist_closed'`,
      [waiter.userId],
    );
    expect(rows).toHaveLength(2); // one per channel: in-app and email
    expect(rows.every((row) => row.payload.reason === 'cutoff')).toBe(true);
    expect(rows.every((row) => row.payload.eventUrl?.includes('/events/'))).toBe(true);
  });

  it('gives the cancellation as the reason when that is what closed the place', async () => {
    const { showtimeId, tierId } = await wl.seedSoldOutGaShowtime();
    const [waiter] = await wl.fillWaitlist(showtimeId, tierId, 1);
    await wl.cancelShowtime(showtimeId);

    await sweepExpiredWaitlists();

    const { rows } = await pool.query<{ payload: Record<string, string> }>(
      `SELECT payload FROM notifications WHERE user_id = $1 AND type = 'waitlist_closed'`,
      [waiter.userId],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.payload.reason === 'cancelled')).toBe(true);
  });

  it('closes a queue when moderation removes its event, even before showtime cancellation', async () => {
    const { eventId, showtimeId, tierId } = await wl.seedSoldOutGaShowtime();
    const [waiter] = await wl.fillWaitlist(showtimeId, tierId, 1);
    await pool.query(`UPDATE events SET moderation_status = 'removed' WHERE id = $1`, [eventId]);

    expect(await sweepExpiredWaitlists()).toBe(1);
    expect((await wl.getEntries(showtimeId))[0].status).toBe('expired');

    await sweepExpiredWaitlists();
    const { rows } = await pool.query<{ payload: Record<string, string> }>(
      `SELECT payload FROM notifications WHERE user_id = $1 AND type = 'waitlist_closed'`,
      [waiter.userId],
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.payload.reason === 'event_removed')).toBe(true);
  });

  it('takes an expired place out of the caller’s list and out of the cap', async () => {
    const { showtimeId, tierId } = await wl.seedSoldOutGaShowtime();
    const queued = await wl.fillWaitlistWithSessions(showtimeId, tierId, 1);
    await wl.beginShowtime(showtimeId);
    await sweepExpiredWaitlists();

    const mine = await request(app)
      .get('/api/waitlists')
      .set(bearer(queued[0].token))
      .expect(200);

    expect(mine.body).toHaveLength(0);
  });
});

describe('a purchase closes the buyer’s place as served (US4, FR-010)', () => {
  it('converts the place for the tier bought, and the any-tier place with it', async () => {
    // A tier with room to buy, whose *other* tier is exhausted — so the buyer can legitimately
    // hold a place in the sold-out queue and still complete a purchase on this showtime.
    const { showtimeId, soldOutTierId, sellingTierId } = await wl.seedMixedGaShowtime();
    const buyer = await registerUser();
    await fundWallet(buyer.userId, 5_000_000);

    await pool.query(
      `INSERT INTO waitlists (user_id, showtime_id, ticket_tier_id) VALUES ($1, $2, $3), ($1, $2, NULL)`,
      [buyer.userId, showtimeId, sellingTierId],
    );
    const otherWaiter = await wl.fillWaitlist(showtimeId, soldOutTierId, 1);

    const reservation = await request(app)
      .post('/api/reservations')
      .set(bearer(buyer.token))
      .send({ showtimeId, ticketTierId: sellingTierId, quantity: 1 })
      .expect(201);
    await checkout(buyer.userId, reservation.body.id);

    const rows = await wl.getEntries(showtimeId);
    const mine = rows.filter((row) => row.user_id === buyer.userId);
    expect(mine).toHaveLength(2);
    expect(mine.every((row) => row.status === 'converted')).toBe(true);
    // Somebody else's place is untouched by a purchase that was never theirs.
    const theirs = rows.find((row) => row.id === otherWaiter[0].entryId);
    expect(theirs?.status).toBe('waiting');
  });

  it('leaves a place for a different tier of the same showtime open', async () => {
    const { showtimeId, soldOutTierId, sellingTierId } = await wl.seedMixedGaShowtime();
    const buyer = await registerUser();
    await fundWallet(buyer.userId, 5_000_000);
    await pool.query(`INSERT INTO waitlists (user_id, showtime_id, ticket_tier_id) VALUES ($1, $2, $3)`, [
      buyer.userId,
      showtimeId,
      soldOutTierId,
    ]);

    const reservation = await request(app)
      .post('/api/reservations')
      .set(bearer(buyer.token))
      .send({ showtimeId, ticketTierId: sellingTierId, quantity: 1 })
      .expect(201);
    await checkout(buyer.userId, reservation.body.id);

    const rows = await wl.getEntries(showtimeId);
    // They bought the cheap tier; they are still waiting for the good one.
    expect(rows[0].status).toBe('waiting');
  });
});
