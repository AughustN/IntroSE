# Feature Specification: Seat Holds & Reservations

**Feature Branch**: `003-seat-holds`

**Created**: 2026-07-24

**Status**: Draft

**Input**: User description: "Seat holds & reservations for TixHub (feature 003) — the real-time
seat-holding layer between the read-only catalog (002) and checkout (004). Covers UC-11 and the
reservation lifecycle: hold an available seat (login required, no anonymous holds), concurrency-safe
so two buyers never get the same seat (DATA-02), 7-minute configurable TTL auto-release incl. on
disconnect (REL-02), Socket.IO live map (PERF-03/06), GA quantity holds via reserved_quantity,
reservations + reservation_items (migration 0003), hold-spam rate limit. Out of scope: orders,
wallet, tickets, QR, payment (004)."

## Clarifications

### Session 2026-07-24

- Q: Can one user hold seats in more than one reservation for the **same** showtime at once? → A:
  **No — exactly one active reservation per (user, showtime).** A user holds as many seats as they like
  (up to the cap) but always **within a single reservation** = one checkout. They cannot run two
  simultaneous held selections for the same showtime, and 004 converts one reservation into one order.
  A second device/tab on the same showtime joins that same active reservation, it does not open a
  second one. Different showtimes (other dates/events) each get their own reservation.
- Q: How many tickets may one user hold at once, and does GA share the cap? → A: **One configurable cap,
  default 8, for both.** Seated counts held seats, GA counts reserved quantity — same number (8) applied
  to each, within the one active reservation for a showtime. Beyond it the hold is refused. This is the
  anti-hold-spam / anti-hoarding control (FR-016); the number is a setting, not hard-coded.
- Q: Does the hold window use one clock or one per seat, and does adding a seat extend it? → A: **One
  reservation-level clock, and the only extension is a one-time top-up grace.** The 7-minute window runs
  from the reservation's first hold; every seat shares that one expiry and they release together.
  Adding or removing a seat does **not** reset or extend it — otherwise a user could keep a map locked
  forever by adding a seat every few minutes. The single exception is FR-010: starting a wallet top-up
  for the held seats extends the window **once**, +7 min, capped at 14 min absolute. Each seat's
  hold-expiry mirrors the reservation's.
- Q: What happens if VNPay is slow/failing while the attendee tops up mid-hold — is that fair? → A: **A
  one-time bounded grace, not a freeze (FR-010).** A blanket "top-up never extends a hold" (the earlier
  schema D2 rule) is unfair when a genuine buyer is stuck on a slow gateway; a full freeze is
  exploitable (start a top-up, walk away, lock seats forever, with no clean end condition since the
  server cannot observe the user leaving VNPay). The bounded one-time +7 (ceiling 14) threads both:
  fair to the honest buyer, and an attacker gains at most the seat cap (8) × one grace. This **revises**
  schema D2 / Vision REL-02 — see follow-ups.
- Q: For general admission, does a hold pick specific seats? → A: **No.** GA holds are a **quantity**
  against a ticket tier, tracked by `reserved_quantity`; there are no per-seat rows. Seated events
  hold specific `showtime_seats`. A single reservation is for one showtime and is either seated or GA
  (never mixed), because a showtime is one or the other (002).
- Q: What happens to a held seat when the holder simply closes the tab? → A: **It is released by the
  TTL sweeper**, at most ~1 minute after `hold_expires_at`. The socket disconnect is a hint, not the
  source of truth — the database TTL is (REL-02, DATA-03).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Hold specific seats on a live map (Priority: P1)

A signed-in attendee opens a seated showtime's map, taps one or more available seats, and each seat
is immediately reserved for them for a few minutes so they can proceed to checkout without losing it —
and so no one else can take it in the meantime.

**Why this priority**: This is the core of the feature and TixHub's headline differentiator (Vision
§4.1). Without a concurrency-safe hold there is no safe purchase for a seated event: two buyers would
race for the same seat. Everything else (release, real-time broadcast, GA, reservations) exists to
support or generalise this.

**Independent Test**: As a signed-in user, open a seated showtime, tap an available seat, and confirm
it flips to *held by me* with a countdown; open the same showtime as a second user and confirm that
seat now reads *unavailable* and cannot be taken. Requires only feature 002's read-only map plus this
hold path.

