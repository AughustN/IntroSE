# Quickstart: End-to-End Validation — Concession Add-Ons (Bắp Nước)

Feature: `/specs/014-fnb-add-ons/spec.md` · Contracts: [`contracts/fnb-api.md`](./contracts/fnb-api.md) ·
Model: [`data-model.md`](./data-model.md)

Proves the whole loop: organizer builds a menu → buyer adds snacks to a ticket order and pays
once → voucher appears → counter scans it → cancelling the event refunds tickets + snacks.

## Prerequisites

- Postgres reachable; `server/.env` configured as for any dev run.
- Schema applied: `npm run db:migrate` (applies `0039_concessions.sql`); `data_base/InitDB.sql`
  re-synced in the same change so fresh installs match.
- One seeded **organizer** account owning a visible event (`on_sale` + `approved`) with an
  upcoming showtime, and two **attendee** wallets funded above the ticket price
  (`npm run seed:dev`, then top up via the wallet API if needed).
- Server + SPA running (`npm run dev` at the repo root, or the two processes separately).

## Scenario A — Organizer curates the menu

1. As the owning organizer:
   - `POST /api/organizer/events/:eventId/concessions` with
     `{ "label": "Bắp rang bơ", "description": "Vị ngọt", "priceAmount": 50000 }` → `201`,
     `state: "listed"`.
   - Add `"Nước suối"` at `10000`.
2. `GET /api/catalog/events/:eventId/concessions` **unauthenticated** → both items listed.
3. Negative checks (must all be denied server-side):
   - A different organizer's token on the same POST/PUT/PATCH/DELETE → `403 forbidden`.
   - `POST` with `priceAmount: 9900.5` or `-1` → `422 invalid_price`.

**Pass**: menu visible publicly only while the event is visible; foreign writes refused.

## Scenario B — Buy snacks with tickets in one checkout

1. As an attendee: hold a ticket on the showtime (existing flow), then
   `PUT /api/reservations/:id/concessions`
   `{ "items": [{ "concessionItemId": <bắp>, "quantity": 2 }, { "concessionItemId": <nước>, "quantity": 1 }] }`
   → reservation response shows the lines and `totalAmount` = tickets + 110000.
2. Attempt quantity `11` → `422 concession_quantity_limit`; attempt a concessions-only
   reservation (no ticket held) at checkout → existing `empty_reservation` refusal.
3. `POST /api/checkout { reservationId }` → single debit equal to the combined total; response
   contains snapshot `concessions[]` and one `voucher` with `status: "unredeemed"`.
4. Wallet statement shows exactly one `'purchase'` entry for the combined amount; the SPA ticket
   view renders the QR voucher next to the tickets.

**Pass**: SC-001 satisfied manually; totals match to the đồng; exactly one voucher per order
(second row would violate the UNIQUE constraint — none exists).

## Scenario C — Counter redemption

1. Scan/submit `POST /api/checkin/concessions/redeem { "code": <voucher code> }` as the owning
   organizer → `200 { "already": false, … }`; voucher now `redeemed`.
2. Rescan the same code → `200 { "already": true }` — nothing changes.
3. Submit an unknown code, then a valid code from ANOTHER organizer's event → identical
   `404 concession_voucher_not_found` for both (anti-oracle).

**Pass**: SC-002 — first scan hands over every line; repeats never mutate state.

## Scenario D — Immutability & mid-flight changes

1. Organizer `PATCH …/:id { "state": "stopped" }` on "Nước suối" → public menu GET no longer
   lists it.
2. The paid order from Scenario B still renders "Nước suối ×1 @ 10000₫" (snapshot read).
3. New attendee adds "Nước suối" to a cart, organizer stops it before checkout → checkout fails
   `409 concession_unavailable` naming the item; nothing is charged.
4. `DELETE` of "Bắp rang bơ" (sold in Scenario B) → `409 concession_in_use`.

**Pass**: FR-010/FR-013/FR-014 — history immutable, buyers never silently charged.

## Scenario E — Cancellation refunds everything

1. Seed (or reuse) a paid order with tickets + concessions on the event.
2. Organizer cancels the event (existing cancel endpoint).
3. Verify inside one pass:
   - Attendee wallet credited ticket refunds **plus** Σ qty×snapshot price for concessions;
     statement shows the refund entries referencing the order.
   - Voucher status `void`; redeeming it now → `409 voucher_void`.
   - Order `payment_status` follows the existing ticket-derived rule (unchanged logic).
   - Cancellation audit record's `refundedAmount` includes the concession money.

**Pass**: SC-003 — refunded credits equal tickets + concessions for every affected order.

## Automated coverage (test-first, Principle IV)

Supertest suites under `server/tests/concessions/` assert each scenario above plus denials:
menu CRUD authz matrix, combined-total math, insufficient balance including concessions,
repricing/stopped-item conflict, double-redeem, foreign-event redeem, cancellation refund sums,
snapshot immutability after stop/edit. Run:

```
npm test -- --run server/tests/concessions
```

Load spot-check for SC-005 (p95 confirm delta < 1 s vs tickets-only) via the repo's k6 setup.
