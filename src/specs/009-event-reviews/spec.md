# Feature Specification: Event Reviews & Ratings

**Feature Branch**: `009-event-reviews`
**Created**: 2026-08-11
**Status**: Draft
**Input**: User description: "Tính năng đánh giá & bình luận sự kiện (reviews & ratings). Người mua vé đã thanh toán và vé chưa bị void có thể chấm sao và viết nhận xét; người khác đọc được trên trang chi tiết sự kiện." Grounded in UC-18 (*Rate & review event*) and UC-39 (*Report event or review*) of `docs/Analysis_Design/Group02_UseCaseSpecification.md`.

## Context

TixHub shows an aggregated rating in its event-detail design (UC-09 step 2 already reads "aggregated rating `[UC-18]`") but nothing produces one: no review is ever written, so the figure has no source. This feature supplies it.

The reporting half already has its foundation. `content_reports` exists with `target_type` constrained to `'event' | 'review'` and feeds the admin moderation queue built in feature 004 — the schema anticipated reviews before they existed. Reporting a review therefore reuses that path rather than inventing a second one.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Rate and review a purchased event (Priority: P1)

An attendee with a paid, non-void ticket opens the event, gives it one to five stars, optionally writes what they thought, and sees their review appear on the event.

**Why this priority**: This is UC-18's basic flow and the only thing that creates the data every other story reads. Nothing else in the feature is observable without it.

**Independent Test**: Sign in as an attendee with a paid, non-void ticket, open the event, submit four stars and a sentence, and verify the review appears on the event with the attendee's name and the aggregate updates.

**Acceptance Scenarios**:

1. **Given** an attendee holding a paid ticket for an event, started or not, **When** they open that event, **Then** a control to write a review is offered.
2. **Given** the review form, **When** they choose a star value and submit, **Then** the review is stored and shown, and the event's average rating and review count update to include it.
3. **Given** the review form, **When** they submit without choosing a star value, **Then** submission is refused and the reason is stated.
4. **Given** review text containing markup such as `<script>` or `<b>`, **When** it is displayed anywhere, **Then** it appears as literal characters and no markup is interpreted.
5. **Given** a review of up to the accepted length, **When** it is submitted, **Then** it is stored whole; beyond that length submission is refused before anything is stored.

### User Story 2 - Read what other attendees said (Priority: P1)

Anyone looking at an event — signed in or not — sees its average rating, how many people rated it, and the reviews themselves.

**Why this priority**: Reviews exist to inform the next buyer. A review nobody can read is a write-only feature.

**Independent Test**: Open an event with several reviews while signed out and verify the average, the count, and the review list are all visible.

**Acceptance Scenarios**:

1. **Given** an event with reviews, **When** any visitor opens it, **Then** the average rating, the number of ratings, and the list of reviews are shown without signing in.
2. **Given** an event with no reviews, **When** it is opened, **Then** it says so plainly rather than showing a zero-star rating.
3. **Given** more reviews than fit one screen, **When** the visitor reaches the end of the shown reviews, **Then** more can be loaded without leaving the page.
4. **Given** a list of reviews, **When** it is displayed, **Then** the most recent appear first.
5. **Given** a review whose author has since deleted their account, **When** the review is displayed, **Then** it remains readable and is attributed to a withdrawn account rather than disappearing or naming nobody.

### User Story 3 - Change or withdraw your review (Priority: P2)

An attendee who already reviewed an event can edit what they wrote or take it down.

**Why this priority**: UC-18 A2 requires editing rather than duplicating. Withdrawal matters because a review is a person's published opinion about a named business.

**Independent Test**: Comment on an event, then open the comment's own menu and confirm it offers editing and deletion; edit it and confirm the content changed and the average followed the new star value.

**Acceptance Scenarios**:

1. **Given** an attendee who has already commented on an event, **When** they open it again, **Then** the box is offered again for a further comment, and their existing one is edited from its own menu rather than by writing over it.
2. **Given** an edited review, **When** it is saved, **Then** the event's average reflects the new star value and the review shows that it was edited.
3. **Given** an attendee's own review, **When** they delete it, **Then** it disappears from the event and the average and count are recalculated without it.
4. **Given** somebody else's review, **When** an attendee attempts to edit or delete it, **Then** the attempt is refused.

