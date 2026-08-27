import { describe, it, expect } from "vitest";
import { getOrganizerAnalyticsService } from "../src/modules/organizer/analyticsService.js";
import { pool } from "../src/db/pool.js";
import { makeApprovedOrganizer, registerUser } from "./helpers/authFixture.js";

describe("Organizer Analytics Service & RBAC Tests", () => {
  it("returns zero-state structure when user is not an approved organizer", async () => {
    const data = await getOrganizerAnalyticsService(999999);
    expect(data.overview.gross_revenue_vnd).toBe(0);
    expect(data.overview.total_refund_amount_vnd).toBe(0);
    expect(data.overview.net_revenue_vnd).toBe(0);
    expect(data.overview.total_tickets_sold).toBe(0);
    expect(data.soonest_event_capacity.has_upcoming_event).toBe(false);
  });

  it("handles date period filter and custom range cleanly", async () => {
    const data = await getOrganizerAnalyticsService(999999, {
      period: "custom",
      startDate: "2026-08-01T00:00:00Z",
      endDate: "2026-08-13T23:59:59Z",
    });
    expect(data).toBeDefined();
    expect(data.overview.period_comparison).toBeDefined();
    expect(Array.isArray(data.time_series)).toBe(true);
    expect(Array.isArray(data.top_events)).toBe(true);
  });

  it("calculates net revenue correctly (gross_revenue minus total_refunds)", async () => {
    const data = await getOrganizerAnalyticsService(1);
    expect(data.overview.net_revenue_vnd).toBe(
      Math.max(0, data.overview.gross_revenue_vnd - data.overview.total_refund_amount_vnd),
    );
  });
});

/* ------------------------------------------------------------------ */
/* Fixture: one organizer, one GA event, one showtime + tier, and as   */
/* many paid/unpaid orders as the case needs — each with an explicit   */
/* `created_at` so windows are deterministic at any run time.          */
/* ------------------------------------------------------------------ */

const soon = () => new Date(Date.now() + 86_400_000).toISOString();

async function seedOrganizer() {
  const user = await registerUser();
  const orgId = await makeApprovedOrganizer(user.userId);
  return { userId: user.userId, orgId };
}

async function seedEventWithShowtime(orgId: number, userId: number) {
  const venue = await pool.query(
    `INSERT INTO venues (created_by, name, city, raw_address) VALUES ($1, 'Analytics Hall', 'TP.HCM', '1 Ledger St') RETURNING id`,
    [userId],
  );
  const venueId = venue.rows[0].id;
  const event = await pool.query(
    `INSERT INTO events (slug, organizer_id, category_id, title, description, event_type, status, moderation_status)
     VALUES ($1, $2, (SELECT id FROM event_categories WHERE code = 'music'), 'Analytics Fest', 'window tests', 'general_admission', 'on_sale', 'approved')
     RETURNING id`,
    [`analytics-fest-${Date.now()}-${Math.random().toString(36).slice(2)}`, orgId],
  );
  const eventId = Number(event.rows[0].id);
  const showtime = await pool.query(
    `INSERT INTO showtimes (event_id, venue_id, starts_at, status) VALUES ($1, $2, $3, 'on_sale') RETURNING id`,
    [eventId, venueId, soon()],
  );
  const showtimeId = Number(showtime.rows[0].id);
  const tier = await pool.query(
    `INSERT INTO ticket_tiers (showtime_id, label, price_amount, total_quantity) VALUES ($1, 'Standard', 100000, 50) RETURNING id`,
    [showtimeId],
  );
  return { eventId, showtimeId, tierId: Number(tier.rows[0].id) };
}

/** One reservation + order + `ticketCount` tickets, at an explicit created_at and payment status. */
async function seedOrder(
  userId: number,
  showtimeId: number,
  tierId: number,
  opts: { createdAt: string; paymentStatus?: string; ticketCount: number; unitPrice?: number },
) {
  const unit = opts.unitPrice ?? 100000;
  const n = opts.ticketCount;
  const reservation = await pool.query(
    `INSERT INTO reservations (user_id, showtime_id, expires_at, status) VALUES ($1, $2, now() + interval '1 hour', 'converted') RETURNING id`,
    [userId, showtimeId],
  );
  const reservationId = reservation.rows[0].id;
  const item = await pool.query(
    `INSERT INTO reservation_items (reservation_id, ticket_tier_id, quantity, unit_price_amount) VALUES ($1, $2, $3, $4) RETURNING id`,
    [reservationId, tierId, n, unit],
  );
  const itemId = item.rows[0].id;
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const order = await pool.query(
    `INSERT INTO orders (order_code, user_id, reservation_id, customer_name, customer_email, customer_phone,
                         subtotal_cents, service_fee_cents, discount_cents, final_total_cents, payment_method, payment_status, created_at)
     VALUES ($1, $2, $3, 'Customer', 'c@example.com', '0900000001', $4, 0, 0, $4, 'wallet', $5, $6) RETURNING id, order_code`,
    [`ORD-${tag}`, userId, reservationId, unit * n, opts.paymentStatus ?? "paid", opts.createdAt],
  );
  const { id: orderId, order_code: orderCode } = order.rows[0];
  for (let i = 0; i < n; i++) {
    await pool.query(
      `INSERT INTO tickets (order_id, reservation_item_id, price_cents, refundable_amount, qr_token_hash, barcode_value, qr_status)
       VALUES ($1, $2, $3, $3, $4, $5, 'unused')`,
      [orderId, itemId, unit, `hash-${tag}-${i}`, `BAR-${tag}-${i}`],
    );
  }
  return { orderId: Number(orderId), orderCode: String(orderCode) };
}

