# Feature Specification: Real-Time Seat Selection & Holds

**Feature Branch**: `001-seat-selection-holds`

**Created**: 2026-07-10

**Status**: Draft

**Input**: User description: "Real-Time Seat Selection & Holds (Feature 11) — Buyers of seated events pick seats on a live seat map. Selecting a seat places a temporary hold (available → held → pending_payment → sold lifecycle); held seats auto-release after a configurable TTL (default 7 min) even if the client disconnects. Holds are concurrency-safe so two buyers are never sold the same seat, and order+ticket issuance is atomic. A seat entering pending_payment on payment hand-off is locked for its 15-min payment window and never freed early. Seat status broadcasts to all viewers in real time. This is TixHub's core differentiator. Out of scope: the payment call itself (F2), QR ticket generation (F3), seat-map designer authoring (F1)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pick and hold an available seat (Priority: P1)

An attendee opens the seat map of a seated event, sees which seats are available, and selects
one or more. The moment a seat is selected it becomes reserved *for that attendee* and is shown
as unavailable to everyone else, so the attendee can proceed toward payment confident the seat is
theirs for a limited time.

**Why this priority**: This is the core value of the feature and TixHub's headline
differentiator. Without it there is no seated-event purchase flow. It delivers a usable slice on
its own: an attendee can claim a specific seat.

**Independent Test**: Open a seated event's map as one attendee, select an available seat, and
confirm the seat becomes reserved to that attendee and is marked taken. Fully testable without
payment, QR, or the seat-map designer.

**Acceptance Scenarios**:

1. **Given** an event with available seats, **When** the attendee selects an available seat,
   **Then** the seat is held for that attendee and no longer selectable by others.
2. **Given** an attendee holding a seat, **When** they deselect it, **Then** the seat returns to
   available and becomes selectable by others.
3. **Given** an attendee, **When** they select several available seats in one session, **Then**
   all selected seats are held together for that attendee, up to the per-order seat limit.

---

### User Story 2 - Two buyers, one seat: never double-sold (Priority: P1)

Two (or many) attendees view the same seat map and attempt to grab the same seat at nearly the
same instant. Exactly one succeeds; every other attempt is cleanly rejected and told the seat was
just taken, so no two people ever walk in with a claim to the same seat.

**Why this priority**: Correctness under contention is the whole point (survey's #1 pain is
platforms failing under load). A seat map that occasionally double-sells is worse than none.

**Independent Test**: Fire many simultaneous hold attempts at a single seat from different
attendees; assert exactly one wins and the rest receive a "seat taken" rejection, with no state
in which two attendees both hold or own the seat.

**Acceptance Scenarios**:

1. **Given** one available seat and N attendees selecting it simultaneously, **When** the
   contention resolves, **Then** exactly one attendee holds it and N−1 receive a clear "just
   taken" rejection.
2. **Given** a seat already held by attendee A, **When** attendee B selects it, **Then** B's
   selection is rejected and B sees the seat as unavailable.

---

### User Story 3 - Seats appear live to everyone (Priority: P1)

While an attendee is looking at a seat map, seats taken or released by other people update on
their screen within about a second, without a manual refresh, so the map they see reflects
reality closely enough that they rarely click a seat that is already gone.

**Why this priority**: Real-time accuracy is what prevents wasted selections and the frustration
of "that seat was available a second ago." It is inseparable from the seat-map experience.

**Independent Test**: Two attendees view the same map; when one holds or releases a seat, assert
the other's map reflects the change within the latency target without refreshing.

**Acceptance Scenarios**:

1. **Given** two attendees viewing one map, **When** attendee A holds a seat, **Then** attendee
   B sees that seat become unavailable within the live-update target.
2. **Given** attendee A's hold expires or is released, **When** it returns to available, **Then**
   attendee B sees it become selectable again within the live-update target.

---

### User Story 4 - Holds expire and free the seat (Priority: P2)

An attendee selects a seat but wanders off, closes the tab, or loses connection without paying.
After a configurable holding period the seat is automatically released back to available so it is
not stuck reserved forever, and other attendees can then buy it.

**Why this priority**: Prevents inventory from silently locking up. Important, but the primary
purchase path (P1) can be demonstrated before automatic expiry is wired up.

**Independent Test**: Place a hold, then simulate the attendee disconnecting and doing nothing;
after the holding period assert the seat auto-releases to available even though the client never
came back.

**Acceptance Scenarios**:

