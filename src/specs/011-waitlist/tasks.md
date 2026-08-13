---

description: "Task list for 011-waitlist"
---

# Tasks: Waitlist for Sold-Out Tickets

**Input**: Design documents from `/specs/011-waitlist/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/waitlist.openapi.yaml](./contracts/waitlist.openapi.yaml), [quickstart.md](./quickstart.md)

**Tests**: Included. SC-007 asks for them by name, and the feature is mostly refusals — queue full, tickets still available, not your place, not signed in, occasion begun. Constitution Principle IV requires the denial to be tested, not only the happy path.

**Organization**: Grouped by user story, in dependency order: US4 (the rules, P1) → US1 (join, P1) → US2 (be told, P1) → US3 (leave, P2).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- Paths are relative to the repository root `E:\IntroSE`
- **No migration in this feature.** `waitlists`, `notifications`, `notification_logs` and their indexes all shipped in `server/src/db/migrations/0015_notifications.sql`

---

## Phase 1: Setup

- [X] T001 Create `server/tests/notifications/` and add `server/tests/helpers/waitlistSeed.ts` exporting: `seedMixedGaShowtime()` — one showtime with a **sold-out** GA tier and a **selling** GA tier, which is the case the current join route gets wrong; `seedSoldOutSeated()` — a seated showtime with every seat non-`available`; `fillWaitlist(showtimeId, tierId, n)` — n distinct accounts queued with strictly increasing `joined_at`; and `getEntries(showtimeId)` returning raw rows so tests can assert `status`, `joined_at` and `notified_at` directly
- [X] T002 [P] Add `waitlists, notifications, notification_logs` to the `TRUNCATE` list in `server/tests/helpers/setup.ts`. They already vanish by `CASCADE` from `users`, but naming them keeps the sweep readable and survives a schema change that drops that foreign key — same reasoning as `event_reviews`
- [X] T003 [P] Confirm `TEST_DATABASE_URL` points at a Neon branch nobody else uses, and that `SELECT count(*) FROM waitlists` succeeds there (the table predates this feature; if it errors, run `npm run db:migrate`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 [P] Create `shared/waitlist/types.ts` exporting `WaitlistStatus`, `WaitlistEntry`, `WaitlistJoinInput` and `WaitlistJoinResult`, matching `contracts/waitlist.openapi.yaml` field for field. Document on `position` that it is derived per read and never stored, and on `status` that `notified` is not terminal
- [X] T005 [P] Create `shared/notifications/types.ts` exporting `NotificationType` and `NotificationItem`. Move the `NotificationType` union out of its private declaration in `server/src/modules/notifications/notifications.service.ts` and import it back from the shared module, so server and client cannot disagree about what kinds exist (constitution VI)
- [X] T006 Export `availableForWaitlist` from `server/src/modules/notifications/notifications.service.ts` (currently module-private) and add a short comment that it is now the **single** availability judgement, shared by the join gate and the release notifier — the two disagreeing is the defect this feature fixes
- [X] T007 Add a `position` helper to `server/src/modules/notifications/notifications.routes.ts` (or a small `waitlist.repo.ts` beside it if the route file grows past readability): count open entries — `status IN ('waiting','notified')` — of the same `(showtime_id, ticket_tier_id)` with an earlier `joined_at`, plus one. One statement, parameterized, used by every response that carries an entry

**Checkpoint**: Contract shared both ways, one availability judgement, position computable.

---

## Phase 3: User Story 4 - The queue obeys its own rules (Priority: P1) 🎯 FIRST

**Goal**: The cap, the join order, the duplicate rule, the scope rule and the closing of served/unservable places all hold — including under concurrent joins.

**Independent Test**: Fill a queue to ten, attempt an eleventh join, attempt a duplicate, attempt a join on a tier that still sells, then begin the occasion and confirm the places close. All observable through the API with no interface at all.

**Why first**: These rules live inside the join path that US1 needs, and a cap added after the fact is a check bolted onto a door that was already open. Built first, the join endpoint cannot exist without them.

### Tests for User Story 4

- [X] T008 [P] [US4] Scope tests in `server/tests/notifications/waitlist-join.test.ts` using `seedMixedGaShowtime()`: joining the **sold-out** tier succeeds `201` while a sibling tier still sells (this fails on the current server with `409 tickets_available`); joining the **selling** tier is refused `409 tickets_available`; an any-tier join (`ticketTierId` omitted) is refused while any tier sells, and succeeds once every tier is exhausted
- [X] T009 [P] [US4] Cap tests in `server/tests/notifications/waitlist-join.test.ts`: ten open places accepted, the eleventh refused `409 waitlist_full`; a place in `notified` still counts toward the ten; `expired` and `converted` places do not
- [X] T010 [P] [US4] Concurrency test in `server/tests/notifications/waitlist-join.test.ts`: two joins fired together at the ninth and tenth places — exactly one of the pair contesting the last place wins, the queue holds exactly ten rows afterwards
- [X] T011 [P] [US4] Duplicate test in `server/tests/notifications/waitlist-join.test.ts`: the same account joining twice gets `200` with `existing: true`, the same entry id, and no second row
- [X] T012 [P] [US4] Precondition tests in `server/tests/notifications/waitlist-join.test.ts`: unknown showtime → `404 showtime_not_found`; a showtime already begun → `404`; a cancelled showtime → `404`; a tier belonging to a different showtime → `400 validation_failed`; no session → `401` and no row written
- [X] T013 [P] [US4] Lifecycle tests in `server/tests/notifications/waitlist-lifecycle.test.ts`: a place whose showtime has begun becomes `expired` after the sweep and stops appearing in the caller's entries; a purchase of the waited-for tier closes that buyer's place as `converted` in the same transaction as the order, and their any-tier place for the same showtime closes with it; a purchase by somebody else changes nobody's place

### Implementation for User Story 4

- [X] T014 [US4] Rewrite the availability gate in `POST /waitlists` in `server/src/modules/notifications/notifications.routes.ts`: delete the inline showtime-wide `EXISTS` query and call `availableForWaitlist(db, showtimeId, tierId)` instead, keeping the `SELECT … FOR UPDATE` on the showtime row that serializes concurrent joins on one queue
- [X] T015 [US4] Keep the cap and duplicate checks under that same row lock, and make the cap count `status IN ('waiting','notified')` explicitly rather than relying on the partial index's definition, so the rule is legible where it is enforced
- [X] T016 [US4] Add `sweepExpiredWaitlists()` to `server/src/modules/notifications/notifications.service.ts`: one `UPDATE waitlists SET status = 'expired' … WHERE status IN ('waiting','notified') AND showtime.starts_at <= now()`. Call it from the worker's existing `tick()` in `startNotificationWorker()` — no new timer, no new process (research.md §4)
- [X] T017 [US4] Add `markWaitlistConverted(db, userId, showtimeId, tierIds)` to `server/src/modules/notifications/notifications.service.ts` and call it from inside the `withTransaction` in `checkout()` in `server/src/modules/payments/wallet.service.ts`, after the tickets are issued. Closing the place and issuing the ticket commit or roll back together, so no buyer ever holds a ticket and a place in the queue for it

**Checkpoint**: The queue is correct and provably so, with nothing yet able to reach it but a test.

---

## Phase 4: User Story 1 - Join the queue for a sold-out ticket type (Priority: P1) 🎯 MVP

**Goal**: A signed-in attendee joins from the event page in one confirmation and sees their position.

**Independent Test**: Sign in, open an event with a sold-out tier, press the control, confirm, and see the recorded position on the page.

### Tests for User Story 1

- [X] T018 [P] [US1] Position tests in `server/tests/notifications/waitlist-join.test.ts`: the first joiner reads `position: 1`, the third reads `3`; a repeat join reports the caller's real position, not `1`; positions are per `(showtime, tier)` so a second queue on the same showtime starts again at `1`
- [X] T019 [P] [US1] Listing tests in `server/tests/notifications/waitlist-list.test.ts`: `GET /waitlists` returns only the caller's own open places, each with its position; `?showtimeId=` narrows to one showtime; `expired` and `converted` places are absent; another account's places never appear; no session → `401`

### Implementation for User Story 1

- [X] T020 [US1] Change the `POST /waitlists` response in `server/src/modules/notifications/notifications.routes.ts` to the contract's `WaitlistJoinResult` — `{ entry, existing }` with the full entry including `position` — replacing today's bare `{ id, existing }`
- [X] T021 [US1] Add `GET /waitlists` to `server/src/modules/notifications/notifications.routes.ts`: the caller's open places with positions, optional `showtimeId` query filter, validated with Zod and typed against `shared/waitlist/types.ts`
- [X] T022 [P] [US1] Create `src/services/waitlistClient.ts` with `join`, `listMine` and (used in US3) `leave`, following the shape of `src/services/walletClient.ts` — `withAuthRetry`, `apiUrl`, `readApiError` — and re-exporting the shared types so components import one place. Map `tickets_available` and `waitlist_full` to named errors the interface can act on rather than a string it has to match
- [X] T023 [US1] In `src/components/EventDetail.tsx`, load the caller's places for the selected showtime when signed in, and render per sold-out **general-admission** tier a waitlist control in place of the quantity stepper, stating why the tier cannot be bought (research.md §6)
- [X] T024 [US1] In `src/components/EventDetail.tsx`, make the primary CTA of a **fully sold-out** showtime a waitlist action instead of the disabled "Hết vé" — seated showtimes join with `ticketTierId: null`, which is exactly the any-tier precondition since no free seat means no tier has stock
- [X] T025 [US1] Wire the confirmation through the existing `src/components/ConfirmDialog.tsx`: the copy MUST say that no ticket is reserved and that notified people race to buy (FR-008). On success show the position in place of the control
- [X] T026 [US1] Handle the two refusals in `src/components/EventDetail.tsx`: `waitlist_full` explains the limit of ten; `tickets_available` refreshes the tier and points the reader at buying, because the page they were reading was out of date (research.md §7)
- [X] T027 [US1] Route a signed-out press through the existing auth modal in `src/App.tsx` so the reader returns to the same event afterwards, matching how the wishlist and checkout already handle it

**Checkpoint**: US1 + US4 together are a shippable MVP — people can queue, and the queue behaves.

---

## Phase 5: User Story 2 - Be told when tickets come back (Priority: P1)

**Goal**: The `waitlist_open` message the server already writes becomes something a person can read, with an unread count in the navigation.

**Independent Test**: Queue an account, cancel a ticket for that occasion, and read the resulting message in the product; it leads to the event and stops being unread.

### Tests for User Story 2

- [X] T028 [P] [US2] Notifier tests in `server/tests/notifications/waitlist-notify.test.ts`: with seven queued on one tier, a release notifies exactly the five earliest by `joined_at`; each notified place reads `notified` with `notified_at` set; a second release notifies the same five again and their `joined_at` — and therefore their positions — are unchanged (FR-009)
- [X] T029 [P] [US2] Trigger tests in `server/tests/notifications/waitlist-notify.test.ts`: cancelling a paid ticket produces the messages; an expired reservation does too; a release on a showtime that has begun produces none; a queue on a *different* tier of the same showtime is not notified when only one tier frees
- [X] T030 [P] [US2] Read-state tests in `server/tests/notifications/notifications-read.test.ts`: `POST /notifications/:id/read` sets `read_at` and is idempotent; another account's notification → `404` and its `read_at` is untouched; `POST /notifications/read-all` returns how many changed and leaves already-read rows alone; no session → `401`

### Implementation for User Story 2

- [X] T031 [US2] Add `POST /notifications/:id/read` and `POST /notifications/read-all` to `server/src/modules/notifications/notifications.routes.ts`, both scoped by `user_id` **in the statement** so a forged id touches nothing and is indistinguishable from a missing row
- [X] T032 [US2] Extend the existing `GET /notifications` in `server/src/modules/notifications/notifications.routes.ts` to return the shared `NotificationItem` shape, resolving `eventSlug` from `event_id` server-side so a row can link to its event without the client trusting `payload`
- [X] T033 [US2] Set `event_id` on the `waitlist_open` enqueue in `notifyWaitlistForShowtime()` in `server/src/modules/notifications/notifications.service.ts` — it is currently left null, so a message about an event carries no reliable way back to it
- [X] T034 [P] [US2] Create `src/services/notificationsClient.ts` with `list`, `markRead` and `markAllRead`, typed against `shared/notifications/types.ts`
- [X] T035 [US2] Create `src/components/NotificationsPage.tsx`: newest first, unread visually distinct from read, an empty state that says so in words, and a row for `waitlist_open` that opens the event. Match the page chrome the rest of the site uses — `← Quay về trang chủ`, display-face uppercase title over a hairline rule, `ticket-corners` surfaces, no rounded frames
- [X] T036 [US2] Add the screen to `src/routes.ts`: a `notifications` member of `Screen` and `["notifications", "/notifications"]` in `STATIC_PATHS`
- [X] T037 [US2] Mount the screen in `src/App.tsx`, load the notification list once per session for a signed-in reader, and pass the unread count down; refresh the list after opening the page so the count and the page cannot disagree
- [X] T038 [US2] Add a "Thông báo" destination with its unread count to the header menu panel in `src/components/Header.tsx`, beside "Tài khoản" and "Đã lưu", using the existing `PanelLink` treatment rather than a new control
- [X] T039 [US2] Mark a notification read when it is opened from the list, and update the header count from the same state so the two never drift

**Checkpoint**: The loop closes — join, get told, come back and buy.

---

## Phase 6: User Story 3 - Leave the queue (Priority: P2)

**Goal**: An attendee can remove their own place, and only their own.

**Independent Test**: Join, leave, verify the place is gone, the queue behind it moves up, and a later release sends that account nothing.

### Tests for User Story 3

- [X] T040 [P] [US3] Ownership tests in `server/tests/notifications/waitlist-leave.test.ts`: the owner deletes their place → `204`, the row is gone; another account deleting it → `404` and the row survives; an unknown id → `404`; no session → `401`
- [X] T041 [P] [US3] Queue-integrity tests in `server/tests/notifications/waitlist-leave.test.ts`: with three queued, the first leaving moves the other two to positions 1 and 2; leaving frees a place against the cap of ten; a release after leaving notifies everyone still queued and nobody who left

### Implementation for User Story 3

- [X] T042 [US3] Add `DELETE /waitlists/:id` to `server/src/modules/notifications/notifications.routes.ts`, deleting with `WHERE id = $1 AND user_id = $2` in one statement — never read-then-check — and returning `204` or `404 waitlist_entry_not_found`
- [X] T043 [US3] In `src/components/EventDetail.tsx`, show the attendee's position with a way to leave wherever the join control would otherwise be, and return the control to its joinable state after leaving

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T044 Run `npm run typecheck`, `npm test -- --run` and `npm run lint`; fix every error introduced by this feature and leave the pre-existing findings alone
- [ ] T045 [P] Walk `quickstart.md` scenarios 1–8 by hand against a running app; the mixed-tier case (scenario 1) and the notification round trip (scenario 5) are the two that no automated test can fully stand in for
- [X] T046 [P] Update the Waitlist section of `docs/Analysis_Design/SCHEMA_DATABASE.md` to record what is now true: that position is derived, that `notified` counts as open against the cap, and where the `expired` and `converted` transitions are written
- [ ] T047 [P] Update `docs/Analysis_Design/Group02_UseCaseSpecification.md` UC-17 only if implementation diverged from the written flow; the intent is that it did not, so this task is a check, not an edit
- [X] T048 Verify the constitution gates the plan claims: every waitlist endpoint refuses an anonymous caller, every author-scoped statement carries `user_id` in its `WHERE`, no payload shape is declared twice, and no `console.log` or dead code ships

---

## Dependencies

```text
Phase 1 (Setup)
   └─> Phase 2 (Foundational: shared types, single availability judgement, position)
          └─> Phase 3 (US4 — rules)        ← must precede US1: the join path is where they live
                 ├─> Phase 4 (US1 — join)  ← MVP with US4
                 ├─> Phase 5 (US2 — be told)
                 └─> Phase 6 (US3 — leave)
                        └─> Phase 7 (Polish)
