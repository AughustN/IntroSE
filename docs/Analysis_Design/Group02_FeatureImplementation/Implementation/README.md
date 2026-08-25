# E — Implement 2 Functional Groups using Spec Kit (25 points)

**Written by:** _[fill in name]_ · **Reviewed by:** _[fill in name]_ · **Edited by:** _[fill in name]_

Project: **TixHub** — event-ticket-sales marketplace (Group 02, CS300 / CSC13002).

---

## 1. What this folder contains

| Path | What it is | PA4 §E requirement |
| --- | --- | --- |
| `VideoDemo.md` | YouTube link to the narrated demo | "A video demo with narration" |
| `source-code/` | Complete source of the whole project (frontend + backend + database migrations + tests), excluding `node_modules`, build artifacts and secrets | "The complete source code" |
| `SpecKit/` | Spec Kit artifacts lifted out of the repo for easy grading: `specs/`, project `constitution.md`, the templates, and the Spec Kit init options showing the version used | "The Spec Kit artifacts generated during the process (specs, plans, tasks files)" |
| `README.md` | This file | — |

`SpecKit/` is a **copy** — the same files also live in `source-code/src/specs/` and
`source-code/src/.specify/`, because that is where Spec Kit keeps them in the working repository.

---

## 2. The functional groups implemented

PA3 claimed **001 (Account & Authentication)** and **002 (Event Catalog & Discovery)**. Three further
functional groups are presented below, each implemented end-to-end — **UI + API/logic + data
persistence** — and each driven through the complete Spec Kit workflow.

**The two groups claimed for the §E marks are Groups 1 and 2**, both built in this sprint
(2026-08-02 → 2026-08-07). **Group 3 (`003-seat-holds`)** is included as well: it has the full Spec Kit
artifact set and was not among PA3's two claimed groups. If the TA has already credited it under PA3,
Groups 1 and 2 alone satisfy the requirement.

### Group 1 — `004-admin-organizer-moderation` (UC-33, UC-34)

Admin control over who may sell and what may be sold.

| Layer | Where |
| --- | --- |
| Spec Kit | `SpecKit/specs/004-admin-organizer-moderation/` (spec, plan, tasks, research, data-model, quickstart, checklist, `contracts/admin.openapi.yaml`) |
| Frontend | `source-code/src/components/AdminModeration.tsx`, `AdminPanel.tsx`; client `src/services/adminClient.ts`; shared types `shared/admin/types.ts` |
| Backend | `source-code/server/src/modules/admin/` — `admin.routes.ts`, `admin.service.ts`, `admin.repo.ts`, `audit.ts`, mounted at `/api/admin` (`server/src/app.ts:50`) |
| Database | `source-code/server/src/db/migrations/0013_admin_moderation.sql` (reports, moderation history, `audit_logs`) |
| Tests | `source-code/server/tests/integration/admin-moderation.test.ts`, `server/tests/catalog/moderation.test.ts` |

**User stories delivered**

1. **US1 — Review organizer applications.** Approve or reject an application, with a reason on rejection; organizer capability is recomputed per request from the live application status.
2. **US2 — Suspend an active organizer.** Suspension removes organizer capability and hides every event they own from the public catalog, detail, showtime and seat-map responses on the next request.
3. **US3 — Approve or reject event publication.** Pre-publish moderation: an event is public only when it is `on_sale` **and** `moderation_status = 'approved'`. Material edits after approval send it back to review.
4. **US4 — Handle reported content.** Flag, remove or dismiss reported events; removal refunds buyers 100% to their wallet.
5. **SEC-09 — Immutable audit log.** Every privileged admin action writes an `audit_logs` row with a known actor.

**API surface** (all under `/api/admin`, admin-only):

```
GET    /moderation                 GET    /moderation/queue
GET    /organizers                 POST   /organizers/:id/approve
POST   /organizers/:id/reject      POST   /organizers/:id/suspend
POST   /events/:id/approve         POST   /events/:id/reject
POST   /events/:id/flag            POST   /events/:id/remove
POST   /reports/:id/dismiss        POST   /reports/:id/resolve
GET    /audit-logs
```

### Group 2 — `005-seatmap-designer` (extends UC-21, closes A2 and A4)

A real seat-map authoring tool, replacing the uniform rectangular grid the product rendered before.
Introduces a **layout** layer between venue and showtime; coordinates are the source of truth and an
uploaded floor plan is a background layer only.

