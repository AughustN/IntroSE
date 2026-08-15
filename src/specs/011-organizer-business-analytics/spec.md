# Feature Specification: Organizer Business Analytics

**Feature Branch**: `011-organizer-business-analytics`

**Created**: 2026-08-13

**Status**: Draft

**Input**: User description: "Build an Organizer Business Analytics page (per UC-31 View organizer sales dashboard) that lets an authenticated organizer view live business performance across their event portfolio, filterable by date range (7 days / this month / custom) and by a specific event, showing: KPI summary cards for total gross revenue in VND, total tickets sold, average capacity fill rate, count of events by status (Draft/Pending Approval/Published/Canceled/Completed), and net revenue after refunds (gross revenue minus total_refund_amount_vnd from cancellation records); a time-series line/area chart of revenue and tickets sold over the selected period with period-over-period comparison; a bar chart ranking top events by revenue; a donut chart of revenue breakdown by ticket tier (VIP/Standard/Free) and by event category; a gauge showing sold/capacity percentage for the soonest upcoming event; and a recent-transactions table listing event name, tier, amount, purchase timestamp, and payment/refund status all metrics scoped strictly to the authenticated organizer's own events [SEC-04], monetary values as VND integers [STD-03], and revenue/refund calculations must correctly reflect canceled events per UC-25's per-ticket refund audit trail. You're allowed to modify the database schema (edit the relevant schema file under the /document folder to add any new fields/tables needed for analytics, e.g. check-in records), and the new Organizer Business Analytics page should be added as a new destination reached from the 'Quản lý sự kiện' button on the /account 'Nhà tổ chức' tab shown in this screenshot (organizer status stepper: Gửi đơn → Chờ duyệt → Đã duyệt), so route it either as a new tab/section alongside 'Quản lý sự kiện' on that Nhà tổ chức panel or as a linked sub-page reachable from it, keeping the same account sidebar (Hồ sơ / Bảo mật / Nhà tổ chức / Đăng xuất) and visual style."

## Clarifications

### Session 2026-08-13

- Q: Navigation entry-point contradiction between US5 and FR-015? → A: Consolidated into a single unified Organizer Workspace route at `/organizer` with top-level tabs for "Quản lý sự kiện" (`?section=events`) and "Thống kê kinh doanh" (`?section=analytics`).
- Q: Final route path for Analytics page & Account button? → A: The single authoritative route is `/organizer`. The `/account` "Nhà tổ chức" panel contains a single button ("Vào trang quản lý Ban Tổ Chức") that opens the `/organizer` hub. Standalone `/account?tab=organizer&section=analytics` was removed in favor of this single hub.
- Q: Component duplication prevention across routes? → A: Both sections live inside the single `/organizer` route workspace, reusing `OrganizerBusinessAnalytics` and event management components without any duplicated logic.
- Q: Capacity Gauge behavior when 0 upcoming events exist? → A: Displays an explicit empty state card ("Không có sự kiện sắp diễn ra") with 0/0 capacity and 0% fill rate.
- Q: Check-in records schema priority? → A: Downgraded `checkin_records` schema requirement to a SHOULD (P3) optional extension so revenue/sales analytics delivery is not blocked.
- Q: SC-004 500ms filter update latency target assumption? → A: Clarified that 500ms target assumes indexed query / pre-aggregated caching; relaxed unindexed live recalculation target to <= 1.0 second.
- Q: Event `category` schema field dependency? → A: Confirmed requirement to add `category` (`events.category`) to the database schema in FR-014 if missing from spec 010, enabling FR-011 category revenue breakdown.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Live Portfolio Sales & Financial KPI Overview (Priority: P1)

As an authenticated Event Organizer, I want to see an overview of key performance indicators (KPIs) across my event portfolio in real time, so that I can quickly assess total gross revenue, tickets sold, average capacity fill rate, event status counts, and net revenue after processing refunds.

**Why this priority**: Core value proposition of UC-31. Organizers require a single authoritative summary of financial performance and inventory movement across all their hosted events.

