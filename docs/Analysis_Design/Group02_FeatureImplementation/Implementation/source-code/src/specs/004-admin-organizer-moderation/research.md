# Research: Admin Organizer & Event Moderation

## Decision 1: Use one transactional admin service over existing `pg` repositories

- **Decision**: Put organizer/event/report moderation orchestration in `server/src/modules/admin/admin.service.ts`, execute each command through `withTransaction`, and pass the transaction client into repository helpers.
- **Rationale**: UC-33/UC-34 require state, audit, refund, inventory, and notification intent to be atomic. Existing `withTransaction` already provides the project pattern. A service avoids copy-pasting transaction logic in route handlers.
- **Alternatives considered**: Separate transaction per state and audit write was rejected because a failed audit could leave an unaudited privileged state change. A new ORM was rejected because `pg` is already installed and used.

## Decision 2: Lock target rows and use guarded state transitions

- **Decision**: Action commands select the target organizer/event/report `FOR UPDATE`, verify current state, update only from allowed source states, and return `409` for stale or incompatible transitions.
- **Rationale**: Two admins may act concurrently. Row locks plus explicit state machines ensure one decision wins and the second cannot overwrite it. Existing PostgreSQL is the source of truth.
- **Alternatives considered**: Application-only read-then-write was rejected because concurrent requests can both pass the check. Optimistic version columns were rejected as unnecessary schema complexity for this feature.

## Decision 3: Enforce audit immutability in PostgreSQL

- **Decision**: Keep `audit_logs` append-only through a `BEFORE UPDATE OR DELETE` trigger that raises an exception. Application code exposes inserts only; no update/delete helper exists.
- **Rationale**: [SEC-09] must hold even if an admin endpoint or future code has a bug. A database guard is stronger than route conventions and is directly testable with SQL.
- **Alternatives considered**: UI hiding and API-only authorization were rejected because they do not protect direct DB access or future privileged code. PostgreSQL rules alone were not selected because one trigger gives one explicit error path for both operations.

## Decision 4: Use a unique refund key for exactly-once wallet credit

- **Decision**: Record each moderation refund against a unique affected ticket/removal identity, insert wallet ledger credit and mark ticket voided in the same transaction. Repeated removal commands return the existing result without another credit.
- **Rationale**: Retries and concurrent workers must not duplicate wallet value. Existing wallet-only, integer-VND model stays intact; no cash payout is introduced.
- **Alternatives considered**: Checking wallet balance before credit was rejected because it cannot distinguish a retry from a new refund. External idempotency storage was rejected because PostgreSQL uniqueness is sufficient.

## Decision 5: Keep public visibility as a live predicate

- **Decision**: Do not update every event when organizer status changes. Public catalog queries continue to require event `on_sale`, moderation `approved`, and owning organizer `approved`; suspension changes organizer status only.
- **Rationale**: Hiding all events becomes immediate on the next request, avoids fan-out writes, and matches existing `visibility.ts` and catalog data model.
- **Alternatives considered**: Marking every event removed/flagged on suspension was rejected because it loses the distinction between organizer suspension and event moderation and creates partial-update risk.

## Decision 6: Expose a single `/api/admin` router and typed shared contract

- **Decision**: Mount one admin router after `requireAuth`, apply `requireAdmin` at router scope, and define request/response shapes in `shared/admin/types.ts` with OpenAPI documentation in `contracts/admin.openapi.yaml`.
- **Rationale**: Existing app already mounts `/api/admin` and has `requireAdmin`; one shared contract prevents FE/BE payload drift under Principle VI.
- **Alternatives considered**: Separate routers per queue were rejected because they duplicate middleware and contract conventions. Frontend-only mocks were rejected because authorization and moderation state are server-owned.

## Decision 7: Treat reports and notifications as existing-domain dependencies

- **Decision**: Add only the report resolution fields and durable notification intent required by this feature if existing tables do not already provide them. Do not build a separate reporting product or synchronous email dependency.
- **Rationale**: UC-39 supplies reports and UC-19 supplies notifications. Moderation needs resolution history and an atomic delivery intent, not a new external service.
- **Alternatives considered**: Synchronous email inside the moderation transaction was rejected because provider latency would hold locks and make rollback fragile.
