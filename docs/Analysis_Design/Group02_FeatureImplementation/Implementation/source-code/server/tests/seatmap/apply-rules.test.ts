import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { app } from '../helpers/app.js';
import { bearer, makeApprovedOrganizer, registerUser } from '../helpers/authFixture.js';

// The heart of US3: editing a map that is already on sale (FR-027..FR-029, SC-003/004/005).
//
// The matrix these pin, per seat:
//   available / blocked → anything
//   sold                → position and rotation ONLY
//   held (live)         → nothing at all, and the hold is never cancelled
// and any refused seat rejects the WHOLE edit, leaving the map byte-identical.

async function organizer() {
  const o = await registerUser();
  await makeApprovedOrganizer(o.userId);
  return { ...o, h: bearer(o.token) };
}

/** A seated showtime with a generated map of `count` seats. */
async function liveMap(o: { h: Record<string, string> }, count = 3) {
  const venue = (await request(app).post('/api/organizer/venues').set(o.h).send({ name: 'V', city: 'Hà Nội', rawAddress: 'a' }).expect(201)).body.id;
  const section = (await request(app).post(`/api/organizer/venues/${venue}/sections`).set(o.h).send({ name: 'Khu A' }).expect(201)).body.id;
  await request(app).post(`/api/organizer/venues/${venue}/seats`).set(o.h).send({ sectionId: section, rowLabel: 'A', count }).expect(201);
  const ev = (await request(app).post('/api/organizer/events').set(o.h).send({ title: 'S', categoryCode: 'theatre', description: 'd', eventType: 'seated' }).expect(201)).body.id;
  const showtime = (await request(app).post(`/api/organizer/events/${ev}/showtimes`).set(o.h)
    .send({ venueId: venue, startsAt: new Date(Date.now() + 86_400_000).toISOString(), tiers: [{ label: 'VIP', price: 500_000 }, { label: 'Thường', price: 200_000 }] }).expect(201)).body.id;
  const tiers = (await pool.query<{ id: number }>(`SELECT id FROM ticket_tiers WHERE showtime_id = $1 ORDER BY price_amount`, [showtime])).rows;
  await request(app).post(`/api/organizer/showtimes/${showtime}/seat-map`).set(o.h)
    .send({ sectionTiers: [{ sectionId: section, ticketTierId: tiers[0].id }] }).expect(201);

  const seats = (await pool.query<{ id: number; seat_id: number; row_label: string; seat_number: number; section_name: string; ticket_tier_id: number; pos_x: number; pos_y: number; rotation: number }>(
    `SELECT id, seat_id, row_label, seat_number, section_name, ticket_tier_id, pos_x, pos_y, rotation
       FROM showtime_seats WHERE showtime_id = $1 ORDER BY seat_number`,
    [showtime],
  )).rows;
  return { showtime, seats, tiers, venue, section };
}

/** The edit payload for a seat, as PUT expects it. */
const line = (s: (typeof liveMap) extends never ? never : { id: number; seat_id: number; row_label: string; seat_number: number; section_name: string | null; ticket_tier_id: number; pos_x: number; pos_y: number; rotation: number }, patch: Record<string, unknown> = {}) => ({
  showtimeSeatId: s.id,
  seatId: s.seat_id,
  rowLabel: s.row_label,
  seatNumber: s.seat_number,
  sectionName: s.section_name,
  ticketTierId: s.ticket_tier_id,
  x: s.pos_x,
  y: s.pos_y,
  rotation: s.rotation,
  ...patch,
});

async function markSold(showtimeSeatId: number) {
  await pool.query(`UPDATE showtime_seats SET status = 'sold' WHERE id = $1`, [showtimeSeatId]);
}
async function markHeld(showtimeSeatId: number, userId: number) {
  await pool.query(
    `UPDATE showtime_seats SET status = 'held', hold_owner_id = $2, hold_expires_at = now() + interval '5 minutes' WHERE id = $1`,
    [showtimeSeatId, userId],
  );
}