**Independent Test**: Can be tested by logging in as an organizer with events in various statuses (Published, Draft, Canceled, Completed), loading the Business Analytics dashboard, and verifying that total gross revenue, tickets sold, average fill rate, event status counts, and net revenue strictly match server-side calculated totals for that specific organizer.

**Acceptance Scenarios**:

1. **Given** an authenticated organizer with published and completed events, **When** they navigate to the Organizer Business Analytics dashboard, **Then** the KPI summary cards display Total Gross Revenue (in integer VND), Total Tickets Sold, Average Capacity Fill Rate (%), Counts of Events grouped by status (Draft, Pending Approval, Published, Canceled, Completed), and Net Revenue after Refunds (Gross Revenue minus `total_refund_amount_vnd`).
2. **Given** an event that was canceled with processed attendee wallet refunds per UC-25, **When** calculating Net Revenue, **Then** the Net Revenue KPI accurately subtracts all recorded `total_refund_amount_vnd` entries from Total Gross Revenue.
3. **Given** an organizer with zero created events, **When** they view the analytics page, **Then** all numeric KPI values render as 0 VND / 0 units / 0% fill rate with clear empty state messaging.

---

### User Story 2 - Date Range & Event Filtering with Period-Over-Period Comparison (Priority: P1)

As an authenticated Event Organizer, I want to filter sales analytics by preset date ranges (7 days, this month, custom date range) and by specific individual events, with period-over-period comparisons, so that I can track performance trends and compare current growth against prior periods.

**Why this priority**: Crucial for operational reporting. Organizers need time-windowed analytics and single-event drilldowns to evaluate marketing campaigns and sales surges.

**Independent Test**: Can be tested by selecting "7 days", "This Month", or a custom start/end date, or selecting a specific event from the event filter dropdown, and asserting that all charts, tables, and KPIs update instantly and reflect the chosen scope with percentage delta indicators comparing against the preceding equivalent time window.

**Acceptance Scenarios**:

1. **Given** the Business Analytics page, **When** the organizer selects "7 days", **Then** all dashboard metrics restrict their time boundary to the last 7 calendar days, displaying line/area charts comparing the current 7 days against the previous 7 days.
2. **Given** the Business Analytics page, **When** the organizer chooses "This Month", **Then** metrics scope to the 1st of the current month through today, with period-over-period comparison against the same calendar span in the previous month.
3. **Given** a custom date range selection, **When** the organizer inputs a valid Start Date and End Date, **Then** metrics re-calculate for that range, comparing with an equal duration period immediately preceding the start date.
4. **Given** the Event Filter dropdown, **When** an organizer selects a single event (e.g. "Sơn Tùng M-TP Concert"), **Then** all charts and metrics isolate data to only that specific event.

---

### User Story 3 - Revenue Visualizations & Multi-Tier Analytics (Priority: P2)

As an authenticated Event Organizer, I want to view time-series line/area charts, top event ranking bar charts, and revenue breakdown donut charts by ticket tier and event category, so that I can visually identify top-performing revenue drivers and customer tier preferences.

**Why this priority**: Data visualization enables rapid pattern recognition, helping organizers adjust ticket tier allocations and pricing strategies.

**Independent Test**: Can be tested by examining the time-series area chart, event ranking bar chart, and donut charts to verify that data points, legend values, and hover tooltips accurately reflect underlying transactions in integer VND and ticket units.

**Acceptance Scenarios**:

1. **Given** transaction history over the selected date range, **When** viewing the Time-Series Chart, **Then** dual axes or toggles show Revenue (VND) and Tickets Sold over time with distinct trendlines for current period vs previous period.
2. **Given** multiple published events with sales, **When** inspecting the Top Events Bar Chart, **Then** events are ranked in descending order by gross revenue, displaying event title, tickets sold, and revenue in VND.
3. **Given** sales across multiple ticket tiers (e.g. VIP, Standard, Free) and categories (e.g. Music, Workshop), **When** viewing the Donut Charts, **Then** proportional segments display exact VND revenue amounts and percentage shares by ticket tier and category.

---

### User Story 4 - Soonest Event Capacity Gauge & Recent Transactions Audit Table (Priority: P2)

