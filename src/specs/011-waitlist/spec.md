# Feature Specification: Waitlist for Sold-Out Tickets

**Feature Branch**: `011-waitlist`

**Created**: 2026-08-13

**Status**: Draft

**Input**: User description: "Waitlist cho vé hết chỗ (UC-17): người tham dự đã đăng nhập vào danh sách chờ của hạng vé đã bán hết, xem vị trí của mình, rời danh sách; khi có vé trở lại hệ thống thông báo cho những người vào sớm nhất; kèm trang thông báo trong ứng dụng để đọc waitlist_open. Sửa lỗi phạm vi kiểm tra tồn kho theo hạng vé, bổ sung chuyển trạng thái expired/converted, và dựng giao diện Join-waitlist trên trang chi tiết sự kiện."

Grounded in UC-17 (*Join waitlist*), UC-09 A2 (*Tier sold out*), UC-16 (*Cancel ticket*) and UC-19 (*Receive notifications*) of `docs/Analysis_Design/Group02_UseCaseSpecification.md`, and the Waitlist rules in `docs/Analysis_Design/SCHEMA_DATABASE.md`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Join the queue for a sold-out ticket type (Priority: P1)

An attendee finds the ticket type they want has nothing left. Rather than leaving and checking back, they ask to be told when tickets free up, confirm they understand nothing is being held for them, and see their place in the queue.

**Why this priority**: This is the whole point of a waitlist and the only story that creates anything. Every other story reads what this one writes, so nothing else in the feature is observable without it. On its own it already delivers value: an attendee who would otherwise refresh the page for days now waits to be told.

**Independent Test**: Sign in, open an event whose ticket type is sold out, use the waitlist control, confirm, and verify a place in the queue is recorded and shown.

**Acceptance Scenarios**:

1. **Given** a ticket type with nothing left on an upcoming event, **When** a signed-in attendee opens that event, **Then** the purchase control for that ticket type is replaced by a way to join the queue, and the reason it cannot be bought is stated.
2. **Given** the queue control, **When** the attendee uses it, **Then** they are asked to confirm before anything is recorded, and the confirmation states plainly that no ticket is reserved for them.
3. **Given** the confirmation, **When** the attendee accepts, **Then** their place is recorded with the time they joined and their position in the queue is shown to them.
4. **Given** an event where **one** ticket type is sold out and another still sells, **When** the attendee opens it, **Then** the sold-out type offers the queue and the other type remains purchasable.
5. **Given** a visitor who is not signed in, **When** they use the queue control, **Then** they are asked to sign in and return to the same event afterwards.
6. **Given** an event occasion that has already begun or been cancelled, **When** joining is attempted, **Then** it is refused and the reason is stated.

---

### User Story 2 - Be told when tickets come back (Priority: P1)

An attendee waiting in a queue is told, without doing anything, that tickets are available again — and can read that message inside the product, not only in their email.

**Why this priority**: A place in a queue that never produces a message is worthless, and messages already being generated that nobody can read are worse than none. This is the pay-off of the entire feature.

**Independent Test**: Put an account in a queue, cause a ticket to be returned for that occasion, and verify the account receives a message it can open, which leads to the event.

**Acceptance Scenarios**:

1. **Given** an attendee in a queue, **When** tickets become available for what they are waiting on, **Then** a message is recorded for them saying tickets are available again and that nothing is held for them.
2. **Given** an account with messages, **When** the attendee opens their message list, **Then** the messages are listed newest first, with unread ones clearly distinguishable from read ones.
3. **Given** unread messages, **When** the attendee is anywhere in the product, **Then** the number of unread messages is visible from the main navigation without opening the list.
4. **Given** a waitlist message, **When** the attendee opens it, **Then** it leads to the event it concerns and counts as read from then on.
5. **Given** a queue holding more than five people for one ticket type, **When** tickets become available, **Then** only the five who joined earliest are told.
6. **Given** an attendee who was told and did not manage to buy, **When** tickets become available again, **Then** they are told again and their original place in the queue is unchanged.

---

### User Story 3 - Leave the queue (Priority: P2)

An attendee who has changed their mind — bought elsewhere, made other plans — takes themselves out of the queue.

**Why this priority**: Valuable but not required for the queue to work. It matters because a queue nobody can leave keeps sending messages about an event the person has moved on from, and because each queue has only ten places, one of which they would be occupying for nothing.

**Independent Test**: Join a queue, leave it, and verify the place is gone and a later release of tickets sends nothing to that account.

**Acceptance Scenarios**:

1. **Given** an attendee holding a place in a queue, **When** they open that event, **Then** their position is shown together with a way to leave.
2. **Given** the leave control, **When** the attendee uses it, **Then** their place is removed and the ticket type offers joining again.
3. **Given** an attendee who has left, **When** tickets later become available, **Then** they are not told.
4. **Given** a place in a queue belonging to somebody else, **When** an attendee attempts to remove it, **Then** the attempt is refused.
5. **Given** people queued behind somebody who leaves, **When** that place is removed, **Then** each of them moves up one position.

---

### User Story 4 - The queue obeys its own rules (Priority: P1)

The queue is capped, ordered by when people joined, free of duplicates, and closes itself when it can no longer serve anybody.

**Why this priority**: These rules are what make a "position" mean anything. Without them the cap is decoration, latecomers can overtake, and queues for finished events accumulate forever.

**Independent Test**: Fill a queue to its cap, attempt one more join, attempt a duplicate join, then let the occasion begin and confirm the remaining places close.

**Acceptance Scenarios**:

