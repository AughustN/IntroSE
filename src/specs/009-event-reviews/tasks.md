---

description: "Task list for 009-event-reviews"
---

# Tasks: Event Reviews & Ratings

**Input**: Design documents from `/specs/009-event-reviews/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/reviews.openapi.yaml](./contracts/reviews.openapi.yaml), [quickstart.md](./quickstart.md)

**Tests**: Included. The feature's whole integrity story is a set of refusals — no ticket, unpaid, refunded, event not started, signed out, somebody else's review, a duplicate under concurrency — and Principle IV requires the denial to be tested, not just the happy path.

**Organization**: Grouped by user story, in priority order: P1 (US1, US2, US4) then P2 (US3, US5).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- Paths are relative to the repository root `E:\IntroSE`

---

## Phase 1: Setup

- [X] T001 Create `server/tests/reviews/` and add a seed helper at `server/tests/helpers/reviewSeed.ts` that produces an eligible (account, event) pair — a paid order with a non-void ticket, regardless of showtime — plus variants for unpaid, refunded, and void
- [X] T002 [P] Confirm `TEST_DATABASE_URL` points at a branch nobody else uses; the suite truncates thirty tables before every test

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 Create migration `server/src/db/migrations/0020_event_reviews.sql`: `event_reviews` per [data-model.md](./data-model.md), with `user_id` nullable `ON DELETE SET NULL`, `rating SMALLINT CHECK (rating BETWEEN 1 AND 5)`, `status` in `('visible','removed')`, the partial unique index on `(event_id, user_id) WHERE user_id IS NOT NULL`, and the listing index on `(event_id, created_at DESC) WHERE status = 'visible'`
- [X] T004 Add `event_reviews` to the `TRUNCATE` list in `server/tests/helpers/setup.ts` — it is reachable by cascade from `users` and `events`, but listing it explicitly keeps the sweep readable and survives a future schema change that drops one of those foreign keys
- [X] T005 [P] Create `shared/reviews/types.ts` exporting `Review`, `ReviewAuthor`, `ReviewInput`, `ReviewSummary`, `ReviewPage`, `ViewerState` and the eligibility reason union, matching `contracts/reviews.openapi.yaml` field for field
- [X] T006 [P] Add `rating: number | null` and `reviewCount: number` to `EventDetail` in `shared/catalog/types.ts`, with a note that null means unrated rather than zero
- [X] T007 Create `server/src/modules/reviews/reviews.repo.ts` with `eligibility`, `findByAuthor`, `upsert`, `updateOwn`, `deleteOwn`, `listForEvent`, `summary`, `setStatus` — every author-scoped statement takes `user_id` in its `WHERE` rather than checking ownership in application code first
- [X] T008 Create `server/src/modules/reviews/reviews.service.ts` holding the rules only: eligibility before any write, blank-only bodies stored as null, a second submission upserting rather than colliding
- [X] T009 Create `server/src/modules/reviews/reviews.routes.ts` with strict Zod schemas, and mount it in `server/src/app.ts`

**Checkpoint**: Schema applied, contract shared, module wired.

---

## Phase 3: User Story 4 - Only ticket holders may review (Priority: P1) 🎯 FIRST

**Goal**: Nobody without a paid, non-void ticket can write a review, by any route; showtime start and door check-in are not eligibility conditions.

**Independent Test**: With an account holding no paid ticket, confirm the API refuses a direct submission with a reason naming the failed rule.

**Why first**: This is the property that makes every rating worth reading. Built after the write path, it is a filter bolted onto something that already works without it; built first, the write path cannot exist without it.

### Tests for User Story 4

- [X] T010 [P] [US4] Eligibility tests in `server/tests/reviews/write.test.ts`: no ticket → 403 `no_ticket`; order not `paid` → 403; ticket `qr_status = 'void'` → 403; refunded → 403
- [X] T011 [P] [US4] Pre-showtime eligibility test in `server/tests/reviews/write.test.ts`: a paid, non-void ticket to an event before its showtime is accepted
- [X] T012 [P] [US4] Authentication test in `server/tests/reviews/write.test.ts`: no session → 401, and `event_reviews` is unchanged

### Implementation for User Story 4

- [X] T013 [US4] Implement `eligibility(userId, eventId)` in `reviews.repo.ts`: join `tickets → orders → reservations → showtimes`, requiring `orders.payment_status = 'paid'` and `tickets.qr_status <> 'void'`; derive eligibility from the caller's own rows and return failed conditions separately so a refusal can name which failed
- [X] T014 [US4] Enforce it in `reviews.service.ts` before every write, mapping each failure to its own error code

**Checkpoint**: The gate exists and is proven, before anything can pass through it.

---

## Phase 4: User Story 1 - Rate and review a purchased event (Priority: P1)

**Goal**: An eligible attendee submits stars and optional text and sees it appear.

**Independent Test**: As the eligible account, submit four stars and a sentence; verify it is stored and the aggregate moves.

### Tests for User Story 1

- [X] T015 [P] [US1] Contract test in `server/tests/reviews/write.test.ts`: a valid submission returns the shape in `reviews.openapi.yaml` and stores one row
- [X] T016 [P] [US1] Validation tests in `server/tests/reviews/write.test.ts`: missing rating → 400; rating 0 and 6 → 400; body over 2000 characters → 400 with nothing stored; whitespace-only body stored as null
- [X] T017 [P] [US1] Text-fidelity test in `server/tests/reviews/write.test.ts`: a body containing `<script>alert(1)</script>` comes back byte-identical from the API — escaping belongs at the render boundary, and escaping on the way in would corrupt it
- [X] T018 [P] [US1] Concurrency test in `server/tests/reviews/write.test.ts`: two simultaneous first submissions from one account leave exactly one row

### Implementation for User Story 1

- [X] T019 [US1] Implement `upsert` in `reviews.repo.ts` using `ON CONFLICT (event_id, user_id) DO UPDATE`, so the unique index — not a prior read — is what guarantees one review per person
- [X] T020 [US1] Implement `POST /api/events/:eventId/reviews` in `reviews.routes.ts`
- [X] T021 [US1] Create `src/services/reviewsClient.ts`, importing every type from `shared/reviews/types.ts` and re-declaring none
- [X] T022 [US1] Create `src/components/reviews/StarRating.tsx`: one component, interactive and read-only modes, operable by keyboard as a radio group with visible focus
- [X] T023 [US1] Create `src/components/reviews/ReviewForm.tsx`: stars plus textarea, submit disabled until a star is chosen, a live character count near the limit, on the established type scale (`text-eyebrow` and up, `font-meta` / `font-display`, hairline rules, no `rounded-lg`)

**Checkpoint**: A review can be written and read back.

---

## Phase 5: User Story 2 - Read what other attendees said (Priority: P1)

**Goal**: Anyone, signed in or not, sees the average, the count and the reviews.

**Independent Test**: Open an event with several reviews while signed out and verify all three are present.

### Tests for User Story 2

- [X] T024 [P] [US2] Public-read test in `server/tests/reviews/read.test.ts`: the listing answers 200 without a session
- [X] T025 [P] [US2] Aggregate test in `server/tests/reviews/read.test.ts`: the average equals the mean of visible ratings after an insert, an edit, an author delete and a moderation removal; an event with none reports `rating: null`, never `0`
- [X] T026 [P] [US2] Paging test in `server/tests/reviews/read.test.ts`: newest first; keyset paging over twelve reviews returns each exactly once; `hasMore` is accurate on both pages
- [X] T027 [P] [US2] Orphan test in `server/tests/reviews/read.test.ts`: after the author's account is deleted the review still lists, with a null author, and still counts toward the average

### Implementation for User Story 2

- [X] T028 [US2] Implement `listForEvent` and `summary` in `reviews.repo.ts`: visible rows only, newest first, keyset on `created_at`, left-joining `users` so a null author is a row rather than a missing one
- [X] T029 [US2] Implement `GET /api/events/:eventId/reviews`, public, returning summary, page, `hasMore` and — for a signed-in reader — `viewer` with `canReview`, its reason, and their own review, so the page needs one call and not three
- [X] T030 [US2] Add `rating` and `reviewCount` to `getEventDetail` in `server/src/modules/catalog/catalog.repo.ts`, so the summary renders from the response the screen already fetches
- [X] T031 [US2] Create `src/components/reviews/ReviewSection.tsx`: the average and count, the list, a "load more" control, and either the form, the reader's existing review, or the reason neither is offered
- [X] T032 [US2] Mount the section in `src/components/EventDetail.tsx` below the existing content, and show the aggregate near the title

**Checkpoint**: Reviews are visible to everyone. US1 + US2 + US4 together are a complete, useful feature.

---

## Phase 6: User Story 3 - Change or withdraw your review (Priority: P2)

**Goal**: An author edits or deletes their own review, and nobody else's.

**Independent Test**: Edit your review and confirm one row remains with the new content and an edited marker; attempt to edit someone else's and be refused.

### Tests for User Story 3

- [X] T033 [P] [US3] Edit tests in `server/tests/reviews/write.test.ts`: an author's edit updates rating and body, sets `edited`, moves the aggregate, and creates no second row
- [X] T034 [P] [US3] Ownership tests in `server/tests/reviews/write.test.ts`: `PATCH` and `DELETE` on somebody else's review answer **404, not 403**, so probing ids discloses nothing about what exists
- [X] T035 [P] [US3] Withdrawal test in `server/tests/reviews/write.test.ts`: the author's delete removes the row and recalculates the aggregate; an event whose only review is withdrawn reports `rating: null`

### Implementation for User Story 3

- [X] T036 [US3] Implement `updateOwn` and `deleteOwn` in `reviews.repo.ts` with `user_id` in the `WHERE`; zero rows affected becomes a 404
- [X] T037 [US3] Implement `PATCH /api/reviews/:id` and `DELETE /api/reviews/:id`
- [X] T038 [US3] In `ReviewSection.tsx`, offer edit and delete on the reader's own review, with a confirmation before deleting

**Checkpoint**: Authors control their own words.

---

## Phase 7: User Story 5 - Report a review (Priority: P2)

**Goal**: A reader reports a review; an admin sees it and can remove it.

**Independent Test**: Report a review, then remove it as an admin and confirm it stops appearing and stops counting.

### Tests for User Story 5

- [X] T039 [P] [US5] Report tests in `server/tests/reviews/moderate.test.ts`: a report is stored with `target_type = 'review'`; a second by the same reader answers "already reported" and creates no duplicate; reporting without a session → 401
- [X] T040 [P] [US5] Removal tests in `server/tests/reviews/moderate.test.ts`: an admin removal sets `status = 'removed'`, hides the review, excludes it from the aggregate, and writes an `audit_logs` row; a non-admin attempt → 403
- [X] T041 [P] [US5] Retention test in `server/tests/reviews/moderate.test.ts`: a removed review's row still exists, so its report and audit entry keep a subject

### Implementation for User Story 5

- [X] T042 [US5] Implement `POST /api/reviews/:id/report` writing to `content_reports`, one per reader per review
- [X] T043 [US5] Implement `setStatus` in `reviews.repo.ts` and `removeReview` in `server/src/modules/admin/admin.service.ts` — status change and audit row in one transaction
- [X] T044 [US5] Add `DELETE /api/admin/reviews/:id` to `server/src/modules/admin/admin.routes.ts`, behind `requireAdmin`
- [ ] T045 [US5] Show reported reviews in the moderation queue in `src/components/AdminModeration.tsx`, with the review's text and a remove control
- [X] T046 [US5] Add a report control to each review in `ReviewSection.tsx`, with a reason prompt

---

## Phase 8: Polish & Cross-Cutting

- [X] T047 [P] Grep for `dangerouslySetInnerHTML` across `src/` and confirm no review path uses it — the prohibition is the whole of the output-encoding story (SEC-07)
- [ ] T048 [P] Confirm the review section is reachable and operable by keyboard alone: stars as a radio group, focus visible throughout, the list announced to assistive technology
- [X] T049 Run `npm run typecheck`, `npm run lint`, `npm test -- --run`; the first two clean, the third with no new failures against the recorded baseline
- [ ] T050 Confirm review-module statement coverage is at or above 60% per SC-009
- [ ] T051 Walk all ten scenarios in [quickstart.md](./quickstart.md)

---

## Phase 9: Documentation

- [X] T052 Update UC-18 in `docs/Analysis_Design/Group02_UseCaseSpecification.md`: the precondition is a paid, non-void ticket regardless of showtime start or door check-in; the organizer-profile half remains deferred until such a page exists

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)** → **Foundational (2)** → everything else
- **US4 (3)** comes before US1, deliberately: the gate is built before the door
- **US1 (4)** depends on US4
- **US2 (5)** depends on US1 — there is nothing to read until something can be written
- **US3 (6)** and **US5 (7)** depend on US2 and are independent of each other
- **Polish (8)**, then **Documentation (9)**

### Parallel Opportunities

- Every test task within one story ([P]) — separate `describe` blocks
- T005 and T006 in Foundational; T047 and T048 in Polish
- US3 and US5 can be taken by two people once US2 lands

### Suggested Stopping Points

- **After US2**: the feature is complete and useful — write, read, and a gate that means the ratings can be trusted
- **After US5**: publishable user text has a route to moderation, which is what makes it safe to leave running

## Notes

- Phases 3–7 all touch `reviews.repo.ts`, `reviews.service.ts` and `reviews.routes.ts`. Sequence them or give one person the module
- Verify each test fails before writing the implementation it covers
- Commits stay local and are authored by the user
