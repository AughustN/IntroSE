# Phase 0 Research: Account & Authentication

Resolves the open technical choices behind the spec. Each entry: **Decision → Rationale →
Alternatives rejected**. Spec-level decisions (D-A…D-E) and schema decisions (D4…D7) are already
fixed and are *not* reopened here; this file pins the remaining implementation-level unknowns.

## R-1 — External integration cap (BLOCKING, governance)

**Decision**: Treat the constitution's two-integration cap (VNPay, Gemini) as breached and raise a
formal amendment before release. Google (US3) and a transactional-email provider (US4) are integrations
three and four.

**Rationale**: US4 is P1 (D-D) because reset is the only recovery path into a wallet-bearing account.
The amendment therefore gates the first release, not a later milestone. Per the constitution's
conflict-resolution order, security & data-integrity (unreachable money) outrank scope discipline.

**Alternatives rejected**: shipping without reset (trades user funds for schedule — forbidden);
SMS-based recovery (a fifth integration). **Fallback** if the team rejects email: ship with wallet
top-up disabled so no account can hold money it cannot reach.

**Status**: escalated to team vote (project constraint, gating). Implementation of US1/US2/US5/US6/US7
proceeds in parallel — none depends on either integration.

## R-2 — Session model (access + refresh)

**Decision**: Access token = JWT, ~15 min TTL, held **in memory** by the SPA (never localStorage).
Refresh token = opaque random 256-bit value, stored as a **hash** in `refresh_tokens`, delivered in an
**httpOnly, Secure, SameSite=Lax** cookie, rotated on every `/refresh`. All tokens from one login
share a `family_id`; presenting an already-rotated token revokes the whole family (`reuse_detected`).

**Session validation (Option A — live check per request)**: the access token proves **identity +
signature only**; it is **not** trusted for authorization state. Every protected request additionally
does one indexed read — `users.status` plus a check that the session's refresh-token family is still
live (`revoked_at IS NULL`), expressible as a single `JOIN`. This makes revocation **synchronous**:
logout, logout-all, suspend, password-change, reset, and reuse-detection all bite on the **very next
request** (FR-017/018/021/052/057, SC-005), because the state lives in the DB (source of truth,
Principle I), not in the token. The 15-min TTL is then only a bound on how long a *stolen* access
token stays cryptographically valid, not a revocation-lag budget.

**Access-token claims (identity only, Q7)**: `{ sub: user_id, fam: family_id, iat, exp (~15 min),
iss: "tixhub.fit", aud: "tixhub.fit" }`. `fam` lets the middleware check the family's liveness (Option A
+ reuse detection). Authorization state — `status`, `is_admin`, `isOrganizer` — is **deliberately not in
the token**; it is read live per request, so suspend / de-admin / organizer-suspension bite on the next
request instead of lagging up to the TTL.

**Rationale**: D7 + FR-016 — the credential that survives a browser restart must be unreadable to page
scripts, so a single XSS cannot yield lasting takeover. Rotation turns theft into a detectable event.
Storing only the hash means a leaked DB yields no usable session. SC-005's "within 1 second" is met
trivially because the check is synchronous, not polled. Cost is one indexed read per protected request,
negligible at this scale (pool ≤ 20); the path stays app-tier stateless (no session affinity, SCAL-01).

**Alternatives rejected**:
- **Stateless JWT trusted until expiry** (short TTL, no per-request read): revocation is *eventual* —
  logout/suspend lag up to the TTL, so SC-005 (1 s) fails and FR-017 is violated for the window. Wrong
  for a money app (Principle II) where a suspended actor must lose access immediately (FR-052).
- **Redis revocation list**: instant + no DB read, but a third infra piece beyond Postgres — violates
  Principle V (free-tier / YAGNI) for a single-instance deploy.
- **Token-version + in-process cache** (Ghost/Discourse-style): near-instant revocation at ~0 amortized
  reads, but per-*device* logout still needs the refresh row and cache invalidation across instances
  needs pub/sub. Deferred — it is the natural A→cache upgrade once scale demands it; no rewrite.
- Refresh token in localStorage: readable by injected scripts, violates FR-016.

See [ADR 0001](../../../docs/adr/0001-session-validation-strategy.md).

## R-3 — Session TTLs

