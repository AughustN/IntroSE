export type OrganizerStatus = "pending" | "approved" | "rejected" | "suspended";
export type EventModerationStatus = "pending_review" | "approved" | "flagged" | "removed";
export type AuditOutcome = "applied" | "conflict" | "rejected";

export interface OrganizerQueueItem {
  id: number;
  userId: number;
  displayName: string;
  description: string | null;
  status: OrganizerStatus;
  reviewNote: string | null;
  appliedAt: string;
}

export interface EventModerationItem {
  id: number;
  slug: string;
  title: string;
  status: string;
  moderation: EventModerationStatus;
  organizer: string;
  reviewNote: string | null;
  createdAt: string;
}

/**
 * An open report, carrying enough of what was reported for an admin to judge it without leaving.
 *
 * The server has always sent the four fields below; the type stopped at the ids, so the console
 * showed "Tố cáo review #418" and an admin had to go and find the comment themselves.
 */
export interface ContentReportItem {
  id: number;
  targetType: "event" | "review";
  targetId: number;
  reason: string;
  status: string;
  createdAt: string;
  /** The event's title — its own for an event report, the host event's for a review. */
  targetTitle: string | null;
  /** Reviews only: what was written, who wrote it, and whether it is still visible. */
  targetBody: string | null;
  targetAuthor: string | null;
  targetStatus: string | null;
}

export interface AdminModerationQueue {
  organizers: OrganizerQueueItem[];
  /** The approval inbox only — events waiting on a decision (UC-34). */
  events: EventModerationItem[];
  /** Every event that has been approved; flagged/removed rows stay for watch and takedown. */
  approvedEvents: EventModerationItem[];
  reports: ContentReportItem[];
}

export interface ModerationActionBody {
  reason?: string;
  actionKey?: string;
}

