# Feature Specification: Admin Catalog Settings

**Feature Branch**: `007-admin-catalog-settings`
**Created**: 2026-08-07
**Status**: Draft
**Input**: User description: "Tính năng 007-admin-catalog-settings — Admin quản lý danh mục sự kiện (UC-35) và cấu hình tham số hệ thống (UC-36), chi tiết trong docs/Analysis_Design/Group02_UseCaseSpecification.md."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Manage Event Categories (Priority: P1)

As an Admin, they manage event categories so attendees can discover events using accurate, current categories.

**Why this priority**: Categories organize the public catalog and are required for reliable browse and search.

**Independent Test**: Sign in as Admin, create, rename, and delete unused categories; verify category list and event filters reflect each successful change.

**Acceptance Scenarios**:

1. **Given** an authenticated Admin and a valid new category name, **When** they add the category, **Then** the system creates it and shows it in category management and public discovery.
2. **Given** an existing category and a valid unique replacement name, **When** they rename it, **Then** the new name appears in category management and discovery while events remain associated with that category.
3. **Given** an existing category with no events assigned, **When** an Admin deletes it, **Then** the category is removed from management and discovery.
4. **Given** an existing category with one or more events assigned, **When** an Admin attempts to delete it, **Then** the system refuses deletion, explains that events still use the category, and leaves all data unchanged.
5. **Given** a category name that is blank, invalid, or already used, **When** an Admin submits it, **Then** the system rejects the request with a validation message and makes no change.

---

### User Story 2 - Curate Featured Events (Priority: P1)

As an Admin, they choose featured events and their display order so the homepage presents a deliberate, current selection.

**Why this priority**: Featured content is the primary homepage curation capability and must stay consistent with public discovery.

**Independent Test**: Sign in as Admin, add and remove eligible events from featured content, reorder them, and verify homepage results and ordering on the next view.

**Acceptance Scenarios**:

1. **Given** an authenticated Admin and an eligible event, **When** they add it to featured events, **Then** it appears on the homepage in the selected display order.
2. **Given** a featured event, **When** an Admin removes it, **Then** it no longer appears in featured content and remains available according to its normal catalog status.
3. **Given** multiple featured events, **When** an Admin changes their display order, **Then** the homepage lists them in the new order, with each order position used at most once.
4. **Given** an event that is unavailable for public discovery, **When** an Admin attempts to feature it, **Then** the system refuses the action and leaves existing featured content unchanged.
5. **Given** a non-Admin user, **When** they attempt any category or featured-content action, **Then** the system refuses the action regardless of client controls.

---

### User Story 3 - Configure Operating Settings (Priority: P1)

As an Admin, they view and update bounded operating settings so future holds, top-ups, ticket limits, wallet rules, and AI availability follow current platform policy.

**Why this priority**: These settings govern money, inventory, and platform-wide behavior; invalid or unauthorized changes can harm active users.

**Independent Test**: Sign in as Admin, view defaults, update each setting with valid values, submit invalid boundary values, and verify future requests use accepted values while active operations retain their original terms.

**Acceptance Scenarios**:

1. **Given** an authenticated Admin and no stored override, **When** they open settings, **Then** the system shows defaults: seat hold TTL 7 minutes; top-up grace 7 minutes; top-up absolute ceiling 14 minutes; maximum 8 tickets per buyer; wallet top-up minimum 5,000 VND; wallet top-up maximum 10,000,000 VND; wallet balance ceiling 20,000,000 VND; AI features enabled.
2. **Given** an authenticated Admin and values within allowed bounds, **When** they save settings, **Then** the system accepts and displays them as current values for future requests.
3. **Given** an Admin submits a value outside its allowed bounds, **When** they save settings, **Then** the system rejects that value, identifies its allowed range, preserves previously saved values, and does not partially apply the submission.
4. **Given** an Admin submits a top-up grace period greater than its absolute ceiling, **When** they save settings, **Then** the system rejects the inconsistent submission and preserves previously saved values.
5. **Given** a hold or transaction started before a setting change, **When** the operation completes or expires after the change, **Then** it continues under terms established when it started; the new value applies only to requests started later.
6. **Given** a successful setting change, **When** the change is completed, **Then** the system records an immutable audit entry identifying the Admin, changed setting names, prior values, new values, and time of change.
7. **Given** a non-Admin user, **When** they attempt to view or change operating settings, **Then** the system refuses the action and does not disclose or modify settings.
8. **Given** a settings update fails validation or authorization, **When** the request ends, **Then** no audit entry records it as a successful change and no setting is modified.

---

### Edge Cases

