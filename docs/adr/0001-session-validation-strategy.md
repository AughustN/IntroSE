# Session validation: live per-request check, not a trusted stateless JWT

**Status**: accepted (2026-07-23) — feature 001-account-auth

## Context

TixHub sessions use a short-lived access token (JWT, ~15 min, in memory) plus a rotating refresh
token (hashed in `refresh_tokens`, httpOnly cookie) per schema decision D7. The spec demands
*immediate* revocation in several places: logout refuses every later use (FR-017), suspension bites
on the very next request and ends sessions (FR-052), organizer capability is decided on every request
(FR-021), and logout must make a session unusable within one second, verified by replay (SC-005).

A purely stateless JWT cannot satisfy these: it stays valid until it expires, so revocation would lag
up to the token TTL.

## Decision

The access token proves **identity and signature only**; it is never trusted for authorization
*state*. Every protected request additionally performs one indexed read — `users.status` plus a check
that the session's refresh-token family is still live (`revoked_at IS NULL`), expressible as a single
`JOIN`. Revocation is therefore synchronous: logout, logout-all, suspend, password-change, reset, and
reuse-detection all take effect on the very next request, because the authority is the database
(Principle I), not the token. The 15-minute TTL only bounds how long a *stolen* access token stays
cryptographically valid.

## Considered options

- **Stateless JWT trusted until expiry** (rejected): revocation is eventual — SC-005 fails and FR-017
  is violated for the TTL window. Unacceptable for a money app where a suspended actor must lose
  access at once (Principle II).
- **Redis revocation list** (rejected): instant and read-free, but a third infrastructure piece beyond
  Postgres — violates Principle V (free-tier / YAGNI) for a single-instance Render deploy.
- **Token-version column + in-process cache** (deferred): near-instant revocation at ~0 amortized
  reads, but per-device logout still needs the refresh row and cross-instance cache invalidation needs
  pub/sub. This is the natural upgrade — drop a cache in front of the same read — once scale demands
  it, with no rewrite.

## Consequences

- One indexed read per protected request. Negligible at project scale (pool ≤ 20); the request path
  stays app-tier stateless (no session affinity, SCAL-01).
- SC-005's "within 1 second" is met trivially because the check is synchronous, not polled — the clause
  is what (correctly) rules out the stateless option, and it costs nothing under this design.
