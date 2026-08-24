-- Separate the layout FRAME from the coordinate WALL, and move the wall out of the organizer's view.
--
-- Depends on 0040_widen_layout_space.sql (which set the range to 0..30,000).
--
-- Why: one number was doing two jobs. `LAYOUT_SPACE` was both the area the editor frames — what it
-- pins its viewBox to, and what it derives its zoom-out limit from — and the furthest a block may be
-- dragged. Because they were the same number, the wall sat exactly at the edge of the view: the
-- dashed boundary was on screen whenever the organizer zoomed out, and a drag toward any edge ended
-- in a visible stop with no room behind it.
--
-- The frame stays 30,000 (nothing about what the editor shows or what a buyer's `space` reports
-- changes). The wall moves to -30,000..60,000 — one full frame of slack on every side, which puts it
-- outside the visible rectangle at every zoom the editor can reach.
--
-- Negative coordinates become legal, and that is what buys the slack above and to the left of the
-- origin. The frame is unchanged and content is unmoved, so nothing on screen shifts.
--
-- Safe in the direction it moves. This only RELAXES the constraint, in both directions, so no row
-- that satisfied the old range can fail the new one — every coordinate stored today is 0..30,000.
-- Nothing is rewritten and no data is touched. (Measured before writing this: across `seats` the
-- extremes are x≤23,200 and y≤7,500, so the live data is not near either old edge.)
--
-- Keep in step with, or the three disagree and the API accepts what the database then rejects:
--   * `LAYOUT_MIN` / `LAYOUT_MAX` in shared/catalog/seatmap-validate.ts  (client + validation)
--   * `LAYOUT_MIN` / `LAYOUT_MAX` in server/src/config.ts                 (server, env-overridable)
--
-- `showtime_seats.pos_x/pos_y` still deliberately carry no such CHECK (they were added without one
-- in 0007); the write paths clamp through `clampCoord` regardless.

ALTER TABLE seats DROP CONSTRAINT IF EXISTS seats_pos_x_range;
ALTER TABLE seats DROP CONSTRAINT IF EXISTS seats_pos_y_range;

DO $$ BEGIN
  ALTER TABLE seats ADD CONSTRAINT seats_pos_x_range CHECK (pos_x BETWEEN -30000 AND 60000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE seats ADD CONSTRAINT seats_pos_y_range CHECK (pos_y BETWEEN -30000 AND 60000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
