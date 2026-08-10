# Implementation Plan: Seat Map Designer

**Branch**: `005-seatmap-designer` | **Date**: 2026-08-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-seatmap-designer/spec.md`

## Summary

Give organizers a real seat-map authoring tool so a venue can look like itself instead of a uniform
grid. A new **layout** layer sits between venue and showtime: one venue owns several named layouts,
seats belong to a layout (not the venue), and every seat carries an integer **position and rotation**
in a 0–10,000 coordinate space. Generating a showtime's map **snapshots** that layout onto
`showtime_seats`, so a later layout edit never silently reshapes a show already on sale — it reaches a
chosen showtime only through an explicit, previewed re-apply. Today's blanket `409 seat_map_exists` is
replaced by a per-seat inventory check (sold → position only; live hold → refused; available → free).
An uploaded floor plan is a **background layer only**, handled exactly as ADR-0004 handles avatars.
Both buyer renderers move to coordinates in the same change as the shared contract (Principle VI), as
zoom/pan SVG with every seat still keyboard-focusable. Out of scope: tier CRUD/pricing (006), orders and
anything downstream (007), and the hold algorithm itself (003 — only the seat-map payload gains
geometry).

## Technical Context

**Language/Version**: TypeScript (strict), Node.js 22, React 19 — same stack as 001/002/003/004.

**Primary Dependencies**: Express (REST), `pg` (row locks for the inventory-checked edits), Zod (SEC-07
input validation), **`multer` + `sharp` — both already present** from the 001 avatar upload (ADR-0004).
Rendering uses inline **SVG**; no new drawing/canvas library is added.

**Storage**: PostgreSQL (Neon). New migration `server/src/db/migrations/0007_seatmap.sql`: new tables
`venue_layouts` and `layout_elements`; `sections` and `seats` re-parented to a layout; `seats` gains
`pos_x`/`pos_y`/`rotation`; `seats`' venue-wide unique constraint replaced by a per-section one;
`showtime_seats` gains the snapshotted geometry; `showtimes` gains `layout_id` + a JSONB snapshot of
the non-sellable decoration. Floor-plan images on VPS disk at `uploads/floorplans/<uuid>.webp`.

**Testing**: Vitest + supertest, mirroring `server/tests/catalog/` and `server/tests/holds/`. New
`server/tests/seatmap/` covers layout CRUD + ownership, the three per-seat lifecycle rules, upload
refusals, validation, snapshot/re-apply isolation, and clone independence.

**Target Platform**: Single VPS (Nginx, same-origin, static `/uploads`) + Neon; browsers 360–1920 px.

**Project Type**: Web application (monorepo: `server/` backend, `src/` React SPA, `shared/` contract).

**Performance Goals**: seat-map read < 500 ms p95 at a full 2,000-seat layout under the 25-VU normal
load profile (PERF-02, SC-010); buyer map stays interactive for zoom/pan at that size; feature 003's
seat-update bound (< 1 s p95, PERF-03) unaffected.

**Constraints**: DB is the source of truth — the floor plan is decoration and never a status (Principle
I); image processing bounded so it cannot push the process past ~450 MB (PERF-07) while the live seat
map is running; every endpoint scoped server-side to the owning organizer (SEC-04); no fifth external
integration (disk + a static route, ADR-0004).

**Scale/Scope**: ≤ 2,000 seats and ≤ 200 elements per layout, ≤ 20 layouts per venue; uploads ≤ 5 MB
and ≤ 4,000 px on the long edge; undo depth 50.

## Constitution Check

*GATE: must pass before Phase 0; re-checked after Phase 1.*

| Principle | Gate | Status |
|---|---|---|
| I — Reliability Under Load | DB is source of truth; no double-sell; explicit seat lifecycle; claims proven by tests | **PASS** — the floor plan is explicitly forbidden from carrying status (FR-020); every map edit re-checks live inventory under `SELECT … FOR UPDATE` and is refused whole (FR-029); the `available→held→sold` machine is untouched (FR-041) |
| II — Security & Trust | RBAC on every endpoint; server-authoritative identity; strict schema validation; output encoding | **PASS** — every route resolves venue ownership server-side and *refuses* (SEC-04, FR-042); SVG rejected by magic bytes (FR-021); labels output-encoded (FR-018, FR-043) |
| III — AI non-blocking | n/a — no AI in this feature | **PASS** (n/a) |
| IV — Verifiable / test-first | critical logic covered with tests that assert refusals, not just happy paths; strict TS; lint/type CI | **PASS** — SC-003/004/005/005a/006/011 are each refusal tests; the per-seat lifecycle rules are pinned before the write path is built |
| V — Simplicity & Free-Tier | simplest thing that meets the requirement; no infra ahead of need | **PASS** — inline SVG, no drawing library; one nominal seat size; one JSONB blob for decoration rather than a mirrored table set; disk + static route, not object storage |
| VI — Clean Codebase & FE/BE contract | one shared typed contract; no re-declared payloads; contract changes update every consumer in the same change | **PASS** — `shared/catalog/types.ts` is extended once and both renderers move with it (FR-044, SC-014); `shared/holds/types.ts` takes one additive, optional field pair and is verified geometry-free |

**Integration cap**: untouched. Floor-plan upload is VPS disk plus an Nginx static location, the same
shape ADR-0004 already accepted for avatars — not a fifth external integration.

**Governance touch**: none requiring an amendment. Four existing documents are contradicted by this
design and are already tracked as follow-ups in `spec.md` (UC-21, `SCHEMA_DATABASE.md`, `CONTEXT.md`
glossary, feature 002's spec/contract).

**Result: PASS. No unjustified violations; Complexity Tracking left empty.**

### Post-design re-check (after Phase 1)

Re-evaluated against `research.md`, `data-model.md`, and `contracts/`. Still **PASS**, with three points
the design made sharper rather than looser:

- **Principle V held under pressure.** Three tempting complications were rejected with the design in
  hand, not in the abstract: a mirrored `showtime_layouts` table set (R-2), a drawing library (R-4), and
  PostGIS for the overlap test (R-3). Each was replaced by something already in the stack.
- **Principle I is stronger than at gate time.** R-6 makes the re-apply preview explicitly *advisory* and
  re-classifies inside the transaction, so a sale landing between preview and confirm refuses the apply
  instead of overwriting it — the same posture 003 takes toward socket updates.
- **Principle VI has a structural guarantee, not just a rule.** One `SeatCanvas` shared by the editor and
  both renderers means the preview and the selection screen cannot drift, and
  `contracts/seatmap-read-contract.md` names every consumer that must move in the same change.

One design consequence worth flagging to reviewers: `sections` and `seats` are **re-parented in place**
(R-1) because `seats.id` is transitively referenced by sold tickets. The migration must never recreate
those rows.

## Project Structure

### Documentation (this feature)

```text
specs/005-seatmap-designer/
├── plan.md              # this file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1 (seatmap REST + the shared read contract diff)
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
server/src/
├── db/migrations/0007_seatmap.sql       # layouts, elements, re-parenting, geometry, snapshot, backfill
├── config.ts                            # + LAYOUT_MAX_SEATS, LAYOUT_MAX_ELEMENTS, VENUE_MAX_LAYOUTS,
│                                        #   FLOORPLAN_MAX_BYTES, FLOORPLAN_MAX_PX, SEAT_DIAMETER,
│                                        #   LAYOUT_SPACE, UPLOAD_RATE_LIMIT/WINDOW_MS, UPLOAD_CONCURRENCY
├── modules/seatmap/
│   ├── layouts.repo.ts                  # layout/section/seat/element reads + versioned full-document save
│   ├── layouts.service.ts               # ownership, ceilings, clone, template
│   ├── validate.ts                      # the five pre-publish checks (FR-030); spatial-bucket overlap
│   ├── apply.ts                          # generate + re-apply: diff, preview, per-seat inventory rules
│   ├── floorplan.ts                     # magic bytes → dimension check → sharp re-encode → uuid on disk
│   ├── upload.throttle.ts               # per-organizer rate limit + concurrency semaphore (FR-023a)
│   └── seatmap.routes.ts                # /api/organizer/layouts/* (+ the showtime map routes)
├── modules/catalog/
│   ├── catalog.repo.ts                  # getSeatMap: + geometry, elements, floor plan
│   └── organizer.routes.ts              # retire the blanket 409; delegate to modules/seatmap
└── app.ts                               # mount seatmapRouter; static /uploads/floorplans with nosniff

