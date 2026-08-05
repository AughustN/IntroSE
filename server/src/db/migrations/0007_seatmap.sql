-- 0007_seatmap.sql — Seat map designer (feature 005).
--
-- Introduces the LAYOUT layer between venue and showtime, gives every seat integer geometry, and
-- makes a showtime's generated map a SNAPSHOT of its layout rather than a live reference.
--
-- Migration safety: `seats.id` is referenced by `showtime_seats`, and therefore transitively by sold
-- tickets. Seats and sections are RE-PARENTED IN PLACE — a column is added and a constraint swapped.
-- No seat row is ever recreated (research R-1).

-- ---------- VENUE LAYOUTS ----------
-- One named arrangement of a venue. A venue owns several; a seated showtime picks one.
-- Ownership resolves through venues.created_by (SEC-04) — layouts are never shared between organizers.
CREATE TABLE IF NOT EXISTS venue_layouts (
  id BIGSERIAL PRIMARY KEY,
  venue_id BIGINT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  is_template BOOLEAN NOT NULL DEFAULT false,
  -- Optimistic concurrency: a save carrying a stale version is refused (FR-015).
  version INT NOT NULL DEFAULT 1,
  -- Floor plan: a BACKGROUND LAYER ONLY. Never creates a seat, never determines a status (FR-020).
  width INT NOT NULL DEFAULT 10000,
  height INT NOT NULL DEFAULT 10000,
  background_url TEXT,
  background_scale NUMERIC(6,3) NOT NULL DEFAULT 1,   -- multiplier; the API publishes per-mille
  background_offset_x INT NOT NULL DEFAULT 0,
  background_offset_y INT NOT NULL DEFAULT 0,
  background_opacity NUMERIC(3,2) NOT NULL DEFAULT 0.5,  -- 0–1 fraction; the API publishes 0–100
  background_public BOOLEAN NOT NULL DEFAULT false,   -- FR-026, default off
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venue_id, name)
);

CREATE INDEX IF NOT EXISTS idx_venue_layouts_venue ON venue_layouts(venue_id);

-- ---------- LAYOUT ELEMENTS ----------
-- Non-sellable decoration. A SEPARATE TABLE on purpose: nothing here can be reached by an inventory
-- query, so a stage can never become a ticket (FR-017).
CREATE TABLE IF NOT EXISTS layout_elements (
  id BIGSERIAL PRIMARY KEY,
  layout_id BIGINT NOT NULL REFERENCES venue_layouts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('stage', 'aisle', 'door', 'bar', 'label', 'area')),
  pos_x INT NOT NULL CHECK (pos_x BETWEEN 0 AND 10000),
  pos_y INT NOT NULL CHECK (pos_y BETWEEN 0 AND 10000),
  width INT NOT NULL CHECK (width > 0),
  height INT NOT NULL CHECK (height > 0),
  rotation SMALLINT NOT NULL DEFAULT 0 CHECK (rotation BETWEEN 0 AND 359),
  label TEXT CHECK (label IS NULL OR length(label) <= 60)
);

CREATE INDEX IF NOT EXISTS idx_layout_elements_layout ON layout_elements(layout_id);

-- ---------- RE-PARENT SECTIONS AND SEATS ----------
ALTER TABLE sections ADD COLUMN IF NOT EXISTS layout_id BIGINT REFERENCES venue_layouts(id) ON DELETE CASCADE;

ALTER TABLE seats ADD COLUMN IF NOT EXISTS layout_id BIGINT REFERENCES venue_layouts(id) ON DELETE CASCADE;
ALTER TABLE seats ADD COLUMN IF NOT EXISTS pos_x INT;
ALTER TABLE seats ADD COLUMN IF NOT EXISTS pos_y INT;
ALTER TABLE seats ADD COLUMN IF NOT EXISTS rotation SMALLINT NOT NULL DEFAULT 0;

-- ---------- BACKFILL: one default layout per venue that already has content ----------
-- The seeded grid IS what buyers see today, so an un-edited venue looks unchanged the day this ships
-- and no existing showtime's map breaks (research R-9).
INSERT INTO venue_layouts (venue_id, name, status)
SELECT v.id, 'Sơ đồ mặc định', 'published'
  FROM venues v
 WHERE (EXISTS (SELECT 1 FROM sections s WHERE s.venue_id = v.id)
     OR EXISTS (SELECT 1 FROM seats se WHERE se.venue_id = v.id))
   AND NOT EXISTS (SELECT 1 FROM venue_layouts l WHERE l.venue_id = v.id)
ON CONFLICT (venue_id, name) DO NOTHING;

UPDATE sections s
   SET layout_id = l.id
  FROM venue_layouts l
 WHERE l.venue_id = s.venue_id AND s.layout_id IS NULL;

UPDATE seats se
   SET layout_id = l.id
  FROM venue_layouts l
 WHERE l.venue_id = se.venue_id AND se.layout_id IS NULL;

