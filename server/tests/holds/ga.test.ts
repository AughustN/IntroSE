import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../helpers/app.js';
import { bearer, registerUser } from '../helpers/authFixture.js';
import * as holds from '../helpers/holdsSeed.js';
import { sweepExpiredHolds } from '../../src/modules/holds/sweep.js';

describe('general-admission quantity holds (US4)', () => {
  it('reserves a quantity and drops the tier’s remaining for everyone (FR-018)', async () => {
    const { showtimeId, tierId, price } = await holds.seedGaShowtime(5);
    const user = await registerUser();

    const res = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, ticketTierId: tierId, quantity: 2 })
      .expect(201);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].showtimeSeatId).toBeNull(); // GA holds no seat rows
    expect(res.body.items[0].quantity).toBe(2);
    expect(res.body.totalAmount).toBe(2 * price);

    const counts = await holds.getTierCounts(tierId);
    expect(counts.reserved).toBe(2); // remaining = 5 − 0 − 2 = 3

    const map = await request(app).get(`/api/showtimes/${showtimeId}/seat-map`).expect(200);
    expect(map.body.tiers[0].remaining).toBe(3); // and every viewer reads the same number
  });

  it('refuses more than the tier has left (FR-019)', async () => {
    const { showtimeId, tierId } = await holds.seedGaShowtime(3);
    const user = await registerUser();

    const res = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, ticketTierId: tierId, quantity: 4 });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('insufficient_stock');
    expect((await holds.getTierCounts(tierId)).reserved).toBe(0); // unchanged
  });

  it('never oversells under concurrent reservations (FR-019, SC-005)', async () => {
    const { showtimeId, tierId } = await holds.seedGaShowtime(5);
    const buyers = await Promise.all([registerUser(), registerUser(), registerUser(), registerUser()]);

    const results = await Promise.all(
      buyers.map((b) =>
        request(app)
          .post('/api/reservations')
          .set(bearer(b.token))
          .send({ showtimeId, ticketTierId: tierId, quantity: 2 }),
      ),
    );

    const ok = results.filter((r) => r.status === 201).length;
    expect(ok).toBe(2); // 2 × 2 = 4 fits in 5; a third would need 6
    const counts = await holds.getTierCounts(tierId);
    expect(counts.sold + counts.reserved).toBeLessThanOrEqual(counts.total!);
  });

  it('returns the quantity to the tier when the hold expires (FR-020)', async () => {
    const { showtimeId, tierId } = await holds.seedGaShowtime(5);
    const user = await registerUser();

    const res = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, ticketTierId: tierId, quantity: 2 })
      .expect(201);
    expect((await holds.getTierCounts(tierId)).reserved).toBe(2);

    await holds.expireReservation(res.body.id);
    await sweepExpiredHolds();

    expect((await holds.getTierCounts(tierId)).reserved).toBe(0); // remaining back to 5
    expect((await holds.getReservationRow(res.body.id)).status).toBe('expired');
  });

  it('returns the quantity when the attendee cancels (FR-014/020)', async () => {
    const { showtimeId, tierId } = await holds.seedGaShowtime(5);
    const user = await registerUser();

    const res = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, ticketTierId: tierId, quantity: 3 })
      .expect(201);

    await request(app).delete(`/api/reservations/${res.body.id}`).set(bearer(user.token)).expect(204);

    expect((await holds.getTierCounts(tierId)).reserved).toBe(0);
    expect((await holds.getReservationRow(res.body.id)).status).toBe('cancelled');
  });

  it('refuses a zero/negative quantity and a tier from another showtime (edge cases)', async () => {
    const a = await holds.seedGaShowtime(5);
    const b = await holds.seedGaShowtime(5);
    const user = await registerUser();

    await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId: a.showtimeId, ticketTierId: a.tierId, quantity: 0 })
      .expect(400); // rejected at the schema boundary (SEC-07)

    const foreign = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId: a.showtimeId, ticketTierId: b.tierId, quantity: 1 });
    expect(foreign.status).toBe(422);
    expect(foreign.body.error).toBe('invalid_selection');
  });

  it('applies the same 8-ticket cap to reserved quantity (FR-016)', async () => {
    const { showtimeId, tierId } = await holds.seedGaShowtime(20);
    const user = await registerUser();

    await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, ticketTierId: tierId, quantity: 8 })
      .expect(201);

    const over = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, ticketTierId: tierId, quantity: 1 });
    expect(over.status).toBe(422);
    expect(over.body.error).toBe('cap_exceeded');
    expect((await holds.getTierCounts(tierId)).reserved).toBe(8);
  });

  it('refuses seats on a GA showtime and a quantity on a seated one — never mixed (FR-012)', async () => {
    const ga = await holds.seedGaShowtime(5);
    const seated = await holds.seedSeatedShowtime(2);
    const user = await registerUser();

    const seatsOnGa = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId: ga.showtimeId, seatIds: [seated.seatIds[0]] });
    expect(seatsOnGa.status).toBe(422);

    const qtyOnSeated = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId: seated.showtimeId, ticketTierId: seated.tierId, quantity: 1 });
    expect(qtyOnSeated.status).toBe(422);
  });
});
