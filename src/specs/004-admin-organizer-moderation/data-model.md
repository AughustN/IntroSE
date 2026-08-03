# Data Model: Admin Organizer & Event Moderation

## Existing entities extended

### `organizers`

Existing table from `0001_auth.sql`.

- `status`: `pending | approved | rejected | suspended`.
- `review_note`: reason for rejection or suspension.
- `approved_at`, `approved_by`: approving admin metadata.
- Moderation actions lock the row before transition.
- Allowed admin transitions: `pending → approved`, `pending → rejected`, `approved → suspended`.
- A suspended organizer cannot re-apply while the live application remains suspended.

### `events`

Existing table from `0002_catalog.sql`.

- `status`: organizer lifecycle (`draft | on_sale | finished | cancelled`).
- `moderation_status`: `pending_review | approved | flagged | removed`.
- `review_note`: rejection, flag, or removal reason.
- Public visibility remains derived: `status='on_sale' AND moderation_status='approved' AND organizers.status='approved'`.
- Allowed admin transitions: `pending_review → approved`, `pending_review → removed`, `approved → flagged`, `approved|flagged → removed`.
- Material organizer edits on approved events return them to `pending_review`.

## New tables in `0004_admin_moderation.sql`

### `content_reports`

A buyer/organizer report against an event or review.

| Field | Rule |
|---|---|
| `id` | BIGSERIAL primary key |
| `reporter_user_id` | BIGINT NOT NULL → `users(id)` |
| `target_type` | TEXT CHECK `event|review` |
| `target_id` | BIGINT NOT NULL; target existence validated by report flow |
| `reason` | TEXT NOT NULL, trimmed, bounded by request validation |
| `status` | TEXT CHECK `open|dismissed|flagged|resolved`, default `open` |
| `resolution_note` | TEXT nullable; required for flag/remove resolution |
| `resolved_by` | BIGINT nullable → `users(id)` |
| `resolved_at` | TIMESTAMPTZ nullable |
| `created_at` | TIMESTAMPTZ NOT NULL default `now()` |

Indexes: `(status, created_at)`, `(target_type, target_id)`, `(reporter_user_id, created_at)`.

### `moderation_actions`

Stable command identity for idempotent moderation and refund processing.

| Field | Rule |
|---|---|
| `id` | BIGSERIAL primary key |
| `action_key` | UUID UNIQUE NOT NULL; client retry key or server-generated command identity |
| `actor_user_id` | BIGINT NOT NULL → `users(id)` |
| `action` | TEXT NOT NULL (`organizer_approve`, `organizer_reject`, `organizer_suspend`, `event_approve`, `event_reject`, `event_flag`, `event_remove`, `report_dismiss`, `review_remove`) |
| `target_type` | TEXT NOT NULL (`organizer`, `event`, `report`, `review`) |
| `target_id` | BIGINT NOT NULL |
| `outcome` | TEXT CHECK `applied|conflict|rejected`, NOT NULL |
| `created_at` | TIMESTAMPTZ NOT NULL default `now()` |

Unique key prevents the same command retry from applying its effects twice.

### `wallet_ledger`

Existing wallet ledger if present; otherwise migration adds the minimum refund ledger table used by wallet flows.

- `id` BIGSERIAL primary key.
- `wallet_id` BIGINT NOT NULL → `wallets(id)`.
- `amount` BIGINT NOT NULL; positive credit for refund.
- `kind` TEXT CHECK includes `moderation_refund`.
- `reference_type` TEXT NOT NULL (`ticket`).
- `reference_id` BIGINT NOT NULL.
- `created_at` TIMESTAMPTZ NOT NULL default `now()`.
- Unique `(kind, reference_type, reference_id)` for exactly-once refund credit.

No card, bank, gateway, or cash-settlement fields.

### `moderation_refunds`

One refund outcome per affected ticket and removal action.

| Field | Rule |
|---|---|
| `id` | BIGSERIAL primary key |
| `event_id` | BIGINT NOT NULL → `events(id)` |
| `ticket_id` | BIGINT NOT NULL → existing ticket identity |
| `buyer_user_id` | BIGINT NOT NULL → `users(id)` |
| `amount` | BIGINT NOT NULL, whole VND and `> 0` |
| `action_id` | BIGINT NOT NULL → `moderation_actions(id)` |
| `created_at` | TIMESTAMPTZ NOT NULL default `now()` |

Unique `(ticket_id, action_id)` and wallet ledger reference uniqueness ensure retries do not double-credit. If the existing order/ticket schema has a canonical refund table, reuse it rather than creating a duplicate; migration task must inspect and select one canonical table.

### `moderation_notifications`

Durable delivery intent committed with moderation effects.

- `id` BIGSERIAL primary key.
- `recipient_user_id` BIGINT NOT NULL → `users(id)`.
- `kind` TEXT NOT NULL.
- `target_type`, `target_id` identify moderated object.
- `payload` JSONB NOT NULL.
- `status` TEXT CHECK `pending|sent|failed`, default `pending`.
- `created_at` TIMESTAMPTZ NOT NULL default `now()`.
- Unique `(recipient_user_id, kind, target_type, target_id, moderation_action_id)` where action id is present.

## `audit_logs` append-only enforcement

Existing `audit_logs` from `0002_catalog.sql` remains the canonical audit table. Extend it with:

- `outcome` (`applied|conflict|rejected`) and optional `before_state`, `after_state`, `reason` fields, or store equivalent data in `detail` JSONB.
- Indexes by target and creation time.
- `BEFORE UPDATE OR DELETE` trigger `audit_logs_immutable` raises a PostgreSQL exception (`audit_logs are append-only`).
- No application route exposes update/delete.
- Audit insert occurs in the same transaction as the privileged state change. Authorization failures with no state mutation may be represented as `outcome='rejected'` according to the endpoint contract, but cancelled UI actions write no row.

## State and transaction invariants

1. Every state-changing admin command locks target rows with `FOR UPDATE`, checks the source state, applies one allowed transition, inserts one audit row, and commits atomically.
2. Organizer suspension alone hides all owned events through the live public predicate; events remain stored and visible only to authorized owner/admin views.
3. Event removal affects only future showtimes; started showtimes are skipped.
4. Every eligible affected ticket gets one full-VND wallet credit and one voided/refunded outcome; retries are no-ops.
5. If state, audit, refund, inventory, or durable notification intent fails, transaction rolls back all of them.
6. No public catalog query can return draft, pending, flagged, removed, or suspended-organizer content, even by guessed id/slug.
7. Audit rows cannot be modified or deleted by application users, including admins, because PostgreSQL rejects both operations.

## Migration dependency note

`0004_admin_moderation.sql` runs after auth/catalog and after any order/ticket/wallet ledger migration. If order/ticket/refund tables are not yet in the repository, migration creates only moderation metadata and the service integrates the canonical wallet/ticket tables when feature 004 checkout lands; no fake cash-refund path is added.
