BEGIN;

-- Feature 005 amendment (007-scope) — hall-scheme parity.
--
-- Additive only. Every ADD COLUMN uses IF NOT EXISTS on purpose: the migration runner treats 42P07
-- (duplicate table), 42710 (duplicate object) and 42P16 (duplicate index) as "already applied", but
-- NOT 42701 (duplicate column) — so a plain ADD COLUMN would fail a re-run instead of skipping it.

-- ---------- TABLES (FR-047..FR-056) ----------
-- A table is a DRAWING object that owns seats. It is never sellable and never appears in inventory;
-- it exists so the editor can move, rotate, rename and re-count a group of seats as one thing. Its
-- seats are ordinary seats in every other respect and are held/sold by 003/004 unchanged.
--
-- It is its own relation rather than a `layout_elements` row because `layout_elements` carries the
-- rule "stored separately from seats so it can never become inventory" (FR-017); a foreign key from a
-- seat to an element would blur exactly that line. Tables also need a section to impart to their
-- seats, which elements do not have.
CREATE TABLE IF NOT EXISTS layout_tables (
  id BIGSERIAL PRIMARY KEY,
  layout_id BIGINT NOT NULL REFERENCES venue_layouts(id) ON DELETE CASCADE,
  section_id BIGINT REFERENCES sections(id),   -- imparted to its seats (FR-049)
  name TEXT NOT NULL,                          -- "Bàn 5" — becomes each seat's row label (FR-053)
  shape TEXT NOT NULL CHECK (shape IN ('round', 'rect')),
  pos_x INT NOT NULL,
  pos_y INT NOT NULL,
  width INT NOT NULL,                          -- round: width = height = diameter
  height INT NOT NULL,
  rotation INT NOT NULL DEFAULT 0,
  seat_count INT NOT NULL CHECK (seat_count BETWEEN 2 AND 20),
  side_counts JSONB                            -- rect only: seats per side; NULL for round
);
CREATE INDEX IF NOT EXISTS idx_layout_tables_layout ON layout_tables(layout_id);

-- Deliberately NO `UNIQUE (section_id, name)`: a draft may hold a transient collision while the
-- organizer renames, exactly as a draft may hold transient seat overlap (FR-032). The service refuses
-- a colliding name at PLACEMENT, where the message can name the clash (FR-053).

-- Seats gain their table. Nullable — most seats are not at one. Deliberately NO ON DELETE CASCADE:
-- deleting a table that holds a sold seat must be a refusal naming that seat (FR-052), not a silent
-- cascade and not a raw constraint error.
ALTER TABLE seats ADD COLUMN IF NOT EXISTS table_id BIGINT REFERENCES layout_tables(id);
CREATE INDEX IF NOT EXISTS idx_seats_table ON seats(table_id);

-- ---------- PER-SECTION VISUAL STYLE (FR-064..FR-066) ----------
-- Defaults reproduce today's rendering exactly — every existing seat is a circle at 1.0 — so no
-- stored layout looks different or changes its publishability on the day this ships.
--
-- `color` is nullable on purpose: a layout drafted before this change has none, and FR-066 makes it a
-- PUBLISH requirement rather than a storage one, so drafts stay permissive as they already are.
ALTER TABLE sections ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE sections ADD COLUMN IF NOT EXISTS seat_shape TEXT NOT NULL DEFAULT 'circle';
ALTER TABLE sections ADD COLUMN IF NOT EXISTS seat_size_multiplier NUMERIC NOT NULL DEFAULT 1.0;

ALTER TABLE sections DROP CONSTRAINT IF EXISTS sections_seat_shape_check;
ALTER TABLE sections ADD CONSTRAINT sections_seat_shape_check
  CHECK (seat_shape IN ('circle', 'square'));

-- Backfill a colour for every section that already exists.
--
-- FR-066 makes a colourless section BLOCK publishing. Without this backfill, every layout drawn
-- before today would become unpublishable the moment this ships — a regression the amendment
-- explicitly promises not to cause (SC-019: pre-amendment layouts load and render unchanged).
-- New sections still arrive with NULL and are caught by validation, which is the intended UX:
-- the organizer picks a colour before publishing, but is never punished for work already done.
WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY layout_id ORDER BY id) - 1 AS pos
    FROM sections WHERE color IS NULL
)
UPDATE sections s SET color = (
  ARRAY['#4C9A6B', '#3E7CB1', '#C9762F', '#9B4D8E', '#B3453C']
)[(n.pos % 5) + 1]
  FROM numbered n WHERE n.id = s.id;

-- ---------- SHAPES AND FACILITY ICONS (FR-057..FR-063) ----------
-- Points ride on the element as an ordered [{x,y}, ...]; pos_x/pos_y/width/height stay populated as
-- the shape's BOUNDING BOX, so a reader that does not understand points still positions it sensibly.
-- No shape-point child table: this geometry is only ever read whole and written whole.
ALTER TABLE layout_elements ADD COLUMN IF NOT EXISTS points JSONB;

-- Widen the vocabulary the same additive way 0010_element_kinds.sql widened it: drop-if-exists, then
-- re-add over the UNION. Nothing that was valid becomes invalid, so no existing row or writer breaks.
ALTER TABLE layout_elements DROP CONSTRAINT IF EXISTS layout_elements_kind_check;
ALTER TABLE layout_elements ADD CONSTRAINT layout_elements_kind_check
  CHECK (kind IN (
    -- shipped vocabulary
    'stage', 'aisle', 'door', 'bar', 'label', 'area',
    -- hall outline and dividers
    'boundary', 'divider',
    -- facility icons
    'exit', 'restroom', 'food_drink', 'smoking', 'first_aid', 'lift_stairs', 'wheelchair'
  ));

-- NOTE: `showtimes.layout_snapshot` needs no migration. It is already JSONB and already the mechanism
-- that stops a layout edit reshaping a show that is selling; tables and shapes ride inside it, written
-- by apply.ts (FR-081).

COMMIT;
