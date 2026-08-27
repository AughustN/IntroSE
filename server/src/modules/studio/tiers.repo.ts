import type pg from "pg";
import type { Db } from "../../db/pool.js";
import { pool } from "../../db/pool.js";

/**
 * Reads behind the tier lifecycle (feature 006).
 *
 * The important one is `lockTier`: it takes the SAME row lock feature 003 takes before moving
 * `reserved_quantity`, which is what makes the capacity floor (FR-004) true under contention. Either
 * a hold commits first and the capacity change sees it and refuses, or the capacity change commits
 * first and the hold's own remaining check refuses it. There is no interleaving in which both
 * succeed, and no second locking mechanism to deadlock against.
 */

export interface TierRow {
  id: number;
  showtime_id: number;
  label: string;
  price_amount: number;
  total_quantity: number | null;
  sold_quantity: number;
  reserved_quantity: number;
  category_id: number | null;
  archived_at: Date | null;
}

export interface TierContext extends TierRow {
  event_id: number;
  event_type: "general_admission" | "seated";
  event_status: string;
  owner_user_id: number;
}

const TIER_COLUMNS = `tt.id, tt.showtime_id, tt.label, tt.price_amount, tt.total_quantity,
                      tt.sold_quantity, tt.reserved_quantity, tt.category_id, tt.archived_at`;

/** The tier plus everything the guards need: which event owns it, its type, and whose it is. */
export async function tierContext(tierId: number, db: Db = pool): Promise<TierContext | null> {
  const { rows } = await db.query<TierContext>(
    `SELECT ${TIER_COLUMNS}, e.id AS event_id, e.event_type, e.status AS event_status, o.user_id AS owner_user_id
       FROM ticket_tiers tt
       JOIN showtimes s ON s.id = tt.showtime_id
       JOIN events e ON e.id = s.event_id
       JOIN organizers o ON o.id = e.organizer_id
      WHERE tt.id = $1`,
    [tierId],
  );
  return rows[0] ?? null;
}

/** Lock the tier row for the duration of the caller's transaction (FR-004, R-3). */
export async function lockTier(client: pg.PoolClient, tierId: number): Promise<TierRow | null> {
  const { rows } = await client.query<TierRow>(
    `SELECT ${TIER_COLUMNS} FROM ticket_tiers tt WHERE tt.id = $1 FOR UPDATE`,
    [tierId],
  );
  return rows[0] ?? null;
}

/** Serialize operations that increase the active-tier count for ONE showtime. */
export async function lockTierLimit(client: pg.PoolClient, showtimeId: number): Promise<void> {
  // A dedicated transaction lock avoids adding a showtime↔tier row-lock ordering dependency to
  // holds, chart application and deletion. Both add and restore must take it before counting.
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext('studio:active-tier-limit'), $1::int)`,
    [showtimeId],
  );
}

/** Active tiers only — archived ones do not consume a slot (FR-002, FR-006). */
export async function activeTierCount(showtimeId: number, db: Db = pool): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ticket_tiers WHERE showtime_id = $1 AND archived_at IS NULL`,
    [showtimeId],
  );
  return rows[0].n;
}

export interface TierInventory {
  sold: number;
  held: number;
  /** null = unbounded (a GA tier with no capacity set). */
  remaining: number | null;
}

/**
 * Live sold / held / remaining for every tier of a showtime, in ONE query, branching on event type.
 *
 *   general admission → the tier's own counters, which feature 003 and checkout maintain;
 *   seated            → counts over `showtime_seats` grouped by tier and status.
 *
 * The seated branch needs no new index: `idx_showtime_seats_showtime(showtime_id, status)` covers it
 * and a showtime is bounded at 2,000 seats by feature 005's ceiling.
 */
export async function tierInventory(
  showtimeId: number,
  eventType: "general_admission" | "seated",
  db: Db = pool,
): Promise<Map<number, TierInventory>> {
  const out = new Map<number, TierInventory>();

  if (eventType === "general_admission") {
    const { rows } = await db.query<{
      id: number;
      sold: number;
      held: number;
      total: number | null;
    }>(
      `SELECT id, sold_quantity AS sold, reserved_quantity AS held, total_quantity AS total
         FROM ticket_tiers WHERE showtime_id = $1`,
      [showtimeId],
    );
    for (const r of rows) {
      out.set(r.id, {
        sold: r.sold,
        held: r.held,
        remaining: r.total === null ? null : r.total - r.sold - r.held,
      });
    }
    return out;
  }

  const { rows } = await db.query<{ id: number; sold: number; held: number; available: number }>(
    `SELECT tt.id,
            count(*) FILTER (WHERE ss.status = 'sold')::int      AS sold,
            count(*) FILTER (WHERE ss.status = 'held')::int      AS held,
            count(*) FILTER (WHERE ss.status = 'available')::int AS available
       FROM ticket_tiers tt
       LEFT JOIN showtime_seats ss ON ss.ticket_tier_id = tt.id
      WHERE tt.showtime_id = $1
      GROUP BY tt.id`,
    [showtimeId],
  );
  for (const r of rows) out.set(r.id, { sold: r.sold, held: r.held, remaining: r.available });
  return out;
}

/** Sold + held for a single tier — the numbers a capacity refusal has to name (FR-004, FR-018). */
export async function tierCommitted(
  tier: TierRow,
  eventType: "general_admission" | "seated",
  db: Db = pool,
): Promise<{ sold: number; held: number }> {
  if (eventType === "general_admission") {
    return { sold: tier.sold_quantity, held: tier.reserved_quantity };
  }
  const { rows } = await db.query<{ sold: number; held: number }>(
    `SELECT count(*) FILTER (WHERE status = 'sold')::int AS sold,
            count(*) FILTER (WHERE status = 'held')::int AS held
       FROM showtime_seats WHERE ticket_tier_id = $1`,
    [tier.id],
  );
  return rows[0] ?? { sold: 0, held: 0 };
}

/** Does this tier still price any bookable seat? Deleting one that does belongs to feature 005. */
export async function tierHasSeats(tierId: number, db: Db = pool): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM showtime_seats WHERE ticket_tier_id = $1 LIMIT 1`,
    [tierId],
  );
  return rows.length > 0;
}

export async function listTiers(showtimeId: number, db: Db = pool): Promise<TierRow[]> {
  const { rows } = await db.query<TierRow>(
    `SELECT ${TIER_COLUMNS} FROM ticket_tiers tt WHERE tt.showtime_id = $1
      ORDER BY tt.archived_at NULLS FIRST, tt.price_amount`,
    [showtimeId],
  );
  return rows;
}

export async function showtimeEventType(
  showtimeId: number,
  db: Db = pool,
): Promise<{
  eventId: number;
  eventType: "general_admission" | "seated";
  ownerUserId: number;
  eventStatus: string;
} | null> {
  const { rows } = await db.query<{
    event_id: number;
    event_type: "general_admission" | "seated";
    owner_user_id: number;
    event_status: string;
  }>(
    `SELECT e.id AS event_id, e.event_type, e.status AS event_status, o.user_id AS owner_user_id
       FROM showtimes s JOIN events e ON e.id = s.event_id JOIN organizers o ON o.id = e.organizer_id
      WHERE s.id = $1`,
    [showtimeId],
  );
  const r = rows[0];
  return r
    ? {
        eventId: r.event_id,
        eventType: r.event_type,
        ownerUserId: r.owner_user_id,
        eventStatus: r.event_status,
      }
    : null;
}
