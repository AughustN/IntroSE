# Feature Specification: Organizer Event Studio

**Feature Branch**: `006-organizer-studio`

**Created**: 2026-08-05

**Status**: Draft

**Input**: User description: "Organizer event studio for TixHub (feature 006) — completes the
organizer's event-authoring surface on top of the catalog (002). Covers UC-26 in full, the UC-23
integrity guards, the UC-24 A6 moderation hole, and UC-22. Depends on 001 and 002 only; independent
of checkout (004) and of the seat-map designer (005), which owns all seat-map geometry and lifecycle.
In scope: full ticket-tier lifecycle on a showtime (add, rename, reprice, change GA capacity, remove)
with whole-VND integer prices, ≤ 4 tiers per showtime, capacity never below sold + reserved, archive
instead of delete once sold, and manual capacity refused on a seated showtime; event/showtime editing
guards that refuse any change contradicting sold or held inventory; re-moderation on material edit as
a P1 security requirement; the UC-22 AI listing assistant, assistive and non-blocking, rate-limited
and cached; and growing OrganizerPanel into a real Vietnamese console (events → event → showtimes →
tiers) with loading, empty, and error states as first-class. Out of scope: seat-map drawing, upload,
and editing lifecycle (005); orders, tickets, wallets, check-ins, revenue (007); admin-side
moderation actions (002, unchanged)."

## Clarifications

### Session 2026-08-05

- Q: Which edits count as **material** for the UC-24 A6 re-moderation rule — the four fields A6 names,
  or something wider? → A: **A narrow exemption list, not an enumerated material list.** Every
  organizer-initiated change to an **approved** event is material and returns it to `pending_review`,
  **except** pure-inventory changes: a general-admission capacity adjustment, and (from 005) blocking
  or unblocking an individual seat. Rationale: A6 exists because an enumerated list is exactly what
  leaves a hole — a moderator who approved a listing approved its title, its description, its image,
  its tier labels, its prices, and its dates, and any of those is a vector for approving an empty shell
  and editing it into something else. Inventory count is the only organizer-editable value that cannot
  misrepresent the event to a buyer, so it is the only exemption. This **widens** UC-24 A6 (which names
  title, description, pricing, showtimes) rather than narrowing it — see follow-ups.

- Q: When a material edit pulls an approved, on-sale event back to `pending_review`, what happens to
  seats and quantities already **held** by buyers, and to tickets already **sold**? → A: **Neither is
  touched. Re-review removes the event from discovery, not from inventory.** Live reservations keep
  their seats and their captured prices and can still be carried to checkout (004); sold tickets stay
  valid. Only the public catalog, search, and event page stop showing the event until an admin
  re-approves. Rationale: a moderation state is a statement about the *listing*, not a cancellation —
  releasing live holds because an organizer fixed a typo would punish buyers for someone else's edit,
  and voiding sold tickets is UC-25's job with refunds attached, never a side effect of an edit.
  Nothing about a re-review is destructive, which is what makes it safe to apply automatically.

- Q: When an organizer's edit pulls an approved, live event out of the public catalog, is that recorded
  permanently? → A: **Yes — actor, timestamp, and the names of the changed fields**, written immutably like
  the moderation actions in 002 (SEC-09). Values are deliberately not captured: field names are what turn a
  re-review from re-reading the whole listing into checking one diff, while storing before/after values would
  duplicate content the event already holds and grow the audit table without adding review value. Recording
  only that "an edit happened" would leave the moderator no better off than the reason string already does.
  This is the trail that makes an approve-then-edit abuse attributable after the fact.

- Q: A tier with sold tickets is archived rather than deleted — does an archived tier still count
  against the 4-tier-per-showtime limit? → A: **No. The limit counts active tiers only.** An organizer
  who retires a sold-out "Early bird" must be able to put a replacement in its place; if archives
  counted, a showtime could reach a state where no tier can ever be added again. Archived tiers stay on
  the showtime indefinitely so existing orders and tickets still resolve their label and price, but they
  are invisible to buyers and unpurchasable.

- Q: Can an archived tier be brought back, or is archiving permanent? → A: **Restorable, but only while
  the showtime has fewer than 4 active tiers, and restoring is a material edit.** Archiving is the only
  way to retire a tier that has sales (FR-006), so making it terminal would mean one wrong click
  permanently kills a price class the organizer may still be selling — the same dead end US1 exists to
  remove. It is a shelf, not a delete. The four-active-tier check is re-evaluated at restore time so a
  restore can never carry a showtime past the layout rule, and because a restore puts a price back in
  front of buyers it returns an approved event for review like any other content change (FR-021).

- Q: What are "sold" and "reserved" for a **seated** tier, where capacity is NULL? → A: **Sold = the
  count of that tier's `showtime_seats` in status `sold`; reserved = the count in status `held`.** For
  general admission they are the tier's own `sold_quantity` and `reserved_quantity` counters. The
  capacity floor (FR-004) is therefore meaningful for both, even though only general admission has a
  writable capacity number — for seated, capacity is the seat count, and it is feature 005's seat rules
  that guard it, not a capacity field this feature exposes.

- Q: Can an organizer delete one of their own events outright? → A: **Only an event that has never been
  approved, has nothing sold or held, and has not been flagged or removed by an admin.** Unpublishing already
  covers "take it down" and UC-25 covers "cancel and refund", so deletion is genuinely useful only for
  clearing out an abandoned draft. The moderation-history condition is the important half: without it,
  deletion becomes a way to launder a rejection — erase the removed event, re-submit a clean copy, and the
  takedown that feature 002 deliberately preserves is gone. A deletion is refused in that case, not softened.

