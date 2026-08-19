import type { Reservation, ReservationItem, ReservationStatus } from '@shared/holds/types.js';
import type pg from 'pg';
import type { Db } from '../../db/pool.js';
import { pool } from '../../db/pool.js';
import { VISIBLE_JOIN, VISIBLE_WHERE } from '../catalog/visibility.js';

/**
 * Every write here runs under a row lock (`SELECT … FOR UPDATE`), which is what makes the hold
 * guarantee true: concurrent contenders for one seat are serialized by Postgres, so exactly one
 * wins and the rest see the state the winner left (DATA-02, R-2). The database is the source of
 * truth; the socket broadcast that follows a commit is advisory (FR-023).
 */

export interface SeatRow {
  id: number;
  showtime_id: number;
  ticket_tier_id: number;
  status: 'available' | 'held' | 'sold' | 'blocked';
  hold_owner_id: number | null;
  hold_expires_at: Date | null;
  price_amount: number;
  seat_label: string;
  /**
   * Whether this seat may be taken now, and whether the caller already holds it — both decided BY
   * THE DATABASE, in the same statement that locks the row.
   *
   * These used to be computed in TypeScript from `hold_expires_at` against `new Date()`. That is a
   * different clock from the one that wrote the column and from the one every other predicate over
   * it uses, and the gap is real: this project's database measured ~1.1s behind its API host. A host
   * running ahead would call a rival's live hold expired and hand out a seat that was not free — the
   * one thing the row lock exists to prevent. Deciding it in SQL closes that window and costs
   * nothing: the row is already being selected and locked.
   */
  holdable: boolean;
  held_by_me: boolean;
}

export interface TierRow {
  id: number;
  showtime_id: number;
  price_amount: number;
  total_quantity: number | null;
  sold_quantity: number;
  reserved_quantity: number;
  /** Set once the organizer retires the tier (006 FR-006). An archived tier is unpurchasable. */
  archived_at: Date | null;
}

export interface ReservationRow {
  id: number;
  user_id: number;
  showtime_id: number;
  status: ReservationStatus;
  expires_at: Date;
  created_at: Date;
  extended_once: boolean;
  /**
   * Whether the window has passed, decided BY THE DATABASE on the same clock that wrote
   * `expires_at`.
   *
   * Carried on the row rather than recomputed as `expires_at < Date.now()` because those are two
   * different clocks and the difference is not academic — this project's database measured ~1.1s
   * behind its API host. A caller comparing them judges a hold dead while SQL still counts it alive
   * (or the reverse), and the callers here are the ones that decide whether a seat may be handed to
   * somebody else. Free to compute: it rides along on a query already being made.
   */
  expired: boolean;
}

export interface ShowtimeInfo {
  id: number;
  eventType: 'general_admission' | 'seated';
  /** On sale, approved, organizer approved, not started, not cancelled — holdable right now. */
  sellable: boolean;
}

// ---- Showtime gate --------------------------------------------------------

/** A hold is only allowed on a showtime a buyer could legitimately see and buy (FR-025, edge case). */
export async function getShowtimeInfo(showtimeId: number, db: Db = pool): Promise<ShowtimeInfo | null> {
  const { rows } = await db.query<{ id: number; event_type: 'general_admission' | 'seated'; sellable: boolean }>(
    `SELECT s.id, e.event_type,
            (${VISIBLE_WHERE} AND s.starts_at > now() AND s.status NOT IN ('cancelled', 'finished')) AS sellable
       FROM showtimes s
       JOIN events e ON e.id = s.event_id
       ${VISIBLE_JOIN}
      WHERE s.id = $1`,
    [showtimeId],
  );
  const r = rows[0];
  return r ? { id: r.id, eventType: r.event_type, sellable: r.sellable } : null;
}

// ---- Seats ----------------------------------------------------------------

/**
 * Lock the requested seats. Ordered by id so two concurrent multi-seat requests can never deadlock
 * by taking the same rows in opposite orders.
 */
