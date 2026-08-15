BEGIN;

-- Designer v2: the "nên có" half of the Seats.io feature list.
--
-- Additive only, and every default reproduces today's behaviour exactly, so nothing already drawn
-- looks different or becomes unpublishable on the day this ships. ADD COLUMN IF NOT EXISTS
-- throughout: the migration runner does NOT treat 42701 (duplicate column) as "already applied".

-- ---------- AREAS SOLD BY CAPACITY ----------
-- An `area` element records how many standing positions were generated inside it, so re-shaping the
-- polygon can regenerate the same headcount rather than making the organizer recount. Null on every
-- other kind, and on areas drawn before this.
ALTER TABLE layout_elements ADD COLUMN IF NOT EXISTS capacity INT;

-- ---------- ACCESSIBLE SEATS ----------
-- A property of the SEAT, not of a decorative icon: the existing `wheelchair` element kind marks
-- where a facility is, which is a different claim from "this seat is usable by a wheelchair user".
-- Snapshotted onto the bookable row like every other displayed property, so re-flagging a chart
-- cannot change what a sold ticket promised.
ALTER TABLE seats ADD COLUMN IF NOT EXISTS is_accessible BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE showtime_seats ADD COLUMN IF NOT EXISTS is_accessible BOOLEAN NOT NULL DEFAULT false;

-- ---------- TABLE BOOKING MODE ----------
-- 'whole_table' is a SELECTION rule, not a new kind of inventory: choosing one seat of the table
-- selects them all, and feature 003 still holds N ordinary seat rows. Anything else would be a second
-- reservation shape, with its own concurrency work and its own double-sell risk.
ALTER TABLE layout_tables ADD COLUMN IF NOT EXISTS booking_mode TEXT NOT NULL DEFAULT 'per_seat';
ALTER TABLE layout_tables DROP CONSTRAINT IF EXISTS layout_tables_booking_mode_check;
ALTER TABLE layout_tables ADD CONSTRAINT layout_tables_booking_mode_check
  CHECK (booking_mode IN ('per_seat', 'whole_table'));

-- The buyer needs the grouping to honour that rule, and it must come from the SNAPSHOT rather than a
-- live join: re-arranging a chart may not silently regroup a show that is already selling. No FK —
-- this is a frozen copy, and the table it names may legitimately be deleted later.
ALTER TABLE showtime_seats ADD COLUMN IF NOT EXISTS table_id BIGINT;
ALTER TABLE showtime_seats ADD COLUMN IF NOT EXISTS table_booking_mode TEXT;

-- ---------- REFERENCE CHART ----------
-- A SECOND image, and the distinction from `background_*` is the point: the background is what the
-- BUYER may see behind the seats; the reference is the venue's real floor plan or CAD export that the
-- organizer traces over while drawing. It is never snapshotted and never leaves the editor, so it has
-- no `_public` flag — there is nothing to expose.
ALTER TABLE venue_layouts ADD COLUMN IF NOT EXISTS reference_url TEXT;
ALTER TABLE venue_layouts ADD COLUMN IF NOT EXISTS reference_scale NUMERIC(6,3) NOT NULL DEFAULT 1;
ALTER TABLE venue_layouts ADD COLUMN IF NOT EXISTS reference_offset_x INT NOT NULL DEFAULT 0;
ALTER TABLE venue_layouts ADD COLUMN IF NOT EXISTS reference_offset_y INT NOT NULL DEFAULT 0;
ALTER TABLE venue_layouts ADD COLUMN IF NOT EXISTS reference_opacity NUMERIC(3,2) NOT NULL DEFAULT 0.5;

COMMIT;
