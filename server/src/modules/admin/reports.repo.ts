import type {
  ContentReportDetail,
  ContentReportPage,
  ContentReportRow,
  ReportedEvent,
  ReportedReview,
} from "@shared/admin/types.js";
import { pool } from "../../db/pool.js";
import { err } from "../../http.js";

/*
 * Reported *events* (UC-39 → UC-34).
 *
 * Comments have their own screen; this is the other half of the same queue. Both are rows in
 * `content_reports` and both resolve through the same two endpoints — what differs is the thing
 * being judged, and therefore what has to be on screen to judge it.
 */

export interface ContentReportFilter {
  /** Matched against the event's title. */
  query?: string;
  /** `open` = waiting; `flagged` / `resolved` / `dismissed` = the decision that was taken. */
  status?: "open" | "flagged" | "resolved" | "dismissed";
  limit: number;
  offset: number;
}

export async function eventReports(filter: ContentReportFilter): Promise<ContentReportPage> {
  const from = `FROM content_reports c
       JOIN events e ON e.id = c.target_id
       JOIN organizers org ON org.id = e.organizer_id
       JOIN users reporter ON reporter.id = c.reporter_user_id`;
  const where = `c.target_type = 'event'
        AND ($1::text IS NULL OR e.title ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR c.status = $2)`;
  const params = [filter.query ?? null, filter.status ?? null, filter.limit, filter.offset];

  const rowsQuery = pool.query<{
    id: number;
    status: ContentReportRow["status"];
    reason: string;
    created_at: Date;
    resolved_at: Date | null;
    resolution_note: string | null;
    reporter_email: string;
    event_id: number;
    event_title: string;
    event_slug: string;
    event_status: string;
    event_moderation: ContentReportRow["eventModeration"];
    open_for_target: number;
  }>(
    `SELECT c.id, c.status, c.reason, c.created_at, c.resolved_at, c.resolution_note,
            reporter.email AS reporter_email,
            e.id AS event_id, e.title AS event_title, e.slug AS event_slug,
            e.status AS event_status, e.moderation_status AS event_moderation,
            (SELECT count(*)::int FROM content_reports o
              WHERE o.target_type = 'event' AND o.target_id = c.target_id AND o.status = 'open')
              AS open_for_target
     ${from}
      WHERE ${where}
      ORDER BY (c.status = 'open') DESC, c.created_at DESC
      LIMIT $3 OFFSET $4`,
    params,
  );

  const countQuery = pool.query<{ total: number; open_count: number }>(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE c.status = 'open')::int AS open_count
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
      reporterEmail: row.reporter_email,
      eventId: row.event_id,
      eventTitle: row.event_title,
      eventSlug: row.event_slug,
      eventStatus: row.event_status,
      eventModeration: row.event_moderation,
      openCountForTarget: row.open_for_target,
    })),
    total: counts.rows[0]?.total ?? 0,
    openCount: counts.rows[0]?.open_count ?? 0,
  };
}

/**
 * One report, with the thing it is about.
 *
 * The event is read straight from its own row rather than through the catalogue's reader: that one
 * composes the public visibility predicate, so a flagged or removed event — precisely the one an
 * admin has come to look at — would come back empty.
 */
export async function reportDetail(id: number): Promise<ContentReportDetail> {
  const head = await pool.query<{
    id: number;
    status: ContentReportDetail["status"];
    reason: string;
    created_at: Date;
    resolved_at: Date | null;
    resolution_note: string | null;
    reporter_email: string;
    target_type: "event" | "review";
    target_id: number;
  }>(
    `SELECT c.id, c.status, c.reason, c.created_at, c.resolved_at, c.resolution_note,
            u.email AS reporter_email, c.target_type, c.target_id
       FROM content_reports c JOIN users u ON u.id = c.reporter_user_id
      WHERE c.id = $1`,
    [id],
  );
  const report = head.rows[0];
  if (!report) throw err.notFound("not_found", "Không tìm thấy tố cáo này.");

  const others = await pool.query<{
    id: number;
    reason: string;
    created_at: Date;
    email: string;
    status: string;
  }>(
    `SELECT c.id, c.reason, c.created_at, u.email, c.status
       FROM content_reports c JOIN users u ON u.id = c.reporter_user_id
      WHERE c.target_type = $1 AND c.target_id = $2 AND c.id <> $3
      ORDER BY c.created_at DESC LIMIT 20`,
    [report.target_type, report.target_id, report.id],
  );

  const target =
    report.target_type === "event"
      ? await eventTarget(report.target_id)
      : await reviewTarget(report.target_id);

  return {
    id: report.id,
    status: report.status,
    reason: report.reason,
    createdAt: report.created_at.toISOString(),
    resolvedAt: report.resolved_at?.toISOString() ?? null,
    resolutionNote: report.resolution_note,
    reporterEmail: report.reporter_email,
    otherReports: others.rows.map((row) => ({
      id: row.id,
      reason: row.reason,
      createdAt: row.created_at.toISOString(),
      reporterEmail: row.email,
      status: row.status,
    })),
    target,
  };
}

