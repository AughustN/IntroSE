import request from "supertest";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { checkout } from "../../src/modules/payments/wallet.service.js";
import { app } from "../helpers/app.js";
import { bearer, makeApprovedOrganizer, registerUser } from "../helpers/authFixture.js";
import * as seed from "../helpers/catalogSeed.js";

/*
 * Feature 014 US1 — bắp nước bought WITH the tickets: one cart, one debit, one voucher.
 *
 * Every case here pins one of the invariants the money path must keep: the combined total is
 * exact to the đồng, a lapsed or ticket-less hold carries nothing, and a stopped item can never
 * turn into a charge.
 */

const putConcessions = (
  token: string,
  reservationId: number,
  items: { concessionItemId: number; quantity: number }[],
) =>
  request(app)
    .put(`/api/reservations/${reservationId}/concessions`)
    .set(bearer(token))
    .send({ items });

async function seedItem(eventId: number, label: string, price: number): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO concession_items (event_id, label, price_amount) VALUES ($1, $2, $3) RETURNING id`,
    [eventId, label, price],
  );
  return rows[0].id;
}

/** A visible GA event with one upcoming showtime + tier, an approved organizer and a funded buyer. */
async function seedScenario(opts: { balance?: number; price?: number } = {}) {
  const organizerUser = await registerUser();
  const organizerId = await makeApprovedOrganizer(organizerUser.userId);
  const venue = await seed.seedVenue(organizerUser.userId);
  const event = await seed.seedEvent({ organizerId });
  const showtimeId = await seed.seedShowtime(event.id, venue);
  const tierId = await seed.seedTier(showtimeId, { total: 50, price: opts.price ?? 250_000 });

  const buyer = await registerUser();
  await pool.query(
    `INSERT INTO wallets (user_id, balance_amount) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET balance_amount = EXCLUDED.balance_amount`,
    [buyer.userId, opts.balance ?? 5_000_000],
  );

  const reservation = await request(app)
    .post("/api/reservations")
    .set(bearer(buyer.token))
    .send({ showtimeId, ticketTierId: tierId, quantity: 2 })
    .expect(201);

  return {
    organizerUser,
    buyer,
    eventId: event.id,
    showtimeId,
    tierId,
    reservationId: reservation.body.id as number,
    ticketTotal: (opts.price ?? 250_000) * 2,
  };
}

describe("PUT /api/reservations/:id/concessions", () => {
  it("stores the cart at the item's current price and returns it with the combined total", async () => {
    const s = await seedScenario();
    const popcorn = await seedItem(s.eventId, "Bắp rang bơ", 50_000);
    const water = await seedItem(s.eventId, "Nước suối", 10_000);

    const res = await putConcessions(s.buyer.token, s.reservationId, [
      { concessionItemId: popcorn, quantity: 2 },
      { concessionItemId: water, quantity: 1 },
    ]).expect(200);

    expect(res.body.concessions).toHaveLength(2);
    // 2×250,000 vé + 2×50,000 bắp + 1×10,000 nước — exact to the đồng.
    expect(res.body.totalAmount).toBe(s.ticketTotal + 110_000);
  });

  it("caps a line at 10 units with the feature's own error code", async () => {
    const s = await seedScenario();
    const popcorn = await seedItem(s.eventId, "Bắp rang bơ", 50_000);

    const res = await putConcessions(s.buyer.token, s.reservationId, [
      { concessionItemId: popcorn, quantity: 11 },
    ]);

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("concession_quantity_limit");
  });

  it("refuses an item from another event and an empty id outright", async () => {
    const s = await seedScenario();
    const otherEvent = await seed.seedEvent({
      organizerId: await seed.seedOrganizer(await seed.seedUser()),
    });
    const foreignItem = await seedItem(otherEvent.id, "Món của sự kiện khác", 20_000);

    const wrongEvent = await putConcessions(s.buyer.token, s.reservationId, [
      { concessionItemId: foreignItem, quantity: 1 },
    ]);
    expect(wrongEvent.status).toBe(404);
    expect(wrongEvent.body.error).toBe("concession_unavailable");

    const unknown = await putConcessions(s.buyer.token, s.reservationId, [
      { concessionItemId: 999_999_999, quantity: 1 },
    ]);
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe("concession_unavailable");
  });

  it("answers a stranger's reservation with not_owner", async () => {
    const s = await seedScenario();
    const stranger = await registerUser();

    await request(app)
      .put(`/api/reservations/${s.reservationId}/concessions`)
      .set(bearer(stranger.token))
      .send({ items: [] })
      .expect(403);
  });

  it("drops stopped items from the cart view immediately", async () => {
    const s = await seedScenario();
    const water = await seedItem(s.eventId, "Nước suối", 10_000);
    await putConcessions(s.buyer.token, s.reservationId, [
      { concessionItemId: water, quantity: 3 },
    ]).expect(200);

    await pool.query(`UPDATE concession_items SET state = 'stopped' WHERE id = $1`, [water]);

    const view = await request(app)
      .get(`/api/reservations/${s.reservationId}`)
      .set(bearer(s.buyer.token))
      .expect(200);
    expect(view.body.concessions).toBeUndefined();
    expect(view.body.totalAmount).toBe(s.ticketTotal);
  });
});

describe("checkout with tickets + concessions", () => {
  it("charges tickets + snacks once, snapshots the lines and mints exactly one voucher", async () => {
    const s = await seedScenario();
    const popcorn = await seedItem(s.eventId, "Bắp rang bơ", 50_000);
    await putConcessions(s.buyer.token, s.reservationId, [
      { concessionItemId: popcorn, quantity: 2 },
    ]).expect(200);

    const order = await checkout(s.buyer.userId, s.reservationId);

    expect(order.totalAmount).toBe(s.ticketTotal + 100_000);
    expect(order.tickets).toHaveLength(2);
    expect(order.concessions).toEqual([
      {
        id: order.concessions![0].id,
        concessionItemId: popcorn,
        label: "Bắp rang bơ",
        quantity: 2,
        unitPriceAmount: 50_000,
      },
    ]);
    expect(order.voucher?.status).toBe("unredeemed");

    // One purchase entry for the WHOLE order — no second payment step exists to disagree with it.
    const ledger = await pool.query<{ n: string; sum: string }>(
      `SELECT count(*)::text AS n, COALESCE(sum(amount), 0)::text AS sum
         FROM wallet_transactions WHERE order_id = $1 AND kind = 'purchase'`,
      [order.id],
    );
    expect(ledger.rows[0].n).toBe("1");
    expect(Number(ledger.rows[0].sum)).toBe(-(s.ticketTotal + 100_000));

    // Exactly one voucher, hashed at rest like a ticket's QR token.
    const vouchers = await pool.query(
      `SELECT code, code_hash, status FROM concession_vouchers WHERE order_id = $1`,
      [order.id],
    );
    expect(vouchers.rowCount).toBe(1);
    expect(vouchers.rows[0].code).toBe(order.voucher!.code);
    expect(vouchers.rows[0].code_hash).toHaveLength(64);

    // Snapshot columns carry what was sold; the menu row itself stays untouched.
    const lines = await pool.query(
      `SELECT item_label, unit_price_amount, quantity FROM order_concessions WHERE order_id = $1`,
      [order.id],
    );
    expect(lines.rows[0]).toEqual({
      item_label: "Bắp rang bơ",
      unit_price_amount: 50_000,
      quantity: 2,
    });
  });

  it("is idempotent — re-checkout answers the same order without minting anything new", async () => {
    const s = await seedScenario();
    const popcorn = await seedItem(s.eventId, "Bắp rang bơ", 50_000);
    await putConcessions(s.buyer.token, s.reservationId, [
      { concessionItemId: popcorn, quantity: 1 },
    ]).expect(200);

    const first = await checkout(s.buyer.userId, s.reservationId);
    const second = await checkout(s.buyer.userId, s.reservationId);

    expect(second.id).toBe(first.id);
    const vouchers = await pool.query(
      `SELECT count(*)::int AS n FROM concession_vouchers WHERE order_id = $1`,
      [first.id],
    );
    expect(vouchers.rows[0].n).toBe(1);
  });

  it("includes the snacks in the shortfall the wallet reports", async () => {
    const s = await seedScenario({ balance: 400_000 }); // enough for 2 vé, not for the bắp
    const popcorn = await seedItem(s.eventId, "Bắp rang bơ", 50_000);
    await putConcessions(s.buyer.token, s.reservationId, [
      { concessionItemId: popcorn, quantity: 3 },
    ]).expect(200);

    try {
      await checkout(s.buyer.userId, s.reservationId);
      expect.unreachable("checkout phải từ chối khi ví không đủ.");
    } catch (e) {
      const err = e as { code?: string; details?: Record<string, number> };
      expect(err.code).toBe("insufficient_wallet_balance");
      // 500,000 vé + 150,000 bắp — the shortfall names the COMBINED requirement.
      expect(err.details?.required).toBe(650_000);
    }
    // Nothing was created on the refusal.
    const orders = await pool.query(
      `SELECT count(*)::int AS n FROM orders WHERE reservation_id = $1`,
      [s.reservationId],
    );
    expect(orders.rows[0].n).toBe(0);
  });

  it("refuses a stopped item at payment time instead of charging for it", async () => {
    const s = await seedScenario();
    const water = await seedItem(s.eventId, "Nước suối", 10_000);
    await putConcessions(s.buyer.token, s.reservationId, [
      { concessionItemId: water, quantity: 1 },
    ]).expect(200);
    await pool.query(`UPDATE concession_items SET state = 'stopped' WHERE id = $1`, [water]);

    try {
      await checkout(s.buyer.userId, s.reservationId);
      expect.unreachable("checkout phải từ chối món đã ngừng bán.");
    } catch (e) {
      expect((e as { code?: string }).code).toBe("concession_unavailable");
    }
    const orders = await pool.query(
      `SELECT count(*)::int AS n FROM orders WHERE reservation_id = $1`,
      [s.reservationId],
    );
    expect(orders.rows[0].n).toBe(0);
  });

  it("never sells concessions without a ticket (FR-004)", async () => {
    const s = await seedScenario();
    const popcorn = await seedItem(s.eventId, "Bắp rang bơ", 50_000);
    await putConcessions(s.buyer.token, s.reservationId, [
      { concessionItemId: popcorn, quantity: 1 },
    ]).expect(200);

    // Strip the ticket lines directly: whatever the path, an order may never exist with snacks
    // and no admission.
    await pool.query(`DELETE FROM reservation_items WHERE reservation_id = $1`, [s.reservationId]);

    try {
      await checkout(s.buyer.userId, s.reservationId);
      expect.unreachable("Đơn không có vé phải bị từ chối.");
    } catch (e) {
      expect((e as { code?: string }).code).toBe("empty_reservation");
    }
  });

  it("dies cleanly when the hold lapses — cart lines leave nothing behind", async () => {
    const s = await seedScenario();
    const popcorn = await seedItem(s.eventId, "Bắp rang bơ", 50_000);
    await putConcessions(s.buyer.token, s.reservationId, [
      { concessionItemId: popcorn, quantity: 1 },
    ]).expect(200);

    await pool.query(
      `UPDATE reservations SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [s.reservationId],
    );

    try {
      await checkout(s.buyer.userId, s.reservationId);
      expect.unreachable("Đơn giữ chỗ đã hết hạn.");
    } catch (e) {
      expect((e as { code?: string }).code).toBe("reservation_expired");
    }
    const orders = await pool.query(
      `SELECT count(*)::int AS n FROM orders WHERE reservation_id = $1`,
      [s.reservationId],
    );
    expect(orders.rows[0].n).toBe(0);
  });
});

describe("GET /api/catalog/events/:eventId/concessions", () => {
  it("lists the menu publicly and hides stopped items", async () => {
    const organizerUser = await registerUser();
    const organizerId = await makeApprovedOrganizer(organizerUser.userId);
    const event = await seed.seedEvent({ organizerId });
    const listed = await seedItem(event.id, "Bắp rang bơ", 50_000);
    const stopped = await seedItem(event.id, "Coca cũ", 15_000);
    await pool.query(`UPDATE concession_items SET state = 'stopped' WHERE id = $1`, [stopped]);

    const res = await request(app)
      .get(`/api/catalog/events/${event.id}/concessions`)
      .expect(200);

    expect(res.body.items.map((item: { id: number }) => item.id)).toEqual([listed]);
  });

  it("shows nothing for an event that is not publicly visible", async () => {
    const organizerUser = await registerUser();
    const organizerId = await makeApprovedOrganizer(organizerUser.userId);
    const draft = await seed.seedEvent({ organizerId, status: "draft" });
    await seedItem(draft.id, "Bắp rang bơ", 50_000);

    const res = await request(app)
      .get(`/api/catalog/events/${draft.id}/concessions`)
      .expect(200);
    expect(res.body.items).toEqual([]);
  });
});
