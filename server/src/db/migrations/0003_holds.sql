-- 0003_holds.sql — Seat holds & reservations (feature 003).
--
-- Adds the checkout-session layer on top of 002's showtime_seats / ticket_tiers. The seat rows
-- themselves are unchanged: this feature only drives their status (available → held → available)
-- and ticket_tiers.reserved_quantity, both under row locks (see docs/Analysis_Design/
-- SCHEMA_DATABASE.md § Seat Concurrency Requirement).

-- ---------- RESERVATIONS ----------
-- One in-progress checkout session for one showtime, created at the FIRST hold (hold-on-select).
-- Seated OR general admission, never mixed (a showtime is one or the other).
CREATE TABLE IF NOT EXISTS reservations (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),        -- login required to hold (FR-001)
  showtime_id BIGINT NOT NULL REFERENCES showtimes(id),
  expires_at TIMESTAMPTZ NOT NULL,                     -- one clock for every seat in the reservation
  status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'converted', 'cancelled')),
  extended_once BOOLEAN NOT NULL DEFAULT false,        -- one-time top-up grace guard (D2 amendment)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()        -- window origin: expires_at <= created_at + 14 min
);

-- Drives the expiry sweep (REL-02).
CREATE INDEX IF NOT EXISTS idx_reservations_expiry ON reservations(status, expires_at);

-- At most one active reservation per (user, showtime): a further hold joins it rather than opening
-- a second one (FR-011, R-4). Enforced by the database, not by check-then-write.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reservation_active
  ON reservations(user_id, showtime_id) WHERE status = 'active';

-- ---------- RESERVATION ITEMS ----------
-- One line: a specific held seat (seated) or a tier + quantity (general admission).
CREATE TABLE IF NOT EXISTS reservation_items (
  id BIGSERIAL PRIMARY KEY,
  reservation_id BIGINT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  ticket_tier_id BIGINT NOT NULL REFERENCES ticket_tiers(id),
  showtime_seat_id BIGINT REFERENCES showtime_seats(id),   -- NULL for GA (quantity-based)
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_amount BIGINT NOT NULL,                       -- VND đồng, snapshot at hold time (D1)
  UNIQUE (reservation_id, showtime_seat_id)                -- a seat appears once per reservation
);

CREATE INDEX IF NOT EXISTS idx_reservation_items_reservation ON reservation_items(reservation_id);
CREATE INDEX IF NOT EXISTS idx_reservation_items_seat ON reservation_items(showtime_seat_id);