**Decision**: access token 15 min; refresh token / "remember me" window 7 days sliding (rotated each
use). Reset link 30 min, single-use.

**Rationale**: SC-004 requires recognition without re-entering a password for ≥ 7 days of ordinary use
→ refresh window ≥ 7 days. Short access TTL keeps the stateless request path cheap while bounding staleness.
30 min reset link balances usability against exposure of an emailed secret.

**Alternatives rejected**: 30-day refresh (larger theft window for no requirement); 1-hour reset link
(longer live secret than needed).

## R-4 — Enumeration resistance (uniform response + constant time)

**Decision**: Login returns `401 invalid_credentials` for both "no such account" and "wrong password".
When the identifier does not exist, still perform a **dummy bcrypt compare** against a fixed hash so the
CPU cost matches the real path (FR-012, SC-006). Suspension (`account_suspended`) and
`account_uses_google` are disclosed **only after** identity is established (FR-013). Password-reset
`forgot` always returns the same 200 regardless of registration (FR-028). Throttle responses are
identical whether or not the account exists (FR-040).

**Rationale**: response time and message must not enumerate registered addresses. SC-006 asserts
statistical indistinguishability over 100 samples.

**Alternatives rejected**: early-return on unknown identifier (leaks via timing); distinct
"no such user" message (leaks directly).

## R-5 — Abuse resistance: throttle source, slow identifier, never lock

**Decision**: (a) Per-source (IP) fixed-window rate limit on login/register/forgot, counting attempts
whether or not the named identifier exists (FR-039). (b) Progressive per-identifier delay driven by
recent `auth_events` `login_failure` count for that `identifier_hash`, applied **equally** to
non-existent identifiers (FR-048, FR-049). (c) A correct password is **always** accepted regardless of
prior failures — no `locked_until`, no `failed_attempts` column (D-E / D6, SC-013).

**Rationale**: lockout is a DoS anyone can aim at a known email and it leaks (only real accounts lock).
The `idx_auth_events_source` partial index exists precisely to drive the per-source throttle.

**Alternatives rejected**: account lockout after N failures (FR-011/012/040 violation + victim DoS);
CAPTCHA (extra dependency, out of scope this feature).

**Threshold seed values** (tunable, asserted by SC-009): per-source login ≥ ~100/min → throttle;
per-identifier delay curve e.g. 0/0/0 then +250 ms, +500 ms, +1 s, … capped at ~5 s.

**What "source" is** (deployment: single VPS, Nginx reverse proxy, same-origin `tixhub.fit` — ADR 0003):
the source key is the **real client IP**, which the app can trust only because our own Nginx sets it and
a client cannot forge past it:
- Nginx **overwrites** the header: `proxy_set_header X-Forwarded-For $remote_addr;` — **not**
  `$proxy_add_x_forwarded_for`, which *appends* a client-supplied value and reopens spoofing.
- Express trusts exactly the one Nginx hop: `app.set('trust proxy', 1)` → `req.ip` = the client IP.
- Key the throttle on `req.ip` normalized to a **prefix** — `/32` for IPv4, **`/64` for IPv6** — so an
  attacker with a routed IPv6 block cannot walk addresses in their own prefix for free attempts.
- Layered with (b): a single-IP burst hits the per-source cap; a distributed attacker rotating IPs still
  hits the per-identifier delay. Neither alone suffices; the spec wants both.

## R-6 — Google OAuth verification

**Decision**: Frontend uses Google Identity Services to obtain an ID token; backend verifies it with
`google-auth-library` (`verifyIdToken`, checks `aud`/`iss`/expiry) before trusting any claim (FR-026).
Account lookup is by `(provider='google', provider_user_id=sub)`, never by email (FR-025). A colliding
email against a password account → `409 email_registered_with_password`; the reverse (register on a
Google-owned email) → `409 email_registered_with_google`. Never link, never merge (D5, FR-045).

On **new** Google account creation, seed `nickname` from the token's `name` claim and `avatar_url` from
the `picture` claim (only if it is an `https` URL); both are cosmetic and user-editable afterward. A
password account is created with `avatar_url = NULL`. There is **no stored default avatar** — a `NULL`
avatar is rendered by the frontend as a generated fallback (nickname initials), never persisted.

