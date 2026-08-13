# Tasks: Organizer Event Management

**Input**: Design documents from `/specs/010-organizer-event-management/`  
**Prerequisites**: [`plan.md`](file:///D:/HCMUS/NhapMonCongNghePhanMem/Project/source/IntroSE/src/specs/010-organizer-event-management/plan.md), [`spec.md`](file:///D:/HCMUS/NhapMonCongNghePhanMem/Project/source/IntroSE/src/specs/010-organizer-event-management/spec.md), [`research.md`](file:///D:/HCMUS/NhapMonCongNghePhanMem/Project/source/IntroSE/src/specs/010-organizer-event-management/research.md), [`data-model.md`](file:///D:/HCMUS/NhapMonCongNghePhanMem/Project/source/IntroSE/src/specs/010-organizer-event-management/data-model.md), [`contracts/organizer-events-api.md`](file:///D:/HCMUS/NhapMonCongNghePhanMem/Project/source/IntroSE/src/specs/010-organizer-event-management/contracts/organizer-events-api.md), [`quickstart.md`](file:///D:/HCMUS/NhapMonCongNghePhanMem/Project/source/IntroSE/src/specs/010-organizer-event-management/quickstart.md)

---

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g. US1, US2, US3, US4, US5)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Define data types and foundational client structures.

- [x] T001 Define OrganizerEvent, TicketTier, and OrganizerPortfolioSummary interfaces in src/types.ts
- [x] T002 [P] Create organizer API client skeleton in src/services/organizerClient.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core scoping and mock/API state infrastructure that MUST be complete before user story work.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T003 Implement organizer identity scoping helper (`organizer_id = req.user.id`) in src/services/organizerClient.ts
- [x] T004 [P] Implement mock data store and state persistence adapter for organizer events in src/services/organizerClient.ts

**Checkpoint**: Foundation ready - user story implementation can now begin.

---

## Phase 3: User Story 1 - Organizer Event Portfolio & Overview Dashboard (Priority: P1) 🎯 MVP

**Goal**: Enable organizers to view their complete event portfolio, filter by status (Draft, Pending Approval, Published, Canceled, Completed), search by keyword, and inspect summary metrics.

**Independent Test**: Log in as an organizer, navigate to `/organizer/events`, apply status filters and search keywords, and verify only scoped events display with accurate summary metrics.

### Implementation for User Story 1

- [x] T005 [P] [US1] Create EventCard component with status badges in src/components/organizer/EventCard.tsx
- [x] T006 [P] [US1] Create PortfolioSummaryHeader component displaying total events and revenue in src/components/organizer/PortfolioSummaryHeader.tsx
- [x] T007 [US1] Implement portfolio listing and filtering methods in src/services/organizerClient.ts
- [x] T008 [US1] Implement OrganizerEventsPage with status filtering, search bar, and empty state in src/pages/organizer/OrganizerEventsPage.tsx
- [x] T009 [US1] Register `/organizer/events` route in src/routes.ts

**Checkpoint**: User Story 1 (MVP) fully functional and testable independently.

---

## Phase 4: User Story 2 - Single Event Detail Management Workspace (Priority: P1)

**Goal**: Provide a dedicated single-event management workspace showing detailed sales metrics (tickets sold, remaining, revenue in VND), venue/schedule info, and ticket tier breakdowns.

**Independent Test**: Select an event from the portfolio, verify navigation to `/organizer/events/:id`, and confirm all metrics (sold count, remaining, VND revenue, start/end date, tier breakdown) match backend data.

### Implementation for User Story 2

- [x] T010 [P] [US2] Create EventMetricsSummary component for real-time sales and inventory stats in src/components/organizer/EventMetricsSummary.tsx
- [x] T011 [P] [US2] Create TicketTierBreakdown component showing tier capacity, sold count, and remaining count in src/components/organizer/TicketTierBreakdown.tsx
- [x] T012 [US2] Implement `getEventDetail` query method in src/services/organizerClient.ts
- [x] T013 [US2] Implement SingleEventPage management workspace view in src/pages/organizer/SingleEventPage.tsx
- [x] T014 [US2] Register `/organizer/events/:id` route in src/routes.ts

**Checkpoint**: User Stories 1 AND 2 functional independently.

---

## Phase 5: User Story 3 - Submit Event Publication Request (Priority: P1)

**Goal**: Allow organizers to submit completed Draft events for platform publication review ("Request to Publish"), validating required fields before transitioning state to "Pending Approval".

**Independent Test**: Select a valid Draft event, click "Request to Publish", confirm validation succeeds, and verify event state changes to "Pending Approval" (`pending_review`).

### Implementation for User Story 3