export async function lockSeats(
  client: pg.PoolClient,
  showtimeId: number,
  seatIds: number[],
  userId: number,
): Promise<SeatRow[]> {
  if (seatIds.length === 0) return [];
  const { rows } = await client.query<SeatRow>(
    // A `held` row whose window has already passed counts as available — the sweep is a mechanism,
    // not the definition of expiry, so a hold placed a moment after lapse must still succeed.
    `SELECT ss.id, ss.showtime_id, ss.ticket_tier_id, ss.status, ss.hold_owner_id, ss.hold_expires_at,
            tt.price_amount, (se.row_label || se.seat_number::text) AS seat_label,
            (ss.status = 'available'
             OR (ss.status = 'held' AND ss.hold_expires_at IS NOT NULL
                 AND ss.hold_expires_at <= now())) AS holdable,
            (ss.status = 'held' AND ss.hold_owner_id = $3 AND ss.hold_expires_at IS NOT NULL
             AND ss.hold_expires_at > now()) AS held_by_me
       FROM showtime_seats ss
       JOIN ticket_tiers tt ON tt.id = ss.ticket_tier_id
       JOIN seats se ON se.id = ss.seat_id
      WHERE ss.id = ANY($1::bigint[]) AND ss.showtime_id = $2
      ORDER BY ss.id
        FOR UPDATE OF ss`,
    [seatIds, showtimeId, userId],
  );
  return rows;
}

/**
 * Claim seats for a reservation, copying its deadline straight off the reservation row.
 *
 * The expiry is read here rather than passed in so that a seat's clock cannot be set from anywhere
 * but the reservation that owns it — the two are compared against each other (FR-006) and both are
 * tested against SQL `now()` by every authoritative reader, so a caller supplying its own `Date`
 * would reintroduce exactly the host-clock dependency `createReservation` exists to remove.
 */
export async function holdSeats(
  client: pg.PoolClient,
  seatIds: number[],
  userId: number,
  reservationId: number,
): Promise<void> {
  if (seatIds.length === 0) return;
  await client.query(
    `UPDATE showtime_seats
        SET status = 'held',
            hold_owner_id = $2,
            hold_expires_at = (SELECT r.expires_at FROM reservations r WHERE r.id = $3)
      WHERE id = ANY($1::bigint[])`,
    [seatIds, userId, reservationId],
  );
}

/** Back to `available`, owner and expiry cleared. Never touches a `sold` seat (FR-009). */
export async function releaseSeats(client: pg.PoolClient, seatIds: number[]): Promise<void> {
  if (seatIds.length === 0) return;
  await client.query(
    `UPDATE showtime_seats
        SET status = 'available', hold_owner_id = NULL, hold_expires_at = NULL
      WHERE id = ANY($1::bigint[]) AND status = 'held'`,
    [seatIds],
  );
}

/**
 * Mirror the reservation's clock onto its seats, so both agree at all times (FR-006).
 *
 * Reads the deadline off the reservation for the same reason `holdSeats` does — one row is the
 * authority for when this hold ends, and nothing outside the database gets to name that instant.
 */
export async function syncSeatExpiry(client: pg.PoolClient, reservationId: number): Promise<void> {
  await client.query(
    `UPDATE showtime_seats ss
        SET hold_expires_at = r.expires_at
       FROM reservation_items ri, reservations r
      WHERE ri.reservation_id = $1 AND ri.showtime_seat_id = ss.id AND ss.status = 'held'
        AND r.id = ri.reservation_id`,
    [reservationId],
  );
}

// ---- Tiers (general admission) --------------------------------------------

export async function lockTier(client: pg.PoolClient, tierId: number): Promise<TierRow | null> {
  const { rows } = await client.query<TierRow>(
    `SELECT id, showtime_id, price_amount, total_quantity, sold_quantity, reserved_quantity, archived_at
       FROM ticket_tiers WHERE id = $1 FOR UPDATE`,
    [tierId],
  );
  return rows[0] ?? null;
}

/** capacity − sold − reserved. `null` capacity = unlimited (seated tiers and uncapped GA). */
export function tierRemaining(tier: TierRow): number | null {
  return tier.total_quantity === null ? null : tier.total_quantity - tier.sold_quantity - tier.reserved_quantity;
}

/**
 * Does this tier have seat rows behind it?
 *
 * The question a quantity selection has to answer before it is allowed. A tier is sold EITHER as
 * individual seats or by count, and the honest test is not the event's type but the inventory itself:
 * if `showtime_seats` rows exist for the tier, every ticket is a specific seat and a bare quantity
 * would sell one that nothing reserves — the double-sell this whole module exists to prevent.
 *
 * A capacity zone's tier (0027) has no seat rows, which is exactly why it can be sold by count, and
 * why a seated showtime with a standing floor works without a second inventory mechanism.
 */
