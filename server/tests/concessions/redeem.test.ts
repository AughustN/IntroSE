import request from "supertest";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { checkout } from "../../src/modules/payments/wallet.service.js";
import { app } from "../helpers/app.js";
import {
  bearer,
  makeAdmin,
  makeApprovedOrganizer,
  registerUser,
} from "../helpers/authFixture.js";
import * as seed from "../helpers/catalogSeed.js";

/*
 * Feature 014 US3a — redeeming the snack voucher at the counter.
 *
 * One scan hands over every line of the order; a rescan is a read, not an error; and a scanner
 * must never become an oracle: an unknown code and ANOTHER organizer's code are answered with the
 * same body, so a stranger's voucher cannot be probed into existence.
 */

const redeem = (token: string, code: string) =>
  request(app).post("/api/checkin/concessions/redeem").set(bearer(token)).send({ code });

/** A visible event with its approved organizer, plus one PAID order carrying snack lines. */
async function seedPaidOrder(opts: { price?: number } = {}) {
  const organizerUser = await registerUser();
  const organizerId = await makeApprovedOrganizer(organizerUser.userId);
  const venue = await seed.seedVenue(organizerUser.userId);
  const event = await seed.seedEvent({ organizerId });
  const showtimeId = await seed.seedShowtime(event.id, venue);
  await seed.seedTier(showtimeId, { total: 50, price: 250_000 });

  const buyer = await registerUser();
  await pool.query(
    `INSERT INTO wallets (user_id, balance_amount) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET balance_amount = EXCLUDED.balance_amount`,
    [buyer.userId, 5_000_000],
  );
  const reservation = await request(app)
    .post("/api/reservations")
    .set(bearer(buyer.token))
    .send({ showtimeId, ticketTierId: (await pool.query<{ id: number }>(`SELECT id FROM ticket_tiers WHERE showtime_id = $1`, [showtimeId])).rows[0].id, quantity: 1 })
    .expect(201);

  const { rows: item } = await pool.query<{ id: number }>(
    `INSERT INTO concession_items (event_id, label, price_amount) VALUES ($1, 'Bắp rang bơ', $2) RETURNING id`,
    [event.id, opts.price ?? 50_000],
  );
  await request(app)
    .put(`/api/reservations/${reservation.body.id}/concessions`)
    .set(bearer(buyer.token))
    .send({ items: [{ concessionItemId: item[0].id, quantity: 2 }] })
    .expect(200);

  const order = await checkout(buyer.userId, reservation.body.id);
  const voucher = await pool.query<{ code: string; id: number }>(
    `SELECT code, id FROM concession_vouchers WHERE order_id = $1`,
    [order.id],
  );
  return { organizerUser, buyer, eventId: event.id, orderId: order.id, voucher: voucher.rows[0] };
}

describe("POST /api/checkin/concessions/redeem", () => {
  it("hands over every line on the first scan and marks the voucher redeemed", async () => {
    const s = await seedPaidOrder();

    const res = await redeem(s.organizerUser.token, s.voucher.code).expect(200);

    expect(res.body.already).toBe(false);
    expect(res.body.orderId).toBe(s.orderId);
    expect(res.body.lines).toEqual([
      { label: "Bắp rang bơ", quantity: 2, unitPriceAmount: 50_000 },
    ]);
    expect(res.body.buyerName).toBeTruthy();

    const { rows } = await pool.query<{ status: string }>(
      `SELECT status FROM concession_vouchers WHERE id = $1`,
      [s.voucher.id],
    );
    expect(rows[0].status).toBe("redeemed");
  });

  it("answers a rescan with already:true and mutates nothing", async () => {
    const s = await seedPaidOrder();
    await redeem(s.organizerUser.token, s.voucher.code).expect(200);

    const before = await pool.query<{ redeemed_at: Date; redeemed_by: number | null }>(
      `SELECT redeemed_at, redeemed_by FROM concession_vouchers WHERE id = $1`,
      [s.voucher.id],
    );
    const res = await redeem(s.organizerUser.token, s.voucher.code).expect(200);

    expect(res.body.already).toBe(true);
    const after = await pool.query<{ redeemed_at: Date; redeemed_by: number | null }>(
      `SELECT redeemed_at, redeemed_by FROM concession_vouchers WHERE id = $1`,
      [s.voucher.id],
    );
    expect(after.rows[0].redeemed_at?.toISOString()).toBe(
      before.rows[0].redeemed_at?.toISOString(),
    );
    expect(after.rows[0].redeemed_by).toBe(before.rows[0].redeemed_by);
  });

  it("answers unknown codes and another organizer's codes identically", async () => {
    const s = await seedPaidOrder();
    const stranger = await registerUser();
    await makeApprovedOrganizer(stranger.userId);

    const unknown = await redeem(s.organizerUser.token, "8f3c0000-0000-4000-8000-000000000000");
    const foreign = await redeem(stranger.token, s.voucher.code);

    expect(unknown.status).toBe(404);
    expect(foreign.status).toBe(404);
    expect(unknown.body).toEqual(foreign.body);
    expect(unknown.body.error).toBe("concession_voucher_not_found");

    // And the voucher was not touched by the refused scan.
    const { rows } = await pool.query<{ status: string }>(
      `SELECT status FROM concession_vouchers WHERE id = $1`,
      [s.voucher.id],
    );
    expect(rows[0].status).toBe("unredeemed");
  });

  it("lets an admin redeem a voucher outside their own events", async () => {
    const s = await seedPaidOrder();
    const admin = await registerUser();
    await makeAdmin(admin.userId);

    const res = await redeem(admin.token, s.voucher.code).expect(200);
    expect(res.body.already).toBe(false);
  });

  it("refuses a voided voucher with voucher_void", async () => {
    const s = await seedPaidOrder();
    await pool.query(`UPDATE concession_vouchers SET status = 'void' WHERE id = $1`, [
      s.voucher.id,
    ]);

    const res = await redeem(s.organizerUser.token, s.voucher.code);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("voucher_void");
  });

  it("refuses a scanner who is not an organizer at all", async () => {
    const s = await seedPaidOrder();
    const plain = await registerUser();

    const res = await redeem(plain.token, s.voucher.code).expect(403);
    expect(res.body.error).toBe("forbidden");
  });
});
