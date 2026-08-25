# Refresh-token reuse detection: idempotency-keyed grace, family-scoped kill

**Status**: accepted (2026-07-23) — feature 001-account-auth

## Context

Refresh tokens rotate on every use (D7). Rotation must detect theft — a superseded token being
replayed means a copy is loose (FR-019) — without logging honest users out when two tabs or a network
retry refresh concurrently with the same token. A naive "any superseded token kills the family" rule
false-triggers on benign races; a plain time-boxed grace (accept a just-rotated token for ~10s) lets a
concurrent attacker holding the stolen cookie collect the fresh child inside the window, and leaves an
unbounded "idle child" hole if the legitimate client never uses its new token.

## Decision

- **Serialize** each refresh under `SELECT … FOR UPDATE` on the presented token row; `UNIQUE(parent_id)`
  makes a token rotate into at most one child (no family fork).
- **Idempotency-keyed grace**: the client sends a fresh in-memory nonce per refresh attempt (never in
  the cookie). On re-presentation of a `revoked_reason='rotated'` token, return the existing child only
  if the request's key matches **and** the child is unused; otherwise treat it as reuse and revoke the
  family. A thief who stole only the httpOnly cookie has no matching key, so replay trips the kill and
  logs `session_reuse_detected`; an honest retry carrying the same key is served the same child
  regardless of the clock (which also survives a network drop after the server committed the child).
- **Family-scoped kill**: revocation is scoped to the one family (device), not the whole account —
  a superseded token implies nothing about other logins.
- **Absolute cap**: refresh is refused past `family_started_at + 30 days`, ending immortal sliding
  sessions while still clearing SC-004's 7-day minimum.
- Other revocation reasons (`logout`, `logout_all`, `password_*`, `account_suspended`) → plain 401,
  never a reuse-kill.

## Considered options (rejected)

- **DPoP / token binding** — eliminates bearer-token theft but adds per-request crypto proofs and client
  key management, off the fixed stack; future hardening, not this feature.
- **IP / device binding** — breaks legitimate mobile users (IP churn → false logouts) and is weak against
  same-NAT / UA-spoof attackers.
- **Redis atomic swap / revocation list** — a third infrastructure piece beyond Postgres (Principle V);
  `FOR UPDATE` suffices because refresh is single-flighted, low-concurrency, and a same-cookie flood is
  capped by the per-source throttle before reaching the lock. Optimistic CAS (`version` column) is the
  lock-free fallback if contention ever appears.
- **Risk-based partial revocation / anomaly-ML / real-time alerting** — out of scope for a 13-week build;
  `auth_events` is the in-scope audit surface.

## Consequences

- Residual accepted risk: an attacker who both steals the cookie **and** captures a specific in-flight
  request's nonce, or who uses the token *before* the victim rotates, is not caught by rotation alone —
  the irreducible limit of bearer tokens, deferred to the rejected binding options above.
- Family-scoped kill contradicts the current wording of spec FR-019 / US2-scenario-4 ("every remaining
  session for that account"). The schema (D7) is treated as correct; the spec wording is flagged for a
  `/speckit-clarify` narrowing. Until resolved, the implementation follows D7.
