# Research: Seat Holds & Reservations (003)

All spec-level unknowns were resolved in the grill session; this file records the technical
decisions that back them. Format per decision: **Decision · Rationale · Alternatives rejected**.

## R-1 — Hold timing: hold-on-select (Model A)

- **Decision**: Clicking an available seat holds it immediately (concurrency-safe, broadcast live);
  the reservation is created on the first hold.
- **Rationale**: Matches UC-11, Vision Feature 11, and the dominant VN pattern — Ticketbox and every
  major cinema (CGV/BHD/Galaxy/Lotte) lock the seat the instant you select it, with one countdown
  covering select→pay. It is the whole point of a real-time seat map (UN-01/UN-03).
- **Alternatives**: Hold-on-proceed (Model B) — reintroduces last-second collisions and guts the live
  map; Moveek uses it and must warn "ghế có thể mất". Rejected.

## R-2 — Concurrency: two-layer locking, DB is truth

- **Decision**: Seated — `BEGIN; SELECT … FOR UPDATE` the `showtime_seats` row(s), re-check status
  under the lock (a `held` row past `hold_expires_at` counts as available; already-held-by-me is an
  idempotent success), flip to `held`, commit, then broadcast. GA — `SELECT … FOR UPDATE` the
  `ticket_tiers` row, verify `total_quantity - sold - reserved >= qty`, bump `reserved_quantity`.
- **Rationale**: The schema's "Seat Concurrency Requirement" prescribes exactly this two-layer model;
  row locks serialize contenders so exactly one wins (DATA-02, SC-001/SC-005). Socket updates are
  advisory (FR-023) — a client that missed one is still refused correctly by the lock.
- **Alternatives**: Optimistic `UPDATE … WHERE status='available'` with no explicit lock — works for
  single-seat but composes poorly for multi-seat atomicity and the expired-but-not-swept re-check;
  advisory locks / a Redis lock — extra infra against Principle V (the row lock is already ACID and
  free). Rejected.

## R-3 — Expiry: one reservation clock + sweeper + one-time grace

- **Decision**: `reservations.expires_at` is the single source of truth; every held seat's
  `hold_expires_at` mirrors it. A `setInterval` sweep every `HOLD_SWEEP_INTERVAL_MS` (60 s) finds
  `status='active' AND expires_at < now()`, and per reservation (in its own txn) releases the seats /
  restores GA `reserved_quantity` and marks it `expired`, broadcasting the releases. The window is
  fixed at `HOLD_TTL_MS` (7 min) from creation; `extendOnce` (triggered by a top-up carrying
  `reservationId`) sets `expires_at = min(now()+HOLD_GRACE_MS, created_at + HOLD_ABSOLUTE_MS)` and
  the `extended_once` flag, refused if already set — ceiling 14 min.
- **Rationale**: DB-driven expiry survives client disconnect (REL-02, SC-002); one clock keeps the
  UX countdown and the sweeper simple. The bounded grace is the fairness fix for a slow/failing VNPay
  top-up, abuse-bounded by cap-8 × one-time (see R-6).
- **Alternatives**: Per-seat TTLs — piecemeal release, complex sweep, confusing countdown; freeze-on-
  top-up — no clean end condition (server can't see the user leave VNPay) → indefinite hold, the exact
  exploit D2 avoided; no grace at all (old D2) — unfair to a genuine buyer stuck on a slow gateway.
  Rejected.

## R-4 — One active reservation per (user, showtime)

- **Decision**: Enforced by a **partial unique index** `reservations(user_id, showtime_id) WHERE
  status='active'`. A further hold on the same showtime joins the existing active reservation.
- **Rationale**: One on-screen selection = one checkout = one order (004 converts one reservation).
  Makes "add/remove seat" unambiguous and the cap a per-reservation count. Enforced at the database,
  not by check-then-write.
- **Alternatives**: Many active reservations per user+showtime — ambiguous PATCH target and cap
  accounting; app-level check — races. Rejected.

## R-5 — Real-time transport: Socket.IO, room per showtime

- **Decision**: One Socket.IO server attached to the same `http.Server` as Express. Clients join room
  `showtime:<id>`; hold/release/expire emit `seat:update` to the room. Handshake auth reuses
  `verifyAccessToken` + `familyHasLiveToken` (from `sessions.ts`); an **unauthenticated socket may
  still join to view** (guests see the map, FR-022) but cannot hold (holds go through the
  `requireAuth` REST route). Full state re-sync on (re)connect uses the existing 002 seat-map read
  endpoint, not a socket payload.
- **Rationale**: Socket.IO is the constitution-named transport; rooms scope broadcasts to one map for
  PERF-06; reusing the REST read for resync avoids a second source of map truth. Wrapping the existing
  `createApp()` in `http.Server` keeps supertest working (it drives the Express app directly).
- **Alternatives**: Raw `ws` — more plumbing, no rooms/reconnect out of the box; SSE — one-way, no
  clean per-client auth; polling — misses PERF-03. Rejected.

## R-6 — Abuse: shared cap 8 + per-user rate limit

- **Decision**: `SEAT_CAP` (8) counts held seats (seated) or reserved quantity (GA) within the one
  active reservation; holds beyond it are refused. Hold/release requests are rate-limited per user
  (reuse the existing per-source/identifier throttle style from 001's auth-events approach, applied
  per `userId`).
- **Rationale**: Caps blast radius of the top-up-grace exploit to 8 seats/account and stops hold-spam
  without blocking a normal selection pace (FR-016/017).
- **Alternatives**: Higher GA cap — two numbers, more surface, group-buy is not the core case; no cap
  — a single account locks a tier. Rejected.

## R-7 — GA quantity model

- **Decision**: GA holds are a quantity on `ticket_tiers.reserved_quantity`; no per-seat rows. A GA
  `reservation_item` carries `ticket_tier_id + quantity + unit_price_amount`. Remaining = capacity −
  sold − reserved, computed live (as 002 already does for the read side).
- **Rationale**: GA has no seats; the schema already tracks `reserved_quantity`; reuses the 002
  availability formula. A reservation is seated **or** GA, never mixed (a showtime is one type).
- **Alternatives**: Synthesising per-seat rows for GA — pointless rows, breaks the read model.
  Rejected.

## R-8 — Frontend hold surface: SeatLayout (two screens)

- **Decision**: EventDetail keeps the read-only preview map (`SeatMapView`, 002); the existing
  auth-gated "Tiếp tục chọn ghế" leads to `SeatLayout`, which becomes the real hold surface
  (click = hold via `holdsClient` + `seatSocket`, countdown from server `expiresAt`). The `Math.sin`
  mock and the "sơ đồ mô phỏng" banner are removed.
- **Rationale**: Keeps the sign-in gate already built at `handleProceedToSeats` (guest → login →
  resume into SeatLayout), separates teaser (detail) from tool (SeatLayout), minimal churn to the
  flow shipped this session.
- **Alternatives**: One interactive map on EventDetail — must move the gate to each seat click and
  mixes teaser with the buying tool. Rejected.