**Rationale**: the stable `sub` survives a Google email change; email is not identity here. Seeding the
Google picture is a free UX win from an already-verified token; keeping the default out of the DB avoids
hosting a placeholder image and a dead URL on every password account.

**Alternatives rejected**: trusting the browser-supplied profile without server verification (forgeable);
lookup/link by email (reintroduces the merge D5 forbids); storing a fixed default-avatar URL on every row
(a hosted image to maintain, uniform and dull, vs a free FE-generated initials fallback).

## R-7 — Password reset storage (NEW TABLE)

**Decision**: Add a `password_resets` table — the reference schema (`SCHEMA_DATABASE.md`) has **none**.
Store only a **hash** of the reset token (FR-031), with `user_id`, `expires_at`, `consumed_at`, and
`created_at`. Single-use: consumed atomically. On successful reset, replace the hash and revoke **every**
refresh-token family for the account (`password_reset`, FR-030). Google accounts (no password) are
refused a reset with the same uniform `forgot` response (D5, FR-053).

**Rationale**: FR-031 requires the stored form be unusable if read; FR-029 single-use + time-limited.
This is a genuine schema gap in the handoff doc — flagged so `data-model.md` and the migration own it.

**Alternatives rejected**: reusing `auth_events` (that table is append-only history, not a consumable
token store); stateless signed reset JWT (cannot be made single-use / revocable without a store anyway).

## R-8 — Identifier normalisation & ambiguity

**Decision**: Emails lowercased and trimmed before store and before every lookup (edge case:
`Ha@Example.com ` ≡ `ha@example.com`). Phones normalised to canonical `+84…` (Vietnamese format) before
the uniqueness check and before store, so `0901234567` and `+84901234567` cannot become two accounts.
Uniqueness (email always, phone when present) is enforced by DB constraints (`users_email UNIQUE`,
`uq_users_phone` partial), so concurrent submits resolve to exactly one account at the data store, not a
check-then-write (FR-004, SC-007).

**Login `identifier` classification (single field, both kinds — spec edge case)**:
1. **Classify by strict parse, not a loose `@` scan.** Parse as a valid email (zod `.email()`) → **email
   path**. Else normalise as a VN phone (`0…` / `+84…` / `84…` → canonical `+84…`) and validate → **phone
   path**. Neither parses → treat as an **unknown credential** (not a 400 — see point 4).
2. **Query exactly ONE column** (the classified one). **Never** fall back to the other column on a miss —
   that is what "MUST NOT match across both kinds" means: a bare number hits only `phone`, an `@`-value
   hits only `email`, so a phone value can never accidentally match an email and vice-versa.
3. **Same normalisation as registration**, applied *before* lookup (lowercase+trim email; `+84`
   canonical phone), or `0901234567` would fail to match a stored `+84901234567`.
4. **A malformed identifier is NOT rejected with 400.** Unlike registration fields (hard-rejected by
   FR-042), the login identifier is accepted regardless, classified, and any failure returns the uniform
   `401 invalid_credentials` in **constant time** (dummy bcrypt, R-4). A 400 "bad format" would behave
   differently from a 401 on a valid-but-unknown identifier — a subtle enumeration/behaviour leak. Login
   must look identical whether the input is garbage, unknown, or known-with-wrong-password (SC-006).

Classification is cheap and independent of whether the account exists, so it adds no timing signal; the
constant-time guarantee still rests on the dummy-bcrypt in the not-found path.

**Rationale**: matches D4 and the spec edge cases; DB-level uniqueness is the only correct concurrency
guarantee.

**Alternatives rejected**: application-level "check then insert" (races under concurrency, SC-007 fails);
storing phones in raw entered form (two spellings of one number become two accounts).

## R-9 — Password strength & validation

**Decision**: zod schemas validate every payload before use (FR-042). Password rule (FR-003): minimum 8
characters with at least one letter and one digit; registration requires a matching confirmation field
(FR-002); the rule is stated in the refusal message (Vietnamese). Profile `PATCH /api/me` accepts **only**
`nickname`, `phone`, `avatar` and ignores any other field, including privilege-bearing ones (FR-035,
FR-008, US5 scenario 5).

**Nickname rule (Q9)**: trim; length **1–50**; Unicode allowed (Vietnamese diacritics + spaces are
valid); control characters rejected; empty-after-trim rejected; **not unique** (collisions allowed).
Output-encoded on render (SEC-07).

