# Feature Specification: Admin Organizer & Event Moderation

**Feature Branch**: `004-admin-organizer-moderation`

**Created**: 2026-08-02

**Status**: Draft

**Input**: User description: "Tính năng 004-admin-organizer-moderation dựa trên UC-33 (Approve/Suspend Organizer) và UC-34 (Review & Moderate Events) trong file docs/Analysis_Design/Group02_UseCaseSpecification.md. Yêu cầu nghiệp vụ: duyệt đơn đăng ký Ban tổ chức; đình chỉ Ban tổ chức đang hoạt động và ẩn sự kiện của họ ngay lập tức; duyệt xuất bản sự kiện trước khi lên sàn; quản lý nội dung bị báo cáo, gỡ sự kiện vi phạm và hoàn tiền 100% về ví cho người mua; ghi log kiểm toán bất biến audit_logs [SEC-09] cho mọi thao tác."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Review organizer applications (Priority: P1)

An admin reviews applications from users who want organizer capability and approves or rejects each application with an optional reason. Approval lets the applicant create and submit events; rejection keeps them from organizer actions while allowing a corrected application later.

**Why this priority**: Organizer approval is the trust gate before anyone can sell events on the marketplace.

**Independent Test**: Submit one organizer application, approve it as an admin, and confirm organizer capability is available; reject another with a reason and confirm organizer capability is unavailable and the reason is visible to the applicant.

**Acceptance Scenarios**:

1. **Given** a pending organizer application, **When** an admin approves it, **Then** its status becomes `approved`, the applicant can use organizer capabilities on the next request, and the applicant is notified.
2. **Given** a pending organizer application, **When** an admin rejects it with a reason, **Then** its status becomes `rejected`, the applicant cannot use organizer capabilities, the reason is visible to them, and they can submit a corrected application later.
3. **Given** a request from a non-admin, **When** it attempts to approve or reject an application, **Then** the action is refused and the application remains unchanged.
4. **Given** an application already approved, rejected, or suspended, **When** an admin repeats an incompatible decision, **Then** no duplicate state change occurs and the admin receives a clear conflict outcome.

---

### User Story 2 - Suspend an active organizer (Priority: P1)

An admin suspends an approved organizer when they violate platform rules. Suspension removes organizer capability on the next request and hides all of that organizer's events from buyers immediately, while retaining the events and moderation history for admin and organizer review.

**Why this priority**: Suspension limits ongoing harm and prevents buyers from discovering events owned by an untrusted organizer.

**Independent Test**: Suspend an approved organizer with an approved event, then request the public catalog and event detail as a buyer; confirm the event is absent immediately, while admin and the organizer can still see its status.

**Acceptance Scenarios**:

1. **Given** an approved organizer with public events, **When** an admin suspends them, **Then** organizer capability is refused on the next request and every event owned by them is excluded from public lists, details, showtimes, and seat-map responses on the next request.
2. **Given** an organizer with active holds or future ticket sales, **When** they are suspended, **Then** no new organizer operation or buyer purchase starts for their hidden events, affected users are notified, and existing records remain available for the applicable cancellation or settlement flow.
3. **Given** a suspended organizer, **When** they attempt to re-apply, **Then** the request is refused until the suspension is resolved.
4. **Given** an admin cancels suspension before confirming, **Then** organizer status, event visibility, and audit history remain unchanged.

---

### User Story 3 - Approve or reject event publication (Priority: P1)

An admin reviews events submitted by approved organizers before publication. The admin approves compliant events so they can appear on the marketplace, or rejects non-compliant events with a reason so they remain private and can be corrected and resubmitted.

**Why this priority**: Pre-publish moderation prevents unsafe or invalid content from reaching buyers and is the visibility gate for organizer-created events.

**Independent Test**: Submit one complete event for review, approve it and confirm it appears when on sale; reject another with a reason and confirm it never appears publicly and the organizer can see why.

**Acceptance Scenarios**:

1. **Given** an event in `pending_review`, **When** an admin approves it, **Then** it becomes eligible for public visibility on the next request only when it is on sale and its organizer is approved.
2. **Given** an event in `pending_review`, **When** an admin rejects it with a reason, **Then** it remains non-public, the organizer sees the reason, and the organizer can correct and resubmit it.
3. **Given** an event whose material content changes after approval, **When** the change is saved, **Then** it returns to review before becoming public again.
4. **Given** a non-admin, **When** they attempt an event moderation action, **Then** the action is refused server-side.

---

### User Story 4 - Resolve reported content and remove violating events (Priority: P1)

An admin investigates reports about published events or reviews, dismisses valid content, flags content for follow-up, or removes violating content with a reason. Removing an event stops future sales and starts the defined cancellation handling for future showtimes.

**Why this priority**: Report handling protects buyers and gives admins a controlled response to harmful marketplace content.

**Independent Test**: Create a report against an approved event, dismiss one report and remove another event; confirm dismissal preserves visibility, removal hides the event on the next request, and affected buyers receive full wallet refunds for eligible purchases.

