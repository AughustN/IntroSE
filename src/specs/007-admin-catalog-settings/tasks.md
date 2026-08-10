# Tasks: Admin Catalog Settings

**Input**: Design documents from `/specs/007-admin-catalog-settings/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/admin-catalog-settings.openapi.yaml`, `quickstart.md`

**Execution order requested**: DB migration → Setting Service → hold/config integration → backend API → integration tests → frontend → typecheck/lint.

## User Story Map

- **US1 (P1)**: Admin manages event categories.
- **US2 (P1)**: Admin curates featured events and display order.
- **US3 (P1)**: Admin configures bounded system settings and future-request behavior.

## Phase 1: DB Migration

**Purpose**: Add persistence constraints before service and API work.

- [X] T001 Create `server/src/db/migrations/0014_catalog_settings.sql` with `system_settings` key-value table, `featured_events` table, foreign keys, timestamps, non-negative display-order check, and unique constraints.
- [X] T002 Add normalized, case-insensitive category-name uniqueness support to `event_categories` in `server/src/db/migrations/0014_catalog_settings.sql` without changing existing `code` values or event references.
- [X] T003 Add indexes for `system_settings(updated_at)`, `featured_events(display_order)`, and category lookup paths in `server/src/db/migrations/0014_catalog_settings.sql`.
- [X] T004 Add migration comments and verify `server/src/db/migrations/0014_catalog_settings.sql` is safe after migrations `0001_auth.sql` through `0013_admin_moderation.sql`.
- [X] T005 Run `npm run db:migrate` against test database and verify existing event categories, events, audit logs, and reservations remain intact.

**Checkpoint**: Schema supports settings, featured ordering, and category uniqueness.

---

## Phase 2: Setting Service

**Purpose**: Centralize effective settings, defaults, bounds, cache, and atomic updates before consumers or routes use them.

- [X] T006 Define shared `SystemSettings`, `SystemSettingKey`, and settings validation error types in `shared/admin/types.ts` from the OpenAPI contract.
- [X] T007 Export named default setting values and unit-safe fallback constants from `server/src/config.ts` while preserving existing environment parsing behavior.
- [X] T008 Implement typed setting definitions, default merge, JSON scalar validation, bounds validation, and cross-field validation in `server/src/modules/admin/settings.service.ts`.
- [X] T009 Implement short-TTL in-memory effective-settings cache, cache-hit behavior, expiry reload, and explicit invalidation after successful writes in `server/src/modules/admin/settings.service.ts`.
- [X] T010 Implement transactional `getSettings`/`updateSettings` DB operations in `server/src/modules/admin/settings.service.ts`, including all-or-nothing writes and fallback for missing or unusable stored rows.
- [X] T011 Integrate `insertAudit` into settings update transaction with before/after values, changed keys, Admin actor, `system_settings` target, and applied outcome in `server/src/modules/admin/settings.service.ts`.
- [X] T012 Add a focused settings-service test seam for cache reset and deterministic TTL control in `server/src/modules/admin/settings.service.ts` or adjacent `server/tests/helpers/settings.ts`.

**Checkpoint**: Service returns defaults, accepts valid updates, rejects invalid updates atomically, caches reads, invalidates writes, and audits successful changes.

---

## Phase 3: Holds and Config Integration

**Purpose**: Make future hold operations consume current settings while preserving active reservation terms.

- [X] T013 Replace hardcoded `HOLD_TTL_MS`, `HOLD_GRACE_MS`, `HOLD_ABSOLUTE_MS`, and `SEAT_CAP` imports with effective settings reads in `server/src/modules/holds/holds.service.ts`.
- [X] T014 Compute new reservation expiry from `seat_hold_ttl_minutes` at hold-start time and use `max_tickets_per_buyer` for seated and GA cap checks in `server/src/modules/holds/holds.service.ts`.
- [X] T015 Read `topup_grace_minutes` and `absolute_ceiling_minutes` only when `extendOnce` begins, then persist resulting expiry without recalculating existing reservations in `server/src/modules/holds/holds.service.ts`.
- [X] T016 Keep sweep interval and anti-spam throttle constants unchanged, and document why they remain environment/config constants in `server/src/modules/holds/sweep.ts` and `server/src/modules/holds/holds.throttle.ts`.
- [X] T017 Add future-only settings coverage for active reservation timestamps, changed TTL, changed cap, and changed grace/ceiling in `server/tests/holds/settings.test.ts`.

**Checkpoint**: Existing holds retain stored terms; new holds and extensions use current effective settings.

---

## Phase 4: Backend API Endpoints

**Purpose**: Expose Admin-only category, featured-event, and settings workflows through existing `/api/admin` router.

### Categories (US1)

- [X] T018 [US1] Add category list, create, rename, and delete repository queries with normalized-name conflict handling and event-reference checks in `server/src/modules/admin/admin.repo.ts`.
- [X] T019 [US1] Implement category service workflows using `withTransaction`, stable category codes, conflict errors, and unchanged data on failed deletion or rename in `server/src/modules/admin/admin.service.ts`.
- [X] T020 [US1] Add `GET/POST /api/admin/categories` and `PUT/DELETE /api/admin/categories/:id` routes with Zod schemas, existing `requireAuth`/`requireAdmin`, and typed responses in `server/src/modules/admin/admin.routes.ts`.
- [X] T021 [US1] Update public category projection and filtering so renamed labels appear immediately while stable category codes continue working in `server/src/modules/catalog/catalog.repo.ts`.

