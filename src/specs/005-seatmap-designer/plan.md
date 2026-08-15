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

---

# Amendment (007-scope): hall-scheme parity

**Date**: 2026-08-06 | **Spec**: [spec.md](./spec.md) — User Story 9 onward, FR-047–FR-083, SC-015–SC-028

Everything above describes the **shipped** 005 architecture and is unchanged. This section covers only
the amendment: tables, hall boundary and dividers, facility icons, per-section visual style,
buyer-side price colouring, and the standing-area substitute for fan zones.

## Amendment Summary

Five additions, one of which carries almost all the weight. **Tables** are the only one that touches
inventory: a table is a drawing object that *owns* seats, so moving it moves them, and deleting it is
governed by what those seats are worth. Everything else — boundary polygons, dividers, facility icons,
section colour/shape/size, tier colouring — is decoration or presentation and touches no inventory at
all. The buyer's map gains one meaning it never had: **colour means price**, derived at read time from
the tier order, with section colour demoted to an editor-only aid so the map never says two things at
once. Feature 003's hold path and feature 004's checkout are untouched, again.

## Amendment Technical Context

*(Additive to the Technical Context above; unchanged entries are not repeated.)*

**Storage**: one new migration `server/src/db/migrations/0012_hallscheme.sql`, and it **must** use
`ADD COLUMN IF NOT EXISTS`: the runner's already-applied codes are `42P07` (duplicate table), `42710`
(duplicate object) and `42P16` (duplicate index) — **not** `42701` (duplicate column) — so a plain
`ADD COLUMN` would fail a re-run instead of skipping it. Contents: new table `layout_tables`; `seats`
gains `table_id`; `sections` gains `color`, `seat_shape`, `seat_size_multiplier`; `layout_elements`
gains `points JSONB` and its `kind` CHECK is widened exactly as `0010_element_kinds.sql` widened it
(drop-if-exists, re-add the union). `showtimes.layout_snapshot` needs **no migration** — it is already
JSONB, and tables and shapes ride inside it.

