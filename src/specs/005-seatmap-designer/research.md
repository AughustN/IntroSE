# Research: Seat Map Designer (005)

The spec-level unknowns were settled in `/speckit-clarify` (see spec.md → Clarifications). This file
records the technical decisions that back them. Format per decision: **Decision · Rationale ·
Alternatives rejected**.

## R-1 — Where the layout lives: two new tables, two re-parented ones

- **Decision**: New `venue_layouts` and `layout_elements`. Existing `sections` and `seats` gain
  `layout_id` and lose their direct tie to `venue_id`; `seats` gains `pos_x`, `pos_y`, `rotation`; its
  `UNIQUE (venue_id, row_label, seat_number)` is dropped for `UNIQUE (section_id, row_label,
  seat_number)`. One migration, `0007_seatmap.sql`.
- **Rationale**: `seats.id` is referenced by `showtime_seats` and therefore, transitively, by sold
  tickets — so the rows must be *re-parented*, never recreated. Adding a column and swapping a
  constraint keeps every existing foreign key and every sold ticket valid through the migration.
  Sections move too because seat uniqueness is now per-section (FR-003) and a clone must be
  self-contained (FR-036): venue-wide sections would stop two layouts of one venue both having a
  "Khu A".
- **Alternatives**: New `layout_seats` table with the old `seats` left in place — would fork the seat
  identity that `showtime_seats` and tickets point at, and require a dual-write forever. Rejected.
  Keeping sections on the venue — breaks per-section uniqueness and makes cloning copy foreign rows.
  Rejected.

## R-2 — The snapshot: geometry on `showtime_seats`, decoration in one JSONB

- **Decision**: Generating a showtime's map copies each seat's `pos_x`/`pos_y`/`rotation` onto its
  `showtime_seats` row, and copies the layout's non-sellable elements and background settings into a
  single `showtimes.layout_snapshot` JSONB alongside a `showtimes.layout_id` reference. Re-apply
  (FR-027a) rewrites both, under the per-seat rules.
- **Rationale**: This is the smallest thing that satisfies FR-005. Seat geometry belongs on the row the
  renderer *already joins* — `getSeatMap` reads `showtime_seats` today, so the buyer read gains
  geometry with no extra join. Decoration is display-only and never inventory (FR-017), so it has no
  reason to be relational: one blob keeps the snapshot atomic and makes cloning and re-apply a single
  assignment. The `layout_id` stays for provenance, so re-apply knows what to diff against.
- **Alternatives**: A full mirrored table set (`showtime_layouts` + `showtime_sections` +
  `showtime_layout_elements`) — three tables and three write paths to express something no query ever
  filters on. Against Principle V. Rejected. Snapshotting the *whole* layout as JSONB including seats —
  would put seat identity in a blob, breaking the `showtime_seats` → `seats` foreign key the hold path
  depends on. Rejected.

## R-3 — Coordinates: integers, one seat size, bucketed overlap

- **Decision**: `pos_x`/`pos_y` are `INTEGER` in 0–10,000 with `CHECK` bounds; `rotation` is `SMALLINT`
  0–359. Every seat shares a nominal diameter of 100 units. Overlap = centre distance < 100, tested by
  comparing squared distances (no `sqrt`). Detection buckets seats into 100-unit grid cells and compares
  each seat only against its 3×3 cell neighbourhood.
- **Rationale**: Integers make the overlap test exact and reproducible — the same layout validates
  identically on every machine, which a float model cannot promise. Bucketing turns the naive O(n²)
  (2 M pairs at the 2,000-seat ceiling) into O(n) with a tiny constant, so validation stays instant at
  the ceiling. One nominal size means overlap, snapping, and hit-testing are all one rule; `seat_type`
  still *labels* a double or standing seat without changing its footprint (spec Assumptions).
- **Alternatives**: Floating-point normalised 0–1 coordinates — equality and overlap become
  tolerance-dependent and untestable. Rejected. PostGIS geometry with a spatial index — a whole
  extension for one distance check on ≤ 2,000 in-memory points. Against Principle V. Rejected.

## R-4 — Rendering: one SVG surface, shared by the editor and both buyer maps

