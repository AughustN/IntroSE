import { pool } from '../../src/db/pool.js';
import * as seed from './catalogSeed.js';
import { registerUser } from './authFixture.js';

// Fixtures for the waitlist tests (011, UC-17). The interesting shapes are all about *absence* of
// stock, which the holds fixtures never needed: a tier with nothing left, a seated showtime with no
// free seat, and — the case the join route used to get wrong — one of each on the same showtime.

/**
 * Far enough out that the queue is open (`WAITLIST_CUTOFF_HOURS` = 24).
 *
 * `seedShowtime` defaults to exactly 24 hours, which lands *on* the cutoff: every queue seeded that
 * way is closed before the test begins, and the case under test never runs. Three days is simply
 * unambiguous; tests about the cutoff itself move their showtime deliberately.
 */
const OUTSIDE_CUTOFF_MS = 3 * 24 * 60 * 60 * 1000;

export interface MixedGaFixture {
  eventId: number;
  showtimeId: number;
  /** Exhausted: `sold_quantity` has reached `total_quantity`. */
  soldOutTierId: number;
  /** Still selling, on the same showtime. */
  sellingTierId: number;
}

/**
 * One general-admission showtime carrying a sold-out tier beside a tier that still sells.
 *
 * This is the fixture the whole scope rule turns on (FR-002): the sold-out tier must be joinable
 * while its sibling is not, which the showtime-wide availability test could never express.
 */
export async function seedMixedGaShowtime(): Promise<MixedGaFixture> {
  const org = await seed.seedOrganizer(await seed.seedUser());
  const venue = await seed.seedVenue(await seed.seedUser());
  const ev = await seed.seedEvent({ organizerId: org, eventType: 'general_admission' });
  const showtimeId = await seed.seedShowtime(ev.id, venue, OUTSIDE_CUTOFF_MS);
  const soldOutTierId = await seed.seedTier(showtimeId, { label: 'Hạng A', total: 2, sold: 2 });
  const sellingTierId = await seed.seedTier(showtimeId, { label: 'Hạng B', total: 5, sold: 1 });
  return { eventId: ev.id, showtimeId, soldOutTierId, sellingTierId };
}

export interface SoldOutGaFixture {
  eventId: number;
  showtimeId: number;
  tierId: number;
}

/** A general-admission showtime whose only tier is exhausted — so the showtime as a whole is too. */
export async function seedSoldOutGaShowtime(total = 2): Promise<SoldOutGaFixture> {
  const org = await seed.seedOrganizer(await seed.seedUser());
  const venue = await seed.seedVenue(await seed.seedUser());
  const ev = await seed.seedEvent({ organizerId: org, eventType: 'general_admission' });
  const showtimeId = await seed.seedShowtime(ev.id, venue, OUTSIDE_CUTOFF_MS);
  const tierId = await seed.seedTier(showtimeId, { total, sold: total });
  return { eventId: ev.id, showtimeId, tierId };
}

export interface SoldOutSeatedFixture {
  eventId: number;
  showtimeId: number;
  tierId: number;
  seatIds: number[];
}

/**
 * A seated showtime with every seat `sold`.
 *
 * Its tier is uncapped (`total_quantity IS NULL`), which is how seated tiers are seeded everywhere
 * else — so "sold out" here can only be answered from the seat rows, which is the branch of the
 * availability judgement the general-admission fixtures never reach.
 */
