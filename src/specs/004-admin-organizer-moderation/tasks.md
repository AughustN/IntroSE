# Tasks: Admin Organizer & Event Moderation

**Input**: Design documents from `specs/004-admin-organizer-moderation/`

**Execution order**: DB Migration → Middleware & Helper → Backend Admin Endpoints → Integration Tests (Vitest) → Frontend `AdminPanel.tsx` → Typecheck.

## Phase 1: DB Migration

- [X] T001 Inspect `server/src/db/migrations/0001_auth.sql`, `server/src/db/migrations/0002_catalog.sql`, `server/src/db/migrations/0003_holds.sql`, and existing order/ticket/wallet migrations; identify canonical tables.
- [X] T002 Create `server/src/db/migrations/0004_admin_moderation.sql` with `content_reports` and `moderation_actions`, constraints, indexes, and idempotency keys.
- [X] T003 [P] Extend `audit_logs` in `server/src/db/migrations/0004_admin_moderation.sql` with outcome support and target indexes.
- [X] T004 Add `audit_logs_immutable` trigger in `server/src/db/migrations/0004_admin_moderation.sql` rejecting UPDATE and DELETE.
- [X] T005 [P] Add migration compatibility comments/guards in `server/src/db/migrations/0004_admin_moderation.sql`.

## Phase 2: Middleware & Helper

- [X] T006 [P] Define shared admin types in `shared/admin/types.ts`.
- [X] T007 Harden admin authorization and target validation in `server/src/middleware/authz.ts` and `server/src/middleware/validate.ts`.
- [X] T008 [P] Implement audit insertion/listing in `server/src/modules/admin/audit.ts`.
- [X] T009 Implement locked moderation repositories in `server/src/modules/admin/admin.repo.ts`.
- [X] T010 Implement transactional organizer/event/report services in `server/src/modules/admin/admin.service.ts`.
- [ ] T011 [P] Implement canonical future-ticket wallet refunds and inventory release in `server/src/modules/admin/admin.service.ts` after order/ticket/wallet tables exist.
- [X] T012 [P] Confirm live suspension visibility in `server/src/modules/catalog/visibility.ts` and `server/src/modules/catalog/catalog.repo.ts`.

## Phase 3: Backend Admin Endpoints

- [X] T013 [US1] Create admin route definitions with `requireAuth` and `requireAdmin` in `server/src/modules/admin/admin.routes.ts`.
- [X] T014 [US1] Implement organizer queue, approve, and reject handlers in `server/src/modules/admin/admin.routes.ts`.
- [X] T015 [US2] Implement organizer suspension handler in `server/src/modules/admin/admin.routes.ts`.
- [X] T016 [US3] Implement event queue and approve/reject/flag/remove handlers in `server/src/modules/admin/admin.routes.ts`.
- [X] T017 [US4] Implement report dismiss/resolve handlers in `server/src/modules/admin/admin.routes.ts`.
- [ ] T018 [US4] Connect removal to future-showtime cancellation, ticket voiding, 100% wallet refunds, and inventory release in `server/src/modules/admin/admin.service.ts` after canonical schema exists.
- [X] T019 [US5] Implement read-only audit logs in `server/src/modules/admin/admin.routes.ts`.
- [X] T020 [US1] [US2] [US3] [US4] Mount `server/src/modules/admin/admin.routes.ts` at `/api/admin` in `server/src/app.ts`.
- [X] T021 [P] [US1] [US2] [US3] [US4] [US5] Keep `shared/admin/types.ts` aligned with `contracts/admin.openapi.yaml`.

## Phase 4: Integration Tests (Vitest)

- [ ] T022 Create PostgreSQL fixtures in `server/tests/integration/admin-moderation.test.ts`.
- [ ] T023 [US1] Test organizer approval/rejection, capability refresh, notification intent, conflict, and RBAC in `server/tests/integration/admin-moderation.test.ts`.
- [ ] T024 [US2] Test suspension and immediate public hiding in `server/tests/integration/admin-moderation.test.ts`.
- [ ] T025 [US3] Test pre-publish approve/reject gate in `server/tests/integration/admin-moderation.test.ts`.
- [ ] T026 [US4] Test report actions, removal, future-only effects, and notifications in `server/tests/integration/admin-moderation.test.ts`.
- [ ] T027 [US4] Test exactly-once wallet refund/idempotency after canonical schema exists in `server/tests/integration/admin-moderation.test.ts`.
- [ ] T028 [US5] Test concurrent actions and transaction rollback in `server/tests/integration/admin-moderation.test.ts`.
- [ ] T029 [US5] Test PostgreSQL audit UPDATE/DELETE rejection in `server/tests/integration/admin-moderation.test.ts`.

## Phase 5: Frontend UI `AdminPanel.tsx`

- [X] T030 [P] Create typed admin client in `src/services/adminClient.ts`.
- [X] T031 [US1] [US2] Add organizer approval/rejection/suspension UI in `src/components/AdminPanel.tsx`.
- [X] T032 [US3] Add event pre-publish moderation UI in `src/components/AdminPanel.tsx`.
- [X] T033 [US4] Add report/flag/remove UI in `src/components/AdminPanel.tsx`.
- [X] T034 [US5] Add read-only audit panel and accessibility states in `src/components/AdminPanel.tsx`.
- [X] T035 [US1] [US2] [US3] [US4] Integrate admin client with existing admin routing in `src/App.tsx`.

## Phase 6: Typecheck and final validation

- [X] T036 [US1] [US2] [US3] [US4] [US5] Run `npm run typecheck` and fix strict errors.
- [X] T037 [P] Run `npm run lint` and fix changed-file violations.
- [X] T038 [P] Run migration validation and focused moderation tests with configured `DATABASE_URL`.
- [ ] T039 [US1] [US2] [US3] [US4] [US5] Execute all `specs/004-admin-organizer-moderation/quickstart.md` scenarios.

## Blockers

- `T011`, `T018`, and `T027` remain blocked: current repository has no canonical order/ticket/wallet-ledger migration. No fake refund path added.
- Full suite has unrelated existing failures in hold tests; focused moderation suite passes.
- `T039` full quickstart remains pending because it includes refund scenarios requiring absent ticket/wallet schema.

## Notes

- `[X]` marks completed work.
- Refunds remain wallet-only whole VND; no cash settlement or card data.
- `audit_logs` DB trigger applied successfully and focused moderation tests pass.
- Compatibility retained: `/api/admin/moderation` returns event array for existing catalog tests; `/api/admin/moderation/queue` returns unified queue.
