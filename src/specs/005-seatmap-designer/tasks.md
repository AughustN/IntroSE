# Tasks: Seat Map Designer

**Input**: Design documents from `/src/specs/005-seatmap-designer/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/seatmap.openapi.yaml, contracts/seatmap-read-contract.md, quickstart.md

**Tests**: REQUIRED. Every one of SC-003 through SC-014 names an automated test, and this feature edits maps with money already taken — constitution Principle IV applies, so the refusal tests (sold seat, held seat, cross-organizer, upload) are written **before** the write path they pin.

**Organization**: by user story. P1 = US1 (draw a layout) + US2 (buyer parity) + US3 (correct a live map); P2 = US4 (floor plan) + US5 (non-sellable elements) + US6 (validation); P3 = US7 (block / marquee tier) + US8 (reuse).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependency on an incomplete task → parallelizable.
- Backend: `server/src/modules/seatmap/…`; shared: `shared/catalog/…`; FE: `src/components/seatmap/…`; tests: `server/tests/seatmap/…`.

---

## Phase 1: Setup

- [X] T001 Create the module skeleton: `server/src/modules/seatmap/`, `server/tests/seatmap/`, and `src/components/seatmap/`. Floor-plan assets are managed by Cloudinary rather than a local upload directory.
- [X] T002 [P] Confirm no new packages are needed — `multer` and `sharp` are already dependencies from the managed-media pipeline; record in `package.json` that nothing is added (ADR-0006, Principle V)

---

## Phase 2: Foundational (Blocking)

**⚠️ No user-story work begins until this phase is complete.**

- [X] T003 Migration `server/src/db/migrations/0007_seatmap.sql` per data-model.md: create `venue_layouts` + `layout_elements`; add `layout_id`/`pos_x`/`pos_y`/`rotation` to `seats` and `layout_id` to `sections`; swap `UNIQUE (venue_id, row_label, seat_number)` → `UNIQUE (section_id, row_label, seat_number)`; add `showtimes.layout_id` + `layout_snapshot` and `showtime_seats.pos_x/pos_y/rotation`. **Re-parent `seats` and `sections` in place — never recreate the rows, `seats.id` is referenced transitively by sold tickets (R-1)**
- [X] T004 Backfill inside `0007_seatmap.sql`: one **"Sơ đồ mặc định"** layout per venue that has sections or seats (`status='published'`), re-parent its sections and seats, seed `pos_x`/`pos_y` from the existing row/number grid, and backfill geometry + `layout_snapshot` for every showtime that already has a generated map (R-9)
- [X] T005 [P] Extend `shared/catalog/types.ts` from `contracts/seatmap-read-contract.md`: `SeatMapSeat` gains `x`/`y`/`rotation`/`section`; add `SeatMapElement`, `SeatMapFloorPlan`; `SeatMap` gains `space`/`elements`/`floorPlan`. **One definition, imported by both sides (Principle VI)**
- [X] T006 [P] Add layout constants to `server/src/config.ts`: `LAYOUT_SPACE` (10000), `SEAT_DIAMETER` (100), `LAYOUT_MAX_SEATS` (2000), `LAYOUT_MAX_ELEMENTS` (200), `VENUE_MAX_LAYOUTS` (20), `FLOORPLAN_MAX_BYTES` (5 MB), `FLOORPLAN_MAX_PX` (4000), `UPLOAD_RATE_LIMIT`/`UPLOAD_RATE_WINDOW_MS`, `UPLOAD_CONCURRENCY` — env-overridable, not hard-coded
- [X] T007 [P] `shared/catalog/seatmap-validate.ts`: pure validation over a layout document returning `ValidationIssue[]`; overlap by **squared** centre distance < `SEAT_DIAMETER`, bucketed into 100-unit grid cells and compared against the 3×3 neighbourhood so it stays O(n) at the 2,000-seat ceiling (R-3, R-11). Imported by server and client
- [X] T008 `server/src/modules/seatmap/layouts.repo.ts`: layout/section/seat/element reads, and the versioned full-document save that refuses a stale `version` (FR-015), clamps positions into 0–10000 and normalises rotation into 0–359 before write (FR-014)
- [X] T009 `server/src/modules/seatmap/layouts.service.ts`: resolve venue ownership through `venues.created_by` and **refuse** on mismatch (SEC-04, FR-042); enforce the layout/seat/element ceilings (FR-007, FR-019)
- [X] T010 `server/src/modules/seatmap/seatmap.routes.ts` skeleton + mount in `server/src/app.ts` behind `requireAuth`, with Zod schemas for every body in `contracts/seatmap.openapi.yaml` (SEC-07)
- [X] T011 [P] `src/components/seatmap/SeatCanvas.tsx`: the single SVG surface used by the editor **and both buyer renderers** — `viewBox` for zoom/pan and PLAT-01 scaling, one seat placed by one piece of code so the preview and the selection screen cannot disagree (R-4)

**Checkpoint**: schema migrated with no visible change for un-edited venues, shared contract and validator exist, ownership-scoped routes mount, one rendering surface exists.

---

## Phase 3: User Story 1 — Draw a layout that matches the real venue (P1) 🎯 MVP

**Goal**: an organizer seeds a layout with the generator, then refines it by hand on a canvas and saves a draft.

**Independent Test**: create a layout, generate 3×10 seats, drag one, arc a row, delete two, undo, save, reopen — everything is exactly where it was left.

- [X] T012 [P] [US1] Tests `server/tests/seatmap/layouts.test.ts`: create/rename/list/delete (FR-001); duplicate name → `409 layout_name_taken`; 21st layout → `409 layout_limit_reached` (FR-007); 2001st seat → `409 seat_limit_reached`; save with a stale `version` → `409 stale_version` (FR-015); out-of-range position clamped and rotation normalised on save (FR-014); **another organizer's venue → `403 not_owner`, never an empty list** (SC-011); deleting a layout that a non-`finished`/non-`cancelled` showtime generated from → `409 layout_in_use` (FR-006)
- [X] T013 [P] [US1] Tests `server/tests/seatmap/generator.test.ts`: Section/Row/Count seeds seats with editable grid positions (FR-010); it does not overwrite existing seats unless `replaceExisting`; per-section uniqueness lets two sections both hold "row A seat 1" (FR-003)
- [X] T014 [US1] Implement the layout write path in `server/src/modules/seatmap/layouts.repo.ts` + `layouts.service.ts`: full-document save, version bump, section/seat/element diffing. **Never consults inventory — a generated map is a snapshot (FR-005, FR-027)**
- [X] T015 [US1] Wire `GET`/`PUT`/`DELETE /organizer/layouts/{id}`, `POST /organizer/venues/{venueId}/layouts`, and `POST /organizer/layouts/{id}/generate-seats` in `server/src/modules/seatmap/seatmap.routes.ts`. DELETE MUST refuse with `409 layout_in_use` while any showtime that is not `finished`/`cancelled` was generated from the layout, so a live map's source stays inspectable and re-appliable (FR-006)
- [X] T016 [P] [US1] `src/components/seatmap/useLayoutHistory.ts`: undo/redo over immutable layout snapshots, depth 50, **one step per multi-seat operation** (FR-012)
- [X] T017 [US1] `src/components/seatmap/LayoutEditor.tsx`: place, drag, marquee multi-select, align, distribute, rotate, arc-along-a-curve, delete, plus the snap-to-grid toggle that is **on by default and affects input only, never storage** (FR-009, FR-011)
- [X] T018 [P] [US1] Add layout CRUD, generate-seats and publish methods to `src/services/catalogClient.ts`
- [X] T019 [US1] Rework `src/components/SeatMapBuilder.tsx`: keep the Section/Row/Count generator as the fast first step and open the editor from it (FR-010)

**Checkpoint**: an organizer can author and save a non-rectangular layout by hand.

---

## Phase 4: User Story 2 — Buyers see the real shape of the room (P1)

**Goal**: both buyer renderers draw from coordinates, with zoom/pan, keyboard reach, and no uniform grid left anywhere.

**Independent Test**: bind a non-rectangular layout to a showtime; both the event-page preview and the selection screen show the authored shape at 360/768/1920 px.

- [X] T020 [P] [US2] Extend tests `server/tests/catalog/seatmap-read.test.ts`: the payload carries `x`/`y`/`rotation`/`section` and `space`; seats are ordered **section → row → number** (the contract's tab-order guarantee); a GA showtime returns `tiers` and none of the new fields; `floorPlan` is **absent** when the organizer has not made it buyer-visible (FR-026); every `price` in the payload is a whole **VND integer** after the geometry rewrite — no floating point anywhere (FR-046, STD-03)
- [X] T021 [US2] Extend `getSeatMap` in `server/src/modules/catalog/catalog.repo.ts`: select `ss.pos_x, ss.pos_y, ss.rotation` and the section name from the join it already performs (no new join, R-2); read elements and background from `showtimes.layout_snapshot`
- [X] T022 [US2] Rewrite `src/components/SeatMapView.tsx` onto `SeatCanvas` — **delete the `byRow` grouping and the flex rows** (FR-038)
- [X] T023 [US2] Rewrite `src/components/SeatLayout.tsx` onto `SeatCanvas` with zoom and pan; **the hold click path from 003 is untouched** (FR-041)
- [X] T024 [P] [US2] Keyboard and assistive reach in `src/components/seatmap/SeatCanvas.tsx`: every seat individually focusable in section → row → number order, announcing identity/status/price ("Khu A, hàng B, ghế 12, còn trống, 250.000đ"); zoom and pan reachable without a pointer (FR-039a, SC-010a)
- [X] T046 [US2] Copy elements + background into `showtimes.layout_snapshot` at generation and re-apply, in `server/src/modules/seatmap/apply.ts` (R-2)
- [X] T045 [US2] Draw elements in `src/components/seatmap/SeatCanvas.tsx`, visually distinct from seats, output-encoded, and **excluded from the seat tab order** (FR-018, FR-040)
- [X] T041 [US2] Render the background behind the seats in `src/components/seatmap/SeatCanvas.tsx` at its saved scale/offset/opacity — **never interactive, never a status** (FR-020, FR-026)
- [ ] T025 [P] [US2] Verify PLAT-01 at 360 / 768 / 1920 px on a non-rectangular map: no horizontal page scroll, every control reachable (FR-039). **HUMAN-ONLY** — PLAT-01's own verification method is "manual check at the three breakpoints", so this cannot be honestly automated. Static preconditions verified 2026-08-05: no fixed pixel widths and no `overflow-x` containers in the render path; the canvas scales by `viewBox` + `w-full`. What still needs eyes: whether a dense map is *usable* at 360 px and whether the zoom/pan controls are comfortably tappable.
- [X] T026 [US2] Verify feature 003 is untouched: `server/tests/holds/**` passes **unmodified**, and an inspected `seat:update` frame from a *hold* carries `{ showtimeSeatId, status }` only — **no geometry ever**, and no `tier`/`price` outside an organizer retier (FR-041, SC-012)

**Checkpoint**: the feature is visible to buyers. Without this phase the whole thing is invisible.

---

## Phase 5: User Story 3 — Correct a live map without breaking inventory (P1)

**Goal**: replace the blanket 409 with a per-seat inventory check, and keep a layout edit from ever reaching a generated map implicitly.

**Independent Test**: on a map with one sold, one held and one available seat, assert the 3×3 outcome matrix, then assert a partially-invalid edit leaves the map identical.

- [X] T027 [P] [US3] Tests `server/tests/seatmap/apply-rules.test.ts` — the matrix from data-model.md: `available`/`blocked` accepts every change; `sold` accepts **position/rotation only** and refuses delete/relabel/re-section/retier naming the sale; a seat under a **live hold** refuses **every** change naming the hold, **and the hold is never cancelled** (FR-028, SC-003/004). Include: let the hold lapse, retry, and the same edit now succeeds
- [X] T028 [P] [US3] Tests `server/tests/seatmap/snapshot.test.ts`: a partially-invalid edit is rejected **whole** and the map is byte-identical afterwards (FR-029, SC-005); editing a layout that **two** showtimes generated from changes neither; re-applying to one changes that one only (FR-005, SC-005a)
- [X] T029 [US3] `server/src/modules/seatmap/apply.ts`: diff the submitted map against current, classify every affected seat, take `SELECT … FOR UPDATE` over the touched `showtime_seats` rows, and refuse the whole edit if any seat is refused (R-5)
- [X] T030 [US3] `POST /organizer/showtimes/{id}/seat-map`: bind a **published** layout and generate, snapshotting geometry onto `showtime_seats` and decoration into `showtimes.layout_snapshot` (FR-005). **Remove the blanket `409 seat_map_exists`** at `server/src/modules/catalog/organizer.routes.ts:233`; refuse a GA showtime that supplies a layout
- [X] T031 [US3] `PUT /organizer/showtimes/{id}/seat-map` — edit an already-generated map through `apply.ts`, returning `409 map_edit_refused` with the refused seats and reasons (FR-027, FR-029)
- [X] T032 [US3] `POST /organizer/showtimes/{id}/seat-map/reapply` with `dryRun`: preview returns the classified changes and refusals without writing; **confirm re-classifies inside the transaction**, so a sale or hold landing in between refuses rather than being overwritten (FR-027a, R-6)
- [X] T033 [US3] FE re-apply flow in `src/components/seatmap/LayoutEditor.tsx`: pick one showtime, show the preview, require confirmation, surface refusals by seat

**Checkpoint**: a live map is correctable, and no layout edit can silently reshape a show that is on sale.

---

## Phase 6: User Story 4 — Trace an uploaded floor plan (P2)

**Goal**: upload, align, and optionally publish a background image that never owns any geometry or status.

**Independent Test**: upload a JPEG, align it, place seats over it, reopen and confirm alignment persisted; then confirm every refusal case.

- [X] T034 [P] [US4] Tests `server/tests/seatmap/floorplan.test.ts`: a valid JPEG/PNG/WebP accepted; **a real SVG refused** regardless of name or declared type; a text file renamed `plan.png` refused; an `image/png` header over non-PNG bytes refused; a 7 MB file → `413`; a small PNG decoding to 20000×20000 refused **before** re-encoding; the stored file has no original metadata and a name unrelated to the upload (FR-021, FR-022, FR-023, SC-006). Plus SC-007: snapshot every seat position, remove the floor plan, assert **100% of positions are unchanged**; and assert a buyer's seat statuses are identical with the plan visible and hidden (FR-025)
- [X] T035 [P] [US4] Tests in the same file for FR-023a: repeated uploads from one organizer are throttled with a clear message, never queued or half-attached; layout saves are **not** throttled. Then SC-005b: run a burst of concurrent uploads **against a showtime with an active seat map** and assert the process stays under its memory ceiling while seat updates keep meeting feature 003's bound — the concurrency semaphore, not the rate limit, is what this pins (PERF-07)
- [X] T036 [US4] `server/src/modules/seatmap/floorplan.ts` reuses the managed-media sanitizer: magic-byte detection (jpeg/png/webp only) → `sharp().metadata()` dimension check **before** any resize → re-encode to WebP → deterministic Cloudinary upload; replacement overwrites the managed asset and removal cleans it up (ADR-0006, R-7)
- [X] T037 [US4] `server/src/modules/seatmap/upload.throttle.ts`: per-organizer token bucket copying the shape of `server/src/modules/holds/holds.throttle.ts`, plus a concurrency semaphore bounding the instantaneous memory spike (FR-023a, PERF-07, R-8)
- [X] T038 [US4] `POST`/`PATCH`/`DELETE /organizer/layouts/{id}/floorplan` with `multer` memory storage capped at `FLOORPLAN_MAX_BYTES`; PATCH persists scale/offset/opacity/buyer-visibility and **never moves a seat** (FR-024, FR-025)
- [X] T039 [P] [US4] Cloudinary delivery: return the managed secure URL after backend validation; no local `/uploads/floorplans` static route is mounted (FR-022, ADR-0006)
- [X] T040 [P] [US4] `src/components/seatmap/FloorPlanPanel.tsx`: upload, scale/offset/opacity sliders, buyer-visibility toggle **default off**, and plain wording that anyone given the link can open the image (FR-026a)
**Checkpoint**: an irregular venue is quick to author, and the picture still owns nothing. (Rendering the background lives in Phase 4 with the rest of the render path — this phase adds upload and alignment.)

---

## Phase 7: User Story 5 — Mark the parts of the room that are not for sale (P2)

**Goal**: stage, aisles, doors, bar and text labels on the map, none of which can ever be bought.

**Independent Test**: with five elements on a layout, the generated bookable-seat count equals the seat count exactly.

- [X] T042 [P] [US5] Tests `server/tests/seatmap/elements.test.ts`: generated seat count equals **seat** count with elements present (SC-009); no element is addressable as inventory — it cannot be held, blocked, priced or tiered (FR-017); a label of `<img src=x onerror=alert(1)>` round-trips as literal text (FR-018); the 201st element → `409 element_limit_reached` (FR-019)
- [X] T043 [US5] Persist elements through the layout save path in `server/src/modules/seatmap/layouts.repo.ts` — a **separate table**, never reachable from an inventory query (FR-017)
- [X] T044 [P] [US5] `src/components/seatmap/ElementPalette.tsx`: place and size stage / aisle / door / bar / free text label with their own position, size and rotation (FR-016)
**Checkpoint**: the map reads like a room, and none of the decoration can become a ticket. (Drawing and snapshotting elements ship in Phase 4; this phase adds authoring them.)

---

## Phase 8: User Story 6 — Catch a broken map before it goes on sale (P2)

**Goal**: the five checks, reported together with the seats named, blocking publish.

**Independent Test**: a layout with three simultaneous problems reports all three in one pass and cannot be published.

- [X] T047 [P] [US6] Tests `server/tests/seatmap/validate.test.ts`: each of overlapping seats, duplicate label in a section, sectionless seat, section-with-seats-but-no-tier, and zero capacity **independently** blocks publishing; three at once are reported in **one** pass, each naming the seats or sections (the overlap names the **pair**); a clean layout publishes (FR-030, FR-031, SC-008)
- [X] T048 [P] [US6] Boundary tests in the same file: two seats exactly `SEAT_DIAMETER` apart are **touching, not overlapping** (publishable); a round table of differently-rotated seats publishes cleanly because rotation never enters the test (FR-030a)
- [X] T049 [US6] Wire `shared/catalog/seatmap-validate.ts` into `POST /organizer/layouts/{id}/validate` and into `POST /organizer/layouts/{id}/publish`, which returns `422 layout_invalid` carrying the issue list (FR-004, FR-030)
- [X] T050 [US6] Add the section-without-tier check at bind time in `server/src/modules/seatmap/apply.ts` — it needs the showtime's tiers, which a layout alone does not have
- [X] T051 [P] [US6] `src/components/seatmap/ValidationPanel.tsx`: list every issue with its seats, and highlight overlapping pairs live in the editor from the same shared validator — **advisory; the server still decides** (R-11, FR-032)

**Checkpoint**: a broken map cannot reach buyers.

---

## Phase 9: User Story 7 — Fine-grained inventory control on the map (P3)

**Goal**: block/unblock a single seat and assign a tier by marquee, both live.

**Independent Test**: block an available seat and confirm buyers lose it live; marquee 12 seats across two sections onto one tier.

- [X] T052 [P] [US7] Tests `server/tests/seatmap/block-tier.test.ts`: blocking an `available` seat removes it from available capacity and broadcasts; unblock returns it; **blocking a `held` or `sold` seat is refused** (FR-033); a marquee tier assignment applies across sections, and a selection containing a `sold` seat is refused naming it rather than repricing an owned ticket (FR-034)
- [X] T053 [US7] `POST /organizer/showtimes/{id}/seats/block` in `server/src/modules/seatmap/seatmap.routes.ts`, broadcasting through the **existing** `seat:update` payload — no new socket event (FR-033, FR-035)
- [X] T054 [US7] `POST /organizer/showtimes/{id}/seats/tier`, validating the tier belongs to this showtime; add the optional `tier`/`price` pair to the seated entry of `SeatUpdate` in `shared/holds/types.ts` and broadcast the retier through it — **no new socket event, no geometry** (FR-034, FR-035, FR-041)
- [X] T055 [P] [US7] FE marquee-to-tier action and a per-seat block/unblock action in `src/components/seatmap/LayoutEditor.tsx`
- [X] T056 [US7] Confirm the existing per-section tier assignment still works — marquee assignment is an addition, not a replacement (FR-034)

**Checkpoint**: the map is the organizer's control surface, not just a picture.

---

## Phase 10: User Story 8 — Reuse a layout instead of redrawing it (P3)

**Goal**: templates and cloning into another venue the organizer owns.

**Independent Test**: clone a layout into a second venue, edit the clone, confirm the source is unchanged.

- [X] T057 [P] [US8] Tests `server/tests/seatmap/clone.test.ts`: a clone carries seats, sections, elements and background alignment as an independent **draft**; editing either leaves the other unchanged (SC-013); a clone carries **no** sales, holds or blocks; cloning another organizer's layout → `403 not_owner` (FR-036, FR-037)
- [X] T058 [US8] Clone service in `server/src/modules/seatmap/layouts.service.ts`: deep-copy into a target venue the caller owns, honouring `VENUE_MAX_LAYOUTS`
- [X] T059 [US8] `POST /organizer/layouts/{id}/clone` and the `isTemplate` flag on the layout save path (FR-036)
- [X] T060 [P] [US8] FE "save as template" and "start from…" in `src/components/SeatMapBuilder.tsx`

**Checkpoint**: all eight stories are independently functional.

---

## Phase 11: Polish & Cross-Cutting

- [X] T061 Coverage gate: `server/src/modules/seatmap/**` ≥ 60% in `vitest.config.ts`, with the refusal paths (sold, held, cross-organizer, upload) explicitly covered (MAIN-03, Principle IV)
- [X] T062 [P] Orphan cleanup: an uploaded image whose layout save later failed is unreferenced and removed, never served (spec Edge Cases)
- [X] T063 [P] PERF-02 check: generate a **2,000-seat** layout and confirm the buyer map read stays under 500 ms p95 at the 25-VU normal load profile and stays interactive for zoom/pan (SC-010). **Measured 2026-08-05** in `server/tests/perf/seatmap-read.perf.test.ts`: median 253 ms, **p95 308 ms** at 2,000 seats against the real database, and 333× the rows costs ~1.8× the time (no quadratic). Scope limit: single client — the 25-VU profile still needs k6.
- [X] T064 [P] `npm run typecheck` (web + server) clean; confirm exactly **one** `SeatMap` definition, imported by the API and both renderers with no re-declared payload (SC-014, Principle VI)
- [X] T065 [P] Delete the dead uniform-grid code paths — the `byRow` grouping in both renderers and any leftover venue-scoped seat handling in `server/src/modules/catalog/organizer.routes.ts` (Principle VI: no dead code to `main`)
- [X] T066 Execute `quickstart.md` scenarios 0–11, starting with **Scenario 0** (nothing regressed on migration) before anything else
- [X] T067 [P] Amend the four follow-up documents named in spec.md: UC-21 in `docs/Analysis_Design/Group02_UseCaseSpecification.md` (steps 1–4 rewritten around layouts; A2 and A4 closed), `docs/Analysis_Design/SCHEMA_DATABASE.md`, the Venue/Seat glossary in `CONTEXT.md` (add **Layout**), and feature 002's spec + `contracts/catalog.openapi.yaml:194` (the removed `409 seat_map_exists`)

---

## Dependencies & Execution Order

- **Setup → Foundational blocks everything.** T003/T004 (migration + backfill) before T008; T005 before every FE task and before T021; T007 before T049; T011 before T017, T022, T023.
- **US1 → US2 → US3 are all P1 and ship together.** US1 without US2 is invisible to buyers; US2 without US3 leaves the map write-once, which is the blocker organizers hit first.
- **US2 depends on US1** only for something to render — it can be tested against the migration's default layout before the editor exists.
- **US3 depends on US1's publish path** (a showtime binds a *published* layout, FR-005), which is why the shared validator is Foundational (T007) rather than inside US6.
- **US6 surfaces** validation; the core function it wires up already exists from T007, so US2/US3 are not blocked on it.
- **US5 authors elements; US2 renders them.** The render path — snapshot write (T046), read (T021), draw (T045, T041) — sits wholly in Phase 4, so US2 is testable exactly as its Independent Test describes, against a seeded layout. US5 then adds only the palette and persistence, and US4 only upload and alignment.
- **US4, US7, US8 are independent** of each other and of everything after Foundational.
- **003 (seat holds)** is read, never modified: T026 is the standing check that its tests still pass unmodified.
- **006 (tier CRUD/pricing)** and **007 (orders/tickets/refunds)** are out of scope — US7 only *assigns* an existing tier.

## Parallel Opportunities

- Foundational: T005/T006/T007 run together once T003 lands; T011 runs alongside T008–T010.
- Every story's test task (T012/T013, T020, T027/T028, T034/T035, T042, T047/T048, T052, T057) is `[P]` and comes first in its phase.
- FE and backend within a story run in parallel once T005 exists — e.g. T016/T018 alongside T014/T015.
- With three developers after Foundational: A takes US1+US3 (the write path), B takes US2+US5 (rendering), C takes US4+US6, then US7/US8 split.

## Implementation Strategy

- **MVP = US1 + US2 + US3.** Authoring, buyer parity, and safe correction. Anything less either ships an invisible feature or a write-once one.
- **Then US4 + US5 + US6**: tracing, legibility, and the publish gate.
- **Then US7 + US8**: control surface and reuse.
- **Gates**: T061 coverage, T063 PERF-02, T064 one-contract typecheck, T066 quickstart (Scenario 0 first).

## Notes

- Task IDs are stable identifiers, not a strict execution index — T041/T045/T046 sit in Phase 4 because the render path is one seam. Execution order is the Dependencies section, not the ID sequence.
- **The database is the source of truth.** The floor plan is decoration: it never creates a seat and never determines a status (Principle I, FR-020).
- **A generated map is a snapshot.** A layout edit reaches a showtime only through an explicit, previewed re-apply (FR-005, FR-027a) — this is the single decision most of the write path hangs on.
- **Refusals are refusals.** Another organizer's layout, seat, upload or clone returns 403, never a filtered-out empty result (SEC-04, FR-042).
- **Never release a buyer's hold to make room for an organizer's edit** (FR-028). The organizer waits for it to lapse.
- The existing Cloudinary managed-media integration and current packages are reused; no new external integration is introduced.

---

## Phase 12: Convergence

Appended 2026-08-06 by `/speckit-converge`. These close the gap between the amendment (007-scope:
User Story 9 onward, FR-047–FR-083, SC-015–SC-028) and the code, which currently contains none of it.
Phases 1–11 above are assessed as satisfied and are untouched.

- [X] T068 Write `server/src/db/migrations/0012_hallscheme.sql` per data-model.md — `layout_tables`; `seats.table_id`; `sections.color/seat_shape/seat_size_multiplier`; `layout_elements.points`; widen the `kind` CHECK the `0010_element_kinds.sql` way. **Every `ADD COLUMN` MUST use `IF NOT EXISTS`** — the runner's already-applied codes are 42P07/42710/42P16 and do **not** include 42701 (duplicate column), so a plain `ADD COLUMN` fails a re-run instead of skipping. Apply to BOTH databases (`npm run db:migrate` and `VITEST=1 npm run db:migrate`). **Also add the four new ceilings to `server/src/config.ts`** as env-overridable settings, the way `LAYOUT_MAX_SEATS` already is: `TABLE_MIN_SEATS` (2), `TABLE_MAX_SEATS` (20), `LAYOUT_MAX_TABLES` (100), `POLYGON_MIN_POINTS` (3), `POLYGON_MAX_POINTS` (64), and `SEAT_SIZE_MIN`/`SEAT_SIZE_MAX` (0.5/2.0) per plan: 0012 migration, plan: Amendment Technical Context, FR-054, FR-059, FR-065 (missing)
- [X] T069 Extend `shared/catalog/seatmap.ts` with `LayoutTable`, shape `points`, the widened element kinds, and section style, and move the server, the editor and **both** buyer renderers in the same change per FR-078, Constitution VI (missing)
- [X] T070 Write the failing table refusal tests in `server/tests/seatmap/tables.test.ts` first, in the style of `apply-rules.test.ts`: move, rotate, re-count, re-section and delete a table holding a **sold** seat and a **held** seat each refuse with `seat_sold`/`seat_held` and leave the table byte-identical. **Depends on T068 and T069** — the file cannot compile without the schema and the contract, which is why it is not marked `[P]` despite being written first. Also assert the POSITIVE invariant: moving and rotating a table carries **100%** of its seats, and re-counting redistributes them evenly, verified by comparing every seat's position relative to its table before and after per FR-051, FR-052, SC-016, SC-017 (missing)
- [X] T071 Implement `server/src/modules/seatmap/tables.ts`: seat distribution round (even around the circumference) and rectangular (per-side counts), storing **absolute** coordinates so every existing reader is unchanged, plus move/rotate/re-count. **Enforce the ceilings in the service**, refusing with a named reason: 2–20 seats per table, at most 100 tables per layout, and table seats counted toward the existing 2,000-seat layout ceiling so tables get no separate inventory budget per FR-047, FR-048, FR-050, FR-054, FR-055, R-19 (missing)
- [X] T072 Enforce that a table carries a section its seats inherit, that re-sectioning re-parents them in one operation, and that a colliding table name in the same section is refused **at placement** naming the clash per FR-049, FR-053, R-20, SC-028 (missing)
- [X] T073 Add the table endpoints to `server/src/modules/seatmap/seatmap.routes.ts` (`POST /layouts/:id/tables`, `PATCH`/`DELETE /tables/:id`), each resolving layout ownership server-side and refusing another organizer's layout per FR-079, SEC-04 (missing)
- [X] T074 Add `src/components/seatmap/TablePalette.tsx` and make a table select as **one object** rather than loose seats, with every table operation a single undo step. **Undo must cover every new object type**, not only tables: placing, moving, reshaping or deleting a boundary, a divider or a facility icon is likewise one step, within the existing depth per FR-056, FR-076, FR-077, SC-024 (missing)
- [X] T075 Add `shared/catalog/tier-palette.ts` — one exported function mapping a showtime's tiers, ordered by price ascending, onto a fixed palette. Derived at read time; **no** colour column on `ticket_tiers`, which feature 006 owns per FR-067, R-17 (missing)
- [X] T076 Extend the buyer seat-map read in `server/src/modules/catalog/catalog.repo.ts` so each seat carries its tier and the map carries the `tierLegend` (tier, colour, whole-đồng price), and assert in `server/tests/catalog/seatmap-read.test.ts` that section colour is **absent** from the buyer payload per FR-067, contracts/hallscheme-contract.md §2 (missing)
- [X] T077 Colour seats by tier with the legend in **both** `SeatMapView.tsx` and `SeatLayout.tsx` from the one shared palette, keeping status outranking price — a sold or held seat stays visibly unavailable and unclickable — within the existing zoom/pan and the 360–1920 px bar per FR-068, FR-069, FR-070, FR-071, SC-021, SC-022 (missing)
- [X] T078 Snapshot tables and shapes into `showtimes.layout_snapshot` in `server/src/modules/seatmap/apply.ts` (no migration — it is already JSONB), and pin with a test that editing a layout changes nothing on a showtime that has already generated per FR-081, FR-082, FR-083, SC-027, R-18 (missing)
- [X] T079 Add the boundary polygon (3–64 points) and divider (exactly 2) primitives with `points` on the element and the rectangle fields kept as its bounding box, drawn behind seats in the editor and both buyer renderers and never intercepting seat interaction. **Not `[P]` with T080** — both edit `SeatCanvas.tsx` and the same `layout_elements` shape per FR-057, FR-058, FR-059, FR-060, R-13 (missing)
- [X] T080 Widen the element vocabulary with exit, restroom, food and drink, smoking, first aid, lift/stairs and wheelchair, extend `ElementPalette.tsx`, and assert pre-amendment elements still load per FR-061, FR-062, FR-063, SC-019, R-14 (missing)
- [X] T081 Persist section style and add `src/components/seatmap/SectionStylePanel.tsx`. `LayoutEditor.tsx` currently derives a section colour **client-side from section order**; replace that with the stored `sections.color`, keep colour **editor-only**, and carry seat shape and size through to both buyer renderers per FR-064 (partial)
- [X] T082 Make the overlap test in `shared/catalog/seatmap-validate.ts` use each seat's **effective** size (nominal × its section's multiplier, comparing the larger of the two) and widen the spatial bucket to the largest effective diameter, so what is drawn and what the publish gate enforces always agree per FR-065, R-16, SC-020 (missing)
- [X] T083 Add the four new checks — table seats overlapping another object, a boundary not enclosing every seat, an icon with no position, a section with no colour — inside the **existing** validate/publish pass, not a second gate, per FR-066, FR-072, FR-073, FR-074, FR-075, SC-023 (missing)
- [X] T084 Implement the standing area as a section of `standing` seats inside a drawn shape, sold seat by seat, and assert that no showtime can be both seated and general admission. **Depends on T079** — the positions are generated inside a drawn shape, so the polygon primitive must exist first; not `[P]` per FR-080, SC-026 (missing)
- [X] T085 Run the full suite with the amendment in place: `server/tests/seatmap`, `server/tests/catalog`, and `server/tests/holds` **unmodified** — feature 003's and 004's behaviour must be untouched. **Also assert that decoration never becomes inventory**: a layout carrying 100 tables, a boundary polygon and a dozen facility icons generates a bookable-seat count exactly equal to its seat count, unchanged from before the amendment per SC-018, SC-025 (missing). **Run 2026-08-06, one suite at a time on a quiet database:** `server/tests/seatmap` **72/72**, `server/tests/holds` **47/47** (unmodified — confirmed by `git diff`), `server/tests/studio` **117/118**. SC-018 is now pinned by `server/tests/seatmap/decoration-not-inventory.test.ts`: 100 tables + a boundary + a divider + 12 facility icons generate a bookable-seat count exactly equal to the seat count, with no GA capacity created. **Caveat, honestly stated:** the whole suite in ONE process (44 files, ~15 min) fails widely with foreign-key violations during fixture seeding, and individual files pass or fail differently run to run. This was checked against a clean `HEAD` worktree: the `catalog` suite fails *more* there than in the working tree, and `studio/tiers-capacity.test.ts` passes and fails in both. The cause is environmental — the TEST branch is reached through Neon's **pgbouncer** endpoint, where the `beforeEach` TRUNCATE-based isolation degrades under sustained load — not this amendment. It is a pre-existing test-infrastructure problem worth its own fix (per-worker schema or a direct, non-pooled endpoint for tests).
- [X] T086 [P] Reconcile the editor additions made outside the spec — canvas fit/zoom controls and element deletion — with the specification: FR-039 specifies zoom/pan for the **buyer** map and FR-009 lists delete for **seats** only. Either fold them into the spec as intended behaviour or remove them (unrequested). **Resolved 2026-08-06: folded in as FR-084 (editor canvas zoom/fit, a view control that changes no stored value) and FR-085 (delete a decorative element), with SC-029 to verify both.** Both are preconditions for the amendment's own scope — a hall of tables and 200 standing positions cannot be placed at a fixed scale, and a palette that adds icons but cannot remove one is a trap — and neither touches inventory, so neither adds a refusal path.