export interface AuditLog {
  id: number;
  actorUserId: number;
  action: string;
  targetType: string;
  targetId: number | null;
  outcome: AuditOutcome;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface AdminCategory {
  id: number;
  code: string;
  labelVi: string;
  labelEn: string | null;
}

export interface FeaturedEvent {
  eventId: number;
  displayOrder: number;
  slug: string;
  title: string;
  imageUrl: string | null;
}

export interface FeaturedEventInput {
  eventId: number;
  displayOrder: number;
}

export interface SystemSettings {
  seat_hold_ttl_minutes: number;
  topup_grace_minutes: number;
  absolute_ceiling_minutes: number;
  max_tickets_per_buyer: number;
  wallet_topup_min: number;
  wallet_topup_max: number;
  wallet_balance_ceiling: number;
  ai_features_enabled: boolean;
  /** Model-backed AI requests permitted per window across all attendees. 0 stops external calls. */
  ai_platform_request_ceiling: number;
  /** Length of that window, in hours. */
  ai_platform_window_hours: number;
}

export type SystemSettingKey = keyof SystemSettings;

/*
 * ── The console's read models (UC-31, UC-32) ────────────────────────────────────────────────────
 *
 * Every figure below is aggregated on the server. The console used to compute revenue from the
 * browser's own booking history, so two admins signed in at once saw two different numbers and
 * neither matched the database.
 *
 * Money is a whole number of VND đồng, as everywhere else. "Revenue" counts tickets that still
 * exist: cancelling a ticket voids it (`qr_status = 'void'`), so a refunded seat leaves the total
 * on its own rather than needing a second subtraction.
 */

export interface DayPoint {
  /** `YYYY-MM-DD`, Vietnam calendar day. */
  day: string;
  amount: number;
  tickets: number;
}

export interface CategorySlice {
  code: string;
  label: string;
  tickets: number;
}

/**
 * One day's audience: the people active that day, and the rolling month ending on it.
 *
 * `mau` is a 30-day trailing window per point rather than one figure for the whole chart, so the
 * two lines can be read against each other — the gap between them is churn, and the ratio is how
 * often a returning user actually returns.
 */
export interface ActivityPoint {
  day: string;
  dau: number;
  mau: number;
}

export interface AdminOverview {
  /** Ticket commission **plus** advertising sales — everything the platform earned. */
  revenue30d: number;
  revenuePrev30d: number;
  /** The advertising half of `revenue30d`, so the overview can say how much of it was ads. */
  adRevenue30d: number;
  ticketsSold30d: number;
  ticketsSoldPrev30d: number;
  pendingEvents: number;
  pendingOrganizers: number;
  openReports: number;
  /** Share of admitted tickets actually scanned, over showtimes that have started. `null` if none. */
  checkedInRate: number | null;
  liveEvents: number;
  revenueByDay: DayPoint[];
  ticketsByCategory: CategorySlice[];
  /** Active users per day for the last 30 days (0035). */
  activityByDay: ActivityPoint[];
}

export interface AnalyticsRow {
  eventId: number;
  eventTitle: string;
  organizerId: number;
  organizer: string;
  category: string;
  tickets: number;
  revenue: number;
  checkedIn: number;
}

export interface AdminAnalytics {
  from: string;
  to: string;
  totals: { tickets: number; revenue: number; checkedIn: number; events: number };
  rows: AnalyticsRow[];
  byDay: DayPoint[];
}

export interface AdminOrderRow {
  id: number;
  code: string;
  createdAt: string;
  customerName: string;
  customerEmail: string;
  eventTitle: string;
  startsAt: string;
  tickets: number;
  voidTickets: number;
  total: number;
  paymentStatus: string;
  paymentMethod: string;
}

export interface AdminOrderPage {
  rows: AdminOrderRow[];
  total: number;
}

export interface AdminWalletTxRow {
  id: number;
  createdAt: string;
  /** `ad_purchase`/`ad_refund` are an organizer's promotion packages (0033), on the same ledger. */
  kind: "topup" | "purchase" | "refund" | "ad_purchase" | "ad_refund";
  /** Signed: top-up and refund positive, purchase negative. */
  amount: number;
  balanceAfter: number;
  userEmail: string;
  orderCode: string | null;
  /** The promoted event, on the ad rows — what the reference column shows instead of an order. */
  adEventTitle: string | null;
  /** The gateway leg, when the row has one (top-ups do). */
  providerRef: string | null;
  providerStatus: string | null;
}

/**
 * The ledger, and what it sums to.
 *
 * `totals` is aggregated over the WHOLE ledger, not over `rows`. The console used to add up the two
 * hundred transactions it had fetched and label the result "Tiền nạp vào" — so the tiles were a
 * window presented as a total, and filtering by kind zeroed three of the four.
 *
 * `kind` narrows only the rows. The totals answer "what has moved through the platform", which is
 * not a question about which slice the reader is currently looking at.
 */
export interface AdminWalletPage {
  rows: AdminWalletTxRow[];
  totals: {
    topup: number;
    purchase: number;
    refund: number;
    adPurchase: number;
    adRefund: number;
    /** Rows in the whole ledger, so the screen can say how much of it the page is showing. */
    count: number;
  };
}

/**
 * One reported comment, with everything needed to judge it in the row (UC-39 → UC-34).
 *
 * The moderation queue only ever returned *open* reports, so an admin could not see what had
 * already been decided — and a report closed by mistake was gone from every screen. This carries
 * the outcome as well, which is why it has its own type rather than reusing `ContentReportItem`.
 */
export interface ReviewReportRow {
  id: number;
  /** `open` while it waits; anything else means somebody has decided. */
  status: "open" | "dismissed" | "flagged" | "resolved";
  reason: string;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  reviewId: number;
  reviewBody: string | null;
  reviewRating: number;
  /** `removed` means the comment is already hidden from the event page. */
  reviewStatus: "visible" | "removed";
  reviewCreatedAt: string;
  /** Null when the author has since deleted their account — the comment outlives them. */
  authorName: string | null;
  eventId: number;
  eventTitle: string;
  eventSlug: string;
  reporterEmail: string;
}

export interface ReviewReportPage {
  rows: ReviewReportRow[];
  total: number;
  /** How many are still waiting, whatever this page is filtered to. */
  openCount: number;
}

/** One reported event in the queue list (UC-39 → UC-34). */
export interface ContentReportRow {
  id: number;
  status: "open" | "dismissed" | "flagged" | "resolved";
  reason: string;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  reporterEmail: string;
  eventId: number;
  eventTitle: string;
  eventSlug: string;
  /** The event's own state, so the list says whether the decision has already bitten. */
  eventStatus: string;
  eventModeration: "pending_review" | "approved" | "flagged" | "removed";
  /** How many readers have reported this same event and are still waiting. */
  openCountForTarget: number;
}

export interface ContentReportPage {
  rows: ContentReportRow[];
  total: number;
  openCount: number;
}

/** The event behind a report, as much of it as judging needs — and no booking controls. */
export interface ReportedEvent {
  kind: "event";
  eventId: number;
  slug: string;
  title: string;
  description: string;
  imageUrl: string | null;
  category: string;
  organizer: string;
  organizerId: number;
  status: string;
  moderationStatus: "pending_review" | "approved" | "flagged" | "removed";
  reviewNote: string | null;
  ageRestriction: string;
  createdAt: string;
  showtimes: Array<{ id: number; startsAt: string; venue: string; city: string }>;
  priceFrom: number | null;
  priceTo: number | null;
  ticketsSold: number;
}

/**
 * One organizer, in full, for an admin to read before approving or suspending them.
 *
 * The queue row carries a display name and a description — enough to tell two applications apart,
 * not enough to judge either. What decides an application is who is behind it and what they have
 * already put on the platform, so this adds the account, the application history and the events.
 */
export interface AdminOrganizerDetail {
  id: number;
  displayName: string;
  description: string | null;
  logoUrl: string | null;
  status: string;
  reviewNote: string | null;
  appliedAt: string;
  approvedAt: string | null;
  /** The account behind the application. One user may hold several over time. */
  ownerEmail: string;
  ownerName: string | null;
  ownerJoinedAt: string;
  /**
   * Every application this account has filed, newest first, this one included.
   *
   * A re-application after a rejection is the case this exists for: the admin about to approve it
   * should be able to see what was said the first time without hunting the audit log.
   */
  history: Array<{
    id: number;
    status: string;
    reviewNote: string | null;
    appliedAt: string;
  }>;
  events: Array<{
    id: number;
    title: string;
    slug: string;
    status: string;
    moderation: string;
    createdAt: string;
  }>;
  eventCount: number;
  ticketsSold: number;
  /** Gross ticket money across their events — the organizer's own take, not the platform's cut. */
  revenue: number;
}

/** The comment behind a report, with the event it sits under. */
export interface ReportedReview {
  kind: "review";
  reviewId: number;
  body: string | null;
  rating: number;
  status: "visible" | "removed";
  createdAt: string;
  authorName: string | null;
  eventId: number;
  eventTitle: string;
  eventSlug: string;
}

export interface ContentReportDetail {
  id: number;
  status: "open" | "dismissed" | "flagged" | "resolved";
  reason: string;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  reporterEmail: string;
  /**
   * Every *other* report against the same target, newest first.
   *
   * One complaint is a person; five is a pattern, and an admin deciding on the first of five with
   * no sight of the other four is deciding on a quarter of the evidence.
   */
  otherReports: Array<{
    id: number;
    reason: string;
    createdAt: string;
    reporterEmail: string;
    status: string;
  }>;
  target: ReportedEvent | ReportedReview;
}

export interface AttendeeRow {
  ticketId: number;
  barcode: string;
  orderCode: string;
  buyerName: string;
  buyerEmail: string;
  tier: string;
  seat: string | null;
  status: "valid" | "checked_in" | "void";
  checkedInAt: string | null;
}

/** One night of a run, for the door list's showtime picker. */
export interface AttendeeShowtime {
  id: number;
  startsAt: string;
  venue: string;
  /** Paid, unvoided tickets for this showtime — so the picker says how big each night is. */
  tickets: number;
}

export interface AttendeeList {
  eventId: number;
  eventTitle: string;
  showtimeId: number | null;
  /** One page of the list, not the whole event. */
  rows: AttendeeRow[];
  /** How many rows match the current filters — what the pager counts. */
  total: number;
  /**
   * Event-wide totals, unaffected by search and status.
   *
   * They answer "how full is this door", which is a fact about the event rather than about what the
   * reader typed, so narrowing the table must not move them. Only the showtime filter applies.
   */
  counts: { total: number; checkedIn: number; void: number };
}

/** What a door scan answers with (UC-27, UC-28). */
export interface CheckinResult {
  ticketId: number;
  barcode: string;
  eventId: number;
  eventTitle: string;
  showtimeId: number;
  startsAt: string;
  venueName: string;
  venueAddress: string;
  tier: string;
  seat: string | null;
  buyerName: string;
  buyerEmail: string;
  checkedInAt: string;
  /** True when this scan is the one that admitted them; false when they were already inside. */
  admitted: boolean;
}

export interface AdminValidationError {
  error: string;
  message: string;
  fields?: Record<string, string>;
}
