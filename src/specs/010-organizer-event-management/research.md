# Phase 0 Research: Organizer Event Management

**Feature Branch**: `010-organizer-event-management`  
**Date**: 2026-08-12  
**Spec**: [`spec.md`](file:///D:/HCMUS/NhapMonCongNghePhanMem/Project/source/IntroSE/src/specs/010-organizer-event-management/spec.md)

---

## Technical Context & Research Decisions

### 1. Organizer Authorization & Resource Scoping (SEC-04)

- **Decision**: Authenticated organizer identity (`organizer_id`) MUST be extracted exclusively from verified server-side JWT session tokens. Every API endpoint in the organizer management suite MUST append an explicit scoping filter (`WHERE organizer_id = :session_organizer_id`).
- **Rationale**: Prevents IDOR (Insecure Direct Object Reference) vulnerabilities where an organizer attempts to view or modify events owned by another organizer. Aligning with TixHub Constitution Principle II: hiding UI buttons is not authorization; security is enforced server-side.
- **Alternatives Considered**: Client-supplied `organizerId` in query strings or request bodies — REJECTED due to severe authorization bypass risk.

---

### 2. Material Field Edits on Published Events (UC-24 Alternative Flow A6)

- **Decision**: When an event is in `Published` status and an organizer edits any material field (`title`, `description`, `ticketTiers` prices, `times` / showtimes, venue info), the system MUST atomically set `status = 'pending_review'` (`Pending Approval`) and set `is_public_catalog_visible = false`.
- **Rationale**: Prevents organizers from bypassing pre-publish admin moderation by creating compliant events, getting approved, and later altering prices or descriptions to misleading or non-compliant content.
- **Non-Material Edits**: Minor fields (contact email, internal organizer notes) do not trigger review reversion.
- **Alternatives Considered**: Allowing instant live updates for pricing and dates on published events — REJECTED per UC-24 A6 requirement and platform moderation integrity.

---

### 3. Ticket Tier Archiving vs Deletion (UC-26 Alternative Flow A3)

- **Decision**: Implement a soft-deletion pattern with an `is_archived` boolean flag on the `ticket_tiers` table.
  - When an organizer requests tier deletion:
    - If `sold_count == 0`: Perform physical row deletion from database.
    - If `sold_count > 0`: Block physical deletion (`400 Bad Request`), set `is_archived = true`, and exclude the tier from buyer checkout while maintaining it in historical sales reporting.
- **Rationale**: Preserves database referential integrity for existing attendee tickets and purchase audit records without corrupting accounting and revenue metrics.
- **Alternatives Considered**: Hard deletion with cascading nulls — REJECTED as it destroys order context and breaks ticket validation for attendees.

---

### 4. Computed "Completed" Event Status

- **Decision**: `"Completed"` status is NOT a stored mutable column in the database. It is dynamically computed at query time:
  ```sql
  CASE 
    WHEN status = 'published' AND NOW() > end_datetime THEN 'completed'
    ELSE status
  END
  ```
- **Rationale**: Solves state drift issues caused by missed cron jobs or delayed background tasks. Inferred state guarantees 100% time-accurate status evaluation across all API requests without write locks.
- **Alternatives Considered**: Background cron job updating DB status every minute — REJECTED due to potential latency drift and extra database write overhead.

---

### 5. Mandatory Event Cancellation & Closed-Loop Wallet Refunds (UC-25 / FR-010..012)

- **Decision**: Canceling an event requires a mandatory non-empty string for `cancellation_reason`. On execution:
  1. Transaction updates event status to `'canceled'` and logs `cancellation_reason`.
  2. Active seat holds for the event are immediately invalidated (`0ms` latency delay).
  3. Subsequent buyer checkout requests for the event are rejected.
  4. An asynchronous transaction dispatches 100% wallet refunds (in integer VND) to store-credit wallets for all ticket holders per TixHub Constitution v2.0.0.
  5. An immutable `EventCancellationAuditRecord` is created.
- **Rationale**: Fulfills UC-25 requirements and TixHub Constitution Principle I & II (closed-loop wallet refunds, atomic seat/order integrity, immutable audit trail).
- **Alternatives Considered**: Refunding cash or bank accounts — REJECTED as real-money settlement is explicitly out of scope per TixHub Constitution v2.0.0.
