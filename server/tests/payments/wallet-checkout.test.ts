import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../helpers/app.js";
import { bearer, registerUser } from "../helpers/authFixture.js";
import * as holds from "../helpers/holdsSeed.js";
import { pool } from "../../src/db/pool.js";
import { applyVnpayIpn, createTopup } from "../../src/modules/payments/wallet.service.js";

describe("wallet checkout (UC-02)", () => {
  it("accepts the unsigned public VNPay IPN request instead of an auth challenge", async () => {
    const response = await request(app).get("/api/payments/vnpay/ipn");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ RspCode: "97", Message: "Invalid signature" });
  });

  it("credits a successful VNPay top-up once even when its IPN is delivered twice", async () => {
    const user = await registerUser();
    const topup = await createTopup(user.userId, 500_000);

    const payload = {
      orderRef: topup.orderRef,
      amount: topup.amount,
      responseCode: "00",
      transactionStatus: "00",
      transactionNo: "12345",
    };
    expect(await applyVnpayIpn(payload)).toBe("paid");
    expect(await applyVnpayIpn(payload)).toBe("duplicate");

    const wallet = await pool.query(`SELECT balance_amount FROM wallets WHERE user_id = $1`, [
      user.userId,
    ]);
    const ledger = await pool.query(
      `SELECT amount FROM wallet_transactions WHERE payment_transaction_id = $1`,
      [topup.id],
    );
    expect(wallet.rows[0].balance_amount).toBe(500_000);
    expect(ledger.rows).toEqual([{ amount: 500_000 }]);
  });

  it("converts a held GA reservation to tickets and debits the wallet atomically", async () => {
    const fixture = await holds.seedGaShowtime(5, 200_000);
    const user = await registerUser();
    await pool.query(`UPDATE wallets SET balance_amount = 500_000 WHERE user_id = $1`, [
      user.userId,
    ]);

    const reservation = await request(app)
      .post("/api/reservations")
      .set(bearer(user.token))
      .send({ showtimeId: fixture.showtimeId, ticketTierId: fixture.tierId, quantity: 2 })
      .expect(201);
    const order = await request(app)
      .post("/api/checkout")
      .set(bearer(user.token))
      .send({ reservationId: reservation.body.id })
      .expect(201);

    expect(order.body.totalAmount).toBe(400_000);
    expect(order.body.tickets).toHaveLength(2);
    expect(
      new Set(order.body.tickets.map((ticket: { ticketCode: string }) => ticket.ticketCode)).size,
    ).toBe(2);
    expect(await holds.getTierCounts(fixture.tierId)).toMatchObject({ sold: 2, reserved: 0 });
    expect((await holds.getReservationRow(reservation.body.id)).status).toBe("converted");
    expect(
      (await pool.query(`SELECT balance_amount FROM wallets WHERE user_id = $1`, [user.userId]))
        .rows[0].balance_amount,
    ).toBe(100_000);
  });

  it("does not change inventory or reservation when the wallet balance is insufficient", async () => {
    const fixture = await holds.seedSeatedShowtime(1, 500_000);
    const user = await registerUser();
    const reservation = await request(app)
      .post("/api/reservations")
      .set(bearer(user.token))
      .send({ showtimeId: fixture.showtimeId, seatIds: fixture.seatIds })
      .expect(201);

    const response = await request(app)
      .post("/api/checkout")
      .set(bearer(user.token))
      .send({ reservationId: reservation.body.id });
    expect(response.status).toBe(422);
    expect(response.body.error).toBe("insufficient_wallet_balance");
    expect((await holds.getSeat(fixture.seatIds[0])).status).toBe("held");
    expect((await holds.getReservationRow(reservation.body.id)).status).toBe("active");
    expect((await pool.query(`SELECT count(*)::int AS count FROM orders`)).rows[0].count).toBe(0);
  });

  it("rejects checkout when moderation removes an event after the reservation is created", async () => {
    const fixture = await holds.seedGaShowtime(5, 200_000);
    const user = await registerUser();
    await pool.query(`UPDATE wallets SET balance_amount = 500_000 WHERE user_id = $1`, [
      user.userId,
    ]);
    const reservation = await request(app)
      .post("/api/reservations")
      .set(bearer(user.token))
      .send({ showtimeId: fixture.showtimeId, ticketTierId: fixture.tierId, quantity: 2 })
      .expect(201);
    await pool.query(`UPDATE events SET moderation_status = 'removed' WHERE id = $1`, [
      fixture.eventId,
    ]);

    const response = await request(app)
      .post("/api/checkout")
      .set(bearer(user.token))
      .send({ reservationId: reservation.body.id });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("event_unavailable");
    expect(
      (await pool.query(`SELECT balance_amount FROM wallets WHERE user_id = $1`, [user.userId]))
        .rows[0].balance_amount,
    ).toBe(500_000);
    expect((await pool.query(`SELECT count(*)::int AS count FROM orders`)).rows[0].count).toBe(0);
    expect((await pool.query(`SELECT count(*)::int AS count FROM tickets`)).rows[0].count).toBe(0);
    expect(await holds.getTierCounts(fixture.tierId)).toMatchObject({ sold: 0, reserved: 2 });
    expect((await holds.getReservationRow(reservation.body.id)).status).toBe("active");
  });

  it("rejects checkout when the showtime is cancelled after the reservation is created", async () => {
    const fixture = await holds.seedSeatedShowtime(1, 500_000);
    const user = await registerUser();
    await pool.query(`UPDATE wallets SET balance_amount = 500_000 WHERE user_id = $1`, [
      user.userId,
    ]);
    const reservation = await request(app)
      .post("/api/reservations")
      .set(bearer(user.token))
      .send({ showtimeId: fixture.showtimeId, seatIds: fixture.seatIds })
      .expect(201);
    await holds.cancelShowtime(fixture.showtimeId);

    const response = await request(app)
      .post("/api/checkout")
      .set(bearer(user.token))
      .send({ reservationId: reservation.body.id });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("event_unavailable");
    expect(
      (await pool.query(`SELECT balance_amount FROM wallets WHERE user_id = $1`, [user.userId]))
        .rows[0].balance_amount,
    ).toBe(500_000);
    expect((await pool.query(`SELECT count(*)::int AS count FROM orders`)).rows[0].count).toBe(0);
    expect((await pool.query(`SELECT count(*)::int AS count FROM tickets`)).rows[0].count).toBe(0);
    expect((await holds.getSeat(fixture.seatIds[0])).status).toBe("held");
    expect((await holds.getReservationRow(reservation.body.id)).status).toBe("active");
  });
});
