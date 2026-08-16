-- Migration 0033 — Advertising packages sold to organizers.
--
-- Depends on 0001_auth.sql (users, organizers), 0002_catalog.sql (events) and
-- 0004_wallet_checkout.sql (wallets, wallet_transactions).
--
-- An organizer buys a package to have one of their events promoted on the landing page. The two
-- placements are the two slots the landing page already has: the trailer that plays in the hero
-- (`hero_trailer`, `HeroVideo`) and the "sự kiện hot" rail (`hot_events`, `EventTicker`). A package
-- is a COMBO of placements plus a run length, which is why the placements live in an array on the
-- package rather than as one boolean column per slot — adding a third slot must not be a schema
-- change to every row that has ever been sold.
--
-- Money here is whole VND đồng, as everywhere else in this schema.
BEGIN;

-- ---------- THE CATALOGUE ----------
-- What is for sale. Small, admin-owned, and effectively static: three rows seeded at the bottom of
-- this file. `is_active` retires a package without deleting it, because a retired package still has
-- to render on the purchases that bought it.
CREATE TABLE IF NOT EXISTS ad_packages (
  id             BIGSERIAL PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  name_vi        TEXT NOT NULL,
  description_vi TEXT,
  price_amount   BIGINT NOT NULL CHECK (price_amount > 0),
  duration_days  INT NOT NULL CHECK (duration_days > 0),
  -- The combo. Constrained to the slots the landing page can actually honour, so a typo cannot
  -- sell an organizer a placement that renders nowhere.
  placements     TEXT[] NOT NULL
                   CHECK (array_length(placements, 1) >= 1
                          AND placements <@ ARRAY['hero_trailer', 'hot_events']::TEXT[]),
  is_active      BOOLEAN NOT NULL DEFAULT true,
  display_order  INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_packages_active ON ad_packages(is_active, display_order, id);

-- ---------- WHAT WAS BOUGHT ----------
-- One row per purchase. Price and placements are SNAPSHOTTED off the package for the same reason
-- `tickets.price_cents` is snapshotted off the tier: an admin re-pricing a package must not restate
-- what every past buyer paid, and must not silently change what a running campaign is entitled to.
CREATE TABLE IF NOT EXISTS ad_purchases (
  id            BIGSERIAL PRIMARY KEY,
  organizer_id  BIGINT NOT NULL REFERENCES organizers(id),
  event_id      BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  package_id    BIGINT NOT NULL REFERENCES ad_packages(id),
  purchased_by  BIGINT NOT NULL REFERENCES users(id),
  price_amount  BIGINT NOT NULL CHECK (price_amount > 0),
  placements    TEXT[] NOT NULL CHECK (array_length(placements, 1) >= 1),
  -- 'active' is the only state that renders. 'cancelled' is a refunded campaign and must leave
  -- platform revenue; a campaign that has simply run out stays 'active' and falls out of the
  -- placement feed by `ends_at`, so expiry needs no sweeper to be correct.
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'cancelled')),
  starts_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at       TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_ad_purchases_organizer ON ad_purchases(organizer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_purchases_revenue ON ad_purchases(created_at, status);
-- The landing page's read: which campaigns are running right now.
CREATE INDEX IF NOT EXISTS idx_ad_purchases_live ON ad_purchases(status, starts_at, ends_at);

-- At most one campaign running per event at a time. Two overlapping purchases for the same event
-- would put it in the hot rail twice and bill the organizer for a placement they already hold.
--
-- Superseded by `ad_purchases_no_overlap` in 0034: a partial unique index cannot tell "running" from
-- "finished" — an expired campaign keeps `status = 'active'` here — so this forbade re-advertising
-- an event ever again rather than forbidding an overlap. Left in place because 0034 drops it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_purchases_live_per_event
  ON ad_purchases(event_id) WHERE status = 'active';

-- ---------- PAYING FOR IT ----------
-- The organizer pays from the same wallet an attendee buys tickets from, so an ad purchase is a
-- fourth shape of ledger row. 0004 pinned every kind to an `order_id`; an ad purchase has no order,
-- so the shape constraint is replaced rather than extended.
ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS ad_purchase_id BIGINT REFERENCES ad_purchases(id);

-- The two unnamed CHECKs 0004 created: Postgres names a column-level check
-- `<table>_<column>_check` and the sole table-level check `<table>_check`.
ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_kind_check;
ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_check;

ALTER TABLE wallet_transactions
  ADD CONSTRAINT wallet_transactions_kind_check
  CHECK (kind IN ('topup', 'purchase', 'refund', 'ad_purchase', 'ad_refund'));

-- Each kind still has exactly one shape; the two new ones point at the ad purchase and at nothing
-- else, which is what keeps an ad debit out of every ticket-revenue query that joins on `order_id`.
ALTER TABLE wallet_transactions
  ADD CONSTRAINT wallet_transactions_shape_check
  CHECK ((kind = 'topup'       AND amount > 0 AND payment_transaction_id IS NOT NULL AND order_id IS NULL     AND ad_purchase_id IS NULL)
      OR (kind = 'purchase'    AND amount < 0 AND order_id IS NOT NULL AND ad_purchase_id IS NULL)
      OR (kind = 'refund'      AND amount > 0 AND order_id IS NOT NULL AND ad_purchase_id IS NULL)
      OR (kind = 'ad_purchase' AND amount < 0 AND ad_purchase_id IS NOT NULL AND order_id IS NULL)
      OR (kind = 'ad_refund'   AND amount > 0 AND ad_purchase_id IS NOT NULL AND order_id IS NULL));

-- One debit per purchase, enforced by the database rather than by check-then-write — the same
-- guarantee `wallet_purchase_once` gives an order.
CREATE UNIQUE INDEX IF NOT EXISTS wallet_ad_purchase_once
  ON wallet_transactions(ad_purchase_id) WHERE kind = 'ad_purchase';

-- ---------- THE THREE PACKAGES ----------
-- Seeded here rather than in `seed.ts` because they are catalogue, not sample data: the organizer's
-- purchase screen has nothing to show on a fresh deployment without them.
INSERT INTO ad_packages (code, name_vi, description_vi, price_amount, duration_days, placements, display_order)
VALUES
  ('basic', 'Gói Cơ Bản',
   'Sự kiện của bạn xuất hiện trong mục “Sự kiện hot” trên trang chủ trong 7 ngày.',
   2000000, 7, ARRAY['hot_events']::TEXT[], 1),
  ('featured', 'Gói Nổi Bật',
   'Trailer sự kiện được chiếu ngay đầu trang chủ, kèm suất trong mục “Sự kiện hot”, trong 14 ngày.',
   5000000, 14, ARRAY['hot_events', 'hero_trailer']::TEXT[], 2),
  ('premium', 'Gói Toàn Diện',
   'Trọn bộ vị trí quảng cáo trên trang chủ — trailer đầu trang và mục “Sự kiện hot” — trong 30 ngày.',
   9000000, 30, ARRAY['hot_events', 'hero_trailer']::TEXT[], 3)
ON CONFLICT (code) DO NOTHING;

COMMIT;