describe('per-seat inventory rules on a live map (FR-028)', () => {
  it('lets every change through on an available seat', async () => {
    const o = await organizer();
    const m = await liveMap(o, 3);
    const [a, b, c] = m.seats;

    await request(app).put(`/api/organizer/showtimes/${m.showtime}/seat-map`).set(o.h)
      .send({ seats: [line(a, { x: 4321, rotation: 90, rowLabel: 'Z', ticketTierId: m.tiers[1].id }), line(b), line(c)] })
      .expect(200);

    const after = await pool.query(`SELECT pos_x, rotation, row_label, ticket_tier_id FROM showtime_seats WHERE id = $1`, [a.id]);
    expect(after.rows[0].pos_x).toBe(4321);
    expect(after.rows[0].row_label).toBe('Z');
  });

  it('lets a SOLD seat move but refuses relabel, re-tier and delete (SC-004)', async () => {
    const o = await organizer();
    const m = await liveMap(o, 3);
    const [sold, b, c] = m.seats;
    await markSold(sold.id);

    // Position only → allowed. The buyer's ticket still points at the same seat.
    await request(app).put(`/api/organizer/showtimes/${m.showtime}/seat-map`).set(o.h)
      .send({ seats: [line(sold, { x: 777, rotation: 45 }), line(b), line(c)] })
      .expect(200);

    // Relabel → refused, naming the sale.
    const relabel = await request(app).put(`/api/organizer/showtimes/${m.showtime}/seat-map`).set(o.h)
      .send({ seats: [line(sold, { x: 777, rowLabel: 'Q' }), line(b), line(c)] })
      .expect(409);
    expect(relabel.body.error).toBe('map_edit_refused');
    expect(relabel.body.refusals[0].reason).toBe('seat_sold');

    // Re-tier → refused.
    await request(app).put(`/api/organizer/showtimes/${m.showtime}/seat-map`).set(o.h)
      .send({ seats: [line(sold, { x: 777, ticketTierId: m.tiers[1].id }), line(b), line(c)] })
      .expect(409);

    // Delete (omitted from the payload) → refused.
    await request(app).put(`/api/organizer/showtimes/${m.showtime}/seat-map`).set(o.h)
      .send({ seats: [line(b), line(c)] })
      .expect(409)
      .expect((r) => expect(r.body.refusals[0].reason).toBe('seat_sold'));
  });

  it('refuses EVERY change to a seat under a live hold, and never cancels the hold (FR-028)', async () => {
    const o = await organizer();
    const m = await liveMap(o, 3);
    const [held, b, c] = m.seats;
    const buyer = await registerUser();
    await markHeld(held.id, buyer.userId);

    // Even a bare move is refused while someone holds it.
    const res = await request(app).put(`/api/organizer/showtimes/${m.showtime}/seat-map`).set(o.h)
      .send({ seats: [line(held, { x: 999 }), line(b), line(c)] })
      .expect(409);
    expect(res.body.refusals[0].reason).toBe('seat_held');

    // The buyer's hold is untouched — an organizer's edit never takes a seat from someone.
    const still = await pool.query(`SELECT status, hold_owner_id FROM showtime_seats WHERE id = $1`, [held.id]);
    expect(still.rows[0].status).toBe('held');
    expect(still.rows[0].hold_owner_id).toBe(buyer.userId);
  });

  it('accepts the same edit once the hold has lapsed — live inventory, not a cached snapshot', async () => {
    const o = await organizer();
    const m = await liveMap(o, 2);
    const [held, b] = m.seats;
    const buyer = await registerUser();
    await markHeld(held.id, buyer.userId);

    await request(app).put(`/api/organizer/showtimes/${m.showtime}/seat-map`).set(o.h)
      .send({ seats: [line(held, { x: 999 }), line(b)] }).expect(409);

    // Expire the hold in place: a `held` row past its expiry counts as free, exactly as the hold path
    // treats it, so the organizer is not blocked by a hold the sweep has not yet collected.
    await pool.query(`UPDATE showtime_seats SET hold_expires_at = now() - interval '1 minute' WHERE id = $1`, [held.id]);

    await request(app).put(`/api/organizer/showtimes/${m.showtime}/seat-map`).set(o.h)
      .send({ seats: [line(held, { x: 999 }), line(b)] }).expect(200);
  });
});

describe('a refused edit is rejected WHOLE (FR-029, SC-005)', () => {
  it('leaves the map identical when one seat in the edit is refused', async () => {
    const o = await organizer();
    const m = await liveMap(o, 3);
    const [sold, available, c] = m.seats;
    await markSold(sold.id);

    const before = await pool.query(`SELECT id, pos_x, pos_y, row_label, ticket_tier_id, status FROM showtime_seats WHERE showtime_id = $1 ORDER BY id`, [m.showtime]);

    // One permitted change (available seat moves) and one refused (sold seat relabelled).
    await request(app).put(`/api/organizer/showtimes/${m.showtime}/seat-map`).set(o.h)
      .send({ seats: [line(sold, { rowLabel: 'Q' }), line(available, { x: 1234 }), line(c)] })
      .expect(409);

    const after = await pool.query(`SELECT id, pos_x, pos_y, row_label, ticket_tier_id, status FROM showtime_seats WHERE showtime_id = $1 ORDER BY id`, [m.showtime]);
    // The permitted change did NOT land either — no partial application.
    expect(after.rows).toEqual(before.rows);
  });
});