**Acceptance Scenarios**:

1. **Given** a signed-in attendee viewing a seated showtime with available seats, **When** they select
   an available seat, **Then** the seat becomes held for them, shows a remaining-time countdown, and
   is included in an active reservation.
2. **Given** two attendees selecting the **same** available seat at the same instant, **When** both
   requests are processed, **Then** exactly one succeeds and the other is refused with "seat just
   taken", and the seat is held by exactly one of them — never both.
3. **Given** a seat already held by another attendee or already sold, **When** an attendee tries to
   select it, **Then** the selection is refused and the map shows the current true status.
4. **Given** an attendee holding one or more seats, **When** they deselect a held seat, **Then** that
   seat returns to available for everyone and is removed from their reservation.
5. **Given** a guest (not signed in) viewing a seat map, **When** they try to select a seat, **Then**
   they are prompted to sign in and no hold is created until they do (holds require an owner).

---

### User Story 2 - Holds expire on their own (Priority: P1)

A held seat that is not carried through to purchase is returned to inventory automatically after a
short window, even if the attendee closed the browser, so seats are never locked away forever.

**Why this priority**: A hold with no expiry is a permanent leak — one abandoned checkout would remove
a seat from sale for good. Auto-release is what makes holding safe to offer at all, and it is the
guarantee waitlists and re-selling depend on. It ships with US1.

**Independent Test**: Hold a seat, note its expiry, disconnect the client, and confirm the seat
returns to available within ~1 minute of the expiry without any client action; confirm a second
attendee can then hold it.

**Acceptance Scenarios**:

1. **Given** a held seat whose hold window has passed, **When** the release sweep runs, **Then** the
   seat returns to available and its reservation is marked expired, at most ~1 minute after expiry.
2. **Given** an attendee who closes their browser while holding seats, **When** the window passes,
   **Then** the seats are released without any client action — the disconnect does not need to be
   observed for release to happen.
3. **Given** an attendee actively holding seats, **When** they are still within the window, **Then**
   their seats stay held and their countdown reflects the true remaining time.
4. **Given** a released hold, **When** the original holder returns and tries to continue, **Then** they
   are told the hold expired and are returned to seat selection; nothing they held is silently still
   theirs.
5. **Given** an attendee mid-checkout in feature 004 (later), **When** 003 releases an expired hold,
   **Then** the seat lifecycle stays `available → held → sold` with no payment-pending state — a hold
   is freed only by expiry or the owner, never by a gateway (DATA-03).

---

### User Story 3 - Everyone sees the map change live (Priority: P2)

While several people look at the same showtime, each person's map updates within about a second when
anyone holds, releases, or when a hold expires — so a buyer rarely reaches for a seat that is already
gone.

**Why this priority**: Correctness (US1) already prevents double-sell; live updates prevent the
*frustration* of clicking a seat that the database will reject. It sharply reduces failed selections
under load, which is the survey's #1 pain (Vision §3.1). It builds on US1 but the hold is still correct
without it, so it is P2.

**Independent Test**: Open the same showtime in two clients; hold a seat in one and confirm the other's
map shows that seat as unavailable within ~1 second without a manual refresh; release it and confirm it
returns to available live.

**Acceptance Scenarios**:

1. **Given** two or more attendees viewing one showtime, **When** one holds a seat, **Then** the others
   see that seat become unavailable within about one second, without refreshing.
2. **Given** viewers of a showtime, **When** a seat is released (deselect or expiry), **Then** they see
   it return to available within about one second.
3. **Given** an attendee whose live connection drops and reconnects, **When** they reconnect, **Then**
   their map re-syncs to the current true state and their own still-valid holds are shown correctly.
4. **Given** ~60 attendees on one showtime's map at once, **When** they hold and release seats, **Then**
   updates keep arriving within about a second and no viewer is shown a stale seat as available after
   it has been taken.

---

### User Story 4 - Reserve general-admission tickets by quantity (Priority: P2)

For a general-admission showtime (no seat map), a signed-in attendee reserves a number of tickets in a
tier, and that quantity is held for them for the same short window before checkout.

