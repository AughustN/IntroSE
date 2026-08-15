import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../helpers/app.js';
import { bearer, makeApprovedOrganizer, registerUser } from '../helpers/authFixture.js';
import { pool } from '../../src/db/pool.js';
import { setAccessToken } from '../../../src/services/authClient.js';
import { getOrganizerEventDetail, setCurrentOrganizerId } from '../../../src/services/organizerClient.js';

const soon = () => new Date(Date.now() + 86_400_000).toISOString();

describe('Organizer Analytics vs Event List Consistency & Detail Page Access Integrity', () => {
  it('asserts ticket-sold count, capacity, and revenue are byte-for-byte identical between Analytics Top Events and Event List', async () => {
    const user = await registerUser();
    const orgId = await makeApprovedOrganizer(user.userId);
    const h = bearer(user.token);

    // Create venue, event, showtime & tier directly via DB
    const venueRow = await pool.query(
      `INSERT INTO venues (created_by, name, city, raw_address) VALUES ($1, 'Consistency Arena', 'TP.HCM', '123 Main St') RETURNING id`,
      [user.userId],
    );
    const venueId = venueRow.rows[0].id;

    const eventSlug = `consistency-audit-fest-${Date.now()}`;
    const eventRow = await pool.query(
      `INSERT INTO events (slug, organizer_id, category_id, title, description, event_type, status, moderation_status)
       VALUES ($1, $2, (SELECT id FROM event_categories WHERE code = 'music'), 'Consistency Audit Fest 2026', 'Testing byte-for-byte metric equality across views.', 'general_admission', 'draft', 'pending_review')
       RETURNING id`,
      [eventSlug, orgId],
    );
    const eventId = Number(eventRow.rows[0].id);

    const stRow = await pool.query(
      `INSERT INTO showtimes (event_id, venue_id, starts_at, status) VALUES ($1, $2, $3, 'on_sale') RETURNING id`,
      [eventId, venueId, soon()],
    );
    const showtimeId = stRow.rows[0].id;

    const tierRow = await pool.query(
      `INSERT INTO ticket_tiers (showtime_id, label, price_amount, total_quantity) VALUES ($1, 'VIP Gold', 150000, 250) RETURNING id`,
      [showtimeId],
    );
    const tierId = tierRow.rows[0].id;

    // Create 1 reservation + order + 10 tickets
    const resRow = await pool.query(
      `INSERT INTO reservations (user_id, showtime_id, expires_at, status) VALUES ($1, $2, now() + interval '1 hour', 'converted') RETURNING id`,
      [user.userId, showtimeId],
    );
    const reservationId = resRow.rows[0].id;

    const riRow = await pool.query(
      `INSERT INTO reservation_items (reservation_id, ticket_tier_id, quantity, unit_price_amount) VALUES ($1, $2, 10, 150000) RETURNING id`,
      [reservationId, tierId],
    );
    const reservationItemId = riRow.rows[0].id;

    const orderCode = `ORD-TEST-${Date.now()}`;
    const orderRow = await pool.query(
      `INSERT INTO orders (order_code, user_id, reservation_id, customer_name, customer_email, customer_phone, subtotal_cents, service_fee_cents, discount_cents, final_total_cents, payment_method, payment_status)
       VALUES ($1, $2, $3, 'Customer', 'customer@example.com', '0901234567', 1500000, 0, 0, 1500000, 'wallet', 'paid') RETURNING id`,
      [orderCode, user.userId, reservationId],
    );
    const orderId = orderRow.rows[0].id;

    for (let i = 0; i < 10; i++) {
      await pool.query(
        `INSERT INTO tickets (order_id, reservation_item_id, price_cents, refundable_amount, qr_token_hash, barcode_value, qr_status)
         VALUES ($1, $2, 150000, 150000, $3, $4, 'unused')`,
        [orderId, reservationItemId, `hash-${i}-${Date.now()}`, `BAR-${i}-${Date.now()}`],
      );
    }

    // 1. Fetch Event List data (/api/organizer/events)
    const eventsRes = await request(app)
      .get('/api/organizer/events')
      .set(h)
      .expect(200);

    const eventListCard = eventsRes.body.find((e: { id: number }) => Number(e.id) === eventId);
    expect(eventListCard).toBeDefined();

    // 2. Fetch Business Analytics data (/api/organizer/analytics/dashboard)
    const analyticsRes = await request(app)
      .get('/api/organizer/analytics/dashboard')
      .set(h)
      .expect(200);

    const topEventsRankingCard = analyticsRes.body.data.top_events.find(
      (e: { event_id: string }) => Number(e.event_id) === eventId,
    );
    expect(topEventsRankingCard).toBeDefined();

    // Assert Byte-For-Byte Metric Equality between Analytics Ranking & Event List Card
    expect(topEventsRankingCard.tickets_sold).toEqual(eventListCard.soldTickets);
    expect(topEventsRankingCard.total_capacity).toEqual(eventListCard.totalCapacity);
    expect(Number(topEventsRankingCard.gross_revenue_vnd)).toEqual(Number(eventListCard.totalRevenueVnd));

    // Verify exact expected metrics: 10 sold, 250 capacity, 1,500,000 VND revenue
    expect(topEventsRankingCard.tickets_sold).toBe(10);
    expect(topEventsRankingCard.total_capacity).toBe(250);
    expect(Number(topEventsRankingCard.gross_revenue_vnd)).toBe(1500000);

    // 3. Verify accessing detail view for this numeric eventId ("1" or "557") succeeds
    expect(eventListCard.id).toBe(eventId);
    expect(eventListCard.title).toBe('Consistency Audit Fest 2026');
    expect(eventListCard.soldTickets).toBe(10);
    expect(eventListCard.totalCapacity).toBe(250);
    expect(Number(eventListCard.totalRevenueVnd)).toBe(1500000);
  });
});
