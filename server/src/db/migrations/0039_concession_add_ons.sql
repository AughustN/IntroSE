-- 0039_concession_add_ons.sql — Concession add-ons: bắp nước bought with the tickets (feature 014).
--
-- Depends on 0002_catalog.sql (events) and 0004_wallet_checkout.sql (reservations/orders).
--
-- Four tables, each answering one question the others must not:
--
--   concession_items        what the organizer sells — one menu per EVENT, offered on every
--                           public showtime of it. Unlimited stock by design (clarified scope):
--                           there is deliberately no sold/held counter here, because nothing can
--                           ever sell out and a counter nobody reads is a lie waiting to drift.
--
--   reservation_concessions what a buyer has put in their cart while a hold is live. Rows live
--                           and die with their reservations row — expiry needs no code here,
--                           because unlimited stock means a lapsed hold releases nothing.
--
--   order_concessions       what was PAID. Label and unit price are SNAPSHOTS at payment time;
--                           display never joins back to concession_items, so stopping sales or
--                           editing a price cannot rewrite history (014 FR-010/FR-014).
--
--   concession_vouchers     the ONE scannable proof per order carrying concessions. UNIQUE(order_id)
--                           makes "exactly one" a schema fact rather than an application hope; the
--                           code/hash pair mirrors tickets.barcode_value/qr_token_hash so the
--                           scanner treats both kinds of code the same way.
--
-- Quantities are bounded 1..10 IN THE SCHEMA: the cap is a product rule (014 FR-005), and a CHECK
-- is the one enforcer that cannot be forgotten by a future writer.

-- ---------- CONCESSION ITEMS ----------
-- The organizer-curated menu of one event. `stopped` = archived-but-resolvable, the ticket_tiers
-- move: hidden from buyers immediately, kept forever for the lines already sold against it.
CREATE TABLE IF NOT EXISTS concession_items (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  label TEXT NOT NULL,                                     -- buyer-facing Vietnamese name
  description TEXT,                                        -- optional short description
  price_amount BIGINT NOT NULL CHECK (price_amount >= 0),  -- whole VND đồng (STD-03)
  state TEXT NOT NULL DEFAULT 'listed'
    CHECK (state IN ('listed', 'stopped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Buyer-facing reads ask exactly one question: listed items of one visible event.
CREATE INDEX IF NOT EXISTS idx_concession_items_event
  ON concession_items(event_id) WHERE state = 'listed';

-- ---------- RESERVATION CONCESSIONS ----------
-- Cart lines inside a live hold. Replacement-set semantics from the API; UNIQUE keeps the set clean.
CREATE TABLE IF NOT EXISTS reservation_concessions (
  id BIGSERIAL PRIMARY KEY,
  reservation_id BIGINT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  concession_item_id BIGINT NOT NULL REFERENCES concession_items(id),
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 10),  -- FR-005 cap, in schema
  unit_price_amount BIGINT NOT NULL,                       -- add-time snapshot; checkout reprices (research D2)
  UNIQUE (reservation_id, concession_item_id)
);

CREATE INDEX IF NOT EXISTS idx_reservation_concessions_reservation
  ON reservation_concessions(reservation_id);

-- ---------- ORDER CONCESSIONS ----------
-- One immutable paid line. The snapshot columns are the ONLY thing display reads.
CREATE TABLE IF NOT EXISTS order_concessions (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  concession_item_id BIGINT NOT NULL REFERENCES concession_items(id),
  item_label TEXT NOT NULL,                                -- snapshot at payment
  unit_price_amount BIGINT NOT NULL,                       -- snapshot at payment
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 10),
  UNIQUE (order_id, concession_item_id)
);

CREATE INDEX IF NOT EXISTS idx_order_concessions_order ON order_concessions(order_id);

-- ---------- CONCESSION VOUCHERS ----------
-- Exactly one per order carrying concessions (UNIQUE below), minted inside the checkout transaction.
CREATE TABLE IF NOT EXISTS concession_vouchers (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,                               -- the QR payload (mirrors barcode_value)
  code_hash TEXT NOT NULL UNIQUE,                          -- sha256(code) at rest (mirrors qr_token_hash)
  status TEXT NOT NULL DEFAULT 'unredeemed'
    CHECK (status IN ('unredeemed', 'redeemed', 'void')),
  redeemed_at TIMESTAMPTZ,
  redeemed_by BIGINT REFERENCES users(id),                 -- the staff account that scanned
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