| Layer | Where |
| --- | --- |
| Spec Kit | `SpecKit/specs/005-seatmap-designer/` (spec, plan, tasks, research, data-model, quickstart, `contracts/seatmap.openapi.yaml`, `contracts/seatmap-read-contract.md`) |
| Frontend | `source-code/src/components/seatmap/` — `LayoutEditor.tsx`, `SeatCanvas.tsx`, `ElementPalette.tsx`, `FloorPlanPanel.tsx`, `ShowtimeMapPanel.tsx`, `ValidationPanel.tsx`, `layoutOps.ts`, `useLayoutHistory.ts`; plus `SeatMapBuilder.tsx`, `SeatMapView.tsx`, `SeatLayout.tsx` (buyer-side parity) |
| Backend | `source-code/server/src/modules/seatmap/` — `seatmap.routes.ts`, `layouts.service.ts`, `layouts.repo.ts`, `apply.ts`, `floorplan.ts`, `upload.throttle.ts`, mounted at `/api/organizer` (`server/src/app.ts:45`) |
| Database | `source-code/server/src/db/migrations/0007_seatmap.sql`, `0008_seatmap_reconcile.sql`, `0009_drop_dup_layout_unique.sql`, `0010_element_kinds.sql` (`venue_layouts`, `layout_elements`; `sections.venue_id` → `layout_id`; seat uniqueness moved from venue-wide to per-section) |
| Shared | `source-code/shared/catalog/seatmap.ts`, `seatmap-validate.ts` — one validation module used by both browser and server |
| Tests | `source-code/server/tests/seatmap/` (`apply-rules`, `elements-clone`, `floorplan`, …), `server/tests/catalog/seatmap-read.test.ts`, `server/tests/catalog/venues-seatmap.test.ts`, `server/tests/perf/seatmap-read.perf.test.ts` |

**Key design decisions recorded in the spec's Clarifications section**

- **Snapshot at generation.** Generating a showtime's seats copies the layout into that showtime; a later layout edit reaches it only through an explicit, preview-first re-apply. A live reference was rejected because a venue tidy-up would silently reshape a show already on sale.
- **Overlap = centres closer than one seat width.** Coordinate space is 0–10,000 integer units per axis, nominal seat diameter 100 units. Rotation is cosmetic — it never changes the footprint.
- **Floor plans are public but unguessable** — static file, random uuid name, magic-byte typed, SVG refused, re-encoded, `nosniff`, exactly as ADR-0004 serves avatars.
- **Uploads are rate-limited per organizer; layout saves are not** — the image decode/re-encode is the abusable path, a layout save is a bounded write already capped at 2,000 seats.

**API surface** (all under `/api/organizer`, organizer-only):

```
GET    /venues/:venueId/layouts        POST   /venues/:venueId/layouts
GET    /layouts/:id                    PUT    /layouts/:id           DELETE /layouts/:id
POST   /layouts/:id/generate-seats     POST   /layouts/:id/validate
POST   /layouts/:id/publish            POST   /layouts/:id/clone
POST   /layouts/:id/floorplan          PATCH  /layouts/:id/floorplan   DELETE /layouts/:id/floorplan
PUT    /showtimes/:id/seat-map         POST   /showtimes/:id/seat-map/reapply
POST   /showtimes/:id/seats/block      POST   /showtimes/:id/seats/tier
```

### Group 3 — `003-seat-holds` (UC-11, and the hold invariants UC-12 and UC-40 rely on)

The real-time seat-holding layer between the read-only catalog (002) and checkout. Concurrency-safe
holds so two buyers never receive the same seat, a database-owned TTL that releases abandoned
selections on its own, and a live map every viewer sees update.

| Layer | Where |
| --- | --- |
| Spec Kit | `SpecKit/specs/003-seat-holds/` (spec, plan, tasks, research, data-model, quickstart, checklist, `contracts/reservations.openapi.yaml`, `contracts/seat-socket.md`) |
| Frontend | `source-code/src/services/holdsClient.ts`, `holdSession.ts`, `seatSocket.ts`; `src/hooks/useHoldCountdown.ts`; live map rendering in `src/components/SeatLayout.tsx`, `SeatMapView.tsx` |
| Backend | `source-code/server/src/modules/holds/` — `reservations.routes.ts`, `holds.service.ts`, `holds.repo.ts`, `holds.throttle.ts`, `sweep.ts`, mounted at `/api` (`server/src/app.ts:43`); Socket.IO gateway `server/src/realtime/io.ts` |
| Database | `source-code/server/src/db/migrations/0003_holds.sql` (`reservations`, `reservation_items`, `hold_expires_at`, `reserved_quantity`) |
| Tests | `source-code/server/tests/holds/` — `concurrency`, `expiry`, `ga`, `grace`, `hold`, `manage`, `realtime` (7 files) |

**User stories delivered**

1. **US1 — Hold specific seats on a live map (P1).** Signed-in only, no anonymous holds. Two attendees selecting the same seat at the same instant: exactly one succeeds, the other is refused with "seat just taken" — never both (DATA-02).
2. **US2 — Holds expire on their own (P1).** A 7-minute configurable TTL from the reservation's first hold. The TTL sweeper releases at most ~1 minute after `hold_expires_at`; closing the tab needs no cooperation from the client (REL-02).
3. **US3 — Everyone sees the map change live (P2).** Socket.IO broadcast of seat-status changes to every viewer of the showtime (PERF-03/06).
4. **US4 — Reserve general-admission tickets by quantity (P2).** GA holds are a quantity against a ticket tier via `reserved_quantity`, with no per-seat rows. A reservation is seated or GA, never mixed.
5. **US5 — Manage an in-progress selection (P3).** Add or remove seats, or release the whole selection at once, while it is still active.

**Key design decisions recorded in the spec's Clarifications section**

