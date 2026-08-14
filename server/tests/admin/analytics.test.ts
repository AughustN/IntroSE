import request from "supertest";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { app } from "../helpers/app.js";
import { bearer, registerUser } from "../helpers/authFixture.js";
import { adminSession, seedSale } from "../helpers/salesSeed.js";

/*
 * The console's numbers (UC-31, UC-32).
 *
 * Every figure here used to be computed in the browser from the viewer's own booking history, so
 * two admins signed in at once read two different revenues and neither matched the database. These
 * cases pin the arithmetic to rows.
 */

const asAdmin = (token: string, path: string) => request(app).get(path).set(bearer(token));

describe("platform overview (UC-32)", () => {
  it("counts money and volume from paid, unvoided tickets", async () => {
    const sale = await seedSale({ quantity: 3, price: 200_000 });
    const admin = await adminSession();

    const res = await asAdmin(admin.token, "/api/admin/overview").expect(200);

    expect(res.body.ticketsSold30d).toBe(3);
    expect(res.body.revenue30d).toBe(600_000);
    // A day per calendar day, present even where nothing sold — a chart drawn only from days with
    // orders spaces a quiet week like a busy one.
    expect(res.body.revenueByDay).toHaveLength(30);
    expect(res.body.revenueByDay.at(-1).amount).toBe(600_000);
    expect(sale.barcodes).toHaveLength(3);
  });

  it("drops a refunded ticket from revenue without a second subtraction", async () => {
    const sale = await seedSale({ quantity: 2, price: 300_000 });
    const admin = await adminSession();

    // Cancelling a ticket voids it, which is the only trace a refund leaves in `tickets`.
    await pool.query(
      `UPDATE tickets SET qr_status = 'void' WHERE order_id = $1 AND barcode_value = $2`,
      [sale.orderId, sale.barcodes[0]],
    );

    const res = await asAdmin(admin.token, "/api/admin/overview").expect(200);

    expect(res.body.ticketsSold30d).toBe(1);
    expect(res.body.revenue30d).toBe(300_000);
  });

  it("lists what is waiting, oldest first, across all three queues", async () => {
    const seller = await seedSale();
    await pool.query(`UPDATE events SET moderation_status = 'pending_review' WHERE id = $1`, [
      seller.eventId,
    ]);
    const admin = await adminSession();

    const res = await asAdmin(admin.token, "/api/admin/overview").expect(200);

    expect(res.body.pendingEvents).toBeGreaterThanOrEqual(1);
    expect(res.body.attention.some((item: { kind: string }) => item.kind === "event")).toBe(true);
  });

  it("refuses an ordinary account", async () => {
    const user = await registerUser();
    await request(app).get("/api/admin/overview").set(bearer(user.token)).expect(403);
  });
});

describe("revenue by event (UC-32 step 3)", () => {
  it("groups sales by event and totals them", async () => {
    const sale = await seedSale({ quantity: 2, price: 150_000 });
    const admin = await adminSession();

    const res = await asAdmin(admin.token, "/api/admin/analytics").expect(200);

    const row = res.body.rows.find((item: { eventId: number }) => item.eventId === sale.eventId);
    expect(row.tickets).toBe(2);
    expect(row.revenue).toBe(300_000);
    expect(row.checkedIn).toBe(0);
    expect(res.body.totals.revenue).toBeGreaterThanOrEqual(300_000);
  });

  it("honours the category filter", async () => {
    const sale = await seedSale();
    const admin = await adminSession();

    // Every seeded event lands in the same category; asking for a different one must return nothing
    // rather than everything, which is what a silently-ignored filter would do.
    const res = await asAdmin(admin.token, "/api/admin/analytics?category=khong-ton-tai").expect(
      200,
    );

    expect(res.body.rows).toHaveLength(0);
    expect(res.body.totals.tickets).toBe(0);
    expect(sale.eventId).toBeGreaterThan(0);
  });

  it("refuses a malformed date rather than guessing one", async () => {
    const admin = await adminSession();
    const res = await asAdmin(admin.token, "/api/admin/analytics?from=hom-qua");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_failed");
  });
});

describe("orders and the wallet ledger", () => {
  it("finds an order by the buyer’s e-mail", async () => {
    const sale = await seedSale({ quantity: 2, price: 120_000 });
    const admin = await adminSession();

    const res = await asAdmin(
      admin.token,
      `/api/admin/orders?q=${encodeURIComponent(sale.buyer.email)}`,
    ).expect(200);

    expect(res.body.total).toBe(1);
    expect(res.body.rows[0].tickets).toBe(2);
    expect(res.body.rows[0].total).toBe(240_000);
    expect(res.body.rows[0].paymentStatus).toBe("paid");
  });

  it("counts voided tickets beside the live ones, not instead of them", async () => {
    const sale = await seedSale({ quantity: 2 });
    await pool.query(`UPDATE tickets SET qr_status = 'void' WHERE barcode_value = $1`, [
      sale.barcodes[0],
    ]);
    const admin = await adminSession();

    const res = await asAdmin(admin.token, `/api/admin/orders?q=${sale.buyer.email}`).expect(200);

    expect(res.body.rows[0].tickets).toBe(1);
    expect(res.body.rows[0].voidTickets).toBe(1);
  });

  it("shows the purchase on the wallet ledger with its order attached", async () => {
    const sale = await seedSale({ quantity: 1, price: 400_000 });
    const admin = await adminSession();

    const res = await asAdmin(admin.token, "/api/admin/wallet-transactions?kind=purchase").expect(
      200,
    );

    const row = res.body.find((item: { userEmail: string }) => item.userEmail === sale.buyer.email);
    expect(row.amount).toBeLessThan(0);
    expect(Math.abs(row.amount)).toBe(400_000);
    expect(row.orderCode).toBeTruthy();
  });
});
