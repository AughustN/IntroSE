# Quickstart: Seat Holds & Reservations (003)

Runnable validation that the hold layer works end-to-end. Details live in
[data-model.md](./data-model.md), [contracts/](./contracts/), and [spec.md](./spec.md).

## Prerequisites

- Features 001 + 002 migrated; `0003_holds.sql` applied.
- `npm i` has added `socket.io` (server) and `socket.io-client` (web).
- Seed loaded — the seated demo event **"Đêm Nhạc Trịnh Công Sơn"** already exists
  (`server/src/db/seed-dev.ts`), giving a real seat map to hold against.

## Setup

```bash
npm run db:migrate        # applies 0003_holds.sql
npm run seed              # seated + GA demo events
npm run dev:server        # API :4000 + Socket.IO + sweep loop
npm run dev:web           # SPA :3000
```

## Scenario 1 — Hold a seat, see it live (US1 + US3)

1. Sign in as an attendee. Open **Đêm Nhạc Trịnh Công Sơn** → pick a showtime → **Tiếp tục chọn ghế**
   (SeatLayout, the real map).
2. Click an available seat → it turns *held-by-me* with a countdown; a `POST /api/reservations`
   returned a reservation with `expiresAt`.
3. In a second browser (another account or guest) open the same showtime's map → that seat reads
   **unavailable within ~1 s**, no refresh (`seat:update` broadcast).
4. Deselect in the first browser → the seat returns to available live in the second.

**Expected**: exactly one holder; the map agrees across clients within about a second.

## Scenario 2 — Concurrency (SC-001, the core guarantee)

```bash
npm run test -- holds/concurrency        # parallel buyers on one seat
```

**Expected**: exactly one hold succeeds, the rest get `409 seat_taken`; no seat ever held by two
users. Same test file asserts GA never oversells (SC-005).

## Scenario 3 — Expiry on disconnect (US2, SC-002)

1. Hold a seat, note `expiresAt`, then **close the browser**.
2. Wait past the 7-minute window (or, in tests, advance the clock).

**Expected**: within ~1 minute of expiry the sweeper returns the seat to available and marks the
reservation `expired`; a second attendee can then hold it. Verified by
`npm run test -- holds/expiry`.

## Scenario 4 — Cap 8 across tabs (SC-006)

1. Hold 8 seats. Open a second tab on the same showtime, try to hold a 9th.

**Expected**: `422 cap_exceeded`; existing holds untouched. (Cap counts the one active reservation, so
tabs cannot exceed it.)

## Scenario 5 — GA quantity (US4)

1. On a general-admission showtime, reserve 2 of a tier that shows 5 remaining.

**Expected**: remaining drops to 3 for all viewers; over-reserving past remaining is refused; on
expiry remaining returns to 5.

## Scenario 6 — Top-up grace, once (FR-010, decision #5)

*(Full flow lands with 004; 003 exposes `extendOnce` and its guard.)*

```bash
npm run test -- holds/grace
```

**Expected**: `extendOnce` extends the window by +7 min the first time (capped at 14 from creation)
and is refused the second time; past the ceiling the seats release, money (if any) stays in the wallet.

## Guardrails to verify

- `npm run typecheck` (web + server) — 0 errors.
- `npm run test` — full suite green incl. the new `holds/*` files; holds module ≥ 60% coverage
  (MAIN-03 / SC-009).
- Every refusal (`seat_taken`, `cap_exceeded`, `insufficient_stock`, guest, `not_owner`) has an
  asserting test (SC-008).

## Deferred

- k6 WebSocket harness for PERF-03 (<1 s p95) and PERF-06 (≥60 VUs on one map) — shared with the
  catalog search-latency harness (T034).
