# Quickstart Validation Guide: Organizer Business Analytics

**Feature Branch**: `011-organizer-business-analytics`
**Date**: 2026-08-13
**Spec**: [spec.md](file:///D:/HCMUS/NhapMonCongNghePhanMem/Project/source/IntroSE/src/specs/011-organizer-business-analytics/spec.md)

This guide provides runnable end-to-end scenarios to validate the Organizer Business Analytics implementation.

---

## Prerequisites & Setup

1. Node.js environment running the TixHub dev stack:
   ```bash
   # Terminal 1: Backend API server
   npm run dev:server

   # Terminal 2: Frontend Vite dev server
   npm run dev
   ```
2. Log in as an approved organizer (`role: ORGANIZER`, status: `APPROVED`).

---

## Validation Scenario 1: KPI Overview & Net Revenue Refund Audit

**Objective**: Verify total gross revenue, tickets sold, fill rate, status counts, and net revenue after store-credit refunds.

1. Navigate to `/account` and click the **"Nhà tổ chức"** tab.
2. Verify the presence of the **"Thống kê & Analytics"** button alongside "Quản lý sự kiện".
3. Click **"Thống kê & Analytics"**.
4. Confirm navigation to `/account?tab=organizer&section=analytics` with the sidebar actively highlighting "Nhà tổ chức".
5. Inspect KPI summary cards:
   - **Gross Revenue**: Matches total VND sum of completed orders for this organizer.
   - **Net Revenue**: Matches `gross_revenue - total_refund_amount_vnd` for canceled events (UC-25).
   - **Monetary Precision**: All currency amounts rendered as non-decimal VND integers (e.g. `120.000.000 ₫`).

---

## Validation Scenario 2: Date Range & Event Filtering with Period Comparison

**Objective**: Test interactive filter updates and period-over-period percentage comparisons.

1. On the Analytics page, click the date range selector and switch between:
   - **7 ngày** (Last 7 Days)
   - **Tháng này** (This Month)
   - **Tùy chỉnh** (Custom Range e.g. 01/08/2026 to 13/08/2026)
2. Assert that KPI cards, charts, and table rows refresh in under 500ms (SC-004).
3. Verify percentage delta indicators (e.g. `+15.4%`, `-5.0%`) reflect growth/decline compared to the preceding equivalent time period.
4. Select a specific event from the **Lọc theo sự kiện** dropdown. Confirm that all metrics isolate strictly to that chosen event.

---

## Validation Scenario 3: Visual Charts & Analytics

**Objective**: Validate Recharts components rendering data correctly.

1. **Time-Series Chart**: Dual-axis line/area chart displaying revenue (VND) and tickets sold over time with current vs previous period overlays.
2. **Top Events Bar Chart**: Vertical/Horizontal bar chart ranking top events by revenue in VND.
3. **Donut Charts**:
   - Ticket Tier breakdown (VIP, Standard, Free).
   - Event Category breakdown (Music, Workshop, Sports, etc. per `events.category`).
4. **Soonest Event Capacity Gauge**: Radial/gauge chart showing sold/capacity percentage for the nearest upcoming event.

---

## Validation Scenario 4: Route Aliasing & Code Integrity

**Objective**: Verify that direct route link `/organizer/analytics` renders the exact same component as `/account?tab=organizer&section=analytics`.

1. Open a new browser tab and navigate directly to `http://localhost:5173/organizer/analytics`.
2. Confirm the page mounts the identical `<OrganizerBusinessAnalytics />` component wrapped inside the `AccountPage` layout with the sidebar visible.
3. Modify a filter state on `/organizer/analytics` and verify behavior matches `/account?tab=organizer&section=analytics` 1:1 without code duplication.

---

## Automated Verification Suite

Run automated contract and component unit tests:

```bash
# Run unit & contract tests for analytics backend module
npm test -- server/tests/organizer-analytics.test.ts

# Run frontend component tests
npm test -- src/tests/OrganizerBusinessAnalytics.test.tsx
```