1. **Given** a held seat with no progression to payment, **When** the holding period elapses,
   **Then** the seat auto-releases to available.
2. **Given** an attendee holding a seat, **When** their client disconnects, **Then** the seat
   still auto-releases after the holding period (release does not depend on the client).

---

### User Story 5 - A seat in the payment window is never freed early (Priority: P2)

Once an attendee proceeds to payment, their seat moves into a payment-pending state and is locked
for the full payment window. It is not released by the ordinary holding-period timer, so a seat
can never be sold out from under someone who is mid-payment. If payment is not confirmed within
the window, the seat is released; a confirmation that arrives after release does not grant a
ticket.

**Why this priority**: Protects the buyer during the most sensitive moment. Depends on the hold
mechanism (P1) and expiry model (P2) existing first, so it follows them.

**Independent Test**: Move a held seat into the payment-pending state, then let the ordinary
holding period elapse; assert the seat stays reserved for the full payment window and is not
freed early. Separately, let the payment window expire with no confirmation and assert release.

**Acceptance Scenarios**:

1. **Given** a seat in the payment-pending state, **When** the ordinary holding period would
   otherwise expire, **Then** the seat remains reserved (not released) until the payment window
   ends.
2. **Given** a payment-pending seat whose window expires with no confirmation, **When** the
   window ends, **Then** the seat returns to available.
3. **Given** a payment-pending seat that was released after its window, **When** a late
   confirmation arrives, **Then** no seat or ticket is granted for that expired attempt.

---

### Edge Cases

- **Selecting a seat that just became taken**: the map showed it available but another attendee
  claimed it a moment earlier — the selection is rejected with a "just taken" message and the map
  corrects itself.
- **Attendee reconnects during their hold**: their existing selections are still theirs and still
  reflect the remaining hold time.
- **Attendee reconnects after their hold expired**: the previously held seats are gone; the
  attendee is informed and must reselect.
- **Per-order seat limit reached**: selecting an additional seat beyond the limit is refused with
  a clear message.
- **Event sells out while viewing**: the map shows no available seats and selection is disabled.
- **Same attendee opens two tabs/devices**: their held seats are consistent across sessions; a
  seat held in one is shown held (as theirs) in the other.
- **Deselect vs. expiry race**: a seat released manually and one released by timeout both end in
  available exactly once, never double-released or resurrected.
- **Late confirmation after payment-window release**: does not resurrect the seat or issue a
  ticket (no money moves — sandbox only).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST display a seated event's seat map showing each seat's current status
  (available, unavailable/taken) to any viewer of the event.
- **FR-002**: An attendee MUST be able to select an available seat, which places a temporary hold
  on that seat for that attendee.
- **FR-003**: A seat MUST progress through an explicit lifecycle — **available → held →
  payment-pending → sold** — with **held → available** on release/expiry and **payment-pending →
  available** on payment-window timeout. No other transitions are permitted.
- **FR-004**: System MUST guarantee that **no two attendees can ever hold or own the same seat**:
  concurrent attempts on one seat are serialized so exactly one succeeds and the rest are
  rejected. *(Constitution DATA-02.)*
- **FR-005**: A rejected selection MUST return a clear, immediate "seat just taken / unavailable"
  outcome, not an error or a silent failure.
- **FR-006**: An attendee MUST be able to deselect a seat they hold, returning it to available
  immediately.
- **FR-007**: A held seat MUST auto-release to available after a **configurable holding period
  (default 7 minutes)**, and this release MUST occur even if the attendee's client has
  disconnected. *(Constitution REL-02.)*
- **FR-008**: When a held seat progresses to **payment-pending** (on hand-off to payment), the
  seat MUST be locked for the **full payment window (15 minutes)** and MUST NOT be freed by the
  ordinary holding-period timer. *(Constitution DATA-03.)*
- **FR-009**: A payment-pending seat MUST be resolved only by a confirmed payment (→ sold) or by
  expiry of its payment window (→ available) — never released before the window ends.
- **FR-010**: A payment confirmation arriving after a seat's payment window has expired and the
  seat has been released MUST NOT issue a ticket or re-reserve the seat.
- **FR-011**: Any change to a seat's status MUST be broadcast to all attendees currently viewing
  that event's seat map, so each viewer's map reflects the change without a manual refresh.
- **FR-012**: System MUST support multiple attendees selecting seats on the **same event's seat
  map at the same time** without incorrect states, up to the concurrency target in Success
  Criteria.
