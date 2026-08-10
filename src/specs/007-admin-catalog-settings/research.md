# Research: Admin Catalog Settings

## Decision: Use a typed key-value `system_settings` table

- **Decision**: Store one row per setting key in `system_settings`, with typed JSON value, immutable key, and update metadata. Use a unique key constraint. Do not use a single wide row.
- **Rationale**: Existing schema uses focused tables and the requested setting set may grow. Key-value rows allow one setting to change without wide-row migrations while keeping one transactional update for a complete submission. A JSON value column preserves boolean, integer, and future scalar types without introducing an untyped API boundary; service validation remains explicit.
- **Alternatives considered**: A single-row wide table gives stronger SQL typing but requires migration for each new setting and couples unrelated values. Generic unvalidated key-value text was rejected because it weakens bounds/type guarantees.

## Decision: Cache effective settings in one process with short TTL and explicit invalidation

- **Decision**: `SettingService` reads all known keys from DB, merges valid stored values over defaults from `server/src/config.ts`, caches the effective object for a short TTL, and invalidates cache after successful writes.
- **Rationale**: Public hold paths avoid a DB settings query on every request while admin updates become visible immediately in the writing process. Read failures use defaults only for missing/invalid rows, not silently accepted malformed writes. Existing one-process VPS assumption makes in-memory cache consistent with current architecture; future horizontal deployment must add shared invalidation or reduce cache TTL.
- **Alternatives considered**: Query DB on every request was rejected for hot hold paths. Redis/shared cache was rejected because it adds infrastructure and an integration not required by the constitution.

## Decision: Capture effective hold terms at reservation creation

- **Decision**: New reservation creation reads current TTL and stores its resulting `expires_at`; top-up extension reads current grace/ceiling only when extension request begins. Existing reservations keep stored timestamps and never recalculate from later settings.
- **Rationale**: Matches FR-013 and preserves active transaction semantics. The current schema already stores `expires_at`, `created_at`, and `extended_once`; no recalculation is needed for expiry.
- **Alternatives considered**: Recomputing expiry from current settings was rejected because an Admin update would alter active holds.

## Decision: Keep featured ordering separate from `events.is_featured`

- **Decision**: Add `featured_events(event_id, display_order)` with foreign key, unique event, and unique display order. Public homepage/discovery reads join this table and the existing live visibility predicate.
- **Rationale**: Existing `events.is_featured` is a boolean and cannot represent order. A separate curation table avoids changing event ownership data and lets public reads hide no-longer-visible events immediately.
- **Alternatives considered**: Reusing `events.is_featured` plus an order column was rejected because it leaves curation concerns mixed into the event record and requires maintaining two semantics during migration.

## Decision: Preserve event category shape; add only normalized uniqueness support

- **Decision**: Keep `event_categories.code`, `label_vi`, and `label_en`; add a normalized generated value or equivalent unique index for Admin-managed names only if PostgreSQL expression/index constraints cannot enforce the required normalization directly. Existing public filters continue using `code`.
- **Rationale**: Current catalog already depends on `code` and seeded labels. Avoid changing public response contracts. Category create/rename must preserve stable code used by filters; plan should define slug/code generation and collision handling before implementation.
- **Alternatives considered**: Replacing `code` with mutable labels was rejected because public filters and existing events use codes. Adding `is_active` is unnecessary while deletion of used categories is blocked.

## Decision: Use existing admin router, audit helper, and transaction helper

- **Decision**: Add routes under existing `/api/admin` router, which already applies `requireAuth` and `requireAdmin`. Use `withTransaction` for category/featured/settings writes and `insertAudit` for setting changes.
- **Rationale**: Matches current code, keeps RBAC server-side, and makes settings + audit atomic. Existing immutable audit trigger covers append-only behavior.
- **Alternatives considered**: New router or separate admin auth middleware was rejected as duplicate authorization surface.

## Decision: Shared typed contracts cover all new REST payloads

- **Decision**: Add shared TypeScript types for category, featured entries, settings, and validation errors. Document REST shapes in OpenAPI YAML under this feature.
- **Rationale**: Constitution Principle VI requires one contract across frontend/backend. Existing shared types and `adminClient` provide the integration seam.
- **Alternatives considered**: Duplicated request interfaces in React and Express were rejected because they allow silent drift.

## Decision: Validation and write semantics

- **Decision**: Validate request bodies with Zod at route boundaries; validate cross-field constraints in the service. Settings update is all-or-nothing. A rejected request writes no successful-change audit record.
- **Rationale**: Matches existing middleware and requirements FR-011/FR-012/FR-014. Parameterized SQL and transaction rollback preserve integrity.
- **Alternatives considered**: UI-only validation and per-field writes were rejected because clients are untrusted and could partially apply policy.
