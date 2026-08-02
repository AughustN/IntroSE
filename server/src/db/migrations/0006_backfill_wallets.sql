-- 0006_backfill_wallets.sql — give every existing account the wallet the code assumes it has.
--
-- 0001 creates a wallet inside the signup transaction (FR-007), so any account that registered
-- through the app already has one. Accounts that arrived another way — a hand-loaded demo dataset,
-- a restore, a direct INSERT — did not, and every wallet operation for them fails on
-- `wallet_not_found`: they cannot top up, and they cannot check out.
--
-- Idempotent, so it is safe on a database where signup already did the work.

BEGIN;

INSERT INTO wallets (user_id, balance_amount)
SELECT id, 0 FROM users
ON CONFLICT (user_id) DO NOTHING;

COMMIT;
