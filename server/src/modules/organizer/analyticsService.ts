import { pool } from "../../db/pool.js";
import { err } from "../../http.js";
import type {
  AnalyticsFilterParams,
  OrganizerAnalyticsDashboardResponse,
  SoonestEventCapacity,
} from "../../../../shared/types/analytics.js";

function safeIsoDate(value: any): string {
  if (!value) return new Date().toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/**
 * The report's calendar is Vietnam's, not the server's (ORG-06).
 *
 * A "day" in this dashboard is a Vietnam wall-clock day. The old code parsed `YYYY-MM-DD` filter
 * values with `new Date(...)`, which reads them as 00:00 UTC of that date, then compared with an
 * INCLUSIVE `<=` end — so a same-day custom range covered exactly one UTC instant at midnight and
 * the chosen end date contributed nothing. Windows here are half-open `[start, end)` instants, and
 * a date-only bound expands to Vietnam midnight of that day (start) or of the NEXT day (end), so
 * "20/08 → 20/08" means the whole Vietnamese day. Vietnam has no DST — UTC+7 is always right — so
 * the arithmetic below is correct wherever the server itself happens to run.
 */
const REPORT_TZ = "Asia/Ho_Chi_Minh";
const ICT_OFFSET_MS = 7 * 3_600_000;

interface DayParts {
  y: number;
  m: number;
  d: number;
}

function parseDayParts(value: string): DayParts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const parts = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  // Reject calendar dates that roll over (2026-02-30 parses as 2 March in Date arithmetic) — a
  // report window built from a phantom day would silently shift by the overflow.
  const probe = new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
  if (
    probe.getUTCFullYear() !== parts.y ||
    probe.getUTCMonth() !== parts.m - 1 ||
    probe.getUTCDate() !== parts.d
  ) {
    return null;
  }
  return parts;
}

/** Vietnam midnight of a calendar day, as an instant. */
const ictDayStart = (p: DayParts) => new Date(Date.UTC(p.y, p.m - 1, p.d) - ICT_OFFSET_MS);
const ictNextDayStart = (p: DayParts) => new Date(Date.UTC(p.y, p.m - 1, p.d + 1) - ICT_OFFSET_MS);