**Why this priority**: GA is half the catalog and its buyers need the same "don't lose it while I pay"
guarantee, but without the per-seat map. It reuses the reservation and TTL machinery from US1/US2, so
it follows them.

**Independent Test**: As a signed-in user on a GA showtime, reserve 2 of a tier with 5 remaining, and
confirm remaining drops to 3 for everyone; let it expire and confirm remaining returns to 5.

**Acceptance Scenarios**:

1. **Given** a GA tier with N tickets remaining, **When** an attendee reserves K (K ≤ N), **Then** the
   tier's remaining drops by K for all viewers and K tickets are held in the attendee's reservation.
2. **Given** a GA tier with N remaining, **When** an attendee tries to reserve more than N, **Then** the
   reservation is refused and remaining is unchanged.
3. **Given** two attendees reserving from the same tier at once, **When** the combined request exceeds
   remaining, **Then** the tier is never oversold: reservations succeed only up to remaining and the
   rest are refused.
4. **Given** a GA hold that expires, **When** the sweep runs, **Then** the reserved quantity returns to
   the tier's remaining automatically.

---

### User Story 5 - Manage an in-progress selection (Priority: P3)

An attendee builds up a selection over a minute or two — adding and removing seats or adjusting a GA
quantity — and the running total and remaining time reflect the change, until they either proceed or
let it lapse.

**Why this priority**: Adding/removing within one reservation is a convenience over "cancel and start
again". The MVP is usable without it (US1 already holds and deselects single seats), so it is P3.

**Independent Test**: Hold two seats, add a third, remove one, and confirm the reservation reflects
exactly the seats currently held and their total; cancel the reservation and confirm all its seats
release at once.

**Acceptance Scenarios**:

1. **Given** an attendee with an active reservation, **When** they add another available seat, **Then**
   it joins the same reservation (subject to the per-user cap) and its total updates.
2. **Given** an attendee with an active reservation, **When** they remove a seat, **Then** that seat
   releases for everyone and the reservation keeps the rest.
3. **Given** an attendee with an active reservation, **When** they cancel it, **Then** every seat (or GA
   quantity) it held releases at once and the reservation is marked cancelled.
4. **Given** an attendee who reaches the per-user hold cap, **When** they try to add one more seat,
   **Then** it is refused with a clear reason and their existing holds are untouched.

---

### Edge Cases

- **Hold on a seat that expired a moment ago**: if a seat's hold lapsed but the sweep has not run yet,
  a new hold attempt still succeeds because status is re-checked at hold time (FR-003) — a `held` row
  past its expiry is treated as available.
- **Deselect a seat whose hold already expired**: treated as a no-op success; the seat is already free.
- **Two requests from the same user for the same seat** (double-tap): the second is idempotent — the
  seat is already held by them, no error, no duplicate reservation item.
- **Showtime becomes unavailable** (organizer cancels, admin removes the event, or the showtime starts)
  while a hold is active: new holds are refused; existing holds are released on the next sweep and the
  attendee is told the showtime is no longer on sale.
- **Reserving 0 or a negative quantity** (GA) or an empty seat list: refused as invalid.
- **A seat that belongs to a different showtime** than the reservation: refused.
- **Holding a `blocked` seat** (organizer-blocked, not for sale): refused — only `available` seats can
  be held.
- **Per-user cap reached across two tabs**: the cap counts all of the user's active held seats for the
  showtime, so a second tab cannot be used to exceed it.
- **Reconnect after the whole reservation expired**: the map shows the seats as available (someone else
  may already hold them); the attendee starts a fresh selection.
- **Sweeper runs while a seat is being converted to sold** (feature 004): conversion is serialized
  against release on the same seat (FR-003), so the sweep can never release a seat that a committing
  purchase already owns.
- **Clock/timezone**: expiry is an absolute instant stored server-side; the client countdown is display
  only and never authoritative.
- **Top-up grace already used, then a second top-up**: the second top-up does not extend the window
  again; the reservation still expires at its ceiling (14 min), and if the buyer is still not funded the
  seats release (money stays in the wallet).
- **Grace requested past the ceiling**: a top-up started after 14 min from creation cannot revive an
  already-expired (or about-to-expire-at-ceiling) reservation; the attendee reselects, money is safe.

