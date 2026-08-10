# Implementation Plan: Admin Catalog Settings

**Branch**: `007-admin-catalog-settings` | **Date**: 2026-08-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-admin-catalog-settings/spec.md` plus requested architecture: PostgreSQL, existing `/api/admin` router, `requireAdmin`, DB-backed settings cache/fallback, admin catalog endpoints, and AdminPanel tabs.

## Summary

Add Admin-only management for event categories, homepage featured-event membership/order, and bounded operating settings. Use existing admin router, auth middleware, transaction helper, audit helper, catalog visibility predicate, and shared TypeScript contracts. Persist settings as typed key-value rows in `system_settings`; persist featured ordering in `featured_events`; keep current category codes stable. `SettingService` merges validated DB rows over defaults from `server/src/config.ts`, caches effective values briefly, and invalidates after writes. Hold creation and top-up extension read current settings only at operation start; stored reservation timestamps preserve active terms.

## Technical Context

**Language/Version**: TypeScript 5.8, Node.js 22, strict mode

**Primary Dependencies**: Express 4, PostgreSQL via `pg`, Zod, React 19, Vitest, Supertest, existing `requireAuth`, `requireAdmin`, `validate`, `withTransaction`, and `insertAudit`

**Storage**: PostgreSQL migrations under `server/src/db/migrations`; existing `event_categories`, `events`, `audit_logs`, `reservations`, and `config.ts` defaults

**Testing**: Vitest + Supertest; existing auth/catalog/holds helpers; typecheck and lint required

**Target Platform**: Same-origin React SPA served through VPS/Nginx and stateless Express API

**Project Type**: Web application with React frontend and Express REST backend

**Performance Goals**: Settings reads on hot hold paths served from in-memory cache after first load; category/featured admin writes and public reads complete within existing API responsiveness targets; cache TTL short enough that external DB edits converge without restart

**Constraints**: Server-side RBAC on every admin endpoint; parameterized SQL; typed shared request/response contracts; VND integer amounts; append-only audit logs; no new external service or cache infrastructure; active holds/transactions retain captured terms; DB pool remains ≤20 connections

**Scale/Scope**: Existing single VPS deployment and current catalog/admin UI; up to 50 featured entries per update; eight configurable operational settings; no new roles, authentication flow, payment provider, or public event-authoring workflow

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Reliability Under Load**: PASS. Reservation timestamps remain authoritative; setting reads are cached; writes use DB transactions; no seat lifecycle is moved into UI state.
- **Security & Trust by Default**: PASS. Existing `/api/admin` router applies `requireAuth` and `requireAdmin`; Zod validates all inputs; SQL remains parameterized; successful setting changes use immutable `audit_logs`.
- **AI Assistive and Non-Blocking**: PASS. `ai_features_enabled` only controls future AI behavior; no purchase-path AI dependency is added.
- **Verifiable Requirements**: PASS. New route denial, bounds, atomicity, fallback, cache invalidation, audit, and future-only hold tests are required. Existing hold invariants remain covered.
- **Simplicity & Free-Tier Discipline**: PASS. Key-value settings and process-local cache use existing PostgreSQL/Node resources; no Redis or new dependency.
- **Clean Codebase & FE/BE Integration**: PASS. New payloads live in `shared/admin/types.ts` and OpenAPI contract; frontend uses `adminClient`; modules remain focused.

## Project Structure

### Documentation (this feature)

```text
specs/007-admin-catalog-settings/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── admin-catalog-settings.openapi.yaml
└── checklists/requirements.md
```

### Source Code (repository root)

```text
server/src/
├── config.ts                              # defaults and unit conversions
├── db/migrations/0005_admin_catalog.sql   # categories/featured/settings schema
├── middleware/
│   ├── authz.ts                           # existing requireAdmin
│   └── validate.ts                         # existing request validation
├── modules/admin/
│   ├── admin.routes.ts                     # new category/homepage/settings routes
│   ├── admin.repo.ts                       # admin catalog/settings queries
│   ├── admin.service.ts                    # existing moderation + new workflows
│   ├── audit.ts                            # existing append-only audit insert
│   └── settings.service.ts                 # effective settings, cache, validation
├── modules/catalog/
│   ├── catalog.repo.ts                     # category/featured public projections
│   ├── catalog.public.routes.ts             # homepage/discovery featured ordering
│   └── visibility.ts                        # existing live visibility predicate
└── modules/holds/
    ├── holds.service.ts                     # dynamic TTL/grace/ceiling/cap reads
    ├── sweep.ts                             # interval remains process setting
    └── holds.throttle.ts                    # unchanged rate-limit settings

