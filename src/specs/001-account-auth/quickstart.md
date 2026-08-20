# Quickstart & Validation: Account & Authentication

Runnable validation for feature 001-account-auth. Proves the auth slice works end-to-end. Details
live in [data-model.md](./data-model.md) and [contracts/auth.openapi.yaml](./contracts/auth.openapi.yaml);
this is the run/verify guide, not the implementation.

## Prerequisites

- Node.js 20 LTS, PostgreSQL reachable (Neon/Supabase free tier or local).
- `.env` with `DATABASE_URL`, `JWT_SECRET`, `AUTH_EVENT_HASH_KEY` (keyed-hash for `identifier_hash`), and — **when the constitution amendment lands** — `GOOGLE_CLIENT_ID` and `RESEND_API_KEY`/`MAIL_FROM`. US1/US2/US5/US6/US7 run without the last two. Empty `RESEND_API_KEY` → `ConsoleMailer` (reset links print to the terminal), which is what the test suite uses.
- **Resend deliverability**: `MAIL_FROM` is `no-reply@tixhub.fit`; the `tixhub.fit` domain must be verified in Resend with SPF + DKIM DNS records or reset mail lands in spam / is rejected. DevOps task, not code.
- **Avatar uploads**: Cloudinary credentials are configured for the backend-mediated managed-media pipeline (ADR-0006). Local development may use the service's deterministic mock CDN URL when credentials are absent.
- Migrations applied (adds `password_resets`, new to the reference schema — see research R-7).

## Setup

```bash
npm install
npm run db:migrate          # creates users, wallets, refresh_tokens, auth_events, organizers, password_resets
npm run dev:server          # Express API on :3000
npm run dev:web             # Vite SPA
```

## Validate by user story

Each maps to the spec's Independent Test. Run against the API; the SPA exercises the same contract.

### US1 — Register and stay signed in (P1)
1. `POST /api/auth/register` with a fresh email, nickname, password (+confirm) → `201`, access token, `tix_refresh` cookie, and a wallet row exists with balance 0. **(FR-007)**
2. `POST /api/auth/refresh` using the cookie → `200`, new access token → reload/browser-restart recognition. **(FR-015, SC-004)**
3. `POST /api/auth/login` with the **phone** and password → `200`. **(FR-010)**
4. Wrong password → `401 invalid_credentials`; unknown identifier → `401 invalid_credentials` in **indistinguishable time**. **(FR-011/012, SC-006)**
5. Duplicate email → `409 email_taken`; 100 simultaneous registrations on one email → exactly **1** account. **(SC-007)**

### US2 — End a session (P1)
1. `POST /api/auth/logout` → prior refresh token rejected within 1 s. **(SC-005)**
2. Sign in on two clients, `POST /api/auth/logout-all` → both rejected. **(FR-018)**
3. Replay a rotated refresh token → `401`, whole family revoked (`reuse_detected`). **(FR-019)**

### US3 — Google sign-in (P2) *(needs the Google integration / amendment)*
1. `POST /api/auth/oauth/google` as a new visitor → `201`, account holds no password.
2. Repeat same Google account → `200`, no duplicate.
3. Google credential whose email belongs to a password account → `409 email_registered_with_password`, never linked. **(D5, SC-012)**
4. Register with a password on a Google-owned email → `409 email_registered_with_google`.

### US4 — Password reset (P1) *(needs the email integration / amendment)*
1. `POST /api/auth/password/forgot` for a known email → `200`, single-use link mailed; for an unknown email → **identical** `200`, no mail. **(FR-028)**
2. `POST /api/auth/password/reset` with the token → password replaced, **all** sessions revoked, link cannot be reused. **(FR-030, FR-029)**
3. Expired link → refused; a Google account's forgot request → same `200`, mints nothing. **(FR-053, D5)**

### US5 — Profile & change password (P3)
1. `PATCH /api/me` nickname/phone → persists across reload. **(FR-033)** Avatar is set separately: `POST /api/me/avatar` with a jpeg/png/webp ≤2MB → backend validates and re-encodes it, then `avatarUrl` stores the resulting Cloudinary secure URL. A `.svg` or a renamed non-image → `400 invalid_image`. **(ADR-0006)**
2. `POST /api/me/password` with correct current → old password stops working; **other** sessions revoked, this one stays alive. **(FR-057)**
3. Wrong current password → `403`, existing password still valid.
4. `PATCH /api/me` submitting `isAdmin`/`balance` → ignored, privileges unchanged. **(FR-035/008)**

### US6 — Organizer application (P3)
1. `POST /api/organizers/apply` → `201` pending; account still cannot act as organizer. **(FR-038)**
2. Apply again while pending → `409 already_pending`. Flip a row to `approved` in the DB → organizer action allowed on the **next** request. **(FR-021)**
3. Rejected → re-apply succeeds (new row); suspended → `409 suspended_cannot_reapply`. **(FR-058/059)**

### US7 — Resist credential guessing (P3)
1. Drive >100 login failures/min from one source → `429`; the targeted account still signs in from **another** source. **(SC-009)**
2. Fail 50 times against one identifier, then the correct password → **accepted** (no lockout). **(SC-013, D-E)**
3. Throttle response identical whether or not the account exists. **(FR-040)**

## Automated test gate

```bash
npm run test                # Vitest; server/tests/auth/** — happy path AND every refusal (SC-010)
npm run test:coverage       # ≥60% on server/src/modules/auth/** (MAIN-03, wired in vitest.config.ts)
npm run typecheck && npm run lint
```

Before submission: OWASP ZAP baseline scan reports **zero High-severity** alerts (SC-011 / STD-01).