- **FR-013**: An attendee MUST be able to hold more than one seat at once, up to a **configurable
  per-order seat limit**.
- **FR-014**: On reconnect within an active hold, an attendee's held seats MUST still be
  recognized as theirs with the remaining hold time; after expiry they MUST be shown as released.
- **FR-015**: The commitment of a seat to **sold** (order + ticket issuance) MUST be **all-or-
  nothing**: if any step fails, the seat MUST NOT end in a sold state. *(Constitution DATA-01;
  the payment call and ticket generation themselves are owned by F2/F3, but this feature MUST
  expose the seat state transition atomically.)*
- **FR-016**: Whether an **unauthenticated guest** may place a seat hold, or must sign in first,
  is [NEEDS CLARIFICATION: Vision §3.3 says guests are prompted to register only at checkout,
  which implies guests can select seats first; but anonymous holds have no accountability and
  invite seat-blocking abuse. Allow guest holds, or require sign-in before holding?].

### Key Entities *(include if feature involves data)*

- **Seat**: A single addressable position within a seated event's map. Has a stable identity
  within the event and a current **status** (available / held / payment-pending / sold). Belongs
  to exactly one event.
- **Seat Hold**: A temporary claim linking one seat to one attendee (or session), with a start
  time and an expiry. Exists only for held and payment-pending seats; ends on release, expiry, or
  progression to sold.
- **Seat Status / Lifecycle**: The state of a seat and the permitted transitions between states;
  the authoritative record that decides contention (the database, not any viewer's screen).
- **Event (Seated)**: The event whose map is being viewed; supplies the set of seats and the
  configuration (holding period, payment window, per-order limit). *(Authoring of the map itself
  is F1, out of scope here.)*
- **Attendee / Session**: The party placing holds; a seat's hold is scoped to one attendee and
  never shown as another's.
- **Order (reference only)**: The downstream purchase a set of held seats hands off to at
  payment; owned by F2. This feature only transitions seats into/out of payment-pending in step
  with it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Across a stress test of many attendees contending for the same seats, **zero seats
  are ever held or owned by two attendees at once** (0% double-sell).
- **SC-002**: When N attendees select the same seat simultaneously, **exactly one succeeds** and
  the other N−1 receive a clear rejection.
- **SC-003**: A seat status change made by one attendee becomes visible to other attendees
  viewing the same map in **under 1 second** (95th percentile).
- **SC-004**: A single event's seat map remains correct and responsive with **at least 60
  attendees selecting concurrently for a sustained 5-minute period**, with no dropped live
  connections and no incorrect seat states.
- **SC-005**: A held seat with no progression to payment is **automatically released within the
  configured holding period** (default 7 minutes) even if the attendee's client never returns.
- **SC-006**: A seat that has entered the payment window is **never released before the full 15-
  minute window elapses**, in 100% of tested cases.
- **SC-007**: A payment confirmation that arrives after the seat's window has expired **never
  results in a ticket** in 100% of tested cases.
- **SC-008**: An attendee can go from opening the seat map to having their chosen seat(s) held in
  **a single, obvious action per seat**, with the map reflecting their selection immediately.

## Assumptions

- **Seat map already exists**: The event's seats and layout are authored elsewhere (F1, seat-map
  designer). This feature consumes an existing map and does not create or edit it.
- **Payment is a separate feature**: The actual payment call, its confirmation callback, and QR
  ticket issuance are owned by F2 (checkout) and F3 (QR tickets). This feature owns only the seat
  state transitions and the boundary hand-off into/out of the payment window.
- **Holding period default = 7 minutes**, configurable (Constitution REL-02). **Payment window =
  15 minutes** (Constitution DATA-03).
- **Per-order seat limit is configurable**; assumed default of 8 seats per order unless product
  decides otherwise (group-buy/split-payment is a separate roadmap item, not this feature).
- **Selecting seats accumulates** into the attendee's current selection; deselecting removes one.
  A dedicated "quick/random seat" assignment is a future enhancement, not in this scope.
- **Authoritative state lives server-side**: when a viewer's map and the server disagree, the
  server's state wins; the map is a live view, not the source of truth.
- **Sandbox payments only**: no real settlement, so an expired-then-late confirmation raises no
  refund — the seat simply is not granted.
- **The single open question (FR-016, guest vs. authenticated holds)** does not block the P1
  stories for authenticated attendees and can be resolved in `/speckit-clarify`.
