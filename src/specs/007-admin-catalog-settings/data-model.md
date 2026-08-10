# Data Model: Admin Catalog Settings

## Event Category

Existing table: `event_categories`.

| Field | Type | Rules |
|---|---|---|
| `id` | `SMALLSERIAL` | Primary key; referenced by `events.category_id`. |
| `code` | `TEXT` | Stable unique public filter identifier. Admin rename must not break existing references. |
| `label_vi` | `TEXT` | Required display name; normalized for duplicate checks. |
| `label_en` | `TEXT` nullable | Existing optional translation. |

Changes:

- Preserve existing seeded rows and public `code` filters.
- Enforce normalized uniqueness for managed display names, including trim and case-insensitive comparison.
- Delete only when no `events.category_id` references the row; the foreign-key relationship remains authoritative.

## Featured Event Entry

New table: `featured_events`.

| Field | Type | Rules |
|---|---|---|
| `event_id` | `BIGINT` | Primary key and foreign key to `events(id)`; one entry per event. |
| `display_order` | `INT` | Required, non-negative; unique across entries. |
| `created_at` | `TIMESTAMPTZ` | Required, defaults to current time. |
| `updated_at` | `TIMESTAMPTZ` | Required, updated whenever order changes. |

Relationships:

- One event has zero or one featured entry.
- Featured entries are returned ordered by `display_order`, then `event_id` for deterministic output.
- Public homepage selection joins the live visibility predicate; unavailable events do not appear publicly even if their curation entry remains for Admin review.

## System Setting

New table: `system_settings`.

| Field | Type | Rules |
|---|---|---|
| `key` | `TEXT` | Primary key; limited to known setting names. |
| `value` | `JSONB` | Scalar value validated against key-specific type and bounds before write. |
| `updated_by` | `BIGINT` nullable | References `users(id)` for Admin writes. |
| `updated_at` | `TIMESTAMPTZ` | Required, defaults/current on update. |

Known keys and effective defaults:

| Key | Type | Default | Inclusive bounds / cross-field rule |
|---|---|---:|---|
| `seat_hold_ttl_minutes` | integer | 7 | 1–30 |
| `topup_grace_minutes` | integer | 7 | 1–15 |
| `absolute_ceiling_minutes` | integer | 14 | 2–30; grace must not exceed ceiling |
| `max_tickets_per_buyer` | integer | 8 | 1–50 |
| `wallet_topup_min` | integer VND | 5,000 | Non-negative integer; ≤ max |
| `wallet_topup_max` | integer VND | 10,000,000 | Non-negative integer; ≤ balance ceiling |
| `wallet_balance_ceiling` | integer VND | 20,000,000 | Non-negative integer |
| `ai_features_enabled` | boolean | true | Boolean only |

Read behavior:

1. Start with defaults exported from `server/src/config.ts`.
2. Load known stored rows through `SettingService`.
3. Merge only valid stored values; missing/unusable rows fall back to defaults.
4. Cache effective values for short TTL; successful update invalidates cache.

Lifecycle:

- Settings are effective for requests that begin after successful commit.
- Reservation `expires_at` remains the captured timestamp from creation.
- Top-up grace and absolute ceiling are read for the extension request, then the resulting timestamp is stored; later changes do not rewrite it.

## Audit Log

Existing append-only table: `audit_logs`.

A successful settings update writes one record in the same transaction with:

- Admin actor ID
- action identifying settings update
- target type `system_settings`
- changed setting names
- previous effective values
- new values
- timestamp and applied outcome

The existing database trigger rejects updates/deletes.
