# Feature Specification: Concession Add-Ons (Bắp Nước)

**Feature Branch**: `014-fnb-add-ons`

**Created**: 2026-08-23

**Status**: Draft

**Input**: User description: "mình muốn thêm tính năng mua bắp nước"

## Clarifications

### Session 2026-08-23

- Q: How are concessions purchased — bundled with a ticket order or as standalone orders? → A: **Add-on only (Option A).** Concessions can only be bought together with at least one ticket in the same order and paid in the same single payment; no standalone concession orders.
- Q: Is availability constrained by stock? → A: **No stock tracking (unlimited).** Every listed item is always available while its sales window is open; the system records what was sold but never blocks a sale for lack of stock.
- Q: How does the buyer receive the items at the venue? → A: **Counter voucher with QR (Option A).** The paid order carries one concession voucher with a scannable QR; counter staff scan it once to hand over everything ordered, and scanning again is rejected.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Buy Snacks With Tickets In One Checkout (Priority: P1)

An attendee choosing seats or tiers for a showtime sees the event's concession menu ("bắp nước") next to the ticket selection, adds e.g. "Bắp rang bơ" ×2 and "Nước suối" ×1, and pays once — the order total is tickets + snacks in a single payment. The confirmation and ticket view show the concession lines plus one QR voucher used to collect everything at the venue counter.

**Why this priority**: This is the entire buyer-facing value of the feature — larger baskets for organizers with zero extra steps for buyers. Without it nothing else in the feature matters.

**Independent Test**: Book any purchasable showtime, add concession quantities, pay through the existing checkout; verify the paid total equals tickets + concessions and that one voucher appears listing every line ordered.

**Acceptance Scenarios**:

1. **Given** a public on-sale showtime whose event has at least one listed concession item, **When** the attendee reaches checkout, **Then** the menu is offered alongside ticket selection.
2. **Given** the attendee selects quantities of one or more items, **When** they review checkout, **Then** the order total shown is the sum of ticket prices and concession line totals (quantity × unit price) in whole VND.
3. **Given** a completed payment for tickets + concessions, **When** the attendee views the order/ticket detail, **Then** each concession line shows label, quantity and unit price, and exactly one QR voucher covers all concession lines of the order.
4. **Given** the attendee selects no concessions, **When** they pay for tickets only, **Then** checkout behaves exactly as before this feature existed — no added noise or steps.

---

### User Story 2 - Organizer Curates The Menu (Priority: P2)

An organizer managing their event maintains the concession menu: create items (name, short description, whole-VND price), fix a typo or price, stop selling an item, or re-list it. Stopping sales never rewrites history: orders already containing that item keep showing its original label and price forever.

**Why this priority**: Without a way to define items there is nothing to sell; it precedes any real purchase but is organizer-facing plumbing compared with the P1 buyer journey.

**Independent Test**: As an organizer, create, edit, stop-selling and re-list items on an owned event; verify buyer-facing reads reflect each change immediately and a previously placed order still displays the stopped item's original label and price.

**Acceptance Scenarios**:

1. **Given** an organizer owns an event, **When** they add an item with name, description and a whole-VND price, **Then** it appears in the buyer-facing menu of every public showtime of that event.
2. **Given** an item already present in paid orders, **When** the organizer stops selling it, **Then** it disappears from buyer-facing reads while existing orders still resolve its label and unit price exactly as sold.
3. **Given** a stopped-selling item, **When** the organizer re-lists it, **Then** it becomes purchasable again for upcoming showtimes without affecting anything already sold.
4. **Given** anyone who is not the owning organizer attempting menu management, **When** the request reaches the server, **Then** it is denied regardless of what the UI shows.
5. **Given** an edit to an item's name or price, **When** later purchases occur, **Then** they use the new values while all earlier orders remain unchanged.

---

### User Story 3 - Counter Redemption And Cancellation Money-Back (Priority: P3)

At the venue, the attendee opens their order and shows the concession QR; counter staff scan it with the organizer's scanning tool — all lines are marked handed-over in one action, and a second scan of the same voucher is refused with a clear message. If the event is cancelled, the automatic wallet refund returns the ticket AND concession amounts together under the existing refund rules.

**Why this priority**: Completes the loop operationally and protects trust around money, but it only matters once purchases exist.

**Independent Test**: Scan a paid voucher once (success) then again (refused); cancel a seeded event holding paid tickets + concessions and verify the wallet credit equals both parts combined.

**Acceptance Scenarios**:

1. **Given** a paid order with unredeemed concession lines, **When** authorized staff scans the voucher, **Then** every line flips to handed-over in one step and the scan result confirms success.
2. **Given** a fully redeemed voucher, **When** it is scanned again, **Then** the scan is refused with explicit "already redeemed" feedback and nothing changes.
3. **Given** a cancelled event with paid orders containing tickets + concessions, **When** automatic refunds run, **Then** the store-credit wallet receives the ticket refunds plus the full concession amount for each affected order.
4. **Given** a voucher scanned by someone without staff authorization for that event, **When** the scan request is processed, **Then** it is denied server-side.

---

### Edge Cases

