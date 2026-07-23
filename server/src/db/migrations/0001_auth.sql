-- ============================================================================
-- Migration 0001 — Account & Authentication (feature 001-account-auth)
--
-- Run once against the (empty) database:
--   psql "$DATABASE_URL" -f server/src/db/migrations/0001_auth.sql
--
-- Owns/creates the 6 auth tables. The rest of the product schema (events, orders,
-- tickets, …) lives in docs/Analysis_Design/SCHEMA_DATABASE.md and ships later.
-- Reflects the reviewed design: nickname (not full_name); refresh-token rotation
-- with family_started_at + idempotency_key + UNIQUE(parent_id); password_resets
-- (new); family-scoped reuse kill; no account-lockout columns (D-E/D6).
-- ============================================================================

BEGIN;

-- ---------- USERS ----------
-- email is lowercased+trimmed by the app before insert; phone normalised to +84… (D4).
CREATE TABLE users (
  id               BIGSERIAL PRIMARY KEY,
  email            TEXT UNIQUE NOT NULL,
  phone            TEXT,
  nickname         TEXT,                        -- display handle (renamed from full_name)
  password_hash    TEXT,                        -- NULL for a Google account
  provider         TEXT NOT NULL DEFAULT 'email'
                     CHECK (provider IN ('email', 'google')),
  provider_user_id TEXT,                        -- Google stable subject id
  is_admin         BOOLEAN NOT NULL DEFAULT false,
  status           TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'suspended')),
  avatar_url       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A password account has a hash; a Google account has a provider id. Never both, never neither.
  CONSTRAINT users_credential_matches_provider CHECK (
    (provider = 'email'  AND password_hash IS NOT NULL AND provider_user_id IS NULL) OR
    (provider = 'google' AND password_hash IS NULL     AND provider_user_id IS NOT NULL)
  )
);

-- phone is a sign-in identifier: unique only among accounts that supplied one.
CREATE UNIQUE INDEX uq_users_phone ON users(phone) WHERE phone IS NOT NULL;
-- Google sign-in looks up by provider subject, never by email.
CREATE UNIQUE INDEX uq_users_provider_subject
  ON users(provider, provider_user_id) WHERE provider_user_id IS NOT NULL;

-- ---------- WALLETS ----------
-- Created in the same transaction as the account (FR-007). Zero balance, non-negative.
CREATE TABLE wallets (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT UNIQUE NOT NULL REFERENCES users(id),
  balance_amount BIGINT NOT NULL DEFAULT 0,     -- integer VND đồng
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wallet_balance_non_negative CHECK (balance_amount >= 0)
);

-- ---------- REFRESH TOKENS ----------
-- Stored, rotating sessions (D7). One row per issued token; all from one login share family_id.
CREATE TABLE refresh_tokens (
  id                BIGSERIAL PRIMARY KEY,
  user_id           BIGINT NOT NULL REFERENCES users(id),
  family_id         UUID NOT NULL,                 -- one login / device
  family_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),  -- drives the 30-day absolute cap
  token_hash        TEXT UNIQUE NOT NULL,          -- hash only
  parent_id         BIGINT REFERENCES refresh_tokens(id),
  idempotency_key   TEXT,                          -- honest-retry grace (R-12); not in the cookie
  expires_at        TIMESTAMPTZ NOT NULL,          -- 7-day sliding window
  revoked_at        TIMESTAMPTZ,
  revoked_reason    TEXT CHECK (revoked_reason IN (
                      'rotated', 'logout', 'logout_all', 'reuse_detected',
                      'password_changed', 'password_reset', 'account_suspended')),
  user_agent        TEXT,
  source_ip         INET,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A token rotates into at most one child → no family fork; deterministic child lookup.
CREATE UNIQUE INDEX uq_refresh_parent ON refresh_tokens(parent_id) WHERE parent_id IS NOT NULL;
-- logout-all / suspend / password-change kill.
CREATE INDEX idx_refresh_user_live ON refresh_tokens(user_id) WHERE revoked_at IS NULL;
-- reuse kills the family in one statement.
CREATE INDEX idx_refresh_family ON refresh_tokens(family_id);
-- cleanup sweep.
CREATE INDEX idx_refresh_expired ON refresh_tokens(expires_at) WHERE revoked_at IS NOT NULL;

-- ---------- PASSWORD RESETS ----------
-- Single-use, time-limited reset permission. Stored hashed (FR-031). NEW table (R-7).
CREATE TABLE password_resets (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  token_hash  TEXT UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,               -- 30 min
  consumed_at TIMESTAMPTZ,                         -- set atomically on use; non-NULL ⇒ spent
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_password_resets_user ON password_resets(user_id, created_at DESC);

-- ---------- AUTH EVENTS ----------
-- Immutable security history, distinct from admin audit. user_id nullable; identifier hashed.
CREATE TABLE auth_events (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT REFERENCES users(id),    -- NULL when the identifier matched no account
  identifier_hash TEXT,                            -- keyed hash of attempted email/phone, never raw
  event           TEXT NOT NULL CHECK (event IN (
                    'login_success', 'login_failure', 'logout', 'logout_all',
                    'password_changed', 'password_reset_requested', 'password_reset_completed',
                    'session_reuse_detected', 'organizer_applied')),
  source_ip       INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auth_events_user       ON auth_events(user_id, created_at DESC);
CREATE INDEX idx_auth_events_identifier ON auth_events(identifier_hash, created_at DESC);
-- per-source throttle (D6) + enumeration sweep.
CREATE INDEX idx_auth_events_source     ON auth_events(source_ip, created_at DESC)
  WHERE event = 'login_failure';

-- ---------- ORGANIZERS ----------
-- Organizer capability is derived: a user is an Organizer iff a row here has status='approved'.
CREATE TABLE organizers (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id),  -- deliberately NOT UNIQUE
  display_name TEXT NOT NULL,
  description  TEXT,
  logo_url     TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'suspended', 'rejected')),
  review_note  TEXT,
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at  TIMESTAMPTZ,
  approved_by  BIGINT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one LIVE application per user. 'rejected' excluded (re-apply allowed);
-- 'suspended' included (re-applying cannot shed a suspension).
CREATE UNIQUE INDEX uq_organizers_live_application
  ON organizers(user_id) WHERE status IN ('pending', 'approved', 'suspended');
CREATE INDEX idx_organizers_status       ON organizers(status);
CREATE INDEX idx_organizers_user_history ON organizers(user_id, applied_at DESC);

COMMIT;