- **Exactly one active reservation per (user, showtime).** A second tab or device joins the existing reservation rather than opening a second one, so one reservation converts to one order.
- **One configurable cap, default 8, shared by seated and GA** — the anti-hoarding control (FR-016), a setting rather than a hard-coded number.
- **One reservation-level clock.** Every seat shares one expiry and they release together; adding a seat does **not** extend it, otherwise a user could lock a map forever by adding a seat every few minutes. The single exception is FR-010: starting a wallet top-up extends the window **once**, +7 min, capped at 14 min absolute.
- **The database TTL is the source of truth, the socket disconnect is only a hint** (DATA-03) — a client that vanishes cannot leave a seat held.

**API surface** (under `/api`, signed-in only, rate-limited):

```
POST   /reservations                  create or join the caller's one active reservation
GET    /reservations/active?showtimeId=   resync the caller's live selection (FR-022)
GET    /reservations/:id
PATCH  /reservations/:id              add seats/quantity or remove seats; never extends (FR-006)
DELETE /reservations/:id              release everything it holds at once (FR-014)
```

Plus the Socket.IO channel documented in `SpecKit/specs/003-seat-holds/contracts/seat-socket.md`.

> **Note on timing.** 003 was implemented on 2026-07-25, at the end of the previous sprint, and so is
> older than Groups 1 and 2. It is listed here because it went through the complete Spec Kit workflow
> and was not claimed for PA3's two functional groups. If the TA has already credited 003 under PA3,
> **Groups 1 and 2 are the two claimed for §E** and this section stands as supporting context.

### Also shipped this sprint (not counted as one of the two groups)

`004-static-info-pages` — About Us, Terms of Service, Website Terms and Refund Policy, rendered from
Markdown (`src/content/legal/`) through `LegalPage.tsx` with the new `Footer.tsx`. Its Spec Kit
artifacts are included in `SpecKit/specs/004-static-info-pages/`. It is a static-content feature with
no database layer, so it does not satisfy the "full stack" wording of §E — it is included for
completeness, not as a claimed functional group.

---

## 3. Spec Kit workflow followed

Spec Kit **v0.12.9** (see `SpecKit/speckit-init-options.json`), Claude Code integration, PowerShell
scripts. For each functional group the full spec-driven workflow was run:

```
/speckit.constitution  →  SpecKit/memory/constitution.md   (project-wide, v2.0.0)
/speckit.specify       →  specs/<feature>/spec.md
/speckit.clarify       →  spec.md "Clarifications" section
/speckit.plan          →  plan.md, research.md, data-model.md, contracts/, quickstart.md
/speckit.tasks         →  tasks.md
/speckit.checklist     →  checklists/requirements.md
/speckit.implement     →  source code + generated tests
```

Every feature folder therefore contains, at minimum: `spec.md`, `plan.md`, `tasks.md`, `research.md`,
`data-model.md`, `quickstart.md`, `checklists/requirements.md` and an OpenAPI contract.

---

## 4. Generated tests

Per PA4 §E, the Spec Kit generated tests are included but not yet refined (that is PA5's scope).

- **32 test files**, under `source-code/server/tests/` (auth, catalog, holds, seatmap, payments, integration, perf).
- Last recorded full run at the merge that closed this sprint (commit `8e2ce56`): **183 passed, 1 skipped, 0 failed, across 32 files**.
- The suite requires `TEST_DATABASE_URL` to point at a **dedicated** database branch — it truncates every table between cases and deliberately has no fallback to `DATABASE_URL`.

Run them with:

```bash
npm install
npm test
```

---

## 5. Running the project

```bash
npm install
cp .env.example .env        # then fill in DATABASE_URL, TEST_DATABASE_URL, JWT_SECRET, AUTH_EVENT_HASH_KEY
npm run db:migrate          # applies server/src/db/migrations/0001 … 0013
npm run seed                # demo data
npm run dev:web             # Vite frontend :3000
npm run dev:server          # Express API :4000
```

Tech stack: React 19 + TypeScript + Vite + Tailwind CSS 4 (frontend), Express 4 + TypeScript (API),
PostgreSQL on Neon (database), Socket.IO (live seat map), Vitest + Supertest (tests), Sharp (floor-plan
re-encoding), VNPay (wallet top-up), Resend (mail).

---

## 6. Traceability

| Requirement (PA4 §E) | Where it is satisfied |
| --- | --- |
| 2 more functional groups | `004-admin-organizer-moderation` and `005-seatmap-designer` are the two claimed; `003-seat-holds` is included as a third (§2) |
| Full stack: frontend, backend, database | Per-group tables in §2 list the UI files, the API module and the migrations |
| Spec Kit drives the process | §3; artifacts in `SpecKit/` |
| End-to-end (UI + API/logic + data persistence) | §2 |
| Generated tests included | §4; `source-code/server/tests/` |
| Video demo with narration | `VideoDemo.md` |
| Complete source code, no `node_modules`/build artifacts | `source-code/`; exclusions listed in `source-code/EXCLUDED.md` |
| Spec Kit artifacts (specs, plans, tasks) | `SpecKit/specs/` |