As an authenticated Event Organizer, I want to monitor sales capacity for my soonest upcoming event via a visual gauge, and inspect an audit table of recent transactions with payment and refund statuses, so that I can manage upcoming event operations and audit purchase details.

**Why this priority**: Real-time operational monitoring. Organizers need quick access to upcoming event readiness and precise transaction logs for customer support and accounting.

**Independent Test**: Can be tested by verifying the capacity gauge identifies the nearest upcoming Published/Pending event and displays its sold/capacity percentage, while the recent transactions table accurately lists transaction timestamp, event name, tier, amount in VND, and status (Completed, Refunded, Canceled).

**Acceptance Scenarios**:

1. **Given** published upcoming events, **When** viewing the Capacity Gauge card, **Then** the gauge automatically selects the event with the earliest upcoming start date and displays sold count, total capacity, and percentage fill rate.
2. **Given** an organizer with no upcoming (future-dated) Published/Pending events, **When** viewing the Capacity Gauge card, **Then** the gauge displays an explicit empty state card ("Không có sự kiện sắp diễn ra") showing 0/0 capacity and 0% fill rate.
3. **Given** recent order activities, **When** reviewing the Recent Transactions Table, **Then** rows display Event Name, Ticket Tier, Amount (VND integer), Purchase Timestamp (ISO / local format), and Status Badge (Payment Completed, Full Refund, Partial Refund, Canceled).
4. **Given** a transaction where an event or ticket was refunded per UC-25, **When** inspecting that row in the table, **Then** the status is marked as "Refunded" with explicit refund amount context matching the refund audit trail.

---

### User Story 5 - Integrated Account Panel Navigation & Route Consistency (Priority: P2)

As an authenticated Event Organizer, I want to access the Business Analytics view directly via a dedicated "Thống kê & Analytics" tab/button adjacent to "Quản lý sự kiện" on the `/account` "Nhà tổ chức" panel, preserving the account sidebar and URL routing structure (`/account?tab=organizer&section=analytics` or `/organizer/analytics`), so that navigation is intuitive and visual aesthetics remain consistent.

**Why this priority**: Resolves navigation contradictions and ensures clean integration into the existing user account workspace without visual breakages or orphaned routes.

**Independent Test**: Can be tested by navigating to `/account`, clicking the "Nhà tổ chức" tab, selecting "Thống kê & Analytics", and verifying that the page renders at `/account?tab=organizer&section=analytics` (or `/organizer/analytics`) with the account sidebar (Hồ sơ / Bảo mật / Nhà tổ chức / Đăng xuất) actively highlighted.

**Acceptance Scenarios**:

1. **Given** an approved organizer on `/account` ("Nhà tổ chức" tab), **When** viewing the organizer panel, **Then** a prominent "Thống kê & Analytics" tab/button is rendered alongside "Quản lý sự kiện".
2. **Given** navigation to the Business Analytics route (`/account?tab=organizer&section=analytics` or `/organizer/analytics`), **When** rendered, **Then** the page preserves the standard account sidebar layout, top header navigation, responsive breakpoints, and TixHub visual styling.
3. **Given** navigation via either `/account?tab=organizer&section=analytics` or `/organizer/analytics`, **When** the page renders, **Then** both routes mount the exact same component instance (via route alias or redirect), preventing component duplication or state drift across routes.

---

### User Story 6 - Attendance & Check-in Analytics (Priority: P3 - Optional Extension)

As an Event Organizer, I want to view door check-in attendance data alongside sales metrics if check-in scanning records exist, so that I can evaluate actual attendee turnout against ticket sales.

**Why this priority**: Optional enhancement. Sales and revenue analytics deliver primary business value; check-in tracking is an additive operational metric.

**Independent Test**: Can be tested by inserting mock `checkin_records` for an event and verifying that the event detail breakdown displays total scanned check-ins and check-in percentage rate.

**Acceptance Scenarios**:

1. **Given** an event with door scanner check-in activity, **When** viewing detailed event analytics, **Then** total checked-in count and percentage of sold tickets checked in are displayed.
2. **Given** an event with no check-in records, **When** viewing analytics, **Then** check-in metrics display "N/A" or 0 scanned without affecting revenue/ticket sales cards.

