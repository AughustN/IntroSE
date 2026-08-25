import { describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import * as apply from '../../src/modules/seatmap/apply.js';
import * as holds from '../helpers/holdsSeed.js';

/**
 * Once a showtime is on sale, its map stops being the organizer's to reshape.
 *
 * The per-seat rules in `apply.ts` protect seats that are already spoken for, one at a time. They
 * leave the map itself open: every seat still available could be deleted or repriced while buyers
 * were looking at it. These cases pin the whole-showtime gate that closes that, and — just as
 * importantly — pin the two things it must NOT close.
 */

/** The current map, expressed as a no-op edit: the same seats, unchanged. */
async function desiredFromCurrent(showtimeId: number): Promise<apply.DesiredSeat[]> {
  const { rows } = await pool.query(
    `SELECT id, seat_id, row_label, seat_number, section_name, ticket_tier_id, pos_x, pos_y, rotation
       FROM showtime_seats WHERE showtime_id = $1 ORDER BY id`,
    [showtimeId],
  );
  return rows.map((r) => ({
    showtimeSeatId: r.id,
    seatId: r.seat_id,
    rowLabel: r.row_label,
    seatNumber: r.seat_number,
    sectionName: r.section_name,
    ticketTierId: r.ticket_tier_id,
    x: r.pos_x,
    y: r.pos_y,
    rotation: r.rotation,
  }));
}

const setEventStatus = (eventId: number, status: string) =>
  pool.query(`UPDATE events SET status = $2 WHERE id = $1`, [eventId, status]);

describe('seat map edits stop when the sale starts', () => {
  it('refuses to reshape the map of a showtime that is on sale', async () => {
    const { showtimeId, seatIds } = await holds.seedSeatedShowtime(3);
    const desired = await desiredFromCurrent(showtimeId);

    // Drop a seat nobody has touched — allowed by every per-seat rule, and exactly the edit the
    // gate exists to stop: inventory vanishing from under a buyer mid-sale.
    await expect(apply.apply(showtimeId, desired.slice(1))).rejects.toMatchObject({
      status: 409,
      code: 'sale_started',
    });

    // Refused means refused: the map is untouched, not partially applied.
    const after = await pool.query(`SELECT id FROM showtime_seats WHERE showtime_id = $1`, [showtimeId]);
    expect(after.rows).toHaveLength(seatIds.length);
  });

  it('refuses to reprice seats of a showtime that is on sale', async () => {
    const { showtimeId, seatIds, tierId } = await holds.seedSeatedShowtime(2);
    const cheaper = (
      await pool.query(
        `INSERT INTO ticket_tiers (showtime_id, label, price_amount) VALUES ($1, 'Thường', 100000) RETURNING id`,
        [showtimeId],
      )
    ).rows[0].id;

    // A retier is a price change, and none of these seats is sold — the per-seat rules would have
    // waved it through.
    await expect(apply.setTier(showtimeId, seatIds, cheaper)).rejects.toMatchObject({
      status: 409,
      code: 'sale_started',
    });

    const seat = await pool.query(`SELECT ticket_tier_id FROM showtime_seats WHERE id = $1`, [seatIds[0]]);
    expect(seat.rows[0].ticket_tier_id).toBe(tierId);
  });

  it('still lets an organizer arrange the map before the event goes on sale', async () => {
    const { eventId, showtimeId } = await holds.seedSeatedShowtime(3);
    await setEventStatus(eventId, 'draft');
    const desired = await desiredFromCurrent(showtimeId);

    // The gate is the sale, not the map: a draft event is still the organizer's to arrange, and a
    // guard that blocked this would make seated events unbuildable.
    const outcome = await apply.apply(showtimeId, desired.slice(1));
    expect(outcome.wouldSucceed).toBe(true);
    const after = await pool.query(`SELECT id FROM showtime_seats WHERE showtime_id = $1`, [showtimeId]);
    expect(after.rows).toHaveLength(2);
  });

  it('still lets an organizer take a seat out of sale while on sale (the operational valve)', async () => {
    const { showtimeId, seatIds } = await holds.seedSeatedShowtime(2);

    // Blocking is inventory management, not a map edit: a seat breaks mid-run and has to come out
    // of sale. Deliberately left open — see `assertNotOnSale`, which `setBlocked` does not call.
    const outcome = await apply.setBlocked(showtimeId, [seatIds[0]], true);
    expect(outcome.refusals).toHaveLength(0);

    const seat = await pool.query(`SELECT status FROM showtime_seats WHERE id = $1`, [seatIds[0]]);
    expect(seat.rows[0].status).toBe('blocked');
  });
});
