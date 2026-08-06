# Tasks: Organizer Event Studio

**Input**: Design documents from `src/specs/006-organizer-studio/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/studio.openapi.yaml, contracts/ai-listing.md, contracts/catalog-read-impact.md, quickstart.md

**Tests**: REQUIRED. SC-002 through SC-018 each name an automated test, and the spec's testing bar is explicit that *every refusal path* gets an asserting test, not just the happy path. Constitution Principle IV applies: this feature edits tiers with money already taken and implements a security control, so the refusal tests are written **before** the write paths they pin.

**Organization**: by user story. P1 = US1 (tier lifecycle) + US2 (edit guards) + US3 (re-moderation); P2 = US4 (console); P3 = US5 (AI assistant).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependency on an incomplete task → parallelizable.
- Backend: `server/src/modules/studio/…`; shared: `shared/catalog/types.ts`; FE: `src/components/organizer/…`; tests: `server/tests/studio/…`.

### One structural decision worth reading first

`moderation-guard.ts` is **Foundational (Phase 2), not US3**, even though US3 is the story about it. If it lived in US3, then shipping US1 or US2 alone would put new write paths into production while the moderation gate is still bypassable — the exact hole this feature exists to close, widened by our own work. So the guard is a blocking prerequisite for any organizer write, and US3 owns the *end-to-end proof* that it holds: the per-endpoint table test, the public-catalog disappearance, the untouched-inventory assertion, and the audit trail. US3 stays independently testable because its tests exercise the guard through the endpoints, not through a unit seam.

---

## Phase 1: Setup

- [X] T001 Create the module skeleton: `server/src/modules/studio/`, `server/src/modules/studio/ai/`, `server/tests/studio/`, and `src/components/organizer/`
- [X] T002 [P] Confirm no new packages are needed — `@google/genai` is already a dependency (unused until now) and `react-router-dom` v7 is already present; record in `package.json` that nothing is added (FR-034, Principle V — the four-integration cap is untouched)
- [X] T003 [P] Add a 60% coverage threshold for `server/src/modules/studio/**` to `vitest.config.ts`, alongside the existing auth/holds/seatmap entries (MAIN-03, Principle IV)

---

## Phase 2: Foundational (Blocking)

**⚠️ No user-story work begins until this phase is complete.**

- [X] T004 Migration `server/src/db/migrations/0011_studio.sql` per data-model.md: `ALTER TABLE ticket_tiers ADD COLUMN archived_at TIMESTAMPTZ`; `CREATE INDEX idx_ticket_tiers_active ON ticket_tiers(showtime_id) WHERE archived_at IS NULL`; `CREATE INDEX idx_audit_logs_target ON audit_logs(target_type, target_id)`. Additive only — every existing tier is active because `archived_at` defaults to NULL
- [X] T005 [P] Add constants to `server/src/config.ts`: `MAX_TIERS_PER_SHOWTIME` (4), `AI_RATE_LIMIT` (10) / `AI_RATE_WINDOW_MS` (1 h), `AI_TIMEOUT_MS` (8000), `AI_CACHE_TTL_MS` (24 h), `AI_CACHE_MAX_ENTRIES` (500), `AI_DAILY_QUOTA` (200) — env-overridable via the existing `ms()` helper, not hard-coded (UC-36)
- [X] T006 [P] Extend `shared/catalog/types.ts` from `contracts/studio.openapi.yaml`: add `ManagedTier`, `TierMutationResult`, `ShowtimeMutationResult`, `EventMutationResult`, `ListingSuggestion`, `ListingResponse`. **One definition, imported by both sides (Principle VI)**. `Tier` itself is unchanged — its shape stays, only which rows are returned changes. **Also add `shared/catalog/material-edit.ts`**: `INVENTORY_ONLY_FIELDS` and a pure `isMaterialEdit(changedFields)` — the single definition of the FR-021 exemption rule, imported by the server guard (T008) and by the console's pre-save confirmation (T040), mirroring how 005 shares `seatmap-validate.ts`, so the warning an organizer sees and the decision the server makes can never disagree (R-9)
- [X] T007 `server/src/modules/studio/tiers.repo.ts`: `lockTier` (reuse the `FOR UPDATE` read from `holds.repo.ts`), `activeTierCount(showtimeId)` over the partial index, and `tierInventory(showtimeId)` returning capacity/sold/held/remaining per tier in **one grouped query**, branching on event type — GA reads the tier counters, seated counts `showtime_seats` by `ticket_tier_id` and status (R-5, FR-009)
- [X] T008 `server/src/modules/studio/moderation-guard.ts`: `applyOrganizerEdit(client, eventId, changedFields)` and `applyInventoryEdit(client, eventId, changedFields)`. Both run **inside the caller's transaction** (FR-023). `applyOrganizerEdit` flips `moderation_status` to `pending_review` only when it is currently `approved`, sets the review note, and writes the FR-026 audit row with **field names only, never values**; it must never touch `events.status` (FR-024). `applyInventoryEdit` writes the audit row and leaves moderation alone — the two names are the whole point, so a reviewer sees the exemption at the call site (R-2). **Which of the two a caller gets is decided by `isMaterialEdit` from T006's shared module, never by a rule written here** — that shared definition is what keeps the console's warning honest (R-9)
- [X] T009 `server/src/modules/studio/studio.routes.ts` skeleton + mount in `server/src/app.ts` under `/api/organizer` behind `requireAuth, requireOrganizer`, with Zod schemas for every body in `contracts/studio.openapi.yaml` (SEC-07) and ownership helpers `assertEventOwner` / `assertShowtimeOwner` / `assertTierOwner` that resolve tier → showtime → event → organizer → user **server-side** and refuse (SEC-04, FR-035, FR-036)
- [X] T010 [P] `src/components/organizer/states.tsx`: `Loading`, `Empty`, `ErrorRetry` primitives in Vietnamese, reused by all four console levels — first-class, not afterthoughts (Principle VI, FR-040)
- [X] T011 [P] `server/tests/studio/helpers.ts`: fixtures building an approved organizer with an approved on-sale event, a GA showtime with a tier carrying sold and held quantities, and a seated showtime with a generated map — the shared setup every phase below depends on

**Checkpoint**: schema migrated with no visible change; shared contract exists; ownership-scoped routes mount; **no write path can reach an event without passing through the moderation guard**.

---

## Phase 3: User Story 1 — Manage a showtime's ticket types and capacity (P1) 🎯 MVP

**Goal**: tiers stop being write-once. Add, rename, reprice, change GA capacity, archive, restore, delete — each gated on live inventory.

**Independent Test**: on a showtime created with one tier, add a second, rename it, change its price, raise its capacity, archive it, restore it — and confirm each change reaches the public event page. Then lower capacity below sold and confirm the refusal names the numbers.

### Tests for User Story 1 ⚠️ write first, confirm they fail

- [X] T012 [P] [US1] `server/tests/studio/tiers-lifecycle.test.ts`: add with label + whole-đồng price (FR-001); **fifth active tier → `409 tier_limit_reached`** (FR-002, SC-004); rename and reprice (FR-003); fractional / negative / non-numeric price → `400`, nothing changed (FR-003, SC-001); **reprice a tier a buyer is currently holding → that reservation keeps the total captured when the hold was placed, and only a hold placed *after* the change gets the new price** (FR-010 — free from feature 003's captured unit price, but unasserted until now, so a later change to the hold path could silently reprice a buyer mid-checkout); **delete a tier with sales → archived, not deleted, and a previously sold ticket still resolves its label and price** (FR-006, SC-003); delete a tier with live holds → `409 tier_has_holds`, the reservation untouched (FR-008); delete the last active tier of an on-sale showtime → `409 tier_last_active` (FR-007); delete a seated price class still carrying bookable seats → `409 tier_has_seats` pointing at 005 (FR-007); **restore an archived tier** → active again; restore onto a showtime with 4 active tiers → `409 tier_limit_reached` (FR-006, SC-004); archive-then-add proves archives do not count toward the limit
- [X] T013 [P] [US1] `server/tests/studio/tiers-capacity.test.ts`: raise capacity freely; **lower below sold + reserved → `409 capacity_below_committed` with `{sold, held, requested}` in `details`** (FR-004, FR-018); capacity set to exactly sold + reserved → accepted, remaining 0; **concurrent capacity-lower and GA hold → exactly one succeeds and `sold + reserved <= total_quantity` always holds** (SC-002, R-3); manual capacity on a tier of a **seated** showtime → `422 manual_capacity_seated` (FR-005, SC-005)
- [X] T014 [P] [US1] Extend `server/tests/catalog/detail.test.ts` and `browse.test.ts` per `contracts/catalog-read-impact.md` #1 and #2: an archived tier is **absent** from the public payload, and a showtime whose only tier is archived reads as unavailable and drops out of the browse list
- [X] T015 [P] [US1] Extend `server/tests/holds/ga.test.ts` per `contracts/catalog-read-impact.md` #3: **a GA hold against an archived tier is refused**, and a reservation placed *before* the archive still converts normally. This is the test that makes "unpurchasable" true rather than merely "invisible" (R-4)

### Implementation for User Story 1

- [X] T016 [US1] `server/src/modules/studio/tiers.service.ts` — add / rename / reprice / capacity. Capacity runs in `withTransaction`, opens with `lockTier`, reads live sold + reserved and refuses below the floor naming both numbers; the existing table `CHECK` stays as the last line of defence and a `23514` is mapped to the same refusal code rather than a 500 (FR-003, FR-004, FR-005, R-3). Every path calls `applyOrganizerEdit` **except** the capacity-only change, which calls `applyInventoryEdit` (FR-021)
- [X] T017 [US1] `server/src/modules/studio/tiers.service.ts` — removal and restore: branch to archive when sold > 0, refuse when reserved > 0, refuse the last active tier of an on-sale showtime, refuse a seated price class with bookable seats, and re-check the four-active-tier limit on restore. Report `outcome: 'deleted' | 'archived'` so the console can word it correctly (FR-006, FR-007, FR-008)
- [X] T018 [US1] Wire `GET/POST /organizer/showtimes/{id}/tiers`, `PATCH/DELETE /organizer/tiers/{id}`, and `POST /organizer/tiers/{id}/restore` in `server/src/modules/studio/studio.routes.ts` per the contract, each returning `TierMutationResult` with `returnedToReview`
- [X] T019 [P] [US1] Exclude archived tiers from buyer reads: `AND archived_at IS NULL` in the tier query of `server/src/modules/catalog/catalog.repo.ts` and in `SHOWTIME_HAS_AVAILABILITY` in `server/src/modules/catalog/visibility.ts` (`contracts/catalog-read-impact.md` #1, #2)
- [X] T020 [US1] Refuse a hold against an archived tier in the GA path of `server/src/modules/holds/holds.repo.ts` / `holds.service.ts` — new holds only; holds placed before the archive still convert (`contracts/catalog-read-impact.md` #3, R-4)
- [X] T021 [P] [US1] Extend `eventShowtimesManage` in `server/src/modules/catalog/catalog.write.ts` to return archived tiers **with the flag** plus capacity/sold/held/remaining — the organizer view moves in the opposite direction from the buyer reads, or restore is unreachable from the UI (FR-009)
- [X] T022 [P] [US1] Add `studioApi` tier methods to `src/services/catalogClient.ts`, derived from `contracts/studio.openapi.yaml` so a server change that breaks the client fails at compile time (Principle VI)

**Checkpoint**: an organizer can run a tier's whole life without recreating the showtime, and no capacity change can ever breach what is sold or held.

---

## Phase 4: User Story 2 — Edit an event without breaking what is already sold (P1)

**Goal**: showtimes become editable — time, venue, deletion — and every edit that would contradict sold or held inventory is refused with a specific reason.

**Independent Test**: reschedule, relocate, and delete a clean showtime successfully; then place a hold on a second showtime and confirm all three are refused with reasons naming the live inventory, with the hold intact afterwards.

### Tests for User Story 2 ⚠️ write first, confirm they fail

- [X] T023 [P] [US2] `server/tests/studio/showtimes-guards.test.ts`: reschedule to another future time (FR-012); **reschedule into the past → refused**; reschedule/relocate/delete a started, finished, or cancelled showtime → refused (FR-013); delete a showtime with a sold ticket → `409 showtime_has_sales` (FR-014); **delete or relocate a showtime with a live hold → refused, and the reservation's items, seats, and expiry are byte-identical afterwards** (FR-015, SC-006); relocate a clean showtime to another owned venue → accepted (FR-016); relocate a seated showtime that has a bookable seat map → `409 seat_map_locks_venue` pointing at 005 (FR-016); assign a venue the caller does not own → `403 not_owner` (FR-017)
- [X] T024 [P] [US2] `server/tests/studio/event-delete.test.ts`: delete a never-approved, inventory-free draft → `204` (FR-020); **an event with an `event_approved` row in its audit history → `409 event_was_approved`, even though its current state reads `pending_review`** (R-1, SC-007); a `flagged` or `removed` event → `409 event_under_moderation` — a takedown is not erasable by its subject; an event whose showtime carries a sold ticket or a live hold → `409 event_has_inventory`

### Implementation for User Story 2

- [X] T025 [US2] `server/src/modules/studio/showtimes.service.ts`: reschedule (future-only, not started/finished/cancelled), relocate (0 sold, 0 held, no `showtime_seats`, target venue owned), delete (0 sold, 0 held, not started). Each refusal carries a specific code and a Vietnamese message naming what blocked it, and a refused edit leaves everything — including the moderation state — exactly as it was (FR-012..FR-019)
- [X] T026 [US2] `server/src/modules/studio/events.service.ts`: the widened event edit (title, description, image, refund policy, age restriction, category) and FR-020 deletion, whose "never approved" is derived from `audit_logs` rather than a column, so moderation history has a single source of truth (R-1)
- [X] T027 [US2] Wire `PATCH/DELETE /organizer/showtimes/{id}` and `PATCH/DELETE /organizer/events/{id}` in `server/src/modules/studio/studio.routes.ts`, and change `PATCH /events/:id` in `server/src/modules/catalog/organizer.routes.ts` to delegate here rather than keeping a second edit path (Principle VI — no drift between two handlers for one resource)
- [X] T028 [P] [US2] Add showtime and event write methods to `studioApi` in `src/services/catalogClient.ts`

**Checkpoint**: the edit surface is wide and every widening is guarded. US1 and US2 together are the whole authoring capability.

---

## Phase 5: User Story 3 — A material edit goes back for review (P1, security)

**Goal**: prove the moderation gate cannot be walked around by approve-then-edit, and that closing it costs no buyer anything.

**Independent Test**: approve an event, confirm it is public, edit its title, confirm it is gone from the catalog on the very next request, confirm an admin sees it queued with a reason, re-approve, confirm it is public again.

### Tests for User Story 3 ⚠️ write first, confirm they fail

- [X] T029 [P] [US3] `server/tests/studio/re-moderation.test.ts` — **the table test**: enumerate every organizer write endpoint with a minimal valid payload, run each against an approved on-sale event, and assert the resulting moderation state against an expected map. Everything returns `pending_review` except a GA capacity change. A newly added editable field that skips the guard fails here (SC-009, FR-021)
- [X] T030 [P] [US3] `server/tests/studio/re-moderation.test.ts` — end-to-end visibility: an approved, on-sale event is present in browse, search, and its slug detail; after a title edit it is **absent from all three on the next request**; the admin queue shows it with a reason; after re-approval it is present again (SC-008, FR-022). Also: a `draft`, `pending_review`, `flagged`, or `removed` event keeps its moderation state on edit (FR-025)
- [X] T031 [P] [US3] `server/tests/studio/re-moderation.test.ts` — **inventory untouched**: with live holds and sold tickets on the event, a material edit changes neither hold count, nor any reservation expiry, nor ticket count, and a buyer already holding seats can still complete checkout (SC-010, FR-024). Plus: a **refused** edit does not change the moderation state — a rejected edit must not be able to pull a live event from the catalog (US3 scenario 7)
- [X] T032 [P] [US3] `server/tests/studio/audit.test.ts`: every edit that returns an event to review writes an immutable row naming the acting organizer, the instant, and the changed **field names**; values are absent; an admin can read it; the organizer has no route that alters or deletes it (SC-018, FR-026)
- [X] T033 [P] [US3] `server/tests/studio/ownership.test.ts`: a second organizer is refused on **every** endpoint in `contracts/studio.openapi.yaml` — read and write, tier, showtime, event, and AI — and never receives a filtered list (SC-011, FR-035). Lives in the security story because it is the same class of guarantee, and is written as a matrix so a new endpoint added without ownership fails it

### Implementation for User Story 3

- [X] T034 [US3] Set the review reason in `applyOrganizerEdit` (`server/src/modules/studio/moderation-guard.ts`) so `events.review_note` explains the event was returned because it was edited — the admin queue and the organizer's own view already render this field (FR-025)
- [X] T035 [US3] Return `returnedToReview` from every mutation in `server/src/modules/studio/studio.routes.ts` so the console can tell the organizer what just happened rather than leaving them to notice their event vanished (FR-042 depends on this)
- [X] T036 [US3] Verify feature 002's moderation path is untouched: `server/tests/catalog/moderation.test.ts` passes **unmodified**, and admin approve/reject/flag/remove still own the `flagged` and `removed` states exclusively (spec: admin-side moderation is out of scope, 002 unchanged)

**Checkpoint**: the hole feature 002 left is closed, and closing it released no hold and voided no ticket.

---

## Phase 6: User Story 4 — A console that scales past one screen (P2)

**Goal**: grow `OrganizerPanel.tsx` from a flat single screen into four navigable levels that show the numbers the refusals refer to.

**Independent Test**: sign in as an organizer with two events, navigate list → event → showtimes → tiers, and confirm each level has its own loading, empty, and error state, that sold/held/remaining appear per tier, and that a refused edit shows the server's Vietnamese reason without discarding input.

- [X] T037 [P] [US4] Extend `src/routes.ts` with `/organizer/events/:eventId` and `/organizer/showtimes/:showtimeId`, adding the corresponding optional params to `Route` so every console level is linkable and survives Back, consistent with how the rest of the app got its URLs — **DONE.** `pathToRoute` returning null was what forced the redirect to `/`; teaching it `/organizer/events/:id` fixes it, and nothing re-mirrors `activeScreen` onto the URL except `closeAccountPage`. The console now reads the open event from the URL, so level 2 is linkable and Back works. A non-numeric or zero id stays `null` and is sent home.
- [X] T038 [US4] `src/components/organizer/OrganizerConsole.tsx`: the shell holding the four levels, wiring the shared `states.tsx` primitives so loading, empty, and error are handled once rather than per screen (FR-040)
- [X] T039 [P] [US4] `src/components/organizer/EventList.tsx` — level 1: the organizer's events with status and moderation badges, and an explicit empty state inviting a first event rather than a blank panel (FR-039, FR-040, US4 scenario 1)
- [X] T040 [P] [US4] `src/components/organizer/EventEditor.tsx` — level 2: the widened editable fields, **plus the confirmation before a material edit** telling the organizer that saving removes the event from the public catalog until an admin re-approves (FR-042, US4 scenario 5). The confirmation fires on `isMaterialEdit(changedFields)` from `shared/catalog/material-edit.ts` (T006) **and only when the event is currently approved and on sale** — do not re-derive the exemption rule here; the server's `returnedToReview` remains authoritative afterwards, this is the advance warning (R-9)
- [X] T041 [P] [US4] `src/components/organizer/ShowtimeList.tsx` — level 3: reschedule, relocate, delete, each disabled with an explanation when the showtime carries inventory, so the refusal is visible before it is triggered
- [X] T042 [P] [US4] `src/components/organizer/TierPanel.tsx` — level 4: label, whole-đồng price, **sold / held / remaining per tier** (or "capacity from the seat map" for a seated showtime), add / rename / reprice / capacity / archive / restore / delete, and the four-active-tier counter (FR-009, US4 scenario 3)
- [X] T043 [US4] Rework `src/components/OrganizerPanel.tsx` into the console entry point delegating to `OrganizerConsole`, keeping the existing venue creation and the `SeatMapBuilder` hand-off to feature 005 intact — **corrected after review:** the first pass dropped the *add-showtime* form entirely while claiming things were kept intact. Creating a showtime now lives in `ShowtimeList` (level 3, where showtimes are), with its 1–4 tier rows; the `SeatMapBuilder` hand-off sits in `EventEditor` and shows only for a seated event.
- [X] T044 [US4] Surface every server refusal against the control that caused it in `src/components/organizer/`: render the Vietnamese message as-is, keep the organizer's unsaved input, and never present stale data as current after a failed request (FR-041, SC-017, US4 scenarios 4 and 6)
- [ ] T045 [US4] Verify the console at 360 / 768 / 1920 px and confirm any showtime's tiers are reachable within three interactions from the entry point. **HUMAN-ONLY** — SC-016's own verification method is manual UX review, so this cannot be honestly automated. What needs eyes: whether the four-level navigation is comprehensible without a back-button hunt, and whether the refusal messages read as actionable Vietnamese rather than translated error codes — **HUMAN-ONLY, not run.** SC-016's own verification method is manual UX review.

**Checkpoint**: the feature is usable by a real organizer. Without this phase the server rules are correct and invisible.

---

## Phase 7: User Story 5 — AI drafts the listing (P3)

**Goal**: rough inputs become suggested titles, a description, tags, and a price — assistive, grounded, and silently optional.

**Independent Test**: submit rough inputs and confirm each suggested field is individually editable and rejectable before anything enters the form. Then force a timeout and confirm the form still works as plain manual entry with no blocking error.

### Tests for User Story 5 ⚠️ write first, confirm they fail

- [X] T046 [P] [US5] `server/tests/studio/ai-listing.test.ts`: **the 11th request within an hour → `429 ai_rate_limited` while manual entry keeps working** (SC-012, FR-031); an identical request within 24 h is served from cache with no upstream call (SC-014, FR-032); **guard order — a cache hit still consumes hourly allowance**, verified by 11 identical calls (`contracts/ai-listing.md`); timeout at `AI_TIMEOUT_MS`, upstream error, and exhausted daily quota each → **`200 {available:false, reason}`, never an error status** (SC-013, FR-030, R-7); a request against an approved, on-sale event → `409 ai_unavailable_live_event` (FR-027); a malformed model field is dropped rather than failing the whole response, and an all-dropped response degrades like a timeout

### Implementation for User Story 5

- [X] T047 [P] [US5] `server/src/modules/studio/ai/ai.throttle.ts`: per-user 10/hour bucket, the 24 h suggestion cache keyed by a hash of normalised inputs and **bounded at `AI_CACHE_MAX_ENTRIES` with oldest-first eviction** (PERF-07 — a cache with a user-controlled key must not grow without limit), and the process-wide daily quota counter (SCAL-03). Mirrors `holds.throttle.ts`, including a `resetAiThrottle()` test seam (R-8)
- [X] T048 [P] [US5] `server/src/modules/studio/ai/comparables.repo.ts`: the SQL price suggestion — a median tier price over publicly-visible events in the same category and city with an upcoming showtime, returning the sample size alongside it, and returning nothing when there are too few comparables (R-6, FR-033)
- [X] T049 [US5] `server/src/modules/studio/ai/listing.model.ts`: the model interface, `GeminiListingModel` using the already-installed `@google/genai` with an `AbortSignal.timeout(AI_TIMEOUT_MS)`, and `FakeListingModel` selected when `config.isTest` or no API key is configured — the same fallback shape `modules/auth/mailer.ts` uses for `ConsoleMailer`, so the suite covers every branch with no network call
- [X] T050 [US5] `server/src/modules/studio/ai/listing.service.ts`: orchestration in the exact order of `contracts/ai-listing.md` — ownership → live-event refusal → rate limit → cache → quota → SQL price + model prose → normalise → cache → respond. **The model is never asked for a price and never shown one**; prose only (R-6). Normalisation drops any field that fails validation rather than escalating
- [X] T051 [US5] Wire `POST /organizer/ai/listing` in `server/src/modules/studio/studio.routes.ts` with its Zod schema (SEC-07)
- [X] T052 [P] [US5] `src/components/organizer/AiListingPanel.tsx`: rough-input form, per-field accept / edit / reject, and a **silent** fallback to plain manual entry when `available:false` — a non-blocking notice, never an error state, and the console stays interactive while a call is in flight (FR-028, FR-029, FR-030, US5 scenarios 2 and 6)
- [X] T053 [P] [US5] Add `aiApi.listing()` to `src/services/catalogClient.ts`, typed from the shared `ListingResponse` so `available:false` is handled as data rather than as a thrown error

**Checkpoint**: the assistant helps when it can and disappears when it cannot.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T054 Run `npm run test:coverage` and confirm `server/src/modules/studio/**` clears the 60% floor with the refusal branches covered, not just the happy paths (MAIN-03, SC-015)
- [X] T055 [P] Amend the four documents this feature contradicts or extends, per spec.md Follow-ups: UC-24 **A6** rewritten to the exemption list, UC-26 **A3** pinned to *archives*, UC-26 gaining the live-holds refusal, UC-23 gaining the event-deletion flow, `docs/Analysis_Design/SCHEMA_DATABASE.md` (`ticket_tiers.archived_at` + the Organizer API section), and the `CONTEXT.md` **Ticket tier** glossary entry — **DONE.** UC-24 A6 inverted to the exemption list, UC-26 A3 pinned to *archives* plus a new A5 for the live-holds refusal, UC-23 gained A5 for event deletion, SCHEMA_DATABASE.md gained `archived_at` + its partial index + the studio endpoints (and now states plainly that admin organizer-approval is unbuilt), CONTEXT.md's Ticket tier entry covers active/archived.
- [ ] T056 [P] Run the three manual validations in `quickstart.md` — the moderation gate closing, the capacity floor under a live hold, and the assistant degrading silently — **PARTLY DONE.** The automated halves are covered by the suite; the three manual walkthroughs in quickstart.md still need a person.
- [X] T057 **Run the whole feature with `GEMINI_API_KEY` unset** and confirm every US1–US4 path is unaffected. This is the constitutional claim that AI is never on a critical path (Principle III), and it is only true if someone checks it
- [X] T058 `npm run typecheck && npm run lint` clean, and no dead code, commented-out blocks, or `console.log` merged (MAIN-01, MAIN-02, Principle VI)

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup. **Blocks every user story** — in particular T008 (the moderation guard) blocks all of US1, US2, and US3, by design.
- **US1 (Phase 3)**, **US2 (Phase 4)**, **US3 (Phase 5)**: each depends only on Phase 2 and can proceed in parallel with the others.
- **US4 (Phase 6)**: depends on Phase 2; its screens are most useful once US1/US2 endpoints exist, but the shell, routing, and state primitives can be built against the contract before them.
- **US5 (Phase 7)**: depends only on Phase 2. Fully independent of US1–US4 — that independence is the point.
- **Polish (Phase 8)**: depends on the stories you intend to ship.

### Within each story

- Tests are written and **failing** before the implementation they pin (Principle IV).
- Repo before service, service before route, route before client.
- The cross-feature read changes (T019, T020, T021) come after the archive lifecycle exists (T017) — there is nothing to exclude before then.

### Notable non-obvious dependencies

- **T020 depends on T017.** Archiving is a display change until the hold path refuses an archived tier. Shipping T017 without T020 leaves FR-006 false in the one way that matters.
- **T035 blocks T040.** The console cannot warn about a re-review it is not told about.
- **T029 depends on all of US1 and US2 being wired.** The table test enumerates endpoints, so it is written early and goes green last — expect it red for most of the feature, which is exactly its job.

### Parallel opportunities

- T002, T003 in Setup.
- T005, T006, T010, T011 in Foundational (after T004 for anything touching the schema).
- All four US1 test tasks (T012–T015) together; then T019, T021, T022 together.
- US1, US2, US3, and US5 can be staffed simultaneously once Phase 2 lands.

---

## Parallel Example: User Story 1

```bash
# Write all four failing test files together:
Task: "tiers-lifecycle.test.ts in server/tests/studio/"
Task: "tiers-capacity.test.ts in server/tests/studio/"
Task: "archived-tier exclusion in server/tests/catalog/detail.test.ts + browse.test.ts"
Task: "archived-tier hold refusal in server/tests/holds/ga.test.ts"

# Then the independent implementation files:
Task: "exclude archived tiers in catalog.repo.ts + visibility.ts"
Task: "eventShowtimesManage returns archived + inventory in catalog.write.ts"
Task: "studioApi tier methods in src/services/catalogClient.ts"
```

---

## Implementation Strategy

### MVP (US1 only)

1. Phase 1 → Phase 2 → Phase 3.
2. **STOP and VALIDATE**: an organizer can run a tier's full lifecycle; no capacity change breaches sold or held; archived tiers are gone from buyer reads and unpurchasable.
3. Note what the MVP already includes for free: because the moderation guard is foundational, US1's writes already return an approved event for review. The gate is closed from the first shipped increment, and US3 later proves it rather than introducing it.

### Incremental delivery

1. Setup + Foundational → the guard and the contract exist.
2. **US1** → tier lifecycle → demo (MVP).
3. **US2** → showtime and event edit guards → demo. US1 + US2 is the complete authoring capability.
4. **US3** → the security proof → demo. Nothing new is exposed; a great deal is now pinned.
5. **US4** → the console → demo. First point at which a non-developer can use any of it.
6. **US5** → the assistant → demo. Removable at any time without touching anything above.

### Parallel team strategy

After Phase 2: developer A on US1, developer B on US2, developer C on US4's shell and states, developer D on US5. US3 is best done by whoever finished US1 or US2 first, since its table test enumerates their endpoints.

---

## Notes

- `[P]` = different files, no dependency on an incomplete task.
- Two tasks are marked **HUMAN-ONLY** (T045, and the manual half of T056). Both correspond to success criteria whose own stated verification method is manual review; automating them would be claiming a check that was not performed.
- Every refusal listed in the spec has a test task above. If a refusal is added during implementation, it needs a test in the same change — that is the feature's stated bar, not a nice-to-have.
- Commit after each task or logical group; stop at any checkpoint to validate independently.
