# Data Model: Seat Map Designer (005)

Migration `server/src/db/migrations/0007_seatmap.sql`. Extends the 002 catalog schema; touches nothing
owned by 003 (`reservations`, `reservation_items`) or 004 (orders, wallet, tickets).

Constants (all in `server/src/config.ts`, all overridable by env):

| Constant | Default | Requirement |
|---|---|---|
| `LAYOUT_SPACE` | 10000 | coordinate space, 0–10,000 per axis (FR-008) |
| `SEAT_DIAMETER` | 100 | nominal seat size; overlap threshold (FR-008, FR-030a) |
| `LAYOUT_MAX_SEATS` | 2000 | FR-007 |
| `LAYOUT_MAX_ELEMENTS` | 200 | FR-019 |
| `VENUE_MAX_LAYOUTS` | 20 | FR-007 |
| `FLOORPLAN_MAX_BYTES` | 5 MB | FR-023 |
| `FLOORPLAN_MAX_PX` | 4000 | FR-023, long edge |
| `UPLOAD_RATE_LIMIT` / `UPLOAD_RATE_WINDOW_MS` | 10 / 60 s | FR-023a |
| `UPLOAD_CONCURRENCY` | 2 | FR-023a, memory spike bound (PERF-07) |

---

## New: `venue_layouts`