## Requirements *(mandatory)*

### Functional Requirements

**Holding (seated)**

- **FR-001**: System MUST allow only a signed-in attendee to hold a seat; a hold MUST record its owner,
  and no seat may be `held` without an owner (no anonymous holds).
- **FR-002**: System MUST hold only an `available` seat, transitioning it to `held` with an owner and an
  expiry instant; it MUST refuse to hold a seat that is `held`, `sold`, or `blocked`.
- **FR-003**: System MUST serialize concurrent hold attempts on the same seat so that **exactly one**
  succeeds and the rest are refused — two attendees can never both hold, or be sold, the same seat.
- **FR-004**: System MUST let the owner of a held seat release it, returning it to `available` for
  everyone; releasing a seat the caller does not own MUST be refused.
- **FR-005**: System MUST treat re-holding a seat the caller already holds as an idempotent success (no
  duplicate hold, no error).

**Expiry & release**

- **FR-006**: System MUST auto-release a reservation and all seats it holds after a configurable
  time-to-live (default 7 minutes) measured from **when the reservation was created** (its first hold),
  returning every seat to `available`. A reservation has one expiry instant that governs all its seats —
  a seat's own hold-expiry mirrors the reservation's, so the whole selection expires together, never
  seat-by-seat. The window is otherwise **fixed**: adding or removing a seat MUST NOT extend it. The
  **only** extension is the one-time top-up grace in FR-010.
- **FR-007**: System MUST release expired holds **without requiring the client to be connected** — an
  attendee who closed the browser MUST NOT keep a seat past its expiry. Release MUST occur within about
  one minute of expiry.
- **FR-008**: System MUST mark a reservation whose holds have all lapsed as expired, and MUST NOT leave
  a seat `held` past its expiry once the release sweep has run.
- **FR-009**: A seat's only release triggers are the owner releasing it and expiry; there MUST be no
  payment-window or gateway-driven release (the seat lifecycle is `available → held → sold` only).
- **FR-010**: When an attendee starts a wallet top-up from checkout for the seats they are holding
  (the top-up carries the `reservationId`, UC-40), the system MUST extend that reservation's window
  **exactly once**, by a configurable grace (default +7 minutes), up to an **absolute ceiling**
  (default 14 minutes from reservation creation). A second top-up MUST NOT extend it again, and the
  window MUST NEVER exceed the ceiling. Past the ceiling the seats release normally and any money
  already topped up stays in the wallet. A top-up MUST NOT otherwise freeze or pause a hold. This one
  bounded grace is the fairness allowance for a slow or failing VNPay detour; it is abuse-bounded by
  the seat cap (FR-016) and the one-time ceiling, so it cannot be used to lock seats indefinitely.

**Reservations**

- **FR-011**: System MUST group an attendee's current holds for one showtime into a **reservation** with
  a status of active, expired, converted, or cancelled, and an expiry instant. There MUST be **at most
  one active reservation per (attendee, showtime)** at any time; a further hold on the same showtime
  joins that same active reservation rather than opening a second one.
- **FR-012**: A reservation MUST be for exactly one showtime and MUST be either seated (specific seats)
  or general-admission (tier quantities), never a mix.
- **FR-013**: System MUST let an attendee add an available seat to, or remove a held seat from, their
  **active** reservation; changes MUST NOT be allowed once a reservation is expired, cancelled, or
  converted.
- **FR-014**: System MUST let an attendee cancel an active reservation, releasing every seat or GA
  quantity it holds at once.
- **FR-015**: System MUST expose, for an active reservation, the seats/quantity it holds, its running
  total in whole đồng, and its expiry instant.

**Abuse resistance**

- **FR-016**: System MUST cap the number of tickets one attendee may hold at once in their single active
  reservation for a showtime (configurable, default 8) and refuse holds beyond the cap, so no one can
  lock a whole map — or a whole tier's stock — for free. The cap counts **seats** for a seated
  reservation and **reserved quantity** for a general-admission reservation: one number, default 8,
  applied to both. It is an upper bound; a tier's remaining stock (FR-019) is the independent lower one.