```

- **US4 blocks US1** — US1's join button calls the endpoint US4 makes correct.
- **US2 is independent of US1** at the server (the notifier already exists and its trigger already fires), but is only *demonstrable* once someone can queue, so it is sequenced after in practice.
- **US3 depends on US1** for the surface it attaches to, not for its endpoint, which can be built and tested at any point after Phase 2.

## Parallel execution examples

**Phase 2** — T004 and T005 are two new files in different directories; both can go at once. T006 and T007 touch the same two server files and must not.

**Phase 3 tests** — T008 through T013 are one file each (`waitlist-join`, `waitlist-lifecycle`) and are written together before T014 begins.

**Phase 5** — T034 (client) is independent of T031–T033 (server) once the shared types from T005 exist; the page (T035) needs T034 only.

**Phase 7** — T045, T046 and T047 are three unrelated documents and one manual pass; all parallel.

## Implementation strategy

**MVP = Phase 1 + 2 + 3 + 4** (US4 + US1). At that point a real attendee can join a real queue for a sold-out tier, the queue is capped and ordered and provably correct, and the defect that made a sold-out tier unjoinable beside a selling one is gone. What they do *not* yet have is a way to read the message — which the server is already writing, and which no data is lost by delaying.

**Then Phase 5** (US2), which is what makes the feature worth having rather than merely correct.

**Then Phase 6** (US3), the smallest and the most deferrable: without it a waiter can still ignore the messages.

Each phase leaves the product in a shippable state, and no phase requires a migration or a rollback plan, because none of them changes the schema.
