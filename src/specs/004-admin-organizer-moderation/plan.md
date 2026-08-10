# Implementation Plan: Admin Organizer & Event Moderation

**Branch**: `004-admin-organizer-moderation` | **Date**: 2026-08-02 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification for UC-33 Approve/Suspend Organizer and UC-34 Review & Moderate Events, with PostgreSQL persistence, Express `/api/admin`, server-side `requireAdmin`, immutable audit logs, and wallet-only refunds.

## Summary

Extend existing TixHub auth/catalog schema and server modules with one transactional moderation domain. Admin requests pass through `requireAuth` and `requireAdmin`, then call typed repository/service helpers that lock target rows, validate allowed state transitions, apply organizer/event/report/refund effects, and insert an audit row in the same transaction. Public catalog visibility remains a live predicate (`event on_sale` + `event approved` + `organizer approved`), so organizer suspension hides every owned event without per-event rewriting. `audit_logs` receives database-level append-only protection: application actors cannot update or delete rows, and the database trigger rejects both operations.

## Technical Context

**Language/Version**: TypeScript 5.8, strict mode, Node.js

**Primary Dependencies**: Express 4, PostgreSQL via `pg`, Zod 3 for boundary validation, React 19, Vitest 2, Supertest 7

**Storage**: PostgreSQL; existing migrations `0001_auth.sql` and `0002_catalog.sql`, new moderation migration `0013_admin_moderation.sql`; VND amounts are BIGINT integers

**Testing**: Vitest integration tests with Supertest and PostgreSQL test database; TypeScript compiler in strict mode

**Target Platform**: Same-origin React SPA and stateless Express REST server on team VPS, backed by Neon PostgreSQL

**Project Type**: Web application with React frontend and Express backend

**Performance Goals**: Public visibility changes effective on the next request; admin queue and action responses target the existing normal catalog/API response budget; refund/removal action is one database transaction per command

**Constraints**: RBAC on every admin route [SEC-04]; parameterized SQL and Zod validation [SEC-07]; atomic state/audit/refund effects; no card/bank data; wallet-only refunds; pool max 20; immutable audit rows [SEC-09]

**Scale/Scope**: One admin panel covering organizer applications, event submissions, reports, moderation actions, audit history, and affected-wallet refunds; existing organizer/event/report/ticket/wallet/notification tables are reused or extended only where required

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Security & RBAC**: PASS. Every `/api/admin` route uses `requireAuth` then `requireAdmin`; authorization is server-side and tested for denial [SEC-04].
- **Immutable audit**: PASS. Every state-changing privileged action inserts `audit_logs` in the same transaction; DB trigger rejects UPDATE and DELETE [SEC-09].
- **Money integrity**: PASS. Refunds use existing wallet ledger semantics, whole VND integers, unique ticket/removal idempotency, and no cash settlement.
- **Reliability/atomicity**: PASS. Row locks and transaction boundaries serialize concurrent moderation and ensure state, audit, refund, inventory, and notification intent commit together.
- **Typed FE/BE contract**: PASS. Admin request/response types live under `shared/admin/` and are imported by server and React.
- **Input/security hygiene**: PASS. Zod validates body/path values; SQL uses parameters; reasons render as text; no secrets or payment credentials are logged.
- **Simplicity/scope**: PASS. Reuses current Express, `pg`, auth, catalog, and wallet modules; no new external dependency.

## Project Structure

### Documentation (this feature)

```text
specs/004-admin-organizer-moderation/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── admin.openapi.yaml
└── tasks.md
```

### Source Code

```text
server/src/
├── db/migrations/0013_admin_moderation.sql
├── middleware/authz.ts
├── modules/admin/
│   ├── admin.routes.ts
│   ├── admin.repo.ts
│   ├── admin.service.ts
│   └── audit.ts
├── modules/catalog/
│   ├── catalog.repo.ts
│   └── visibility.ts
└── app.ts
shared/admin/types.ts
src/
└── components/AdminPanel.tsx
server/tests/integration/admin-moderation.test.ts
```

**Structure Decision**: Add a focused `server/src/modules/admin` module for admin-only orchestration and keep shared visibility/catalog predicates in existing catalog modules. Keep `requireAdmin` in existing authz middleware. Add shared typed admin contracts so `AdminPanel.tsx` and Express handlers consume one shape. Add one Vitest integration suite for denial, transitions, concurrency/idempotency, public hiding, refunds, and DB append-only enforcement.

## Phase 0: Research Summary

See [research.md](research.md). Decisions resolve transaction boundaries, row locking, audit immutability, refund idempotency, and API/UI contract shape using existing project patterns.

## Phase 1: Design Summary

See:

- [data-model.md](data-model.md) for migration-owned tables, state transitions, constraints, and invariants.
- [contracts/admin.openapi.yaml](contracts/admin.openapi.yaml) for `/api/admin` queue, action, audit, and report endpoints.
- [quickstart.md](quickstart.md) for runnable integration validation.

## Constitution Check — Post-Design

- **Security**: PASS. `requireAdmin` wraps router; every action validates target state and writes audit data; DB trigger blocks row mutation.
- **Reliability**: PASS. `SELECT ... FOR UPDATE` protects organizer/event/report/removal/refund transitions; unique refund key makes retries safe.
- **Data integrity**: PASS. State changes, audit row, refund ledger rows, ticket voids, inventory release, and notification intent share one transaction.
- **Typed integration**: PASS. OpenAPI and `shared/admin/types.ts` define one boundary contract; frontend does not assert authorization.
- **Testability**: PASS. Vitest/Supertest covers happy paths and denial/concurrency/failure rollback, including direct SQL attempts against audit rows.
- **Scope**: PASS. No cash refund, new gateway, or unrelated admin configuration.

No constitution violations. No complexity exception required.

## Complexity Tracking

No violations.
