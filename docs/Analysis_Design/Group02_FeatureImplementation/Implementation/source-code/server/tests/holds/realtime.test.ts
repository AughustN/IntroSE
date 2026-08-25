import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { SeatUpdate } from '@shared/holds/types.js';
import { app } from '../helpers/app.js';
import { bearer, registerUser } from '../helpers/authFixture.js';
import * as holds from '../helpers/holdsSeed.js';
import { subscribeSeatUpdates } from '../../src/realtime/io.js';
import { sweepExpiredHolds } from '../../src/modules/holds/sweep.js';

/**
 * The live channel (US3). Broadcasts are advisory (FR-023) — these assert *what* is published after a
 * committed transition, which is what a viewer's map applies. Subscribing in-process avoids standing
 * up a socket server for what is really a question about the service's output.
 */
describe('live seat updates (US3)', () => {
  let stop: (() => void) | null = null;
  const captured: SeatUpdate[] = [];

  const listen = () => {
    captured.length = 0;
    stop = subscribeSeatUpdates((u) => captured.push(u));
  };

  afterEach(() => {
    stop?.();
    stop = null;
  });

  it('publishes the seat as held after a committed hold (FR-021)', async () => {
    const { showtimeId, seatIds } = await holds.seedSeatedShowtime();
    const user = await registerUser();
    listen();

    await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, seatIds: [seatIds[0]] })
      .expect(201);

    expect(captured).toHaveLength(1);
    expect(captured[0].showtimeId).toBe(showtimeId);
    expect(captured[0].seats).toEqual([{ showtimeSeatId: seatIds[0], status: 'held' }]);
  });

  it('publishes the seat as available again after a release (FR-021)', async () => {
    const { showtimeId, seatIds } = await holds.seedSeatedShowtime();
    const user = await registerUser();
    const held = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, seatIds: [seatIds[0]] })
      .expect(201);
    listen();

    await request(app)
      .patch(`/api/reservations/${held.body.id}`)
      .set(bearer(user.token))
      .send({ removeSeatIds: [seatIds[0]] })
      .expect(200);

    expect(captured.at(-1)?.seats).toEqual([{ showtimeSeatId: seatIds[0], status: 'available' }]);
  });

  it('publishes releases from the expiry sweep too, so an abandoned map self-heals', async () => {
    const { showtimeId, seatIds } = await holds.seedSeatedShowtime(2);
    const user = await registerUser();
    const held = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, seatIds })
      .expect(201);
    await holds.expireReservation(held.body.id);
    listen();

    await sweepExpiredHolds();

    expect(captured).toHaveLength(1);
    expect(captured[0].seats).toHaveLength(2);
    expect(captured[0].seats?.every((s) => s.status === 'available')).toBe(true);
  });

  it('publishes the tier’s new remaining for a general-admission hold', async () => {
    const { showtimeId, tierId } = await holds.seedGaShowtime(5);
    const user = await registerUser();
    listen();

    await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, ticketTierId: tierId, quantity: 2 })
      .expect(201);

    expect(captured.at(-1)?.tier).toEqual({ ticketTierId: tierId, remaining: 3 });
  });

  it('publishes nothing when a hold is refused — only committed changes are broadcast', async () => {
    const { showtimeId, seatIds } = await holds.seedSeatedShowtime();
    const owner = await registerUser();
    const other = await registerUser();
    await request(app)
      .post('/api/reservations')
      .set(bearer(owner.token))
      .send({ showtimeId, seatIds: [seatIds[0]] })
      .expect(201);
    listen();

    await request(app)
      .post('/api/reservations')
      .set(bearer(other.token))
      .send({ showtimeId, seatIds: [seatIds[0]] })
      .expect(409);

    expect(captured).toHaveLength(0);
  });

  it('keeps the database the source of truth — a stale client is still refused (FR-023)', async () => {
    const { showtimeId, seatIds } = await holds.seedSeatedShowtime();
    const owner = await registerUser();
    const stale = await registerUser();

    // `stale` never receives the broadcast (it is not listening) and acts on an outdated map.
    await request(app)
      .post('/api/reservations')
      .set(bearer(owner.token))
      .send({ showtimeId, seatIds: [seatIds[0]] })
      .expect(201);

    const res = await request(app)
      .post('/api/reservations')
      .set(bearer(stale.token))
      .send({ showtimeId, seatIds: [seatIds[0]] });
    expect(res.status).toBe(409); // the row lock, not the socket, is what protects the seat
  });
});
