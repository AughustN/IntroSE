# Tasks: Concession Add-Ons (Báº¯p NÆ°á»›c)

**Input**: Design documents from `/specs/014-fnb-add-ons/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/fnb-api.md, quickstart.md

**Tests**: Included â€” the user requested unit/integration tests per story; write each story's tests FIRST and confirm they FAIL before implementing that story.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested, and demonstrated independently. File paths reference real files in this repo (frontend names from the request map to actual files: seat/checkout flow â†’ `src/components/SeatLayout.tsx` + `src/components/CheckoutForm.tsx`; order/ticket detail â†’ `src/components/BookingHistory.tsx` + `src/components/TicketTicket.tsx`; organizer editor â†’ `src/components/organizer/EventEditor.tsx`; staff scanner â†’ `src/components/organizer/CheckInPanel.tsx` + `src/components/QrCameraScan.tsx`).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1 = buy with tickets, US2 = organizer menu, US3 = redemption & refunds)
- Include exact file paths in descriptions

## Path Conventions

Monorepo as per plan.md: `shared/` (typed FE/BE contract), `server/src/` (Express API), `src/` (React SPA), `server/tests/` (Vitest + Supertest), `data_base/InitDB.sql` (schema dump).

---

## Phase 1: Setup & Shared Infrastructure

**Purpose**: One typed contract both sides import (Principle VI) before any code exists.

- [x] T001 Create the shared concession contract module `shared/types/fnb.ts` with `ConcessionState`, `ConcessionItem`, `PublicConcession`, `ReservationConcessionLine`, `OrderConcessionLine`, `ConcessionVoucher`, and the error-code union (`concession_quantity_limit`, `concession_unavailable`, `concession_in_use`, `concession_voucher_not_found`, `voucher_void`) exactly per contracts/fnb-api.md
- [x] T002 [P] Extend `Reservation` in shared/holds/types.ts with optional `concessions?: ReservationConcessionLine[]` and document that `totalAmount` now includes them (imports from shared/types/fnb.ts)
- [x] T003 [P] Extend `CheckoutOrder` and `OrderListItem` in src/services/walletClient.ts with optional `concessions?: OrderConcessionLine[]` and `voucher?: ConcessionVoucher` imported from shared/types/fnb.ts

**Checkpoint**: Contract compiles on both sides (`npm run typecheck`) â€” no consumer re-declares payloads.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema + data access that EVERY user story depends on.

**âš ï¸ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T004 Write migration server/src/db/migrations/0039_concession_add_ons.sql creating the four tables of data-model.md â€” `concession_items` (event_id FK, label, description, price_amount int8 CHECK >= 0, state CHECK listed/stopped), `reservation_concessions` (reservation_id FK CASCADE, concession_item_id FK, quantity CHECK BETWEEN 1 AND 10, UNIQUE(reservation_id, concession_item_id)), `order_concessions` (order_id FK, snapshot columns item_label + unit_price_amount), `concession_vouchers` (order_id UNIQUE, code UNIQUE, code_hash UNIQUE sha256-hex, status CHECK unredeemed/redeemed/void, redeemed_at, redeemed_by) plus the partial index on (event_id) WHERE state='listed' â€” following the style of server/src/db/migrations/0038_release_phase.sql
- [x] T005 Sync data_base/InitDB.sql by appending the same DDL from T004 in the established table-comment style so fresh installs match migrated databases exactly
- [x] T006 Create server/src/modules/concessions/concessions.repo.ts with parameterized queries: listPublicByEvent(eventId) (visibility predicate JOIN + state='listed'), listByEventOwned(eventId), getItem(eventId, itemId), replaceReservationLines(), linesForReservation(), linesForOrder() â€” all money as VND integers

**Checkpoint**: Migration applies cleanly (`npm run db:migrate`); repo compiles. User stories can now proceed â€” US1 immediately, US2/US3 in priority order or parallel by separate owners.

---

## Phase 3: User Story 1 â€” Mua báº¯p nÆ°á»›c kÃ¨m vÃ© trong 1 láº§n thanh toÃ¡n (Priority: P1) ðŸŽ¯ MVP

**Goal**: An attendee adds snacks to a ticket reservation and pays ONCE; the paid order shows immutable snapshot lines and one QR voucher.

**Independent Test**: Hold any ticket â†’ PUT cart lines â†’ checkout â†’ combined debit equals tickets + snacks to the Ä‘á»“ng, response carries snapshot lines + one voucher (quickstart.md Scenario B).

### Tests for User Story 1 âš ï¸ (write FIRST, confirm FAIL)

- [x] T007 [P] [US1] Integration test in server/tests/concessions/checkout.test.ts: combined total math (tickets + Î£ qtyÃ—price), single wallet 'purchase' entry for the combined amount, voucher minted once per order, idempotent re-checkout, insufficient-balance details include concessions, quantity 11 rejected `422 concession_quantity_limit`, stopped item rejects checkout `409 concession_unavailable`, concessions-only order impossible

### Implementation for User Story 1

- [x] T008 [US1] Public menu read GET /api/catalog/events/:eventId/concessions in new server/src/modules/concessions/concessions.public.routes.ts (asyncH wrapper, catalog IP rate limiter, empty-list never-error semantics) mounted at `/api` in server/src/app.ts beside catalogPublicRouter
- [x] T009 [US1] Cart integration: PUT /api/reservations/:id/concessions replacement-set endpoint in server/src/modules/holds/reservations.routes.ts backed by repo helpers, enforcing owner-only, upcoming-showtime gate, 1..10 cap with Vietnamese messages; include `concessions[]` and recomputed `totalAmount` in the reservation read path of server/src/modules/holds/holds.service.ts
- [x] T010 [US1] Fold concessions into checkout(): inside the existing transaction in checkout() of server/src/modules/payments/wallet.service.ts read+lock lines joined to items FOR UPDATE, reprice live, refuse stopped items with `concession_unavailable`, add Î£ qtyÃ—price into `total` BEFORE the balance check so shortfall math covers snacks, then insert order_concessions snapshot rows (item_label + unit_price_amount captured at payment)
- [x] T011 [US1] Voucher issuance helper mintConcessionVoucher(client, orderId) in server/src/modules/payments/tickets.service.ts using randomUUID() code + createHash('sha256') code_hash (same pattern as tickets at wallet.service.ts:504-517); call it from checkout() right after order creation iff â‰¥1 concession line
- [x] T012 [US1] Order reads return the new shape: extend readOrderById/listOrders queries in server/src/modules/payments/wallet.service.ts to LEFT JOIN order_concessions + concession_vouchers so OrderView carries concessions[] and voucher{}
- [x] T013 [US1] Frontend menu selector: create src/components/ConcessionMenu.tsx (quantity steppers clamped 1..10, live line totals, Vietnamese copy) and wire it into the booking flow beside tier/seat selection in src/components/SeatLayout.tsx and the review step of src/components/CheckoutForm.tsx, syncing via a concessionsPut helper added to src/services/holdsClient.ts
- [x] T014 [US1] Frontend order/ticket display: render snapshot concession lines and the scannable voucher QR (status-aware) in src/components/BookingHistory.tsx order detail and src/components/TicketTicket.tsx, hiding both entirely when absent so tickets-only orders look unchanged

**Checkpoint**: US1 demoable end-to-end without US2/US3 â€” menu seeded via SQL is acceptable here. Run `npm test -- --run server/tests/concessions/checkout.test.ts`.

---

## Phase 4: User Story 2 â€” Organizer quáº£n lÃ½ menu báº¯p nÆ°á»›c (Priority: P2)

**Goal**: The owning organizer creates/edits/stops/re-lists menu items server-side-authorised; stopping sales never rewrites paid history.

**Independent Test**: CRUD against own event succeeds; foreign organizer gets 403; after PATCH stopped, public menu hides the item while an earlier paid order still shows its original label+price (quickstart.md Scenarios A + D).

### Tests for User Story 2 âš ï¸ (write FIRST, confirm FAIL)

- [x] T015 [P] [US2] Integration test in server/tests/concessions/organizer-crud.test.ts: full RBAC matrix (owner ok / non-owner 403 / unauthenticated 401), validation of label length and integer price (`422 invalid_price`), DELETE returns `409 concession_in_use` once referenced else 204, PATCH stopped hides from public GET, snapshot immutability of prior orders after stop + price edit

### Implementation for User Story 2

- [x] T016 [US2] Organizer CRUD router POST/PUT/PATCH/DELETE under /api/organizer/events/:eventId/concessions in new server/src/modules/concessions/concessions.organizer.routes.ts with Zod schemas, server-side ownership assert (events.organizer_id â†’ organizers.user_id, mirroring the guard pattern in server/src/modules/catalog/organizer.routes.ts), DELETE hard-delete only when unreferenced else `concession_in_use`, PATCH state listedâ‡„stopped â€” mounted at `/api/organizer` in server/src/app.ts
- [x] T017 [US2] Service rules in server/src/modules/concessions/concessions.service.ts: owned-menu reads regardless of moderation state, relist semantics, price-edit affects only future purchases (assert no UPDATE ever touches order_concessions)
- [x] T018 [P] [US2] API client methods (list/create/update/setState/remove) appended to the organizer section of src/services/catalogClient.ts typed from shared/types/fnb.ts
- [x] T019 [US2] Frontend manager tab: create src/components/organizer/OrganizerConcessionsTab.tsx (list + create/edit form with Ä‘á»“ng-formatted price input, stop/re-list toggle, delete-with-confirm honoring `concession_in_use`)
- [x] T020 [US2] Wire the tab into the organizer studio: add nav entry in src/components/organizer/OrganizerNav.tsx and render the tab within src/components/organizer/EventEditor.tsx flow

**Checkpoint**: US2 independently demoable; run `npm test -- --run server/tests/concessions/organizer-crud.test.ts`.

---

## Phase 5: User Story 3 â€” QuÃ©t Ä‘á»•i táº¡i quáº§y & hoÃ n tiá»n khi há»§y sá»± kiá»‡n (Priority: P3)

**Goal**: Staff scan the voucher once to hand over everything ordered; rescans are refused; cancelling the event refunds tickets AND snacks into wallets and voids vouchers.

**Independent Test**: Paid order â†’ redeem (already:false) â†’ rescan (already:true, nothing changes); cancel event â†’ wallet credit equals tickets + concessions, voucher void (quickstart.md Scenarios C + E).

### Tests for User Story 3 âš ï¸ (write FIRST, confirm FAIL)

- [x] T021 [P] [US3] Integration tests in server/tests/concessions/redeem.test.ts (first scan success hands over every line; second scan refused with already:true and zero mutations; unknown code and another organizer's code answer identical 404; admin allowed; void voucher â†’ 409 voucher_void) and server/tests/concessions/cancellation.test.ts (refund credit equals tickets + Î£ qtyÃ—snapshot price, one kind='refund' ledger row per order, vouchers voided, audit refundedAmount includes concessions)

### Implementation for User Story 3

- [x] T022 [US3] Redemption endpoint POST /api/checkin/concessions/redeem {code} in new server/src/modules/checkin/concessions.routes.ts calling a redeemConcessionVoucher(actor, code) service function colocated with checkIn in server/src/modules/checkin/checkin.service.ts â€” actor scoping copied from checkIn (owning organizer or admin, anti-oracle not_found for unknown/foreign), single guarded UPDATE â€¦ WHERE status='unredeemed' inside withTransaction, mount at `/api/checkin` in server/src/app.ts
- [x] T023 [US3] Cancellation refunds: extend settleEventCancellation() in server/src/modules/payments/tickets.service.ts to refund concession lines of affected paid orders (wallet FOR UPDATE credit, one wallet_transactions kind='refund' row per order, set voucher status='void'), include the sum in returned refundedAmount, and leave updateOrderRefundStatus logic untouched
- [x] T024 [P] [US3] Frontend scanner support: recognise concession-voucher payloads and render the redemption result (lines handed over / already / refusals) in src/components/organizer/CheckInPanel.tsx with the camera capture path through src/components/QrCameraScan.tsx, adding a concessionsRedeem method next to checkIn in src/services/catalogClient.ts
- [x] T025 [US3] Frontend status rendering: show voucher state (unredeemed/redeemed/void with Vietnamese labels "ChÆ°a nháº­n" / "ÄÃ£ nháº­n" / "ÄÃ£ huá»·") in src/components/BookingHistory.tsx and src/components/TicketTicket.tsx

**Checkpoint**: All three stories independently functional â€” full quickstart.md loop passes manually.

---

## Phase 6: Polish & Verification

**Purpose**: Cross-cutting verification and governance docs.

- [x] T026 Run and fix the full quality gate: `npm run lint` (ESLint + Prettier) and strict TypeScript compile across shared/, server/, src/ with zero errors (MAIN-01/MAIN-02)
- [x] T027 [P] Document the two new domain terms (Concession item "mÃ³n bÃ¡n kÃ¨m", Concession voucher) in CONTEXT.md glossary following the existing entry style, distinguishing them from Ticket tier
- [ ] T028 Execute specs/014-fnb-add-ons/quickstart.md end-to-end (Scenarios Aâ€“E) against a seeded dev database and record the SC-005 k6 spot-check (p95 confirm delta < 1 s vs tickets-only) results at the bottom of quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: none â€” start immediately; T002/T003 depend only on T001's types existing.
- **Phase 2 (Foundational)**: T004 â†’ T005 â†’ T006 (T006 needs tables to query). **BLOCKS all user stories.**
- **Phase 3 (US1)**: needs Phase 2 complete. Within the story: T007 (tests fail first) â†’ T008â€“T012 backend chain (T010+T011 before T012's read shapes) â†’ T013/T014 frontend (need T009/T012 contracts live).
- **Phase 4 (US2)**: needs Phase 2; independent of US1 except T015's immutability case reuses a paid order fixture from T007's setup. FE tasks need T018's client methods.
- **Phase 5 (US3)**: redemption needs US1's voucher minting (T011) to exist; cancellation refunds likewise. T024 needs T022's endpoint.
- **Phase 6 (Polish)**: after all desired stories.

### User Story Dependencies

- **US1 (P1)**: foundational only â€” no cross-story dependency.
- **US2 (P2)**: foundational only; may start in parallel with US1 by a second developer (different files).
- **US3 (P3)**: consumes US1 outputs (voucher rows exist only if checkout mints them); keep after US1 or develop against fixtures.

### Within Each User Story

Tests first (fail) â†’ repo/service â†’ endpoints â†’ frontend wiring â†’ story checkpoint run.

### Parallel Opportunities

- Phase 1: T002 âˆ¥ T003 (after T001).
- Phase 3: T007 alone-first; later T013 âˆ¥ T014 (separate components).
- Phase 4: T015 âˆ¥ nothing-in-story-start; T018 âˆ¥ T016 (client vs routes); T019 âˆ¥ T020 sequencing (tab then nav wire).
- Phase 5: T021 test pair written together; T024 âˆ¥ T025 (different components).
- Cross-story: US2 is fully parallelisable with US1 (disjoint files) once Phase 2 lands.

---

## Parallel Example: Phase 2 â†’ Stories handoff

```bash
# After T006 merges, two developers split:
Dev A (US1): T007 â†’ T008 â†’ T009 â†’ T010 â†’ T011 â†’ T012 â†’ (T013 âˆ¥ T014)
Dev B (US2): T015 â†’ T016 â†’ T017 â†’ (T018 âˆ¥) â†’ T019 â†’ T020
# Then either owner takes US3: T021 â†’ T022 â†’ T023 â†’ (T024 âˆ¥ T025)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phases 1â€“2 done â†’ foundation ready
2. Complete Phase 3 â†’ **STOP and VALIDATE** with T007 + manual Scenario B
3. Demo: buyer buys vÃ© + báº¯p nÆ°á»›c in one payment with a QR voucher (menu via SQL seed is acceptable for the demo)

### Incremental Delivery

Add US2 (organizers self-serve menus) â†’ validate Scenario A/D. Add US3 (operations close the loop) â†’ validate Scenarios C/E. Each increment ships value without regressing the previous one.

### Notes

- [P] tasks touch different files with no dependency on incomplete work.
- Money stays VND integers everywhere; never introduce floats (STD-03).
- Every denial asserted in tests must match the Vietnamese message shipped in the endpoint.
- Legacy mock `comboOffer` in src/data.ts remains untouched (spec assumption).
