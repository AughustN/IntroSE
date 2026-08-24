-- Widen the seat-map coordinate space from 0–10,000 to 0–30,000 on each axis.
--
-- Why: the old square was small enough that an organizer laying a room out left-to-right met the
-- wall while most of the map went unused, and the editor stops a drag AT that wall on purpose —
-- `allowedDelta` in documentOps.ts — because letting it through stacks every out-of-range seat onto
-- the boundary point. Nine times the area removes the squeeze. A unit still means what it meant: the
-- nominal seat stays 100 units, so spacing, overlap detection and every stored coordinate are
-- unchanged in meaning as well as in value.
--
-- Safe in the direction it moves. This only RELAXES the constraint, so no row that satisfies the old
-- range can fail the new one — every coordinate already stored is ≤ 10,000 and stays valid. Nothing
-- is rewritten and no data is touched.
--
-- Keep in step with, or the three disagree and the API accepts what the database then rejects:
--   * `LAYOUT_SPACE` in shared/catalog/seatmap-validate.ts  (client + validation)
--   * `LAYOUT_SPACE` in server/src/config.ts                 (server, env-overridable)
--
-- `showtime_seats.pos_x/pos_y` deliberately carry no such CHECK (they were added without one in
-- 0007) and so need no change here; the write paths clamp through `clampCoord` regardless.

ALTER TABLE seats DROP CONSTRAINT IF EXISTS seats_pos_x_range;
ALTER TABLE seats DROP CONSTRAINT IF EXISTS seats_pos_y_range;

DO $$ BEGIN
  ALTER TABLE seats ADD CONSTRAINT seats_pos_x_range CHECK (pos_x BETWEEN 0 AND 30000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE seats ADD CONSTRAINT seats_pos_y_range CHECK (pos_y BETWEEN 0 AND 30000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
