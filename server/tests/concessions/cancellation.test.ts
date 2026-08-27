import request from "supertest";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { checkout } from "../../src/modules/payments/wallet.service.js";
import { app } from "../helpers/app.js";
import { bearer, makeApprovedOrganizer, registerUser } from "../helpers/authFixture.js";
import * as seed from "../helpers/catalogSeed.js";

/*
 * Feature 014 US3b — an event cancellation settles its snack orders too.
 *
 * The buyer paid for tickets AND bắp nước in one debit, so the refund is one credit: the wallet
 * gains the ticket amounts plus Σ quantity × SNAPSHOT price (the price they actually paid, never
 * today's menu). Vouchers die with the show — a void voucher is how a later scan knows there is
 * nothing left to hand over.
 */

/** A visible event with one PAID order (N tickets + 2 snacks), like the buyer's receipt. */
async function seedPaidOrder(
  opts: {
    ticketPrice?: number;
    snackPrice?: number;
    quantity?: number;
    /** Showtime offset from now in ms. Defaults to 24h; pass 1h to land inside the door window. */
    offsetMs?: number;
  } = {},
) {
  const organizerUser = await registerUser();
  const organizerId = await makeApprovedOrganizer(organizerUser.userId);
  const venue = await seed.seedVenue(organizerUser.userId);
  const event = await seed.seedEvent({ organizerId });
  const showtimeId = await seed.seedShowtime(event.id, venue, opts.offsetMs ?? 86_400_000);
  const ticketPrice = opts.ticketPrice ?? 250_000;
  const tierId = await seed.seedTier(showtimeId, { total: 50, price: ticketPrice });
  const quantity = opts.quantity ?? 2;

  const buyer = await registerUser();
  await pool.query(
    `INSERT INTO wallets (user_id, balance_amount) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET balance_amount = EXCLUDED.balance_amount`,
    [buyer.userId, 5_000_000],
  );
  const reservation = await request(app)
    .post("/api/reservations")
    .set(bearer(buyer.token))
    .send({ showtimeId, ticketTierId: tierId, quantity })
    .expect(201);

  const snackPrice = opts.snackPrice ?? 50_000;
  const itemId = (
    await pool.query<{ id: number }>(
      `INSERT INTO concession_items (event_id, label, price_amount) VALUES ($1, 'Nước suối', $2) RETURNING id`,
      [event.id, snackPrice],
    )
  ).rows[0].id;
  await request(app)
    .put(`/api/reservations/${reservation.body.id}/concessions`)
    .set(bearer(buyer.token))
    .send({ items: [{ concessionItemId: itemId, quantity: 2 }] })
    .expect(200);

  // Charge was made at these prices; a later menu edit must not move this refund.
  const order = await checkout(buyer.userId, reservation.body.id);
  return {
    organizerUser,
    buyer,
    eventId: event.id,
    orderId: order.id,
    order,
    ticketPrice,
    snackPrice,
    quantity,
  };
}

const balanceOf = async (userId: number) =>
  (
    await pool.query<{ balance_amount: string }>(
      `SELECT balance_amount FROM wallets WHERE user_id = $1`,
      [userId],
    )
  ).rows[0].balance_amount;

