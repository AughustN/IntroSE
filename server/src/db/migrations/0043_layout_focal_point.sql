-- An explicit focal point for a chart, so best-available ranks from where the event actually happens.
--
-- Depends on 0037 (orphan_rule), whose shape this follows exactly: a chart-level rule that governs
-- best-available, stored on `venue_layouts`, snapshotted onto the showtime, and read by the buyer.
--
-- Why: `focalPoint()` takes the stage's centre when there is a stage and THE CENTROID OF ALL SEATS
-- when there is not. That fallback keeps best-available working — which is why `focal_point_unset` is
-- a warning and not a refusal — but it quietly changes what "best" means, and there has been no way
-- to say otherwise. An arena's focal point is its pitch, not the middle of its four stands. A hall
-- whose stage is at one end but drawn without a stage element ranks outward from the middle of the
-- seating, offering the centre of the block ahead of the front rows.
--
-- NULLABLE, and null is the existing behaviour. Every chart drawn so far keeps ranking exactly as it
-- does today; the columns only give an organizer a way to state the answer rather than have it
-- inferred. There is no backfill and no default, because guessing a focal point for 800 existing
-- charts is the very inference this exists to replace.
--
-- Bounded by the same wall as every other coordinate (0041/0042), not by the frame.

ALTER TABLE venue_layouts ADD COLUMN IF NOT EXISTS focal_x INT;
ALTER TABLE venue_layouts ADD COLUMN IF NOT EXISTS focal_y INT;

DO $$ BEGIN
  ALTER TABLE venue_layouts ADD CONSTRAINT venue_layouts_focal_x_range
    CHECK (focal_x IS NULL OR focal_x BETWEEN -30000 AND 60000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE venue_layouts ADD CONSTRAINT venue_layouts_focal_y_range
    CHECK (focal_y IS NULL OR focal_y BETWEEN -30000 AND 60000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Both or neither: half a point is not a point, and every reader would have to invent the other half.
DO $$ BEGIN
  ALTER TABLE venue_layouts ADD CONSTRAINT venue_layouts_focal_pair
    CHECK ((focal_x IS NULL) = (focal_y IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