- Hold lapse: concession selections die together with an unpaid reservation — nothing is reserved, nothing owed, no cleanup needed beyond the reservation itself.
- Sales window: the menu is buyable until the chosen showtime's start time; afterwards (or if the event finishes or is cancelled) it disappears from checkout.
- Quantity bounds: per-line quantity above the cap (default 10) is rejected with a clear message rather than silently clamped.
- Item stops selling while a checkout session is open: confirming fails gracefully for that line with a prompt to remove it — never a silent charge.
- Concession-only submission (no ticket in the order): rejected — concessions require at least one ticket.
- Historical rendering: stopped/archived items keep rendering their original label and price on past orders indefinitely, including after the event finished.
- Cancellation with partially redeemed vouchers: the full concession amount is refunded regardless of redemption state (no partial claw-back).
- Long menus: the buyer-facing list remains a single readable scroll at expected scale (a handful to ~20 items); pagination is unnecessary.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST let the owning Organizer maintain one concession menu per Event: create items, edit name/description/price, stop selling (archive), and re-list.
- **FR-002**: Prices MUST be whole VND integers end to end; buyer-facing copy MUST be Vietnamese consistent with the rest of the product.
- **FR-003**: The menu MUST be offered to Attendees only when the event is publicly visible (on sale AND approved) and the chosen showtime has not started.
- **FR-004**: Attendees MUST add concession quantities during the same checkout as tickets; an order containing concessions but no ticket MUST be impossible.
- **FR-005**: Per-line quantity MUST be bounded (maximum 10 units per item per order).
- **FR-006**: Concession amounts MUST be included in the single order total and settled in the SAME payment as the tickets — no second payment step, regardless of payment method.
- **FR-007**: Concession selections MUST share the reservation lifecycle: an unpaid lapsed hold discards them with no side effects.
- **FR-008**: After successful payment, the order MUST present exactly one concession voucher with a scannable QR covering all its concession lines, shown wherever the tickets are shown.
- **FR-009**: Scanning the voucher MUST atomically mark ALL of its unredeemed lines handed over; rescanning a fully redeemed voucher MUST be refused with explicit feedback and change nothing.
- **FR-010**: Stopping sales of an item MUST hide it from buyer-facing reads immediately while every existing order line continues to resolve the label and unit price captured at purchase time.
- **FR-011**: Cancelling an event MUST refund concession amounts together with ticket refunds to the store-credit wallet under the same automatic, once-only rules.
- **FR-012**: Menu management MUST be enforced server-side to the owning organizer only; admins retain platform authority consistent with existing moderation tools.
- **FR-013**: Voucher redemption MUST be restricted server-side to the owning organizer's staff scanning surface, mirroring door check-in permissions.
- **FR-014**: Edits to an item affect only future purchases; paid order lines are immutable.
- **FR-015**: The concession additions MUST NOT sit on or slow the critical purchase path beyond adding the selected lines to the existing order flow.

### Key Entities *(include if feature involves data)*

- **Concession item (món bán kèm)**: one snack/drink offering on an Event's menu — label, optional short description, whole-VND price, state listed/stopped-selling. Belongs to one Event; offered identically on all its public showtimes. Distinct from a Ticket tier (which is a class of admission, not merchandise).
- **Menu**: the set of listed concession items of one Event as buyers see it in checkout — derived, not separately managed.
- **Concession line (dòng món trong đơn)**: one item × quantity inside an Order, carrying the item's label and unit price captured at purchase time plus a handed-over flag; immutable after payment.
- **Concession voucher**: the single QR-bearing proof on a paid order entitling collection of all its concession lines at the venue counter; lifecycle un-redeemed → redeemed.
- Extends **Reservation / Order**: an order may contain ticket lines and/or concession lines; totals, payment, and refunds span both kinds.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An attendee completes a combined tickets + concessions purchase in a single checkout — verified end-to-end in under 3 minutes including choosing the seat/tier.
- **SC-002**: 100% of paid orders containing concessions display a working voucher whose single scan hands over every ordered line; repeat scans are refused in 100% of attempts.
- **SC-003**: In cancellation drills, refunded wallet credits equal tickets + concessions for 100% of affected paid orders.
- **SC-004**: An organizer can build and publish a five-item menu in under 10 minutes without documentation.
- **SC-005**: Adding concessions does not measurably slow checkout: p95 confirm-time for a tickets-only order versus a tickets+concessions order differs by less than 1 second under load tests.
- **SC-006**: Historical orders render stopped items' original label and price correctly in 100% of spot checks after the item is pulled from sale.

## Assumptions

- No inventory counting: items are unlimited while listed (per clarification). Sold counts may be recorded for reporting but never gate availability.
- One menu per Event applied identically across its showtimes; per-showtime menus are out of scope for v1.
- Maximum 10 units per item per order; adjustable later if organizers ask.
- No combo pricing, discounts, or bundling logic in v1 (the legacy mock `comboOffer` text field is unrelated and left untouched).
- No admin pre-moderation of menus — menus ride the event's own visibility; taking an event down hides its menu implicitly.
- Redemption happens through the existing organizer-side scanner surface extended to recognise concession vouchers; no separate pickup codes, delivery, or time slots.
- Refunds extend the current wallet-refund rules (automatic, once, closed-loop) to concession amounts; real-money settlement stays out of scope per the constitution.
- Whatever payment methods exist for tickets today apply unchanged to the combined total.
- Vietnamese-language UI throughout, matching the product.
