# Implementation Plan: Account & Authentication

**Branch**: `001-account-auth` | **Date**: 2026-07-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/src/specs/001-account-auth/spec.md`

## Summary

Establish TixHub's identity layer: register (email + optional unique phone + password, bcrypt
cost 12), sign in by email **or** phone, Google OAuth (never merged with a password account),
logout with immediate session revocation, password reset by emailed single-use link, profile
management + password change, and organizer application into an admin approval queue. Roles are
derived, not stored in a single column: Attendee is the base capability, `is_admin` is a flag,
Organizer = an `organizers` row with `status='approved'`.

Technical approach: stateful sessions per **D7** — a short-lived in-memory access token (JWT)
plus a rotating refresh token stored **hashed** in the DB and delivered in an httpOnly cookie
(FR-016). Every session requirement (logout, logout-all, suspend, password change, reset) is a
revocation requirement, so tokens must be stored, not self-contained. Suspension and organizer
capability are read from the DB **per request** so they bite on the next call, not on session
expiry (FR-021, FR-052). Uniform error responses + constant-time verification prevent account
enumeration (FR-011, FR-012, SC-006). Abuse is answered by per-source throttling and progressive
per-identifier delay, **never** account lockout (D-E / **D6**).

## Technical Context

**Language/Version**: TypeScript (strict, `noEmit`) — Node.js 20 LTS (backend), React 18 SPA (frontend), both per constitution stack

**Primary Dependencies**: Express (REST API), `pg` (PostgreSQL driver, parameterized queries only), `bcrypt` (cost 12, SEC-02), `zod` (strict schema validation, FR-042/SEC-07), `jsonwebtoken` (access token), `google-auth-library` (verify Google ID token server-side, FR-026), a rate-limit store, and **Resend** as the transactional-email provider for password reset (`RESEND_API_KEY`/`MAIL_FROM` already in `.env`, currently empty — **gated on constitution amendment**). Avatar upload uses `multer` (multipart) + `sharp` (decode / re-encode / strip EXIF) — see ADR 0004. Frontend: React + Vite, shared TS types from `shared/`.

**Storage**: PostgreSQL on **Neon** (per `.env` `DATABASE_URL`). Uniqueness and no-merge invariants enforced at the DB (partial unique indexes + CHECK), not in application code (FR-004, SC-007).

**Testing**: Vitest. Integration tests share one Postgres DB and truncate between tests (`fileParallelism: false`, `server/tests/helpers/setup.ts`). Coverage gate ≥ 60% on `server/src/modules/auth/**` (already wired in `vitest.config.ts`, MAIN-03 / Principle IV).

**Target Platform**: Single **VPS** at `tixhub.fit` — Nginx (TLS + static SPA + reverse proxy) → Express/Node → Neon Postgres. SPA and API are **same-origin**, so the refresh cookie is `httpOnly; Secure; SameSite=Lax`. TLS is the team's responsibility (SEC-01), not a platform's. See [ADR 0003](../../../docs/adr/0003-deployment-topology.md).

**Project Type**: Web application — `server/` (API) + `src/` (React SPA) + `shared/` (one typed contract, Principle VI).

**Performance Goals**: SC-003 — 95% of sign-in/registration within 3 s under ordinary load. SC-005 — logout makes a session unusable within 1 s. SC-006 — "unknown account" vs "known account, wrong password" response times statistically indistinguishable over 100 samples.

**Constraints**: Free-tier discipline — DB pool ≤ 20 (SCAL-01), request path stateless (SCAL-01), backend peak < ~450 MB. VND integer money only (wallet created at registration, FR-007). Vietnamese user-facing text (USE-03). Vietnamese phone format normalised to one canonical form before uniqueness check. Refresh token httpOnly (unreadable to page scripts, FR-016). No account lockout, ever (D-E).

**Scale/Scope**: Single feature, 7 user stories, ~40 functional requirements. Tables owned/added: `users`, `wallets` (creation only), `refresh_tokens`, `auth_events`, `organizers`, and **`password_resets`** (new — absent from the reference schema; see research.md R-7).

## Constitution Check

*GATE: evaluated before Phase 0 and re-checked after Phase 1 design.*

| Principle | Gate | Verdict |
|---|---|---|
| **II — Security & Trust** | bcrypt cost 12; RBAC enforced server-side on every endpoint (FR-022); refresh token httpOnly + hashed at rest; all input zod-validated; parameterized queries; secrets from env; auth events immutable & separate from admin audit (FR-056); OWASP ZAP zero-High (SC-011/STD-01). | **PASS** (by design) |
| **IV — Verifiable & Test-First** | Auth is critical logic → ≥ 60% coverage (wired). Denial tests asserted, not just happy paths (SC-010, FR-013 ordering, reuse-detection, throttle). Concurrency test for simultaneous registration (SC-007). Timing test (SC-006). | **PASS** (by design) |
| **VI — Clean / One Contract** | Request/response shapes defined once in `shared/` and imported by both sides; error shape uniform; no independent re-declaration. | **PASS** (by design) |
| **V — Simplicity / Free-Tier** | No lockout state, no verification tables, no extra infra. Reuses configured stack. | **PASS** |
| **Architecture — integration cap** | Feature needs **Google** (US3) + **Resend** email (US4). Was a breach of the old two-integration cap. | **RESOLVED** — team **approved the amendment 2026-07-23**; constitution v2.0.0 raises the cap to **four** (VNPay, Gemini, Google, Resend). No longer a violation. |

**Post-Phase-1 re-check**: design introduces no new violation. The only prior breach (Google + Resend over the two-integration cap) is **resolved** — the team approved the amendment on 2026-07-23 and the constitution is now **v2.0.0** (cap = four; wallet refunds in scope; DATA-03 `pending_payment` removed; hosting = VPS). Nothing in this feature is gated on governance any more.

## Project Structure

### Documentation (this feature)

```text
src/specs/001-account-auth/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── auth.openapi.yaml
└── tasks.md             # /speckit-tasks output (NOT created here)
```

### Source Code (repository root)

```text
server/                            # Express API (tsconfig.server.json)
├── src/
│   ├── modules/
│   │   └── auth/                  # this feature (coverage-gated ≥60%)
│   │       ├── auth.routes.ts     # register, login, oauth/google, refresh, logout(-all), me, password/*
│   │       ├── auth.service.ts    # credential verify, session issue/rotate, revocation
│   │       ├── sessions.ts        # refresh-token family: issue, rotate, detect reuse, revoke
│   │       ├── password.ts        # bcrypt hash/verify, reset link mint/consume
│   │       ├── oauth.google.ts    # google-auth-library verify, lookup by (provider, subject)
│   │       ├── organizer.ts       # apply → pending; capability check
│   │       ├── throttle.ts        # per-source rate limit + progressive per-identifier delay (D6)
│   │       ├── auth.repo.ts       # parameterized queries against the tables below
│   │       └── auth.events.ts     # immutable auth_events writes (hashed identifier)
│   ├── middleware/                # requireAuth (access token), requireAdmin, requireOrganizer, validate(zod)
│   ├── db/                        # pool (≤20), migrations
│   └── index.ts                   # excluded from coverage
└── tests/
    ├── auth/                      # integration: happy + every refusal (SC-010)
    └── helpers/setup.ts           # shared DB truncate-between-tests

shared/                            # one typed contract (Principle VI)
└── auth/                          # request/response + error-code types, derived from contracts/auth.openapi.yaml

src/                               # React SPA (tsconfig.web.json; excludes src/specs, src/.specify)
├── pages/auth/                    # register, login, forgot/reset, profile, organizer-apply
├── components/auth/
└── services/authClient.ts         # calls the API using shared/ types; access token in memory only
```

**Structure Decision**: Web application with three roots already fixed by the committed tsconfigs — `server/` (Node/Express, `tsconfig.server.json`), `src/` (React SPA, `tsconfig.web.json`), and `shared/` (imported by both, `@shared/*`). The auth feature is a self-contained module at `server/src/modules/auth/`, matching the coverage path in `vitest.config.ts`. No new top-level roots are introduced.

## Complexity Tracking — ✅ RESOLVED by amendment (constitution v2.0.0, 2026-07-23)

Both items below were breaches of constitution **v1.1.0**. The team **approved the amendment on
2026-07-23**, so under **v2.0.0** neither is a violation any more — the cap is four and hosting is a
VPS. Kept as the record of why the amendment was needed.

| Former violation (now permitted by v2.0.0) | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| **Third & fourth external integrations** (Google OAuth + transactional email), over the constitution's cap of two | US3 uses Google to cut the registration drop-off; US4 (password reset, **P1**) is the **only** way back into a password account after D-B removed email verification and D-C forbade Google-as-alternate-entrance. Every account owns a wallet (FR-007) money enters, so an unreachable account is lost funds — a Principle II failure that outranks scope discipline (D-D). | **Ship without reset**: rejected — trades user funds for schedule, which the constitution's conflict order forbids. **Phone-only recovery / SMS**: rejected — a fifth integration with worse economics (D-A). **Defer Google to post-release**: accepted for US3 (P2) but not for email, which gates release. Resolution path: constitution amendment by team vote before release (already gating, per project memory). Fallback if email is rejected: ship with wallet top-up disabled so no account holds unreachable money. |
| **Hosting = single VPS** instead of the constitution's *Vercel + Render* row | Team already runs `tixhub.fit` on a VPS (Nginx same-origin). Simpler for the auth cookie (first-party Lax) and cheaper, not costlier. | No simpler alternative rejected — it *is* the simpler option. It changes a *listed technology*, so it needs an amendment. **Bundle it into the same amendment PR** as the Google + Resend integration-cap breach — one governance vote, not three. See [ADR 0003](../../../docs/adr/0003-deployment-topology.md). |

## Upstream follow-ups (`/speckit-clarify`, spec layer) — ✅ APPLIED 2026-07-23

Consistency issues found during design review that traced **up** to the spec. All four were applied to
`spec.md` on 2026-07-23 (see its `## Clarifications` section); the table below is the record of what
changed. Plan, data-model, and spec are now aligned.

| Item | Current spec wording | Proposed narrowing | Source |
|---|---|---|---|
| **Reuse-kill scope** | FR-019 / US2-scenario-4: reuse ends "**every remaining session for that account**" (all devices) | Scope to "every session **in that token's family**" (the one device). Account-wide kill is a user-level DoS amplifier and broader than the evidence (a loose token implies only its own family is compromised). Schema D7 already says "family". | [ADR 0002](../../../docs/adr/0002-refresh-token-reuse-detection.md), research R-12 |
| **SC-005 wording (optional)** | "unusable **within 1 second**, verified by an immediate replay" | "unusable **on the next request**, verified by an immediate replay" — removes the wall-clock SLA reading; the guarantee is synchronous under Q1 Option A, not a latency race. | ADR 0001, research R-2 |
| **Reset throttle scope** | FR-032: "limit how often reset links can be requested **for one account**" | "**per submitted identifier**" — a per-account limit only triggers for a registered email, enumerating addresses (contradicts FR-028/FR-040). Throttle on `hash(identifier)+IP` instead. | research R-13 |
| **Avatar = upload, not URL** | Assumption: "avatar is a URL, not an upload; file storage out of scope" | Avatar is **uploaded** through the backend-mediated Cloudinary pipeline; the URL-paste path is dropped for users (Google `picture` seed kept). This reuses the approved managed-media integration. | ADR-0006, research R-14 |

## Design decisions taken during review

- **Session validation = live per-request check** (not a trusted stateless JWT) — [ADR 0001](../../../docs/adr/0001-session-validation-strategy.md), research R-2.
- **Refresh rotation = idempotency-keyed grace + family-scoped kill + 30-day absolute cap** — [ADR 0002](../../../docs/adr/0002-refresh-token-reuse-detection.md), research R-12. Adds columns `family_started_at`, `idempotency_key` and index `UNIQUE(parent_id)` to `refresh_tokens`.
- **Deployment = single VPS (`tixhub.fit`), Nginx, same-origin SPA** — [ADR 0003](../../../docs/adr/0003-deployment-topology.md), research R-5. Cookie `SameSite=Lax`; throttle source = trusted `req.ip` via `trust proxy=1` + Nginx XFF-overwrite, keyed `/32`-v4 // `/64`-v6.
- **Avatar = device upload → backend validation → Cloudinary CDN** (not URL paste) — [ADR-0006](../../../docs/adr/0006-cloudinary-media-storage.md), research R-14. Adds `POST /api/me/avatar`; `multer`+`sharp`; raster-only, SVG-banned, magic-byte + re-encode.