- Q: Can an organizer move a showtime to a different venue? → A: **Only while that showtime has sold
  nothing and holds nothing, and only if it has no bookable seat map.** A buyer bought a place as much
  as a date, so relocating a showtime with any committed inventory is refused outright. A seated
  showtime with a generated map has snapshotted a layout belonging to the old venue; re-pointing it is a
  seat-map lifecycle operation owned by feature 005 (its re-apply flow), not an edit this feature
  performs.

- Q: Where is the AI listing assistant available — creating an event only, or editing one too? → A:
  **Creating, and editing a `draft` or `pending_review` event; refused on an approved, on-sale event.** That
  covers every case UC-22's precondition ("creating/editing an event") makes useful, while keeping off the
  table the one combination that is both risky and pointless: redrafting a listing that is already live and
  selling. Allowing it there would let an organizer knock their own event out of the public catalog (FR-021)
  with a click they never thought of as an edit, and a machine-written rewrite is the last thing a
  moderator-approved, actively-selling listing needs.

- Q: Does a cache hit consume the AI assistant's per-user hourly allowance? → A: **No.** The cache is
  consulted before either the per-user allowance or platform quota. A cache hit makes no upstream call and
  therefore consumes no model-backed request allowance. Only a request that is about to call the provider
  increments the counters; this is the shared policy for UC-10 and UC-22.

- Q: How long does a cached suggestion stay reusable? → A: **24 hours, configurable.** Long enough that an
  organizer drafting a listing across a working day never spends a second upstream call on the same inputs —
  which is what protects the ~100–250 calls/day shared free-tier ceiling (SCAL-02) — and long enough to make
  the repeat-request test deterministic, while short enough that the same idea revisited a week later gets a
  fresh draft. Without a number, SC-014 was untestable.

- Q: Is the AI assistant allowed to state facts about a TixHub event? → A: **Only facts it was given.**
  The assistant sees the organizer's own rough inputs and platform data about the organizer's own draft;
  it may polish that into prose, and its price suggestion must be derived from platform data on
  comparable published events (same category, same city) — never from model memory. It MUST NOT
  introduce a lineup, a date, a venue, a capacity, or a price it was not handed. Nothing it produces
  reaches the event until the organizer accepts it, so a hallucination is a bad draft, never a published
  falsehood (Principle III, ADR-0001).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Manage a showtime's ticket types and capacity (Priority: P1)

An organizer opens one of their showtimes and works on its ticket tiers over time: adds a tier they
forgot, fixes a misspelled name, adjusts a price before sales open, raises the capacity of a
general-admission tier that is selling well, and retires one that is no longer offered — without having
to delete and rebuild the showtime.

**Why this priority**: This is UC-26 and the largest gap in the product today. Tiers can currently be
created exactly once, inside the showtime-creation call, and never touched again; an organizer who
mistypes a price has no route back except abandoning the showtime. Every other story in this feature
edits something; this one is the thing most often edited.

**Independent Test**: On a showtime created with one tier, add a second tier, rename it, change its
price, raise its capacity, and confirm each change is reflected in the organizer console and on the
public event page. Requires only feature 002's showtimes and tiers.

**Acceptance Scenarios**:

