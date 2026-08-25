# Tasks: Account & Authentication

**Input**: Design documents from `/src/specs/001-account-auth/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/auth.openapi.yaml, quickstart.md

**Tests**: REQUIRED for this feature. Auth is security-critical → Constitution Principle IV + MAIN-03
(≥60% coverage on `server/src/modules/auth/**`, wired in `vitest.config.ts`), and SC-010 requires an
automated test for **every** refusal, not just the happy path. Write the test first and see it fail.

**Organization**: by user story (priority order). P1 = US1, US2, US4 (the releasable slice); P2 = US3;
P3 = US5, US6, US7.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependency on an incomplete task → parallelizable.
- **[Story]**: US1…US7 for story-phase tasks only.

## Path Conventions (from plan.md — web app, same-origin VPS)

- Backend: `server/src/…`, tests `server/tests/…` (`tsconfig.server.json`)
- Shared contract: `shared/auth/…` (imported by both sides, Principle VI)
- Frontend SPA: `src/…` (`tsconfig.web.json`)

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Create the backend/shared/frontend skeleton per plan.md: `server/src/{modules/auth,middleware,db}`, `server/tests/{auth,helpers}`, `shared/auth/`, `src/{pages/auth,components/auth,services}`
- [X] T002 Initialize `package.json` and install deps — runtime: `express`, `pg`, `bcrypt`, `zod`, `jsonwebtoken`, `google-auth-library`, `multer`, `sharp`, `resend`, `uuid`, `cookie-parser`; dev: `vitest`, `tsx`, `@types/*` — and wire scripts `dev:server`, `dev:web`, `db:migrate`, `test`, `test:coverage`, `typecheck`, `lint`
- [X] T003 [P] Confirm the staged `tsconfig.{base,server,web}.json`, `eslint.config.js`, `.prettierrc`, `vitest.config.ts` resolve against the new dirs; create `server/tests/helpers/setup.ts` that TRUNCATEs `users/wallets/refresh_tokens/password_resets/auth_events/organizers` CASCADE between tests
- [X] T004 [P] Env loader + fail-fast validation in `server/src/config.ts`: **REQUIRE** `DATABASE_URL`, `JWT_SECRET`, `AUTH_EVENT_HASH_KEY`; treat `GOOGLE_CLIENT_ID` and `RESEND_API_KEY` as **optional/gated** (empty → Google disabled / `ConsoleMailer`); `MAIL_FROM` defaulted

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ No user-story work begins until this phase is complete.**

- [X] T005 Migration `server/src/db/migrations/0001_auth.sql` part 1 — `users` (all columns) + `wallets`, with `users_email UNIQUE`, `uq_users_phone` partial, `uq_users_provider_subject` partial, `users_credential_matches_provider` CHECK, `status` CHECK, `wallet_balance_non_negative` CHECK (data-model.md)
- [X] T006 Migration `0001_auth.sql` part 2 — `refresh_tokens` (incl. `family_started_at`, `idempotency_key`, `uq_refresh_parent` UNIQUE(parent_id) partial, live/family/expired indexes), `password_resets`, `auth_events` (nullable user, `identifier_hash`, 3 indexes), `organizers` (`uq_organizers_live_application`, history indexes)
- [X] T007 [P] Postgres pool (`max` ≤ 20, SCAL-01) in `server/src/db/pool.ts` and a migration runner in `server/src/db/migrate.ts`
- [X] T008 [P] Derive shared TS types from `contracts/auth.openapi.yaml` — `Error`, `AuthSuccess`, `Me`, request bodies, and the error-code string union — in `shared/auth/types.ts` (Principle VI: both sides import these)
- [X] T009 [P] Identifier util in `server/src/modules/auth/identifier.ts`: email lowercase+trim; VN phone → canonical `+84…`; strict `classify(identifier)` → email | phone | unknown (R-8)
- [X] T010 [P] Password util in `server/src/modules/auth/password.ts`: bcrypt hash/verify cost 12, plus a constant-time dummy-verify for the unknown-identifier path (R-4, FR-006/012)
- [X] T011 [P] Auth-event writer in `server/src/modules/auth/auth.events.ts`: immutable insert, keyed-hash of identifier (never raw), nullable `user_id` (FR-041/054/055/056)
- [X] T012 [P] Parameterized repo in `server/src/modules/auth/auth.repo.ts`: find user by email/phone/(provider,subject), create user+wallet in one transaction, live status read (FR-004/007/023)
- [X] T013 Sessions core in `server/src/modules/auth/sessions.ts`: issue family + sign access JWT (`sub,fam,iat,exp,iss,aud`, ~15m — Q7); rotate under `SELECT … FOR UPDATE` on the presented row with idempotency-key grace, reuse→**family-scoped** kill, 30-day absolute cap; revoke one/all/family helpers (D7, R-12, ADR 0002) — depends T006, T007, T010, T011
- [X] T014 [P] `validate(zodSchema)` middleware in `server/src/middleware/validate.ts` (FR-042)
- [X] T015 requireAuth middleware in `server/src/middleware/requireAuth.ts` — Option A live check: verify JWT signature, then read `users.status` and confirm the `fam` family is still live; 401/403 on fail (ADR 0001, FR-021/052) — depends T012, T013
- [X] T016 [P] `requireAdmin` + `requireOrganizer` (capability derived per request from `organizers`) in `server/src/middleware/authz.ts` (FR-020/021/038)
- [X] T017 [P] Uniform error shape, error handler, and request logging (no credentials) in `server/src/middleware/error.ts` (Principle VI, FR-006)
- [X] T018 Express bootstrap in `server/src/index.ts`: `trust proxy = 1`, cookie-parser, JSON body limit, mount `/api`, serve `uploads/` static with `X-Content-Type-Options: nosniff` (ADR 0003/0004) — excluded from coverage

**Checkpoint**: schema, shared types, session core, and middleware ready.

---

## Phase 3: User Story 1 — Create an account and stay signed in (P1) 🎯 MVP

**Goal**: register (email + optional unique phone + password), sign in by email **or** phone, stay recognised across reload/restart.

**Independent Test**: register via the form, reload, still recognised; sign in again in a fresh browser with the same credentials.

- [X] T019 [P] [US1] Integration tests in `server/tests/auth/register.test.ts`: valid → 201 + wallet row + cookie; duplicate email → 409 `email_taken`; weak/mismatched password → 400; **100 concurrent registrations on one email → exactly 1 account** (SC-007)
- [X] T020 [P] [US1] Integration tests in `server/tests/auth/login.test.ts`: sign in by email **and** by phone; wrong password → 401 `invalid_credentials`; unknown identifier → 401 in **indistinguishable time** (SC-006); malformed identifier → 401 (not 400)
- [X] T021 [P] [US1] Integration tests in `server/tests/auth/refresh-me.test.ts`: refresh rotates and keeps the user recognised (SC-004); `GET /me` returns the `Me` shape incl. derived `isOrganizer`
- [X] T022 [US1] Register route+service in `server/src/modules/auth/auth.routes.ts` + `auth.service.ts`: validate, normalize, insert user+wallet in one txn, issue session, set `tix_refresh` cookie, sign in immediately (FR-001–008, 043)
- [X] T023 [US1] Login route: classify identifier, verify password with dummy-timing fallback, check suspension **after** verify, `account_uses_google` for password-less accounts, issue session (FR-010–014)
- [X] T024 [US1] Refresh route wired to sessions core, sets rotated cookie (FR-015)
- [X] T025 [US1] `GET /me` route behind requireAuth returning `Me` (FR-023)
- [X] T026 [P] [US1] FE: register + login pages and `src/services/authClient.ts` (access token in memory only; single-flight refresh on 401; optional proactive refresh) in `src/pages/auth/`

**Checkpoint**: an attendee can register and sign in independently.

---

## Phase 4: User Story 2 — End a session deliberately (P1)

**Goal**: logout and logout-everywhere revoke immediately; a replayed/superseded token is refused.

**Independent Test**: sign in, sign out, replay the old session → refused; sign in on two devices, sign out everywhere → both refused.

- [X] T027 [P] [US2] Integration tests in `server/tests/auth/logout-reuse.test.ts`: logout → replay refused on the next request (SC-005); logout-all → both devices refused (FR-018); reuse of a superseded token → **its family** killed + `session_reuse_detected` event, other logins untouched (FR-019, family-scoped); a token revoked for any **other** reason → plain 401, no family kill
- [X] T028 [US2] `POST /auth/logout` + `POST /auth/logout-all` routes (revoke one / all live rows in the family / user) (FR-017/018)
- [X] T029 [US2] Assert the idempotency-keyed grace + family-scoped reuse kill path in refresh (built in T013) against the honest-double-refresh and thief scenarios (R-12)
- [X] T030 [P] [US2] FE: "log out" and "sign out everywhere" controls calling the endpoints in `src/components/auth/`
- [X] T056 [P] [US2] Integration tests in `server/tests/auth/suspension.test.ts`: a suspended account is refused sign-in with the suspension message shown **only after** password/provider verify (FR-013/051); an active session is refused on the very next request once status→suspended, via the requireAuth live-status read (FR-052, ADR 0001); a reset request for a suspended account returns the same uniform response as any other (FR-053). Status is set directly in the DB (the admin screen that sets it is out of scope — spec Assumptions).

**Checkpoint**: sessions are reliably revocable.

---

## Phase 5: User Story 4 — Recover a forgotten password (P1)

**Goal**: request a single-use emailed reset link and set a new password; all sessions end.

**Independent Test**: request a reset for a known account, follow the link, set a new password, sign in with it, confirm the old one fails.

- [X] T031 [P] [US4] Integration tests in `server/tests/auth/password-reset.test.ts`: `forgot` returns an **identical** 200 for registered / unregistered / Google addresses (FR-028/053); reset is single-use, replaces the hash, and **revokes every family** (FR-029/030); expired link refused; throttle returns 429 keyed on `hash(identifier)+IP`, identical for real/fake (R-13)
- [X] T032 [US4] Mailer in `server/src/modules/auth/mailer.ts`: Resend adapter + `ConsoleMailer` fallback when `RESEND_API_KEY` is empty (tests force console)
- [X] T033 [US4] `POST /auth/password/forgot`: mint a hashed `password_resets` row, send the link, uniform response, throttle on `hash(identifier)+IP` (FR-027/028/031/032, R-13)
- [X] T034 [US4] `POST /auth/password/reset`: consume the token atomically, replace `password_hash`, revoke all families (`password_reset`), refuse expired/consumed/Google (FR-029/030/053)
- [X] T035 [P] [US4] FE: forgot + reset pages in `src/pages/auth/`

**Checkpoint**: password accounts have a working recovery path (P1 slice complete).

---

## Phase 6: User Story 3 — Sign in with Google (P2)

**Goal**: register/sign in with Google; never merged with a password account.

**Independent Test**: complete Google sign-in as a new visitor → account exists; repeat → no duplicate.

- [X] T036 [P] [US3] Integration tests in `server/tests/auth/oauth-google.test.ts`: new Google user → 201 + wallet, no password; repeat → 200, no duplicate; colliding email both directions → `email_registered_with_password` / `email_registered_with_google` and never linked (SC-012); suspended checked after provider verify
- [X] T037 [US3] `POST /auth/oauth/google` in `server/src/modules/auth/oauth.google.ts`: verify the ID token (`google-auth-library`, `aud/iss/exp`), look up by `(provider,provider_user_id)`, create account+wallet seeding `nickname` from `name` and `avatar_url` from `picture` (https only), collision 409s (FR-024–026, 045–047, R-6)
- [X] T038 [P] [US3] FE: Google sign-in button + flow in `src/pages/auth/`

**Checkpoint**: Google is an alternate entrance, never a merge.

---

## Phase 7: User Story 5 — Manage profile and change password (P3)

**Goal**: update nickname/phone, upload an avatar, change password (revoking other sessions).

**Independent Test**: change nickname/phone/avatar and confirm persistence across reload; change password and confirm the old one stops working.

- [X] T039 [P] [US5] Integration tests in `server/tests/auth/profile.test.ts`: `PATCH /me` nickname/phone persist; unknown/privilege fields ignored (FR-035/008); `phone_taken` 409 (FR-050); change-password revokes **other** families but keeps the current session (FR-057); wrong current password → 403
- [X] T040 [P] [US5] Integration tests in `server/tests/auth/avatar.test.ts`: jpeg/png/webp upload → 200 + `avatarUrl` under `/uploads/avatars/`; SVG or renamed non-image → 400 `invalid_image`; >2MB → 400; stored file is re-encoded with a random uuid name (ADR 0004)
- [X] T041 [US5] `GET/PATCH /me` (allow-list nickname/phone only) + `POST /me/password` (verify current, revoke other families) (FR-033/034/035/057)
- [X] T042 [US5] `POST /me/avatar` in `server/src/modules/auth/avatar.ts`: multer, magic-byte type check, SVG ban, `sharp` re-encode (strip EXIF), uuid filename, disk write, delete previous (ADR 0004)
- [X] T043 [P] [US5] FE: profile page + avatar upload widget + change-password form in `src/pages/auth/`

**Checkpoint**: a signed-in user can manage their account.

---

## Phase 8: User Story 6 — Apply to become an organizer (P3)

**Goal**: submit an organizer application into the admin queue; capability derived from an approved row.

**Independent Test**: apply as an attendee → pending, still can't act as organizer; flip to approved → capability turns on.

- [X] T044 [P] [US6] Integration tests in `server/tests/auth/organizer.test.ts`: apply → pending; second apply while pending → 409; rejected → re-apply creates a new row; suspended → refused (FR-059); organizer-only action allowed only when approved; suspension bites on the next request (SC-008)
- [X] T045 [US6] `POST /organizers/apply` + capability derivation in `server/src/modules/auth/organizer.ts` (one live application, rejected re-apply, suspended refuse, history retained) (FR-036/037/038/058/059/060)
- [X] T046 [P] [US6] FE: organizer application form in `src/pages/auth/`

**Checkpoint**: the pending-application queue exists and gates organizer actions.

---

## Phase 9: User Story 7 — Resist credential guessing (P3)

**Goal**: throttle per source, slow per identifier, never lock the owner out.

**Independent Test**: drive failed sign-ins from one source past the threshold and confirm the source is throttled while the same account still signs in from a different source.

- [X] T047 [P] [US7] Integration tests in `server/tests/auth/throttle.test.ts`: a source at ~100 logins/min is throttled while the targeted owner signs in from another source (SC-009); 50 failures against one identifier then the correct password → accepted, no lockout (SC-013); throttle responses identical for registered/unregistered (FR-040)
- [X] T048 [US7] Throttle module in `server/src/modules/auth/throttle.ts`: per-source fixed window on `req.ip` (`/32`-v4 // `/64`-v6, via `trust proxy=1` + Nginx XFF-overwrite), progressive per-identifier delay from `auth_events`, applied equally to unknown identifiers, no lockout state (FR-039/040/048/049, D6, R-5)
- [X] T049 [US7] Apply throttle middleware to `login`/`register`/`forgot`; verify equal timing and response shape (FR-011/012/040)

**Checkpoint**: abuse is slowed without punishing the owner.

---

## Phase 10: Polish & Cross-Cutting

- [X] T050 [P] Sample Nginx config in `docs/deploy/nginx.conf`: TLS, static SPA, `/api` reverse proxy, `X-Forwarded-For $remote_addr` overwrite, `uploads/` static + `nosniff` (ADR 0003/0004)
- [X] T051 [P] Add `dist/` to `.gitignore` and set `<title>TixHub</title>` in the FE source `index.html` so builds keep the title
- [X] T052 Run `test:coverage`; ensure ≥60% on `server/src/modules/auth/**` (MAIN-03), close gaps
- [ ] T053 [P] OWASP ZAP baseline scan → zero High-severity (SC-011 / STD-01)
- [X] T054 Execute `quickstart.md` end-to-end for every user story
- [X] T055 [P] Verify `shared/auth/types.ts` is imported by both server and FE with no independently re-declared payloads (Principle VI)
- [ ] T057 Perf check for SC-003 in `server/tests/perf/auth.load.js`: drive sign-in + register under ordinary load (autocannon/k6) and assert p95 < 3s for 95% of requests, against a seeded DB

---

## Dependencies & Execution Order

- **Setup (P1)** → **Foundational (P2)** blocks everything.
- Within Foundational: T005→T006 (schema) before T007/T012/T013; T013 (sessions) before T015; T008 shared types unblock all endpoints and FE.
- **P1 stories**: US1 (Phase 3) first — it establishes the signed-in state US2/US4 build on. US2 and US4 depend only on Foundational + US1's session issuance; they are otherwise independent of each other.
- **US3/US5/US6/US7** each depend only on Foundational (+ requireAuth); independently testable.
- US7's throttle (T048/T049) wraps existing endpoints — implement after US1/US4 routes exist, or stub the routes it decorates.
- **Polish (Phase 10)** after the targeted stories.

## Parallel Opportunities

- Setup: T003, T004 in parallel.
- Foundational: T007–T012, T014, T016, T017 are all `[P]` (distinct files) once T005/T006 land; T013 then T015 are the serial spine.
- Every story's test task (`T019/T020/T021`, `T027`/`T056`, `T031`, `T036`, `T039/T040`, `T044`, `T047`) is `[P]`.
- All FE tasks (`T026/T030/T035/T038/T043/T046`) run parallel to their backend once shared types (T008) exist.
- After Foundational, US1→then US2/US4/US3/US5/US6/US7 can be split across developers.

## Parallel Example — User Story 1

```bash
# Tests first (fail), in parallel:
Task: "Integration tests register in server/tests/auth/register.test.ts"
Task: "Integration tests login in server/tests/auth/login.test.ts"
Task: "Integration tests refresh+me in server/tests/auth/refresh-me.test.ts"
# Then backend routes (serial in auth.routes.ts) alongside FE (parallel):
Task: "FE register+login pages + authClient in src/pages/auth/"
```

## Implementation Strategy

- **MVP = the P1 slice**: Setup → Foundational → US1 → US2 → US4. That is a signed-in, revocable, recoverable account with a wallet — the smallest safely-shippable auth. (US1 alone is demoable; US2+US4 are required before real users per the spec's P1 rationale.)
- **Increment**: add US3 (Google), then US5/US6/US7, each independently testable and deployable.
- **Gate before submission**: T052 (coverage), T053 (ZAP zero-High), T054 (quickstart).

## Notes

- Google (US3) and Resend email (US4) are permitted — constitution v2.0.0 (amendment 2026-07-23) raised the integration cap to four; no governance gate remains.
- `[P]` = different files, no incomplete-task dependency. Commit after each task or logical group.
- Every refusal path has a test (SC-010): duplicate, wrong-password, unknown-timing, reuse, suspended, collision, throttle, invalid-image.