- **Decision**: A single `SeatCanvas.tsx` renders seats as focusable SVG elements inside a `viewBox`.
  Zoom and pan are `viewBox` manipulation. The organizer editor and both buyer renderers all mount it.
  No drawing library is added.
- **Rationale**: Three things fall out of SVG at once. `viewBox` gives resolution-independent scaling,
  which is PLAT-01 (360–1920 px) for free. Real DOM nodes keep every seat focusable and labelled, which
  is FR-039a — a bitmap `<canvas>` would silently destroy the keyboard reach today's button grid has by
  accident, and nothing in the test suite would notice. And one surface for all three consumers is the
  structural guarantee behind US2 scenario 2: the preview and the selection screen *cannot* disagree
  about where a seat is, because there is only one piece of code that places one.
- **Alternatives**: `<canvas>` (+ react-konva / fabric.js) — faster at tens of thousands of nodes, which
  is far past the 2,000 ceiling, and it costs a new dependency plus a hand-built accessibility layer.
  Rejected on Principle V and FR-039a. HTML/CSS absolute positioning — workable, but zoom/pan and
  rotation become transform bookkeeping that `viewBox` does for free. Rejected.

## R-5 — Editing writes: versioned full-document save, diffed apply

- **Decision**: Two distinct write paths. (a) **Layout save** is a full-document `PUT` carrying a
  `version`; the server refuses a stale version (FR-015) and never consults inventory, because a layout
  no longer drives any generated map. (b) **Generate / re-apply** computes a diff against the showtime's
  current map, classifies each affected seat, and applies it in one transaction with
  `SELECT … FOR UPDATE` over the touched `showtime_seats` rows.
- **Rationale**: The two paths have genuinely different rules, and separating them is what makes the
  snapshot decision (R-2) pay off — layout editing becomes free of inventory concerns entirely, and all
  the FR-028 complexity lives in one file (`apply.ts`) that both generate and re-apply share. A
  full-document save fits the editor's actual shape: the client already holds the whole layout for
  undo/redo, so sending a diff would mean maintaining a second representation for no gain at 2,000 rows.
- **Alternatives**: Per-seat PATCH endpoints — dozens of round trips per drag-select operation, and no
  natural place to enforce a whole-edit refusal (FR-029). Rejected. Locking the layout for editing —
  a stale-version refusal is simpler and has no lock to leak. Rejected.

## R-6 — Preview before re-apply

- **Decision**: Re-apply is two calls: a preview that classifies every seat (`add` / `move` / `relabel`
  / `retier` / `remove`) and reports refusals without writing, then a confirm that repeats the
  classification inside the transaction and applies it.
- **Rationale**: FR-027a requires the organizer to see what would change before anything runs. Repeating
  the classification under the lock is deliberate: the preview is advisory (a hold can lapse or a sale
  can land between the two calls), exactly as feature 003 treats its socket updates as advisory against
  the row lock. The organizer is never shown a preview that is then silently violated — a changed
  outcome refuses the whole apply.
- **Alternatives**: Trusting the preview (applying a stored plan) — a sale between preview and confirm
  would be overwritten. Violates Principle I. Rejected.

## R-7 — Floor-plan upload: managed media pipeline (ADR-0006)

- **Decision**: `modules/seatmap/floorplan.ts` reuses the managed-media sanitizer: `multer` memory
  storage capped at 5 MB → magic-byte detection (JPEG/PNG/WebP only; SVG and everything else rejected)
  → `sharp().metadata()` dimension check (≤ 4,000 px long edge) *before* any resize → re-encode to
  WebP → deterministic Cloudinary upload. Replacing a plan overwrites the managed asset; removing one
  performs best-effort Cloudinary cleanup.
- **Rationale**: Backend validation and normalization keep the SVG-rejection, EXIF-stripping, and
  decompression-bomb protections in one shared code path while Cloudinary provides canonical CDN delivery.
  The dimension check runs before resize specifically to refuse a decompression bomb — a 2 MB PNG that
  decodes to 30,000 × 30,000 would otherwise be allocated in full.
