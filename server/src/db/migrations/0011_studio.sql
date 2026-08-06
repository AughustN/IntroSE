BEGIN;

-- Feature 006 — Organizer Event Studio.
--
-- Additive only: one nullable column and two indexes. Every existing tier stays active because
-- `archived_at` defaults to NULL, so no read changes meaning until the application code filters on it.

-- ---------- TICKET TIERS: archive marker (FR-006) ----------
-- A tier that has sold at least one ticket is ARCHIVED, never deleted: existing orders and tickets
-- must still resolve its label and price. Archived tiers are unpurchasable, hidden from buyers, and
-- do NOT count toward the four-active-tier limit — otherwise retiring a sold-out tier would
-- permanently consume one of a showtime's four slots. Restore is `SET archived_at = NULL`.
ALTER TABLE ticket_tiers ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- "Active" is the hot predicate: the 4-tier check, every buyer read, and every organizer read
-- filter on it.
CREATE INDEX IF NOT EXISTS idx_ticket_tiers_active
  ON ticket_tiers(showtime_id) WHERE archived_at IS NULL;

-- ---------- AUDIT LOGS: lookup by target (FR-020, FR-026) ----------
-- Two new access patterns. FR-020 asks "was this event ever approved?" on every delete attempt, and
-- FR-026 now writes a row on every material edit — where previously only admin moderation wrote here.
-- The table is about to get much busier and is read by id, so the index answers a real change in
-- access pattern rather than a guess.
CREATE INDEX IF NOT EXISTS idx_audit_logs_target
  ON audit_logs(target_type, target_id);

COMMIT;