async function eventTarget(eventId: number): Promise<ReportedEvent> {
  const { rows } = await pool.query<{
    id: number;
    slug: string;
    title: string;
    description: string;
    image_url: string | null;
    category: string;
    organizer: string;
    organizer_id: number;
    status: string;
    moderation_status: ReportedEvent["moderationStatus"];
    review_note: string | null;
    age_restriction: string;
    created_at: Date;
    price_from: string | null;
    price_to: string | null;
    tickets_sold: number;
  }>(
    `SELECT e.id, e.slug, e.title, e.description, e.image_url,
            cat.label_vi AS category, org.display_name AS organizer, org.id AS organizer_id,
            e.status, e.moderation_status, e.review_note, e.age_restriction, e.created_at,
            (SELECT min(tt.price_amount)::text FROM ticket_tiers tt
               JOIN showtimes s ON s.id = tt.showtime_id WHERE s.event_id = e.id) AS price_from,
            (SELECT max(tt.price_amount)::text FROM ticket_tiers tt
               JOIN showtimes s ON s.id = tt.showtime_id WHERE s.event_id = e.id) AS price_to,
            (SELECT count(*)::int FROM tickets t
               JOIN orders o ON o.id = t.order_id
               JOIN reservations r ON r.id = o.reservation_id
               JOIN showtimes s ON s.id = r.showtime_id
              WHERE s.event_id = e.id AND t.qr_status <> 'void'
                AND o.payment_status IN ('paid', 'partially_refunded')) AS tickets_sold
       FROM events e
       JOIN organizers org ON org.id = e.organizer_id
       JOIN event_categories cat ON cat.id = e.category_id
      WHERE e.id = $1`,
    [eventId],
  );
  const event = rows[0];
  if (!event) throw err.notFound("not_found", "Sự kiện của tố cáo này không còn tồn tại.");

  const showtimes = await pool.query<{
    id: number;
    starts_at: Date;
    venue: string;
    city: string;
  }>(
    `SELECT s.id, s.starts_at, v.name AS venue, v.city
       FROM showtimes s JOIN venues v ON v.id = s.venue_id
      WHERE s.event_id = $1 ORDER BY s.starts_at LIMIT 12`,
    [eventId],
  );

  return {
    kind: "event",
    eventId: event.id,
    slug: event.slug,
    title: event.title,
    description: event.description,
    imageUrl: event.image_url,
    category: event.category,
    organizer: event.organizer,
    organizerId: event.organizer_id,
    status: event.status,
    moderationStatus: event.moderation_status,
    reviewNote: event.review_note,
    ageRestriction: event.age_restriction,
    createdAt: event.created_at.toISOString(),
    showtimes: showtimes.rows.map((row) => ({
      id: row.id,
      startsAt: row.starts_at.toISOString(),
      venue: row.venue,
      city: row.city,
    })),
    priceFrom: event.price_from === null ? null : Number(event.price_from),
    priceTo: event.price_to === null ? null : Number(event.price_to),
    ticketsSold: event.tickets_sold,
  };
}

async function reviewTarget(reviewId: number): Promise<ReportedReview> {
  const { rows } = await pool.query<{
    id: number;
    body: string | null;
    rating: number;
    status: ReportedReview["status"];
    created_at: Date;
    author_name: string | null;
    event_id: number;
    event_title: string;
    event_slug: string;
  }>(
    `SELECT r.id, r.body, r.rating, r.status, r.created_at, u.nickname AS author_name,
            e.id AS event_id, e.title AS event_title, e.slug AS event_slug
       FROM event_reviews r
       JOIN events e ON e.id = r.event_id
       LEFT JOIN users u ON u.id = r.user_id
      WHERE r.id = $1`,
    [reviewId],
  );
  const review = rows[0];
  if (!review) throw err.notFound("not_found", "Bình luận của tố cáo này không còn tồn tại.");
  return {
    kind: "review",
    reviewId: review.id,
    body: review.body,
    rating: review.rating,
    status: review.status,
    createdAt: review.created_at.toISOString(),
    authorName: review.author_name,
    eventId: review.event_id,
    eventTitle: review.event_title,
    eventSlug: review.event_slug,
  };
}
