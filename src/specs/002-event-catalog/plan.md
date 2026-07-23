# Implementation Plan: Event Catalog & Discovery

**Branch**: `002-event-catalog` | **Date**: 2026-07-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/src/specs/002-event-catalog/spec.md`

## Summary

Build TixHub's event catalog: the public read side (browse/search/filter, event detail, showtimes, and
a **read-only** seat map) plus the organizer/admin write side (event + showtime + tier + venue + seat-map
CRUD and admin moderation). It replaces the frontend mock `src/data.ts` with a real API. Everything
downstream — seat holds, orders, tickets — attaches to the entities defined here.

Technical approach: extend the existing monorepo with a `catalog` backend module, reusing feature 001's
`requireAuth` / `requireOrganizer` / `requireAdmin` middleware and the derived-per-request identity model.
The load-bearing rule is the **live visibility predicate** — an event is public only when
`event.status='on_sale' ∧ event.moderation_status='approved' ∧ owning organizer is approved` — computed
in SQL on every public read, never cached onto the event (D-B/D-E, mirrors 001's immediate-suspension
rule). **Pre-publish moderation** (D-C) means admin approval is on the critical path, so the admin
approve/reject endpoint ships in this feature. Money stays VND integer (D1). Sold-out and city are
**derived** from showtimes/venues, never stored (D-A).

## Technical Context

**Language/Version**: TypeScript (strict) — Node.js 20 (backend), React 18 SPA (frontend), same stack as feature 001.

**Primary Dependencies**: Express, `pg` (parameterized queries), `zod` (input validation), reuse of feature 001's auth middleware. A slug helper (slugify + uniqueness). No new external integration (Principle V; cap unaffected). Frontend: React + Vite, shared types from `shared/catalog/`.

**Storage**: PostgreSQL (Neon). New migration `0002_catalog.sql` creates the catalog tables from `SCHEMA_DATABASE.md` (`event_categories`, `venues` **+ `created_by`**, `sections`, `seats`, `events`, `showtimes`, `ticket_tiers`, `showtime_seats`) — none exist yet (only the auth tables from `0001_auth.sql`).

**Testing**: Vitest (integration against the Neon test data), reusing `server/tests/helpers`. RBAC/ownership/visibility-leak tests are mandatory (SC-004/007); the ≥60% coverage gate stays on the critical money/seat modules (holds/orders, later) per MAIN-03 — catalog is not that critical-logic tier, but visibility and ownership denials are tested.

**Target Platform**: Same single VPS (`tixhub.fit`), Nginx same-origin, Neon Postgres (ADR 0003).

**Performance Goals**: SC-002 — 95% of catalog searches < 1 s under ordinary load. Read-heavy; indexed queries on category/status/city/starts_at.

**Constraints**: VND integer money only (D1). Vietnamese UI. Public reads require no auth; every write is RBAC- and ownership-scoped server-side. Visibility computed live per request. Reads must never leak drafts/pending/flagged/removed/suspended-organizer events (SC-004).

**Scale/Scope**: 7 user stories, ~33 FRs. Tables: 8 catalog tables (new migration). Endpoints: ~6 public read + ~5 organizer CRUD groups + ~3 admin moderation. Replaces the FE mock catalog.

## Constitution Check

*GATE: evaluated before Phase 0 and re-checked after Phase 1 design.*

| Principle | Gate | Verdict |
|---|---|---|
| **I — Reliability under load** | Catalog does **not** sell seats (holds/orders are downstream); the seat map is read-only, so the no-double-sell invariants (DATA-01/02/03) are not exercised here. This feature only *creates the seat-map data model* those invariants will later protect. It introduces no path that mutates inventory. | **PASS** (out of the critical-write path) |
| **II — Security & Trust** | Public reads are open; every organizer write requires an approved organizer **and** ownership of the target (server-enforced, D-D); admin moderation requires the admin flag. Inputs zod-validated; queries parameterized; user content output-encoded; VND integers only (FR-019). Pre-publish moderation keeps unreviewed content off buyers (Principle II trust). Moderation actions write `audit_logs` (SEC-09). | **PASS** (by design) |
| **IV — Verifiable** | Denials tested (RBAC, cross-organizer, visibility leak SC-004, suspended-organizer hide). Sold-out-derivation test (SC-005). The hard 60% gate remains on later money/seat modules; catalog gets targeted denial + derivation tests. | **PASS** (by design) |
| **V — Simplicity / Free-tier** | Postgres `ILIKE` + relevance ranking for search (dozens of events) — no premature full-text/pgvector. No new integration. | **PASS** |
| **VI — Clean / One contract** | Request/response shapes defined once in `shared/catalog/` and imported by both sides; consistent error shape reused from 001. | **PASS** |

**No violations.** One schema addition (`venues.created_by`, D-F) — additive, owned by this feature's migration. Post-Phase-1 re-check: design introduces no new violation; the live-visibility predicate is a single reusable SQL fragment, not scattered logic.

## Project Structure

### Documentation (this feature)

```text
src/specs/002-event-catalog/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── catalog.openapi.yaml
└── tasks.md             # /speckit-tasks output (NOT created here)
```

### Source Code (repository root — extends the feature-001 monorepo)

```text
server/
├── src/
│   ├── modules/
│   │   └── catalog/                 # this feature
│   │       ├── catalog.public.routes.ts   # GET events, event by slug, showtimes, seat-map
│   │       ├── events.routes.ts           # organizer event CRUD + publish/unpublish
│   │       ├── showtimes.routes.ts        # organizer showtime + ticket-tier CRUD
│   │       ├── venues.routes.ts           # organizer venue/section/seat CRUD + seat-map generate
│   │       ├── moderation.routes.ts       # admin approve/reject/flag/remove
│   │       ├── catalog.repo.ts            # parameterized queries + the visibility predicate
│   │       ├── visibility.ts              # the live public-visibility SQL fragment (D-B/D-E)
│   │       ├── availability.ts            # sold-out / remaining-quantity derivation (D-A)
│   │       ├── slug.ts                    # stable unique slug generation (FR-031)
│   │       └── seatmap.ts                 # generate showtime_seats from a venue's seats (US5)
│   ├── middleware/                        # reuse requireAuth/requireOrganizer/requireAdmin (001)
│   │   └── requireOwner.ts                # NEW: event/venue ownership guard (D-D)
│   └── db/migrations/
│       └── 0002_catalog.sql              # 8 catalog tables + venues.created_by
└── tests/catalog/                         # visibility-leak, ownership, moderation, derivation tests

shared/
└── catalog/                               # one typed contract (Principle VI)
    └── types.ts                           # EventCard, EventDetail, SeatMap, tiers, admin/organizer bodies

src/                                        # React SPA — replaces the mock src/data.ts
├── pages/catalog/                          # browse/search, event detail, showtime seat-map
├── pages/organizer/                        # event/showtime/venue management, "my events"
├── pages/admin/                            # moderation review queue
└── services/catalogClient.ts               # typed API client (reuses authClient's token/refresh)
```

**Structure Decision**: Extend the existing monorepo (server/ + shared/ + src/, ADR 0003). The catalog is a self-contained backend module at `server/src/modules/catalog/`, reusing feature 001's auth middleware and error/validation infrastructure. The FE gains catalog/organizer/admin page groups and a `catalogClient` alongside the existing `authClient`; the mock `src/data.ts` is retired for the browse/detail flows (SC-011). No new top-level roots.

## Complexity Tracking

*No constitution violations to justify.* The only structural note is the additive `venues.created_by` column (D-F), owned by `0002_catalog.sql` — the same pattern as `password_resets` in feature 001.
