# Contract: F&B / Concessions API

Feature: `/specs/014-fnb-add-ons/spec.md` · Date: 2026-08-23
Shared types live in **`shared/types/fnb.ts`** (new) — both SPA and API import them;
`shared/holds/types.ts` `Reservation` and `walletClient.ts` `CheckoutOrder` are extended in place
(Principle VI: one declaration per payload). Money = VND integer. Errors use the platform's
existing `{ code, message, details? }` shape with Vietnamese messages.

## Types (declared once in shared/concessions/types.ts)

```ts
export type ConcessionState = 'listed' | 'stopped';

export interface ConcessionItem {            // organizer CRUD shape
  id: number;
  eventId: number;
  label: string;
  description: string | null;
  priceAmount: number;                       // whole đồng
  state: ConcessionState;
}

export interface PublicConcession {          // buyer-facing menu row
  id: number;
  label: string;
  description: string | null;
  priceAmount: number;
}

export interface ReservationConcessionLine { // cart line inside a reservation read
  concessionItemId: number;
  label: string;
  quantity: number;                          // 1..10
  unitPriceAmount: number;                   // live price (cart reprices at checkout)
}

export interface OrderConcessionLine {       // immutable paid line
  id: number;
  concessionItemId: number;
  label: string;                             // snapshot
  quantity: number;
  unitPriceAmount: number;                   // snapshot
}

export interface ConcessionVoucher {
  code: string;                              // QR payload (owner-visible only)
  status: 'unredeemed' | 'redeemed' | 'void';
  redeemedAt: string | null;
}
```

In-place extensions:
- `Reservation` (+ holds): `concessions?: ReservationConcessionLine[]`; `totalAmount` includes them.
- `CheckoutOrder` (+ order list/detail): `concessions?: OrderConcessionLine[]`,
  `voucher?: ConcessionVoucher`; `totalAmount` already covers both kinds.

---

## Attendee / public

### GET /api/catalog/events/:eventId/concessions

Public menu of a publicly visible event. Catalog IP rate limiter applies. Items with
`state='stopped'`, and events failing the live visibility predicate, return an empty list —
never an error (a not-yet-approved event simply has no public menu).

```json
200 → { "items": [ { "id": 12, "label": "Bắp rang bơ", "description": "Vị ngọt", "priceAmount": 50000 } ] }
```

### Cart integration (reservation-scoped, auth required)

Managed under the existing reservations router so the hold stays the single source of the cart:

```
PUT /api/reservations/:id/concessions     { items: [{ concessionItemId: 12, quantity: 2 }] }
```

Full-replacement semantics; sending `items: []` clears. Response is the updated `Reservation`
(including recomputed `totalAmount`). Refusals:

| HTTP | code | When |
|---|---|---|
| 404 | `not_found` | unknown item / foreign reservation |
| 409 | `showtime_unavailable` | chosen showtime no longer upcoming |
| 422 | `concession_quantity_limit` | any quantity outside 1..10 |
| 409 | `concession_unavailable` | item stopped between read and write |

### Checkout — unchanged endpoint

```
POST /api/checkout { "reservationId": 88 }
```

Concessions ride along: total = tickets + Σ qty×live price; wallet debit covers both; on success
the response carries snapshot lines + voucher:

```json
{
  "id": 501, "totalAmount": 1140000,
  "tickets": [ …unchanged… ],
  "concessions": [
    { "id": 9, "concessionItemId": 12, "label": "Bắp rang bơ", "quantity": 2, "unitPriceAmount": 50000 }
  ],
  "voucher": { "code": "8f3c…-uuid", "status": "unredeemed", "redeemedAt": null }
}
```

Failure additions: `409 concession_unavailable` (item stopped while reviewing — message names the
label); insufficient-balance `details.required` now includes concessions automatically.

---

## Organizer — menu CRUD (auth + ownership enforced server-side)

Mounted under `/api/organizer/events/:eventId/concessions`. The caller must own the event
(`events.organizer_id → organizers.user_id`), else `403 forbidden` regardless of UI.

### POST `/api/organizer/events/:eventId/concessions`

```json
{ "label": "Nước suối", "description": "500ml", "priceAmount": 10000 }
→ 201 { "item": { "id": 13, "state": "listed", … } }
```
Validation: `label` 1..120 chars; `priceAmount` integer ≥ 0 (`422 invalid_price` otherwise).

### PUT `/api/organizer/events/:eventId/concessions/:concessionId`

Partial edit of `label`/`description`/`priceAmount`. Affects only future purchases (paid lines
are snapshots). `→ 200 { "item": … }`.

### PATCH `/api/organizer/events/:eventId/concessions/:concessionId`

```json
{ "state": "stopped" }   // or "listed" to re-list
→ 200 { "item": … }
```
Stopping hides the item from all buyer-facing reads immediately (FR-010).

### DELETE `/api/organizer/events/:eventId/concessions/:concessionId`

Hard delete **only** when never referenced by any cart/paid line:

| HTTP | code | When |
|---|---|---|
| 204 | — | deleted |
| 409 | `concession_in_use` | referenced anywhere — body points to `PATCH { state:'stopped' }` |

---

## Counter staff — voucher redemption

### POST /api/checkin/concessions/redeem

```json
{ "code": "8f3c…-uuid" }
```

Actor must be the owning organizer or an admin — same scoping as ticket check-in. Unknown codes
and other organizers' codes answer identically (`404 concession_voucher_not_found`) so a scanner
never becomes an oracle.

Success (first scan) — every line handed over in one step:

```json
200 → {
  "already": false,
  "orderId": 501,
  "eventTitle": "Chào Show | Tháng 6-2026",
  "buyerName": "Anh",
  "lines": [ { "label": "Bắp rang bơ", "quantity": 2, "unitPriceAmount": 50000 } ]
}
```

Rescan: `200 { "already": true, … }` — idempotent feedback, nothing changes (mirrors ticket
check-in's friendlier-than-409 rescan stance). Refusals:

| HTTP | code | When |
|---|---|---|
| 404 | `concession_voucher_not_found` | unknown or foreign-event code |
| 409 | `voucher_void` | refunded/cancelled order |

---

## Non-functional contract notes

- All endpoints validate input with strict Zod schemas; responses typed end-to-end from the
  shared module (no `any` at the boundary).
- No new rate-limit class: public menu read reuses the catalog limiter; authenticated writes rely
  on existing auth middleware.
- Redemption and checkout each remain single ACID transactions; the redeem flip is a guarded
  `UPDATE … WHERE status='unredeemed'`, so concurrent scans yield exactly one winner.
