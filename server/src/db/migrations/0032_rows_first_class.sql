-- 0032 — A row becomes a thing, sections gain an order, and a sold seat can be archived.
--
-- Three additions the specification asks for (§9, §10, §18, §42, §43, §44, §47), all of them additive.
-- Nothing below changes the meaning of a column that already exists, and every new column is nullable
-- or defaulted, so a database that has not run this migration and one that has both sell identically.
--
--
-- 1. ROWS (§10, §47)
--
-- A row has only ever existed as a STRING repeated on each of its seats. That is enough to draw and to
-- sell, and not enough to operate on: "insert a row above B", "reverse row C", "rename row D" all have
-- to be expressed as a search-and-replace across seats that happen to share a label, and a row with no
-- seats in it cannot be represented at all.
--
-- `seats.row_label` STAYS, and stays authoritative. It is the column `uq_seat_label` is built on and
-- the one `showtime_seats.row_label` is snapshotted from, so it is load-bearing for both uniqueness and
-- for every ticket already issued. `row_id` is a parallel handle for authoring, not a replacement:
--
--     seats.id        the identity. Bookings point here. Never changes. (§42 Rule 1, Rule 6)
--     seats.row_label what the row is CALLED. Changes when the organizer renumbers.
--     seats.row_id    which row it BELONGS TO. Survives a rename; that is the point.
--
-- Nullable on purpose. A seat whose row has not been backfilled still sells, and the projection falls
-- back to grouping by label exactly as it does today.
--
--
-- 2. DISPLAY ORDER (§43, §44, §45)
--
-- The spec is emphatic that deleting Block A must not turn Block B into Block A, and that drag-to-
-- reorder must move nothing but a display position. Neither was expressible: order came from `id`, so
-- ordering and identity were the same number. `display_order` separates them.
--
--
-- 3. ARCHIVE, NOT DELETE (§18, §42 Rule 7)
--
-- A seat a showtime has generated from currently cannot be dropped by a save — `showtime_seats.seat_id`
-- has no ON DELETE clause, so the save is refused with `seat_in_use`. That protects the booking, which
-- is the important half, but it also means an organizer who wants a row gone is simply stuck.
--
-- `archived_at` gives the third answer the spec asks for: the seat leaves the chart, keeps its id, its
-- bookings and its history, and stops being offered for sale. The refusal stays as the fallback for
-- anything that cannot be archived.

BEGIN;

CREATE TABLE IF NOT EXISTS layout_rows (
  id            BIGSERIAL PRIMARY KEY,
  layout_id     BIGINT NOT NULL REFERENCES venue_layouts(id) ON DELETE CASCADE,
  -- Nullable, and SET NULL rather than CASCADE, for the same reason `seats.section_id` is: a section-
  -- less row is a legal draft state that validation reports, not a constraint violation.
  section_id    BIGINT REFERENCES sections(id) ON DELETE SET NULL,
  label         TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per label within a section, matching the scope `uq_seat_label` already enforces on seats.
-- NULLs are distinct in Postgres, so section-less rows do not collide with each other here — the same
-- looseness `seats` has, and the same validation catches it.
CREATE UNIQUE INDEX IF NOT EXISTS layout_rows_label_idx
  ON layout_rows (layout_id, section_id, label);

CREATE INDEX IF NOT EXISTS layout_rows_layout_idx ON layout_rows (layout_id, display_order);

ALTER TABLE seats    ADD COLUMN IF NOT EXISTS row_id BIGINT REFERENCES layout_rows(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS seats_row_idx ON seats (row_id);

ALTER TABLE sections ADD COLUMN IF NOT EXISTS display_order INT NOT NULL DEFAULT 0;

ALTER TABLE seats    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE sections ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Partial index: nearly every seat is live, so the archived ones are cheap to find and the live ones
-- cost nothing to filter.
CREATE INDEX IF NOT EXISTS seats_archived_idx ON seats (layout_id) WHERE archived_at IS NOT NULL;

-- --- Backfill -----------------------------------------------------------------------------------
--
-- One `layout_rows` row per distinct (layout_id, section_id, row_label) already in `seats`, then point
-- each seat at its own. Idempotent in both halves: the insert skips what the unique index already has,
-- and the update only touches seats whose `row_id` is still null, so re-running this migration on a
-- database that has had it is a no-op rather than a re-shuffle.
--
-- `display_order` comes from the label's position in its section, which reproduces the order the editor
-- draws today. It is a starting value, not a rule — the organizer reorders from here.

INSERT INTO layout_rows (layout_id, section_id, label, display_order)
SELECT s.layout_id,
       s.section_id,
       s.row_label,
       (ROW_NUMBER() OVER (PARTITION BY s.layout_id, s.section_id ORDER BY MIN(s.id)))::int - 1
  FROM seats s
 GROUP BY s.layout_id, s.section_id, s.row_label
ON CONFLICT DO NOTHING;

UPDATE seats s
   SET row_id = r.id
  FROM layout_rows r
 WHERE s.row_id IS NULL
   AND r.layout_id = s.layout_id
   AND r.label = s.row_label
   AND r.section_id IS NOT DISTINCT FROM s.section_id;

COMMIT;