### Featured Events (US2)

- [X] T022 [US2] Add featured-event list and atomic replacement queries with event locking, public-eligibility checks, unique display-order validation, and deterministic ordering in `server/src/modules/admin/admin.repo.ts`.
- [X] T023 [US2] Implement featured-event membership and reorder service workflow with rollback on invalid event/order and no stale public exposure in `server/src/modules/admin/admin.service.ts`.
- [X] T024 [US2] Add `GET/PUT /api/admin/homepage/featured` routes with payload validation and typed responses in `server/src/modules/admin/admin.routes.ts`.
- [X] T025 [US2] Add public featured-event projection for homepage/discovery reads using `featured_events` plus `VISIBLE_WHERE`, with immediate visibility after successful Admin writes, in `server/src/modules/catalog/catalog.repo.ts` and `server/src/modules/catalog/catalog.public.routes.ts`.

### System Settings (US3)

- [X] T026 [US3] Add `GET/PUT /api/admin/settings` routes using `getSettings` and `updateSettings`, field/cross-field validation, stable errors, and existing Admin middleware in `server/src/modules/admin/admin.routes.ts`.
- [X] T027 [US3] Ensure failed settings validation, authorization, and DB conflicts do not write successful audit records or partially mutate settings in `server/src/modules/admin/settings.service.ts` and `server/src/modules/admin/admin.routes.ts`.

**Checkpoint**: All requested backend endpoints work with server-side RBAC and immediate public read effects.

---

## Phase 5: Integration Tests

**Purpose**: Prove RBAC, CRUD, bounds, future-only semantics, and audit requirements with Vitest/Supertest.

### Categories (US1)

- [X] T028 [P] [US1] Add Admin, Attendee, Organizer, and unauthenticated category route fixtures in `server/tests/integration/admin-catalog-settings.test.ts`.
- [X] T029 [US1] Test category create, list, rename, duplicate normalized name, delete-unused, and delete-in-use conflict in `server/tests/integration/admin-catalog-settings.test.ts`.
- [X] T030 [US1] Test concurrent category name collision and stable public category filtering after rename in `server/tests/integration/admin-catalog-settings.test.ts`.

### Featured Events (US2)

- [X] T031 [US2] Test featured replacement, removal, deterministic display order, duplicate/negative order rejection, and unavailable-event rejection in `server/tests/integration/admin-catalog-settings.test.ts`.
- [X] T032 [US2] Test public homepage/discovery visibility immediately after featured update and hiding after event becomes unavailable in `server/tests/integration/admin-catalog-settings.test.ts`.
- [X] T033 [US2] Test non-Admin denial for featured GET/PUT and verify rejected updates preserve the previous featured list in `server/tests/integration/admin-catalog-settings.test.ts`.

### System Settings (US3)

- [X] T034 [US3] Test default values and fallback behavior when `system_settings` rows are absent or malformed in `server/tests/integration/admin-catalog-settings.test.ts`.
- [X] T035 [US3] Test every numeric bound, boolean type, cross-field wallet constraint, and top-up grace/ceiling constraint in `server/tests/integration/admin-catalog-settings.test.ts`.
- [X] T036 [US3] Test atomic settings updates, cache invalidation, and preservation of prior values after rejected submissions in `server/tests/integration/admin-catalog-settings.test.ts`.
- [X] T037 [US3] Test successful settings audit payload and append-only enforcement in `server/tests/integration/admin-catalog-settings.test.ts`.
- [X] T038 [US3] Test non-Admin and unauthenticated denial for settings GET/PUT with no data disclosure or mutation in `server/tests/integration/admin-catalog-settings.test.ts`.

**Checkpoint**: Integration suite proves all acceptance scenarios requested for backend.

---

## Phase 6: Frontend UI

**Purpose**: Replace AdminPanel mock-only gaps with connected category, featured, and settings management.

- [X] T039 [US1] Add typed category and featured client methods for list/create/rename/delete and atomic featured replacement in `services/adminClient.ts`.
- [X] T040 [US3] Add typed settings GET/PUT client methods and structured validation-error parsing in `services/adminClient.ts`.
- [X] T041 [US1] Extend AdminPanel state and add `Danh mục` tab for category list, create, rename, delete, loading, empty, conflict, and success states in `components/AdminPanel.tsx`.
- [X] T042 [US2] Add featured-event membership and display-order controls to the `Danh mục` area, including atomic save and validation feedback, in `components/AdminPanel.tsx`.
- [X] T043 [US3] Add `Cấu hình` tab with current values, bounds hints, field errors, cross-field errors, atomic save, and no optimistic partial updates in `components/AdminPanel.tsx`.
- [X] T044 [US1] Update shared admin response types and remove only feature-specific mock wording while preserving existing moderation, audit, orders, and reporting tabs in `shared/admin/types.ts` and `components/AdminPanel.tsx`.