1. **Given** a showtime with fewer than four active tiers, **When** the organizer adds a tier with a
   name and a whole-đồng price, **Then** it is created on that showtime and offered to buyers (subject
   to the event's moderation state).
2. **Given** a showtime that already has four active tiers, **When** the organizer adds a fifth, **Then**
   it is refused with a reason naming the four-tier limit, and the existing tiers are unchanged.
3. **Given** a tier with no sales and no holds, **When** the organizer renames it or changes its price to
   another non-negative whole đồng, **Then** the change is saved and buyers see the new label and price.
4. **Given** a general-admission tier with capacity 100, 12 sold and 3 held, **When** the organizer sets
   capacity to 20, **Then** it succeeds; **When** they set it to 10, **Then** it is refused with a reason
   naming 12 sold and 3 held, and the capacity stays 100.
5. **Given** a tier of a **seated** showtime, **When** the organizer submits a capacity number, **Then**
   it is refused: capacity is derived from the seat map and is not manually editable (UC-26 A4).
6. **Given** a tier that has sold at least one ticket, **When** the organizer removes it, **Then** it is
   **archived** — buyers can no longer purchase it, it stops counting toward the four-tier limit, and
   every existing ticket and order still resolves its label and price — and it is never deleted.
7. **Given** a tier with no sales and no live holds that is not the showtime's last active tier, **When**
   the organizer removes it, **Then** it is deleted outright.
8. **Given** a price submitted as a fraction, a negative number, or a non-number, **When** the organizer
   saves, **Then** it is refused and nothing changes (whole-đồng integers only, STD-03).
9. **Given** an archived tier on a showtime with fewer than four active tiers, **When** the organizer
   restores it, **Then** it is purchasable again and counts toward the four-tier limit once more;
   **Given** the showtime already has four active tiers, **When** they restore it, **Then** it is refused
   with a reason naming the limit and the tier stays archived.

---

### User Story 2 - Edit an event without breaking what is already sold (Priority: P1)

An organizer changes more than the four text fields the product allows today — reschedules a showtime,
moves one to a different venue, removes a showtime added by mistake — and every change that would
contradict tickets already sold or seats currently held is refused with a specific reason instead of
being applied and quietly corrupting a buyer's reservation.

**Why this priority**: This is UC-23 with its A2 guard, and it is the safety half of US1. Opening the
edit surface without the guards would be worse than leaving it closed: an organizer could move a
showtime into the past, relocate an event a hundred people already bought tickets to, or delete a
showtime out from under live reservations. The guards are what make the wider edit surface shippable.

**Independent Test**: Create a showtime, sell and hold nothing, and confirm it can be rescheduled,
relocated, and deleted. Then place a hold on a second showtime and confirm the same three operations are
each refused with a reason naming the live inventory, and that the hold is still intact afterwards.

**Acceptance Scenarios**:

1. **Given** a future showtime with nothing sold and nothing held, **When** the organizer moves it to
   another future date and time, **Then** it is saved and the new time shows everywhere the old one did.
2. **Given** a showtime, **When** the organizer moves it to a time in the past, **Then** it is refused.
3. **Given** a showtime that has already started, finished, or been cancelled, **When** the organizer
   tries to reschedule, relocate, or delete it, **Then** it is refused.
4. **Given** a showtime with at least one sold ticket, **When** the organizer deletes it, **Then** it is
   refused with a reason naming the sold tickets; cancelling an event with refunds is a separate,
   out-of-scope action (UC-25).
5. **Given** a showtime with at least one live hold, **When** the organizer deletes or relocates it,
   **Then** it is refused, and the holding buyer's reservation, seats, and expiry are unchanged.
6. **Given** a showtime with nothing sold, nothing held, and no bookable seat map, **When** the organizer
   reassigns it to another venue they own, **Then** it is saved.
7. **Given** a seated showtime that already has a bookable seat map, **When** the organizer reassigns its
   venue, **Then** it is refused and the organizer is pointed at the seat-map designer (005).
8. **Given** a venue the organizer does not own, **When** they assign a showtime to it, **Then** it is
   refused.
9. **Given** a draft event that was never approved, with nothing sold or held, **When** the organizer deletes
   it, **Then** it is removed; **Given** an event that was approved at some point, or has inventory, or that
   an admin flagged or removed, **When** they delete it, **Then** it is refused with the blocking condition
   named — a takedown cannot be erased by the organizer it was applied to.

---

### User Story 3 - A material edit goes back for review (Priority: P1)

An event that an admin approved and that is on sale is edited by its organizer. The moment the edit
lands, the event returns to `pending_review` and disappears from the public catalog, search, and its
public page, staying invisible to buyers until an admin approves it again — while every ticket already
sold and every seat currently held is left exactly as it was.

**Why this priority**: This is UC-24 A6, and it is a **security** requirement, not a convenience. Feature
002 built a pre-publish moderation gate; without this rule that gate is bypassable end to end today —
submit an innocuous empty shell, wait for approval, then edit it into whatever you actually wanted to
publish, with no moderator ever seeing the result. A gate that can be walked around is not a gate.
Everything else in this feature widens the organizer's edit surface, which widens that hole; this story
closes it in the same release.

**Independent Test**: Get an event approved and on sale, confirm it appears in the public catalog, edit
its title, and confirm that from the very next request it is gone from the catalog, search, and its
public page, that its moderation state reads `pending_review` with a reason, and that it reappears only
after an admin re-approves it.

**Acceptance Scenarios**:

1. **Given** an approved, on-sale event visible in the public catalog, **When** its organizer changes the
   title, description, image, a tier label, or a tier price, **Then** the event's moderation state becomes
   `pending_review` and it is no longer publicly visible from the next request onward.
2. **Given** the same event, **When** its organizer adds, reschedules, relocates, or removes a showtime,
   **Then** the same return-to-review happens.
3. **Given** the same event, **When** its organizer changes only a general-admission tier's capacity,
   **Then** the event stays approved and publicly visible — inventory count is the one exemption.
4. **Given** an event returned to review this way, **Then** it stays visible to its own organizer and in
   the admin review queue, carrying a reason that says it was returned because it was edited, and **When**
   an admin approves it, **Then** it becomes public again.
5. **Given** an approved, on-sale event with live holds and sold tickets, **When** a material edit returns
   it to review, **Then** no hold is released, no reservation expiry changes, no ticket is voided, and a
   buyer already holding seats can still complete checkout.
6. **Given** an event that is a draft, or already `pending_review`, `flagged`, or `removed`, **When** its
   organizer edits it, **Then** its moderation state is left as it is — only an approved event is returned
   to review, and only an admin moves an event out of `flagged` or `removed`.
7. **Given** an edit that is refused (US1/US2 guards), **When** the refusal happens, **Then** the
   moderation state does **not** change — a rejected edit must not be able to pull a live event from the
   catalog.

---

### User Story 4 - A console that scales past one screen (Priority: P2)

An organizer with several events works from a console that has depth: a list of their events, then one
event, then its showtimes, then a showtime's tiers with what has actually been sold and held on each — in
Vietnamese, with a visible loading state while data arrives, an explicit empty state when there is nothing
yet, and a readable reason when something is refused.

**Why this priority**: The rules in US1–US3 are only usable if the organizer can see the numbers behind
them — a refusal that says "capacity is below what is committed" is meaningless on a screen that never
showed sold and held counts. The current panel is a single flat screen with one create form per resource.
It is P2 because the server rules are correct and testable without it, but the feature is not deliverable
to a real organizer without it.

**Independent Test**: Sign in as an organizer with two events, navigate list → event → showtimes → tiers,
and confirm each level shows its own loading, empty, and error states, that sold/held/remaining appear per
tier, and that a refused edit shows the server's specific Vietnamese reason rather than a generic failure.

**Acceptance Scenarios**:

1. **Given** an organizer with no events, **When** they open the console, **Then** they see an explicit
   empty state inviting them to create one — not a blank panel and not a spinner that never resolves.
2. **Given** data still loading at any level, **When** the organizer is waiting, **Then** a loading state
   is shown and the rest of the console stays interactive.
3. **Given** a showtime, **When** the organizer opens its tiers, **Then** each tier shows its label, its
   whole-đồng price, and its sold, held, and remaining counts (or, for a seated showtime, that its
   capacity comes from the seat map).
4. **Given** any refused action, **When** the refusal returns, **Then** the specific Vietnamese reason is
   shown against the thing that was refused, and the organizer's unsaved input is not discarded.
5. **Given** an approved, on-sale event, **When** the organizer starts a material edit, **Then** they are
   told before confirming that saving will return the event for review and remove it from the public
   catalog until re-approved.
6. **Given** a request that fails on the network or the server, **When** it fails, **Then** an error state
   is shown with a way to retry, and the console does not silently show stale data as current.

---

### User Story 5 - AI drafts the listing (Priority: P3)

An organizer with a rough idea — a topic, a few keywords, maybe a price they have in mind — asks the
assistant for help and gets suggested titles, a polished Vietnamese description, tags, and a suggested
price. They take the description, rewrite half of it, ignore the titles, and type their own price. Nothing
reaches the event until they accept it, and if the assistant is slow, broken, or out of quota they simply
fill the form in themselves and never find out.

**Why this priority**: UC-22 is a differentiator the survey rates a bonus, not a decider (Vision §3.1), and
the constitution makes it explicitly subordinate: assistive, never autonomous, never on a critical path.
Everything in US1–US4 must work with the assistant switched off entirely. It ships last.

**Independent Test**: With the assistant enabled, submit rough inputs and confirm suggestions appear and
are individually editable and rejectable before anything enters the form. Then force a timeout and confirm
the form still works as plain manual entry with no blocking error.

**Acceptance Scenarios**:

1. **Given** an organizer entering rough inputs, **When** they ask for suggestions, **Then** they receive
   suggested titles, a description draft, tags, and a whole-đồng suggested price, none of which is written
   to the event.
2. **Given** a set of suggestions, **When** the organizer accepts one field and edits it, **Then** only
   what they accepted (as they edited it) enters the form; rejecting everything leaves the form untouched
   (UC-22 A5).
3. **Given** an identical request the organizer already made recently, **When** they ask again, **Then**
   the previous suggestion is served without another upstream call (SCAL-02).
4. **Given** an organizer who has already made 10 requests within the hour, **When** they make an 11th,
   **Then** it is refused with a plain "try again later" notice, and the form remains fully usable (SEC-08,
   UC-22 A2).
5. **Given** the assistant takes longer than about 8 seconds, errors, or the platform-wide quota is
   exhausted, **When** the organizer asked for suggestions, **Then** the panel falls back to plain manual
   entry with a non-blocking notice and no error that stops the organizer (PERF-05, SCAL-03, UC-22 A3/A4).
6. **Given** the assistant is generating, **When** the organizer keeps typing, **Then** the console stays
   interactive and no save, publish, or tier edit is blocked by the in-flight call.
7. **Given** any suggestion, **When** it names a fact about a TixHub event — a date, a venue, a price, a
   capacity — **Then** that fact came from the organizer's own inputs or from platform data, never from the
   model's memory.
8. **Given** an event that is approved and on sale, **When** the organizer opens it to edit, **Then** the
   assistant is not offered and a direct request for suggestions is refused; **Given** a draft or an event
   awaiting review, **When** they open it to edit, **Then** the assistant is available as it is on create.

---

### Edge Cases

- **Capacity lowered while a buyer is mid-hold**: the check is evaluated against live sold + reserved under
  the same row lock feature 003 uses, so either the hold wins and the capacity change is refused, or the
  capacity change lands first and the hold is refused — never a state where sold + reserved exceeds capacity.
- **Capacity set to exactly sold + reserved**: allowed. The floor is inclusive; remaining becomes 0 and the
  tier simply stops selling.
- **Capacity lowered on a tier whose holds expire a second later**: refused at the moment it was asked, on
  the state that was true then. The organizer retries after expiry; nothing is queued.
- **Removing a tier that has live holds but no sales**: refused — reserved quantity is live hold state owned
  by feature 003, and deleting the tier under it would corrupt a reservation. It can be archived instead,
  which stops new purchases while letting the existing holds convert.
- **Removing the last active tier of a showtime**: refused while the event is on sale, because publish
  requires at least one upcoming showtime with at least one tier (002, FR-017); a showtime with no way to
  buy is not a showtime.
- **Repricing a tier a buyer is currently holding**: the hold keeps the unit price captured when it was
  placed (003); the new price applies to holds placed after the change. A buyer is never repriced
  mid-checkout.
- **Archiving a tier that is a seated showtime's price class**: refused while any of its `showtime_seats`
  are still bookable — those seats would have no price class. Reassigning seats to another tier is the
  seat-map designer's job (005).
- **Renaming a tier to the same name as another tier on the same showtime**: allowed but flagged in the UI
  as confusing; labels are display text, not identifiers.
- **A price of 0**: allowed — a free tier is a real thing. Negative is refused.
- **Editing an event owned by another organizer** (guessed id, replayed request): refused as not found or
  not owner, never partially applied, and never returned in any list.
- **Two of the organizer's own tabs editing the same tier**: last write wins on independent fields; both
  writes are individually re-checked against live sold + reserved, so neither can breach the floor.
- **A material edit that changes nothing** (the same title submitted again): treated as a change and returns
  the event for review, because deciding that "nothing meaningfully changed" is exactly the judgment that
  belongs to a moderator, not to a diff.
- **Material edit while the event is already `pending_review`**: no state change; it is already queued.
- **Material edit to a `flagged` or `removed` event**: the moderation state is left alone. An organizer
  cannot use an edit to escape a takedown, and cannot use one to re-enter the queue behind an admin's back —
  the admin owns those two states (002).
- **An edit refused after the moderation state was already written**: cannot happen; the edit and the
  return-to-review commit together or not at all.
- **AI asked for suggestions about someone else's event**: the assistant only ever sees the caller's own
  inputs and their own draft; there is no path by which another organizer's data enters a prompt.
- **AI returns a price with decimals or a currency symbol**: normalized to a whole-đồng integer before it is
  shown, or the price suggestion is dropped; a malformed suggestion never blocks the rest.
- **AI returns nothing usable**: treated as the timeout case — silent fallback to manual entry.
- **Rate limit hit on the last request of the hour**: the window is per user and rolling; the organizer is
  told when they can try again, and manual entry never stops working.

## Requirements *(mandatory)*

### Functional Requirements

**Ticket tiers & capacity (UC-26)**

- **FR-001**: System MUST let an organizer add a ticket tier to an existing showtime they own, with a label
  and a price, without recreating the showtime.
- **FR-002**: System MUST limit a showtime to at most **4 active** ticket tiers and refuse a further add
  with a reason naming the limit. Archived tiers (FR-006) MUST NOT count toward this limit.
- **FR-003**: System MUST let an organizer change an existing tier's label and price, and MUST accept a
  price only as a **non-negative whole Vietnamese đồng integer** (STD-03); a fractional, negative, or
  non-numeric price MUST be refused with nothing changed.
- **FR-004**: System MUST refuse to set a tier's capacity below its **sold + reserved** count, naming both
  numbers in the refusal. The check MUST be evaluated against live state under the same row lock feature 003
  takes on the tier, so a concurrent hold can never leave sold + reserved above capacity.
- **FR-005**: System MUST refuse a manual capacity value on a tier of a **seated** showtime: capacity there
  is derived from the showtime's seat map (UC-26 A4) and is owned by feature 005.
- **FR-006**: System MUST **archive**, never delete, a tier that has at least one sold ticket. An archived
  tier MUST be unpurchasable and hidden from buyers, MUST remain resolvable so existing orders and tickets
  still show their label and price, and MUST NOT count toward FR-002's limit. Archiving MUST be
  **reversible**: an organizer MUST be able to restore an archived tier to active, and the System MUST
  refuse the restore when the showtime already has 4 active tiers, naming the limit. A restore MUST be
  treated as a material edit under FR-021.
- **FR-007**: System MUST allow outright deletion of a tier only when it has no sold tickets, no live holds,
  and no bookable seats assigned to it, and only when it is not the last active tier of a showtime belonging
  to an on-sale event.
- **FR-008**: System MUST refuse deletion of a tier that has live holds, because reserved quantity is hold
  state owned by feature 003; archiving MUST remain available instead.
- **FR-009**: System MUST report, per tier, its capacity (or that capacity is seat-map-derived), its sold
  count, its held count, and its remaining count, so an organizer can see the numbers a refusal refers to
  before triggering it.
- **FR-010**: System MUST keep existing reservations priced at the amount captured when they were placed; a
  repricing MUST apply only to holds placed after it.

**Event & showtime editing (UC-23)**

- **FR-011**: System MUST let an organizer edit their own event beyond the four fields available today, and
  MUST validate every input against a strict schema before use (SEC-07).
- **FR-012**: System MUST let an organizer reschedule a showtime they own to another **future** time, and
  MUST refuse a time in the past.
- **FR-013**: System MUST refuse any reschedule, relocation, or deletion of a showtime that has already
  started, or that is finished or cancelled.
- **FR-014**: System MUST refuse deletion of a showtime that has any sold ticket, naming the sold tickets;
  voiding tickets with refunds is UC-25 and out of scope here.
- **FR-015**: System MUST refuse deletion or relocation of a showtime that has any live hold, and MUST leave
  every affected reservation — its items, its seats, and its expiry — completely unchanged.
- **FR-016**: System MUST allow relocating a showtime to another venue **owned by the same organizer** only
  when the showtime has nothing sold, nothing held, and no bookable seat map; a seated showtime with a map
  MUST be refused and pointed at feature 005's re-apply flow.
- **FR-017**: System MUST refuse assigning a showtime to a venue the caller does not own.
- **FR-018**: Every refusal in FR-004 through FR-017 MUST carry a **specific** machine-readable reason and a
  Vietnamese message naming what blocked it — never a generic failure and never a silent partial application.
- **FR-019**: An edit that is refused MUST leave the event, its showtimes, its tiers, and its moderation
  state exactly as they were.
- **FR-020**: System MUST allow an organizer to delete one of their own events only when **all** hold: it has
  never been approved, no showtime of it has any sold ticket or live hold, and its moderation state is
  neither `flagged` nor `removed`. Any other deletion MUST be refused, naming which condition blocked it —
  an admin's takedown MUST NOT be erasable by its subject, and taking a live event down remains unpublish
  (002) or cancellation with refunds (UC-25, out of scope).

**Re-moderation on material edit (UC-24 A6)**

- **FR-021**: When an organizer changes anything on an event whose moderation state is `approved`, the System
  MUST set that event's moderation state to `pending_review`. The **only** exempt changes are pure-inventory
  ones: a general-admission tier's capacity, and feature 005's per-seat block/unblock.
- **FR-022**: An event returned to review under FR-021 MUST cease to be publicly visible — absent from the
  catalog, from search, and from its public page — from the next request onward, with visibility still
  evaluated live per request and never cached onto the row (002, FR-029).
- **FR-023**: The edit and the return-to-review MUST commit **atomically**: there MUST be no observable
  moment in which the edited content is public under the old approval.
- **FR-024**: A return to review MUST NOT release any hold, alter any reservation or its expiry, void any
  ticket, cancel any order, or change the event's on-sale (`status`) lifecycle state. It removes the listing
  from discovery only.
- **FR-025**: An event returned to review MUST stay visible to its owning organizer and MUST appear in the
  admin review queue carrying a reason stating it was returned because it was edited. The System MUST leave
  `draft`, `pending_review`, `flagged`, and `removed` events' moderation states unchanged on edit — only an
  admin moves an event out of `flagged` or `removed` (002).
- **FR-026**: Every edit that returns an event to review MUST write an **immutable** audit record naming the
  acting organizer, the instant, the event, and the **names** of the fields that changed (values are not
  recorded). The record MUST be readable by an admin re-reviewing the event, and MUST NOT be editable or
  deletable by the organizer who caused it.

**AI listing assistant (UC-22)**

- **FR-027**: System MUST let a signed-in organizer submit rough inputs and receive suggested titles, a
  description draft, tags, and a suggested whole-đồng price. The assistant MUST be available while creating
  an event and while editing one that is still a `draft` or is awaiting review (`pending_review`), and MUST
  be refused on an event that is both `approved` and on sale.
- **FR-028**: No suggestion may reach the event by itself. Each suggested field MUST be individually
  editable, acceptable, and rejectable by the organizer before it enters the form, and rejecting everything
  MUST leave the form untouched (Principle III; UC-22 A5).
- **FR-029**: The assistant MUST NOT sit on any critical path: creating, editing, and publishing an event and
  every tier and showtime operation above MUST work identically with the assistant disabled, failing, or out
  of quota.
- **FR-030**: On timeout (~8 s), upstream error, or platform-wide quota exhaustion, the System MUST degrade
  to plain manual entry with a non-blocking notice and MUST NOT surface a failure that stops the organizer
  (PERF-05, SCAL-03).
- **FR-031**: System MUST rate-limit **model-backed** assistant requests to **10 per hour per authenticated
  user**. A cache hit is served before allowance consumption and does not count; a request that would call
  the provider consumes one allowance unit and excess requests receive a plain "try again later" response
  that leaves manual entry working (SEC-08).
- **FR-032**: System MUST cache suggestions so an identical request within the cache window — **24 hours by
  default, configurable** — is served without a further upstream call (SCAL-02).
- **FR-033**: Every factual claim a suggestion makes about a TixHub event MUST come from the organizer's own
  inputs or from platform data — including the price suggestion, which MUST be derived from comparable
  published events rather than model memory (Principle III, ADR-0001). A prompt MUST never carry another
  organizer's data.
- **FR-034**: The assistant MUST use the shared `AIProvider` abstraction and an approved provider
  configuration; this feature MUST NOT introduce an unapproved external integration or bypass the shared
  grounding, quota, timeout, and fallback rules.

**Access control & integrity**

- **FR-035**: Every endpoint in this feature MUST require an authenticated, approved organizer and MUST scope
  to the calling organizer **on the server** (SEC-04). Another organizer's event, showtime, or tier MUST be a
  refusal, never a row the client could unfilter.
- **FR-036**: Ownership MUST be asserted on the resource actually being written — a tier's owner is resolved
  through its showtime and event, not taken from the request.
- **FR-037**: The client MUST NOT be able to assert its own identity or organizer id; the server-injected
  session identity is authoritative.
- **FR-038**: All monetary values crossing this feature's boundary MUST be whole Vietnamese đồng integers,
  stored and displayed (STD-03).

**Organizer console**

- **FR-039**: The console MUST present the organizer's work at four levels — their events, one event, that
  event's showtimes, and a showtime's tiers — rather than one flat screen.
- **FR-040**: Loading, empty, and error states MUST be first-class at every level, in Vietnamese (Principle
  VI, USE-03); an error MUST offer a retry and MUST NOT leave stale data presented as current.
- **FR-041**: Every server refusal MUST be surfaced against the control that caused it, in Vietnamese, with
  the specific reason, and MUST NOT discard the organizer's unsaved input.
- **FR-042**: Before an edit that would return an approved event for review, the console MUST tell the
  organizer that saving removes the event from the public catalog until an admin re-approves it.

### Key Entities *(include if feature involves data)*

- **Ticket tier (managed)**: a price class within one showtime — label, whole-đồng price, capacity (general
  admission only; NULL and seat-map-derived for seated), plus the live sold and reserved counts that feature
  003 and checkout maintain. This feature adds a lifecycle to it: active or **archived**, where archived means
  retained-but-unsellable and not counted toward the four-tier limit. The two states are reversible in both
  directions — archiving is a shelf, not a delete — with the four-active-tier limit re-checked on the way back.
- **Showtime (editable)**: a dated instance of an event at a venue. This feature makes its start time, venue
  assignment, and existence editable, each gated on the sold and held inventory it carries.
- **Event (moderated)**: gains an explicit rule connecting an organizer edit to its moderation state — an
  approved event edited by its organizer returns to `pending_review` with a reason, and its on-sale lifecycle
  state is untouched.
- **Material edit**: the classification that decides whether a change returns an event for review. Defined by
  exemption: everything except a general-admission capacity change and a per-seat block/unblock.
- **Edit audit record**: the immutable trail behind a return to review — the acting organizer, the instant,
  the event, and the names of the fields that changed. Written by the organizer's own edit rather than by an
  admin action, and readable by an admin re-reviewing the event. It records field names only, never values.
- **Listing suggestion**: a candidate set of title, description, tag, and price drafts, per organizer request.
  It is never authoritative and is never persisted onto an event — only what the organizer accepts and edits is.
- **Assistant usage**: what the fairness and quota controls count — a rolling per-user hourly request count
  (SEC-08) and a cache entry keyed by the normalized request (SCAL-02).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An organizer can correct a mistyped tier price on an existing showtime in under 30 seconds
  without deleting or recreating anything — today this is impossible at any cost.
- **SC-002**: No tier's capacity can be set below its sold + reserved count, under concurrent holds —
  verified by a test that lowers capacity while a hold is being placed and asserts that exactly one of the
  two succeeds and that sold + reserved never exceeds capacity.
- **SC-003**: A tier with sold tickets is never deleted; after the organizer removes it, every previously
  sold ticket still resolves its label and price — verified by an archive test.
- **SC-004**: No showtime carries more than four purchasable tiers at any time, and an organizer who archives
  one can still add a replacement — verified by a fifth-tier refusal test and an archive-then-add test. The
  limit holds on the way back too: restoring an archived tier onto a showtime that already has four active
  ones is refused — verified by a restore-refusal test.
- **SC-005**: A seated showtime never accepts a manually entered capacity — verified by a refusal test.
- **SC-006**: 100% of edits that contradict sold or held inventory are refused with a specific reason, and no
  reservation is altered by a refused edit — verified per guard (capacity below sold, capacity below
  reserved, delete tier with sales, delete tier with holds, delete showtime with sales, relocate showtime
  with holds, reschedule into the past, relocate a mapped seated showtime).
- **SC-007**: An event an admin flagged or removed cannot be deleted by its organizer, and neither can one
  that was ever approved or that holds inventory — verified by a deletion-refusal test per condition, so a
  takedown can never be laundered by delete-and-resubmit.
- **SC-008**: An approved, on-sale event edited by its organizer is absent from the public catalog, search,
  and its public page on the **very next request**, and returns only after an admin re-approves — verified end
  to end (approve → confirm public → edit → confirm gone → re-approve → confirm public).
- **SC-009**: The moderation gate cannot be bypassed by approve-then-edit: for every organizer-editable field
  except general-admission capacity, an edit to an approved event returns it to `pending_review` — verified
  by a per-field table test, so a newly added editable field that skips the rule fails CI.
- **SC-010**: A return to review changes no inventory: across a test with live holds and sold tickets, hold
  count, reservation expiries, and ticket count are identical before and after.
- **SC-011**: No organizer can read or write another organizer's event, showtime, or tier through any
  endpoint in this feature — verified by a cross-organizer test per endpoint asserting the refusal.
- **SC-012**: The 11th assistant request within an hour by one user is refused while manual entry keeps
  working — verified by a test firing 11 calls (SEC-08).
- **SC-013**: When the assistant times out at ~8 seconds, errors, or is out of quota, the organizer can still
  complete the listing manually with no blocking error — verified by a fault-injection test per failure mode
  (PERF-05, SCAL-03).
- **SC-014**: An identical assistant request within 24 hours is served without a further upstream call —
  verified by a repeat-request cache-hit test (SCAL-02).
- **SC-015**: Every refusal path in this feature has an automated test asserting the **denial**, not only the
  happy path — the eight guards in SC-006, the deletion conditions in SC-007, plus cross-organizer access,
  the restore limit, material edit forcing re-review, AI
  rate limit, and AI timeout (Principle IV).
- **SC-016**: An organizer reaches any of their showtimes' tiers within three interactions from the console's
  entry point, and every level shows a loading, empty, or error state rather than a blank region — verified by
  manual UX review against the four levels.
- **SC-017**: Every user-facing string added by this feature is Vietnamese (USE-03), and every refusal message
  names the specific blocking condition rather than a generic failure.
- **SC-018**: Every edit that returns an event to review leaves an immutable record naming the organizer, the
  instant, and the fields that changed, and an admin re-reviewing the event can see it — verified by an
  edit-then-read-audit test, plus a test asserting the organizer cannot alter or remove that record.

## Assumptions

- **Feature 002 is the substrate and stays authoritative for visibility.** Events, showtimes, ticket tiers,
  venues, the moderation states, and the live "public ⟺ on sale AND approved AND owner approved" rule already
  exist. This feature adds write paths and one transition into `pending_review`; it does not change how
  visibility is computed.
- **Feature 003 owns reserved quantity and held seats.** This feature only **reads** `reserved_quantity` and
  held `showtime_seats` as a floor it must not breach, and never writes them. The row-lock discipline it
  borrows for FR-004 is the one 003 already established.
- **Feature 005 owns all seat-map geometry and lifecycle.** Seat placement, blocking, layout re-apply, and the
  derivation of seated capacity live there. This feature refuses what belongs to 005 and points at it rather
  than reaching into it.
- **Feature 004 owns sold state.** "Sold" is read here (a tier's `sold_quantity`, or its `showtime_seats` in
  status `sold`) as a floor; nothing here writes it. Cancelling an event and refunding buyers is UC-25 and out
  of scope.
- **`ticket_tiers` gains an archive marker.** Archive-not-delete (FR-006) needs one nullable timestamp or
  status column on the tier, and the public catalog reads plus the buyer-facing remaining calculation must
  exclude archived tiers. This is the only schema change this feature requires.
- **The four-tier limit is a layout rule inherited from 002**, already enforced at showtime creation; it is
  not re-litigated here, only extended to the add and restore paths and scoped to active tiers.
- **The audit trail reuses the existing immutable audit record** that feature 001 introduced and 002's
  moderation actions already write to. FR-025 adds an organizer-initiated entry type to it; it does not
  introduce a second audit mechanism.
- **Notifying attendees of a material change (UC-19) is not built here.** UC-23's basic flow ends with
  notification; the notification feature is separate. This feature makes the change safe and records that it
  happened; sending the message is downstream.
- **The assistant's cache window (24 h) and its comparable-price window are settings, not constants**, so
  quota behaviour can be tuned without a code change (Principle V).
- **AI is reached through the shared `AIProvider` abstraction.** The deployed provider is an implementation
  detail governed by the architecture decision; no AI feature sits on a purchase path.
- **Vietnamese** is the user-facing language and **VND integers** the only currency, consistent with the rest
  of the product.

## Contract Impact

Under Principle VI these shapes are defined once and imported by both sides; the entries below are the
contract surface this feature changes, not an implementation plan.

- **New**: add a tier to a showtime; update a tier (label, price, capacity); remove a tier
  (delete-or-archive, decided by the server, with the outcome reported back); restore an archived tier;
  update a showtime (start time, venue); remove a showtime; delete an event; request listing suggestions.
- **Widened**: the event update accepts more than its current four fields; the organizer's showtimes view
  returns, per tier, capacity / sold / held / remaining / archived, and per showtime whether it has a bookable
  seat map.
- **Changed reads (002)**: every buyer-facing tier list and remaining calculation MUST exclude archived tiers.
  This is a behavioural change to an existing public read and needs its own test.
- **Errors**: one consistent error shape carrying a specific code per refusal — capacity below committed, tier
  has sales, tier has holds, tier limit reached, manual capacity on seated, last tier, showtime has sales,
  showtime has holds, showtime already started, venue not owned, seat map locks venue, event was approved,
  event under moderation, not owner, AI rate limited, AI unavailable on a live event — each with a
  Vietnamese message the console renders as-is.

## Dependencies

- **Feature 001 (Account & Authentication)** — DONE. Provides the signed-in identity, the approved-organizer
  capability, and the server-authoritative identity rule. `requireAuth` and `requireOrganizer` are reused
  as-is.
- **Feature 002 (Event Catalog & Discovery)** — DONE. Provides events, showtimes, ticket tiers, venues, the
  moderation states, the admin review queue, the live public-visibility rule, and the existing organizer
  ownership assertions this feature reuses. Its FR-015 ("organizer can add, edit, and remove showtimes and
  ticket tiers") is only partly built; this feature completes it.
- **Feature 003 (Seat Holds & Reservations)** — DONE, read-only here. Owns `reserved_quantity`, held seats,
  and the reservation lifecycle. This feature treats them as an inviolable floor.
- **Feature 005 (Seat Map Designer)** — PARALLEL, no overlap. Owns seat geometry, per-seat blocking, layouts,
  and seated capacity derivation. The two features meet only where this one refuses an operation and names 005
  as the place to do it.
- **Feature 004 (Wallet & Checkout)** — UPSTREAM of the sold counts read here; nothing in this feature writes
  order, ticket, or wallet state.
- **Feature 007 (organizer analytics / attendees / revenue)** — DOWNSTREAM, out of scope. Nothing here reads
  orders, tickets, wallets, check-ins, or revenue.
- **Reference documents**: `docs/Analysis_Design/Group02_UseCaseSpecification.md` UC-22, UC-23, UC-24 (A6),
  and UC-26 are authoritative for the flows; `docs/Analysis_Design/SCHEMA_DATABASE.md` (`events`, `showtimes`,
  `ticket_tiers`, and the Organizer API contract section) is authoritative for the schema and endpoint
  surface; Vision §6 (SEC-04, SEC-07, SEC-08, SCAL-02, SCAL-03, PERF-05, STD-03, USE-03) is authoritative for
  the non-functional targets; `CONTEXT.md` (On sale, Moderation status, Ticket tier) is authoritative for the
  vocabulary; constitution v2.0.0 governs the AI fence, the integration cap, and the testing bar.

## Follow-ups (docs to amend when this feature lands)

- **Use cases `docs/Analysis_Design/Group02_UseCaseSpecification.md`**: UC-24 **A6** currently names four
  material fields (title, description, pricing, showtimes); this feature inverts it to an exemption list
  (everything except general-admission capacity and per-seat block/unblock) — A6 must be rewritten to match,
  or the enumerated list reinstated as a deliberate decision. UC-26 **A3** says "blocks or archives"; pin it
  to **archives**. UC-26 should also gain the "a tier with live holds cannot be deleted" alternative flow,
  which the reservation model made real after UC-26 was written.
- **Schema `docs/Analysis_Design/SCHEMA_DATABASE.md`**: `ticket_tiers` gains its archive marker; the Organizer
  API contract section gains the tier write and restore endpoints, the showtime write endpoints, event
  deletion, and the listing-assistant endpoint, and its "Planned" list shrinks accordingly.
- **Use cases, UC-23**: the use case does not say whether an organizer may delete an event. FR-020 answers it
  (only an event never approved, with no inventory, not flagged or removed) specifically so a takedown cannot
  be laundered by delete-and-resubmit; UC-23 should carry that as an alternative flow.
- **`CONTEXT.md` glossary**: the **Ticket tier** entry should name the active/archived distinction and that
  archived tiers do not count toward the four-tier limit.
- **Vision Feature list**: the AI listing assistant's fallback wording should distinguish the two user-visible
  outcomes this spec separates — a per-user rate limit says "try again later" (SEC-08), while a timeout,
  error, or platform-wide quota exhaustion degrades silently to manual entry (PERF-05, SCAL-03).
