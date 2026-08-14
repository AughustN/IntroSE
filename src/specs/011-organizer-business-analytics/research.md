# Phase 0 Research: Organizer Business Analytics

**Feature Branch**: `011-organizer-business-analytics`
**Date**: 2026-08-13
**Spec**: [spec.md](file:///D:/HCMUS/NhapMonCongNghePhanMem/Project/source/IntroSE/src/specs/011-organizer-business-analytics/spec.md)

## Research Summary

This document captures technical decisions, data querying strategies, and UI architecture for implementing the Organizer Business Analytics dashboard (UC-31).

---

### Decision 1: Charting & Data Visualization Library

- **Decision**: Use **Recharts** for all dashboard visualizations.
- **Rationale**: Recharts is explicitly designated as the analytics visualization framework in the TixHub Constitution Technology Stack (§ Technology Stack & Constraints). It integrates natively with React, supports responsive containers (`ResponsiveContainer`), SVG rendering, custom tooltips formatted for VND integers, and dual-axis time-series displays.
- **Alternatives Considered**:
  - *Chart.js / react-chartjs-2*: Canvas-based, requires additional wrapper lifecycle management and external bundle weight.
  - *Visx / D3.js*: Lower-level primitive building blocks; adds unnecessary complexity for standard line, bar, donut, and gauge components.

---

### Decision 2: SQL Aggregation & Query Performance Strategy

- **Decision**: Execute server-side SQL parameterized aggregations using PostgreSQL date functions (`DATE_TRUNC`, `INTERVAL`) and indexed joins over `events`, `orders`, `tickets`, `ticket_tiers`, and `event_cancellations`.
- **Rationale**: Keeps calculations authoritative on the backend (Principle I & II). Financial calculations stay strictly in non-floating-point VND integers [STD-03].
- **Index Optimization**:
  - `idx_events_organizer_id`: `(organizer_id, status, start_date)`
  - `idx_orders_event_created`: `(event_id, payment_status, created_at)`
  - `idx_refunds_event`: `(event_id, created_at)`
- **Latency Assurance**: Meets SC-004 (< 500ms response time with indexes, max 1.0s under live recalculation).

---

### Decision 3: Net Revenue & Store-Credit Refund Audit Integration

- **Decision**:
  - `total_gross_revenue_vnd` = $\sum \text{amount\_vnd}$ for orders with `payment_status = 'completed'` scoped to organizer's events.
  - `total_refund_amount_vnd` = $\sum \text{total\_refund\_amount\_vnd}$ from `event_cancellations` (UC-25) + individual ticket refund transaction logs.
  - `net_revenue_vnd` = $\text{total\_gross\_revenue\_vnd} - \text{total\_refund\_amount\_vnd}$.
- **Rationale**: Aligns strictly with TixHub Constitution v2.0.0 (closed-loop wallet refunds in scope per UC-25 audit trail, money stored as integer VND [STD-03]).

---

### Decision 4: Single-Component Route Aliasing Architecture

- **Decision**: Implement `<OrganizerBusinessAnalytics />` as a single shared React component.
  - Primary route: `/account?tab=organizer&section=analytics` (renders inside `AccountPage` layout alongside `OrganizerSection`).
  - Alias route: `/organizer/analytics` (renders `AccountPage` with pre-selected `tab="organizer"` & `section="analytics"` or performs an immediate SPA client-side redirect to `/account?tab=organizer&section=analytics`).
- **Rationale**: Directly resolves the past bug where `/organizer` and `/account` drifted out of sync. Ensures a single source of truth for component logic and state management.

---

### Decision 5: Database Schema Additions & Modifications

- **Decision**:
  1. Add `category` column to `events` table: `category VARCHAR(50) NOT NULL DEFAULT 'Khác'` (values: `'Music'`, `'Workshop'`, `'Sports'`, `'Arts'`, `'Entertainment'`, `'Technology'`, `'Other'`).
  2. Add optional P3 schema table for door scanner check-in tracking (`checkin_records`):
     - `id` UUID / Primary Key
     - `ticket_id` UUID FK -> `tickets.id`
     - `event_id` UUID FK -> `events.id`
     - `scanned_at` TIMESTAMP WITH TIME ZONE
     - `scanned_by_user_id` UUID FK -> `users.id`
     - `status` VARCHAR(20) (`'VALID'`, `'DUPLICATE'`, `'INVALID'`)
- **Rationale**: Satisfies FR-011 category revenue donut chart requirement and FR-014 schema expansion allowances.
