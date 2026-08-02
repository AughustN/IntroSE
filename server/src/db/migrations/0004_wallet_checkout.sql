-- 0004_wallet_checkout.sql - add only the wallet layer missing from tixhub.sql.
-- Reuses the existing orders, payment_transactions, tickets, reservations and reservation_items tables.

BEGIN;

CREATE TABLE IF NOT EXISTS wallets (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT UNIQUE NOT NULL REFERENCES users(id),
  balance_amount BIGINT NOT NULL DEFAULT 0 CHECK (balance_amount >= 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO wallets (user_id, balance_amount)
SELECT id, 0 FROM users
ON CONFLICT (user_id) DO NOTHING;

-- The base schema's payment_transactions is reused for VNPay wallet top-ups.
-- A top-up is not an order, so order_id must be nullable.
ALTER TABLE payment_transactions ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id);
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS payment_kind TEXT NOT NULL DEFAULT 'order'
  CHECK (payment_kind IN ('topup', 'order'));
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_payment_transactions_user_created ON payment_transactions(user_id, created_at DESC);

-- Signed amounts: top-up/refund positive, purchase negative. This is the wallet's append-only ledger.
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id                     BIGSERIAL PRIMARY KEY,
  wallet_id              BIGINT NOT NULL REFERENCES wallets(id),
  kind                   TEXT NOT NULL CHECK (kind IN ('topup', 'purchase', 'refund')),
  amount                 BIGINT NOT NULL CHECK (amount <> 0),
  balance_after          BIGINT NOT NULL CHECK (balance_after >= 0),
  payment_transaction_id BIGINT UNIQUE REFERENCES payment_transactions(id),
  order_id               BIGINT REFERENCES orders(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'topup' AND amount > 0 AND payment_transaction_id IS NOT NULL AND order_id IS NULL)
      OR (kind = 'purchase' AND amount < 0 AND order_id IS NOT NULL)
      OR (kind = 'refund' AND amount > 0 AND order_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_wallet_created ON wallet_transactions(wallet_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS wallet_purchase_once ON wallet_transactions(order_id) WHERE kind = 'purchase';

-- The existing orders table already represents the completed checkout. One reservation becomes one order.
CREATE UNIQUE INDEX IF NOT EXISTS orders_reservation_once ON orders(reservation_id);

COMMIT;