**Rationale**: strict allow-lists close the privilege-escalation and mass-assignment holes the spec calls
out; a stated rule is required by FR-003.

**Alternatives rejected**: denylist / "strip unknown then proceed" without an explicit allow-list
(easier to miss a privileged field).

## R-10 — Organizer capability derivation

**Decision**: Organizer status is computed **per request** from the current `organizers` row:
capability exists iff a row with `status='approved'`. `apply` inserts a `pending` row; at most one **live**
application (`pending`/`approved`/`suspended`) per user via `uq_organizers_live_application`. Rejected
applicants may re-apply (a new row); suspended organizers may **not** (FR-058/059). All superseded rows
are retained as review history (FR-060). A suspension takes effect on the next request without waiting for
session expiry (FR-021, US6 scenario 7).

**Rationale**: matches the schema's partial-unique-index design exactly; deriving per request is what makes
suspension immediate.

**Alternatives rejected**: a single `role` column or a boolean `is_organizer` (loses history, can't
distinguish rejected/suspended, breaks immediate suspension).

## R-11 — Auth event logging (separate from admin audit)

**Decision**: Every security-relevant action writes an immutable `auth_events` row (FR-041) with a
**keyed hash** of the attempted identifier (`identifier_hash`), never the raw value (FR-055), and a
nullable `user_id` so a failure against a non-existent identifier is still recordable (FR-054). This table
is kept distinct from `audit_logs` (FR-056). Credentials are never logged (FR-006).

**Rationale**: a run of failures on unknown identifiers is the primary enumeration signal and must be
representable; the hash keeps the table from becoming a list of real addresses while still grouping repeat
attempts.

**Alternatives rejected**: writing auth history into `audit_logs` (requires a known actor; wrong volume &
retention); storing raw identifiers (turns a security log into a PII leak).

## R-12 — Refresh-token rotation & reuse detection (A‴)

**Decision**: `/refresh` runs under `SELECT … FOR UPDATE` on the **presented token row** (serializes
same-token races — Auth.js flags this race as unsolved without a lock). A live token rotates: old →
`revoked_reason='rotated'`, exactly one child inserted (`UNIQUE(parent_id)` forbids forks). A token
already `revoked_reason='rotated'` is judged by an **idempotency key** the client sends per attempt (a
fresh in-memory nonce, **not** in the cookie): key matches **and** child unused → return the existing
child (honest concurrent double-refresh or a post-commit network retry, no kill); otherwise → **reuse →
kill this family**. Any other `revoked_reason` → plain `401`, no kill. An **absolute cap** refuses
refresh past `family_started_at + 30d`. Client also single-flights refreshes and may refresh
proactively (~T-1min) to avoid the 401 stampede.

**Rationale**: rotation's benign-race problem and its theft-detection goal (FR-019) pull opposite ways.
A pure time-boxed grace (the earlier A″) let a **concurrent thief** who holds the stolen cookie collect
the same fresh child within the window, and — if keyed on "child unused" alone — left an unbounded
idle-child hole. Binding the grace to a client nonce closes both: a thief with only the httpOnly cookie
has **no matching key**, so their replay trips the kill and is logged (`session_reuse_detected`); an
honest retry carrying the same key is served the same child regardless of clock, which also fixes the
"network drops after the server committed the child" logout. The absolute cap ends immortal sliding
sessions (compliance-friendly) while still clearing SC-004's ≥ 7 days.

**Scope of the kill**: a superseded token proves a copy of **that family's** chain is loose; it implies
nothing about other logins. So the kill is scoped to the **one family (device)** per schema D7 — **not**
the whole account. Spec FR-019 / US2-scenario-4 say "every remaining session for that account," which is
broader and a user-level DoS amplifier (any captured stale token nukes every device). Flagged for
`/speckit-clarify` to narrow the wording; this design follows D7 meanwhile.

**Alternatives rejected** (all fail Principle V / the two-integration cap / spec scope for this build):
- **Time-boxed grace only** (A″): concurrent-thief window + idle-child hole; superseded by the keyed grace.
- **DPoP / token binding** (sender-constrained tokens): eliminates bearer theft but adds per-request crypto
  proofs and client key management, off-stack. Future hardening, not this feature.
