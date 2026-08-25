# Phase 1 Data Model: Account & Authentication

Scope: the tables this feature **owns or creates**. Authoritative reference is
`docs/Analysis_Design/SCHEMA_DATABASE.md`; this file restates only the auth-relevant subset and
records the **one addition** that reference lacks (`password_resets`, research R-7). Downstream
tables (events, orders, tickets, …) are out of scope and unchanged.

## Entities

### User Account — `users`

A person's identity. One account owns exactly one wallet.

| Field | Type | Rule |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `email` | TEXT UNIQUE NOT NULL | lowercased+trimmed before write; UNIQUE makes D5's refusal expressible (FR-004) |
| `phone` | TEXT NULL | normalised `+84…` before write; unique **when present** via `uq_users_phone` (FR-009) |
| `nickname` | TEXT | display handle; **canonical name DB→API→UI** (renamed from `full_name`, Q4b / CONTEXT.md) |
| `password_hash` | TEXT NULL | bcrypt cost 12; NULL for Google accounts; **never** both this and a provider subject (FR-006, D5) |
| `provider` | TEXT NOT NULL DEFAULT `'email'` | CHECK in (`email`,`google`); selects the refusal message (FR-046/047) |
| `provider_user_id` | TEXT NULL | Google stable `sub`; identity, not email (FR-025) |
| `is_admin` | BOOLEAN NOT NULL DEFAULT false | only stored privilege (FR-020) |
| `status` | TEXT NOT NULL DEFAULT `'active'` | CHECK in (`active`,`suspended`); read **per request** (FR-051/052) |
| `avatar_url` | TEXT NULL | Points to the image, **no default stored**. Password register → `NULL` → FE renders a nickname-initials fallback. Google register → seeded from the `picture` claim (https-validated). User sets it by **uploading** a file (Q8/ADR 0004): stored on VPS disk, served by Nginx, so `avatar_url` = `https://tixhub.fit/uploads/avatars/<uuid>.webp`. Users cannot paste an arbitrary URL — upload only. |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

**Constraints / indexes**
- `users_credential_matches_provider` CHECK: (`email` ⇒ hash set, subject null) XOR (`google` ⇒ hash null, subject set) — a hybrid/merged account is **unrepresentable** (FR-045).
- `uq_users_phone` UNIQUE partial on `phone WHERE phone IS NOT NULL` (FR-009, FR-050).
- `uq_users_provider_subject` UNIQUE partial on `(provider, provider_user_id) WHERE provider_user_id IS NOT NULL` (FR-025).

**Validation (application, FR-042)**: email format; VN phone format→canonical; password ≥ 8 with a letter and a digit (FR-003); confirmation match (FR-002); reject any privilege-bearing field at registration (FR-008).

### Wallet — `wallets` (created here, owned by later features)

Created **in the same transaction** as the account — on **both** creation paths, password register
**and** Google OAuth register (FR-007) — zero balance, so no later flow meets a walletless account.
`user_id UNIQUE NOT NULL`, `balance_amount BIGINT DEFAULT 0`, `wallet_balance_non_negative` CHECK. This
feature only **inserts** the row; balance mechanics belong to wallet/checkout.

### Session — `refresh_tokens`

Stored, rotating proof a browser acts as an account (D7).

