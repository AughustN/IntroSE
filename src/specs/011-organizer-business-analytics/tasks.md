# Tasks: Organizer Business Analytics

**Input**: Design documents from `/specs/011-organizer-business-analytics/`

**Prerequisites**: [plan.md](file:///D:/HCMUS/NhapMonCongNghePhanMem/Project/source/IntroSE/src/specs/011-organizer-business-analytics/plan.md) (required), [spec.md](file:///D:/HCMUS/NhapMonCongNghePhanMem/Project/source/IntroSE/src/specs/011-organizer-business-analytics/spec.md) (required), [research.md](file:///D:/HCMUS/NhapMonCongNghePhanMem/Project/source/IntroSE/src/specs/011-organizer-business-analytics/research.md), [data-model.md](file:///D:/HCMUS/NhapMonCongNghePhanMem/Project/source/IntroSE/src/specs/011-organizer-business-analytics/data-model.md), [organizer-analytics-api.md](file:///D:/HCMUS/NhapMonCongNghePhanMem/Project/source/IntroSE/src/specs/011-organizer-business-analytics/contracts/organizer-analytics-api.md)

**Tests**: Included backend integration and frontend component tests for critical financial and RBAC requirements.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

---

## Format: `- [x] [ID] [P?] [Story] Description with file path`

- **[P]**: Can run in parallel (different files, no shared state conflicts)
- **[Story]**: Maps to user stories US1, US2, US3, US4, US5, US6 from spec.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Shared type definitions and project contracts for FE/BE boundary

- [x] T001 [P] Create shared analytics DTO interfaces in shared/types/analytics.ts
- [x] T002 [P] Export shared analytics types from shared/index.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core database schema updates and backend analytics module initialization

- [x] T003 Update database schema definitions to add `category` column to `events` table and composite indexes in server/src/db/schema.ts
- [x] T004 Create database migration script for `events.category` field and `checkin_records` table in server/src/db/migrations/011_add_event_category_and_checkin.sql
- [x] T005 Create backend analytics service shell in server/src/modules/organizer/analyticsService.ts
- [x] T006 Create backend analytics controller with session RBAC check [SEC-04] in server/src/modules/organizer/analyticsController.ts
- [x] T007 Register analytics router endpoints under `/api/organizer/analytics` in server/src/modules/organizer/organizerRouter.ts

**Checkpoint**: Foundation ready - backend module skeleton and schema ready for story implementation.

---

## Phase 3: User Story 1 - Live Portfolio Sales & Financial KPI Overview (Priority: P1) 🎯 MVP

**Goal**: Authenticated organizer views summary cards for gross revenue (VND), tickets sold, fill rate, status counts, and net revenue after store-credit refunds (UC-25).

**Independent Test**: Log in as an organizer, request `/api/organizer/analytics/dashboard`, and verify KPI values match SQL calculations with integer VND precision [STD-03].

### Tests for User Story 1

- [x] T008 [P] [US1] Integration test for KPI summary calculation & refund deductions in server/tests/organizerAnalyticsKPI.test.ts

### Implementation for User Story 1

- [x] T009 [US1] Implement server-side KPI overview query (gross revenue, ticket count, capacity fill rate, status counts, net revenue = gross minus `total_refund_amount_vnd`) in server/src/modules/organizer/analyticsService.ts
- [x] T010 [US1] Implement controller response handler for KPI overview endpoint in server/src/modules/organizer/analyticsController.ts
- [x] T011 [P] [US1] Create frontend API client wrapper for analytics endpoint in src/services/organizerAnalyticsClient.ts
- [x] T012 [P] [US1] Create KPI Summary Cards component with integer VND formatting [STD-03] in src/components/account/analytics/KPICards.tsx
- [x] T013 [US1] Assemble core KPI dashboard shell in src/components/account/OrganizerBusinessAnalytics.tsx

**Checkpoint**: User Story 1 MVP fully functional and testable independently.

---

## Phase 4: User Story 2 - Date Range & Event Filtering with Period-Over-Period Comparison (Priority: P1)

**Goal**: Filter sales analytics by preset date ranges (7 days, this month, custom) and specific events, displaying period-over-period delta percentages.

**Independent Test**: Switch date preset or select an event in dropdown; confirm metrics re-calculate and period comparison delta updates within < 500ms (SC-004).

### Tests for User Story 2

- [x] T014 [P] [US2] Backend integration test for date range filtering & period-over-period SQL delta calculation in server/tests/organizerAnalyticsFiltering.test.ts

### Implementation for User Story 2

- [x] T015 [US2] Implement server-side date range boundary parser and prior period window comparator in server/src/modules/organizer/analyticsService.ts
- [x] T016 [US2] Add event-specific filtering (`eventId = 'all'` or specific UUID) to analytics SQL queries in server/src/modules/organizer/analyticsService.ts
- [x] T017 [P] [US2] Create Date Range Picker & Event Selector toolbar component in src/components/account/analytics/AnalyticsFilterBar.tsx
- [x] T018 [US2] Connect filter bar state to API query re-fetching in src/components/account/OrganizerBusinessAnalytics.tsx

**Checkpoint**: User Stories 1 and 2 operate dynamically with full time-window and event filtering capabilities.

---

## Phase 5: User Story 3 - Revenue Visualizations & Multi-Tier Analytics (Priority: P2)

**Goal**: Render Recharts time-series line/area chart, top events bar chart, and donut charts for ticket tier and category breakdowns.

**Independent Test**: Render dashboard with multi-tier & multi-category sales; verify Recharts charts display accurate VND integer values and percentage shares.

### Implementation for User Story 3

- [x] T019 [P] [US3] Implement server-side aggregation for time-series points (`current` vs `previous` period) in server/src/modules/organizer/analyticsService.ts
- [x] T020 [P] [US3] Implement server-side top events ranking query and tier/category revenue breakdowns in server/src/modules/organizer/analyticsService.ts
- [x] T021 [P] [US3] Create Time-Series Line/Area Chart component using Recharts in src/components/account/analytics/TimeSeriesChart.tsx
- [x] T022 [P] [US3] Create Top Events Bar Chart component using Recharts in src/components/account/analytics/TopEventsChart.tsx
- [x] T023 [P] [US3] Create Ticket Tier & Event Category Donut Charts component using Recharts in src/components/account/analytics/RevenueDonutCharts.tsx
- [x] T024 [US3] Integrate time-series, bar chart, and donut charts into src/components/account/OrganizerBusinessAnalytics.tsx

**Checkpoint**: Visual charts active and responsive across desktop and mobile layout breakpoints.

---

## Phase 6: User Story 4 - Soonest Event Capacity Gauge & Recent Transactions Audit Table (Priority: P2)

**Goal**: Display visual sold/capacity gauge for soonest upcoming event (with explicit zero-event empty state) and a recent transactions audit table.

**Independent Test**: Verify gauge identifies earliest future event (or renders "Không có sự kiện sắp diễn ra" card when 0 upcoming events exist), and transaction table accurately logs order status and refund details.

### Implementation for User Story 4

- [x] T025 [P] [US4] Implement server-side query for soonest upcoming event capacity and recent transactions list in server/src/modules/organizer/analyticsService.ts
- [x] T026 [P] [US4] Create Soonest Upcoming Event Capacity Gauge component with zero-event empty state in src/components/account/analytics/CapacityGauge.tsx
- [x] T027 [P] [US4] Create Recent Transactions Audit Table component with status badges in src/components/account/analytics/RecentTransactionsTable.tsx
- [x] T028 [US4] Integrate capacity gauge and transaction table into src/components/account/OrganizerBusinessAnalytics.tsx

**Checkpoint**: Capacity gauge and transaction audit table fully integrated and verified.

---

## Phase 7: User Story 5 - Integrated Account Panel Navigation & Route Consistency (Priority: P2)

**Goal**: Connect "Thống kê & Analytics" entry button on `/account` "Nhà tổ chức" panel and enforce single-component route aliasing across `/account?tab=organizer&section=analytics` and `/organizer/analytics`.

**Independent Test**: Navigate to `/account` -> "Nhà tổ chức" -> "Thống kê & Analytics", and open `/organizer/analytics` directly; confirm both routes mount identical `<OrganizerBusinessAnalytics />` component with active sidebar.

### Implementation for User Story 5

- [x] T029 [US5] Add "Thống kê & Analytics" button adjacent to "Quản lý sự kiện" on approved organizer card in src/components/account/OrganizerSection.tsx
- [x] T030 [US5] Update AccountPage section router to render `<OrganizerBusinessAnalytics />` when `section === 'analytics'` in src/components/account/AccountPage.tsx
- [x] T031 [US5] Configure SPA route alias `/organizer/analytics` to mount `<AccountPage initialTab="organizer" initialSection="analytics" />` in src/routes.ts

**Checkpoint**: Seamless navigation across account panel and direct route alias without component duplication.

---

## Phase 8: User Story 6 - Attendance & Check-in Analytics (Priority: P3 - Optional Extension)

**Goal**: Expose door check-in attendance stats on event detail breakdowns when `checkin_records` exist.

**Independent Test**: Insert mock check-in records for an event and verify scanned count and check-in percentage are displayed.

### Implementation for User Story 6

- [x] T032 [P] [US6] Implement server-side query for event check-in attendance stats in server/src/modules/organizer/analyticsService.ts
- [x] T033 [US6] Add optional check-in attendance badge to event analytics view in src/components/account/analytics/CheckInBadge.tsx

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: RBAC security verification, Vietnamese localization check, quickstart validation

- [x] T034 [P] Verify strict server-side RBAC scoping (`organizer_id = session.user.id` [SEC-04]) in server/tests/organizerAnalyticsRBAC.test.ts
- [x] T035 [P] Add component tests for zero-sales state and currency formatting in src/tests/OrganizerBusinessAnalytics.test.tsx
- [x] T036 Execute full quickstart validation scenarios from specs/011-organizer-business-analytics/quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories.
- **User Story 1 (Phase 3 - MVP)**: Depends on Foundational completion.
- **User Story 2 (Phase 4)**: Depends on Foundational completion & US1 API client.
- **User Story 3 (Phase 5)**: Depends on US1/US2 filter & data structures.
- **User Story 4 (Phase 6)**: Depends on US1 core layout.
- **User Story 5 (Phase 7)**: Depends on US1 dashboard component creation (`OrganizerBusinessAnalytics.tsx`).
- **User Story 6 (Phase 8)**: Optional extension — depends on Foundational schema migration.
- **Polish (Phase 9)**: Depends on all target user stories being complete.

---

## Parallel Execution Opportunities

```bash
# Shared setup & foundational models:
Task: T001 Create shared analytics DTO interfaces in shared/types/analytics.ts
Task: T003 Update database schema definitions in server/src/db/schema.ts

# Frontend UI chart components:
Task: T021 Create Time-Series Line/Area Chart component in src/components/account/analytics/TimeSeriesChart.tsx
Task: T022 Create Top Events Bar Chart component in src/components/account/analytics/TopEventsChart.tsx
Task: T023 Create Ticket Tier & Event Category Donut Charts component in src/components/account/analytics/RevenueDonutCharts.tsx
Task: T026 Create Soonest Upcoming Event Capacity Gauge component in src/components/account/analytics/CapacityGauge.tsx
Task: T027 Create Recent Transactions Audit Table component in src/components/account/analytics/RecentTransactionsTable.tsx
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational).
2. Complete Phase 3 (User Story 1 MVP - KPI Summary Cards).
3. **STOP and VALIDATE**: Test KPI cards with integer VND pricing [STD-03] and store-credit refund subtraction (UC-25).

### Incremental Delivery

1. Setup + Foundational → Database & API skeleton ready.
2. Add US1 → Core KPI summary dashboard live (MVP!).
3. Add US2 → Date range & event dropdown filtering live.
4. Add US3 + US4 → Recharts visualizations, capacity gauge, transaction table live.
5. Add US5 → Account panel button & single-component route alias live.
