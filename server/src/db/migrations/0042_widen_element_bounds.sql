-- Bring `layout_elements` up to the coordinate wall that `seats` already has.
--
-- Depends on 0041_layout_wall.sql.
--
-- 0040 widened the space to 30,000 and 0041 moved the wall to -30,000..60,000, but both only touched
-- `seats`. `layout_elements` — every stage, aisle, door, bar, label, shape and capacity zone — was
-- left on the original 0..10,000 CHECK from 0007.
--
-- That is a LIVE bug, not a tidy-up. The editor frames 0..30,000, so an organizer dragging a stage
-- into the right-hand two thirds of their own canvas gets a 500 from the save, while the seat blocks
-- beside it save fine. It went unnoticed only because every chart drawn so far happens to sit inside
-- the old square (the widest decoration in the database is at x = 9,850).
--
-- Same range and same reasoning as `seats`: the frame is what the editor looks at, the wall is how
-- far a coordinate may go, and the two are not the same number (see 0041).
--
-- Safe in the direction it moves. This only RELAXES the constraint, in both directions, so no row
-- that satisfied the old range can fail the new one.
--
-- The original constraints were created unnamed by a column-level CHECK in 0007, so Postgres named
-- them `layout_elements_pos_x_check` / `_pos_y_check`. Dropped by those names, re-added under the
-- explicit `_range` names the rest of the schema uses.

ALTER TABLE layout_elements DROP CONSTRAINT IF EXISTS layout_elements_pos_x_check;
ALTER TABLE layout_elements DROP CONSTRAINT IF EXISTS layout_elements_pos_y_check;
ALTER TABLE layout_elements DROP CONSTRAINT IF EXISTS layout_elements_pos_x_range;
ALTER TABLE layout_elements DROP CONSTRAINT IF EXISTS layout_elements_pos_y_range;

DO $$ BEGIN
  ALTER TABLE layout_elements ADD CONSTRAINT layout_elements_pos_x_range CHECK (pos_x BETWEEN -30000 AND 60000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE layout_elements ADD CONSTRAINT layout_elements_pos_y_range CHECK (pos_y BETWEEN -30000 AND 60000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