describe('the snapshot isolates showtimes from layout edits (FR-005, SC-005a)', () => {
  it('a layout edit changes neither generated map until it is explicitly re-applied', async () => {
    const o = await organizer();
    const m = await liveMap(o, 3);
    const layoutId = (await pool.query(`SELECT layout_id FROM sections WHERE id = $1`, [m.section])).rows[0].layout_id;
    const layout = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;

    const before = await pool.query(`SELECT pos_x FROM showtime_seats WHERE showtime_id = $1 ORDER BY id`, [m.showtime]);

    // Move every seat in the SOURCE layout. Shifted by a constant so the row stays valid — stacking
    // them all on one x would overlap, which the bind-time check correctly refuses (FR-030).
    // This must not be gated on inventory (FR-027)…
    await request(app).put(`/api/organizer/layouts/${layoutId}`).set(o.h).send({
      version: layout.version,
      sections: layout.sections,
      seats: layout.seats.map((s: { x: number }) => ({ ...s, x: s.x + 1000 })),
      elements: layout.elements,
    }).expect(200);

    // …and must not reach the generated map.
    const after = await pool.query(`SELECT pos_x FROM showtime_seats WHERE showtime_id = $1 ORDER BY id`, [m.showtime]);
    expect(after.rows).toEqual(before.rows);

    // A preview writes nothing but reports what would change.
    const preview = await request(app).post(`/api/organizer/showtimes/${m.showtime}/seat-map/reapply`).set(o.h).send({ dryRun: true }).expect(200);
    expect(preview.body.wouldSucceed).toBe(true);
    expect(preview.body.changes.length).toBeGreaterThan(0);
    const untouched = await pool.query(`SELECT pos_x FROM showtime_seats WHERE showtime_id = $1 ORDER BY id`, [m.showtime]);
    expect(untouched.rows).toEqual(before.rows);

    // Only the explicit re-apply moves it.
    await request(app).post(`/api/organizer/showtimes/${m.showtime}/seat-map/reapply`).set(o.h).send({ dryRun: false }).expect(200);
    const applied = await pool.query(`SELECT pos_x FROM showtime_seats WHERE showtime_id = $1 ORDER BY id`, [m.showtime]);
    expect(applied.rows.map((r: { pos_x: number }) => r.pos_x)).toEqual(before.rows.map((r: { pos_x: number }) => r.pos_x + 1000));
  });
});

describe('block and marquee tier assignment (US7, FR-033/FR-034)', () => {
  it('blocks an available seat and refuses a held or sold one', async () => {
    const o = await organizer();
    const m = await liveMap(o, 3);
    const [a, sold, held] = m.seats;
    await markSold(sold.id);
    const buyer = await registerUser();
    await markHeld(held.id, buyer.userId);

    await request(app).post(`/api/organizer/showtimes/${m.showtime}/seats/block`).set(o.h)
      .send({ showtimeSeatIds: [a.id], blocked: true }).expect(200);
    const blocked = await pool.query(`SELECT status FROM showtime_seats WHERE id = $1`, [a.id]);
    expect(blocked.rows[0].status).toBe('blocked');

    // Unblock returns it.
    await request(app).post(`/api/organizer/showtimes/${m.showtime}/seats/block`).set(o.h)
      .send({ showtimeSeatIds: [a.id], blocked: false }).expect(200);

    // Blocking never takes a seat from someone who has it.
    await request(app).post(`/api/organizer/showtimes/${m.showtime}/seats/block`).set(o.h)
      .send({ showtimeSeatIds: [sold.id], blocked: true }).expect(409);
    await request(app).post(`/api/organizer/showtimes/${m.showtime}/seats/block`).set(o.h)
      .send({ showtimeSeatIds: [held.id], blocked: true }).expect(409);
  });

  it('assigns a tier across a selection, and refuses one containing a sold seat', async () => {
    const o = await organizer();
    const m = await liveMap(o, 3);
    const [a, b, sold] = m.seats;
    await markSold(sold.id);

    await request(app).post(`/api/organizer/showtimes/${m.showtime}/seats/tier`).set(o.h)
      .send({ showtimeSeatIds: [a.id, b.id], ticketTierId: m.tiers[1].id }).expect(200);
    const tiered = await pool.query(`SELECT DISTINCT ticket_tier_id FROM showtime_seats WHERE id = ANY($1::bigint[])`, [[a.id, b.id]]);
    expect(tiered.rows).toEqual([{ ticket_tier_id: m.tiers[1].id }]);

    // A sold seat in the selection refuses the WHOLE action rather than repricing an owned ticket.
    const res = await request(app).post(`/api/organizer/showtimes/${m.showtime}/seats/tier`).set(o.h)
      .send({ showtimeSeatIds: [a.id, sold.id], ticketTierId: m.tiers[0].id }).expect(409);
    expect(res.body.refusals[0].reason).toBe('seat_sold');
  });
});