- **Historical alternative (superseded)**: The former ADR-0004 local-disk/Nginx pattern was chosen before
  ADR-0006. It is no longer the current storage decision. Sniffing `Content-Type` or the extension remains
  rejected because validation must rely on actual file bytes.

## R-8 — Upload abuse bound: token bucket + concurrency semaphore

- **Decision**: `upload.throttle.ts` copies the in-memory bucket shape of `modules/holds/holds.throttle.ts`,
  keyed by organizer, plus a counter that caps how many images are being decoded at once; over the cap
  the request is refused with "try again shortly" rather than queued. Layout saves are not throttled.
- **Rationale**: A 5 MB decode holds real memory in a process bounded at ~450 MB (PERF-07) that is also
  serving the live seat map every buyer is holding seats on. The rate limit bounds sustained abuse; the
  concurrency cap bounds the *instantaneous* memory spike, which the rate limit alone does not. In-memory
  is correct here for the same reason it is in 003: one Node process behind Nginx (ADR-0003).
- **Alternatives**: Rate-limiting layout saves too — would fight the save-and-iterate rhythm the editor
  is built around, for a bounded JSON write. Rejected (clarification session). A job queue for image
  processing — infrastructure ahead of need. Rejected.

## R-9 — Migrating existing data

- **Decision**: `0007_seatmap.sql` creates one layout per venue that has sections or seats, named
  **"Sơ đồ mặc định"**, re-parents that venue's sections and seats onto it, and seeds each seat's
  position from its existing row/number grid (row index × spacing, number × spacing). Showtimes with an
  existing generated map are backfilled by copying those same positions onto their `showtime_seats`.
- **Rationale**: The seeded grid *is* what buyers see today, so the day this ships nothing visibly
  changes for an un-edited venue and no existing showtime's map breaks. Backfilling the snapshot as well
  as the layout means the snapshot invariant (R-2) holds for historical rows too — no code path has to
  special-case a showtime that predates the feature.
- **Alternatives**: Leaving legacy seats unpositioned and rendering them by the old grouping — two
  renderers forever, and the contract would have to make geometry optional. Against Principle VI.
  Rejected.

## R-10 — Contract change and the 003 boundary

- **Decision**: `shared/catalog/types.ts` — `SeatMap` gains `space`, `elements`, and `floorPlan`;
  `SeatMapSeat` gains `x`, `y`, `rotation`, and `section`. `shared/holds/types.ts` — **one additive
  change**: `SeatUpdate`'s seated entry gains an optional `tier`/`price` pair, set only when an organizer
  retiers a live seat (FR-035). It never carries geometry.
- **Rationale**: Geometry is static for the life of a showtime's map, so it belongs to the map read that
  happens once per page, not to a broadcast that fires on every hold. Keeping `SeatUpdate` geometry-free
  is what makes FR-041 true and lets every existing 003 test pass unmodified (SC-012). Verified against
  `shared/holds/types.ts:67` and `server/src/realtime/io.ts` — neither references seat geometry. Tier and
  price are the one exception, because unlike geometry they genuinely *change* on a live map (FR-034):
  both fields are optional and only an organizer action sets them, so a 003 client that ignores them is
  unaffected.
- **Alternatives**: Adding geometry to the socket payload — larger broadcasts on the hot path, for data
  the client already has. Rejected. For the retier specifically, a bare "map changed, re-read" event —
  costs a full map refetch per retier plus a new event name, to avoid two optional fields. Rejected.

## R-11 — Validation placement

- **Decision**: `validate.ts` is a pure function over a layout document, called by the server on publish
  and on re-apply preview, and by the client for live in-editor feedback. It returns a list of issues,
  each naming the seats or sections at fault (a *pair* for an overlap).
- **Rationale**: One implementation, imported by both sides from `shared/` — the same reason the seat-map
  payload has one definition (Principle VI). A drafting organizer gets instant feedback without a round
  trip, and the server still decides, because the client's copy is advisory (the same posture 003 takes
  toward socket updates).
- **Alternatives**: Server-only validation — every drag would need a round trip for the overlap
  highlight. Rejected. Client-only — trivially bypassed, and FR-030 is a publish gate. Rejected.

---

