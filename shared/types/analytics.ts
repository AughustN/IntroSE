/**
 * Shared DTO contracts for Organizer Business Analytics (UC-31)
 */

export type EventStatus = "Draft" | "Pending Approval" | "Published" | "Canceled" | "Completed";

export type PaymentStatus = "COMPLETED" | "REFUNDED" | "CANCELED";

export type DatePeriodFilter = "7d" | "this_month" | "custom";

export interface AnalyticsFilterParams {
  period?: DatePeriodFilter;
  startDate?: string;
  endDate?: string;
  eventId?: string;
}

export interface EventStatusCounts {
  draft: number;
  pending_approval: number;
  published: number;
  canceled: number;
  completed: number;
}

export interface PeriodComparisonDelta {
  gross_revenue_change_pct: number;
  tickets_sold_change_pct: number;
  net_revenue_change_pct: number;
}

export interface OrganizerAnalyticsOverview {
  gross_revenue_vnd: number;
  total_refund_amount_vnd: number;
  net_revenue_vnd: number;
  total_tickets_sold: number;
  total_capacity: number;
  capacity_fill_rate: number;
  event_counts_by_status: EventStatusCounts;
  period_comparison: PeriodComparisonDelta;
}

export interface TimeSeriesSalesPoint {
  date: string;
  label: string;
  current_revenue_vnd: number;
  current_tickets_sold: number;
  previous_revenue_vnd: number;
  previous_tickets_sold: number;
}

export interface EventRevenueRankingItem {
  event_id: string;
  event_title: string;
  category: string;
  status: EventStatus;
  gross_revenue_vnd: number;
  tickets_sold: number;
  total_capacity: number;
  fill_percentage: number;
}

export interface TierRevenueBreakdownItem {
  tier_name: string;
  revenue_vnd: number;
  tickets_sold: number;
  percentage_share: number;
}

export interface CategoryRevenueBreakdownItem {
  category: string;
  revenue_vnd: number;
  tickets_sold: number;
  percentage_share: number;
}

export interface AnalyticsBreakdowns {
  by_tier: TierRevenueBreakdownItem[];
  by_category: CategoryRevenueBreakdownItem[];
}

export interface SoonestEventCapacity {
  has_upcoming_event: boolean;
  event_id?: string;
  event_title?: string;
  category?: string;
  start_date?: string;
  sold_tickets?: number;
  total_capacity?: number;
  fill_percentage?: number;
}

export interface TransactionAuditRecord {
  order_id: string;
  ticket_id: string;
  event_name: string;
  tier_name: string;
  amount_vnd: number;
  purchase_timestamp: string;
  payment_status: PaymentStatus;
  refund_amount_vnd: number;
}

export interface OrganizerAnalyticsDashboardResponse {
  overview: OrganizerAnalyticsOverview;
  time_series: TimeSeriesSalesPoint[];
  top_events: EventRevenueRankingItem[];
  breakdowns: AnalyticsBreakdowns;
  soonest_event_capacity: SoonestEventCapacity;
  recent_transactions: TransactionAuditRecord[];
  all_events?: Array<{ event_id: string; event_title: string }>;
  checkin_stats?: {
    total_scanned: number;
    checkin_rate_pct: number;
  };
}