/** A date-only string names a whole day; anything else must be an absolute instant. */
function parseWindowBound(value: string, side: "start" | "end"): Date | null {
  const day = parseDayParts(value);
  if (day) return side === "start" ? ictDayStart(day) : ictNextDayStart(day);
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** Parse date filter parameters into current & previous time windows, all half-open `[start, end)`. */
function resolveTimeWindows(filters: AnalyticsFilterParams) {
  const now = new Date();
  let currentStart: Date;
  let currentEnd: Date;

  if (filters.period === "this_month") {
    const today = new Date(now.getTime() + ICT_OFFSET_MS);
    currentStart = ictDayStart({ y: today.getUTCFullYear(), m: today.getUTCMonth() + 1, d: 1 });
    currentEnd = now;
  } else if (filters.period === "custom") {
    if (!filters.startDate || !filters.endDate) {
      currentStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      currentEnd = now;
    } else {
      const s = parseWindowBound(filters.startDate, "start");
      const e = parseWindowBound(filters.endDate, "end");
      if (!s || !e) {
        throw err.badRequest("validation_failed", "Khoảng ngày không hợp lệ.");
      }
      // A reversed range used to compute a negative duration, which `Math.max` flattened into an
      // EMPTY current window — the dashboard answered zeroes and looked like a quiet week instead
      // of a bad filter (ORG-06). Refusing is the honest answer.
      if (s.getTime() >= e.getTime()) {
        throw err.badRequest("validation_failed", "Ngày bắt đầu phải trước ngày kết thúc.");
      }
      currentStart = s;
      currentEnd = e;
    }
  } else {
    // Default 7d
    currentStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    currentEnd = now;
  }

  const durationMs = Math.max(1, currentEnd.getTime() - currentStart.getTime());
  const previousEnd = new Date(currentStart.getTime());
  const previousStart = new Date(currentStart.getTime() - durationMs);

  return { currentStart, currentEnd, previousStart, previousEnd };
}

/** Get approved organizer_id for a given user_id. */
async function getOrganizerId(userId: number): Promise<number | null> {
  const res = await pool.query(
    `SELECT id FROM organizers WHERE user_id = $1 AND status = 'approved'`,
    [userId],
  );
  return res.rows[0]?.id ? Number(res.rows[0].id) : null;
}

/**
 * Gross revenue, tickets and refunds for ONE window.
 *
 * Orders are aggregated BEFORE the tickets join (ORG-01): the old shape joined
 * events→showtimes→reservations→orders→tickets and then summed `o.final_total_cents` over the join,
 * so an order carrying N tickets contributed its total N times. Here each order row appears once;
 * its ticket count and refund sum arrive from a per-order aggregate, then everything sums.
 * Tickets of orders with no ticket row still leave the order counted once.
 */
function orderTotalsSql(eventFilterClause: string) {
  return `
    SELECT
        COALESCE(SUM(o.final_total_cents), 0)::bigint AS gross_revenue,
        COALESCE(SUM(per_order.ticket_count), 0)::int AS tickets_sold,
        COALESCE(SUM(per_order.refund_amount), 0)::bigint AS total_refunds
      FROM (
        SELECT DISTINCT o.id, o.final_total_cents
          FROM events e
          JOIN showtimes s ON s.event_id = e.id
          JOIN reservations r ON r.showtime_id = s.id
          JOIN orders o ON o.reservation_id = r.id
         WHERE e.organizer_id = $1
           AND o.payment_status IN ('paid', 'completed', 'refunded', 'partially_refunded')
           AND o.created_at >= $2 AND o.created_at < $3 ${eventFilterClause}
      ) o
      LEFT JOIN (
        SELECT order_id,
               COUNT(*)::int AS ticket_count,
               COALESCE(SUM(CASE WHEN qr_status = 'void' THEN COALESCE(refundable_amount, price_cents) ELSE 0 END), 0)::bigint AS refund_amount
          FROM tickets
         GROUP BY order_id
      ) per_order ON per_order.order_id = o.id`;
}

/**
 * One row per Vietnam calendar day of a window — INCLUDING days with no sales (ORG-14).
 *
 * The previous-period series used to be fabricated as `current * 0.8`, a baseline that moved with
 * the data it was supposed to compare against. Both windows are now queried with this same SQL and
 * aligned day-by-day; a day without orders is a real zero. `generate_series` over the day range is
 * what keeps empty days on the chart, and day boundaries use the report timezone so a sale at
 * 23:30 ICT lands on the day the organizer lived through.
 */
function dailySeriesSql(eventFilterClause: string) {
  return `
    WITH bounds AS (
      SELECT $2::timestamptz AS w_start, $3::timestamptz AS w_end
    ),
    days AS (
      SELECT d::date AS day
        FROM bounds b
        CROSS JOIN LATERAL generate_series(
          (b.w_start AT TIME ZONE '${REPORT_TZ}')::date,
          (GREATEST(b.w_end - interval '1 millisecond', b.w_start) AT TIME ZONE '${REPORT_TZ}')::date,
          '1 day'
        ) AS d
    ),
    daily AS (
      SELECT (o.created_at AT TIME ZONE '${REPORT_TZ}')::date AS day,
             SUM(o.final_total_cents)::bigint AS day_revenue,
             COALESCE(SUM(per_order.ticket_count), 0)::int AS day_tickets
        FROM (
          SELECT DISTINCT o.id, o.created_at, o.final_total_cents
            FROM events e
            JOIN showtimes s ON s.event_id = e.id
            JOIN reservations r ON r.showtime_id = s.id
            JOIN orders o ON o.reservation_id = r.id
           WHERE e.organizer_id = $1
             AND o.payment_status IN ('paid', 'completed', 'refunded', 'partially_refunded')
             AND o.created_at >= (SELECT w_start FROM bounds)
             AND o.created_at < (SELECT w_end FROM bounds) ${eventFilterClause}
        ) o
        LEFT JOIN (
          SELECT order_id, COUNT(*)::int AS ticket_count FROM tickets GROUP BY order_id
        ) per_order ON per_order.order_id = o.id
       GROUP BY 1
    )
    SELECT to_char(days.day, 'YYYY-MM-DD') AS day_str,
           to_char(days.day, 'DD/MM') AS day_label,
           COALESCE(daily.day_revenue, 0)::bigint AS day_revenue,
           COALESCE(daily.day_tickets, 0)::int AS day_tickets
      FROM days
      LEFT JOIN daily ON daily.day = days.day
     ORDER BY days.day`;
}

/** The tier capacity of one showtime: GA tiers carry quantity, seated tiers COUNT their seats. */
const SHOWTIME_CAPACITY_SUBQUERY = `
  SELECT COALESCE(SUM(
    CASE
      WHEN tt.total_quantity IS NOT NULL THEN tt.total_quantity
      ELSE (
        SELECT COUNT(*) FROM showtime_seats ss
         WHERE ss.ticket_tier_id = tt.id AND ss.status <> 'blocked'
      )
    END
  ), 0)::int
    FROM ticket_tiers tt
   WHERE tt.showtime_id = s.id`;

/** Paid, non-void tickets of one showtime. */
const SHOWTIME_SOLD_SUBQUERY = `
  SELECT COUNT(t2.id)::int
    FROM reservations r2
    JOIN orders o2 ON o2.reservation_id = r2.id AND o2.payment_status IN ('paid', 'completed')
    JOIN tickets t2 ON t2.order_id = o2.id AND t2.qr_status <> 'void'
   WHERE r2.showtime_id = s.id`;

export async function getOrganizerAnalyticsService(
  userId: number,
  filters: AnalyticsFilterParams = {},
): Promise<OrganizerAnalyticsDashboardResponse> {
  const organizerId = await getOrganizerId(userId);

  if (!organizerId) {
    return {
      overview: {
        gross_revenue_vnd: 0,
        total_refund_amount_vnd: 0,
        net_revenue_vnd: 0,
        total_tickets_sold: 0,
        total_capacity: 0,
        capacity_fill_rate: 0,
        event_counts_by_status: {
          draft: 0,
          pending_approval: 0,
          published: 0,
          canceled: 0,
          completed: 0,
        },
        period_comparison: {
          gross_revenue_change_pct: 0,
          tickets_sold_change_pct: 0,
          net_revenue_change_pct: 0,
        },
      },
      time_series: [],
      top_events: [],
      all_events: [],
      breakdowns: { by_tier: [], by_category: [] },
      soonest_event_capacity: { has_upcoming_event: false },
      recent_transactions: [],
    };
  }

  const { currentStart, currentEnd, previousStart, previousEnd } = resolveTimeWindows(filters);

  // 1. Fetch Event Status Counts
  const statusRes = await pool.query(
    `SELECT status, moderation_status, count(*)::int AS count
       FROM events
      WHERE organizer_id = $1
      GROUP BY status, moderation_status`,
    [organizerId],
  );

  let draftCount = 0;
  let pendingCount = 0;
  let publishedCount = 0;
  let canceledCount = 0;
  let completedCount = 0;

  for (const r of statusRes.rows) {
    const st = String(r.status);
    const mod = String(r.moderation_status);
    const cnt = Number(r.count);

    // The same precedence the organizer's event list uses (EventList badges): cancelled overrides
    // everything; a draft is a draft whatever moderation says; the rest is judged by moderation.
    // `moderation_status` defaults to 'pending_review' for EVERY row — checking it first counted
    // every never-submitted draft as "chờ duyệt" (ORG-13). Flagged/removed events sit with the
    // admin rather than selling, so they land in the pending bucket with the ones being reviewed.
    if (st === "cancelled") {
      canceledCount += cnt;
    } else if (st === "draft") {
      draftCount += cnt;
    } else if (st === "finished") {
      completedCount += cnt;
    } else if (mod === "approved") {
      publishedCount += cnt;
    } else {
      pendingCount += cnt;
    }
  }

  // Event ID filter constraint
  const eventFilterClause =
    filters.eventId && filters.eventId !== "all" && !Number.isNaN(Number(filters.eventId))
      ? ` AND e.id = ${Number(filters.eventId)}`
      : "";

  // 2. Fetch Gross Revenue & Refund Aggregations (Current Window) — ORG-01: order-first aggregation
  const currentSalesRes = await pool.query(orderTotalsSql(eventFilterClause), [
    organizerId,
    currentStart.toISOString(),
    currentEnd.toISOString(),
  ]);

  const grossRevCurrent = Number(currentSalesRes.rows[0]?.gross_revenue || 0);
  const ticketsSoldCurrent = Number(currentSalesRes.rows[0]?.tickets_sold || 0);
  const refundsCurrent = Number(currentSalesRes.rows[0]?.total_refunds || 0);
  const netRevCurrent = Math.max(0, grossRevCurrent - refundsCurrent);

  // 3. Fetch Previous Window for Period Comparison Delta — same order-first shape, real numbers
  const previousSalesRes = await pool.query(orderTotalsSql(eventFilterClause), [
    organizerId,
    previousStart.toISOString(),
    previousEnd.toISOString(),
  ]);

  const grossRevPrev = Number(previousSalesRes.rows[0]?.gross_revenue || 0);
  const ticketsSoldPrev = Number(previousSalesRes.rows[0]?.tickets_sold || 0);
  const refundsPrev = Number(previousSalesRes.rows[0]?.total_refunds || 0);
  const netRevPrev = Math.max(0, grossRevPrev - refundsPrev);

  const calcPctChange = (curr: number, prev: number) => {
    if (prev === 0) return curr > 0 ? 100 : 0;
    return Number((((curr - prev) / prev) * 100).toFixed(1));
  };

  // 4. Capacity Fill Rate Calculation (ORG-05: the two figures are computed by separate scans)
  //
  // The old query joined tiers to reservation_items to tickets BEFORE summing capacity, so each
  // tier row duplicated per ticket and `total_quantity` was added once per copy — an event with
  // 50 seats and 2 sold tickets reported capacity 100 and a 2% fill rate. Capacity is a fact about
  // TIERS alone; sold tickets a fact about paid, non-void TICKETS alone. The payment filter also
  // moves onto the orders JOIN instead of a LEFT JOIN, where it was ineffective.
  const capacityRes = await pool.query(
    `SELECT COALESCE(SUM(
        CASE
          WHEN tt.total_quantity IS NOT NULL THEN tt.total_quantity
          ELSE (
            SELECT COUNT(*) FROM showtime_seats ss
             WHERE ss.ticket_tier_id = tt.id AND ss.status <> 'blocked'
          )
        END
      ), 0)::int AS total_capacity
       FROM events e
       JOIN showtimes s ON s.event_id = e.id
       JOIN ticket_tiers tt ON tt.showtime_id = s.id
      WHERE e.organizer_id = $1 ${eventFilterClause}`,
    [organizerId],
  );
  const soldRes = await pool.query(
    `SELECT COUNT(t.id)::int AS lifetime_tickets_sold
       FROM events e
       JOIN showtimes s ON s.event_id = e.id
       JOIN reservations r ON r.showtime_id = s.id
       JOIN orders o ON o.reservation_id = r.id AND o.payment_status IN ('paid', 'completed')
       JOIN tickets t ON t.order_id = o.id AND t.qr_status <> 'void'
      WHERE e.organizer_id = $1 ${eventFilterClause}`,
    [organizerId],
  );
  const totalCapacity = Number(capacityRes.rows[0]?.total_capacity || 0);
  const lifetimeTicketsSold = Number(soldRes.rows[0]?.lifetime_tickets_sold || 0);
  const fillRatePct =
    totalCapacity > 0 ? Number(((lifetimeTicketsSold / totalCapacity) * 100).toFixed(1)) : 0;

  // 5. Time-Series Daily Trend Points — both windows queried for real, aligned day by day (ORG-14)
  const timeSeriesRes = await pool.query(dailySeriesSql(eventFilterClause), [
    organizerId,
    currentStart.toISOString(),
    currentEnd.toISOString(),
  ]);
  const prevSeriesRes = await pool.query(dailySeriesSql(eventFilterClause), [
    organizerId,
    previousStart.toISOString(),
    previousEnd.toISOString(),
  ]);

  const timeSeries = timeSeriesRes.rows.map((row, i) => {
    const prev = prevSeriesRes.rows[i];
    return {
      date: String(row.day_str),
      label: String(row.day_label),
      current_revenue_vnd: Number(row.day_revenue || 0),
      current_tickets_sold: Number(row.day_tickets || 0),
      previous_revenue_vnd: Number(prev?.day_revenue || 0),
      previous_tickets_sold: Number(prev?.day_tickets || 0),
    };
  });

  // 6. Top Events Ranking
  const topEventsRes = await pool.query(
    `SELECT 
        e.id,
        e.title,
        e.status,
        COALESCE(ec.label_vi, 'Khác') AS category,
        COALESCE((
          SELECT SUM(
            CASE
              WHEN tt.total_quantity IS NOT NULL THEN tt.total_quantity
              ELSE (
                SELECT COUNT(*) FROM showtime_seats ss
                 WHERE ss.ticket_tier_id = tt.id AND ss.status <> 'blocked'
              )
            END
          )
            FROM showtimes s2
            JOIN ticket_tiers tt ON tt.showtime_id = s2.id
           WHERE s2.event_id = e.id
        ), 0)::int AS total_capacity,
        COALESCE((
          SELECT COUNT(t2.id)
            FROM showtimes s2
            JOIN reservations r2 ON r2.showtime_id = s2.id
            JOIN orders o2 ON o2.reservation_id = r2.id AND o2.payment_status IN ('paid', 'completed')
            JOIN tickets t2 ON t2.order_id = o2.id AND t2.qr_status <> 'void'
           WHERE s2.event_id = e.id
        ), 0)::int AS tickets_sold,
        COALESCE((
          SELECT SUM(t2.price_cents)
            FROM showtimes s2
            JOIN reservations r2 ON r2.showtime_id = s2.id
            JOIN orders o2 ON o2.reservation_id = r2.id AND o2.payment_status IN ('paid', 'completed', 'refunded', 'partially_refunded')
            JOIN tickets t2 ON t2.order_id = o2.id
           WHERE s2.event_id = e.id
        ), 0)::bigint AS gross_revenue_vnd
       FROM events e
       LEFT JOIN event_categories ec ON ec.id = e.category_id
      WHERE e.organizer_id = $1 ${eventFilterClause}
      ORDER BY gross_revenue_vnd DESC
      LIMIT 5`,
    [organizerId],
  );

  const topEvents = topEventsRes.rows.map((r) => {
    const rev = Number(r.gross_revenue_vnd || 0);
    const sold = Number(r.tickets_sold || 0);
    const cap = Number(r.total_capacity || 0);
    const statusMap: Record<string, any> = {
      draft: "Draft",
      on_sale: "Published",
      cancelled: "Canceled",
      finished: "Completed",
    };
    return {
      event_id: String(r.id),
      event_title: String(r.title),
      category: String(r.category || "Khác"),
      status: (statusMap[r.status] || "Draft") as any,
      gross_revenue_vnd: rev,
      tickets_sold: sold,
      total_capacity: cap,
      fill_percentage: cap > 0 ? Number(((sold / cap) * 100).toFixed(1)) : 0,
    };
  });

  // 7. Donut Breakdowns (Tier & Category)
  const tierBreakdownRes = await pool.query(
    `SELECT 
        COALESCE(tt.label, 'Tiêu chuẩn') AS tier_name,
        COALESCE(SUM(t.price_cents), 0)::bigint AS revenue_vnd,
        COALESCE(COUNT(t.id), 0)::int AS tickets_sold
       FROM events e
       JOIN showtimes s ON s.event_id = e.id
       JOIN ticket_tiers tt ON tt.showtime_id = s.id
       JOIN reservation_items ri ON ri.ticket_tier_id = tt.id
       JOIN tickets t ON t.reservation_item_id = ri.id
       JOIN orders o ON o.id = t.order_id AND o.payment_status IN ('paid', 'completed', 'refunded', 'partially_refunded')
      WHERE e.organizer_id = $1
        AND o.created_at >= $2 AND o.created_at < $3 ${eventFilterClause}
      GROUP BY tt.label`,
    [organizerId, currentStart.toISOString(), currentEnd.toISOString()],
  );

  const totalTierRevenue = tierBreakdownRes.rows.reduce(
    (acc, r) => acc + Number(r.revenue_vnd || 0),
    0,
  );

  const tierBreakdown = tierBreakdownRes.rows.map((r) => {
    const rev = Number(r.revenue_vnd || 0);
    return {
      tier_name: String(r.tier_name),
      revenue_vnd: rev,
      tickets_sold: Number(r.tickets_sold || 0),
      percentage_share:
        totalTierRevenue > 0 ? Number(((rev / totalTierRevenue) * 100).toFixed(1)) : 0,
    };
  });

  const categoryBreakdownRes = await pool.query(
    `SELECT 
        COALESCE(ec.label_vi, 'Khác') AS category_name,
        COALESCE(SUM(t.price_cents), 0)::bigint AS revenue_vnd,
        COALESCE(COUNT(t.id), 0)::int AS tickets_sold
       FROM events e
       LEFT JOIN event_categories ec ON ec.id = e.category_id
       LEFT JOIN showtimes s ON s.event_id = e.id
       LEFT JOIN reservations r ON r.showtime_id = s.id
       LEFT JOIN orders o ON o.reservation_id = r.id AND o.payment_status IN ('paid', 'completed', 'refunded', 'partially_refunded')
       LEFT JOIN tickets t ON t.order_id = o.id
      WHERE e.organizer_id = $1
        AND o.created_at >= $2 AND o.created_at < $3 ${eventFilterClause}
      GROUP BY COALESCE(ec.label_vi, 'Khác')`,
    [organizerId, currentStart.toISOString(), currentEnd.toISOString()],
  );

  const totalCatRevenue = categoryBreakdownRes.rows.reduce(
    (acc, r) => acc + Number(r.revenue_vnd || 0),
    0,
  );

  const categoryBreakdown = categoryBreakdownRes.rows.map((r) => {
    const rev = Number(r.revenue_vnd || 0);
    return {
      category: String(r.category_name),
      revenue_vnd: rev,
      tickets_sold: Number(r.tickets_sold || 0),
      percentage_share:
        totalCatRevenue > 0 ? Number(((rev / totalCatRevenue) * 100).toFixed(1)) : 0,
    };
  });

  // 8. Soonest Upcoming Event Capacity Gauge
  //
  // ORG-05's second site: capacity and sold came out of one join chain (tiers × reservations ×
  // orders × tickets), multiplying the tier total per joined row. Both now come from per-showtime
  // subqueries, and cancelled/finished showtimes can no longer present themselves as "next up".
  const upcomingRes = await pool.query(
    `SELECT 
        e.id,
        e.title,
        COALESCE(ec.label_vi, 'Khác') AS category,
        s.starts_at,
        COALESCE((${SHOWTIME_CAPACITY_SUBQUERY}), 0)::int AS capacity,
        COALESCE((${SHOWTIME_SOLD_SUBQUERY}), 0)::int AS sold
       FROM events e
       JOIN showtimes s ON s.event_id = e.id
       LEFT JOIN event_categories ec ON ec.id = e.category_id
      WHERE e.organizer_id = $1
        AND e.status IN ('on_sale', 'draft')
        AND s.status NOT IN ('cancelled', 'finished')
        AND s.starts_at > NOW()
      ORDER BY s.starts_at ASC
      LIMIT 1`,
    [organizerId],
  );

  let soonestCapacity: SoonestEventCapacity = { has_upcoming_event: false };
  if (upcomingRes.rows.length > 0) {
    const r = upcomingRes.rows[0];
    // No `|| 100` fallback: an event with zero sellable capacity is at 0%, not 100 seats — the old
    // fallback fired whenever capacity was exactly 0, because `0 || 100` is 100.
    const cap = Number(r.capacity);
    const sold = Number(r.sold || 0);
    soonestCapacity = {
      has_upcoming_event: true,
      event_id: String(r.id),
      event_title: String(r.title),
      category: String(r.category),
      start_date: safeIsoDate(r.starts_at),
      sold_tickets: sold,
      total_capacity: cap,
      fill_percentage: cap > 0 ? Number(((sold / cap) * 100).toFixed(1)) : 0,
    };
  }

  // 9. Recent Transactions Audit Table
  //
  // One row per ORDER (A6): the old shape left-joined tickets onto orders, so a 3-ticket order
  // printed three rows repeating the order total, and with no payment filter at all — failed and
  // cancelled checkouts sat in the sales ledger next to real money.
  const recentTxRes = await pool.query(
    `SELECT 
        o.order_code AS order_id,
        COALESCE((
          SELECT t2.barcode_value
            FROM tickets t2
           WHERE t2.order_id = o.id AND t2.qr_status <> 'void'
           ORDER BY t2.id
           LIMIT 1
        ), CONCAT('TKT-', o.id)) AS ticket_id,
        e.title AS event_name,
        COALESCE((
          SELECT tt.label
            FROM tickets t2
            JOIN reservation_items ri ON ri.id = t2.reservation_item_id
            JOIN ticket_tiers tt ON tt.id = ri.ticket_tier_id
           WHERE t2.order_id = o.id
           ORDER BY t2.id
           LIMIT 1
        ), 'Vé tiêu chuẩn') AS tier_name,
        o.final_total_cents AS amount_vnd,
        o.created_at AS purchase_timestamp,
        o.payment_status,
        COALESCE((
          SELECT SUM(CASE WHEN t2.qr_status = 'void' THEN COALESCE(t2.refundable_amount, t2.price_cents) ELSE 0 END)
            FROM tickets t2
           WHERE t2.order_id = o.id
        ), 0)::bigint AS refund_amount_vnd
       FROM orders o
       JOIN reservations r ON r.id = o.reservation_id
       JOIN showtimes s ON s.id = r.showtime_id
       JOIN events e ON e.id = s.event_id
      WHERE e.organizer_id = $1
        AND o.payment_status IN ('paid', 'completed', 'refunded', 'partially_refunded')
        AND o.created_at >= $2 AND o.created_at < $3 ${eventFilterClause}
      ORDER BY o.created_at DESC
      LIMIT 200`,
    [organizerId, currentStart.toISOString(), currentEnd.toISOString()],
  );

  const recentTransactions = recentTxRes.rows.map((r) => {
    let status: "COMPLETED" | "REFUNDED" | "CANCELED" = "COMPLETED";
    if (r.payment_status === "refunded" || r.payment_status === "partially_refunded") {
      status = "REFUNDED";
    }
    return {
      order_id: String(r.order_id),
      ticket_id: String(r.ticket_id || `TKT-${r.order_id}`),
      event_name: String(r.event_name),
      tier_name: String(r.tier_name),
      amount_vnd: Number(r.amount_vnd || 0),
      purchase_timestamp: safeIsoDate(r.purchase_timestamp),
      payment_status: status,
      refund_amount_vnd: Number(r.refund_amount_vnd || 0),
    };
  });

  // 10. All Events List (Unfiltered for Dropdown Options)
  const allEventsRes = await pool.query(
    `SELECT id, title
       FROM events
      WHERE organizer_id = $1
      ORDER BY created_at DESC`,
    [organizerId],
  );

  const allEvents = allEventsRes.rows.map((r) => ({
    event_id: String(r.id),
    event_title: String(r.title),
  }));

  // 11. Check-In & Attendance Statistics
  const checkinRes = await pool.query(
    `SELECT 
        COALESCE(COUNT(t.id), 0)::int AS total_issued,
        COALESCE(COUNT(CASE WHEN t.qr_status = 'checked_in' THEN 1 END), 0)::int AS total_scanned
       FROM events e
       JOIN showtimes s ON s.event_id = e.id
       JOIN reservations r ON r.showtime_id = s.id
       JOIN orders o ON o.reservation_id = r.id AND o.payment_status IN ('paid', 'completed')
       JOIN tickets t ON t.order_id = o.id AND t.qr_status != 'void'
      WHERE e.organizer_id = $1 ${eventFilterClause}`,
    [organizerId],
  );

  const totalIssuedTickets = Number(checkinRes.rows[0]?.total_issued || 0);
  const totalScannedTickets = Number(checkinRes.rows[0]?.total_scanned || 0);
  const checkinRatePct =
    totalIssuedTickets > 0
      ? Number(((totalScannedTickets / totalIssuedTickets) * 100).toFixed(1))
      : 0;

  return {
    overview: {
      gross_revenue_vnd: grossRevCurrent,
      total_refund_amount_vnd: refundsCurrent,
      net_revenue_vnd: netRevCurrent,
      total_tickets_sold: ticketsSoldCurrent,
      total_capacity: totalCapacity,
      capacity_fill_rate: fillRatePct,
      event_counts_by_status: {
        draft: draftCount,
        pending_approval: pendingCount,
        published: publishedCount,
        canceled: canceledCount,
        completed: completedCount,
      },
      period_comparison: {
        gross_revenue_change_pct: calcPctChange(grossRevCurrent, grossRevPrev),
        tickets_sold_change_pct: calcPctChange(ticketsSoldCurrent, ticketsSoldPrev),
        net_revenue_change_pct: calcPctChange(netRevCurrent, netRevPrev),
      },
    },
    time_series: timeSeries,
    top_events: topEvents,
    all_events: allEvents,
    breakdowns: {
      by_tier: tierBreakdown,
      by_category: categoryBreakdown,
    },
    soonest_event_capacity: soonestCapacity,
    recent_transactions: recentTransactions,
    checkin_stats: {
      total_scanned: totalScannedTickets,
      checkin_rate_pct: checkinRatePct,
    },
  };
}