src/ (web)
├── components/seatmap/
│   ├── LayoutEditor.tsx                 # the canvas: place/drag/marquee/align/distribute/rotate/arc
│   ├── SeatCanvas.tsx                   # shared SVG surface (viewBox zoom/pan) used by editor + buyer
│   ├── ElementPalette.tsx               # stage / aisle / door / bar / label
│   ├── FloorPlanPanel.tsx               # upload + scale/offset/opacity + buyer-visibility toggle
│   ├── ValidationPanel.tsx              # the five checks, seats named
│   └── useLayoutHistory.ts              # undo/redo, depth 50, one step per multi-seat operation
├── components/SeatMapBuilder.tsx        # keeps the Section/Row/Count generator; opens the editor
├── components/SeatMapView.tsx           # ← rewrite: coordinates, not flex rows
├── components/SeatLayout.tsx            # ← rewrite: coordinates + zoom/pan; hold path unchanged
└── services/catalogClient.ts            # + layout CRUD, upload, validate, generate/re-apply

shared/
└── catalog/types.ts                     # SeatMap gains space/geometry/elements/floorPlan (one definition)
```

**Structure Decision**: Web-app monorepo, unchanged from 001–004. A new backend module
`modules/seatmap/` mirrors `modules/holds/` and `modules/catalog/`; the floor-plan handler is a direct
sibling of `modules/auth/avatar.ts` and reuses its magic-byte + `sharp` shape. On the web side, a single
`SeatCanvas.tsx` is shared by the organizer editor and both buyer renderers, so there is exactly one
piece of code that turns coordinates into pixels — the cheapest guarantee that the preview and the
selection screen cannot disagree about where a seat is (US2 scenario 2).

## Complexity Tracking

> No constitution violations — section intentionally empty.
