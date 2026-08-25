# Tasks: Seat Holds & Reservations

**Input**: Design documents from `/src/specs/003-seat-holds/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/reservations.openapi.yaml, contracts/seat-socket.md, quickstart.md

**Tests**: REQUIRED. This is a money-adjacent concurrency module — the constitution's ≥ 60% coverage gate applies here (MAIN-03 / SC-009), and every refusal path needs an asserting test (SC-008). Write the test first.

**Organization**: by user story. P1 = US1 (hold a seat) + US2 (holds expire); P2 = US3 (live map) + US4 (GA quantity); P3 = US5 (manage a selection).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependency on an incomplete task → parallelizable.
- Backend: `server/src/modules/holds/…`, `server/src/realtime/…`; shared: `shared/holds/…`; FE: `src/…`; tests: `server/tests/holds/…`.

---

## Phase 1: Setup

- [X] T001 Add deps: `socket.io` (server) and `socket.io-client` (web) in `package.json`
- [X] T002 [P] Create the holds skeleton: `server/src/modules/holds/`, `server/src/realtime/`, `server/tests/holds/`, `shared/holds/`

---

## Phase 2: Foundational (Blocking)

**⚠️ No user-story work begins until this phase is complete.**

- [X] T003 Migration `server/src/db/migrations/0003_holds.sql`: `reservations` (status CHECK, `expires_at`, `extended_once`, `created_at`), partial unique index `uq_reservation_active(user_id, showtime_id) WHERE status='active'` (R-4), `idx_reservations_sweep(status, expires_at)`, `reservation_items` (`UNIQUE (reservation_id, showtime_seat_id)`, `quantity > 0`, `unit_price_amount` BIGINT) per data-model.md
- [X] T004 [P] Derive `shared/holds/types.ts` from `contracts/reservations.openapi.yaml` + `contracts/seat-socket.md` — `Reservation`, `ReservationItem`, `HoldRequest`, `SeatUpdate`, error codes (Principle VI)
- [X] T005 [P] `server/src/config.ts`: add `HOLD_TTL_MS` (7 min), `HOLD_GRACE_MS` (7 min), `HOLD_ABSOLUTE_MS` (14 min), `SEAT_CAP` (8), `HOLD_SWEEP_INTERVAL_MS` (60 s) — configurable, not hard-coded (UC-36)
- [X] T006 `server/src/modules/holds/holds.repo.ts`: locked transitions — `SELECT … FOR UPDATE` on `showtime_seats` / `ticket_tiers`, expired-hold-counts-as-available re-check, active-reservation upsert, item insert/delete, `extendOnce`, sweep query (R-2, R-3)
- [X] T007 `server/src/realtime/io.ts`: Socket.IO server, room `showtime:<id>`, `seat:join`/`seat:leave`, optional handshake auth via `verifyAccessToken` + `familyHasLiveToken`, guests join read-only; the socket never mutates state (R-5)
- [X] T008 Wire it up: `server/src/index.ts` wraps `createApp()` in `http.Server` + attaches `io` + starts the sweep; `server/src/app.ts` mounts `reservationsRouter` behind `requireAuth`

**Checkpoint**: schema, shared contract, config, locking repo and the socket server exist.

---

## Phase 3: User Story 1 — Hold specific seats on a live map (P1) 🎯 MVP

**Goal**: a signed-in attendee clicks an available seat and it is held for them, concurrency-safe. **Independent test**: hold a seat as user A, confirm user B is refused that seat.

- [X] T009 [P] [US1] Tests `server/tests/holds/hold.test.ts`: hold an available seat → `held` + owner + expiry + reservation (FR-001/002); guest → 401 (SC-007); `sold`/`blocked`/other's `held` → refused (FR-002); re-hold own seat → idempotent 200 (FR-005); release own seat → `available`, release someone else's → 403 (FR-004); seat from another showtime → 422; cap 9th seat → `422 cap_exceeded` (FR-016, SC-006)
- [X] T010 [P] [US1] Tests `server/tests/holds/concurrency.test.ts`: N parallel holds on one seat → exactly one 201, rest `409 seat_taken`, seat held by exactly one user (SC-001, DATA-02)
- [X] T011 [US1] `server/src/modules/holds/holds.service.ts`: create-or-join the single active reservation, per-reservation cap (FR-016), price snapshot at hold time, reservation view (items + total VND + `expiresAt`), release
- [X] T012 [US1] `server/src/modules/holds/reservations.routes.ts`: `POST /api/reservations` (201/200 idempotent · 401 · 409 `seat_taken` · 422 `cap_exceeded`/`insufficient_stock`/`showtime_unavailable`/`invalid_selection`), zod validation, server-authoritative owner (FR-024)
- [X] T013 [P] [US1] FE `src/services/holdsClient.ts` + rewire `src/components/SeatLayout.tsx` off the `Math.sin` mock onto the real map (002 seat-map read) with click-to-hold and the server `expiresAt` driving the existing hold-session countdown (R-8)

**Checkpoint**: a real, concurrency-safe hold exists end-to-end.

---

## Phase 4: User Story 2 — Holds expire on their own (P1)

**Goal**: an untouched hold returns to inventory automatically, even with the client gone. **Independent test**: hold, disconnect, confirm release within ~1 min of expiry.

- [X] T014 [P] [US2] Tests `server/tests/holds/expiry.test.ts`: sweep releases every seat of an expired reservation together and marks it `expired` (FR-006/008); a disconnected client keeps nothing (FR-007, SC-002); a `held` row past expiry is holdable by someone else before the sweep runs (edge case); no gateway/payment-window release path exists (FR-009)
- [X] T015 [P] [US2] Tests `server/tests/holds/grace.test.ts`: `extendOnce` extends by +7 min the first time, is refused the second, and never exceeds `created_at + 14 min` (FR-010)
- [X] T016 [US2] `server/src/modules/holds/sweep.ts`: `setInterval` every `HOLD_SWEEP_INTERVAL_MS`, one transaction per expired reservation, releases seats / restores GA `reserved_quantity`, marks `expired`, broadcasts (R-3)
- [X] T017 [US2] `extendOnce` in service + repo: `expires_at = min(now()+HOLD_GRACE_MS, created_at+HOLD_ABSOLUTE_MS)` guarded by `extended_once` — internal operation for 004's top-up, not a public route

**Checkpoint**: no hold can leak inventory; the bounded top-up grace is in place.

---

## Phase 5: User Story 3 — Everyone sees the map change live (P2)

**Goal**: other viewers see a hold/release within ~1 s. **Independent test**: two clients on one showtime; a hold in one appears in the other without refresh.

- [X] T018 [P] [US3] Tests `server/tests/holds/realtime.test.ts`: a committed hold/release/expiry emits `seat:update` to the showtime room with the changed seats (or tier remaining); nothing is emitted for a refused attempt; the socket itself cannot mutate state (FR-021/023)
- [X] T019 [US3] Emit `seat:update` from the service after every committed transition (hold, release, cancel, sweep)
- [X] T020 [P] [US3] FE `src/services/seatSocket.ts` (socket.io-client: join room, apply `seat:update`) + full re-sync from the 002 seat-map endpoint on connect/reconnect, showing the returning owner their own holds (FR-022)

---

## Phase 6: User Story 4 — Reserve general-admission tickets by quantity (P2)

**Goal**: GA holds a quantity in a tier under the same TTL. **Independent test**: reserve 2 of 5, remaining shows 3 for everyone; on expiry it returns to 5.

- [X] T021 [P] [US4] Tests `server/tests/holds/ga.test.ts`: reserve K ≤ remaining → `reserved_quantity += K` (FR-018); K > remaining → `422 insufficient_stock`; concurrent reservations never oversell `reserved + sold ≤ capacity` (FR-019, SC-005); release/expiry restores remaining (FR-020); qty ≤ 0 → 422; cap 8 applies to quantity (FR-016)
- [X] T022 [US4] GA path in repo + service: `FOR UPDATE` on `ticket_tiers`, quantity item, restore on release/expiry, one reservation is seated **or** GA, never mixed (FR-012)
- [X] T023 [P] [US4] FE: GA quantity hold on the EventDetail tier steppers via `holdsClient`, remaining updated from `seat:update`

---

## Phase 7: User Story 5 — Manage an in-progress selection (P3)

**Goal**: add/remove seats and cancel within one reservation. **Independent test**: hold 2, add 1, remove 1 → the reservation holds exactly the current seats; cancel releases all at once.

- [X] T024 [P] [US5] Tests `server/tests/holds/manage.test.ts`: PATCH add/remove on an active reservation (FR-013); PATCH on expired/cancelled/converted → 404 (FR-013); DELETE releases every seat at once and marks `cancelled` (FR-014); adding never extends the window (FR-006); reservation view returns items + running total + `expiresAt` (FR-015)
- [X] T025 [US5] `PATCH /api/reservations/:id` (add / removeSeatIds, `403 not_owner`, `404` when not active) and `DELETE /api/reservations/:id` (204)
- [X] T026 [P] [US5] FE: wire add/remove/cancel through `holdsClient`, keeping the flow-scoped hold session (selection + countdown survive chọn suất ↔ chọn ghế ↔ thanh toán, released only on leaving the flow)

---

## Phase 8: Polish & Cross-Cutting

- [X] T027 [US-all] Per-user rate limit on hold/release requests (FR-017), sized so a normal selection pace is never blocked; test asserts `429` on spam
- [X] T028 [P] Remove the "sơ đồ mô phỏng" banner and the mock seat generator from `src/components/SeatLayout.tsx` (R-8); SeatMapView (002) stays the read-only preview
- [X] T029 [P] Coverage gate: `server/src/modules/holds/**` ≥ 60% in `vitest.config.ts` (MAIN-03, SC-009)
- [X] T030 Execute `quickstart.md` scenarios 1–6 (API + socket level; the two-browser click-through is left to a human)
- [X] T031 [P] `npm run typecheck` (web + server) clean; `shared/holds/types.ts` imported by both sides with no re-declared payloads (Principle VI)
- [X] T032 [P] Deferred (documented, not built here): k6 WebSocket harness for PERF-03 / PERF-06, shared with catalog T034

---

## Dependencies & Execution Order

- **Setup → Foundational** blocks everything. T003 (schema) before T006; T004 before every FE task; T007 before T019/T020.
- **US1 → US2** are both P1 and ship together: a hold with no expiry is an inventory leak, so US2 is not optional polish.
- **US3** builds on US1 (broadcast after a committed transition) but the hold is already correct without it.
- **US4** reuses the reservation + TTL machinery from US1/US2.
- **US5** is convenience over "cancel and start again" — last.
- **004 (wallet & checkout)** consumes `extendOnce` (T017) and converts a reservation; it is out of scope here.

## Parallel Opportunities

- Foundational: T004/T005 are `[P]` once T002 lands; T006/T007 then T008.
- Every story's test task (T009/T010/T014/T015/T018/T021/T024) is `[P]`.
- FE tasks (T013/T020/T023/T026) run parallel to their backend once T004 exists.

## Implementation Strategy

- **MVP = US1 + US2** (Setup → Foundational → hold → expiry): a correct, non-leaking hold, demoable on the seeded seated event without any real-time layer.
- **Then US3 + US4**: the live map (the survey's #1 pain) and GA parity.
- **Gate**: T029 coverage, T030 quickstart, T031 typecheck/one-contract.

## Notes

- Reuses 001's `requireAuth` and session helpers and 002's `showtime_seats` / `ticket_tiers` / seat-map read endpoint. No new external integration — Socket.IO is already in the constitution's stack.
- **The database is the source of truth**; socket updates are advisory (FR-023). Never let a client-supplied user id decide ownership (FR-024).
- Money stays whole VND integers (D1/STD-03) — snapshot `unit_price_amount` at hold time.