export async function seedSoldOutSeated(seatCount = 2): Promise<SoldOutSeatedFixture> {
  const org = await seed.seedOrganizer(await seed.seedUser());
  const venue = await seed.seedVenue(await seed.seedUser());
  const layout = (
    await pool.query(
      `INSERT INTO venue_layouts (venue_id, name, status) VALUES ($1, 'Sơ đồ mặc định', 'ready') RETURNING id`,
      [venue],
    )
  ).rows[0].id;
  const section = (
    await pool.query(`INSERT INTO sections (layout_id, name) VALUES ($1, 'Khu A') RETURNING id`, [layout])
  ).rows[0].id;
  const ev = await seed.seedEvent({ organizerId: org, eventType: 'seated' });
  const showtimeId = await seed.seedShowtime(ev.id, venue, OUTSIDE_CUTOFF_MS);
  const tierId = await seed.seedTier(showtimeId, { label: 'VIP', total: null });

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
       VALUES ($1, $2, $3, 'sold', $4, 1200, 0, 'A', $5, 'Khu A') RETURNING id`,
      [showtimeId, seatId, tierId, 5000 + (i - 1) * 150, i],
    );
    seatIds.push(ss.rows[0].id);
  }

  return { eventId: ev.id, showtimeId, tierId, seatIds };
}

/**
 * A seated showtime with **capped tiers and no seat map at all** — the shape real data took.
 *
 * The catalog reads it as sold out, because a seated showtime's stock is its seat rows and there
 * are none. Anything that judges availability from tier counters instead reads four hundred
 * tickets in stock, offers a waitlist button on the page and then refuses the press.
 */
export async function seedSeatedWithoutSeatMap(tierCount = 2): Promise<SoldOutSeatedFixture> {
  const org = await seed.seedOrganizer(await seed.seedUser());
  const venue = await seed.seedVenue(await seed.seedUser());
  const ev = await seed.seedEvent({ organizerId: org, eventType: 'seated' });
  const showtimeId = await seed.seedShowtime(ev.id, venue, OUTSIDE_CUTOFF_MS);
  let tierId = 0;
  for (let i = 0; i < tierCount; i++) {
    tierId = await seed.seedTier(showtimeId, { label: `Hạng ${i + 1}`, total: 100, sold: 0 });
  }
  return { eventId: ev.id, showtimeId, tierId, seatIds: [] };
}

/** Free one seat again, as a cancellation or an expired hold would. */
export async function releaseSeat(showtimeSeatId: number): Promise<void> {
  await pool.query(`UPDATE showtime_seats SET status = 'available' WHERE id = $1`, [showtimeSeatId]);
}

/** Return `count` tickets to a general-admission tier, as a cancellation would. */
export async function releaseGaQuantity(tierId: number, count = 1): Promise<void> {
  await pool.query(`UPDATE ticket_tiers SET sold_quantity = GREATEST(sold_quantity - $2, 0) WHERE id = $1`, [
    tierId,
    count,
  ]);
}

export interface WaitlistRow {
  id: number;
  user_id: number;
  showtime_id: number;
  ticket_tier_id: number | null;
  status: string;
  joined_at: Date;
  notified_at: Date | null;
}

/** Every entry on a showtime, oldest first — the order the queue itself is read in. */
export async function getEntries(showtimeId: number): Promise<WaitlistRow[]> {
  const { rows } = await pool.query<WaitlistRow>(
    `SELECT id, user_id, showtime_id, ticket_tier_id, status, joined_at, notified_at
       FROM waitlists WHERE showtime_id = $1 ORDER BY joined_at, id`,
    [showtimeId],
  );
  return rows;
}

/**
 * Put `n` distinct accounts in one queue, oldest first.
 *
 * The rows are written directly rather than through the API because most callers want a *full*
 * queue as a precondition, and the API would refuse the eleventh — which is the thing under test,
 * not the setup. `joined_at` is spaced a second apart so the order is unambiguous: several rows
 * committed inside the same statement would otherwise share `now()` to the microsecond and leave
 * "earliest five" undefined.
 */
export async function fillWaitlist(
  showtimeId: number,
  tierId: number | null,
  n: number,
): Promise<Array<{ userId: number; entryId: number }>> {
  const out: Array<{ userId: number; entryId: number }> = [];
  for (let i = 0; i < n; i++) {
    const userId = await seed.seedUser();
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO waitlists (user_id, showtime_id, ticket_tier_id, joined_at)
       VALUES ($1, $2, $3, now() - (($4::int - $5::int) * interval '1 second')) RETURNING id`,
      [userId, showtimeId, tierId, n, i],
    );
    out.push({ userId, entryId: rows[0].id });
  }
  return out;
}

/** A queue of real, signed-in accounts — for the cases that then act through the API. */
export async function fillWaitlistWithSessions(
  showtimeId: number,
  tierId: number | null,
  n: number,
): Promise<Array<{ token: string; userId: number; entryId: number }>> {
  const out: Array<{ token: string; userId: number; entryId: number }> = [];
  for (let i = 0; i < n; i++) {
    const user = await registerUser();
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO waitlists (user_id, showtime_id, ticket_tier_id, joined_at)
       VALUES ($1, $2, $3, now() - (($4::int - $5::int) * interval '1 second')) RETURNING id`,
      [user.userId, showtimeId, tierId, n, i],
    );
    out.push({ token: user.token, userId: user.userId, entryId: rows[0].id });
  }
  return out;
}

/** Push a showtime into the past, as the passage of time would. */
export async function beginShowtime(showtimeId: number, agoMs = 60_000): Promise<void> {
  await pool.query(
    `UPDATE showtimes SET starts_at = now() - ($2::bigint * interval '1 millisecond') WHERE id = $1`,
    [showtimeId, agoMs],
  );
}

/** Move a showtime inside the 24-hour cutoff, still in the future. */
export async function enterCutoff(showtimeId: number, hoursAway = 6): Promise<void> {
  await pool.query(
    `UPDATE showtimes SET starts_at = now() + ($2::int * interval '1 hour') WHERE id = $1`,
    [showtimeId, hoursAway],
  );
}

/** Cancel a showtime, as an organizer calling off one occasion would. */
export async function cancelShowtime(showtimeId: number): Promise<void> {
  await pool.query(`UPDATE showtimes SET status = 'cancelled' WHERE id = $1`, [showtimeId]);
}

/**
 * Age every "we told you" stamp on a queue, so the next release is outside the re-notify cooldown.
 *
 * Tests that fire two releases back to back are seconds apart, which the cooldown is there to
 * silence. Ageing the stamp is the honest way to say "some time passed" without a real wait.
 */
export async function ageNotifications(showtimeId: number, minutes = 30): Promise<void> {
  await pool.query(
    `UPDATE waitlists SET notified_at = notified_at - ($2::int * interval '1 minute')
      WHERE showtime_id = $1 AND notified_at IS NOT NULL`,
    [showtimeId, minutes],
  );
}

/**
 * The notifications one account can **read in the app**, newest first.
 *
 * `channel = 'in_app'` matters: `enqueue` writes every message twice, once per channel, so a count
 * without this filter is double what any reader will ever see.
 */
export async function getNotifications(userId: number): Promise<
  Array<{ id: number; type: string; event_id: number | null; read_at: Date | null }>
> {
  const { rows } = await pool.query(
    `SELECT id, type, event_id, read_at FROM notifications
      WHERE user_id = $1 AND channel = 'in_app' ORDER BY id DESC`,
    [userId],
  );
  return rows;
}
