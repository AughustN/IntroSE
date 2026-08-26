# Implementation Plan: Concession Add-Ons (Bắp Nước)

**Branch**: `014-fnb-add-ons` | **Date**: 2026-08-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/014-fnb-add-ons/spec.md`

## Summary

Attendees buy snacks/drinks ("bắp nước") together with tickets in the same reservation and the
same single wallet payment; organizers curate one menu per Event; each paid order carrying
concessions mints exactly one SHA-256-hashed QR voucher that counter staff scan once to hand over
every line; cancelling an event refunds concession money to wallets next to ticket refunds.
Technically: two new snapshot-backed tables (`reservation_concessions`, `order_concessions`) plus
`concession_items` (menu, unlimited stock) and `concession_vouchers` (one per order), wired into
the existing `checkout()` and `settleEventCancellation()` transactions — no new payment path, no
inventory contention.

## Technical Context

**Language/Version**: TypeScript 5.x, `strict` mode on both sides (constitution-mandated)

**Primary Dependencies**: Node.js + Express (REST API), React 19 SPA, Zod (input validation),
node:crypto (`randomUUID`, `createHash('sha256')` for voucher codes — same pattern as ticket
barcodes)

**Storage**: PostgreSQL (Neon, TLS) via bounded `pg` pool ≤ 20 (SCAL-01); schema changes ship as
`server/src/db/migrations/0039_concession_add_ons.sql` **and** are synced into
`data_base/InitDB.sql` (house rule for every schema change)

**Testing**: Vitest + Supertest (`server/tests/**`), following `server/tests/checkin/checkin.test.ts`
patterns; k6 for the load check behind SC-005

**Target Platform**: Single team-managed VPS (Nginx TLS + static SPA + reverse proxy,
`tixhub.fit`), same-origin `/api`

**Project Type**: Web application (React SPA ↔ REST/JSON), monorepo layout `src/` (SPA),
`server/` (API), `shared/` (typed FE/BE contracts — Principle VI), `data_base/` (schema dump)

**Performance Goals**: SC-005 — p95 confirm-time delta between tickets-only and
tickets+concessions orders < 1 second; menu read served from the existing catalog rate-limiter
bucket (60 req/min/IP)

**Constraints**: All money VND integers, never floating point (STD-03); maximum 10 units per item
per order; unlimited stock — no counters, no locks, nothing can sell out (clarified with user);
add-on only — an order with concessions but zero tickets is impossible (FR-004); one voucher per
order; Vietnamese UI copy throughout

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Reliability Under Load | **PASS** | Unlimited stock removes all contention on the new path. Voucher redemption flips state with one guarded `UPDATE … WHERE status = 'unredeemed'` inside a transaction; double scans physically cannot both win. All money moves ride the existing ACID transactions in `checkout()` / `settleEventCancellation()` — no new settlement path. |
| II. Security & Trust by Default | **PASS** | RBAC server-side on every endpoint: public menu read gated by the live visibility predicate; organizer CRUD ownership-checked against `events.organizer_id`; redeem scoped to the owning organizer or admin with the anti-oracle behaviour of ticket check-in (foreign/unknown codes answer identically). Parameterized queries only; voucher codes hashed at rest (`code_hash`, mirroring `tickets.qr_token_hash`). |
| III. AI Assistive/Grounded/Non-Blocking | **N/A** | No AI surface touched; purchase path stays AI-free. |
| IV. Verifiable Requirements & Test-First | **PASS (planned)** | Checkout and refund are named critical-logic modules: tasks must land Vitest/Supertest coverage for combined-total math, insufficient-balance including concessions, stopped-item conflict mid-checkout, double-redeem denial, foreign-event redeem denial, and cancellation refund totals — asserting denials, not just happy paths. |
| V. Simplicity & Free-Tier Discipline | **PASS** | Unlimited stock is the YAGNI choice (no sold/held counters, no sweep changes). Four small tables, no combos/discounts, no delivery, no per-showtime menus. No new external dependency (integration cap untouched). |
| VI. Clean Codebase & FE/BE Contract | **PASS (planned)** | One shared contract in `shared/types/fnb.ts` imported by both SPA and API; `Reservation`/`OrderView` shapes extended in place so no consumer re-declares payloads. Legacy mock `comboOffer` field left untouched (out of scope per spec assumptions). |

**Post-design re-check (Phase 1)**: confirmed — see research.md §D8; no violations, nothing to
track in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/014-fnb-add-ons/
├── plan.md              # This file
├── research.md          # Phase 0 output — decisions D1–D8
├── data-model.md        # Phase 1 output — 4 tables, state machines, integration points
├── quickstart.md        # Phase 1 output — E2E validation scenario
├── contracts/
│   └── fnb-api.md       # Phase 1 output — REST contract + shared types
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
shared/
└── types/
    └── fnb.ts                     # NEW — one typed contract for menu, cart lines, voucher (Principle VI)
server/
├── src/
│   ├── db/
│   │   ├── migrations/
│   │   │   └── 0039_concession_add_ons.sql   # NEW — 4 tables + indexes + checks
│   │   └── …
│   └── modules/
│       └── concessions/
│           ├── concessions.repo.ts    # NEW — SQL for menu + lines + vouchers
│           ├── concessions.service.ts # NEW — rules: caps, windows, snapshots, redemption, refunds
│           ├── concessions.public.routes.ts   # NEW — GET /api/catalog/events/:eventId/concessions
│           └── concessions.organizer.routes.ts # NEW — CRUD under /api/organizer/events/:eventId/concessions
├── src/modules/payments/wallet.service.ts      # EDIT — checkout(): fold concession lines into total, mint voucher
├── src/modules/payments/tickets.service.ts     # EDIT — settleEventCancellation(): refund concessions, void vouchers
├── src/modules/holds/holds.service.ts          # EDIT — reservation read/write includes concession lines
├── src/app.ts                                  # EDIT — mount the two new routers
└── tests/concessions/*.test.ts                 # NEW — Supertest suites (see quickstart.md)
data_base/InitDB.sql                             # EDIT — sync 0039 DDL (house rule)
src/                                             # SPA: menu picker in checkout, voucher on ticket view,
                                                 #      organizer menu screen, scanner accepts voucher codes
```

**Structure Decision**: Web-application layout already in place (Option 2 shape) — feature lives
in one new `concessions` server module plus surgical edits to the three existing money-path
services; the SPA grows screens inside its existing pages/components conventions; the contract
lives in `shared/concessions/types.ts` so FE and BE cannot drift (Principle VI).

## Complexity Tracking

> Filled only for justified violations — none: the design adds no new projects, patterns, or
> infrastructure beyond the repo's existing conventions.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| *(none)* | — | — |