**Testing**: `server/tests/seatmap/` gains `tables.test.ts` (placement, distribution, move/rotate
carrying seats, re-count, sold/held refusals, name collision at placement), `shapes-icons.test.ts`
(points round-trip, kind widening leaves old rows valid, never inventory), and `section-style.test.ts`
(defaults reproduce today's rendering; multiplier feeds overlap). Buyer-side tier colouring is asserted
in `server/tests/catalog/seatmap-read.test.ts`. Every refusal path gets an asserting test in the style
of `apply-rules.test.ts`.

**Performance Goals**: unchanged — the amendment adds at most 100 tables and 200 shapes/icons to a
layout already bounded at 2,000 seats, and the tier palette is computed from a tier list that is already
read. The PERF-02 bound (SC-010) is re-measured, not renegotiated.

**Scale/Scope**: new ceilings — **2–20 seats per table**, **100 tables per layout**, **3–64 points per
boundary polygon**, **exactly 2 per divider**. Table seats count toward the existing 2,000-seat ceiling
and shapes toward the existing 200-element ceiling, so no new budget is introduced.

## Amendment Constitution Check

*GATE for the new scope only. The original check above stands for the shipped scope.*

| Principle | Gate | Status |
|---|---|---|
| I — Reliability Under Load | DB is source of truth; no double-sell; explicit lifecycle; claims proven by tests | **PASS** — a table owns seats but is never inventory; every table operation that would move, relabel or remove a **sold** or **held** seat is refused **whole** through the existing `seat_sold`/`seat_held` path (FR-051), and decoration can never acquire a status |
| II — Security & Trust | RBAC on every endpoint; server-authoritative; strict validation; output encoding | **PASS** — every new endpoint resolves layout ownership server-side and refuses (FR-079); table and icon labels are length-bounded and output-encoded like existing element text (FR-062) |
| III — AI non-blocking | n/a — no AI in this scope | **PASS** (n/a) |
| IV — Verifiable / test-first | refusal tests, not just happy paths; strict TS; green CI | **PASS** — SC-016..SC-023, SC-026..SC-028 are refusal- or invariance-shaped; the table refusals are written before the table write path, mirroring `apply-rules.test.ts` |
| V — Simplicity & Free-Tier | simplest thing that meets the requirement; no infra ahead of need | **PASS** — fan zones were **declined** rather than accommodated (FR-080); no shape-point table; tier colours derived, not stored; tables and shapes ride in the JSONB snapshot that already exists, so the snapshot needs no migration |
| VI — Clean Codebase & FE/BE contract | one shared contract; no re-declared payloads; consumers move together | **PASS** — `shared/catalog/seatmap.ts` and `shared/catalog/types.ts` gain the new objects once, and the server, the editor and **both** buyer renderers move in the same change (FR-078); the tier palette is one shared function, not a copy per renderer |

**Integration cap**: untouched. No new external dependency — SVG rendering and `pg` only.

**Governance touch**: none requiring an amendment to the constitution. Four documents are extended and
are already tracked in the spec's Follow-ups.

**Result: PASS for the amendment scope. Complexity Tracking stays empty.**

### Amendment post-design re-check (after Phase 1)

Re-evaluated against the amendment sections of `research.md`, `data-model.md`, and `contracts/`. Still
**PASS**, with three points the design made sharper:

- **Principle V held where it was most tempting to break it.** The largest simplification is what was
  *not* built: fan zones were declined (FR-080), which kept feature 003's "seated or GA, never mixed"
  invariant closed and avoided a concurrency feature disguised as a drawing feature. Two smaller ones
  followed — no shape-point table (R-13), and no colour column on the ticket tier (R-17).
- **Principle I got a boundary it did not have.** R-12 puts `table_id` on `seats` rather than modelling
  a table as an element, precisely because `layout_elements` carries the rule "never inventory"
  (FR-017). A foreign key from a seat to an element would have blurred the one line that keeps
  decoration out of the ticket path.
- **Principle VI is enforced by derivation, not discipline.** Tier colours are computed from the tier
  list at read time by one shared function (R-17), so the two buyer renderers cannot drift apart even
  in principle — there is no stored colour for them to disagree about, and no ticket-tier data changes.

One consequence worth flagging to reviewers: **`showtimes.layout_snapshot` grows** to carry tables and
shapes. It is already JSONB and already the mechanism that stops a layout edit reshaping a selling show,
so this is the intended use — but it means FR-081's guarantee is only as good as the snapshot write, and
`apply.ts` is the single place that must be extended for it.

## Amendment Project Structure

*(Additive. Files marked `←` already exist and are extended, not replaced.)*

```text
server/src/
├── db/migrations/0012_hallscheme.sql    # layout_tables; seats.table_id; sections style;
│                                        #   layout_elements.points; kind CHECK widened (0010 pattern)
├── config.ts                          ← # + TABLE_MIN_SEATS/TABLE_MAX_SEATS, LAYOUT_MAX_TABLES,
│                                        #   POLYGON_MIN_POINTS/POLYGON_MAX_POINTS
├── modules/seatmap/
│   ├── tables.ts                        # NEW: seat distribution round/rect, move/rotate/re-count,
│   │                                    #   section inheritance, name-collision check at placement
│   ├── layouts.repo.ts                ← # tables + points in the versioned full-document save
│   ├── validate.ts                    ← # + table overlap, polygon enclosure, icon position, section colour
│   ├── apply.ts                       ← # snapshot tables + shapes into layout_snapshot (FR-081)
│   └── seatmap.routes.ts              ← # table endpoints, still organizer-scoped
└── modules/catalog/catalog.repo.ts    ← # buyer read: seat tier + tier legend (name, colour, price)

src/ (web)
├── components/seatmap/
│   ├── TablePalette.tsx                 # NEW: round/rectangular tables, seats-per-side
│   ├── ShapeTools.tsx                   # NEW: boundary polygon + divider drawing
│   ├── SectionStylePanel.tsx            # NEW: colour, seat shape, size multiplier
│   ├── ElementPalette.tsx             ← # + exit/restroom/food/smoking/first-aid/lift/wheelchair
│   ├── SeatCanvas.tsx                 ← # draw tables, shapes, icons; seat shape + size from section
│   ├── LayoutEditor.tsx               ← # table select-as-one-object; undo covers new ops
│   └── ValidationPanel.tsx            ← # the four new checks, in the same single pass
├── components/SeatMapView.tsx         ← # tier colour + legend
├── components/SeatLayout.tsx          ← # tier colour + legend (identical to the above)
└── services/catalogClient.ts          ← # table/shape/style calls

shared/catalog/
├── seatmap.ts                         ← # LayoutTable, shape points, widened element kinds, section style
├── seatmap-validate.ts                ← # overlap uses EFFECTIVE seat size; four new checks
├── tier-palette.ts                      # NEW: tier list → colour, ordered by price. ONE definition,
│                                        #   imported by both buyer renderers (Principle VI)
└── types.ts                           ← # buyer SeatMap gains seat tier + the tier legend
```

**Amendment Structure Decision**: the new backend logic lands in one file, `modules/seatmap/tables.ts`,
because seat distribution is the only genuinely new algorithm here — everything else extends a file that
already owns that concern (`validate.ts` validates, `apply.ts` snapshots, `SeatCanvas.tsx` draws). On the
web side `tier-palette.ts` is deliberately in `shared/`, not in a component: it is the single thing that
makes the two buyer renderers agree about what colour a price is, and a copy in each would be exactly
the drift Principle VI exists to prevent.
