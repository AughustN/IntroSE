-- Index the foreign keys that cascade-deletes have to check, so deleting a chart stops being slow.
--
-- SYMPTOM: deleting a seat map took ten seconds and more, and got worse as the platform sold tickets.
--
-- CAUSE: `deleteLayout` is one statement — `DELETE FROM venue_layouts WHERE id = $1` — and every bit
-- of the work is in the cascade. `seats.layout_id` is ON DELETE CASCADE, so the seats go with the
-- chart; but before Postgres may remove a seat it must prove nothing still references it, and
-- `showtime_seats.seat_id` is ON DELETE NO ACTION with NO INDEX on it.
--
-- With no index that proof is a sequential scan of the whole of `showtime_seats`, once PER SEAT.
-- Measured on the live branch, EXPLAIN ANALYZE of the exact check the planner runs:
--
--     Seq Scan on showtime_seats  (rows removed by filter: 105756)  Execution Time: 8.661 ms
--
-- A 1,952-seat stadium chart therefore costs 1952 x 8.66 ms — about 17 seconds — and the figure grows
-- with every ticket the platform ever sells, because the scan is over the whole table rather than
-- over the rows that could possibly match.
--
-- The UNIQUE (showtime_id, seat_id) constraint from 0002 does not help: its leading column is
-- `showtime_id`, so it cannot answer "which rows have this seat_id?".
--
-- WHICH KEYS ARE INDEXED HERE, and which are deliberately left alone.
--
-- Every index costs something on write, so this is not "index every foreign key". These four are the
-- ones whose child table is large or grows with inventory:
--
--   showtime_seats.seat_id     105,756 rows and growing with every sale — the whole cause above
--   ticket_tiers.category_id     4,961 rows, checked whenever a save drops a price class
--   seats.companion_seat_id      4,424 rows, checked once per seat deleted, so it multiplies too
--   showtimes.layout_id          2,750 rows, checked on delete AND read by `layoutInUse` on every
--                                delete attempt, which is a sequential scan today
--
-- Left unindexed on purpose: `layout_rows.section_id` (128 rows), `layout_elements.category_id` (9),
-- `layout_tables.category_id` and `layout_tables.section_id` (0). These are checked per deleted
-- parent as well, but the tables are small and bounded by the size of one chart rather than by how
-- much the platform has sold. Worth revisiting if a venue ever has thousands of rows or tables.

CREATE INDEX IF NOT EXISTS idx_showtime_seats_seat ON showtime_seats(seat_id);

CREATE INDEX IF NOT EXISTS idx_ticket_tiers_category ON ticket_tiers(category_id)
  WHERE category_id IS NOT NULL;

-- Partial for the same reason: most seats accompany nothing, so the index covers only the rows a
-- companion lookup could ever match.
CREATE INDEX IF NOT EXISTS idx_seats_companion ON seats(companion_seat_id)
  WHERE companion_seat_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_showtimes_layout ON showtimes(layout_id)
  WHERE layout_id IS NOT NULL;
