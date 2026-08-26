# Data Model: Concession Add-Ons (Bắp Nước)

Feature: `/specs/014-fnb-add-ons/spec.md` · Date: 2026-08-23
Ships as `server/src/db/migrations/0039_concession_add_ons.sql` **and** is synced into
`data_base/InitDB.sql` (house rule). Money columns are VND integers (`int8`) — the `_amount`
suffix matches `reservation_items.unit_price_amount`; never floating point (STD-03).

## Entity overview

```text
events 1 ──< concession_items            (the menu; unlimited stock)
reservations 1 ──< reservation_concessions >── concession_items   (cart lines; die with the hold)
orders 1 ──< order_concessions >── concession_items               (immutable snapshot lines)
orders 1 ──1 concession_vouchers                                  (exactly one per concession order)
```

`concession_items` are referenced by cart/paid lines by id, but **display data lives on the
lines** (snapshot) — history never joins back to the menu (FR-010/FR-014).

## Tables

### `concession_items` — the organizer-curated menu

| Column | Type | Rules |
|---|---|---|
| `id` | int8 PK | `nextval` |
| `event_id` | int8 NOT NULL | FK → `events(id)` |
| `label` | text NOT NULL | buyer-facing Vietnamese name, e.g. "Bắp rang bơ" |
| `description` | text | nullable short description |
| `price_amount` | int8 NOT NULL | CHECK `(price_amount >= 0)` — whole đồng |
| `state` | text NOT NULL DEFAULT `'listed'` | CHECK `('listed','stopped')`; stopped = FR-010 archive |
| `created_at` / `updated_at` | timestamptz NOT NULL DEFAULT now() | |

Index: `idx_concession_items_event ON (event_id) WHERE state = 'listed'`.
**No stock/sold columns exist** — availability is unconditional while `listed` (clarified scope).
One menu per Event, offered identically on all its showtimes (spec assumption).

### `reservation_concessions` — cart lines inside a live hold

| Column | Type | Rules |
|---|---|---|
| `id` | int8 PK | |
| `reservation_id` | int8 NOT NULL | FK → `reservations(id)` ON DELETE CASCADE; UNIQUE `(reservation_id, concession_item_id)` |
| `concession_item_id` | int8 NOT NULL | FK → `concession_items(id)` |
| `quantity` | int4 NOT NULL | CHECK `(quantity BETWEEN 1 AND 10)` — FR-005 cap in schema |
| `unit_price_amount` | int8 NOT NULL | add-time snapshot; checkout reprices live (research D2) |

Lifecycle: rows exist only while their reservation is `active`. Expiry/cancel of the hold needs
**no code** here — nothing is reserved, nothing to release (FR-007). Replacement-set semantics on
update (client sends the full desired list).

### `order_concessions` — immutable paid lines

| Column | Type | Rules |
|---|---|---|
| `id` | int8 PK | |
| `order_id` | int8 NOT NULL | FK → `orders(id)` |
| `concession_item_id` | int8 NOT NULL | FK → `concession_items(id)`; kept for aggregate reporting only |
| `item_label` | text NOT NULL | **snapshot at payment** |
| `unit_price_amount` | int8 NOT NULL | **snapshot at payment** |
| `quantity` | int4 NOT NULL | CHECK `(BETWEEN 1 AND 10)` |

Written once inside the checkout transaction; never updated afterwards. An order may contain
ticket lines and/or concession lines; `orders.final_total_cents` already includes both.

### `concession_vouchers` — one scannable proof per order

| Column | Type | Rules |
|---|---|---|
| `id` | int8 PK | |
| `order_id` | int8 NOT NULL | **UNIQUE** — enforces "exactly one voucher per order" in schema |
| `code` | text NOT NULL UNIQUE | `randomUUID()`; the QR payload (mirrors `tickets.barcode_value`) |
| `code_hash` | text NOT NULL UNIQUE | `sha256(code)` hex (mirrors `tickets.qr_token_hash`) |
| `status` | text NOT NULL DEFAULT `'unredeemed'` | CHECK `('unredeemed','redeemed','void')` |
| `redeemed_at` | timestamptz | set on redemption |
| `redeemed_by` | int8 | FK → `users(id)`; the staff account that scanned |

## State machines

```text
concession_items.state : listed ⇄ stopped        (PATCH by owner; stopped hides from buyers only)

concession_vouchers.status:
  [minted] ──▶ unredeemed ──▶ redeemed   (one guarded UPDATE wins; rescans return already=true)
                  └────────▶ void        (event cancellation refunds + voids, same transaction)
```

## Integration points with existing tables/code

| Site | Change |
|---|---|
| `checkout()` wallet.service.ts | read+lock `reservation_concessions` ⟕ `concession_items` (reprice, refuse `stopped`), fold into `total`, insert `order_concessions` snapshots + mint voucher when lines exist |
| `settleEventCancellation()` tickets.service.ts | refund Σ qty × snapshot price per affected paid order into wallets (`kind 'refund'`, `order_id` set), vouchers → `'void'`; returned `refundedAmount` includes concessions |
| Reservation read/write (holds module) | include `concessions[]` and recompute `totalAmount` (shared type extended, not re-declared) |
| `OrderView` / order list queries | LEFT JOIN the two new tables; absent rows render exactly as today |
| Analytics (`analytics.repo.ts` gross revenue etc.) | zero changes — reads `orders.final_total_cents`, which now includes concessions by construction |
| `deleteEvent()` events.service.ts | unchanged: it already refuses events with sold inventory; concession-bearing orders are inventory, so the guard covers them |
| Legacy mock `comboOffer` (src/data.ts) | untouched (out of scope per spec assumptions) |

## Validation rules summary (from spec FRs)

- Price ≥ 0 whole đồng; quantities 1..10 per line (CHECK constraints above are the floor;
  service repeats them for friendly Vietnamese errors, e.g. `concession_quantity_limit`).
- Concession-only orders impossible: checkout keeps its existing `empty_reservation` guard and
  concession lines are only ever created through a reservation that holds ≥ 1 ticket line.
- Public menu visibility = event `VISIBLE_WHERE` AND item `state='listed'`; buyability adds
  `UPCOMING_SHOWTIME` for the chosen showtime.
