# Research: Concession Add-Ons (Bắp Nước)

Feature: `/specs/014-fnb-add-ons/spec.md` · Date: 2026-08-23
All questions raised during planning are resolved here; none remain open.

---

## D1 — How concession selections travel through the reservation stage

**Decision**: A new table `reservation_concessions(reservation_id, concession_item_id, quantity,
unit_price_amount)` holding one row per item per reservation. The existing `reservation_items`
table is **not** reused.

**Rationale**: `reservation_items.ticket_tier_id` is `NOT NULL` and every reader of that table —
checkout item fetch, order views, deleteEvent inventory counts, analytics — INNER JOINs
`ticket_tiers`. Overloading it with a nullable tier would force LEFT JOIN rewrites across the
money path, exactly the kind of change Principle V forbids for zero user-visible gain. A separate
table keeps the ticket pipeline byte-identical. Because stock is unlimited, a selection needs no
hold bookkeeping at all: the row lives and dies with its `reservations` row, so hold expiry and
the top-up grace need no changes (FR-007 falls out for free).

**Alternatives considered**:
- *Overload `reservation_items`* — rejected above; touches critical-logic joins for no benefit.
- *Client-side cart only, submitted at checkout* — rejected: the buyer must see the combined
  total on the reservation screen they refresh while deciding, and the server owns totals.

## D2 — Snapshot vs live pricing (immutability of history, FR-010/FR-013/FR-014)

**Decision**: Two-layer rule.
1. **Paid orders are immutable**: `order_concessions` stores `item_label` and `unit_price_amount`
   copied from the menu item at payment time. Reads of past orders use ONLY these snapshot
   columns; nothing ever joins back to `concession_items` for display. Stopping sales or editing
   an item therefore cannot rewrite history.
2. **The cart reprices at checkout**: `reservation_concessions.unit_price_amount` is written when
   the buyer adds the item but checkout re-reads the current listed price inside its transaction;
   an item stopped in the meantime fails the whole checkout with `concession_unavailable`.

**Rationale**: The checkout screen always refetches the reservation immediately before paying, so
what the buyer confirms is what is charged — the same guarantee tickets get from their tier-lock
re-check. Honouring a stale add-time price instead would let a buyer pay a price the organizer
already corrected seconds earlier, which surprises both sides.

**Alternatives considered**: *Honour add-time price strictly* — rejected (stale-price surprise);
*block price edits once any reservation references the item* — rejected as over-engineering for
an academic build (YAGNI).

## D3 — Voucher issuance and verification

**Decision**: One `concession_vouchers` row minted inside the checkout transaction iff the order
has ≥ 1 concession line. Code = `randomUUID()`; stored verbatim in `code` (scannable payload) and
as `createHash('sha256').update(code).digest('hex')` in `code_hash` — byte-for-byte the pattern
already used by `tickets.barcode_value` / `tickets.qr_token_hash` (wallet.service.ts:504-517).
Redemption looks the code up by `code_hash`, flips `status 'unredeemed' → 'redeemed'` with a
guarded single-row `UPDATE … WHERE id = $1 AND status = 'unredeemed'`, and stamps `redeemed_at` /
`redeemed_by`. Cancellation voids via `status → 'void'`.

**Rationale**: Reusing the proven ticket pattern means no new crypto, no new lookup shape, and the
scanner surface already renders arbitrary codes. One voucher per ORDER (not per line) matches the
spec's "exactly one QR voucher covers all lines" and makes the counter hand-over atomic — there is
no partial state to reason about. `UNIQUE(order_id)` enforces "exactly one" in the schema itself.

**Alternatives considered**: *Per-line vouchers* — rejected (N scans per family, partial-handover
ambiguity); *signed stateless token with no table* — rejected: redemption state must be shared
between devices and survive restarts; the DB is the source of truth (Principle I).

## D4 — Wallet checkout integration

**Decision**: No new endpoint. `POST /api/checkout { reservationId }` gains two steps inside its
existing transaction: read `reservation_concessions` joined to `concession_items FOR UPDATE`
(reprice + availability gate per D2), add Σ qty × price to `total`; after ticket issuance, insert
the voucher row if any lines exist. Insufficient-balance shortfall math automatically includes
concessions since it derives from `total`. `OrderView` gains optional `concessions[]` and
`voucher{}`; `orders.final_total_cents` already carries the combined figure, so wallet statements,
order lists, and organizer/admin revenue analytics pick concessions up with zero extra queries.

