import type {
  AdminAnalytics,
  AdminOrderPage,
  AdminOverview,
  AdminWalletTxRow,
  AnalyticsRow,
  AttentionItem,
  CategorySlice,
  DayPoint,
  ReviewReportPage,
  ReviewReportRow,
} from "@shared/admin/types.js";
import { pool } from "../../db/pool.js";

/*
 * What the console counts, and why it counts it that way.
 *
 * **A sold ticket is a row in `tickets` that is not void.** Cancelling voids the ticket
 * (`tickets.service.ts`), so a refund removes itself from every figure here without a second
 * subtraction — and a figure built by subtracting refunds separately is a figure that drifts the
 * first time a refund path forgets to report itself.
 *
 * **An order counts only once it is paid.** `payment_status IN ('paid','partially_refunded')` is
 * the same pair the ticket mailer uses; a pending or failed checkout has taken no money and must
 * not appear as revenue.
 *
 * **Money comes from the ticket, not the tier.** `tickets.price_cents` is the price snapshotted at
 * purchase; reading `ticket_tiers.price_amount` instead would restate history every time an
 * organizer edits a price, and would ignore discounts entirely.
 */

/** The join every money query needs: ticket → order → showtime → event. */
const TICKET_CHAIN = `
  FROM tickets t
  JOIN orders o ON o.id = t.order_id
  JOIN reservations r ON r.id = o.reservation_id
  JOIN showtimes s ON s.id = r.showtime_id
  JOIN events e ON e.id = s.event_id`;

const SOLD = `o.payment_status IN ('paid', 'partially_refunded') AND t.qr_status <> 'void'`;

export async function overview(): Promise<AdminOverview> {
  const [window, previous, pending, checkin, live, byDay, byCategory, attention] =
    await Promise.all([
      soldBetween("now() - interval '30 days'", "now()"),
      soldBetween("now() - interval '60 days'", "now() - interval '30 days'"),
      pendingCounts(),
      checkinRate(),
      liveEventCount(),
      revenueByDay(30),
      ticketsByCategory(),
      attentionQueue(),
    ]);

  return {
    revenue30d: window.revenue,
    revenuePrev30d: previous.revenue,
    ticketsSold30d: window.tickets,
    ticketsSoldPrev30d: previous.tickets,
    pendingEvents: pending.events,
    pendingOrganizers: pending.organizers,
    openReports: pending.reports,
    checkedInRate: checkin,
    liveEvents: live,
    revenueByDay: byDay,
    ticketsByCategory: byCategory,
    attention,
  };
}

/**
 * Sold tickets and their money in a window, by **order date**.
 *
 * The bounds are SQL fragments rather than parameters because they are written here and never by a
 * caller — the two windows this serves are "the last 30 days" and "the 30 before that".
 */
async function soldBetween(
  from: string,
  to: string,
): Promise<{ revenue: number; tickets: number }> {
  const { rows } = await pool.query<{ revenue: string; tickets: number }>(
    `SELECT COALESCE(SUM(t.price_cents), 0)::text AS revenue, COUNT(*)::int AS tickets
     ${TICKET_CHAIN}
      WHERE ${SOLD} AND o.created_at >= ${from} AND o.created_at < ${to}`,
  );
  return { revenue: Number(rows[0]?.revenue ?? 0), tickets: rows[0]?.tickets ?? 0 };
}

async function pendingCounts(): Promise<{ events: number; organizers: number; reports: number }> {
  const { rows } = await pool.query<{ events: number; organizers: number; reports: number }>(
    `SELECT
       (SELECT count(*)::int FROM events WHERE moderation_status = 'pending_review') AS events,
       (SELECT count(*)::int FROM organizers WHERE status = 'pending') AS organizers,
       (SELECT count(*)::int FROM content_reports WHERE status = 'open') AS reports`,
  );
  return rows[0] ?? { events: 0, organizers: 0, reports: 0 };
}

/**
 * How many of the people who bought actually came, over occasions that have already started.
 *
 * Restricted to started showtimes on purpose: tickets to next month's concert are unscanned because
 * the concert has not happened, and counting them would drag the rate towards zero and keep it
 * there.
 */
async function checkinRate(): Promise<number | null> {
  const { rows } = await pool.query<{ scanned: number; total: number }>(
    `SELECT COUNT(*) FILTER (WHERE t.qr_status = 'checked_in')::int AS scanned, COUNT(*)::int AS total
     ${TICKET_CHAIN}
      WHERE o.payment_status IN ('paid', 'partially_refunded') AND t.qr_status <> 'void'
        AND s.starts_at <= now() AND s.starts_at > now() - interval '30 days'`,
  );
  const row = rows[0];
  if (!row || row.total === 0) return null;
  return Math.round((row.scanned / row.total) * 100) / 100;
}