One named arrangement of a venue. A venue owns several; a seated showtime picks one.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `venue_id` | BIGINT NOT NULL → `venues(id)` | ownership resolves through the venue's `created_by` (SEC-04) |
| `name` | TEXT NOT NULL | `UNIQUE (venue_id, name)` — FR-001 |
| `status` | TEXT NOT NULL DEFAULT `'draft'` | CHECK in (`draft`, `published`) — FR-004 |
| `is_template` | BOOLEAN NOT NULL DEFAULT false | FR-036 |
| `version` | INT NOT NULL DEFAULT 1 | optimistic concurrency; bumped on every save (FR-015) |
| `plan_url` | TEXT | `/uploads/floorplans/<uuid>.webp`, NULL when no plan |
| `plan_scale` | INT NOT NULL DEFAULT 1000 | per-mille of the coordinate space |
| `plan_offset_x` / `plan_offset_y` | INT NOT NULL DEFAULT 0 | layout units |
| `plan_opacity` | SMALLINT NOT NULL DEFAULT 50 | CHECK 0–100 |
| `plan_visible_to_buyers` | BOOLEAN NOT NULL DEFAULT false | FR-026, default off |
| `created_at` / `updated_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |

`CREATE INDEX idx_venue_layouts_venue ON venue_layouts(venue_id);`

**Rules**: only a layout passing validation may reach `published` (FR-004). Deleting a layout is refused
while any showtime that is not `finished`/`cancelled` references it (FR-006). A venue is capped at
`VENUE_MAX_LAYOUTS` (FR-007).

---

## Changed: `sections`

Moves from the venue to the layout (FR-002).

- **Add** `layout_id BIGINT REFERENCES venue_layouts(id)`, backfilled, then `SET NOT NULL`.
- **Drop** `UNIQUE (venue_id, name)`; **add** `UNIQUE (layout_id, name)`.
- `venue_id` is **dropped** after backfill — a section's venue is now its layout's venue.

---

## Changed: `seats`

Gains geometry and moves to the layout (FR-002, FR-003, FR-008).

- **Add** `layout_id BIGINT REFERENCES venue_layouts(id)`, backfilled, then `SET NOT NULL`.
- **Add** `pos_x INT NOT NULL`, `pos_y INT NOT NULL` — `CHECK (pos_x BETWEEN 0 AND 10000)`, same for
  `pos_y` (FR-014 clamps before write, the CHECK is the backstop).
- **Add** `rotation SMALLINT NOT NULL DEFAULT 0` — `CHECK (rotation BETWEEN 0 AND 359)`.
- **Drop** `UNIQUE (venue_id, row_label, seat_number)`; **add**
  `UNIQUE (section_id, row_label, seat_number)` — FR-003. `section_id` stays nullable, so a sectionless
  seat is representable in draft and caught by validation (FR-030, FR-032) rather than by the constraint.
- `venue_id` is **dropped** after backfill.
- `seat_type` unchanged — `single` / `double` / `standing`. It labels the seat; it does **not** change
  its footprint (one nominal diameter for all, R-3).

`CREATE INDEX idx_seats_layout ON seats(layout_id);`

**`seats.id` is never recreated.** `showtime_seats` — and therefore sold tickets — point at it. The
migration re-parents rows in place.

---

## New: `layout_elements`

Non-sellable decoration. Deliberately a separate table so it can never be reached by any inventory
query (FR-017).

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `layout_id` | BIGINT NOT NULL → `venue_layouts(id)` ON DELETE CASCADE | |
| `kind` | TEXT NOT NULL | CHECK in (`stage`, `aisle`, `door`, `bar`, `label`) — FR-016 |
| `pos_x` / `pos_y` | INT NOT NULL | CHECK 0–10,000 |
| `width` / `height` | INT NOT NULL | CHECK > 0 |
| `rotation` | SMALLINT NOT NULL DEFAULT 0 | CHECK 0–359 |
| `label` | TEXT | length-bounded; output-encoded at every render (FR-018) |

`CREATE INDEX idx_layout_elements_layout ON layout_elements(layout_id);`

Capped at `LAYOUT_MAX_ELEMENTS` per layout (FR-019).

---

## Changed: `showtimes`

Holds the binding and the decoration half of the snapshot (FR-005, R-2).

- **Add** `layout_id BIGINT REFERENCES venue_layouts(id)` — provenance, so re-apply knows what to diff.
  NULL for general-admission showtimes; a GA showtime with a non-NULL `layout_id` is refused.
- **Add** `layout_snapshot JSONB` — the elements array plus the background settings (`planUrl`, scale,
  offsets, opacity, buyer visibility) **as they were at generation**. NULL until a map is generated.

---

## Changed: `showtime_seats`

Holds the geometry half of the snapshot. Shape is otherwise **untouched** — status machine, hold
columns, and the 003 lock path are unchanged (FR-041).

- **Add** `pos_x INT`, `pos_y INT`, `rotation SMALLINT NOT NULL DEFAULT 0`, copied from the layout seat
  at generation and rewritten only by an allowed edit or a re-apply.

Geometry sits here, not on a joined table, because `getSeatMap` already reads this row — the buyer read
gains coordinates with no extra join (R-2).

---

## Migration & backfill (`0007_seatmap.sql`)

1. Create `venue_layouts` and `layout_elements`.
2. For every venue with at least one section or seat, insert one layout named **"Sơ đồ mặc định"**,
   `status='published'` (it is already selling).
3. Backfill `sections.layout_id` and `seats.layout_id` from that layout.
4. Seed `seats.pos_x` / `pos_y` from the current row/number grid — distinct row labels ordered
   ascending give the row index, `seat_number` gives the column; multiply both by a spacing of
   `SEAT_DIAMETER × 1.5` and centre the result in the space. This reproduces exactly what buyers see
   today (R-9).
5. Swap the unique constraints; drop `sections.venue_id` and `seats.venue_id`; set the new columns
   `NOT NULL`.
6. Add the `showtimes` and `showtime_seats` columns; backfill `showtime_seats` geometry from the seeded
   seat positions and `showtimes.layout_id` / `layout_snapshot` for every showtime that already has a
   generated map, so no code path has to special-case a pre-feature showtime.

---

## State transitions

**Layout**: `draft → published` on passing validation (FR-004, FR-030). `published → draft` is allowed
— it does not disturb any showtime, because generated maps are snapshots (FR-005). Deletion is refused
while a live showtime references it (FR-006).

**Showtime seat** — unchanged from 002/003 (`available ↔ held → sold`, `available ↔ blocked`). This
feature adds only organizer-driven `available ↔ blocked` (FR-033) and never touches `held` or `sold`
transitions.

**Per-seat edit rules** (FR-028), enforced in `apply.ts` under `SELECT … FOR UPDATE`:

| Seat status | Position / rotation | Label · section · tier · delete |
|---|---|---|
| `available` | allowed | allowed |
| `blocked` | allowed | allowed |
| `sold` | **allowed** | **refused** — names the sale |
| `held` (live) | **refused** | **refused** — names the hold, retry after it lapses |

Any refused seat rejects the **whole** edit; the map is left byte-identical (FR-029, SC-005).

---

## Entity map

```text
venues (002, owner = created_by)
  └── venue_layouts (new)                      ≤ 20 per venue
        ├── sections (re-parented)             unique name per layout
        │     └── seats (re-parented + geometry)  unique (section, row, number); ≤ 2000 per layout
        ├── layout_elements (new)              ≤ 200 per layout; never inventory
        └── floor plan (columns on the layout) background only; never a status

showtimes (002)
  ├── layout_id ──────────────► venue_layouts  provenance for re-apply
  ├── layout_snapshot (JSONB)                  elements + background, frozen at generation
  └── showtime_seats (002) + pos_x/pos_y/rotation
        └── seat_id ─────────► seats           unchanged FK; tickets depend on it
```