# Amendment (007-scope) research — 2026-08-06

Eight further decisions, covering only the amendment. R-1..R-11 above are unchanged.

---

## R-12 — A table is its own table, not an element

**Decision.** New relation `layout_tables` (layout, section, name, shape round|rect, position, size,
rotation, seat count, per-side counts), and `seats` gains a nullable `table_id`. A seat at a table is an
ordinary seat that happens to point at one.

**Rationale.** The obvious cheaper option is `layout_elements` with `kind='table'` and a
`seats.element_id`. It was rejected for one reason: `layout_elements` carries an explicit rule —
"stored separately from seats so it can never become inventory" (FR-017). A foreign key from a seat to
an element would blur precisely the line that keeps decoration out of the ticket path, and that line is
worth more than one table. Tables also need things elements do not have: a **section** they impart to
their seats (FR-049), a seat count, and their own ceiling (100 vs 200 elements).

**Alternatives considered.** (a) `kind='table'` element + `seats.element_id` — rejected above. (b) No
table row at all, tagging seats with a shared `table_name` string and re-deriving the group — makes
"move the table" an N-seat guess and gives the geometry nowhere to live. (c) A table as a *section* —
conflates pricing with furniture; a gala hall prices "Khu VIP" across several tables.

**Consequence.** `seats.table_id` is `ON DELETE` guarded by the service, not by the database: deleting a
table with sold seats must produce a *refusal with reasons*, not a constraint error (FR-052).

---

## R-13 — Shape points ride on the element row

**Decision.** `layout_elements` gains `points JSONB` — an ordered array of `{x, y}` — with the existing
`pos_x/pos_y/width/height` retained as the shape's **bounding box**. No `shape_points` table.

**Rationale.** This geometry is only ever read whole, drawn, and written whole; it is never queried by
point. A child table would add a join to every layout read and a delete-and-reinsert to every save for
no query it enables. Keeping the rectangle fields populated means every existing reader — including the
buyer renderers before they learn about points — still positions the shape sensibly instead of at the
origin. Settled in the spec's amendment clarifications; recorded here for the schema.

**Alternatives considered.** A normalised `shape_points(element_id, ordinal, x, y)` — the textbook shape,
and the wrong one for a value that behaves like a document. `layout_snapshot` already sets the precedent
that whole-document geometry lives in JSONB.

---

## R-14 — Widening the element vocabulary, exactly as 0010 did

**Decision.** `ALTER TABLE layout_elements DROP CONSTRAINT IF EXISTS layout_elements_kind_check;` then
re-add it over the **union** of the old vocabulary and the seven new facility kinds (`exit`, `restroom`,
`food_drink`, `smoking`, `first_aid`, `lift_stairs`, `wheelchair`).

**Rationale.** `0010_element_kinds.sql` already widened this CHECK once, in exactly this shape, with the
same reasoning written into it: widening to the union is additive, so nothing that was valid becomes
invalid and no existing row or writer is affected. Repeating a reviewed pattern beats inventing a second.

---

## R-15 — Section style columns, defaulted so nothing changes

**Decision.** `sections` gains `color TEXT`, `seat_shape TEXT CHECK (seat_shape IN ('circle','square'))
DEFAULT 'circle'`, and `seat_size_multiplier NUMERIC DEFAULT 1.0` bounded to 0.5–2.0 in validation.

**Rationale.** Defaults reproduce today's rendering exactly — every existing seat is a circle at 1.0 —
so the day this ships, no stored layout looks different and no stored layout changes its publishability.
`color` is deliberately **nullable**: a layout drafted before this change has none, and FR-066 makes it a
*publish* requirement rather than a storage one, so drafts stay permissive exactly as they already are
for overlap (FR-032).

---

## R-16 — Overlap uses the effective seat size

**Decision.** `shared/catalog/seatmap-validate.ts` computes each seat's effective diameter as
`SEAT_DIAMETER × its section's multiplier`, and two seats overlap when their centre distance is less
than the **larger** of the two. The spatial bucket size becomes the largest effective diameter in the
layout rather than the constant.

