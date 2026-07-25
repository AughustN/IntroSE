# Project Log

## Version of req

Dependencies installed for the monorepo (`npm install`), branch `BE`, 2026-07-23.

### Runtime dependencies

| Package | Version | Role |
|---|---|---|
| express | 4.22.2 | REST API |
| pg | 8.22.0 | PostgreSQL driver |
| bcrypt | 6.0.0 | password hashing (cost 12) |
| sharp | 0.35.3 | avatar re-encode / strip EXIF |
| jsonwebtoken | 9.0.3 | access token |
| google-auth-library | 9.15.1 | verify Google ID token |
| resend | 4.8.0 | transactional email (password reset) |
| multer | 2.2.0 | multipart avatar upload |
| zod | 3.25.76 | strict schema validation |
| cookie-parser | 1.4.7 | refresh cookie |
| uuid | 11.1.1 | random avatar filenames |
| dotenv | 17.x | env loading |
| react | 19.2.7 | SPA |
| react-dom | 19.x | SPA |
| lucide-react | ^1.17.0 | icons (FE) |
| motion | ^12.23.24 | animation (FE) |
| @google/genai | ^2.4.0 | Gemini (AI features) |

### Dev dependencies

| Package | Version |
|---|---|
| vite | 6.4.3 |
| @vitejs/plugin-react | 5.2.0 |
| @tailwindcss/vite / tailwindcss | 4.1.x |
| typescript | ~5.8.2 |
| tsx | 4.22.4 |
| vitest / @vitest/coverage-v8 | 2.1.9 |
| eslint | ^9.17.0 |
| prettier | ^3.4.2 |
| @types/* | node 22.x, express, pg, bcrypt, jsonwebtoken, multer, cookie-parser |

### Security bumps applied during install

- **bcrypt 5.1.1 → 6.0.0** — drops the `node-pre-gyp → tar` chain (was critical + high). Cost-12 API unchanged.
- **sharp 0.33.5 → 0.35.3** — patches libvips CVEs (high). Matters because sharp processes untrusted uploaded images (ADR 0004).
- **multer 1.4.5-lts → 2.2.0** — 1.x deprecated / vulnerable.

### Final `npm audit --omit=dev`

- **0 critical, 0 high.**
- **2 moderate (accepted)**: transitive `gaxios → uuid` inside `google-auth-library`. Not fixable without an upstream update; the vulnerable `uuid` path (`buf`-bounds) is not reached by gaxios's usage.

### Notes

- Node engine warning: `@vitejs/plugin-react` wants Node ≥ 22.12; machine runs 22.10 → warning only, builds fine. Upgrade Node to silence.
- `sharp` native binary builds/loads OK on Windows; `resend` (ESM) loads OK.

---

## Work log — 2026-07-23 → 2026-07-24 (branch `BE`, local only, not pushed)

Assembled the monorepo (FE from branch `FE` into `src/`, BE in `server/`, shared contract in
`shared/`, one root `package.json`) and shipped **two features** end-to-end via the full Spec Kit flow
(specify → clarify/grill → plan → tasks → analyze → implement).

### Feature 001 — Account & Authentication (`src/specs/001-account-auth`) — DONE

Full email/password + Google OAuth identity. Migration `0001_auth.sql` (users, wallets, refresh_tokens,
password_resets, auth_events, organizers).

| Area | What shipped |
|---|---|
| Register / login | email + optional unique phone + password (bcrypt 12); sign in by email OR phone; wallet created at registration |
| Sessions | short JWT access token (in memory) + rotating httpOnly refresh cookie; **reuse detection kills the family**; live per-request check (suspend/logout bite next request) |
| Recovery | password reset by emailed single-use link (Resend + ConsoleMailer) |
| Profile | edit nickname/phone, **avatar upload** (magic-byte + sharp re-encode + SVG ban, on VPS disk) |
| Organizer | apply → pending queue; capability derived per request |
| Abuse | per-source throttle + progressive per-identifier delay; **no lockout** |
| Google | verify ID token; keyed by provider subject; never merged with a password account |

- **4 ADRs** (`docs/adr/`): session validation, refresh-token reuse detection, VPS deployment topology, avatar upload.
- **Constitution amended to v2.0.0** (team-approved): integration cap 2 → 4 (+Google, +Resend); wallet refunds in scope; DATA-03 `pending_payment` removed (wallet-only atomic checkout); hosting → single VPS.
- FE (kept the imported cinema UI style): AuthModal (login/register/forgot/Google GSI), full-screen AccountModal, ResetPassword page, header avatar.
- **38 integration tests, ~95% coverage** on `server/src/modules/auth/**`.

### Feature 002 — Event Catalog & Discovery (`src/specs/002-event-catalog`) — DONE

Migration `0002_catalog.sql` (event_categories seeded, venues **+created_by**, sections, seats, events,
showtimes, ticket_tiers, showtime_seats, audit_logs).

| Story | What shipped |
|---|---|
| US1-3 | public browse/search/filter, event detail by stable slug, showtimes, **read-only seat map** |
| US4 | organizer create/edit/publish events (**pre-publish moderation** — public only after admin approval) |
| US5 | venues + sections/seats + **per-section seat-map generation** |
| US6 | admin moderation queue: approve / reject / flag / remove (writes `audit_logs`) |
| US7 | SEO — server-renderable title/description, Open Graph, JSON-LD `Event`, canonical slug |

- **Visibility predicate** (`catalog/visibility.ts`): public ⟺ `on_sale ∧ approved ∧ organizer.approved`, computed live on every read — the anti-leak control (drafts / pending / suspended-organizer never leak).
- FE: browse/detail now read the **real API** (`catalogClient` + `catalogAdapter` mapping onto the existing `MovieEvent` UI); OrganizerPanel, AdminModeration, SeatMapBuilder, SeatMapView.
- **19 catalog integration tests**.

### Key technical conventions (this session)

- **pg parses BIGINT (int8) as JS Number** — `server/src/db/pool.ts` `setTypeParser(20)`; required for strict owner checks + numeric id validation.
- **Vite dev proxy** `/api` → `127.0.0.1:4000` (IPv4, avoids Windows `localhost`→`::1` ECONNREFUSED).
- **`npm run seed`** (`server/src/db/seed-dev.ts`) loads the 5 original demo events (from `src/data.ts`, Unsplash images) into the DB. One shared Neon branch for dev + test; `npm run test` TRUNCATEs it (re-seed to view on the browser).
- Organizer/admin routers mounted on their own paths (`/api/organizer`, `/api/admin`) so `requireOrganizer`/`requireAdmin` don't leak onto other routes.
- Seeded demo events are all `general_admission`; seat-map view shows tier availability for GA and a seat grid for seated events.

### Test & quality status

- **Full suite: 57/57 pass** (38 auth + 19 catalog), 17 files.
- **Web + server typecheck: 0 errors.**

### Commits (branch `BE`, author `Aughust`, no push)

| Hash | Summary |
|---|---|
| `d4b4a80` | feat(auth): implement account & authentication (001) |
| `b85c7d8` | feat(catalog): event catalog & discovery (002) — public read + organizer/admin write |
| `aeb2b57` | feat(catalog): seat-map generation (US5) |
| `7263a60` | feat(catalog): seat-map UI — organizer builder + buyer read-only view |
| `311bab6` | feat(catalog): SEO for event pages + polish (US7) |

### Deferred

- Auth: OWASP ZAP baseline scan (T053), perf load test (T057).
- Catalog: search-latency load-test harness (T034).
- **Next feature (designed, not built):** seat holds / reservations — `available → held → sold`, no double-sell (DATA-02), TTL auto-release, real-time (Socket.IO), login-gated. Selecting/holding a seat is NOT yet implemented; the catalog seat map is read-only.

---

## Feature 003 — Seat Holds & Reservations (2026-07-24)

Built on branch `BE`. The real-time hold layer between the read-only catalog (002) and checkout (004).

| Story | What shipped |
|---|---|
| US1 | hold-on-select: click a seat → concurrency-safe hold (`SELECT … FOR UPDATE`), owner = session user, 8-ticket cap, idempotent re-hold |
| US2 | one reservation clock (7 min), sweeper releases on the DB's clock even with the client gone; one-time top-up grace (+7, ceiling 14) for 004 |
| US3 | Socket.IO room per showtime, `seat:update` broadcast after every committed transition; DB stays the source of truth (socket is advisory) |
| US4 | general admission holds a quantity via `ticket_tiers.reserved_quantity`; never oversold |
| US5 | add/remove seats, cancel, running total + expiry on one active reservation per (user, showtime) |

- **Migration `0003_holds.sql`**: `reservations` (`extended_once`, partial unique index `uq_reservation_active`), `reservation_items`.
- **Migration runner is now idempotent** — `schema_migrations` ledger; re-running `npm run db:migrate` is a no-op (0001/0002 backfilled on their "already exists" error).
- **`tsx` needs `--tsconfig tsconfig.server.json`** (dev:server / seed / migrate): the `@shared/*` path is only resolved from that config, and 003 is the first feature to import shared **values** (event names), not just types. Vitest needed the same alias in `vitest.config.ts`.
- FE: `holdsClient` + `seatSocket`; `SeatLayout` is now the real map (the `Math.sin` mock is gone); the flow-scoped hold session (App-owned) survives chọn suất ↔ chọn ghế ↔ thanh toán and is released only on leaving the flow or on expiry.

### Test & quality status

- **Full suite: 104/104 pass** (38 auth + 19 catalog + 47 holds), 24 files.
- **Holds coverage: 97% repo / 95% service** — the ≥60% gate (MAIN-03) is wired for `server/src/modules/holds/**`.
- **Web + server typecheck: 0 errors.**
- Live check against the running server: hold broadcast reached a second (guest) client in **~400 ms**, release in ~300 ms — inside PERF-03's 1 s p95.

### Deferred

- k6 WebSocket harness for PERF-03 / PERF-06 (shared with catalog T034).
- Order conversion (`held → sold`), wallet debit, tickets — feature 004. A mock purchase currently leaves its reservation to expire.
