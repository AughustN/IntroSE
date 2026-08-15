import type pg from "pg";

/**
 * Clear reservation rows left behind by holds that have already lapsed (feature 006).
 *
 * Every delete path in this module is guarded on LIVE inventory — no sold tickets, no active holds.
 * That is not the same as "nothing references this row". `reservation_items.ticket_tier_id` and
 * `.showtime_seat_id` are plain foreign keys with no ON DELETE, so a reservation that expired days
 * ago still pins the tier it pointed at, and the delete fails at the database instead of succeeding.
 *
 * A reservation is not an order: it holds no money, and feature 003 is explicit that one which is
 * never converted simply expires with nothing to roll back. Removing those dead lines alongside the
 * thing they referenced is therefore safe.
 *
 * `converted` reservations are deliberately excluded. Those belong to a paid order (feature 004) and
 * are history, not scratch state. A converted reservation implies sold tickets, which every caller
 * has already refused on — so if one is somehow still present the foreign key will block the delete,
 * which is the correct outcome. We would rather fail loudly than quietly erase order history.
 */

const LIVE_STATUSES = "('active', 'converted')";

export type CleanupScope = "tier" | "showtime" | "event";

export async function clearLapsedReservationItems(
  client: pg.PoolClient,
  scope: CleanupScope,
  id: number,
): Promise<void> {
  const itemsByScope: Record<CleanupScope, string> = {
    tier: `DELETE FROM reservation_items ri
            USING reservations r
            WHERE ri.reservation_id = r.id
              AND ri.ticket_tier_id = $1
              AND r.status NOT IN ${LIVE_STATUSES}`,
    showtime: `DELETE FROM reservation_items ri
                USING reservations r
                WHERE ri.reservation_id = r.id
                  AND r.showtime_id = $1
                  AND r.status NOT IN ${LIVE_STATUSES}`,
    event: `DELETE FROM reservation_items ri
             USING reservations r
             JOIN showtimes s ON s.id = r.showtime_id
             WHERE ri.reservation_id = r.id
               AND s.event_id = $1
               AND r.status NOT IN ${LIVE_STATUSES}`,
  };
  await client.query(itemsByScope[scope], [id]);

  // A reservation row itself points at the showtime, so it has to go too once its items are gone.
  if (scope === "showtime") {
    await client.query(`DELETE FROM reservations WHERE showtime_id = $1 AND status NOT IN ${LIVE_STATUSES}`, [id]);
  } else if (scope === "event") {
    await client.query(
      `DELETE FROM reservations r
        USING showtimes s
        WHERE s.id = r.showtime_id AND s.event_id = $1 AND r.status NOT IN ${LIVE_STATUSES}`,
      [id],
    );
  }
}