**Checkpoint**: Admin can perform all three user journeys through connected UI and sees server validation/errors.

---

## Phase 7: Typecheck, Lint, and Final Validation

**Purpose**: Verify feature integration against project quality gates.

- [X] T045 Run `npm run typecheck` and fix type errors across `server/src/`, `shared/admin/types.ts`, and `components/AdminPanel.tsx`.
- [X] T046 Run `npm run lint` and fix ESLint/Prettier violations across `server/src/`, `shared/`, `services/adminClient.ts`, and `components/AdminPanel.tsx`.
- [X] T047 Run `npm test -- --run` and fix regressions across `server/tests/auth/`, `server/tests/catalog/`, `server/tests/holds/`, `server/tests/integration/`, and new admin settings tests.
- [X] T048 Run all scenarios in `specs/007-admin-catalog-settings/quickstart.md`, record results, and update `specs/007-admin-catalog-settings/quickstart.md` only if commands or expected responses changed.
- [X] T049 Review changed files against `specs/007-admin-catalog-settings/contracts/admin-catalog-settings.openapi.yaml`, `data-model.md`, and `spec.md`; resolve contract or requirement drift.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 DB Migration**: No feature-code dependency; must complete before service/API/test execution.
- **Phase 2 Setting Service**: Depends on Phase 1; blocks settings routes and hold integration.
- **Phase 3 Holds/Config Integration**: Depends on Phase 2; can run before Phase 4 API.
- **Phase 4 Backend API**: Depends on Phase 1; settings routes depend on Phase 2; featured/category public reads depend on migration.
- **Phase 5 Integration Tests**: Depends on Phase 4 endpoints and Phase 3 hold integration; test fixtures can be prepared while Phase 4 is in progress.
- **Phase 6 Frontend UI**: Depends on Phase 4 response shapes and shared types; can begin client/type work after contract confirmation.
- **Phase 7 Final Validation**: Depends on Phases 3–6.

### User Story Dependencies

- **US1 Categories**: Phase 1 → Phase 4 category tasks → Phase 5 category tests → Phase 6 category UI.
- **US2 Featured Events**: Phase 1 → Phase 4 featured tasks → Phase 5 featured tests → Phase 6 featured UI.
- **US3 Settings**: Phase 1 → Phase 2 → Phase 3 hold integration and Phase 4 settings routes → Phase 5 settings tests → Phase 6 settings UI.
- US1 and US2 share `admin.repo.ts`, `admin.service.ts`, and `admin.routes.ts`; sequence edits in those files to avoid conflicts.

## Parallel Execution Examples

### After Phase 1

```text
T006 shared/admin/types.ts
T007 server/src/config.ts
T008 server/src/modules/admin/settings.service.ts
T018 server/src/modules/admin/admin.repo.ts (category queries)
T022 server/src/modules/admin/admin.repo.ts (featured queries)
```

T018 and T022 touch same file; assign one owner or serialize those edits despite logical parallelism.

### Phase 5 tests

```text
T029 category CRUD tests
T031 featured ordering tests
T034 settings fallback tests
T035 settings bounds tests
T037 settings audit tests
```

Use separate test files if parallel agents are assigned; current plan groups integration coverage in `server/tests/integration/admin-catalog-settings.test.ts`, so one owner should serialize edits.

### Phase 6 frontend

```text
T039 services/adminClient.ts
T040 services/adminClient.ts
T041 components/AdminPanel.tsx
T042 components/AdminPanel.tsx
T043 components/AdminPanel.tsx
```

T039/T040 and T041–T043 should be split by file ownership or run sequentially because each pair shares a file.

## Implementation Strategy

### MVP First

1. Complete Phase 1 migration.
2. Complete Phase 2 Setting Service.
3. Complete Phase 3 hold integration.
4. Complete Phase 4 US1 category CRUD and US3 settings endpoints.
5. Complete Phase 5 RBAC/category/settings tests.
6. Stop and validate Admin category/settings backend before featured UI expansion.

### Incremental Delivery

1. DB + Setting Service + holds integration.
2. US1 category CRUD and tests.
3. US3 settings API, audit, future-only hold tests.
4. US2 featured API and public projection.
5. Frontend `Danh mục` and `Cấu hình` tabs.
6. Typecheck, lint, full regression, quickstart validation.

### Traceability

- **US1**: FR-001–FR-004, FR-008, FR-016; SC-001, SC-003, SC-006, SC-007.
- **US2**: FR-001, FR-005–FR-008, FR-016; SC-002, SC-003, SC-006, SC-007.
- **US3**: FR-001, FR-009–FR-016; SC-004–SC-008.

## Notes

- Every task uses required checkbox + sequential ID format and includes file path(s).
- `[P]` appears only where work can proceed without incomplete-file dependencies; same-file tasks are called out for serialization.
- Tests included because user explicitly requested Vitest integration tests and the spec requires denial/audit/critical behavior coverage.
- No new dependency or external service required.