---

### Edge Cases

- **Zero Sales / New Organizer**: What happens when an organizer has registered events but 0 sales? KPI cards display 0 VND, charts display empty zero-state baselines without crashing or NaN values.
- **Zero Upcoming Events (Capacity Gauge)**: What happens when an organizer has only past or canceled events? The Capacity Gauge displays an empty state card with "Không có sự kiện sắp diễn ra" and 0% fill rate.
- **Fully Canceled Event Portfolio**: What happens when all events of an organizer were canceled and refunded? Gross revenue reflects original sales, total refunds match gross revenue, Net Revenue correctly calculates to 0 VND, and table flags all orders as Canceled/Refunded.
- **Overlapping Date Ranges & Multi-Tier Custom Filters**: How does the system compute period-over-period delta when the custom range spans leap years or month boundaries? System uses exact day count duration for preceding window comparison.
- **Multiple Events on Same Start Date**: How does the Soonest Upcoming Event Gauge pick the target event if two events start at the exact same hour? System breaks ties by picking the event with higher total capacity or earliest creation date.
- **Check-in Attendance Integration**: How does check-in data affect analytics? If check-in scanning records exist (`checkin_records`), actual attendance count and check-in rate (%) are optionally exposed on event detail breakdowns.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST enforce strict Role-Based Access Control [SEC-04], restricting analytics data visibility exclusively to the currently authenticated organizer's own events (`organizer_id = session.user.id`).
- **FR-002**: System MUST render KPI Summary Cards for:
  - Total Gross Revenue (VND integer [STD-03])
  - Total Tickets Sold
  - Average Capacity Fill Rate (%) across selected scope
  - Event Count breakdown by status (Draft, Pending Approval, Published, Canceled, Completed)
  - Net Revenue after Refunds (`gross_revenue - total_refund_amount_vnd`)
- **FR-003**: System MUST calculate Net Revenue using the authoritative store-credit refund audit records (`total_refund_amount_vnd`) generated from event cancellations (UC-25) and individual ticket refund flows.
- **FR-004**: System MUST store and format all financial values as non-floating-point VND integers [STD-03].
- **FR-005**: System MUST provide interactive Date Range Filtering with presets for:
  - Last 7 Days
  - This Month
  - Custom Date Range (Start Date to End Date picker)
- **FR-006**: System MUST provide an Event Filter dropdown listing all events owned by the organizer, including an "All Events" aggregate option.
- **FR-007**: System MUST calculate period-over-period percentage comparisons for gross revenue, tickets sold, and net revenue, comparing the selected date range to the immediately preceding equivalent time period.
- **FR-008**: System MUST render a Time-Series Line/Area Chart illustrating revenue in VND and tickets sold per day/week over the chosen period, supporting comparison overlays.
- **FR-009**: System MUST render a Bar Chart ranking the organizer's top events by gross revenue in VND.
- **FR-010**: System MUST render a Donut Chart showing revenue breakdown by ticket tier type (e.g. VIP, Standard, Early Bird, Free).
- **FR-011**: System MUST render a Donut Chart showing revenue breakdown by event category (e.g. Music, Workshop, Sports, Entertainment), using the `category` field on the event schema.
- **FR-012**: System MUST render a visual Gauge Chart displaying sold percentage vs total capacity for the soonest upcoming event (Published/Pending status with start date in future); if no upcoming event exists, an explicit empty state ("Không có sự kiện sắp diễn ra") MUST be displayed.
- **FR-013**: System MUST provide a Recent Transactions Audit Table listing:
  - Event Name
  - Ticket Tier Name
  - Transaction Amount (VND integer)
  - Purchase Timestamp
  - Payment & Refund Status (Completed, Refunded, Canceled)