export async function tierHasSeats(client: pg.PoolClient, tierId: number): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM showtime_seats WHERE ticket_tier_id = $1 LIMIT 1`,
    [tierId],
  );
  return rows.length > 0;
}

export async function bumpReserved(client: pg.PoolClient, tierId: number, delta: number): Promise<void> {
  await client.query(
    `UPDATE ticket_tiers SET reserved_quantity = GREATEST(reserved_quantity + $2, 0) WHERE id = $1`,
    [tierId, delta],
  );
}

export async function readTierRemaining(tierId: number, db: Db = pool): Promise<number | null> {
  const { rows } = await db.query<{ remaining: number | null }>(
    `SELECT CASE WHEN total_quantity IS NULL THEN NULL
                 ELSE total_quantity - sold_quantity - reserved_quantity END AS remaining
       FROM ticket_tiers WHERE id = $1`,
    [tierId],
  );
  return rows[0]?.remaining ?? null;
}

// ---- Reservations ---------------------------------------------------------

/**
 * The caller's single active reservation for a showtime. Locked when we are about to add to it, so
 * two tabs adding seats at once cannot both pass the cap check (FR-016).
 */
export async function findActiveReservation(
  db: Db,
  userId: number,
  showtimeId: number,
  forUpdate = false,
): Promise<ReservationRow | null> {
  const { rows } = await db.query<ReservationRow>(
    `SELECT id, user_id, showtime_id, status, expires_at, created_at, extended_once,
            expires_at <= now() AS expired
       FROM reservations
      WHERE user_id = $1 AND showtime_id = $2 AND status = 'active'
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [userId, showtimeId],
  );
  return rows[0] ?? null;
}