**Rationale.** The alternative — keep the test on the nominal diameter and treat the multiplier as
decoration — lets a 2× section draw seats visibly on top of each other while validation reports the
layout clean. A picture that contradicts the publish gate is worse than no picture, and the organizer
has no way to tell which one to believe. With the default at 1.0 this is mathematically identical to
today's rule, so only a layout that opts in can newly fail, and it fails for something visible.

**Cost.** The bucket sweep widens with the largest multiplier. Bounded at 2.0, that is at most a 2×
neighbourhood, still O(n) at the 2,000-seat ceiling.

---

## R-17 — Tier colours are derived, never stored

**Decision.** One shared function in `shared/catalog/tier-palette.ts`: given a showtime's tiers, sort by
price ascending and map index → a fixed palette entry, repeating if there are more tiers than colours.
Nothing is written; no ticket-tier column is added.

**Rationale.** A stored colour would mean a column on `ticket_tiers`, which **feature 006 owns**, plus
its create/edit forms — cross-feature work landing in a seat-map change for no requirement that asks for
it. Deriving also makes the visual order consistent across every event (cheap is always the same end of
the palette, so a buyer learns it once) and self-healing: when 006 reprices a tier, the map re-colours on
the next read with no stale value anywhere. And because it is one function imported by both renderers,
the two cannot disagree — there is no stored value for them to disagree about.

**Alternatives considered.** Organizer-chosen colours (rejected: cross-feature, and organizers do not
want the decision); auto with an override (rejected as both costs for no asked-for benefit — additive
later if it is ever requested).

---

## R-18 — The new objects ride in the snapshot that already exists

**Decision.** `apply.ts` extends the `showtimes.layout_snapshot` JSONB it already writes to include
tables and shapes alongside the elements and floor-plan settings. **No migration** for this.

**Rationale.** The snapshot exists precisely so a later layout edit cannot reshape a show that is
selling (R-2, FR-005). Decoration sits in the same picture as the seats; reading it live would let an
organizer tidying the hall outline silently change a live show's map — the failure the snapshot was
written to prevent. Extending the existing blob keeps **one** rule instead of two contradictory ones, and
keeps the previewed re-apply as the only path by which any layout edit reaches a live showtime.

**Consequence.** FR-081's guarantee is exactly as good as this one write. `apply.ts` is the single place
that must be extended, and the isolation test (SC-027) is what pins it.

**Note.** Buyer-side table labels need no new column: `seats.row_label` already carries "Bàn 5" (FR-053)
and is already copied onto `showtime_seats.row_label`, so the label and the geometry arrive by the two
mechanisms that already exist.

---

## R-19 — Seat distribution is arithmetic, and it belongs in one file

**Decision.** `modules/seatmap/tables.ts` owns distribution: round tables place seats at
`angle = 2π·i/n` on the table's radius plus a seat offset; rectangular tables walk the per-side counts
around the perimeter. Seats are stored as ordinary absolute coordinates, **not** as offsets from the
table.

**Rationale.** Storing absolute coordinates means every existing reader — the renderers, the overlap
test, the snapshot — keeps working unchanged; a table seat is indistinguishable from any other seat to
everything except the editor. Moving a table then means recomputing its seats' absolute positions, which
is the same arithmetic run again, and is why the sold/held refusal (FR-051) has to sit in front of it.

**Alternatives considered.** Storing seats as table-relative offsets and resolving at read time — would
push table awareness into every renderer and the overlap test, for a saving only the editor would notice.

---

## R-20 — Table name uniqueness is checked at placement, in the service

**Decision.** The service refuses a table whose name collides with an existing table in the **same
section** at placement time, naming the clash. No new database constraint.

**Rationale.** The real invariant is already enforced: seat labels are unique per
`(section, row_label, seat_number)` (FR-003), and a table's name *is* its seats' row label (FR-053), so a
colliding table would fail on save at the seat level — with a confusing message, after the organizer has
placed ten seats. Checking at placement turns a late, cryptic failure into an immediate, specific one.
A `UNIQUE (section_id, name)` on `layout_tables` was considered and rejected: a draft may legitimately
hold a transient collision while the organizer is renaming, exactly as drafts may hold transient overlap
(FR-032).