- Category names differing only by case or surrounding whitespace are treated as duplicates; accepted names are normalized consistently for comparison and display.
- Concurrent attempts to create or rename categories to the same name result in at most one successful name; other attempts are rejected without overwriting the winner.
- Reordering featured events with missing, negative, non-integer, or duplicate positions is rejected without changing current order.
- Removing or disabling an event after it was featured prevents it from being shown as publicly featured on the next homepage request; existing curation records remain reviewable by Admin.
- If no featured events exist, homepage shows its defined empty state and public browse remains usable.
- If stored setting data is absent or unusable, the system uses the documented default rather than exposing an empty or invalid operational value.
- Setting validation treats integer money amounts as VND and rejects negative, fractional, or otherwise malformed values.
- A setting update containing several fields is atomic: either all valid changes are applied together or none are applied.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST restrict category, featured-event, and operating-setting management actions to authenticated Admin users; authorization MUST be enforced on the server for every action.
- **FR-002**: System MUST allow an Admin to create, rename, list, and delete event categories.
- **FR-003**: System MUST reject blank, malformed, or duplicate category names, including names equivalent after defined whitespace and case normalization.
- **FR-004**: System MUST refuse deletion of any category assigned to one or more events and MUST leave that category and its event associations unchanged.
- **FR-005**: System MUST allow an Admin to add eligible public events to featured content, remove featured events, and assign their display order.
- **FR-006**: System MUST reject featuring an event that is not eligible for public discovery and MUST preserve existing featured content after rejection.
- **FR-007**: System MUST enforce valid, unique, non-negative integer display positions for featured events and MUST return featured events in display order.
- **FR-008**: System MUST make successful category and featured-content changes visible on the next browse, search/filter, or homepage request without requiring a scheduled publication step.
- **FR-009**: System MUST show operating settings and their current effective values to an authenticated Admin, using these defaults when no valid override exists: seat_hold_ttl_minutes 7; topup_grace_minutes 7; absolute_ceiling_minutes 14; max_tickets_per_buyer 8; wallet_topup_min 5,000 VND; wallet_topup_max 10,000,000 VND; wallet_balance_ceiling 20,000,000 VND; ai_features_enabled true.
- **FR-010**: System MUST allow an Admin to update the settings listed in FR-009 as a single atomic submission.
- **FR-011**: System MUST enforce these inclusive bounds: seat_hold_ttl_minutes 1-30; topup_grace_minutes 1-15; absolute_ceiling_minutes 2-30; max_tickets_per_buyer 1-50. Money settings MUST be non-negative integer VND amounts, with wallet_topup_min no greater than wallet_topup_max and wallet_topup_max no greater than wallet_balance_ceiling.
- **FR-012**: System MUST reject invalid or inconsistent setting submissions with field-specific feedback and MUST preserve all previously effective values; rejected submissions MUST NOT partially apply.
- **FR-013**: System MUST apply accepted setting values only to requests and operations that begin after the change; active holds and transactions MUST retain terms captured at their start.
- **FR-014**: System MUST write an immutable audit log for every successful operating-setting change, including Admin identity, changed names, previous values, new values, and timestamp.
- **FR-015**: System MUST NOT expose or modify operating settings when authorization fails, and MUST return a safe authorization error for non-Admin requests.
- **FR-016**: System MUST preserve existing category, featured-event, and setting data when an operation is cancelled or fails validation, authorization, or conflict checks.

### Key Entities

- **Event Category**: Named classification used to group events in catalog browse and search; has a unique normalized name and event associations.
- **Featured Event Entry**: Homepage curation record linking an eligible event to a display position and curation state.
- **System Setting**: Named operational parameter with an effective value, default value, and permitted bounds.
- **Audit Log**: Immutable record of a privileged setting change, including actor, values before and after, changed names, and timestamp.
- **Event**: Public catalog item that may be associated with categories and may be eligible for featured placement.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Admin can complete a valid category create, rename, or delete action in under 60 seconds, excluding sign-in.
- **SC-002**: Admin can update featured membership and ordering for a set of up to 50 events in under 2 minutes, excluding sign-in.
- **SC-003**: 100% of successful category and featured-content changes are visible on the next homepage or discovery request.
- **SC-004**: 100% of setting submissions outside defined bounds or cross-field limits are rejected without partial changes.
- **SC-005**: 100% of successful setting changes produce an audit record containing actor, before value, after value, changed setting, and timestamp.
- **SC-006**: 100% of requests from non-Admin users attempting protected actions are denied, with no protected data mutation.
- **SC-007**: In acceptance testing, at least 95% of Admins complete each primary management task without data correction caused by ambiguous validation or ordering behavior.
- **SC-008**: During acceptance testing, no active hold or transaction changes its originally assigned timing or monetary terms after a later setting update.

## Assumptions

- Existing authentication and role model identifies Admin users and is reused; this feature does not add roles or sign-in flows.
- Existing public event catalog and homepage consume current category and featured-content state on each request.
- Event eligibility for featured placement means event is publicly discoverable under existing moderation, publication, and sale rules.
- Setting overrides are persisted as current platform configuration, while absent or unusable values fall back to the defaults listed in FR-009.
- Secrets, credentials, payment-provider configuration, and other environment-only values are outside this feature.
- VND values are whole-number amounts; frontend and backend present validation errors in Vietnamese consistent with existing product behavior.
- Existing holds and transactions retain captured terms; future operations read current effective settings.