export async function findReservation(db: Db, id: number, forUpdate = false): Promise<ReservationRow | null> {
  const { rows } = await db.query<ReservationRow>(
    `SELECT id, user_id, showtime_id, status, expires_at, created_at, extended_once,
            expires_at <= now() AS expired
       FROM reservations WHERE id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Open a hold window. The DEADLINE IS COMPUTED BY THE DATABASE, from `ttlMs` — never handed in as a
 * `Date` built on the API host's clock.
 *
 * Which clock owns `expires_at` is not a detail: every authoritative reader of this column is SQL
 * comparing it against `now()` — the sweeper (`findExpiredActive`), the checkout seat claim
 * (`wallet.service`), the live-hold predicates in `apply`/`standing`/`tables`. Written from the
 * application clock, all of them were off by whatever the two machines disagreed by, which against a
 * hosted database is not zero: this project's Neon instance measured ~1.1s behind its dev host.
 *
 * The direction that bites is a database running AHEAD: the countdown on screen still shows time
 * left while SQL has already retired the hold, so the buyer reaches checkout and the claim refuses a
 * seat the UI says is theirs. Letting `now()` set the deadline makes the column and every predicate
 * over it share one clock, so the guarantee holds no matter how far the hosts drift. `created_at`
 * (DEFAULT now()) and the grace ceiling in `extendReservationOnce` already live on that clock.
 */
export async function createReservation(
  client: pg.PoolClient,
  userId: number,
  showtimeId: number,
  ttlMs: number,
): Promise<ReservationRow> {
  const { rows } = await client.query<ReservationRow>(
    `INSERT INTO reservations (user_id, showtime_id, expires_at, status)
     VALUES ($1, $2, now() + ($3::bigint * interval '1 millisecond'), 'active')
     RETURNING id, user_id, showtime_id, status, expires_at, created_at, extended_once,
               expires_at <= now() AS expired`,
    [userId, showtimeId, ttlMs],
  );
  return rows[0];
}

export async function setReservationStatus(
  client: pg.PoolClient,
  id: number,
  status: ReservationStatus,
): Promise<void> {
  await client.query(`UPDATE reservations SET status = $2 WHERE id = $1`, [id, status]);
}

/**
 * The one-time top-up grace (FR-010): +HOLD_GRACE_MS, never past `created_at + HOLD_ABSOLUTE_MS`,
 * and only while `extended_once` is false. The guard is in the WHERE clause, so two concurrent
 * top-ups cannot both extend.
 *
 * Both operands are COLUMNS of the row, never `now()`. A hold's `expires_at` is written from the
 * application clock (`ttlFrom` in holds.service) while this ran on the database clock, so the two
 * were only comparable while the machines agreed — and against a hosted database they do not. With
 * Postgres ~1.1s behind the API host, `now() + grace` landed *before* the expiry it was meant to
 * push out, and the grace SHORTENED the window instead of extending it. The buyer paid that
 * difference: `extended_once` is spent either way, so there is no second chance to get it right.
 *
 * Adding to the stored expiry makes the arithmetic monotonic by construction — the window can only
 * ever move forward — and it is what "+7 minutes" in FR-010 says on its face.
 */
export async function extendReservationOnce(
  client: pg.PoolClient,
  id: number,
  graceMs: number,
  absoluteMs: number,
): Promise<ReservationRow | null> {
  const { rows } = await client.query<ReservationRow>(
    `UPDATE reservations
        SET expires_at = LEAST(expires_at + ($2::bigint * interval '1 millisecond'),
                               created_at + ($3::bigint * interval '1 millisecond')),
            extended_once = true
      WHERE id = $1 AND status = 'active' AND extended_once = false
      RETURNING id, user_id, showtime_id, status, expires_at, created_at, extended_once,
               expires_at <= now() AS expired`,
    [id, graceMs, absoluteMs],
  );
  return rows[0] ?? null;
}

// ---- Reservation items ----------------------------------------------------

export async function addSeatItems(
  client: pg.PoolClient,
  reservationId: number,
  seats: SeatRow[],
): Promise<void> {
  for (const seat of seats) {
    await client.query(
      `INSERT INTO reservation_items (reservation_id, ticket_tier_id, showtime_seat_id, quantity, unit_price_amount)
       VALUES ($1, $2, $3, 1, $4)
       ON CONFLICT (reservation_id, showtime_seat_id) DO NOTHING`,
      [reservationId, seat.ticket_tier_id, seat.id, seat.price_amount],
    );
  }
}

export async function removeSeatItems(
  client: pg.PoolClient,
  reservationId: number,
  seatIds: number[],
): Promise<void> {
  if (seatIds.length === 0) return;
  await client.query(
    `DELETE FROM reservation_items WHERE reservation_id = $1 AND showtime_seat_id = ANY($2::bigint[])`,
    [reservationId, seatIds],
  );
}

/** GA lines collapse onto one row per tier, so a reservation holds one quantity per tier. */
/**
 * Take quantity back off a general-admission line, deleting it when it reaches zero.
 *
 * The counterpart to `upsertGaItem`, which only ever adds. Without it a buyer could raise a GA
 * quantity but never lower it, and the only way down would be cancelling the whole reservation —
 * which starts a new one with a fresh window and turns the stepper into a way to hold a tier
 * indefinitely (FR-006).
 *
 * Returns how much was actually removed, which is capped at what the line holds: a stale client
 * asking to drop 3 from a line of 2 gives back 2, never a negative reserved count.
 */
export async function reduceGaItem(
  client: pg.PoolClient,
  reservationId: number,
  tierId: number,
  quantity: number,
): Promise<number> {
  const { rows } = await client.query<{ quantity: number }>(
    `SELECT quantity FROM reservation_items
      WHERE reservation_id = $1 AND ticket_tier_id = $2 AND showtime_seat_id IS NULL
      FOR UPDATE`,
    [reservationId, tierId],
  );
  const held = rows[0]?.quantity ?? 0;
  const removed = Math.min(held, quantity);
  if (removed === 0) return 0;

  if (removed === held) {
    await client.query(
      `DELETE FROM reservation_items
        WHERE reservation_id = $1 AND ticket_tier_id = $2 AND showtime_seat_id IS NULL`,
      [reservationId, tierId],
    );
  } else {
    await client.query(
      `UPDATE reservation_items SET quantity = quantity - $3
        WHERE reservation_id = $1 AND ticket_tier_id = $2 AND showtime_seat_id IS NULL`,
      [reservationId, tierId, removed],
    );
  }
  return removed;
}

export async function upsertGaItem(
  client: pg.PoolClient,
  reservationId: number,
  tierId: number,
  quantity: number,
  unitPrice: number,
): Promise<void> {
  const { rowCount } = await client.query(
    `UPDATE reservation_items SET quantity = quantity + $3
      WHERE reservation_id = $1 AND ticket_tier_id = $2 AND showtime_seat_id IS NULL`,
    [reservationId, tierId, quantity],
  );
  if (rowCount === 0) {
    await client.query(
      `INSERT INTO reservation_items (reservation_id, ticket_tier_id, showtime_seat_id, quantity, unit_price_amount)
       VALUES ($1, $2, NULL, $3, $4)`,
      [reservationId, tierId, quantity, unitPrice],
    );
  }
}

export interface ItemRow {
  id: number;
  ticket_tier_id: number;
  tier_label: string;
  showtime_seat_id: number | null;
  seat_label: string | null;
  quantity: number;
  unit_price_amount: number;
}

export async function listItems(db: Db, reservationId: number): Promise<ItemRow[]> {
  const { rows } = await db.query<ItemRow>(
    `SELECT ri.id, ri.ticket_tier_id, tt.label AS tier_label, ri.showtime_seat_id,
            CASE WHEN ri.showtime_seat_id IS NULL THEN NULL
                 ELSE (se.row_label || se.seat_number::text) END AS seat_label,
            ri.quantity, ri.unit_price_amount
       FROM reservation_items ri
       JOIN ticket_tiers tt ON tt.id = ri.ticket_tier_id
       LEFT JOIN showtime_seats ss ON ss.id = ri.showtime_seat_id
       LEFT JOIN seats se ON se.id = ss.seat_id
      WHERE ri.reservation_id = $1
      ORDER BY ri.id`,
    [reservationId],
  );
  return rows;
}

/** Tickets currently held by this reservation: seat count (seated) + reserved quantity (GA). */
export async function countHeldTickets(db: Db, reservationId: number): Promise<number> {
  const { rows } = await db.query<{ total: number | null }>(
    `SELECT COALESCE(SUM(quantity), 0)::int AS total FROM reservation_items WHERE reservation_id = $1`,
    [reservationId],
  );
  return rows[0]?.total ?? 0;
}

export async function listSeatIds(db: Db, reservationId: number): Promise<number[]> {
  const { rows } = await db.query<{ showtime_seat_id: number }>(
    `SELECT showtime_seat_id FROM reservation_items
      WHERE reservation_id = $1 AND showtime_seat_id IS NOT NULL`,
    [reservationId],
  );
  return rows.map((r) => r.showtime_seat_id);
}

export async function listGaLines(
  db: Db,
  reservationId: number,
): Promise<{ ticket_tier_id: number; quantity: number }[]> {
  const { rows } = await db.query<{ ticket_tier_id: number; quantity: number }>(
    `SELECT ticket_tier_id, quantity FROM reservation_items
      WHERE reservation_id = $1 AND showtime_seat_id IS NULL`,
    [reservationId],
  );
  return rows;
}

export function toReservationView(row: ReservationRow, items: ItemRow[]): Reservation {
  const mapped: ReservationItem[] = items.map((i) => ({
    id: i.id,
    ticketTierId: i.ticket_tier_id,
    tierLabel: i.tier_label,
    showtimeSeatId: i.showtime_seat_id,
    seatLabel: i.seat_label,
    quantity: i.quantity,
    unitPriceAmount: i.unit_price_amount,
  }));

  return {
    id: row.id,
    showtimeId: row.showtime_id,
    status: row.status,
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    extendedOnce: row.extended_once,
    items: mapped,
    // Whole VND đồng (D1/STD-03) — priced at hold time, never recomputed from the live tier.
    totalAmount: mapped.reduce((sum, i) => sum + i.quantity * i.unitPriceAmount, 0),
  };
}

// ---- Sweep ----------------------------------------------------------------

/** Active reservations whose window has passed — the sweep's work list (REL-02, R-3). */
export async function findExpiredActive(db: Db = pool, limit = 200): Promise<ReservationRow[]> {
  const { rows } = await db.query<ReservationRow>(
    `SELECT id, user_id, showtime_id, status, expires_at, created_at, extended_once,
            expires_at <= now() AS expired
       FROM reservations
      WHERE status = 'active' AND expires_at <= now()
      ORDER BY expires_at
      LIMIT $1`,
    [limit],
  );
  return rows;
}