**Rationale**: Constitution Principle II — payment state changes through exactly one validated
path; adding a second settlement route would double the audited surface. The existing
idempotency guard (returning the existing order on re-call) also covers the voucher for free.

## D5 — Cancellation refunds

**Decision**: Extend `settleEventCancellation()` (tickets.service.ts) inside the same
transaction: after the ticket loop, select paid orders of the event's future showtimes that carry
concession lines, credit each buyer's wallet Σ qty × unit_price_amount with one
`wallet_transactions` kind `'refund'` row per order, and set their vouchers to `'void'`. The
function's returned `refundedAmount` includes the concession sum so the audit log's
`refundedTickets`/`refundedAmount` pair stays honest. Refunds apply regardless of redemption state
(spec edge case: no partial claw-back).

**Rationale**: Money movement stays inside the one ACID event-cancellation transaction that
already exists — atomicity and the deadlock-retry story come free. Per-order ledger granularity
mirrors how the purchase side books one `'purchase'` row per order.

**Alternatives considered**: *Refunding only unredeemed vouchers* — rejected: contradicts the
agreed spec edge case; *separate sweep job* — rejected (two clocks, partial-failure states,
Principle I violation).

**Out of scope, recorded**: per-ticket self-cancel (`cancelTicket`, UC-42) does not touch
concessions — the spec defines no partial-order cancellation; noted for tasks to leave untouched.

## D6 — API surface and router placement

**Decision**: Three thin routers, matching the repo's many-routers-per-prefix convention:
- `GET /api/catalog/events/:eventId/concessions` — public, behind the existing catalog IP rate
  limiter, filtered by the live visibility predicate (`VISIBLE_WHERE`/`VISIBLE_JOIN`) so a draft,
  pending-review or removed event exposes nothing.
- `POST|PUT|PATCH|DELETE /api/organizer/events/:eventId/concessions[/:concessionId]` — new
  organizer router mounted beside the others at `/api/organizer`; ownership asserted against
  `events.organizer_id → organizers.user_id` server-side. `DELETE` hard-deletes only items never
  referenced by any line; anything sold answers `409 concession_in_use` and points to
  `PATCH { state: 'stopped' }` — same philosophy as `deleteEvent` refusing events with inventory.
- `POST /api/checkin/concessions/redeem { code }` — new small router; actor scoping mirrors
  `checkin.service.checkIn`: owning organizer or admin, unknown code and foreign-event code answer
  the identical `not_found` (anti-oracle), rescans return `already: true` semantics via the
  guarded update.

**Rationale**: The user-pinned paths fit the existing mounts (`catalogPublicRouter`,
`/api/organizer/*`) except `/api/checkin`, which currently lives as functions called from
organizer/admin routers rather than its own prefix — a dedicated prefix here keeps the scanner
client simple without disturbing the shipped ticket endpoints.

**Alternatives considered**: *Reusing `/api/organizer/tickets/check-in`-style path for redeem* —
rejected: user pinned `/api/checkin/concessions/redeem`; mixing voucher redemption into the ticket
endpoint would overload one payload shape with two meanings.

## D7 — Sales window & menu visibility rules

**Decision**: The public menu read returns listed items only when the event is publicly visible;
buyability (adding to a reservation) additionally requires the chosen showtime to pass the same
`UPCOMING_SHOWTIME` predicate used at checkout, evaluated at add time AND re-checked implicitly by
checkout's existing sellability lock. Organizer CRUD reads see the menu regardless of moderation
state (they own it), writes are allowed in any lifecycle state, and taking an event down hides the
menu implicitly through the visibility predicate (no menu-specific moderation).

**Rationale**: One predicate, reused everywhere, is the cheapest way to keep FR-003 true; a
menu-specific window table was rejected as unused machinery (YAGNI).

## D8 — Post-design constitution re-check

- **I Reliability**: worst-case contention on the new path is the checkout row locks already
  held; unlimited stock adds none. Redemption race closed by guarded UPDATE. ✔
- **II Security**: ownership + actor scoping enforced server-side on every write; codes hashed at
  rest; anti-oracle errors; parameterized SQL only. ✔
- **IV Test-first**: quickstart.md names the asserting tests (including denial cases) that land
  before/alongside implementation. ✔
- **V Simplicity**: four tables, zero new dependencies, zero new external integrations. ✔
- **VI Contract**: `shared/concessions/types.ts` + in-place extensions of `Reservation` /
  `CheckoutOrder`; Vietnamese UI copy; legacy mock `comboOffer` untouched. ✔

No gate violations; Complexity Tracking in plan.md stays empty.