describe("event cancellation settles concessions", () => {
  it("refunds tickets plus snapshot snack prices in one credit and voids the voucher", async () => {
    const s = await seedPaidOrder({ ticketPrice: 250_000, snackPrice: 50_000 });
    const before = Number(await balanceOf(s.buyer.userId));

    const res = await request(app)
      .post(`/api/organizer/events/${s.eventId}/cancel`)
      .set(bearer(s.organizerUser.token))
      .send({ reason: "Sự kiện bị hủy vì lý do bất khả kháng" })
      .expect(200);

    // Wallet delta: 2×250,000 vé + 2×50,000 nước — exact to the đồng.
    expect(Number(await balanceOf(s.buyer.userId)) - before).toBe(600_000);
    expect(res.body.refundedTickets).toBe(2);

    // Ledger: one 'refund' row per TICKET plus exactly ONE per-order row for the snacks.
    const ledger = await pool.query<{ kind: string; amount: number; order_id: number }>(
      `SELECT kind, amount, order_id FROM wallet_transactions wt
        JOIN wallets w ON w.id = wt.wallet_id
       WHERE w.user_id = $1 ORDER BY wt.id`,
      [s.buyer.userId],
    );
    const refundsForOrder = ledger.rows.filter((r) => Number(r.order_id) === Number(s.orderId));
    expect(refundsForOrder.filter((r) => r.kind === "purchase")).toHaveLength(1);
    const refundRows = refundsForOrder.filter((r) => r.kind === "refund");
    expect(refundRows).toHaveLength(3); // two tickets + one concession line-set
    expect(refundRows.reduce((sum, r) => sum + Number(r.amount), 0)).toBe(600_000);

    // And the voucher can never again promise snacks at a door that will not open.
    const voucher = await pool.query<{ status: string }>(
      `SELECT status FROM concession_vouchers WHERE order_id = $1`,
      [s.orderId],
    );
    expect(voucher.rows[0].status).toBe("void");
  });

  it("records the concession money in the cancellation audit entry", async () => {
    const s = await seedPaidOrder();

    await request(app)
      .post(`/api/organizer/events/${s.eventId}/cancel`)
      .set(bearer(s.organizerUser.token))
      .send({ reason: "Hủy do địa điểm không khả dụng" })
      .expect(200);

    const { rows } = await pool.query<{ detail: { refundedAmount?: number } }>(
      `SELECT detail FROM audit_logs WHERE action = 'event.cancel' AND target_id = $1
        ORDER BY id DESC LIMIT 1`,
      [s.eventId],
    );
    // 500,000 vé + 100,000 bắp nước — the log says what the cancellation actually cost.
    expect(rows[0].detail?.refundedAmount).toBe(600_000);
  });

  it("does not pay out twice when the settlement runs against an already-cancelled event", async () => {
    const s = await seedPaidOrder();
    await request(app)
      .post(`/api/organizer/events/${s.eventId}/cancel`)
      .set(bearer(s.organizerUser.token))
      .send({ reason: "Lần hủy đầu tiên" })
      .expect(200);

    const second = await request(app)
      .post(`/api/organizer/events/${s.eventId}/cancel`)
      .set(bearer(s.organizerUser.token))
      .send({ reason: "Lần gọi lại phải vô hại" })
      .expect(200);

    expect(second.body.refundedTickets).toBe(0);
    const ledger = await pool.query<{ amount: string }>(
      `SELECT amount FROM wallet_transactions wt
        JOIN wallets w ON w.id = wt.wallet_id
       WHERE w.user_id = $1 AND kind = 'refund'`,
      [s.buyer.userId],
    );
    expect(ledger.rows.reduce((sum, r) => sum + Number(r.amount), 0)).toBe(600_000); // unchanged
  });

  it("settles payment_status for an order whose ticket was already used at the door (E3)", async () => {
    // Showtime 1h out: check-in opens 6h before the start, yet the show is still upcoming when the
    // organizer cancels, so the concession refund runs against an order with NO refundable ticket.
    const s = await seedPaidOrder({ quantity: 1, offsetMs: 3_600_000 });
    const before = Number(await balanceOf(s.buyer.userId));
    const barcode = s.order.tickets[0].ticketCode;

    // The buyer already used the ticket at the door — the wallet must not get the ticket back.
    await request(app)
      .post("/api/organizer/tickets/check-in")
      .set(bearer(s.organizerUser.token))
      .send({ code: barcode })
      .expect(200);

    const res = await request(app)
      .post(`/api/organizer/events/${s.eventId}/cancel`)
      .set(bearer(s.organizerUser.token))
      .send({ reason: "Hủy sau khi khách đã vào cửa" })
      .expect(200);

    // The used ticket earns nothing back; only the unredeemed snacks (2×50,000) are paid out.
    expect(res.body.refundedTickets).toBe(0);
    expect(Number(await balanceOf(s.buyer.userId)) - before).toBe(100_000);

    // This order never entered the ticket-refund set (it has no unused ticket), yet its snack money
    // went back — so its payment_status must be re-decided from the tickets that survive, not left
    // stuck on 'paid'.
    const order = await pool.query<{ payment_status: string }>(
      `SELECT payment_status FROM orders WHERE id = $1`,
      [s.orderId],
    );
    expect(order.rows[0].payment_status).toBe("partially_refunded");
  });
});
