# Implementation Plan: Organizer Business Analytics

**Branch**: `011-organizer-business-analytics` | **Date**: 2026-08-13 | **Spec**: [spec.md](file:///D:/HCMUS/NhapMonCongNghePhanMem/Project/source/IntroSE/src/specs/011-organizer-business-analytics/spec.md)

**Input**: Feature specification from `specs/011-organizer-business-analytics/spec.md`

## Summary

Implement the Organizer Business Analytics dashboard (UC-31) allowing authenticated event organizers to view real-time sales performance across their event portfolio. The dashboard features KPI summary cards (gross revenue in VND, tickets sold, fill rate, event status breakdown, and net revenue after store-credit refunds per UC-25), a time-series area chart with period-over-period comparison overlays, a top event ranking bar chart, donut charts for ticket tier and category breakdowns, a soonest upcoming event capacity gauge, and a recent transactions audit table. Metrics are strictly scoped to the authenticated organizer [SEC-04], monetary values are formatted as VND integers [STD-03], and the UI is rendered via a single shared component mounted across primary route `/account?tab=organizer&section=analytics` and alias route `/organizer/analytics`.

---

## Technical Context

- **Language/Version**: TypeScript 5.x (Strict mode)
- **Primary Dependencies**: React 18, Recharts (visualizations), Lucide-React (icons), Express (REST API backend)
- **Storage**: PostgreSQL (Neon / VPS Postgres) with Drizzle ORM / SQL query builder
- **Testing**: Vitest (Frontend & Backend integration unit testing)
- **Target Platform**: Responsive Web SPA (Desktop & Mobile Web)
- **Project Type**: Web Application (React SPA + Express REST API)
- **Performance Goals**: Initial dashboard load < 1.5s (SC-001); Filter update latency < 500ms (SC-004)
- **Constraints**: Server-side RBAC scoping (`organizer_id = session.user.id` [SEC-04]); integer VND currency formatting [STD-03]; single-component route alias mounting

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Principle I: Reliability Under Load Is the Product** — Analytics read queries use indexed CTEs/aggregations and run in read committed transaction isolation, never locking order or seat purchase paths.
- [x] **Principle II: Security & Trust by Default** — Server-side RBAC enforced on all `/api/organizer/analytics/*` endpoints (`organizer_id = session.user.id` injected by server session middleware [SEC-04]).
- [x] **Principle III: AI Is Assistive & Non-Blocking** — Pure deterministic SQL analytics; no blocking AI calls on critical path.
- [x] **Principle IV: Verifiable Requirements & Test-First** — Financial metrics tested down to 1 VND integer precision [STD-03]; net revenue verified against refund audit trail (UC-25).
- [x] **Principle V: Simplicity & Free-Tier Discipline** — Standard SQL aggregations with indexed views/queries; zero external microservices or expensive vector stores.
- [x] **Principle VI: Clean Codebase & Seamless FE/BE Integration** — Shared TypeScript interfaces in `shared/types/analytics.ts` imported by frontend and backend; single component alias prevents code duplication across routes.

---

## Project Structure

### Documentation (this feature)

```text
specs/011-organizer-business-analytics/
├── spec.md              # Feature specification
├── plan.md              # This implementation plan
├── research.md          # Phase 0 research decisions
├── data-model.md        # Phase 1 data entities & schema migration
├── quickstart.md        # Phase 1 validation scenarios
└── contracts/           # REST API interface contract
    └── organizer-analytics-api.md
```

### Source Code Layout

```text
shared/
└── types/
    └── analytics.ts                       # Shared DTO contracts (FE/BE boundary)

server/
└── src/
    ├── db/
    │   └── schema.ts                      # DB schema (category field & checkin_records)
    └── modules/
        └── organizer/
            ├── analyticsController.ts     # API controller for /api/organizer/analytics
            ├── analyticsService.ts        # Query aggregation service
            └── organizerRouter.ts         # Route definitions

src/
├── components/
│   └── account/
│       ├── AccountPage.tsx                # Tab & section routing state
│       ├── OrganizerSection.tsx           # Entry point "Thống kê & Analytics" button
│       └── OrganizerBusinessAnalytics.tsx # Single shared business analytics dashboard component
├── services/
│   └── organizerAnalyticsClient.ts        # API client fetch wrapper
└── routes.ts                              # SPA routing & route alias configuration
```

---

## Complexity Tracking

*No constitution violations. All design choices conform strictly to Principles I–VI.*