### User Story 4 - Only ticket holders may review (Priority: P1)

Someone who did not buy a ticket cannot rate the event, whether through the interface or by any other means.

**Why this priority**: A rating anybody can post is worth nothing to the reader and is a vector for organizers to inflate their own events. Constitution Principle II puts this on the server, not in the interface.

**Independent Test**: With an account holding no paid ticket for an event, confirm the review control is absent and that a direct submission is refused.

**Acceptance Scenarios**:

1. **Given** a signed-in attendee with no ticket for the event, **When** they open it, **Then** no review control is offered, nothing explains its absence, and a direct submission is refused.
2. **Given** an attendee holding a ticket for an event that has not started yet, **When** they review it, **Then** it is accepted like any other.
3. **Given** an attendee whose ticket was refunded or cancelled, **When** they try to review, **Then** the attempt is refused.
4. **Given** a visitor who is not signed in, **When** they try to submit a review, **Then** the attempt is refused.

### User Story 5 - Report a review that should not be there (Priority: P2)

A reader who finds a review abusive, fake or off-topic reports it, and an admin sees it in the existing moderation queue.

**Why this priority**: UC-39 covers reviews explicitly and the moderation queue already accepts them. Published user text without a reporting route is a liability.

**Independent Test**: Report a review, then sign in as an admin and confirm it appears in the moderation queue and can be removed.

**Acceptance Scenarios**:

1. **Given** a displayed review, **When** a signed-in reader reports it with a reason, **Then** the report is recorded and acknowledged.
2. **Given** a review this reader already reported, **When** they report it again, **Then** they are told it is already reported and no duplicate is created.
3. **Given** a reported review, **When** an admin removes it, **Then** it disappears from the event and stops counting toward the average.
4. **Given** a report, **When** an admin acts on it, **Then** the action is recorded in the immutable audit trail.

### Edge Cases

- An attendee holds paid, non-void tickets for several showtimes of the same event: they get one rating for the event, not one per showtime.
- An attendee reviews an event with a paid, non-void ticket and the event is later cancelled: the review stays, since it describes the listing and purchase experience.
- Every review of an event is removed by moderation: the event returns to showing no rating rather than a zero.
- Two devices submit a first review for the same attendee and event at the same instant: exactly one is stored.
- Review text is entirely whitespace: treated as no text at all, with the star rating standing alone.
- An organizer holds a paid, non-void ticket for their own event: out of scope for this feature; see Assumptions.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: An attendee MUST be able to give an event a whole-number rating from one to five stars, with optional accompanying text.
- **FR-002**: The system MUST refuse any review from someone who does not hold a paid ticket for that event, and MUST enforce this on the server independently of what the interface offers.
- **FR-003**: Eligibility MUST be established from the attendee's own paid ticket for that event, and a ticket that was refunded, cancelled or voided MUST NOT confer it. Turning up is not required; a no-show still paid and still has an opinion worth recording.
- **FR-003a**: A ticket holder MUST be able to review the event whether or not it has started. (Superseded on 2026-08-13 the earlier rule requiring the event to have started: a buyer forms a view of the listing, the price and the booking long before the night itself, and waiting muted the comments on exactly the events a prospective buyer is still deciding about.)
- **FR-004**: An attendee MUST have at most one *rating* per event: their first comment carries the stars, and every comment they write afterwards is text only. (Superseded on 2026-08-13 the earlier rule of one review per event, which upserted a second submission into the first and so silently overwrote what they had said. The scarce thing is the vote, not the right to speak.)
- **FR-004a**: An attendee MUST be able to post any number of comments on an event, and to reply to a comment. Replies MUST be one level deep — a reply aimed at a reply belongs to the comment they are both under — and MUST require the same paid ticket a comment does.
- **FR-004b**: Deleting a comment MUST delete the replies under it, which have no meaning without what they answer.
- **FR-005**: The author of a review MUST be able to edit its rating and text, and to delete it. Nobody else MUST be able to do either.
- **FR-006**: A star rating MUST be required; text alone MUST NOT be submittable.
- **FR-007**: Review text MUST be limited to a stated maximum length, and that limit MUST be enforced on the server.
- **FR-008**: All review text MUST be displayed as literal characters. No part of it may ever be interpreted as markup.
- **FR-009**: Each event MUST expose its average rating, its total number of ratings, and the count of ratings at each star value, derived from its live, non-removed **rated** comments — so the average counts people who came, never how often any of them wrote, and a divided audience is distinguishable from an indifferent one.
- **FR-009a**: An event's page MUST carry the rating summary and the newest few comments only; the full wall, and every control that writes to it, MUST live on the event's own comments page at `/events/:slug/reviews`. An unbounded list under the thing being sold pushes the showtimes and the lineup off the page.
- **FR-010**: An event with no reviews MUST be presented as unrated, never as rated zero.
- **FR-011**: Reviews MUST be readable by anyone who can see the event, including visitors who are not signed in.
- **FR-012**: Reviews MUST be listed most recent first and MUST be retrievable in pages, so an event with many reviews does not have to deliver all of them at once.
- **FR-013**: An edited review MUST be visibly marked as edited.
- **FR-014**: A signed-in reader MUST be able to report a review with a reason, exactly once per review, and that report MUST enter the existing admin moderation queue.
- **FR-015**: An admin MUST be able to remove a review. A removed review MUST stop appearing and MUST stop counting toward the aggregate, and the removal MUST be recorded in the audit trail.
- **FR-016**: Reviews MUST survive the deletion of their author's account in readable form, attributed to a withdrawn account.
- **FR-017**: Ratings and review counts MUST appear on the event-detail page alongside the existing event information.

