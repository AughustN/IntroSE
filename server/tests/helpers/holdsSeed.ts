import { pool } from '../../src/db/pool.js';
import * as seed from './catalogSeed.js';

// Fixtures for the seat-hold tests: a real visible showtime with a real seat map / tier, seeded
// directly (the organizer write API is a different feature's surface).

export interface SeatedFixture {
  eventId: number;
  showtimeId: number;
  tierId: number;
  seatIds: number[];
  price: number;
}

/** A visible, on-sale seated showtime with `seatCount` available seats. */
export async function seedSeatedShowtime(seatCount = 4, price = 500_000): Promise<SeatedFixture> {
  const org = await seed.seedOrganizer(await seed.seedUser());
  const venue = await seed.seedVenue(await seed.seedUser());
  const layout = (
    await pool.query(`INSERT INTO venue_layouts (venue_id, name, status) VALUES ($1, 'Sơ đồ mặc định', 'ready') RETURNING id`, [venue])
  ).rows[0].id;
  const section = (
    await pool.query(`INSERT INTO sections (layout_id, name) VALUES ($1, 'Khu A') RETURNING id`, [layout])
  ).rows[0].id;
  const ev = await seed.seedEvent({ organizerId: org, eventType: 'seated' });
  const showtimeId = await seed.seedShowtime(ev.id, venue);
  const tierId = await seed.seedTier(showtimeId, { label: 'VIP', price, total: null });

  const seatIds: number[] = [];
  for (let i = 1; i <= seatCount; i++) {
    const seatId = (
      await pool.query(
        `INSERT INTO seats (layout_id, section_id, row_label, seat_number, pos_x, pos_y) VALUES ($1, $2, 'A', $3, $4, 1200) RETURNING id`,
        [layout, section, i, 5000 + (i - 1) * 150],
      )
    ).rows[0].id;
    const ss = await pool.query(
      `INSERT INTO showtime_seats (showtime_id, seat_id, ticket_tier_id, status, pos_x, pos_y, rotation, row_label, seat_number, section_name)
       VALUES ($1, $2, $3, 'available', $4, 1200, 0, 'A', $5, 'Khu A') RETURNING id`,
      [showtimeId, seatId, tierId, 5000 + (i - 1) * 150, i],
    );
    seatIds.push(ss.rows[0].id);
  }

  return { eventId: ev.id, showtimeId, tierId, seatIds, price };
}

export interface GaFixture {
  eventId: number;
  showtimeId: number;
  tierId: number;
  price: number;
}

/** A visible, on-sale general-admission showtime with one capped tier. */
export async function seedGaShowtime(total = 5, price = 200_000): Promise<GaFixture> {
  const org = await seed.seedOrganizer(await seed.seedUser());
  const venue = await seed.seedVenue(await seed.seedUser());
  const ev = await seed.seedEvent({ organizerId: org, eventType: 'general_admission' });
  const showtimeId = await seed.seedShowtime(ev.id, venue);
  const tierId = await seed.seedTier(showtimeId, { total, price });
  return { eventId: ev.id, showtimeId, tierId, price };
}

/** Take a showtime off sale, as an organizer cancellation would (edge case). */
export async function cancelShowtime(showtimeId: number): Promise<void> {
  await pool.query(`UPDATE showtimes SET status = 'cancelled' WHERE id = $1`, [showtimeId]);
}

export async function setSeatStatus(
  showtimeSeatId: number,
  status: 'available' | 'held' | 'sold' | 'blocked',
  ownerId: number | null = null,
  expiresInMs: number | null = null,
): Promise<void> {
  await pool.query(
    `UPDATE showtime_seats
        SET status = $2, hold_owner_id = $3,
            hold_expires_at = CASE WHEN $4::bigint IS NULL THEN NULL
                                   ELSE now() + ($4::bigint * interval '1 millisecond') END
      WHERE id = $1`,
    [showtimeSeatId, status, ownerId, expiresInMs],
  );
}

export async function getSeat(showtimeSeatId: number): Promise<{
  status: string;
  hold_owner_id: number | null;
  hold_expires_at: Date | null;
}> {
  const { rows } = await pool.query(
    `SELECT status, hold_owner_id, hold_expires_at FROM showtime_seats WHERE id = $1`,
    [showtimeSeatId],
  );
  return rows[0];
}

/** Push a reservation's window (and its seats') into the past, as if the TTL had elapsed. */
export async function expireReservation(reservationId: number, agoMs = 1000): Promise<void> {
  await pool.query(
    `UPDATE reservations SET expires_at = now() - ($2::bigint * interval '1 millisecond') WHERE id = $1`,
    [reservationId, agoMs],
  );
  await pool.query(
    `UPDATE showtime_seats ss
        SET hold_expires_at = now() - ($2::bigint * interval '1 millisecond')
       FROM reservation_items ri
      WHERE ri.reservation_id = $1 AND ri.showtime_seat_id = ss.id`,
    [reservationId, agoMs],
  );
}

/** Backdate a reservation's creation so the absolute grace ceiling can be exercised. */
export async function backdateReservation(reservationId: number, agoMs: number): Promise<void> {
  await pool.query(
    `UPDATE reservations SET created_at = now() - ($2::bigint * interval '1 millisecond') WHERE id = $1`,
    [reservationId, agoMs],
  );
}

export async function getReservationRow(reservationId: number): Promise<{
  status: string;
  expires_at: Date;
  created_at: Date;
  extended_once: boolean;
}> {
  const { rows } = await pool.query(
    `SELECT status, expires_at, created_at, extended_once FROM reservations WHERE id = $1`,
    [reservationId],
  );
  return rows[0];
}

export async function getTierCounts(tierId: number): Promise<{ sold: number; reserved: number; total: number | null }> {
  const { rows } = await pool.query(
    `SELECT sold_quantity AS sold, reserved_quantity AS reserved, total_quantity AS total
       FROM ticket_tiers WHERE id = $1`,
    [tierId],
  );
  return rows[0];
}
