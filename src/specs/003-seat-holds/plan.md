# Implementation Plan: Seat Holds & Reservations

**Branch**: `003-seat-holds` | **Date**: 2026-07-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-seat-holds/spec.md`

## Summary

The real-time seat-holding layer between the read-only catalog (002) and checkout (004). A signed-in
attendee clicks a seat on a live map and it is held for them immediately (hold-on-select, Model A),
concurrency-safe so two buyers never get the same seat (DATA-02); a single 7-minute reservation clock
auto-releases via a sweeper even on disconnect (REL-02), with one bounded top-up grace (+7, ceiling
14 min); GA holds a quantity against a tier; changes broadcast over Socket.IO so every viewer's map
updates within ~1 s (PERF-03/06). New `reservations` + `reservation_items` tables (migration 0003).
Order conversion, wallet, tickets belong to 004.

## Technical Context

**Language/Version**: TypeScript (strict), Node.js 22, React 19 — same stack as 001/002.

**Primary Dependencies**: Express (REST), **Socket.IO (new, server) + socket.io-client (new, web)**,
`pg` (row-level locking), Zod (input validation), existing auth (`verifyAccessToken`,
`familyHasLiveToken` in `server/src/modules/auth/sessions.ts`).

**Storage**: PostgreSQL (Neon). New tables `reservations`, `reservation_items` in
`server/src/db/migrations/0003_holds.sql`; transitions the existing `showtime_seats` and
`ticket_tiers` (002). Money as whole VND đồng (BIGINT).

**Testing**: Vitest + supertest (backend integration, mirrors `server/tests/`), plus a k6 harness
(deferred, shared with catalog T034) for PERF-03/06.

**Target Platform**: Single VPS (Nginx, same-origin) + Neon; browsers 360–1920 px.

**Project Type**: Web application (monorepo: `server/` backend, `src/` React SPA, `shared/` contract).

**Performance Goals**: seat-update round trip < 1 s p95 (PERF-03); ≥ 60 concurrent viewers on one
showtime map with 0% double-sell (PERF-06); REST reads < 500 ms p95 (PERF-02).

**Constraints**: stateless request path so the seat-lock guarantee holds on the transaction-pooled
endpoint (SCAL-01); DB is the source of truth, socket updates are advisory (FR-023); no seat held
without an owner (FR-001); bounded DB pool ≤ 20.

**Scale/Scope**: academic demo; one hot showtime ≈ 60 concurrent VUs; catalog ≤ 500 events.

## Constitution Check

*GATE: must pass before Phase 0; re-checked after Phase 1.*

| Principle | Gate | Status |
|---|---|---|
| I — Reliability Under Load | DB is source of truth; no double-sell; serialized holds (DATA-02); ACID; explicit `available→held→sold` lifecycle; proven by concurrency + TTL tests, not a clean demo | **PASS** — `SELECT … FOR UPDATE` + partial unique index; sweeper; parallel-buyers test is SC-001 |
| II — Security & Trust | RBAC on every endpoint; server-authoritative identity; no client-supplied user id | **PASS** — all reservation routes behind `requireAuth`; socket handshake re-uses the same live check; owner enforced server-side (FR-024) |
| III — AI non-blocking | n/a — no AI in this feature | **PASS** (n/a) |
| IV — Verifiable / test-first | critical hold logic ≥ 60% coverage with concurrency + failure-injection tests; strict TS; lint/type CI | **PASS** — SC-008/009; tests assert refusals, not just happy paths |
| V — Simplicity & Free-Tier | simplest thing that meets the requirement; no infra ahead of need; ≤ 20 pool; stateless | **PASS** — Socket.IO is the constitution-listed real-time transport; one sweeper, no queue/broker |
| VI — Clean Codebase & FE/BE contract | one shared typed contract in `shared/`; no re-declared payloads; clean modules | **PASS** — reservation + seat-event types added to `shared/`; module mirrors auth/catalog shape |

Stack additions (Socket.IO) are **already named in the constitution's Technology Stack** ("Socket.IO
real-time seat channel"), so no amendment is required. The one governance touch is the **D2
refinement** (one-time top-up grace) — a dated one-line amendment, tracked as a follow-up in spec.md.

**Result: PASS. No unjustified violations; Complexity Tracking left empty.**

## Project Structure

### Documentation (this feature)

```text
specs/003-seat-holds/
├── plan.md              # this file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1 (reservations REST + seat-socket events)
└── checklists/requirements.md
```

### Source Code (repository root)

```text
server/src/
├── db/migrations/0003_holds.sql        # reservations + reservation_items (+ indexes)
├── config.ts                           # + HOLD_TTL_MS, HOLD_GRACE_MS, HOLD_ABSOLUTE_MS, SEAT_CAP, HOLD_SWEEP_INTERVAL_MS
├── modules/holds/
│   ├── holds.repo.ts                   # locked transitions (FOR UPDATE), extendOnce, sweep query
│   ├── holds.service.ts                # cap (FR-016), rate-limit (FR-017), reservation view, event emit
│   ├── reservations.routes.ts          # POST/PATCH/DELETE /api/reservations (requireAuth)
│   └── sweep.ts                         # setInterval release of expired active reservations (REL-02)
├── realtime/
│   └── io.ts                            # Socket.IO server: showtime rooms, handshake auth, seat:update broadcast
├── app.ts                              # mount reservationsRouter
└── index.ts                            # wrap Express in http.Server, attach io, start sweep

src/ (web)
├── services/holdsClient.ts             # REST create/patch/delete reservation
├── services/seatSocket.ts              # socket.io-client: join showtime room, seat:update
├── components/SeatLayout.tsx           # replace Math.sin mock → real map + hold-on-click + countdown
└── App.tsx                             # carry reservationId from SeatLayout into checkout (gate already in place)

shared/
└── holds/types.ts                      # Reservation, ReservationItem, SeatUpdate event, request/response shapes
```

**Structure Decision**: Web-app monorepo, already established by 001/002. New backend module
`modules/holds/` mirrors `modules/auth` and `modules/catalog`; a new `realtime/` folder isolates the
Socket.IO server (the only non-REST surface). Frontend reuses the existing catalog seat-map read
endpoint (002) for the initial/resync map and adds a thin holds client + socket client.

## Complexity Tracking

> No constitution violations — section intentionally empty.