- **FR-017**: System MUST rate-limit hold/release requests per attendee to resist rapid hold-spam,
  without blocking a normal selection pace.

**General admission (quantity)**

- **FR-018**: System MUST let a signed-in attendee reserve a quantity of a general-admission tier,
  reducing that tier's remaining (capacity − sold − reserved) by the reserved amount for all viewers.
- **FR-019**: System MUST never let reserved + sold exceed a tier's capacity — concurrent GA
  reservations MUST be serialized so a tier is never oversold.
- **FR-020**: System MUST restore a GA reservation's quantity to the tier's remaining when the hold is
  released or expires, on the same TTL rules as seated holds.

**Real-time**

- **FR-021**: System MUST broadcast a seat's or tier's new availability to everyone currently viewing
  that showtime when a hold is placed, released, or expires, so their map reflects the change without a
  manual refresh, within about one second.
- **FR-022**: System MUST let a viewer re-sync the full, current map state on (re)connect, and MUST show
  a returning owner their own still-valid holds correctly.
- **FR-023**: Live updates MUST be advisory: the database remains the source of truth, so a client that
  missed an update and attempts a stale seat is still correctly refused by FR-003.

**Access & integrity**

- **FR-024**: System MUST enforce hold/release/reservation actions on the server for the authenticated
  identity; the client MUST NOT be able to hold on behalf of another user or assert its own identity.
- **FR-025**: System MUST keep the read-only seat-map and availability views from feature 002 working;
  this feature only transitions seat status and tier reserved counts, it does not change how the map is
  read.
- **FR-026**: All monetary amounts surfaced by a reservation (e.g. running total) MUST be whole
  Vietnamese đồng integers.

### Key Entities *(include if feature involves data)*

- **Reservation**: an attendee's in-progress checkout session for one showtime — who owns it, which
  showtime, its status (active / expired / converted / cancelled), and when it expires. Holds the seats
  or the GA quantity currently reserved. Created when the attendee first holds; ended by conversion
  (feature 004), cancellation, or expiry. Not yet an order and involves no money.
- **Reservation Item**: one line within a reservation — either a specific held seat (seated) or a tier
  plus a quantity (GA) — with the unit price captured at hold time. The seated item points at the
  showtime seat it holds.
- **Showtime Seat (held state)**: the bookable seat instance from feature 002, whose status this feature
  transitions `available → held` (and back), carrying the current holder and the hold's expiry while
  held. Feature 004 later takes it `held → sold`.
- **Tier reserved quantity**: for general admission, the count of tickets currently held (not yet sold)
  in a tier, so remaining = capacity − sold − reserved is always truthful.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Under concurrent attempts on a single seat, exactly one hold succeeds and no seat is ever
  held or sold to two people — verified by a parallel-buyers test that asserts a single winner.
- **SC-002**: A held seat left untouched is returned to inventory automatically within one minute of its
  expiry, including when the holding client has disconnected — verified by a hold-then-disconnect test.
- **SC-003**: When one viewer holds or releases a seat, other viewers of the same showtime see the change
  within 1 second at the 95th percentile.
- **SC-004**: A single showtime map sustains at least 60 concurrent viewers holding and releasing seats
  with updates still arriving within about a second and zero double-sell.
- **SC-005**: A general-admission tier is never oversold: across concurrent reservations, reserved + sold
  never exceeds capacity — verified by a concurrent-reservation test.
- **SC-006**: No attendee can hold more than the configured seat cap for one showtime, even using
  multiple tabs — verified by a cap test that attempts to exceed it.
- **SC-007**: A guest is never able to place a hold; every hold in the system has an owner — verified by
  an unauthenticated hold attempt that is refused.
- **SC-008**: Every refusal scenario above (seat taken, cap reached, oversell, guest, not-owner) has an
  automated test asserting the refusal, not only the happy path.
- **SC-009**: Critical hold logic reaches the constitution's ≥ 60% automated coverage bar for the
  seat-holding module, with explicit concurrency and expiry tests (MAIN-03).

## Assumptions

- **Feature 002 is the substrate.** Venues, seats, showtimes, ticket tiers, and `showtime_seats` already
  exist and are read-only there; this feature adds the reservation tables and the write path that
  transitions seat status. The reference schema's `reservations`, `reservation_items`, and the "Seat
  Concurrency Requirement" section are authoritative.
