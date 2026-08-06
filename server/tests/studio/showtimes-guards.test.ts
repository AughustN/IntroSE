import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { api, auth, makeOtherOrganizer, makeSeatedStudio, makeStudio } from "./helpers.js";

/**
 * Showtime editing guards (US2, UC-23 A2).
 *
 * Opening the edit surface without these would be worse than leaving it closed. Each case asserts the
 * refusal AND that the thing being protected — a reservation, a sale — is untouched afterwards.
 */

const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();

async function reservationSnapshot(showtimeId: number) {
  const { rows } = await pool.query(
    `SELECT r.id, r.status, r.expires_at, ri.quantity, ri.unit_price_amount
       FROM reservations r JOIN reservation_items ri ON ri.reservation_id = r.id
      WHERE r.showtime_id = $1 ORDER BY r.id`,
    [showtimeId],
  );
  return rows;
}

async function seedLiveHold(showtimeId: number, tierId: number, userId: number): Promise<void> {
  const reservation = (
    await pool.query(
      `INSERT INTO reservations (user_id, showtime_id, status, expires_at)
       VALUES ($1, $2, 'active', now() + interval '7 minutes') RETURNING id`,
      [userId, showtimeId],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO reservation_items (reservation_id, ticket_tier_id, quantity, unit_price_amount)
     VALUES ($1, $2, 2, 100000)`,
    [reservation, tierId],
  );
  await pool.query(
    `UPDATE ticket_tiers SET reserved_quantity = reserved_quantity + 2 WHERE id = $1`,
    [tierId],
  );
}

describe("showtime editing guards", () => {
  it("reschedules a clean showtime to another future time (FR-012)", async () => {
    const s = await makeStudio();
    const when = iso(7 * 86_400_000);
    const res = await api()
      .patch(`/api/organizer/showtimes/${s.showtimeId}`)
      .set(auth(s.token))
      .send({ startsAt: when })
      .expect(200);
    expect(new Date(res.body.startsAt).toISOString()).toBe(when);
  });

  it("refuses a reschedule into the past (FR-012)", async () => {
    const s = await makeStudio();
    const res = await api()
      .patch(`/api/organizer/showtimes/${s.showtimeId}`)
      .set(auth(s.token))
      .send({ startsAt: iso(-3_600_000) })
      .expect(400);
    expect(res.body.error).toBe("starts_at_in_past");
  });

  it.each([["cancelled"], ["finished"]])(
    "refuses any edit of a %s showtime (FR-013)",
    async (status) => {
      const s = await makeStudio();
      await pool.query(`UPDATE showtimes SET status = $2 WHERE id = $1`, [s.showtimeId, status]);

      const patched = await api()
        .patch(`/api/organizer/showtimes/${s.showtimeId}`)
        .set(auth(s.token))
        .send({ startsAt: iso(86_400_000) })
        .expect(409);
      expect(patched.body.error).toBe("showtime_started");

      const deleted = await api()
        .delete(`/api/organizer/showtimes/${s.showtimeId}`)
        .set(auth(s.token))
        .expect(409);
      expect(deleted.body.error).toBe("showtime_started");
    },
  );

  it("refuses any edit of a showtime that has already started (FR-013)", async () => {
    const s = await makeStudio();
    await pool.query(`UPDATE showtimes SET starts_at = now() - interval '1 hour' WHERE id = $1`, [
      s.showtimeId,
    ]);
    const res = await api()
      .patch(`/api/organizer/showtimes/${s.showtimeId}`)
      .set(auth(s.token))
      .send({ startsAt: iso(86_400_000) })
      .expect(409);
    expect(res.body.error).toBe("showtime_started");
  });

  it("refuses to delete a showtime with a sold ticket, pointing at cancellation (FR-014)", async () => {
    const s = await makeStudio({ sold: 4 });
    const res = await api()
      .delete(`/api/organizer/showtimes/${s.showtimeId}`)
      .set(auth(s.token))
      .expect(409);

    expect(res.body.error).toBe("showtime_has_sales");
    expect(res.body.details).toMatchObject({ sold: 4 });
    expect(
      (await pool.query(`SELECT 1 FROM showtimes WHERE id = $1`, [s.showtimeId])).rows,
    ).toHaveLength(1);
  });

  it("refuses to delete a showtime with a live hold and leaves the reservation byte-identical (FR-015, SC-006)", async () => {
    const s = await makeStudio();
    await seedLiveHold(s.showtimeId, s.tierId, s.userId);
    const before = await reservationSnapshot(s.showtimeId);

    const res = await api()
      .delete(`/api/organizer/showtimes/${s.showtimeId}`)
      .set(auth(s.token))
      .expect(409);
    expect(res.body.error).toBe("showtime_has_holds");

    expect(await reservationSnapshot(s.showtimeId)).toEqual(before);
  });

  it("refuses to relocate a showtime with a live hold, reservation untouched (FR-015, FR-016)", async () => {
    const s = await makeStudio();
    await seedLiveHold(s.showtimeId, s.tierId, s.userId);
    const before = await reservationSnapshot(s.showtimeId);
    const elsewhere = (
      await pool.query(
        `INSERT INTO venues (created_by, name, city, raw_address) VALUES ($1, 'Nơi khác', 'Hà Nội', 'X') RETURNING id`,
        [s.userId],
      )
    ).rows[0].id;

    const res = await api()
      .patch(`/api/organizer/showtimes/${s.showtimeId}`)
      .set(auth(s.token))
      .send({ venueId: elsewhere })
      .expect(409);
    expect(res.body.error).toBe("showtime_has_holds");
    expect(await reservationSnapshot(s.showtimeId)).toEqual(before);
  });

  it("relocates a clean showtime to another venue the organizer owns (FR-016)", async () => {
    const s = await makeStudio();
    const elsewhere = (
      await pool.query(
        `INSERT INTO venues (created_by, name, city, raw_address) VALUES ($1, 'Nơi khác', 'Hà Nội', 'X') RETURNING id`,
        [s.userId],
      )
    ).rows[0].id;

    const res = await api()
      .patch(`/api/organizer/showtimes/${s.showtimeId}`)
      .set(auth(s.token))
      .send({ venueId: elsewhere })
      .expect(200);
    expect(res.body.venueId).toBe(elsewhere);
  });

  it("refuses to relocate a seated showtime that already has a bookable map, pointing at 005 (FR-016)", async () => {
    const s = await makeSeatedStudio();
    const elsewhere = (
      await pool.query(
        `INSERT INTO venues (created_by, name, city, raw_address) VALUES ($1, 'Nơi khác', 'Hà Nội', 'X') RETURNING id`,
        [s.userId],
      )
    ).rows[0].id;

    const res = await api()
      .patch(`/api/organizer/showtimes/${s.showtimeId}`)
      .set(auth(s.token))
      .send({ venueId: elsewhere })
      .expect(409);
    expect(res.body.error).toBe("seat_map_locks_venue");
    expect(res.body.message).toContain("sơ đồ");
  });

  it("refuses a venue the caller does not own (FR-017)", async () => {
    const s = await makeStudio();
    const other = await makeOtherOrganizer();

    const res = await api()
      .patch(`/api/organizer/showtimes/${s.showtimeId}`)
      .set(auth(s.token))
      .send({ venueId: other.venueId })
      .expect(403);
    expect(res.body.error).toBe("not_owner");
  });

  it("deletes a clean showtime (FR-013 happy path)", async () => {
    const s = await makeStudio();
    await api().delete(`/api/organizer/showtimes/${s.showtimeId}`).set(auth(s.token)).expect(200);
    expect(
      (await pool.query(`SELECT 1 FROM showtimes WHERE id = $1`, [s.showtimeId])).rows,
    ).toHaveLength(0);
  });
});
