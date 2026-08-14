import request from "supertest";
import { pool } from "../../src/db/pool.js";
import { checkout } from "../../src/modules/payments/wallet.service.js";
import { app } from "./app.js";
import { bearer, makeApprovedOrganizer, registerUser } from "./authFixture.js";
import * as seed from "./catalogSeed.js";

/**
 * A real sale, end to end — the only fixture that produces the rows the console reads.
 *
 * Revenue, the attendee list and the door all start at `tickets`, and a ticket exists only after a
 * reservation is checked out against a funded wallet. Inserting one by hand would leave the order,
 * the ledger and the tier counters disagreeing with each other, which is exactly the sort of state
 * the screens under test are supposed to reveal.
 */
export interface SaleFixture {
  organizer: { userId: number; token: string; organizerId: number };
  buyer: { userId: number; token: string; email: string };
  eventId: number;
  showtimeId: number;
  tierId: number;
  orderId: number;
  /** One per seat bought, in the order they were issued. */
  barcodes: string[];
  price: number;
}

export async function seedSale(
  options: { quantity?: number; price?: number; startsInMs?: number } = {},
): Promise<SaleFixture> {
  const quantity = options.quantity ?? 2;
  const price = options.price ?? 250_000;

  const organizerUser = await registerUser();
  const organizerId = await makeApprovedOrganizer(organizerUser.userId);
  const venue = await seed.seedVenue(organizerUser.userId);
  const event = await seed.seedEvent({ organizerId });
  const showtimeId = await seed.seedShowtime(event.id, venue, options.startsInMs ?? 86_400_000);
  const tierId = await seed.seedTier(showtimeId, { total: 50, price });

  const buyer = await registerUser();
  await pool.query(
    `INSERT INTO wallets (user_id, balance_amount) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET balance_amount = EXCLUDED.balance_amount`,
    [buyer.userId, price * quantity + 1_000_000],
  );

  const reservation = await request(app)
    .post("/api/reservations")
    .set(bearer(buyer.token))
    .send({ showtimeId, ticketTierId: tierId, quantity })
    .expect(201);
  const order = await checkout(buyer.userId, reservation.body.id);

  const { rows } = await pool.query<{ barcode_value: string }>(
    `SELECT barcode_value FROM tickets WHERE order_id = $1 ORDER BY id`,
    [order.id],
  );

  return {
    organizer: { userId: organizerUser.userId, token: organizerUser.token, organizerId },
    buyer,
    eventId: event.id,
    showtimeId,
    tierId,
    orderId: order.id,
    barcodes: rows.map((row) => row.barcode_value),
    price,
  };
}

/** An admin session, for the console's own endpoints. */
export async function adminSession(): Promise<{ token: string; userId: number }> {
  const user = await registerUser();
  await pool.query(`UPDATE users SET is_admin = true WHERE id = $1`, [user.userId]);
  return { token: user.token, userId: user.userId };
}

/** Move a showtime, as the passage of time would — the door only opens near the start. */
export async function moveShowtime(showtimeId: number, offsetMs: number): Promise<void> {
  await pool.query(
    `UPDATE showtimes SET starts_at = now() + ($2::bigint * interval '1 millisecond') WHERE id = $1`,
    [showtimeId, offsetMs],
  );
}