- **FR-014**: System MUST ensure the event entity schema includes a `category` field (`events.category` string/enum) to support FR-011 category revenue breakdown, and SHOULD support optional check-in records (`checkin_records` table with fields `id`, `ticket_id`, `event_id`, `scanned_at`, `scanned_by_user_id`) as a P3 extension for attendance analytics.
- **FR-015**: System MUST integrate the Organizer Business Analytics view into the `/account` route under the "Nhà tổ chức" tab, accessible via a dedicated "Thống kê & Analytics" tab/button adjacent to "Quản lý sự kiện", routing to `/account?tab=organizer&section=analytics` as primary, while supporting `/organizer/analytics` as a thin alias/redirect route that mounts the exact same underlying page component (preventing duplicate UI implementations), maintaining sidebar navigation (Hồ sơ / Bảo mật / Nhà tổ chức / Đăng xuất) and account visual aesthetics.
- **FR-016**: System MUST handle network errors or empty datasets gracefully without uncaught exceptions, displaying clear, localized Vietnamese fallback messages.

### Key Entities *(include if feature involves data)*

- **OrganizerAnalyticsOverview**: Aggregate summary snapshot containing total gross revenue (VND integer), net revenue (VND integer), total refund amount (VND integer), total tickets sold, overall capacity fill rate (percentage), and event counts by status.
- **TimeSeriesSalesPoint**: Data point representing timestamp/date, current period revenue (VND), current period tickets sold, previous period revenue (VND), and previous period tickets sold.
- **EventRevenueRankingItem**: Entity containing `event_id`, `event_title`, `gross_revenue_vnd`, `tickets_sold`, and `total_capacity`.
- **RevenueTierBreakdown**: Entity representing ticket tier name (`tier_name`), total VND revenue generated, count of tickets sold, and percentage share.
- **RevenueCategoryBreakdown**: Entity representing category name (`category_name`), total VND revenue generated, count of tickets sold, and percentage share.
- **SoonestEventCapacity**: Entity capturing nearest upcoming event details (`event_id`, `title`, `start_date`, `sold_tickets`, `total_capacity`, `fill_percentage`).
- **TransactionAuditRecord**: Record representing individual transaction items (`order_id`, `ticket_id`, `event_name`, `tier_name`, `amount_vnd`, `purchase_timestamp`, `status`, `refund_amount_vnd`).
- **CheckInRecord**: Optional database table entity for door check-in tracking (`id`, `ticket_id`, `event_id`, `scanned_at`, `scanned_by_user_id`, `status`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Organizers can view fully loaded, accurate KPI cards, line charts, bar charts, and transaction tables within < 1.5 seconds upon navigating to the Business Analytics dashboard.
- **SC-002**: 100% of financial calculations (gross revenue, refunds, net revenue) match server-side ACID transaction totals down to 1 VND integer precision without floating-point rounding discrepancies [STD-03].
- **SC-003**: 100% of metrics displayed on the dashboard are strictly scoped to the authenticated organizer's own events [SEC-04], preventing any cross-tenant data leakage.
- **SC-004**: Switching date ranges (7 days / this month / custom) or selecting specific events updates all visual components dynamically in under 500 milliseconds (assuming indexed SQL queries / pre-aggregated caching; under live unindexed recalculation, max response latency MUST NOT exceed 1.0 second).
- **SC-005**: Organizers can successfully navigate between "Quản lý sự kiện" and "Thống kê & Analytics" without layout shifts or losing account sidebar context.

## Assumptions

- **Currency & Precision**: All monetary values are handled as integer amounts in Vietnamese Đồng (VND) without cents/decimals per TixHub Constitution [STD-03].
- **Authentication & RBAC**: The user must be authenticated with role `ORGANIZER` and an approved organizer status (`APPROVED` / `Đã duyệt`) to access business analytics.
- **Refund Audit Source**: Refund calculations rely on `total_refund_amount_vnd` fields recorded in event cancellation logs (UC-25) and individual wallet refund transactions.
- **Event Category Schema**: Event schema includes or will be extended to include `category` (`events.category` string/enum e.g. "Music", "Workshop", "Sports", "Arts", "Entertainment") to support category breakdown charts.
- **Single Component Alias Route**: The secondary route `/organizer/analytics` MUST be implemented as a thin route alias or redirect that mounts the exact same page component as `/account?tab=organizer&section=analytics`, eliminating code duplication and preventing route state drift.
- **UI Libraries**: Visual charts utilize Recharts or SVG/Canvas chart primitives consistent with the existing React SPA technical stack.