describe("Analytics corrections (ORG-01/05/06/13/14 + transactions)", () => {
  it("counts an order's total ONCE no matter how many tickets it carries (ORG-01)", async () => {
    const { userId, orgId } = await seedOrganizer();
    const { showtimeId, tierId } = await seedEventWithShowtime(orgId, userId);
    // One order, three tickets, total 300,000đ. The fan-out shape summed the order once per
    // ticket row and reported 900,000đ.
    await seedOrder(userId, showtimeId, tierId, {
      createdAt: "2026-08-20 10:00:00+07",
      ticketCount: 3,
      unitPrice: 100000,
    });

    const data = await getOrganizerAnalyticsService(userId, {
      period: "custom",
      startDate: "2026-08-20",
      endDate: "2026-08-20",
    });
    expect(data.overview.gross_revenue_vnd).toBe(300000);
    expect(data.overview.total_tickets_sold).toBe(3);
  });

  it("covers the whole Vietnamese day for a date-only same-day range (ORG-06)", async () => {
    const { userId, orgId } = await seedOrganizer();
    const { showtimeId, tierId } = await seedEventWithShowtime(orgId, userId);
    // 06:59 ICT on the 20th is 23:59 UTC on the 19th — the instant a UTC-midnight window start
    // leaves outside "20/08", and the old inclusive-`<=` end never reached it either.
    await seedOrder(userId, showtimeId, tierId, {
      createdAt: "2026-08-20 06:59:00+07",
      ticketCount: 1,
      unitPrice: 120000,
    });
    // 23:30 ICT on the 20th — the old end bound (UTC midnight of the 20th) cut this off too.
    await seedOrder(userId, showtimeId, tierId, {
      createdAt: "2026-08-20 23:30:00+07",
      ticketCount: 1,
      unitPrice: 130000,
    });

    const data = await getOrganizerAnalyticsService(userId, {
      period: "custom",
      startDate: "2026-08-20",
      endDate: "2026-08-20",
    });
    expect(data.overview.gross_revenue_vnd).toBe(250000);
    expect(data.overview.total_tickets_sold).toBe(2);

    // The day after holds neither order.
    const nextDay = await getOrganizerAnalyticsService(userId, {
      period: "custom",
      startDate: "2026-08-21",
      endDate: "2026-08-21",
    });
    expect(nextDay.overview.gross_revenue_vnd).toBe(0);
  });

  it("rejects a reversed custom range instead of answering an empty window (ORG-06)", async () => {
    const { userId, orgId } = await seedOrganizer();
    await seedEventWithShowtime(orgId, userId);
    await expect(
      getOrganizerAnalyticsService(userId, {
        period: "custom",
        startDate: "2026-08-20",
        endDate: "2026-08-18",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("never counts an unsubmitted draft as waiting for approval (ORG-13)", async () => {
    const { userId, orgId } = await seedOrganizer();
    const { eventId } = await seedEventWithShowtime(orgId, userId); // on_sale + approved
    // A brand-new draft carries moderation_status='pending_review' from the schema default even
    // though the organizer has submitted nothing.
    await pool.query(
      `INSERT INTO events (slug, organizer_id, category_id, title, description, event_type, status, moderation_status)
       VALUES ($1, $2, (SELECT id FROM event_categories WHERE code = 'music'), 'Draft Fest', 'not submitted', 'general_admission', 'draft', 'pending_review')`,
      [`draft-fest-${Date.now()}`, orgId],
    );
    // A genuinely submitted one.
    await pool.query(
      `INSERT INTO events (slug, organizer_id, category_id, title, description, event_type, status, moderation_status)
       VALUES ($1, $2, (SELECT id FROM event_categories WHERE code = 'music'), 'Submitted Fest', 'waiting', 'general_admission', 'on_sale', 'pending_review')`,
      [`submitted-fest-${Date.now()}`, orgId],
    );

    const data = await getOrganizerAnalyticsService(userId);
    expect(data.overview.event_counts_by_status.draft).toBe(1);
    expect(data.overview.event_counts_by_status.pending_approval).toBe(1);
    expect(data.overview.event_counts_by_status.published).toBe(1);
    void eventId;
  });

  it("reports the previous window's REAL series, not current * 0.8 (ORG-14)", async () => {
    const { userId, orgId } = await seedOrganizer();
    const { showtimeId, tierId } = await seedEventWithShowtime(orgId, userId);
    await seedOrder(userId, showtimeId, tierId, {
      createdAt: "2026-08-19 12:00:00+07",
      ticketCount: 1,
      unitPrice: 100000,
    });
    await seedOrder(userId, showtimeId, tierId, {
      createdAt: "2026-08-20 12:00:00+07",
      ticketCount: 3,
      unitPrice: 100000,
    });

    // Window 19→20. The previous window is 17→18, which holds NO orders: every previous figure
    // must be a real zero, not 0.8 of the day it is drawn next to (80,000 / 240,000).
    const data = await getOrganizerAnalyticsService(userId, {
      period: "custom",
      startDate: "2026-08-19",
      endDate: "2026-08-20",
    });
    expect(data.time_series.map((p) => p.date)).toEqual(["2026-08-19", "2026-08-20"]);
    expect(data.time_series[0].current_revenue_vnd).toBe(100000);
    expect(data.time_series[1].current_revenue_vnd).toBe(300000);
    expect(data.time_series[1].current_tickets_sold).toBe(3);
    for (const p of data.time_series) {
      expect(p.previous_revenue_vnd).toBe(0);
      expect(p.previous_tickets_sold).toBe(0);
    }
  });

  it("aligns the previous series day-for-day when the previous window HAS sales (ORG-14)", async () => {
    const { userId, orgId } = await seedOrganizer();
    const { showtimeId, tierId } = await seedEventWithShowtime(orgId, userId);
    // Window = 20/08 alone; its previous window is 19/08 alone — this order lands exactly there.
    await seedOrder(userId, showtimeId, tierId, {
      createdAt: "2026-08-19 12:00:00+07",
      ticketCount: 1,
      unitPrice: 100000,
    });
    await seedOrder(userId, showtimeId, tierId, {
      createdAt: "2026-08-20 12:00:00+07",
      ticketCount: 3,
      unitPrice: 100000,
    });

    const data = await getOrganizerAnalyticsService(userId, {
      period: "custom",
      startDate: "2026-08-20",
      endDate: "2026-08-20",
    });
    expect(data.time_series).toHaveLength(1);
    expect(data.time_series[0].current_revenue_vnd).toBe(300000);
    expect(data.time_series[0].previous_revenue_vnd).toBe(100000);
    expect(data.time_series[0].previous_tickets_sold).toBe(1);
    // And the period totals behind the deltas read the same real numbers.
    expect(data.overview.gross_revenue_vnd).toBe(300000);
  });

  it("measures capacity from tiers alone and sold from paid, non-void tickets alone (ORG-05)", async () => {
    const { userId, orgId } = await seedOrganizer();
    const { showtimeId, tierId } = await seedEventWithShowtime(orgId, userId); // capacity 50
    await seedOrder(userId, showtimeId, tierId, {
      createdAt: "2026-08-20 10:00:00+07",
      paymentStatus: "paid",
      ticketCount: 2,
    });
    // An unpaid checkout must not count as sold, and its rows must not multiply the capacity.
    await seedOrder(userId, showtimeId, tierId, {
      createdAt: "2026-08-20 11:00:00+07",
      paymentStatus: "pending",
      ticketCount: 3,
    });

    const data = await getOrganizerAnalyticsService(userId);
    expect(data.overview.total_capacity).toBe(50);
    expect(data.overview.capacity_fill_rate).toBe(4);
  });

  it("lists one row per order in recent transactions and only real money (A6)", async () => {
    const { userId, orgId } = await seedOrganizer();
    const { showtimeId, tierId } = await seedEventWithShowtime(orgId, userId);
    const paid = await seedOrder(userId, showtimeId, tierId, {
      createdAt: "2026-08-20 10:00:00+07",
      paymentStatus: "paid",
      ticketCount: 3,
      unitPrice: 100000,
    });
    await seedOrder(userId, showtimeId, tierId, {
      createdAt: "2026-08-20 11:00:00+07",
      paymentStatus: "failed",
      ticketCount: 2,
    });

    const data = await getOrganizerAnalyticsService(userId, {
      period: "custom",
      startDate: "2026-08-20",
      endDate: "2026-08-20",
    });
    const rows = data.recent_transactions.filter((t) => t.order_id === paid.orderCode);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount_vnd).toBe(300000);
    expect(rows[0].payment_status).toBe("COMPLETED");
    // The failed checkout stays out of the ledger entirely.
    expect(data.recent_transactions).toHaveLength(1);
  });
});