- **IP / device binding**: breaks legitimate mobile users (cellular/Wi-Fi IP churn → false logouts);
  weak against same-NAT/UA-spoof attackers.
- **Redis atomic swap / revocation list**: a third infra piece beyond Postgres (already rejected in R-2).
  `SELECT … FOR UPDATE` suffices — refresh is single-flighted and low-concurrency, and a same-cookie flood
  is capped by the per-source throttle (R-5/D6) before it reaches the lock. Optimistic CAS (a `version`
  column) is the noted lock-free alternative if contention ever appears.
- **Risk-based partial revocation / anomaly-ML / real-time alerting**: `auth_events` (R-11) is the
  in-scope audit surface; behavioural detection is out of scope for a 13-week build.

See [ADR 0002](../../../docs/adr/0002-refresh-token-reuse-detection.md).

## R-13 — Password-reset request throttle (no enumeration leak)

**Decision**: Throttle `POST /auth/password/forgot` on **`hash(submitted_identifier) + source_ip`**,
never on account existence. The counter increments for **every** submitted email — registered or not —
so the limit fires identically for both. On breach return **`429`** (choice 2b); the `429` is keyed on
the same hash+IP, so it too is indistinguishable between a real and a fake address. Below the limit the
endpoint keeps its uniform `200` (FR-028: identical response whether or not the address is registered).
The per-source IP throttle (R-5) also applies to the whole endpoint. Seed values (tunable): ~3 requests
per identifier-hash per hour, ~10 `forgot` calls per source IP per hour.

**Rationale**: FR-032 as literally worded ("limit … **for one account**") contradicts FR-028 / FR-040 —
a per-account limit can only trigger for an email that *has* an account, so spamming a real address earns
a `429` while a fake one returns `200` forever, which enumerates registered addresses. Keying on the
**submitted identifier** instead of the account satisfies FR-032's intent (stop reset-spam for a given
address) with zero enumeration signal. The residual disclosure — "this hash+IP is currently
rate-limited" — reveals nothing about account existence and is harmless.

**Wording flag**: FR-032 "for one account" → "**per submitted identifier**" — an upstream
`/speckit-clarify` fix, same pattern as FR-019 (see plan.md → Upstream follow-ups).

**Alternatives rejected**:
- **Per-account key (literal FR-032)**: enumerates registered addresses (above).
- **Always `200`, silent drop past the limit (2a)**: equally leak-free, but a genuinely throttled user is
  left blind (waits for mail that will not come). 2b tells them to slow down without disclosing existence.

## R-14 — Avatar upload (VPS disk, Q8 / ADR 0004)

**Decision**: Users set their avatar by **uploading a file** (`POST /api/me/avatar`, multipart); the
paste-a-URL path is removed for users (only the Google `picture` seed remains as a trusted external URL).
Bytes are stored on the **VPS local disk** and served by **Nginx static**, so `avatar_url` =
`https://tixhub.fit/uploads/avatars/<uuid>.webp`. Safety pipeline (all mandatory): accept only raster
`jpeg`/`png`/`webp`; **reject SVG**; verify by **magic bytes**, not `Content-Type`/extension; ≤ 2 MB;
**re-encode via `sharp`** (strips EXIF + embedded payloads); random uuid filename (never user-supplied);
serve with `X-Content-Type-Options: nosniff` from a non-executable directory; deleting/replacing removes
the old file.

**Rationale**: the requested UX is device upload, not URL paste. On a self-hosted VPS, file storage is
disk + a static route, **not** a new external integration, so it does not breach the two-integration cap
(this is what makes reopening the spec's "upload out of scope" assumption cheap). File upload is a classic
footgun; the magic-byte check + SVG ban + `sharp` re-encode + random name + `nosniff` are the controls
that keep a malicious upload from becoming stored XSS or a path-traversal write.

**Spec impact**: supersedes the assumption *"avatar is a URL, not an upload; file storage out of scope."*
Flagged for `/speckit-clarify` (plan.md → Upstream follow-ups).

**Alternatives rejected**: URL paste only (safest, but not the requested UX — kept only for the trusted
Google seed); external object storage S3/Cloudinary (a third integration + quota surface, no benefit at
this scale); bytes in Postgres `bytea` (bloats DB + backups).

See [ADR 0004](../../../docs/adr/0004-avatar-upload-vps-disk.md).
