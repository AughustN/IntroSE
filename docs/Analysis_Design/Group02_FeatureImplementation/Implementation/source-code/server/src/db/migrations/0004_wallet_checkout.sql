-- 0004_wallet_checkout.sql — Wallet, orders and ticket issue (feature 004).
--
-- Completes the booking chain: 0003 leaves a reservation holding seats, this turns a paid
-- reservation into an order plus one ticket per seat, and gives the buyer the wallet the money
-- moves through. Checkout is wallet-only (schema decision D2): VND enters via a VNPay top-up and
-- leaves as tickets, so an order never touches a gateway — only `wallets.balance_amount` does.
--
-- `wallets` itself belongs to 0001_auth.sql, created with the account (FR-007). It is not
-- redefined here.
--
-- Naming note: the `_cents` suffix on the money columns is inherited from the design schema in
-- docs/Analysis_Design/SCHEMA_DATABASE.md and is a misnomer — every amount is an integer number of
-- VND đồng, same as `reservation_items.unit_price_amount`. Renaming is a separate change; the
-- payments module queries these exact names.

BEGIN;

-- ---------- ORDERS ----------
-- The completed checkout. One reservation becomes exactly one order (`orders_reservation_once`),
-- which is what makes a double-submitted checkout idempotent rather than a second charge.
-- Customer name/email/phone are snapshotted from the account at purchase time so a later profile
-- edit cannot rewrite what the ticket was sold under.
--
-- The design schema also carries `voucher_id` here. Vouchers are not built, so the column is left
-- out rather than added as a permanently-NULL foreign key to a missing table.
CREATE TABLE IF NOT EXISTS orders (
  id                BIGSERIAL PRIMARY KEY,
  order_code        TEXT NOT NULL UNIQUE,
  user_id           BIGINT REFERENCES users(id),
  reservation_id    BIGINT NOT NULL REFERENCES reservations(id),
  customer_name     TEXT NOT NULL,
  customer_email    TEXT NOT NULL,
  customer_phone    TEXT NOT NULL,
  subtotal_cents    BIGINT NOT NULL,
  service_fee_cents BIGINT NOT NULL,
  discount_cents    BIGINT NOT NULL DEFAULT 0,
  final_total_cents BIGINT NOT NULL,
  payment_method    TEXT NOT NULL,
  payment_status    TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded', 'partially_refunded', 'cancelled')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One order per reservation. The checkout transaction relies on this: it reads the existing order
-- and returns it instead of building a second one.
CREATE UNIQUE INDEX IF NOT EXISTS orders_reservation_once ON orders(reservation_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at DESC);

-- ---------- TICKETS ----------
-- One row per admitted person: one seat (seated) or one unit of a GA quantity. `barcode_value` is
-- the code printed in the QR; `qr_token_hash` is its SHA-256, so a leaked database still cannot be
-- used to mint a scannable ticket. Both are unique — a code is never reissued.
CREATE TABLE IF NOT EXISTS tickets (
  id                  BIGSERIAL PRIMARY KEY,
  order_id            BIGINT NOT NULL REFERENCES orders(id),
  reservation_item_id BIGINT NOT NULL REFERENCES reservation_items(id),
  price_cents         BIGINT NOT NULL,
  qr_token_hash       TEXT NOT NULL UNIQUE,
  barcode_value       TEXT NOT NULL UNIQUE,
  qr_status           TEXT NOT NULL DEFAULT 'unused'
    CHECK (qr_status IN ('unused', 'checked_in', 'void')),
  checked_in_at       TIMESTAMPTZ,
  checked_in_by       BIGINT REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tickets_order ON tickets(order_id);

-- ---------- PAYMENT TRANSACTIONS ----------
-- The gateway leg. Two kinds share the table: a `topup` moves money into a wallet and has no order,
-- an `order` row is the (unused today) direct-payment path — hence `order_id` is nullable and
-- `user_id` carries the topup's owner instead.
--
-- UNIQUE (provider, provider_txn_ref) is the replay guard: VNPay retries its IPN, and the callback
-- looks the row up by `provider_txn_ref` under FOR UPDATE, so a duplicate notification finds the
-- row already marked 'success' and credits nothing.
CREATE TABLE IF NOT EXISTS payment_transactions (
  id               BIGSERIAL PRIMARY KEY,
  order_id         BIGINT REFERENCES orders(id),
  user_id          BIGINT REFERENCES users(id),
  payment_kind     TEXT NOT NULL DEFAULT 'order' CHECK (payment_kind IN ('topup', 'order')),
  provider         TEXT NOT NULL DEFAULT 'vnpay',
  provider_txn_id  TEXT,
  provider_txn_ref TEXT,
  amount_cents     BIGINT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('initiated', 'success', 'failed', 'refunded')),
  raw_payload      JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_txn_ref)
);

CREATE INDEX IF NOT EXISTS idx_payment_txn_order ON payment_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_user_created
  ON payment_transactions(user_id, created_at DESC);

-- ---------- WALLET TRANSACTIONS ----------
-- The wallet's append-only ledger. Signed amounts: top-up and refund positive, purchase negative.
-- `balance_after` is written inside the same transaction as the `wallets` update, so the ledger and
-- the balance can be reconciled without replaying history.
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id                     BIGSERIAL PRIMARY KEY,
  wallet_id              BIGINT NOT NULL REFERENCES wallets(id),
  kind                   TEXT NOT NULL CHECK (kind IN ('topup', 'purchase', 'refund')),
  amount                 BIGINT NOT NULL CHECK (amount <> 0),
  balance_after          BIGINT NOT NULL CHECK (balance_after >= 0),
  payment_transaction_id BIGINT UNIQUE REFERENCES payment_transactions(id),
  order_id               BIGINT REFERENCES orders(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Each kind has exactly one shape: a top-up points at the gateway row, a purchase and a refund
  -- point at the order. Nothing may point at both.
  CHECK ((kind = 'topup'    AND amount > 0 AND payment_transaction_id IS NOT NULL AND order_id IS NULL)
      OR (kind = 'purchase' AND amount < 0 AND order_id IS NOT NULL)
      OR (kind = 'refund'   AND amount > 0 AND order_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_wallet_created
  ON wallet_transactions(wallet_id, created_at DESC);

-- One debit per order, enforced by the database rather than by check-then-write: a concurrent
-- second checkout for the same reservation cannot double-charge the wallet.
CREATE UNIQUE INDEX IF NOT EXISTS wallet_purchase_once
  ON wallet_transactions(order_id) WHERE kind = 'purchase';

COMMIT;