- [x] T015 [US3] Implement mandatory event details completeness validator in src/services/organizerClient.ts
- [x] T016 [US3] Implement `requestPublication` service action in src/services/organizerClient.ts
- [x] T017 [US3] Integrate "Request to Publish" action button, validation feedback, and status updates in src/pages/organizer/SingleEventPage.tsx

**Checkpoint**: User Stories 1, 2, and 3 functional independently.

---

## Phase 6: User Story 4 - Edit & Update Event Details (Priority: P2)

**Goal**: Enable organizers to edit event details, enforce quota validation (`capacity >= sold_count`), automatically revert Published events to Pending Approval upon material edits (UC-24 A6), and archive ticket tiers with sold tickets upon deletion (UC-26 A3).

**Independent Test**: Edit material fields (title, description, pricing, showtimes) of a Published event and verify status reverts to "Pending Approval". Attempt to delete a tier with sold tickets and verify tier is marked `is_archived: true`.

### Implementation for User Story 4

- [x] T018 [P] [US4] Create EditEventForm modal component in src/components/organizer/EditEventForm.tsx
- [x] T019 [US4] Implement `updateEventDetails` service method with material field status reversion logic (UC-24 A6) in src/services/organizerClient.ts
- [x] T020 [US4] Implement tier capacity reduction validation (`new_capacity >= sold_count`) in src/services/organizerClient.ts
- [x] T021 [US4] Implement `deleteOrArchiveTier` soft-deletion service method (UC-26 A3) in src/services/organizerClient.ts
- [x] T022 [US4] Integrate Edit Event modal and Tier Archiving actions into src/pages/organizer/SingleEventPage.tsx

**Checkpoint**: User Stories 1 through 4 functional independently.

---

## Phase 7: User Story 5 - Event Cancellation & Refund Trigger (Priority: P2)

**Goal**: Allow organizers to cancel an active event prior to completion by providing a mandatory cancellation reason, halting ticket sales immediately (0ms delay) and dispatching store-credit wallet refund triggers.

**Independent Test**: Initiate "Cancel Event", enter a cancellation reason, confirm, and verify event state updates to "Canceled", sales are halted, cancellation audit record is generated, and refund triggers dispatch.

### Implementation for User Story 5

- [x] T023 [P] [US5] Create CancelEventModal component with mandatory cancellation reason prompt in src/components/organizer/CancelEventModal.tsx
- [x] T024 [US5] Implement `cancelEvent` service action with store-credit refund trigger and audit logging in src/services/organizerClient.ts
- [x] T025 [US5] Add Canceled status banner with cancellation reason and timestamp to src/pages/organizer/SingleEventPage.tsx

**Checkpoint**: All 5 User Stories fully functional independently.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Verification, testing, and responsive UI polish.

- [x] T026 [P] Add unit and integration tests for organizer event state transitions in src/tests/organizer/organizerEvents.test.ts
- [x] T027 Run quickstart validation scenarios in src/specs/010-organizer-event-management/quickstart.md across desktop and mobile screen sizes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Can start immediately.
- **Foundational (Phase 2)**: Depends on Setup (Phase 1) - **BLOCKS all user stories**.
- **User Stories (Phases 3–7)**: Depend on Foundational (Phase 2) completion.
  - Can proceed sequentially (P1: US1 → US2 → US3, then P2: US4 → US5) or in parallel.
- **Polish (Phase 8)**: Depends on completion of desired user stories.

### Parallel Opportunities

- **Phase 1**: T001 and T002 can run in parallel.
- **Phase 2**: T003 and T004 can run in parallel.
- **Phase 3 (US1)**: T005 (`EventCard.tsx`) and T006 (`PortfolioSummaryHeader.tsx`) can run in parallel.
- **Phase 4 (US2)**: T010 (`EventMetricsSummary.tsx`) and T011 (`TicketTierBreakdown.tsx`) can run in parallel.
- **Phase 6 (US4)**: T018 (`EditEventForm.tsx`) can run in parallel with service methods.
- **Phase 7 (US5)**: T023 (`CancelEventModal.tsx`) can run in parallel with service logic.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational).
2. Complete Phase 3 (User Story 1: Organizer Portfolio Dashboard).
3. **STOP and VALIDATE**: Verify portfolio view, status filtering, and search functionality independently.

### Incremental Delivery

1. **MVP**: Deliver User Story 1 (Portfolio Overview Dashboard).
2. **Increment 2**: Add User Story 2 (Single Event Workspace) & User Story 3 (Publish Request).
3. **Increment 3**: Add User Story 4 (Edit Details, Material Reversion, Tier Archiving) & User Story 5 (Cancellation & Wallet Refund Trigger).
