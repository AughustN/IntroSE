-- 0036 — Companion seats (ghế đi kèm).
--
-- A wheelchair seat (is_accessible) is reserved for a wheelchair user; the seat beside them is
-- reserved for their companion. This migration stores the pairing the editor made:
--
--   seats.companion_seat_id          — the authoring fact. NULL unless this particular seat
--                                      accompanies a wheelchair seat.
--   showtime_seats.companion_seat_id — the per-showtime snapshot, copied at generation time the
--                                      way row/number/category are (FR-005). After a snapshot the
--                                      showtime owns its map; a later edit to the layout's pairing
--                                      reaches it only through an explicit re-apply.
--
-- Both columns are self-referencing and nullable with ON DELETE SET NULL, so deleting one seat
-- never deletes its pair — an ordinary seat that lost its partner simply becomes an ordinary seat,
-- and the validation gate reports the dangling pairing for the organizer to fix.
--
-- The application layer enforces at most one seat may name each accessible seat (the CHECK
-- constraint cannot see the partner's is_accessible flag within a single column), so this one
-- constraint is ALL the database can express without a trigger — left to the shared validator.
BEGIN;

ALTER TABLE seats ADD COLUMN IF NOT EXISTS companion_seat_id BIGINT
  REFERENCES seats(id) ON DELETE SET NULL;

ALTER TABLE showtime_seats ADD COLUMN IF NOT EXISTS companion_seat_id BIGINT
  REFERENCES showtime_seats(id) ON DELETE SET NULL;

COMMIT;