**Acceptance Scenarios**:

1. **Given** a reported event or review, **When** an admin dismisses the report, **Then** the content remains available, the report decision is recorded, and no refund is issued solely because of the report.
2. **Given** a reported event, **When** an admin flags it, **Then** it is removed from buyer-facing public results on the next request and remains visible to admins and its owner with the flag reason.
3. **Given** an event with tickets sold for future showtimes, **When** an admin removes it, **Then** future sales stop, tickets for affected future showtimes are voided, each eligible buyer receives a 100% refund of the ticket amount to their wallet exactly once, seats or quantities are released, and affected users are notified.
4. **Given** a removed event with a showtime already started, **When** removal is processed, **Then** that started showtime is not retroactively cancelled or refunded by this action.
5. **Given** a reported review, **When** an admin removes it, **Then** the review is no longer shown and the event's aggregate rating is recalculated.
6. **Given** a non-admin, **When** they attempt to dismiss, flag, or remove reported content, **Then** the action is refused and no content or refund state changes.

---

### User Story 5 - Trace every privileged decision (Priority: P1)

An admin and authorized reviewers can verify what privileged moderation action happened, who performed it, which target changed, when it happened, and the before/after values. Audit history cannot be edited or deleted.

**Why this priority**: Immutable auditability is mandatory for trust, incident response, and compliance with SEC-09.

**Independent Test**: Perform each organizer and event moderation action, inspect its audit entry, then attempt to modify or delete the entry and confirm the attempt is refused.

**Acceptance Scenarios**:

1. **Given** any successful or rejected privileged moderation decision, **When** it is processed, **Then** an audit record includes actor identity, action, target identity, timestamp, outcome, and relevant before/after state or reason.
2. **Given** a cancelled admin action, **When** no state change occurs, **Then** no moderation audit entry is written for that cancelled action.
3. **Given** an existing audit record, **When** any actor attempts to update or delete it, **Then** the attempt is refused and the original record is unchanged.
4. **Given** a moderation state change and its audit write, **When** either cannot complete, **Then** neither the state change nor its audit record is committed.

---

### Edge Cases

- Two admins act on the same application, organizer, event, or report concurrently: only one compatible state transition succeeds; the other receives a conflict and cannot overwrite the first decision.
- An approval targets an application or event that no longer exists: the action is refused with no audit record for a state change.
- An event is approved while its organizer is suspended: it remains hidden because public visibility requires both event approval and approved organizer status.
- An organizer is suspended while an event is pending review: the event remains non-public and cannot pass the public visibility predicate until the organizer is approved again.
- A removed event has no eligible buyers: it is hidden and audited, with no refund transaction created.
- A buyer has already received a refund or the wallet transaction is retried: the buyer receives no duplicate credit, while the removal action remains safely repeatable.
- A buyer's wallet is at its normal balance ceiling: the refund still follows wallet rules without losing value or creating a negative balance.
- A report references already removed content: the admin can close it as already resolved without applying a second removal or refund.
- A moderation reason contains unsafe markup: it is validated and displayed as encoded text.
- A public request uses a guessed identifier or slug for hidden content: it returns the same not-found outcome as other non-public content.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide an admin-only queue of pending organizer applications with applicant identity, organizer details, submission time, and current status.
- **FR-002**: System MUST allow an authorized admin to approve a `pending` organizer application, changing it to `approved` and recording the approving admin and time.
- **FR-003**: System MUST allow an authorized admin to reject a `pending` organizer application with a human-readable reason, changing it to `rejected`.
- **FR-004**: System MUST notify the applicant after approval or rejection and expose the rejection reason to the applicant.
- **FR-005**: System MUST enforce organizer capability from the stored organizer status on every request; approval grants capability and rejection or suspension removes it on the next request.
- **FR-006**: System MUST allow an authorized admin to suspend an `approved` organizer with a reason and record the prior and resulting status.
- **FR-007**: System MUST hide all events owned by a suspended organizer from buyer-facing lists, details, showtimes, and seat-map responses on the next request without deleting those events.
- **FR-008**: System MUST stop new organizer operations and new buyer purchases for events hidden because their organizer is suspended.
- **FR-009**: System MUST retain suspended organizer events and their moderation state for admins and the owning organizer, with the suspension reason visible to authorized viewers.
- **FR-010**: System MUST provide an admin-only event moderation queue containing events in `pending_review` and reported events or reviews requiring action.
- **FR-011**: System MUST allow an authorized admin to approve a `pending_review` event, making it eligible for public visibility only when the event is on sale and its organizer is approved.
- **FR-012**: System MUST allow an authorized admin to reject a `pending_review` event with a reason, keep it non-public, and allow correction and resubmission.
- **FR-013**: System MUST return an event to moderation review after a material content edit that could affect buyer safety or accuracy.
- **FR-014**: System MUST allow an authorized admin to dismiss a report while retaining content visibility and recording the decision.
- **FR-015**: System MUST allow an authorized admin to flag reported content, remove it from buyer-facing public results immediately, and retain it for authorized review.
- **FR-016**: System MUST allow an authorized admin to remove a violating event with a reason and stop future sales for that event.
- **FR-017**: System MUST cancel affected future showtimes for a removed event, void affected tickets, release bookable inventory, notify affected users, and skip showtimes that already started.
- **FR-018**: System MUST credit each eligible buyer 100% of each affected ticket amount to that buyer's wallet exactly once when an event is removed.
- **FR-019**: System MUST remove a reported review when ordered by an authorized admin and recalculate the affected event's aggregate rating.
- **FR-020**: System MUST enforce admin authorization on every organizer and event moderation action at the server boundary; non-admin attempts MUST be refused.
- **FR-021**: System MUST write one immutable `audit_logs` record for every attempted privileged moderation decision that changes state, including actor identity, action, target, timestamp, outcome, and before/after values or reason.
- **FR-022**: System MUST record rejected authorization and state-conflict outcomes sufficiently for audit investigation without exposing sensitive credentials or payment data.
- **FR-023**: System MUST prevent updates and deletes to existing `audit_logs` records for all application actors, including admins.
- **FR-024**: System MUST commit each moderation state change, required audit record, associated refund or cancellation effects, and notifications' durable delivery intent atomically; if a required state change or audit write fails, no partial moderation or refund state may remain.
- **FR-025**: System MUST make repeated removal and refund processing idempotent so retries never create duplicate wallet credits, duplicate ticket voids, or duplicate inventory release.
- **FR-026**: System MUST validate all moderation inputs and reasons, encode user-supplied text when displayed, and reject malformed or unsafe input.
- **FR-027**: System MUST preserve organizer, event, report, refund, and audit history after moderation actions; hiding or removing public content MUST NOT erase the historical record.

