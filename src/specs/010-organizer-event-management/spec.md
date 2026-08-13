# Feature Specification: Organizer Event Management

**Feature Branch**: `010-organizer-event-management`

**Created**: 2026-08-12

**Status**: Draft

**Input**: User description: "depend on usecase specification, all UC that are relevant to event manament of organizer, i wanna create something to manage all events that that organizer have, they can edit it, update, cancel, send requeste to public it, when clicking on a specific event in that management page, we will go to a page that specifically manage an single event include many things about that event such as number of tickets sold, remaining, price, time to take place, name, description and so an."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Organizer Event Portfolio & Overview Dashboard (Priority: P1)

As an Event Organizer, I want to see a clear portfolio view of all events I have created, filtered by status, so that I can monitor overall performance and quickly find events needing action.

**Why this priority**: Core navigation entry point. Organizers cannot manage individual events without an intuitive dashboard showing all their events and status summaries.

**Independent Test**: Can be tested by logging in as an organizer, navigating to `/organizer`, filtering by status (Draft, Pending Approval, Published, Canceled, Completed), and verifying that only events owned by the authenticated organizer are listed with accurate status badges and summary counts.

**Acceptance Scenarios**:

1. **Given** an authenticated organizer with multiple events in various states, **When** they view the Organizer Events Management page (`/organizer`), **Then** all events belonging exclusively to this organizer are displayed as cards or table rows showing Title, Date, Location, Status Badge, Tickets Sold/Total, and Price Range (VND).
2. **Given** the organizer event portfolio page, **When** the organizer filters by status "Draft" or inputs a keyword in the search bar, **Then** the list updates dynamically to display only matching events.
3. **Given** an organizer with no events created yet, **When** they visit the page, **Then** an empty state illustration is shown with a clear action button to "Create New Event".

---

### User Story 2 - Single Event Detail Management Workspace (Priority: P1)

As an Event Organizer, I want to click on a specific event from my dashboard to open a dedicated management page for that single event, showing complete metrics (tickets sold, remaining capacity, revenue in VND, pricing, schedule, and description) so that I can inspect and control all aspects of that specific event.

**Why this priority**: Essential functionality requested by user. Organizers need deep visibility into a single event's sales figures, inventory, schedule details, and status controls.

**Independent Test**: Can be tested by selecting an event from the list, verifying navigation to `/organizer/:id`, and validating that real-time sold count, remaining tickets, pricing per tier, start/end dates, venue info, and action controls match event data.

**Acceptance Scenarios**:

1. **Given** the organizer event portfolio, **When** the organizer clicks on a specific event item, **Then** they are navigated to the dedicated Single Event Management workspace (`/organizer/:id`) for that event.
2. **Given** the single event management view, **When** inspecting the header and summary cards, **Then** the system displays total tickets sold, remaining ticket inventory, total gross revenue (in integer VND), price per tier, event start/end datetime, sales window, location, and full description.
3. **Given** an event with multiple ticket tiers (e.g. VIP, Standard), **When** viewing the ticket breakdown section, **Then** each tier shows its name, price (VND), total allocation, count sold, and count remaining.

---

### User Story 3 - Submit Event Publication Request (Priority: P1)

As an Event Organizer, I want to submit a completed draft or updated event to the platform administrators for publication review ("Request to Publish") so that my event can be verified and listed publicly on TixHub.

**Why this priority**: Essential workflow transition. Events must pass admin moderation before going live to attendees.

**Independent Test**: Can be tested by selecting a Draft event with valid mandatory information, clicking "Request to Publish", and confirming that the event status transitions to "Pending Approval" and appears in the moderation queue.

**Acceptance Scenarios**:

1. **Given** a Draft event with all required fields filled (Title, Description, Banner, Venue, Datetime, Ticket Tier with valid VND pricing), **When** the organizer clicks "Request to Publish", **Then** the system validates completeness, transitions the event status to "Pending Approval", and displays a success notification.
2. **Given** a Draft event missing required information (e.g., missing ticket tier or missing banner), **When** the organizer clicks "Request to Publish", **Then** the system highlights missing fields and blocks submission until resolved.
3. **Given** an event currently in "Pending Approval" or "Published" state, **When** viewing the management page, **Then** the "Request to Publish" action is disabled or hidden with the current state clearly indicated.

---

### User Story 4 - Edit & Update Event Details (Priority: P2)

As an Event Organizer, I want to edit and update my event's details (such as description, banner image, venue location, schedule, or ticket tiers) so that information remains accurate and up-to-date.

**Why this priority**: Allows organizers to refine event content and adjust details before or during the event lifecycle.

**Independent Test**: Can be tested by editing event fields on the single event management page, saving changes, and verifying that updated values are persisted and reflected immediately.

**Acceptance Scenarios**:

1. **Given** a Draft or Published event, **When** the organizer updates non-restricted fields (e.g. contact email, venue notes) and submits changes, **Then** the system updates the event record and reflects the new details immediately.
2. **Given** a Published event where tickets have already been sold, **When** the organizer attempts to modify ticket pricing or reduce tier total quota below the already-sold ticket count, **Then** the system rejects the modification and displays an inline validation error explaining the constraint.
3. **Given** a Published event, **When** the organizer edits material fields (title, description, pricing, showtimes), **Then** the system MUST automatically revert its status to "Pending Approval" and remove it from the public catalog until re-approved by an admin (per UC-24 alternative flow A6).
4. **Given** a ticket tier that has sold tickets, **When** the organizer attempts to delete the ticket tier, **Then** the system MUST block deletion and instead archive the tier (per UC-26 alternative flow A3).

---

### User Story 5 - Event Cancellation & Refund Trigger (Priority: P2)

As an Event Organizer, I want to cancel an event if necessary by providing a mandatory cancellation reason, so that ticket sales are halted and affected attendees are notified and refunded via store credit.

**Why this priority**: Critical contingency control. Organizers must be able to cancel events safely while maintaining attendee trust and automated platform compliance.

**Independent Test**: Can be tested by initiating "Cancel Event" on an active event, entering a cancellation reason, confirming in a confirmation modal, and verifying event status becomes "Canceled", ticket sales are disabled, and cancellation audit record is generated.

**Acceptance Scenarios**:

1. **Given** an active event (Draft, Pending Approval, or Published), **When** the organizer clicks "Cancel Event", **Then** a modal prompts for a mandatory cancellation reason and confirmation.
2. **Given** a confirmed cancellation action with a non-empty reason, **When** submitted, **Then** the event status updates to "Canceled", further ticket purchasing is blocked immediately, and automated store-credit wallet refund processing is dispatched for ticket holders per TixHub Constitution.
3. **Given** a Canceled event, **When** viewed on the management page, **Then** an explicit banner indicates "Canceled", displays the cancellation reason and timestamp, and disables edit and publication controls.

---

### Edge Cases

- **Cancellation of Past/Completed Events**: What happens when an organizer attempts to cancel an event whose end date has already passed? The system MUST block cancellation for completed events and suggest contacting support if adjustments are needed.
- **Quota Reduction Below Sold Count**: What happens when an organizer tries to reduce a ticket tier capacity to 50 when 60 tickets have already been sold? The system MUST validate `new_capacity >= sold_tickets` and display a clear error message.
- **Price Modification on Sold Tiers**: What happens when an organizer tries to change the price of a ticket tier after tickets have been sold under that tier? The price change MUST be restricted or created as a separate ticket tier to preserve accounting integrity for existing tickets.
- **Session Timeout during Edit**: How does the system handle session expiration while an organizer is filling in event edits? The draft data is auto-saved locally or prompt to log back in without losing form inputs.
- **Editing Material Fields of Published Event**: What happens when an organizer edits material fields (title, description, pricing, showtimes) of a Published event? The system MUST automatically revert the event status to "Pending Approval" and remove it from the public catalog until re-approved by an admin.
- **Deleting Ticket Tier with Sold Tickets**: What happens when an organizer attempts to delete a ticket tier that has sold tickets? The system MUST block deletion and archive the tier instead to maintain order auditability.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST display a dedicated Organizer Event Management page (`/organizer`) divided into two distinct sections/tabs: Part 1 for managing all current events, and Part 2 for creating a new event.
- **FR-002**: System MUST scope all event management queries to the authenticated organizer's identity, ensuring organizers cannot view or edit events belonging to other organizers.
- **FR-003**: System MUST provide status filtering (Draft, Pending Approval, Published, Canceled, Completed) and keyword search across Part 1 of the organizer's event list.
- **FR-004**: System MUST render each event item in Part 1 as a line/card using its uploaded event picture as a full background image (with dark contrast overlay), and navigating to the dedicated Single Event Management workspace (`/organizer/:id`) when clicking anywhere on the event card area.
- **FR-005**: Single Event Management view MUST display comprehensive event metrics:
  - Total tickets sold
  - Remaining ticket inventory
  - Gross revenue calculated in VND integers
  - Ticket pricing breakdown by tier
  - Event title, full description, category, required picture media, and optional video/trailer media
  - Event date/time, sales window start/end, and venue details