- **Order conversion belongs to feature 004.** Taking a reservation `active → converted` and its seats
  `held → sold` inside one ACID transaction, plus the wallet debit and ticket issuance, is defined and
  built by 004. This feature only guarantees the hold invariants 004 will lock against; a reservation
  that is never converted simply expires, and because no money exists yet there is nothing to roll back.
- **Login is provided by feature 001.** The signed-in identity that owns a hold is the account from 001;
  this feature consumes it and never accepts a client-supplied user id.
- **TTL default is 7 minutes, configurable** (Vision REL-02), and the per-user seat cap default is 8;
  both are settings an admin can adjust (later, UC-36), not hard-coded constants.
- **The release sweep runs about once a minute.** Expiry is exact (an absolute instant); the sweep is the
  mechanism that acts on it, so "released within ~1 minute of expiry" is the guarantee, not instant
  release.
- **Vietnamese** is the user-facing language and **VND integer** the only currency, consistent with the
  rest of the product.
- **The interactive hold surface is the SeatLayout screen** (two-screen flow). The EventDetail page
  keeps its read-only preview map (feature 002); the "Tiếp tục chọn ghế" action — already the sign-in
  gate — leads to SeatLayout, which this feature turns from a `Math.sin` mock into the real,
  hold-backed map where each click places a hold. The reservation id created there is carried into
  checkout so feature 004 can convert it (and trigger the FR-010 grace on a top-up).

## Follow-ups (docs to amend for consistency)

These outer docs were written before the one-time top-up grace (FR-010) was decided and MUST be
reconciled when this feature lands:

- **DONE (2026-07-24)** — **Schema `docs/Analysis_Design/SCHEMA_DATABASE.md`**: decision **D2** now
  carries a dated amendment for the bounded one-time grace; `reservations.extended_once` +
  `uq_reservation_active` are in the SQL; the "Seat Concurrency Requirement" section is rewritten for
  hold-on-select, the one reservation clock, the 8-ticket cap, and the GA `reserved_quantity` path.
- **DONE (2026-07-24)** — **Vision `docs/Requirements/.../VisionDocument.md`**: REL-02 states the
  one-time grace (7 → max 14 min) as the single exception; DATA-02 now covers concurrent *holds* and
  GA oversell; DATA-03 and the §4.1 diagram match (holds are REST, the socket only broadcasts);
  Feature 11 names the cap and GA quantity holds.
- **DONE (2026-07-24)** — **Use cases `docs/Analysis_Design/Group02_UseCaseSpecification.md`**: UC-11
  rewritten (hold-on-select, one reservation per showtime, cap A7, GA A8, idempotent A9, withdrawn
  showtime A10); UC-12 A2 and UC-40 step 4 / A6 / A8 carry the grace; UC-36 lists TTL, grace, and cap
  as admin settings.
- **OPEN** — **Constitution**: a one-line dated amendment note refining D2 (team-approval style, as
  with v2.0.0). Not written here — a constitution change needs team approval, not a doc edit.

## Dependencies

- **Feature 001 (Account & Authentication)** — DONE. Provides the signed-in identity that owns a hold
  and the server-authoritative identity rule.
- **Feature 002 (Event Catalog & Discovery)** — DONE. Provides `showtime_seats`, ticket tiers, showtimes,
  and the read-only seat-map/availability views this feature transitions.
- **Feature 004 (Wallet & Checkout)** — DOWNSTREAM, not built here. Converts a reservation into a paid
  order (`held → sold`, wallet debit, tickets). This feature is its precondition and defines the
  invariants it relies on (no double-hold, TTL release, active-reservation check under lock).
- **Reference documents**: `docs/Analysis_Design/SCHEMA_DATABASE.md` (reservations, reservation_items,
  showtime_seats, and the "Seat Concurrency Requirement" section) is authoritative for the schema and
  the two-layer locking strategy; `docs/Analysis_Design/Group02_UseCaseSpecification.md` UC-11 is
  authoritative for the seat-selection flow; Vision §6 (DATA-02, REL-02, PERF-03/06, SCAL-01) is
  authoritative for the non-functional targets.
