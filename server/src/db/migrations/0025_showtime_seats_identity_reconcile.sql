BEGIN;

-- Re-apply the three snapshotted-identity columns on `showtime_seats`, in the spirit of
-- 0008_seatmap_reconcile.sql.
--
-- `0007_seatmap.sql:152-158` adds six snapshot columns: pos_x, pos_y, rotation, row_label,
-- seat_number, section_name. Some databases came out of that migration with only the first three.
-- The runner records a file as applied even when a statement raised one of the "already applied"
-- codes (42P07/42710/42P16), and because 0007 is one transaction, an early raise leaves the rest of
-- the file unexecuted while `schema_migrations` says it ran. Nothing afterwards re-checks it.
--
-- The three missing ones are not cosmetic. Every inventory-aware path reads or writes them:
--
--   * `tables.assertNoCommittedSeats` builds its refusal message from `ss.row_label` — so ANY table
--     edit (move, rotate, re-count, delete) raises 42703 and surfaces as a bare 500 `internal_error`;
--   * `catalog.write.generateSeatMap` INSERTs all three when a showtime's map is created;
--   * `catalog.repo.getSeatMap` and `layouts.repo.getShowtimeMap` SELECT them for the buyer's and the
--     organizer's map;
--   * `apply.ts` classifies a `relabel` against them, which is what makes "a sold seat may move but
--     may not be relabelled" enforceable at all (FR-028).
--
-- Idempotent, and a no-op on a database where 0007 completed.
ALTER TABLE showtime_seats ADD COLUMN IF NOT EXISTS row_label TEXT;
ALTER TABLE showtime_seats ADD COLUMN IF NOT EXISTS seat_number INT;
ALTER TABLE showtime_seats ADD COLUMN IF NOT EXISTS section_name TEXT;

-- Backfill from the layout for any map generated while the columns were absent, so no read has to
-- cope with a half-populated snapshot. Copies from `seats` because that is what the map was generated
-- from; from here the two may diverge, which is the whole point of the snapshot.
UPDATE showtime_seats ss
   SET row_label = s.row_label,
       seat_number = s.seat_number,
       section_name = (SELECT sec.name FROM sections sec WHERE sec.id = s.section_id)
  FROM seats s
 WHERE ss.seat_id = s.id AND ss.row_label IS NULL;

COMMIT;