1. **Given** a queue already holding ten places, **When** an eleventh attendee tries to join, **Then** the attempt is refused and the limit is explained.
2. **Given** an attendee already in a queue, **When** they try to join the same one again, **Then** no second place is created and their existing position is shown.
3. **Given** a ticket type that still has tickets, **When** an attendee tries to queue for it, **Then** the attempt is refused and they are directed to buy instead.
4. **Given** an attendee queueing for the occasion as a whole rather than one ticket type, **When** **any** ticket type of that occasion still sells, **Then** the attempt is refused.
5. **Given** places in a queue, **When** the occasion begins, **Then** those places close and no further message is sent for them.
6. **Given** an attendee in a queue, **When** they buy a ticket of the type they were waiting for, **Then** their place closes as fulfilled and stops occupying one of the ten.

---

### Edge Cases

- Two attendees claim the last free place at the same instant: exactly one is recorded and the other is told the queue is full — never both admitted, never both refused.
- Tickets come back between the page being drawn and the attendee pressing join: the attempt is refused and the attendee is pointed at buying, because the page they were reading was already out of date.
- One ticket is returned while five people are told: all five are told plainly that nothing is held for them, and four of them will find it gone. This is the intended behaviour, not a defect.
- The organizer cancels the occasion while people wait: the places close and no availability message is sent.
- An attendee has both a place in a queue and a ticket held in an unfinished purchase: joining was only permitted because nothing was available, so the two never contradict each other.
- The message list is empty: it says so in plain words rather than showing an empty frame.
- An attendee waits on several occasions of the same event: each queue is separate, and each reports its own position.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A signed-in attendee MUST be able to join the queue for a **sold-out ticket type** of an upcoming, non-cancelled event occasion.
- **FR-002**: Availability MUST be judged at the exact scope being joined — queueing for one ticket type requires **that type** to be exhausted, and queueing for the occasion as a whole requires **every** ticket type of it to be exhausted. A sold-out ticket type MUST remain joinable while other types of the same occasion still sell.
- **FR-003**: Each queue MUST hold at most **ten** open places; a further attempt is refused with the limit stated.
- **FR-004**: An attendee MUST hold at most one place per queue; repeating the request MUST return their existing place rather than creating a second.
- **FR-005**: The system MUST report an attendee their **position**, counted among open places in that queue in the order people joined.
- **FR-006**: An attendee MUST be able to remove their own place, and MUST NOT be able to remove anybody else's.
- **FR-007**: When tickets become available for an occasion, the system MUST tell the earliest-joined waiters — at most **five per ticket type** — that tickets are available.
- **FR-008**: Being told MUST reserve nothing. The attendee buys through the ordinary purchase flow and may find the tickets already gone.
- **FR-009**: An attendee who is told and does not buy MUST keep their place and their original priority for the next time tickets free up.
- **FR-010**: Places MUST close automatically when they can no longer be served — when the occasion begins — and when they have been served, meaning the holder bought what they were waiting for.
- **FR-011**: The event page MUST show, for each sold-out ticket type, either the way to join the queue or — for an attendee already in it — their position and the way to leave.
- **FR-012**: An attendee MUST be able to read their messages inside the product, see how many are unread from the main navigation, and have a message count as read once opened.
- **FR-013**: Every queue action MUST require a signed-in attendee and MUST be authorised where the data lives, not merely by hiding a control on screen.
- **FR-014**: Refusals MUST state which rule was applied — queue full, tickets still available, not signed in, occasion unavailable — rather than a generic failure.

### Key Entities

- **Queue place** — one attendee waiting on one event occasion, optionally narrowed to one ticket type. Carries when they joined, which fixes their order; whether it is still open, has been told of availability, has been served, or has closed unserved; and when they were last told. Being told does not end it.
- **Message** — something the product has to say to one attendee, of which "tickets are available again" is one kind. Carries what it is about, whether it has been read, and enough context to lead back to the event it concerns.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An attendee can go from seeing a sold-out ticket type to holding a recorded place in its queue in **one confirmation**, without leaving the event page.
- **SC-002**: When a ticket is returned for a waited-on occasion, every waiter entitled to be told has a readable message **within fifteen minutes**, with no manual step by staff.
- **SC-003**: No queue ever holds more than ten open places and no release tells more than five people per ticket type — including when several people join at the same instant.
- **SC-004**: **Zero** cases where a sold-out ticket type refuses a join because a different ticket type of the same occasion still has stock.
- **SC-005**: 100% of "tickets are available" messages are readable by their recipient inside the product and lead to the event they concern.
- **SC-006**: An attendee who leaves a queue receives no further messages about it, and every remaining waiter's reported position is correct immediately afterwards.
- **SC-007**: The rules that make the queue fair — the limit of ten, the five told per release, the join order, ownership of a place, and the closing of served and unservable places — are each covered by automated checks that assert the refusal as well as the success.

## Assumptions

- Message delivery reuses the product's existing messaging: no new channel, provider, or delivery schedule is introduced, and the email half behaves for these messages as it already does for purchase confirmations and reminders.
- "Sold out" for a numbered-seat ticket type means no seat of that type is free; for an open-admission type it means the sold and held quantities have reached its capacity. A ticket type with no capacity limit is never sold out.
- A queue belongs to one occasion (one date and time) of an event, as the existing data records it. An attendee interested in several occasions joins each separately.
- Tickets become available again only from the two sources the product already has — a ticket cancelled by its holder, and a reservation abandoned or timed out. There is no other release path, so queues go quiet in the final twenty-four hours before an occasion, when cancellation is no longer offered.
- Closing places whose occasion has begun may lag by up to the product's normal background-processing interval; this is invisible to attendees because no message is sent for a begun occasion regardless.
- **Out of scope**: any organizer-facing view of who is waiting or how many; manual release of tickets to a queue by an organizer; and any priority rule other than the order people joined.
