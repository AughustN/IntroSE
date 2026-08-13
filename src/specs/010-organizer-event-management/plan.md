# Implementation Plan: Organizer Event Management

**Branch**: `010-organizer-event-management` | **Date**: 2026-08-12 | **Spec**: [`spec.md`](file:///D:/HCMUS/NhapMonCongNghePhanMem/Project/source/IntroSE/src/specs/010-organizer-event-management/spec.md)

**Input**: Feature specification from `/specs/010-organizer-event-management/spec.md`

## Summary

Deliver a dedicated, full-lifecycle Organizer Event Management workspace on TixHub under the `/organizer` route path allowing event organizers to monitor their event portfolio dashboard, inspect single-event real-time sales and inventory metrics, submit draft events for publication review, edit event details with automatic status reversion on material changes (UC-24 A6), archive ticket tiers with active sales (UC-26 A3), perform mandatory event cancellations with closed-loop wallet refunds (UC-25 / FR-010..012), and hide the "Đăng ký làm nhà tổ chức" (UC-37) footer CTA block for authenticated organizer accounts (FR-016).

## Technical Context

**Language/Version**: TypeScript 5.x (React 18 / Node.js)  
**Primary Dependencies**: React 18, React Router, Recharts, Express / Node.js API client adapters  
**Storage**: PostgreSQL (+ `pgvector`), local storage / mock state for client adapters  
**Testing**: Vitest / Jest (contract & logic validation)  
**Target Platform**: Web Browser (Desktop & Mobile responsive SPA)  
**Project Type**: Web application (React SPA + REST/JSON service layer)  
**Performance Goals**: Portfolio list load < 1.5s (SC-001), 0ms purchase halt latency on cancellation (SC-004)  
**Constraints**: Integer VND pricing (STD-03), server-enforced identity scoping (SEC-04), closed-loop store-credit wallet refunds (v2.0.0 amendment), footer CTA hidden for ORGANIZER role (FR-016)  
**Scale/Scope**: Organizer dashboard portfolio under `/organizer` with multi-tier ticket breakdown, status filtering, and audit logging.

## Constitution Check

*GATE: Passed pre-research and post-design validation.*

1. **Reliability Under Load (Principle I)**:
   - Database source of truth for ticket sales and status metrics.
   - Dynamic/computed `"completed"` state eliminates background cron race conditions.
   - Immediate purchase halt on cancellation protects ticket inventory integrity.

2. **Security & Trust by Default (Principle II)**:
   - Server-enforced identity scoping (`organizer_id = req.user.id`) on all endpoints (SEC-04).
   - Mandatory cancellation reason logged into immutable `EventCancellationAuditRecord` (SEC-09).

3. **AI Is Assistive, Grounded, and Non-Blocking (Principle III)**:
   - Non-blocking: Organizer management workspace operates independently of AI availability.

4. **Verifiable Requirements & Test-First (Principle IV)**:
   - All 5 User Stories have clear acceptance scenarios and testable metrics (SC-001..005).

5. **Simplicity & Free-Tier Discipline (Principle V)**:
   - Stateless REST endpoints, bounded connection pools, closed-loop wallet refunds (no third-party payout gateways).

6. **Clean Codebase & Seamless FE/BE Integration (Principle VI)**:
   - Machine-checked TypeScript contract definitions (`types.ts`, `contracts/organizer-events-api.md`).

## Project Structure

### Documentation (this feature)

```text
specs/010-organizer-event-management/
├── spec.md              # Feature specification
├── plan.md              # Implementation plan (this file)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 data model & state transitions
├── quickstart.md        # Phase 1 validation guide
├── contracts/           # Phase 1 interface contracts
│   └── organizer-events-api.md
└── checklists/
    └── requirements.md
```

### Source Code Layout

```text
src/
├── types.ts                     # Shared TypeScript interfaces (OrganizerEvent, TicketTier, etc.)
├── services/
│   ├── organizerClient.ts       # Organizer API service client & state adapter
│   └── apiError.ts              # Standardized API error handling
├── pages/
│   └── organizer/
│       ├── OrganizerEventsPage.tsx  # Main Portfolio Dashboard UI (/organizer)
│       └── SingleEventPage.tsx      # Workspace detail view & management controls (/organizer/:id)
├── components/
│   ├── Footer.tsx               # Main footer component (Hides UC-37 CTA for ORGANIZER role)
│   └── organizer/
│       ├── EventCard.tsx            # Event list card with status badge
│       ├── TicketTierBreakdown.tsx  # Tier metrics & archive action component
│       └── CancelEventModal.tsx     # Cancellation reason modal prompt
└── tests/
    └── organizer/
        └── organizerEvents.test.ts # Contract & state transition unit/integration tests
```

**Structure Decision**: Single React web application with client/server service adapter layer adhering to standard TixHub project structure under route `/organizer`.

## Complexity Tracking

> **No violations**. All designs comply strictly with the TixHub Constitution v2.0.0.
