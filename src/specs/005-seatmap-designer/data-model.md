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

---

# Amendment (007-scope) data model — 2026-08-06

Migration `server/src/db/migrations/0012_hallscheme.sql`. One new table, four altered ones, one widened
CHECK. **Every `ADD COLUMN` uses `IF NOT EXISTS`** — the migration runner treats `42P07` (duplicate
table), `42710` (duplicate object) and `42P16` (duplicate index) as already-applied, but **not** `42701`
(duplicate column), so a plain `ADD COLUMN` would fail a re-run instead of skipping.

## New: `layout_tables`

```sql
CREATE TABLE IF NOT EXISTS layout_tables (
  id BIGSERIAL PRIMARY KEY,
  layout_id BIGINT NOT NULL REFERENCES venue_layouts(id) ON DELETE CASCADE,
  section_id BIGINT REFERENCES sections(id),  -- imparted to its seats (FR-049)
  name TEXT NOT NULL,                         -- "Bàn 5" — becomes each seat's row label (FR-053)
  shape TEXT NOT NULL CHECK (shape IN ('round', 'rect')),
  pos_x INT NOT NULL, pos_y INT NOT NULL,     -- same 0–10,000 space as seats
  width INT NOT NULL, height INT NOT NULL,    -- round: width = height = diameter
  rotation INT NOT NULL DEFAULT 0,
  seat_count INT NOT NULL CHECK (seat_count BETWEEN 2 AND 20),
  side_counts JSONB                           -- rect only: seats per side, null for round
);
CREATE INDEX IF NOT EXISTS idx_layout_tables_layout ON layout_tables(layout_id);
```

No `UNIQUE (section_id, name)`: a draft may hold a transient collision while renaming, exactly as it may
hold transient overlap (FR-032). The service refuses a colliding name **at placement** (R-20).

## Changed: `seats`

```sql
ALTER TABLE seats ADD COLUMN IF NOT EXISTS table_id BIGINT REFERENCES layout_tables(id);
CREATE INDEX IF NOT EXISTS idx_seats_table ON seats(table_id);
```

Nullable — most seats are not at a table. Deliberately **no** `ON DELETE CASCADE`: deleting a table with
sold seats must be a *refusal naming the seats* (FR-052), not a constraint error or a silent cascade.

## Changed: `sections` — visual style

```sql
ALTER TABLE sections ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE sections ADD COLUMN IF NOT EXISTS seat_shape TEXT NOT NULL DEFAULT 'circle';
ALTER TABLE sections ADD COLUMN IF NOT EXISTS seat_size_multiplier NUMERIC NOT NULL DEFAULT 1.0;
ALTER TABLE sections DROP CONSTRAINT IF EXISTS sections_seat_shape_check;
ALTER TABLE sections ADD CONSTRAINT sections_seat_shape_check
  CHECK (seat_shape IN ('circle', 'square'));
```

| Column | Meaning |
|---|---|
| `color` | **Editor-only** (FR-064). Never fills a seat on the buyer map — there colour means price. Nullable: required to publish, not to store. |
| `seat_shape` | Reaches buyers. Default `circle` = today's rendering. |
| `seat_size_multiplier` | Scales the nominal diameter; bounded 0.5–2.0 in validation. Default `1.0` = today's rendering **and** today's overlap outcomes. |

## Changed: `layout_elements` — points and the widened vocabulary

```sql
ALTER TABLE layout_elements ADD COLUMN IF NOT EXISTS points JSONB;

ALTER TABLE layout_elements DROP CONSTRAINT IF EXISTS layout_elements_kind_check;
ALTER TABLE layout_elements ADD CONSTRAINT layout_elements_kind_check
  CHECK (kind IN ('stage', 'aisle', 'door', 'bar', 'label', 'area',
                  'boundary', 'divider',
                  'exit', 'restroom', 'food_drink', 'smoking',
                  'first_aid', 'lift_stairs', 'wheelchair'));
```

`points` is an ordered `[{x, y}, …]`; `pos_x/pos_y/width/height` stay populated as the **bounding box**,
so a reader that does not understand points still positions the shape (R-13). Widening is the union, in
the same shape `0010_element_kinds.sql` used, so no stored element becomes invalid (R-14).

## Unchanged: `showtimes.layout_snapshot`

**No migration.** It is already JSONB and already the mechanism that stops a layout edit reshaping a
selling show. `apply.ts` extends what it writes to include tables and shapes (R-18). Buyer-side table
labels need no column either: `seats.row_label` already carries "Bàn 5" and is already copied to
`showtime_seats.row_label`.

## Amendment entities

- **Layout Table**: a drawing object owning seats — shape, position, size, rotation, name, section, seat
  count, and per-side counts when rectangular. Never sellable, never in inventory. Its seats inherit its
  section; its name becomes their row label.
- **Layout Shape**: a `boundary` polygon (3–64 points) or a `divider` (exactly 2), stored as an element
  with points plus a bounding box. Decoration with no status and no price.
- **Facility Icon**: an element of one of the seven new kinds, with an optional Vietnamese label.
- **Section Style**: colour (editor-only), seat shape, and size multiplier.
- **Tier Legend**: derived at read time from the showtime's tiers, ordered by price. Not stored anywhere.

## Amendment invariants

| # | Invariant | Enforced by |
|---|---|---|
| A1 | A table holds 2–20 seats | CHECK + service (FR-054) |
| A2 | A layout holds ≤ 100 tables | service (FR-054) |
| A3 | Table seats count toward the 2,000-seat ceiling | service, existing counter (FR-055) |
| A4 | A boundary has 3–64 points; a divider exactly 2 | validation (FR-059) |
| A5 | Moving/rotating/re-counting/deleting a table never touches a **sold** or **held** seat | service, whole-refusal (FR-051, FR-052) |
| A6 | A table's seats always carry the table's section | service on placement and re-parent (FR-049) |
| A7 | Two tables in one section never share a name | service, checked at placement (FR-053, R-20) |
| A8 | Section colour never reaches the buyer map | buyer read omits it (FR-064) |
| A9 | Tier colour is derived, never stored | one shared function (FR-067, R-17) |
| A10 | Shapes, icons and tables never enter inventory | they are not seats; bookable count unchanged (FR-057, SC-018) |