| Field | Type | Rule |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `user_id` | BIGINT NOT NULL → users | |
| `family_id` | UUID NOT NULL | shared by every token descended from one login (= one device session) |
| `family_started_at` | TIMESTAMPTZ NOT NULL | when the login that began this family happened; drives the **absolute cap** (R-12 #6) |
| `token_hash` | TEXT UNIQUE NOT NULL | hash only — leaked DB yields no usable token (FR-016) |
| `parent_id` | BIGINT NULL → refresh_tokens | the token this one replaced; **`UNIQUE(parent_id)`** ⇒ at most one child, forks impossible |
| `idempotency_key` | TEXT NULL | client nonce that minted this row; lets an honest retry re-fetch the same child without a false reuse-kill (R-12 #1/#4) |
| `expires_at` | TIMESTAMPTZ NOT NULL | 7-day sliding window (R-3) |
| `revoked_at` | TIMESTAMPTZ NULL | non-NULL ⇒ rotated / logged out / family-killed |
| `revoked_reason` | TEXT NULL | CHECK in (`rotated`,`logout`,`logout_all`,`reuse_detected`,`password_changed`,`password_reset`,`account_suspended`) |
| `user_agent` / `source_ip` | TEXT / INET | forensics |
| `created_at` | TIMESTAMPTZ | |

**Indexes**: `uq_refresh_parent` UNIQUE partial on `parent_id WHERE parent_id IS NOT NULL` — one child per token, deterministic child lookup, no family fork (R-12); `idx_refresh_user_live` (user_id) WHERE revoked_at IS NULL — logout-all, suspend, password-change kill (FR-018/052/057); `idx_refresh_family` (family_id) — family kill in one statement (FR-019); `idx_refresh_expired` (expires_at) WHERE revoked_at IS NOT NULL — cleanup sweep.

**Rotation & reuse detection (A‴, research R-12)**: `/refresh` runs under `SELECT … FOR UPDATE` on the **presented token row** (serializes same-token races). A **live** token rotates: old → `revoked_reason='rotated'`, one child inserted (same `family_id`, same `family_started_at`). A token already `revoked_reason='rotated'` is judged by the **idempotency key**: request key matches **and** child unused → return the existing child (honest concurrent/retry, no kill); otherwise → **reuse → kill this family**. Any **other** `revoked_reason` → plain `401`, **no** kill (session ended by an explicit action; a stale retry must not masquerade as an attack).

**State transitions**: `issued` →(use)→ `rotated` (old revoked `rotated`, single child issued, same family). Reuse of a superseded token (bad/absent key, or child already used) → **that token's family** revoked `reuse_detected`, every live sibling in the family killed. Absolute cap: refresh refused past `family_started_at + 30d` regardless of sliding (R-12 #6; still ≥ SC-004's 7 days). `logout` revokes one token; `logout_all`/suspend/password-change/reset revoke all live rows for the user.

> **Scope note (upstream flag):** family kill is scoped to the **one family (device)**, per schema D7 — **not** every session for the account. Spec FR-019 / US2-scenario-4 currently read "every remaining session for that account," which is broader and a user-level DoS amplifier. Resolve via `/speckit-clarify` (see plan.md → Upstream follow-ups). Until then this data-model follows D7.

### Password Reset Request — `password_resets` *(NEW — not in reference schema, R-7)*

Single-use, time-limited, unguessable permission to set a new password on one account.

| Field | Type | Rule |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `user_id` | BIGINT NOT NULL → users | |
| `token_hash` | TEXT UNIQUE NOT NULL | hash only — stored form unusable if read (FR-031) |
| `expires_at` | TIMESTAMPTZ NOT NULL | 30 min (R-3), single-use time limit (FR-029) |
| `consumed_at` | TIMESTAMPTZ NULL | set atomically on use; non-NULL ⇒ cannot be reused |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |

**Index**: `idx_password_resets_user` (user_id, created_at DESC) — history/cleanup. The request throttle is **not** keyed here: it keys on `hash(submitted_identifier)+source_ip` (R-13), never on account existence, so it fires identically for registered and unregistered addresses (FR-032 intent without the FR-028/FR-040 leak).

**Rules**: only issued for `provider='email'` accounts; a request for a Google account (or an unknown email) returns the **same** response and mints nothing (FR-028, FR-053, D5). On consume: replace `users.password_hash`, set `consumed_at`, revoke every live `refresh_tokens` row for the account `password_reset` (FR-030). A stale (`expires_at < now()`) or already-`consumed_at` link is refused.

### Organizer Application — `organizers`

An account's request for organizer capability. Presence of an `approved` row **is** the role (FR-020).

Key fields: `user_id` (NOT unique), `display_name` NOT NULL, `description`, `logo_url`, `status` CHECK in
(`pending`,`approved`,`suspended`,`rejected`) DEFAULT `pending`, `review_note`, `applied_at`,
`approved_at`, `approved_by → users`.

- `uq_organizers_live_application` UNIQUE partial on `user_id WHERE status IN ('pending','approved','suspended')` — at most one **live** application; `suspended` stays **inside** so re-applying can't shed a suspension (FR-037/059); `rejected` excluded so a corrected re-apply is allowed (FR-058).
- History retained; `idx_organizers_user_history` (user_id, applied_at DESC) (FR-060).

**State transitions**: none → `pending` (apply). Admin (later feature) → `approved` / `rejected` / `suspended`. `rejected` →(re-apply)→ new `pending` row. `suspended` → re-apply **refused** (FR-059). Capability derived per request (FR-021).

### Authentication Event — `auth_events`

Immutable security-relevant record; distinct from `audit_logs` (FR-056).

Fields: `user_id` **nullable** (NULL when the identifier matched no account, FR-054), `identifier_hash`
(keyed hash of attempted email/phone — never the value, FR-055), `event` CHECK in
(`login_success`,`login_failure`,`logout`,`logout_all`,`password_changed`,`password_reset_requested`,
`password_reset_completed`,`session_reuse_detected`,`organizer_applied`), `source_ip`, `user_agent`,
`created_at`. Append-only — never updated or deleted. Credentials never written (FR-006).

**Indexes**: `idx_auth_events_user` (user_id, created_at DESC); `idx_auth_events_identifier` (identifier_hash, created_at DESC) — per-identifier failure count for the progressive delay; `idx_auth_events_source` (source_ip, created_at DESC) WHERE event='login_failure' — per-source throttle (D6).

## Cross-entity invariants (assert in tests)

- **One account per email, ever** — DB UNIQUE; 100 concurrent registrations on one email → exactly 1 account (SC-007).
- **No merged identity** — no sequence of actions yields one account reachable by both password and Google (SC-012, FR-045); guaranteed by `users_credential_matches_provider` + `uq_users_provider_subject`.
- **Wallet exists ⟺ account exists** — both inserted in one transaction (FR-007).
- **Revocable session** — logout/logout-all/suspend/password-change/reset each make prior refresh tokens unusable within 1 s (SC-005, FR-017/018/030/052/057).
- **Reuse ⇒ family death** — a superseded refresh token revokes its whole family (FR-019).
- **No lockout** — no `failed_attempts`/`locked_until`; a correct password is accepted after any number of failures (SC-013, D-E).