### Key Entities

- **Review**: one attendee's verdict on one event — a star rating from one to five, optional text, when it was written, whether it has been edited, and whether moderation has removed it. Unique per attendee per event.
- **Event rating summary**: an event's average star rating and the number of ratings behind it, derived from its live reviews rather than stored independently of them.
- **Review report**: an existing concept. A reader, a target review, a reason, and a moderation status, recorded in the same queue that already handles reported events.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An attendee who holds a paid, non-void ticket for an event can publish a rating in under one minute from opening the event.
- **SC-002**: No review is ever stored for an account without a paid ticket to that event — verified by automated test, zero tolerance.
- **SC-003**: No account ever holds two ratings for one event, including when two submissions arrive simultaneously.
- **SC-004**: Text submitted with markup in it is rendered as literal characters in 100% of display locations.
- **SC-005**: An event's displayed average always equals the mean of its live reviews' ratings, including immediately after an edit, a deletion, or a moderation removal.
- **SC-006**: Reviews are visible to a signed-out visitor on every event that has them.
- **SC-007**: An event with two hundred reviews opens as quickly as one with none, from the reader's point of view.
- **SC-008**: A reported review reaches the admin queue and can be removed, with the removal recorded in the audit trail.
- **SC-009**: Automated statement coverage of the review module reaches at least 60%, matching the bar set for critical modules.
- **SC-010**: Type-check, lint, and the full test suite pass with zero errors.

## Assumptions

- **Eligibility is a paid, non-void ticket**, whether or not the showtime has started. This supersedes UC-18's former checked-in precondition and the interim started-event rule. Check-in is an operational door process and is not required for a purchase-based opinion; a purchase is a fact TixHub owns end to end, while a refunded, cancelled, or void ticket confers no eligibility.
- One review per attendee per **event**, not per showtime or per ticket, even when several tickets are held.
- Reviews are attributed to the attendee's display name and avatar, the same identity the rest of the product shows. Anonymous reviewing is out of scope.
- Organizers cannot reply to reviews in this feature. UC-18 does not describe a reply and the moderation path covers abuse; a reply thread is a separate feature.
- Ratings surface on the event only. UC-18 also mentions the organizer profile; there is no such page in the product, and adding one is explicitly deferred (decided 2026-08-11) rather than blocked — the aggregate is computed per event, so a profile page can sum those later without reworking anything here.
- No voting on reviews (helpful / not helpful), no photo attachments, no verified-purchase badge beyond the purchase eligibility rule that already gates writing.
- Removal by moderation hides a review and excludes it from the aggregate; it is not erased, so the moderation record keeps its subject.