- **FR-006**: System MUST allow organizers to submit Draft events for publication review ("Request to Publish"), transitioning event status to "Pending Approval".
- **FR-007**: System MUST validate that mandatory event details (title, description, required picture media `bannerUrl`, venue, schedule, at least one ticket tier with valid VND price) are complete before allowing publication submission. Video media (`videoUrl`) is optional.
- **FR-008**: System MUST allow organizers to edit and update event details (title, description, picture media, optional video media, venue info, dates, ticket tier details).
- **FR-009**: System MUST prevent updating ticket tier capacity to a number less than the current count of sold tickets for that tier.
- **FR-010**: System MUST allow organizers to cancel an event prior to its completion by providing a mandatory cancellation reason.
- **FR-011**: System MUST immediately halt all ticket sales and hold attempts for an event once its status changes to Canceled.
- **FR-012**: System MUST trigger automated store-credit wallet refund processing for attendees holding tickets to a canceled event, adhering to TixHub Constitution v2.0.0.
- **FR-013**: System MUST display prominent status banners on the single event management view indicating state (e.g. Draft, Pending Approval, Published, Canceled, Completed) and relevant metadata (e.g. cancellation reason).
- **FR-014**: System MUST automatically revert a Published event's status to "Pending Approval" and remove it from the public catalog until re-approved by an admin whenever material fields (title, description, pricing, showtimes) are edited by the organizer, per UC-24 alternative flow A6.
- **FR-015**: System MUST block organizers from deleting a ticket tier that has sold tickets, and MUST instead archive the tier, per UC-26 alternative flow A3.
- **FR-016**: System MUST hide the "Đăng ký làm nhà tổ chức" (Apply to become organizer / UC-37) call-to-action block in the footer and across the platform if the currently authenticated user's account already possesses the ORGANIZER role, as that registration flow is relevant only to non-organizer accounts.
- **FR-017**: Part 2 (Create Event Form) MUST require uploading/providing an event picture (mandatory) and allow uploading/providing a video trailer link (optional) before creating the draft event.

### Key Entities *(include if feature involves data)*

- **Organizer Event Portfolio Summary**: Aggregated list model representing an organizer's events.
  - Attributes: `event_id`, `organizer_id`, `title`, `banner_url`, `status` (Draft, Pending Approval, Published, Canceled, Completed - *derived/computed state automatically inferred when `end_datetime` has passed*), `start_datetime`, `end_datetime`, `location_name`, `total_capacity`, `sold_tickets`, `remaining_tickets`, `total_revenue_vnd`.
- **Single Event Management Detail**: Detailed entity representation for organizer management workspace.
  - Attributes: `event_id`, `organizer_id`, `title`, `description`, `category`, `banner_url`, `venue_name`, `venue_address`, `start_datetime`, `end_datetime`, `sales_start_datetime`, `sales_end_datetime`, `status` (Draft, Pending Approval, Published, Canceled, Completed - *derived/computed state*), `rejection_reason` (if rejected by admin), `cancellation_reason` (if canceled), `created_at`, `updated_at`.
- **Ticket Tier Breakdown**: Sub-entity attached to event representing inventory tiers.
  - Attributes: `tier_id`, `event_id`, `name` (e.g., Early Bird, Standard, VIP), `price_vnd` (integer), `capacity`, `sold_count`, `remaining_count`, `is_archived` (boolean flag set to true when tier with sold tickets is deleted).
- **Event Cancellation Audit Record**: Entity recording cancellation context.
  - Attributes: `cancellation_id`, `event_id`, `organizer_id`, `canceled_at`, `reason`, `tickets_affected_count`, `total_refund_amount_vnd`.

*Note on Status*: The "Completed" status is a derived/computed state (automatically inferred when `end_datetime` has passed) rather than a manually-set DB field, since it has no explicit definition in the source use cases.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Organizers can load their complete event portfolio and apply status filters with a response time under 1.5 seconds.
- **SC-002**: Organizers can click into any event and view exact real-time ticket sales metrics (sold count, remaining count, revenue in VND) with 100% data consistency against database records.
- **SC-003**: 100% of "Request to Publish" actions on valid draft events correctly transition event state to "Pending Approval" and appear in the moderation queue.
- **SC-004**: 100% of event cancellations block subsequent purchase requests instantaneously (0 latency delay) and dispatch store-credit wallet refund triggers for all ticket holders.
- **SC-005**: 95% of organizers complete event detail updates or publication requests on their first attempt without encountering validation errors.

## Assumptions

- **Authentication & Authorization**: Organizers are authenticated via session/JWT tokens with `ORGANIZER` role enforced on server endpoints.
- **Currency Standard**: All monetary values are handled as integer VND per TixHub Constitution (no decimals).
- **Refund Mechanism**: Refunds resulting from event cancellation are processed strictly to attendee store-credit wallets (closed-loop) per TixHub Constitution v2.0.0.
- **Admin Moderation Flow**: Admin approval/rejection of publication requests is handled via the Admin Moderation module (004-admin-organizer-moderation); this feature handles the organizer side of submitting requests and viewing status.
- **Cancellation Reason Requirement**: The mandatory cancellation-reason requirement (FR-010, `cancellation_reason` field) is a spec-level addition not present in UC-25, included for audit/UX purposes.
- **UI Language**: Primary interface copy is provided in Vietnamese (with English support).


