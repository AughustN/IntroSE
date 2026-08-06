import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { seedTier } from "../helpers/catalogSeed.js";
import { api, auth, makeStudio } from "./helpers.js";

/**
 * Deleting a tier, a showtime or an event is guarded on LIVE inventory (FR-007, FR-014/FR-015,
 * FR-020) — but `reservation_items.ticket_tier_id` is a plain foreign key with no ON DELETE, and a
 * reservation that expired days ago still has a row pointing at the tier.
 *
 * So "no live holds" is not the same as "nothing references this". Without
 * `reservations.cleanup.ts` every one of these deletes fails at the database with a 500 instead of
 * succeeding — which is what this case caught.
 *
 * All three run in ONE test on purpose: each needs several fixtures, and splitting them made the
 * per-test TRUNCATE race the still-settling writes of the previous case.
 */
describe("deletes survive reservations that have already lapsed", () => {
  /**
   * The state the TTL sweeper leaves behind: reservation marked expired and the quantity given back,
   * but its `reservation_items` row still pointing at the tier. Written directly rather than through
   * the hold API so the case stays about the DELETE, not about hold mechanics.
   */
  async function seedExpiredHold(showtimeId: number, tierId: number, userId: number): Promise<void> {
    const reservation = (
      await pool.query(
        `INSERT INTO reservations (user_id, showtime_id, status, expires_at)
         VALUES ($1, $2, 'expired', now() - interval '1 hour') RETURNING id`,
        [userId, showtimeId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO reservation_items (reservation_id, ticket_tier_id, quantity, unit_price_amount)
       VALUES ($1, $2, 2, 100000)`,
      [reservation, tierId],
    );
  }

  it("clears lapsed reservation lines when deleting a tier, a showtime and an event", async () => {
    // --- tier (FR-007) ---
    const a = await makeStudio();
    await seedTier(a.showtimeId, { label: "Còn lại" });
    await seedExpiredHold(a.showtimeId, a.tierId, a.userId);

    const tierRes = await api().delete(`/api/organizer/tiers/${a.tierId}`).set(auth(a.token));
    expect(tierRes.status).toBe(200);
    expect(tierRes.body.outcome).toBe("deleted");

    // --- showtime (FR-014, FR-015) ---
    const b = await makeStudio();
    await seedExpiredHold(b.showtimeId, b.tierId, b.userId);

    const showtimeRes = await api()
      .delete(`/api/organizer/showtimes/${b.showtimeId}`)
      .set(auth(b.token));
    expect(showtimeRes.status).toBe(200);
    expect(
      (await pool.query(`SELECT 1 FROM showtimes WHERE id = $1`, [b.showtimeId])).rows,
    ).toHaveLength(0);

    // --- event (FR-020) ---
    const c = await makeStudio({ moderation: "pending_review", status: "draft" });
    await seedExpiredHold(c.showtimeId, c.tierId, c.userId);

    const eventRes = await api().delete(`/api/organizer/events/${c.eventId}`).set(auth(c.token));
    expect(eventRes.status).toBe(204);
    expect(
      (await pool.query(`SELECT 1 FROM events WHERE id = $1`, [c.eventId])).rows,
    ).toHaveLength(0);

    // A converted reservation is never swept away by any of the above — that is order history.
    expect(
      (await pool.query(`SELECT 1 FROM reservations WHERE status = 'converted'`)).rows,
    ).toHaveLength(0);
  }, 30_000);
});
