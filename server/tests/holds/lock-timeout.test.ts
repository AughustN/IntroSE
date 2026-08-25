import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { DB_LOCK_TIMEOUT_MS } from '../../src/config.js';
import { pool, withTransaction } from '../../src/db/pool.js';
import { app } from '../helpers/app.js';
import { bearer, registerUser } from '../helpers/authFixture.js';
import * as holds from '../helpers/holdsSeed.js';

/**
 * The bound on how long a transaction may WAIT for a row lock.
 *
 * `FOR UPDATE` is what makes the hold guarantee true (see concurrency.test.ts), but a waiter holds
 * a pool connection for the whole time it queues. Unbounded, that turns contention over one hot
 * seat into connection starvation for the entire API — a catalog read that touches no locked row
 * cannot get a connection either. These cases pin the ceiling and the refusal it produces.
 */
/** Postgres echoes the interval in its own units: 2000ms reads back as '2s', 2500ms as '2500ms'. */
const shown = (msValue: number): string =>
  msValue % 1000 === 0 ? `${msValue / 1000}s` : `${msValue}ms`;

describe('lock_timeout — a bounded wait for a contended row', () => {
  it('opens every transaction with the configured lock_timeout', async () => {
    const [applied, overridden] = await Promise.all([
      withTransaction(async (client) => (await client.query('SHOW lock_timeout')).rows[0].lock_timeout),
      withTransaction(
        async (client) => (await client.query('SHOW lock_timeout')).rows[0].lock_timeout,
        { lockTimeoutMs: 5000 },
      ),
    ]);

    expect(applied).toBe(shown(DB_LOCK_TIMEOUT_MS));
    expect(overridden).toBe('5s');
  });

  it('reverts the override with the transaction, leaving the pooled connection clean', async () => {
    await withTransaction(async () => undefined, { lockTimeoutMs: 5000 });

    // SET LOCAL, not SET: a connection returned to the pool must not carry one caller's ceiling
    // into the next caller's transaction.
    const next = await withTransaction(
      async (client) => (await client.query('SHOW lock_timeout')).rows[0].lock_timeout,
    );
    expect(next).toBe(shown(DB_LOCK_TIMEOUT_MS));
  });

  it('refuses a hold blocked behind a stuck lock holder instead of queueing forever', async () => {
    const { showtimeId, seatIds } = await holds.seedSeatedShowtime(1);
    const buyer = await registerUser();

    // A transaction that takes the seat's row lock and then does nothing — the shape of a slow or
    // wedged contender, which is when an unbounded wait does its damage.
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM showtime_seats WHERE id = $1 FOR UPDATE', [seatIds[0]]);

      const startedAt = Date.now();
      const res = await request(app)
        .post('/api/reservations')
        .set(bearer(buyer.token))
        .send({ showtimeId, seatIds });
      const waited = Date.now() - startedAt;

      // The seat really is unavailable to this buyer, so the answer is the same 409 every other
      // loser gets — not a 500, and not a hung request.
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('seat_taken');
      // Bounded by the ceiling, with room for the round trips either side of it.
      expect(waited).toBeLessThan(DB_LOCK_TIMEOUT_MS + 15_000);
    } finally {
      await blocker.query('ROLLBACK').catch(() => {});
      blocker.release();
    }

    // The blocker never committed, so the seat is free again — the timeout refused a request, it
    // did not corrupt inventory.
    expect((await holds.getSeat(seatIds[0])).status).toBe('available');
  });
});
