-- 0005_refundable_amount.sql — per-ticket refund allocation, and the top-up's originating hold.
--
-- Part 1 — tickets.refundable_amount (UC-12 step 5, UC-16).
--
-- `price_cents` is the face value shown on the ticket. `refundable_amount` is what that ticket is
-- actually worth back: post-discount, pre-service-fee, frozen at issue time. They differ whenever a
-- voucher was applied, and refunding the face value instead would mint money — four 200,000₫ tickets
-- bought for 620,000₫ after a 200,000₫ voucher would refund 800,000₫
-- (docs/Analysis_Design/SCHEMA_DATABASE.md).
--
-- Discount is allocated floor() per ticket with the remainder on the first, so the invariant
--   SUM(refundable_amount) per order = subtotal_cents - discount_cents
-- holds exactly with integer đồng and no rounding drift. The allocation itself is done by
-- wallet.service.ts inside the checkout transaction.

BEGIN;

-- DEFAULT 0 only so the column can be added NOT NULL; the checkout path always supplies a value.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS refundable_amount BIGINT NOT NULL DEFAULT 0;
ALTER TABLE tickets ALTER COLUMN refundable_amount DROP DEFAULT;

-- Part 2 — payment_transactions.reservation_id (UC-40 step 4).
--
-- A top-up started from a short balance at checkout remembers which hold sent the buyer to VNPay,
-- so the one-time grace can be granted against it and so the buyer can be returned to that exact
-- checkout afterwards. NULL for a top-up started from the wallet page, which holds nothing.
--
-- No cascade: the reservation may expire and be swept while the top-up is still in flight, and the
-- money is still owed either way (UC-40 A6 — "the money is safely in the wallet; only the seat was
-- lost"). The reference is history, not a dependency.
ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS reservation_id BIGINT REFERENCES reservations(id);

-- The reconciliation sweep scans for stale `initiated` rows (UC-40 A5); without this it seq-scans
-- the whole payment history every five minutes.
CREATE INDEX IF NOT EXISTS idx_payment_txn_pending
  ON payment_transactions(status, created_at)
  WHERE status = 'initiated';

COMMIT;