async function liveEventCount(): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM events e
      WHERE e.status = 'on_sale' AND e.moderation_status = 'approved'
        AND EXISTS (SELECT 1 FROM showtimes s WHERE s.event_id = e.id AND s.starts_at > now()
                      AND s.status NOT IN ('cancelled', 'finished'))`,
  );
  return rows[0]?.count ?? 0;
}

/**
 * A row per calendar day, including the days nothing sold.
 *
 * `generate_series` rather than whatever the data happens to contain: a chart drawn only from days
 * with orders spaces a quiet week the same as a busy one and turns a slump into a straight line.
 */
async function revenueByDay(days: number): Promise<DayPoint[]> {
  const { rows } = await pool.query<{ day: string; amount: string; tickets: number }>(
    `WITH days AS (
       SELECT generate_series(
         date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') - (($1::int - 1) * interval '1 day'),
         date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh'),
         interval '1 day') AS day
     ),
     sold AS (
       SELECT date_trunc('day', o.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS day,
              SUM(t.price_cents) AS amount, COUNT(*) AS tickets
       ${TICKET_CHAIN}
        WHERE ${SOLD} AND o.created_at >= now() - ($1::int * interval '1 day')
        GROUP BY 1
     )
     SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
            COALESCE(s.amount, 0)::text AS amount,
            COALESCE(s.tickets, 0)::int AS tickets
       FROM days d LEFT JOIN sold s ON s.day = d.day
      ORDER BY d.day`,
    [days],
  );
  return rows.map((row) => ({ day: row.day, amount: Number(row.amount), tickets: row.tickets }));
}

async function ticketsByCategory(): Promise<CategorySlice[]> {
  const { rows } = await pool.query<{ code: string; label: string; tickets: number }>(
    `SELECT c.code, c.label_vi AS label, COUNT(*)::int AS tickets
     ${TICKET_CHAIN}
      JOIN event_categories c ON c.id = e.category_id
      WHERE ${SOLD} AND o.created_at >= now() - interval '30 days'
      GROUP BY c.code, c.label_vi
      ORDER BY tickets DESC`,
  );
  return rows;
}

/**
 * Everything waiting on a decision, oldest first, in one list.
 *
 * Three queues used to live on three screens, so "what is overdue" was a question you answered by
 * visiting all three and remembering. Merged and sorted by age, it is a glance.
 */
async function attentionQueue(): Promise<AttentionItem[]> {
  const { rows } = await pool.query<{
    kind: AttentionItem["kind"];
    id: number;
    title: string;
    hours: string;
  }>(
    `SELECT 'event' AS kind, e.id, e.title,
            EXTRACT(EPOCH FROM (now() - e.created_at)) / 3600 AS hours
       FROM events e WHERE e.moderation_status = 'pending_review'
     UNION ALL
     SELECT 'organizer', o.id, o.display_name,
            EXTRACT(EPOCH FROM (now() - o.created_at)) / 3600
       FROM organizers o WHERE o.status = 'pending'
     UNION ALL
     SELECT 'report', c.id, 'Tố cáo ' || c.target_type || ' #' || c.target_id,
            EXTRACT(EPOCH FROM (now() - c.created_at)) / 3600
       FROM content_reports c WHERE c.status = 'open'
     ORDER BY hours DESC
     LIMIT 12`,
  );
  return rows.map((row) => ({
    kind: row.kind,
    id: row.id,
    title: row.title,
    waitingHours: Math.round(Number(row.hours)),
  }));
}

export interface AnalyticsFilter {
  from: string;
  to: string;
  organizerId?: number;
  category?: string;
}

/**
 * The same money, cut by event — with the organizer and category filters the dashboard cannot ask
 * for (UC-32 step 3).
 *
 * `to` is treated as an inclusive calendar day: a range of 01–07 that dropped everything sold on
 * the 7th would be a range nobody means.
 */
export async function analytics(filter: AnalyticsFilter): Promise<AdminAnalytics> {
  const params = [filter.from, filter.to, filter.organizerId ?? null, filter.category ?? null];
  const where = `${SOLD}
        AND o.created_at >= $1::date
        AND o.created_at < ($2::date + interval '1 day')
        AND ($3::bigint IS NULL OR e.organizer_id = $3)
        AND ($4::text IS NULL OR c.code = $4)`;

  const rowsQuery = pool.query<{
    event_id: number;
    event_title: string;
    organizer_id: number;
    organizer: string;
    category: string;
    tickets: number;
    revenue: string;
    checked_in: number;
  }>(
    `SELECT e.id AS event_id, e.title AS event_title, e.organizer_id, org.display_name AS organizer,
            c.label_vi AS category, COUNT(*)::int AS tickets,
            SUM(t.price_cents)::text AS revenue,
            COUNT(*) FILTER (WHERE t.qr_status = 'checked_in')::int AS checked_in
     ${TICKET_CHAIN}
      JOIN event_categories c ON c.id = e.category_id
      JOIN organizers org ON org.id = e.organizer_id
      WHERE ${where}
      GROUP BY e.id, e.title, e.organizer_id, org.display_name, c.label_vi
      ORDER BY SUM(t.price_cents) DESC
      LIMIT 200`,
    params,
  );

  const dayQuery = pool.query<{ day: string; amount: string; tickets: number }>(
    `SELECT to_char(date_trunc('day', o.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'), 'YYYY-MM-DD') AS day,
            SUM(t.price_cents)::text AS amount, COUNT(*)::int AS tickets
     ${TICKET_CHAIN}
      JOIN event_categories c ON c.id = e.category_id
      WHERE ${where}
      GROUP BY 1 ORDER BY 1`,
    params,
  );

  const [byEvent, byDay] = await Promise.all([rowsQuery, dayQuery]);
  const rows: AnalyticsRow[] = byEvent.rows.map((row) => ({
    eventId: row.event_id,
    eventTitle: row.event_title,
    organizerId: row.organizer_id,
    organizer: row.organizer,
    category: row.category,
    tickets: row.tickets,
    revenue: Number(row.revenue),
    checkedIn: row.checked_in,
  }));

  return {
    from: filter.from,
    to: filter.to,
    totals: {
      tickets: rows.reduce((sum, row) => sum + row.tickets, 0),
      revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
      checkedIn: rows.reduce((sum, row) => sum + row.checkedIn, 0),
      events: rows.length,
    },
    rows,
    byDay: byDay.rows.map((row) => ({
      day: row.day,
      amount: Number(row.amount),
      tickets: row.tickets,
    })),
  };
}

export interface OrderFilter {
  query?: string;
  status?: string;
  limit: number;
  offset: number;
}

/**
 * Orders across the whole platform, for the question support actually gets: "I was charged and I
 * have no ticket."
 *
 * Searchable by order code, buyer e-mail and buyer name, because those are the three things a
 * person can quote from their own mailbox.
 */
export async function orders(filter: OrderFilter): Promise<AdminOrderPage> {
  const params = [filter.query ?? null, filter.status ?? null, filter.limit, filter.offset];
  const where = `($1::text IS NULL OR o.order_code ILIKE '%' || $1 || '%'
                   OR o.customer_email ILIKE '%' || $1 || '%'
                   OR o.customer_name ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR o.payment_status = $2)`;

  const rowsQuery = pool.query<{
    id: number;
    code: string;
    created_at: Date;
    customer_name: string;
    customer_email: string;
    event_title: string;
    starts_at: Date;
    tickets: number;
    void_tickets: number;
    total: string;
    payment_status: string;
    payment_method: string;
  }>(
    `SELECT o.id, o.order_code AS code, o.created_at, o.customer_name, o.customer_email,
            e.title AS event_title, s.starts_at,
            COUNT(t.id) FILTER (WHERE t.qr_status <> 'void')::int AS tickets,
            COUNT(t.id) FILTER (WHERE t.qr_status = 'void')::int AS void_tickets,
            o.final_total_cents::text AS total, o.payment_status, o.payment_method
       FROM orders o
       JOIN reservations r ON r.id = o.reservation_id
       JOIN showtimes s ON s.id = r.showtime_id
       JOIN events e ON e.id = s.event_id
       LEFT JOIN tickets t ON t.order_id = o.id
      WHERE ${where}
      GROUP BY o.id, e.title, s.starts_at
      ORDER BY o.created_at DESC
      LIMIT $3 OFFSET $4`,
    params,
  );

  const countQuery = pool.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM orders o WHERE ${where}`,
    [filter.query ?? null, filter.status ?? null],
  );

  const [list, count] = await Promise.all([rowsQuery, countQuery]);
  return {
    rows: list.rows.map((row) => ({
      id: row.id,
      code: row.code,
      createdAt: row.created_at.toISOString(),
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      eventTitle: row.event_title,
      startsAt: row.starts_at.toISOString(),
      tickets: row.tickets,
      voidTickets: row.void_tickets,
      total: Number(row.total),
      paymentStatus: row.payment_status,
      paymentMethod: row.payment_method,
    })),
    total: count.rows[0]?.total ?? 0,
  };
}

export interface ReviewReportFilter {
  /** Matched against the *event's* title — how a moderator remembers where a comment was. */
  query?: string;
  /** `open` = still waiting; `done` = decided, whichever way. */
  status?: "open" | "done";
  limit: number;
  offset: number;
}

/**
 * Reported comments, decided ones included (UC-39 → UC-34).
 *
 * The moderation queue answers "what is waiting" and nothing else — it filters to `status = 'open'`.
 * That is the right shape for a to-do list and the wrong one for a screen somebody opens to check
 * what was done: a report closed by mistake vanished from every view the console had.
 *
 * Open reports sort first regardless of age, because the work comes before the record.
 */
export async function reviewReports(filter: ReviewReportFilter): Promise<ReviewReportPage> {
  const where = `c.target_type = 'review'
        AND ($1::text IS NULL OR e.title ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL
             OR ($2 = 'open' AND c.status = 'open')
             OR ($2 = 'done' AND c.status <> 'open'))`;
  const from = `FROM content_reports c
       JOIN event_reviews r ON r.id = c.target_id
       JOIN events e ON e.id = r.event_id
       LEFT JOIN users author ON author.id = r.user_id
       JOIN users reporter ON reporter.id = c.reporter_user_id`;
  const params = [filter.query ?? null, filter.status ?? null, filter.limit, filter.offset];

  const rowsQuery = pool.query<{
    id: number;
    status: ReviewReportRow["status"];
    reason: string;
    created_at: Date;
    resolved_at: Date | null;
    resolution_note: string | null;
    review_id: number;
    review_body: string | null;
    rating: number;
    review_status: ReviewReportRow["reviewStatus"];
    review_created_at: Date;
    author_name: string | null;
    event_id: number;
    event_title: string;
    event_slug: string;
    reporter_email: string;
  }>(
    `SELECT c.id, c.status, c.reason, c.created_at, c.resolved_at, c.resolution_note,
            r.id AS review_id, r.body AS review_body, r.rating, r.status AS review_status,
            r.created_at AS review_created_at, author.nickname AS author_name,
            e.id AS event_id, e.title AS event_title, e.slug AS event_slug,
            reporter.email AS reporter_email
     ${from}
      WHERE ${where}
      ORDER BY (c.status = 'open') DESC, c.created_at DESC
      LIMIT $3 OFFSET $4`,
    params,
  );

  const countQuery = pool.query<{ total: number; open_count: number }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE c.status = 'open')::int AS open_count
     ${from} WHERE ${where}`,
    [filter.query ?? null, filter.status ?? null],
  );

  const [list, counts] = await Promise.all([rowsQuery, countQuery]);
  return {
    rows: list.rows.map((row) => ({
      id: row.id,
      status: row.status,
      reason: row.reason,
      createdAt: row.created_at.toISOString(),
      resolvedAt: row.resolved_at?.toISOString() ?? null,
      resolutionNote: row.resolution_note,
      reviewId: row.review_id,
      reviewBody: row.review_body,
      reviewRating: row.rating,
      reviewStatus: row.review_status,
      reviewCreatedAt: row.review_created_at.toISOString(),
      authorName: row.author_name,
      eventId: row.event_id,
      eventTitle: row.event_title,
      eventSlug: row.event_slug,
      reporterEmail: row.reporter_email,
    })),
    total: counts.rows[0]?.total ?? 0,
    /*
     * Counted under the same filter as the page, not across the table: the number beside a filtered
     * list has to describe that list, or it contradicts what the reader is looking at.
     */
    openCount: counts.rows[0]?.open_count ?? 0,
  };
}

/**
 * The wallet ledger, newest first, with the gateway leg attached where there is one.
 *
 * This is the reconciliation view: a top-up that VNPay says succeeded and the ledger does not show
 * is the one case where money is genuinely missing, and it is invisible from any per-account screen.
 */
export async function walletTransactions(
  limit: number,
  kind?: string,
): Promise<AdminWalletTxRow[]> {
  const { rows } = await pool.query<{
    id: number;
    created_at: Date;
    kind: AdminWalletTxRow["kind"];
    amount: string;
    balance_after: string;
    user_email: string;
    order_code: string | null;
    provider_ref: string | null;
    provider_status: string | null;
  }>(
    `SELECT wt.id, wt.created_at, wt.kind, wt.amount::text, wt.balance_after::text,
            u.email AS user_email, o.order_code, pt.provider_txn_ref AS provider_ref,
            pt.status AS provider_status
       FROM wallet_transactions wt
       JOIN wallets w ON w.id = wt.wallet_id
       JOIN users u ON u.id = w.user_id
       LEFT JOIN orders o ON o.id = wt.order_id
       LEFT JOIN payment_transactions pt ON pt.id = wt.payment_transaction_id
      WHERE ($2::text IS NULL OR wt.kind = $2)
      ORDER BY wt.created_at DESC, wt.id DESC
      LIMIT $1`,
    [limit, kind ?? null],
  );
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at.toISOString(),
    kind: row.kind,
    amount: Number(row.amount),
    balanceAfter: Number(row.balance_after),
    userEmail: row.user_email,
    orderCode: row.order_code,
    providerRef: row.provider_ref,
    providerStatus: row.provider_status,
  }));
}