shared/
└── admin/types.ts                           # shared category/featured/settings contracts

services/
└── adminClient.ts                           # typed frontend requests

components/
└── AdminPanel.tsx                           # Danh mục and Cấu hình tabs

server/tests/
├── integration/admin-catalog-settings.test.ts
└── holds/settings.test.ts                   # future-only settings and dynamic cap/TTL tests
```

**Structure Decision**: Extend existing single-repository React + Express structure. Admin domain stays in `server/src/modules/admin`; public featured projection stays in catalog module; setting consumption stays behind one `SettingService`; shared contracts prevent frontend/backend drift.

## Phase 0: Research Findings

Research is complete in [research.md](./research.md). Key resolved decisions:

1. Use typed key-value `system_settings`, not a wide single row or untyped text store.
2. Cache merged effective settings in process with short TTL and explicit post-write invalidation.
3. Preserve active hold timestamps; use current settings only when starting a new hold or extension request.
4. Store featured membership/order separately from existing boolean `events.is_featured`.
5. Preserve stable category `code` used by current public filters; manage display labels without breaking references.
6. Reuse existing router, RBAC, transaction, audit, visibility, and shared-contract patterns.

## Phase 1: Design Details

### Database migration

Create `0005_admin_catalog.sql`:

- `system_settings(key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_by BIGINT REFERENCES users(id), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`.
- Check known keys through service validation; migration seeds no override rows so defaults remain source when DB is empty.
- `featured_events(event_id BIGINT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE, display_order INT NOT NULL CHECK (display_order >= 0), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`.
- Unique index on `featured_events(display_order)`.
- Add normalized category-name uniqueness support without changing public `code` semantics. Preserve existing seed data and category references.
- Keep existing `audit_logs` append-only trigger; no mutation path added.

### Setting Service

Add `server/src/modules/admin/settings.service.ts`:

- Define `SystemSettings` and per-key defaults/bounds in one typed map.
- Export `getSettings()` for effective values and `updateSettings(actorUserId, input)` for atomic updates.
- Read known rows, validate JSON scalar type and constraints, merge valid rows over defaults.
- Cache result with short TTL; invalidate after transaction commit. Avoid caching rejected writes.
- Validate cross-field relations: grace ≤ absolute ceiling, top-up minimum ≤ maximum ≤ balance ceiling.
- Store all updated fields in one transaction and insert one `system_settings` audit record with before/after values.
- Expose conversion helpers for hold milliseconds and ticket cap; keep `server/src/config.ts` defaults as fallback constants. Convert units only at service boundary.
- Decide cache behavior on DB failure explicitly: use last valid cache while fresh; if no valid cache exists, use defaults and surface operational error only on write paths. Do not treat malformed rows as accepted configuration.

### Admin category workflow

Extend `admin.repo.ts`/`admin.service.ts`:

- List categories with stable IDs/codes/labels.
- Create category with normalized name and stable generated code; reject duplicate normalized names.
- Rename display label while preserving code and event associations.
- Delete only after checking no event references; return conflict otherwise.
- Run mutations in `withTransaction`; use conflict-safe SQL constraints for concurrent duplicate names.

### Featured workflow

Add repository/service operations:

- List current entries with event projection needed by Admin UI.
- Replace full list atomically in one transaction: validate unique IDs and non-negative unique order, lock/check all events, require each event satisfy public eligibility, delete removed entries, upsert current entries.
- Public catalog queries join `featured_events` where homepage/discovery output needs curated order and always compose `VISIBLE_WHERE`; stale/unavailable entries do not leak.
- Keep `events.is_featured` compatibility untouched unless existing consumers prove it is the current homepage source; do not maintain two writes without a migration decision.

### REST routes

Extend existing `adminRouter` (already mounted at `/api/admin` and guarded by `requireAuth, requireAdmin`):

- `GET /categories`
- `POST /categories`
- `PUT /categories/:id`
- `DELETE /categories/:id`
- `GET /homepage/featured`
- `PUT /homepage/featured`
- `GET /settings`
- `PUT /settings`

Use Zod schemas in routes, existing `validate` middleware, stable error codes, and typed JSON responses matching [admin-catalog-settings.openapi.yaml](./contracts/admin-catalog-settings.openapi.yaml). Invalid and unauthorized requests must not mutate data or write successful-change audit records.

### Hold integration

Update `holds.service.ts`:

- Replace module-level imports of `HOLD_TTL_MS`, `HOLD_GRACE_MS`, `HOLD_ABSOLUTE_MS`, and `SEAT_CAP` with effective settings reads at operation start.
- New reservation creation computes `expires_at` from current `seat_hold_ttl_minutes`.
- Hold cap checks use current `max_tickets_per_buyer` for new additions, while stored reservation items remain unchanged.
- `extendOnce` reads current grace and absolute ceiling for that extension request and stores resulting `expires_at`.
- Existing reservation expiry and active transaction terms never recalculate after settings update.
- Leave sweep interval and anti-spam throttle constants in config unless explicitly added to UC-36; they are not listed operational settings.

### Frontend integration

Extend `shared/admin/types.ts`, `services/adminClient.ts`, and `components/AdminPanel.tsx`:

- Add tabs `categories` (`Danh mục`) and `settings` (`Cấu hình`).
- Category tab loads categories, supports add/rename/delete, and renders conflict/validation errors.
- Featured controls can be placed in `Danh mục` tab; load current list, edit membership/order, submit replacement atomically.
- Settings tab loads effective values, displays bounds, submits one complete object, and shows field/cross-field errors without optimistic partial state.
- Keep existing moderation/audit tabs intact. Remove only mock wording for these new flows; do not broaden unrelated AdminPanel features.

### Testing

Add integration and unit coverage:

- Admin-only denial for unauthenticated, Attendee, and Organizer requests on every new route.
- Category create/rename duplicate handling, stable code, delete-unused success, delete-in-use conflict, and concurrent uniqueness.
- Featured replacement ordering, duplicate/negative order rejection, unavailable event rejection, rollback on failure, and public visibility after update.
- Settings defaults/fallback, all bounds, cross-field constraints, atomic rollback, cache hit/invalidation, audit before/after payload, and append-only behavior.
- Hold tests prove old reservations keep old timestamps/terms while new holds use changed TTL/cap and extension uses current grace/ceiling.
- Run `npm run typecheck`, `npm test -- --run`, and `npm run lint`.

## Constitution Check (Post-Design)

- **Reliability**: PASS. Settings affect only operation-start decisions; reservation row timestamps remain source of truth. Featured ordering uses DB constraints and deterministic ordering.
- **Security**: PASS. Existing admin middleware guards all endpoints; schemas validate boundaries; settings audit is transactionally tied to the update; no secrets are editable.
- **Testability**: PASS. Contract, denial, transaction rollback, cache invalidation, and future-only semantics have explicit test scenarios.
- **Simplicity**: PASS. No new external dependency; one migration, one settings service, existing helpers.
- **Integration contract**: PASS. Shared types + OpenAPI cover all new REST payloads and frontend client methods.

## Complexity Tracking

No constitution violations. No complexity exceptions requested.
