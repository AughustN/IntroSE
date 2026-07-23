# Tasks: Event Catalog & Discovery

**Input**: Design documents from `/src/specs/002-event-catalog/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/catalog.openapi.yaml, quickstart.md

**Tests**: REQUIRED for the denial/visibility/ownership/derivation invariants (SC-004/005/007/009, FR-018/029/033). The ≥60% hard coverage gate stays on the later money/seat modules (holds/orders), so the catalog is verified by **targeted** tests, not a blanket threshold. Write the test first.

**Organization**: by user story. P1 = US1/US2/US3 (public read); P2 = US4/US5/US6 (organizer/admin write — US6 admin-approve is on the critical path under pre-publish moderation); P3 = US7 (SEO).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependency on an incomplete task → parallelizable.
- Backend: `server/src/modules/catalog/…`; shared: `shared/catalog/…`; FE: `src/…`; tests: `server/tests/catalog/…`.

---

## Phase 1: Setup

- [X] T001 Create the catalog skeleton: `server/src/modules/catalog/`, `server/tests/catalog/`, `shared/catalog/`, `src/pages/{catalog,organizer,admin}`, `src/services/catalogClient.ts`
- [X] T002 [P] Add npm deps if any (a slugify/ascii-fold helper or a small local one); reuse existing express/pg/zod

---

## Phase 2: Foundational (Blocking)

**⚠️ No user-story work begins until this phase is complete.**

- [X] T003 Migration `server/src/db/migrations/0002_catalog.sql`: create `event_categories`, `venues` (**incl. `created_by BIGINT NOT NULL REFERENCES users(id)`**, drop the name/city UNIQUE per D-F), `sections`, `seats`, `events`, `showtimes`, `ticket_tiers`, `showtime_seats` with all CHECKs/indexes (data-model.md); **seed** `event_categories` (music/workshop/theatre/community…)
- [X] T004 [P] Derive `shared/catalog/types.ts` from `contracts/catalog.openapi.yaml` — `EventCard`, `EventDetail`, `Tier`, `Showtime`, `SeatMap`, organizer/admin request bodies (Principle VI)
- [X] T005 [P] `catalog/visibility.ts` — the reusable public-visibility SQL fragment `on_sale ∧ approved ∧ organizer.approved` (R-1, D-B/D-E)
- [X] T006 [P] `catalog/availability.ts` — derive sold-out (seated: available-seat count; GA: capacity−sold−reserved) and event sold-out = all upcoming showtimes sold out (R-2, D-A)
- [X] T007 [P] `catalog/slug.ts` — slugify (VN diacritics→ascii) + uniqueness suffix; set once, immutable on title edit (R-4, FR-031)
- [X] T008 [P] `catalog/catalog.repo.ts` — parameterized queries composing the visibility fragment + availability aggregates; ownership-scoped organizer queries
- [X] T009 `server/src/middleware/requireOwner.ts` — event/venue ownership guard (event.organizer_id→organizers.user_id, venue.created_by), admin bypass (D-D, R-8)
- [X] T010 Mount catalog routers in `server/src/app.ts`: public (`/api/events`, `/api/showtimes`), organizer (`/api/organizer/*`), admin (`/api/admin/*`)

**Checkpoint**: schema, shared types, visibility/availability/slug/ownership helpers ready.

---

## Phase 3: User Story 1 — Browse & search (P1) 🎯 MVP

**Goal**: public browse/search/filter over only-visible events. **Independent test**: filter as a guest; a draft/pending event never appears.

- [X] T011 [P] [US1] Tests `server/tests/catalog/browse.test.ts`: public list shows only visible events; each filter (q/category/city/date/price/availability) matches; keyword ranks title>lineup>description (FR-003); sold-out shown+labelled+last (FR-004); **no draft/pending leaks even by direct query** (SC-004)
- [X] T012 [US1] `catalog.public.routes.ts` `GET /api/events` — filters + relevance rank + pagination + availability summary + starting price (FR-001..005)
- [X] T013 [P] [US1] FE browse/search page in `src/pages/catalog/` + `catalogClient.listEvents`, replacing the mock list from `src/data.ts`

**Checkpoint**: guests can discover events against the real API.

---

## Phase 4: User Story 2 — Event detail (P1)

**Goal**: full detail by stable slug. **Independent test**: open by slug, all fields present; unknown/undisclosed slug → 404.

- [X] T014 [P] [US2] Tests `server/tests/catalog/detail.test.ts`: detail by slug (tiers with VND-integer prices, venue guide, refund policy, upcoming showtimes, related); undisclosed slug → 404, never leaking drafts (FR-009/SC-004); prices integer (SC-009)
- [X] T015 [US2] `GET /api/events/:slug` — detail + related (same category/city) + SEO fields (FR-006..008)
- [X] T016 [P] [US2] FE event detail page in `src/pages/catalog/` + `catalogClient.getEvent`

---

## Phase 5: User Story 3 — Showtimes & read-only seat map (P1)

**Goal**: view showtimes + seat map; no holds. **Independent test**: seated map shows seat/tier/status; GA shows tier remaining; no hold can be made.

- [X] T017 [P] [US3] Tests `server/tests/catalog/seatmap-read.test.ts`: upcoming showtimes only (past/cancelled excluded, FR-013); seated seat-map (row/number/tier/status); GA tier remaining (FR-010/011); guest can view, no hold path exists (FR-012)
- [X] T018 [US3] `GET /api/events/:id/showtimes` and `GET /api/showtimes/:id/seat-map` (read-only, availability derived)
- [ ] T019 [P] [US3] FE showtime + read-only seat-map view in `src/pages/catalog/`

**Checkpoint**: the full public read side works; MVP (P1) demoable on seed data.

---

## Phase 6: User Story 4 — Organizer creates & publishes (P2)

**Goal**: approved organizer CRUDs & publishes their own events. **Independent test**: create+publish appears only after admin approves (US6); cross-organizer edit refused.

- [X] T020 [P] [US4] Tests `server/tests/catalog/organizer-events.test.ts`: create → draft owned + slug; publish → on_sale+pending_review (not public, FR-030); non-organizer create → 403; organizer B edits A's event → 403 (SC-007); title edit keeps slug (SC-010); fractional price → 400 (SC-009); material edit of approved → pending_review
- [X] T021 [US4] `events.routes.ts`: `POST /organizer/events` (create draft, resolve caller's approved organizer, slug), `PATCH /organizer/events/:id` (requireOwner; material edit → re-review), `POST …/publish` (require ≥1 upcoming showtime+tier, → pending_review), `POST …/unpublish`, `GET /organizer/events`
- [X] T022 [US4] `showtimes.routes.ts`: add/edit/remove showtimes + ticket tiers on own event (VND-integer validation, FR-015/019)
- [X] T023 [P] [US4] FE organizer "my events" + create/edit event + showtime/tier forms in `src/pages/organizer/`

---

## Phase 7: User Story 5 — Venues & seat-map generation (P2)

**Goal**: organizer manages own venues and generates a per-section-tiered seated map. **Independent test**: venue owned by creator; generate creates one showtime_seat per seat.

- [ ] T024 [P] [US5] Tests `server/tests/catalog/venues-seatmap.test.ts`: venue created with `created_by`=caller; org B can't edit A's venue (D-F); generate → one `showtime_seats` per physical seat, all available, tier by section; regenerate over live map → 409; delete seat in live map → 409 (FR-024); section without a tier → 400
- [ ] T025 [US5] `venues.routes.ts`: venue + section + seat CRUD scoped to `created_by` (requireOwner)
- [ ] T026 [US5] `catalog/seatmap.ts` + `POST /organizer/showtimes/:id/seat-map` — per-section tier mapping → `INSERT … SELECT` seats→sections→tier (R-7)
- [ ] T027 [P] [US5] FE venue management + seat-map generator (section→tier mapping UI) in `src/pages/organizer/`

---

## Phase 8: User Story 6 — Admin moderation (P2, critical path)

**Goal**: admin approves (the visibility gate), rejects, flags, removes. **Independent test**: approve → appears next request; reject → never public; suspend organizer → all their events hidden.

- [X] T028 [P] [US6] Tests `server/tests/catalog/moderation.test.ts`: review queue admin-only (403 for others, FR-027); approve → event public on next request (SC-006/008) + `audit_logs` row (FR-028); reject → removed+reason, never public, organizer sees reason; flag/remove pulls it next request; **suspending the organizer hides all their approved events next request** (FR-033/D-E)
- [X] T029 [US6] `moderation.routes.ts`: `GET /admin/moderation` (pending queue), `POST /admin/events/:id/{approve,reject,flag,remove}` (requireAdmin; write `audit_logs`)
- [X] T030 [P] [US6] FE admin moderation review queue + approve/reject/flag/remove in `src/pages/admin/`

**Checkpoint**: organizer→admin→buyer flow is end-to-end; nothing reaches buyers unreviewed.

---

## Phase 9: User Story 7 — SEO (P3)

- [ ] T031 [P] [US7] FE: server-renderable `<title>`/meta + JSON-LD `Event` block from the detail payload; slug as canonical URL (FR-032); confirm slug stable across title edits
- [ ] T032 [P] [US7] Test: event detail exposes SEO title/description, image, and structured data fields

---

## Phase 10: Polish & Cross-Cutting

- [ ] T033 Retire the mock: remove `src/data.ts` usage from the browse/detail flows; supersede `MovieEvent` with `shared/catalog` types (SC-011)
- [ ] T034 [P] Perf check for SC-002 in `server/tests/perf/catalog.load.js`: catalog search p95 < 1 s against a seeded DB
- [ ] T035 Execute `quickstart.md` end-to-end for every user story
- [ ] T036 [P] Verify `shared/catalog/types.ts` imported by both server and FE with no re-declared payloads (Principle VI); typecheck + lint clean

---

## Dependencies & Execution Order

- **Setup → Foundational** blocks everything. Within Foundational: T003 (schema) before T006/T008; T005/T006/T007/T008 feed the routes; T009/T010 wire access.
- **P1 (US1→US2→US3)** is the public read side — demoable on seed data without the write side.
- **US4 (organizer create)** produces events that are **not public until US6 (admin approve)** — the two are coupled by pre-publish moderation, so US6 is P2 (not a late slice). US5 (venues/seat-map) supports seated US4 events.
- **US7/Polish** after the stories.

## Parallel Opportunities

- Foundational: T004–T008 are `[P]` (distinct files) once T003 lands; T009/T010 follow.
- Every story's test task (`T011/T014/T017/T020/T024/T028/T032`) is `[P]`.
- All FE tasks (`T013/T016/T019/T023/T027/T030/T031`) run parallel to their backend once shared types (T004) exist.

## Implementation Strategy

- **MVP = P1 public read** (Setup → Foundational → US1 → US2 → US3) against seed data — a browsable, searchable catalog replacing the mock.
- **Then the write loop**: US4 (organizer) + US5 (venues/seat-map) + US6 (admin approve) together make the organizer→buyer flow real end-to-end.
- **Gate**: T034 (search p95 < 1 s), T035 (quickstart), T036 (typecheck/lint, one contract).

## Notes

- Reuses feature 001's `requireAuth`/`requireOrganizer`/`requireAdmin`, error/validation middleware, and `audit_logs`. No new external integration.
- The live visibility predicate (T005) must be composed into **every** public read — the single most important anti-leak control (SC-004).
- Money is whole VND integers everywhere (D1); reject fractional at the zod boundary.
