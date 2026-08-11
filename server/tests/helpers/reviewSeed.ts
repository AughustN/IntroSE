import { pool } from '../../src/db/pool.js';
import { seedEvent, seedOrganizer, seedShowtime, seedTier, seedUser, seedVenue } from './catalogSeed.js';

/**
 * A ticket, and every reason one might not count.
 *
 * Eligibility is the whole integrity story of this feature, so the fixtures have to be able to
 * produce each failing shape as precisely as the passing one: an unpaid order, a voided ticket, and
 * an event that has not happened all look like "has a ticket" from a distance and none of them is.
 */
export interface SeededEvent {
  eventId: number;
  showtimeId: number;
  tierId: number;
}

/** A visible event whose showtime is in the past by default — the reviewable shape. */
export async function seedPastEvent(over: { startedDaysAgo?: number; title?: string } = {}): Promise<SeededEvent> {
  const org = await seedOrganizer(await seedUser());
  const venue = await seedVenue(await seedUser());
  const event = await seedEvent({ organizerId: org, title: over.title ?? 'Sự kiện đã diễn ra' });
  const showtime = await seedShowtime(event.id, venue, -(over.startedDaysAgo ?? 1) * 86_400_000);
  const tier = await seedTier(showtime);
  return { eventId: event.id, showtimeId: showtime, tierId: tier };
}

export async function seedFutureEvent(): Promise<SeededEvent> {
  const org = await seedOrganizer(await seedUser());
  const venue = await seedVenue(await seedUser());
  const event = await seedEvent({ organizerId: org, title: 'Sự kiện sắp diễn ra' });
  const showtime = await seedShowtime(event.id, venue, 7 * 86_400_000);
  const tier = await seedTier(showtime);
  return { eventId: event.id, showtimeId: showtime, tierId: tier };
}

/**
 * Give an account a ticket to a showtime, through the real chain of rows.
 *
 * `reservation → reservation_item → order → ticket` rather than a shortcut, because the eligibility
 * query walks exactly that chain: a fixture that skirts it would pass tests the production query
 * would fail.
 */
export async function giveTicket(
  userId: number,
  seeded: SeededEvent,
  over: { paymentStatus?: string; qrStatus?: string } = {},
): Promise<number> {
  const reservation = (
    await pool.query<{ id: number }>(
      `INSERT INTO reservations (user_id, showtime_id, status, expires_at)
       VALUES ($1, $2, 'converted', now() + interval '1 hour') RETURNING id`,
      [userId, seeded.showtimeId],
    )
  ).rows[0]!.id;

  const item = (
    await pool.query<{ id: number }>(
      `INSERT INTO reservation_items (reservation_id, ticket_tier_id, unit_price_amount)
       VALUES ($1, $2, 100000) RETURNING id`,
      [reservation, seeded.tierId],
    )
  ).rows[0]!.id;

  const order = (
    await pool.query<{ id: number }>(
      `INSERT INTO orders (user_id, reservation_id, payment_status, order_code, customer_name,
                           customer_email, customer_phone, subtotal_cents, service_fee_cents,
                           final_total_cents, payment_method)
       VALUES ($1, $2, $3, $4, 'Người mua', 'buyer@example.com', '0900000000',
               100000, 0, 100000, 'wallet') RETURNING id`,
      [userId, reservation, over.paymentStatus ?? 'paid', `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`],
    )
  ).rows[0]!.id;

  const ticket = (
    await pool.query<{ id: number }>(
      `INSERT INTO tickets (order_id, reservation_item_id, price_cents, qr_token_hash, barcode_value,
                            qr_status, refundable_amount)
       VALUES ($1, $2, 100000, $3, $4, $5, 100000) RETURNING id`,
      [order, item, `hash-${Date.now()}-${Math.random()}`, `TIX-${Date.now()}-${Math.random()}`, over.qrStatus ?? 'unused'],
    )
  ).rows[0]!.id;

  return ticket;
}