### Key Entities

- **Organizer Application**: A user's request for organizer capability, with status (`pending`, `approved`, `rejected`, `suspended`), reason, timestamps, and reviewing admin.
- **Event Moderation Record**: The moderation state and reason for an event (`pending_review`, `approved`, `flagged`, `removed`), linked to event owner and review history.
- **Content Report**: A report against an event or review, including reporter, target, reason, status, and administrative resolution.
- **Audit Log**: Append-only record of privileged action, actor, target, timestamp, outcome, reason, and before/after state.
- **Wallet Refund**: A one-time store-credit transaction linked to a cancelled ticket and moderation removal; amount is the full ticket amount in whole VND.
- **Moderation Notification**: Durable notification intent for organizers, buyers, and other affected users after a decision.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of organizer approval, rejection, and suspension decisions made by admins are reflected in capability checks on the next authenticated request.
- **SC-002**: 100% of events owned by a suspended organizer are absent from buyer-facing lists, details, showtimes, and seat maps on the next request.
- **SC-003**: 100% of organizer-submitted events remain absent from buyer-facing results until both event approval and approved organizer status are present.
- **SC-004**: 100% of removed-event test cases stop future sales and issue exactly one 100% wallet refund per eligible buyer, with zero duplicate credits across repeated processing.
- **SC-005**: 100% of state-changing privileged moderation actions have an immutable audit record containing actor, action, target, timestamp, outcome, and before/after state or reason.
- **SC-006**: 100% of attempts by non-admin users to perform moderation actions are refused without changing organizer, event, report, ticket, wallet, or audit state.
- **SC-007**: At least 95% of admins can complete an organizer or event moderation decision, including entering a reason when required, within 2 minutes in usability testing.
- **SC-008**: At least 99% of valid moderation decisions complete with consistent user-visible state, audit result, and notification intent; failures leave no partial state.
- **SC-009**: Public requests for hidden or removed content return the standard non-public/not-found outcome within the normal catalog response target, with no content leakage.

## Assumptions

- Existing authentication identifies admins, organizers, attendees, and server-side request identity; this feature does not add a new login method.
- Existing organizer application, event, report, ticket, seat, wallet, notification, and audit storage capabilities are extended rather than replaced.
- `organizers.status` uses `pending`, `approved`, `rejected`, and `suspended`; event moderation uses `pending_review`, `approved`, `flagged`, and `removed`, consistent with UC-33, UC-34, and the catalog data model.
- Public visibility is evaluated live as event on sale, event approved, and owning organizer approved; suspension does not require rewriting or deleting each event.
- Wallet refunds are closed-loop store credit in whole VND integers. Real-money settlement or cash payout is out of scope.
- Future showtimes means showtimes not started at removal time; started showtimes are skipped as defined by UC-34.
- Notification sending may be asynchronous, but durable notification intent is recorded with the moderation transaction.
- Audit records are retained for the platform's normal legal and operational retention period and are not editable or deletable through application actions.
- Admin actions require a reason for rejection, suspension, flag, and removal; approval and report dismissal may omit a reason.
- Event and review reporting is supplied by UC-39; organizer application submission is supplied by UC-37; event creation and publication submission are supplied by UC-24.