-- Seed positions from the existing row/number grid: distinct row labels ascending give the row index,
-- seat_number gives the column. Spacing is 1.5 seat diameters; the block is centred horizontally and
-- sits below where a stage would be. Clamped into the 0–10000 space so the CHECKs below always hold.
WITH grid AS (
  SELECT se.id,
         DENSE_RANK() OVER (PARTITION BY se.layout_id ORDER BY se.row_label) AS row_idx,
         se.seat_number,
         MAX(se.seat_number) OVER (PARTITION BY se.layout_id) AS max_num
    FROM seats se
   WHERE se.pos_x IS NULL OR se.pos_y IS NULL
)
UPDATE seats se
   SET pos_x = GREATEST(0, LEAST(10000, (5000 + (g.seat_number - (g.max_num + 1) / 2.0) * 150)::int)),
       pos_y = GREATEST(0, LEAST(10000, (1200 + (g.row_idx - 1) * 150)::int))
  FROM grid g
 WHERE g.id = se.id;

-- A seat whose venue had no layout row (no sections, no venue match) is left unpositioned and would
-- fail the NOT NULL below; give it the centre rather than fail the migration.
UPDATE seats SET pos_x = 5000 WHERE pos_x IS NULL;
UPDATE seats SET pos_y = 5000 WHERE pos_y IS NULL;

-- ---------- CONSTRAINTS ----------
ALTER TABLE seats ALTER COLUMN pos_x SET NOT NULL;
ALTER TABLE seats ALTER COLUMN pos_y SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE seats ADD CONSTRAINT seats_pos_x_range CHECK (pos_x BETWEEN 0 AND 10000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE seats ADD CONSTRAINT seats_pos_y_range CHECK (pos_y BETWEEN 0 AND 10000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE seats ADD CONSTRAINT seats_rotation_range CHECK (rotation BETWEEN 0 AND 359);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Seat uniqueness moves from venue-wide to PER SECTION (FR-003), so two sections in one venue may
-- both hold "row A seat 1" — a layout real venues use constantly. section_id stays nullable, so a
-- sectionless seat is representable in draft and caught by validation, not by the constraint.
ALTER TABLE seats DROP CONSTRAINT IF EXISTS seats_venue_id_row_label_seat_number_key;
DO $$ BEGIN
  ALTER TABLE seats ADD CONSTRAINT seats_section_row_number_key UNIQUE (section_id, row_label, seat_number);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE sections DROP CONSTRAINT IF EXISTS sections_venue_id_name_key;
DO $$ BEGIN
  ALTER TABLE sections ADD CONSTRAINT sections_layout_name_key UNIQUE (layout_id, name);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_seats_layout ON seats(layout_id);
CREATE INDEX IF NOT EXISTS idx_sections_layout ON sections(layout_id);

-- A section's venue is now its layout's venue; a seat's likewise.
ALTER TABLE sections DROP COLUMN IF EXISTS venue_id;
ALTER TABLE seats DROP COLUMN IF EXISTS venue_id;

-- ---------- SNAPSHOT ----------
-- Generating a showtime's map COPIES the layout into the showtime. A later layout edit reaches it
-- only through an explicit, previewed re-apply (FR-005, FR-027a).
ALTER TABLE showtimes ADD COLUMN IF NOT EXISTS layout_id BIGINT REFERENCES venue_layouts(id);
ALTER TABLE showtimes ADD COLUMN IF NOT EXISTS layout_snapshot JSONB;

-- The snapshot covers EVERYTHING the buyer sees about a seat, not just where it is drawn: position,
-- rotation, and the seat's displayed identity (row, number, section).
--
-- Identity has to be snapshotted too, or FR-028 is unenforceable. Editing a layout is deliberately
-- never gated on inventory (FR-027) — so if `row_label` stayed only on the shared `seats` row, an
-- organizer renaming a seat in the layout would silently relabel a ticket somebody already bought.
-- Copying it here is what lets the sold-seat rule ("position may change, identity may not") actually
-- hold. It also removes a join from the buyer read.
ALTER TABLE showtime_seats ADD COLUMN IF NOT EXISTS pos_x INT;
ALTER TABLE showtime_seats ADD COLUMN IF NOT EXISTS pos_y INT;
ALTER TABLE showtime_seats ADD COLUMN IF NOT EXISTS rotation SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE showtime_seats ADD COLUMN IF NOT EXISTS row_label TEXT;
ALTER TABLE showtime_seats ADD COLUMN IF NOT EXISTS seat_number INT;
ALTER TABLE showtime_seats ADD COLUMN IF NOT EXISTS section_name TEXT;

-- Backfill the snapshot for showtimes that already have a generated map, so no code path has to
-- special-case a showtime that predates this feature.
UPDATE showtime_seats ss
   SET pos_x = se.pos_x, pos_y = se.pos_y, rotation = se.rotation,
       row_label = se.row_label, seat_number = se.seat_number,
       section_name = (SELECT sec.name FROM sections sec WHERE sec.id = se.section_id)
  FROM seats se
 WHERE se.id = ss.seat_id AND ss.pos_x IS NULL;

UPDATE showtimes st
   SET layout_id = l.id,
       layout_snapshot = jsonb_build_object(
         'elements', '[]'::jsonb,
         'planUrl', NULL,
         'planScale', 1000,
         'planOffsetX', 0,
         'planOffsetY', 0,
         'planOpacity', 50,
         'planVisibleToBuyers', false
       )
  FROM venue_layouts l
 WHERE l.venue_id = st.venue_id
   AND st.layout_id IS NULL
   AND EXISTS (SELECT 1 FROM showtime_seats ss WHERE ss.showtime_id = st.id);
