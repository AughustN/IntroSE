# Phase 1 Quickstart Validation Guide: Organizer Event Management

**Feature Branch**: `010-organizer-event-management`  
**Date**: 2026-08-12  
**Spec**: [`spec.md`](file:///D:/HCMUS/NhapMonCongNghePhanMem/Project/source/IntroSE/src/specs/010-organizer-event-management/spec.md)

---

## Runnable Validation Scenarios

This guide details the step-by-step validation scenarios to verify the Organizer Event Management workspace end-to-end.

---

### Scenario 1: Portfolio View & Scoped Event Filtering

**Goal**: Verify that an organizer sees only their own events and can filter by status.

1. **Prerequisites**:
   - Log in as Organizer A (`org-001`).
   - Navigate to `/organizer`.

2. **Steps**:
   - Inspect event list cards/rows.
   - Filter by status dropdown: `Draft`, `Pending Approval`, `Published`, `Canceled`, `Completed`.
   - Enter keyword search in search input (e.g., `"Hạ Trắng"`).

3. **Expected Outcome**:
   - Only events owned by `org-001` are rendered.
   - Status badge and sales metrics (`sold / total`, `revenue VND`) match backend DB records.
   - Filtering and searching update the list dynamically within <1.5s (SC-001).

---

### Scenario 2: Single Event Detail & Real-Time Metrics

**Goal**: Verify single event management workspace metrics and ticket tier breakdown.

1. **Steps**:
   - Click on event `evt-101` from the portfolio list.
   - User is routed to `/organizer/evt-101`.

2. **Expected Outcome**:
   - Displays real-time total tickets sold, remaining capacity, gross revenue (integer VND), schedule, venue, and full description.
   - Each ticket tier (e.g. VIP, Standard) lists total capacity, sold count, remaining count, and price in VND.

---

### Scenario 3: Request Publication ("Request to Publish")

**Goal**: Verify publication submission transitions Draft events to Pending Approval.

1. **Steps**:
   - Open a `Draft` event with valid required fields.
   - Click **"Request to Publish"** (`Gửi yêu cầu duyệt`).

2. **Expected Outcome**:
   - System validates mandatory fields.
   - Event status changes to `Pending Approval`.
   - Notification toast confirms submission and event enters admin moderation queue.

---

### Scenario 4: Material Field Edit Reverts Published Event (UC-24 A6)

**Goal**: Verify that editing material fields on a Published event reverts status to Pending Approval.

1. **Steps**:
   - Open a `Published` event.
   - Change a material field (e.g. update `title` or ticket tier `priceVnd`).
   - Click **"Save Changes"**.

2. **Expected Outcome**:
   - System updates event record.
   - Status automatically reverts to `Pending Approval` (`pending_review`).
   - Warning banner informs organizer that event is hidden from the public catalog until re-approved by admin.

---

### Scenario 5: Delete / Archive Ticket Tier (UC-26 A3)

**Goal**: Verify that deleting a tier with sold tickets archives the tier instead of destroying data.

1. **Steps**:
   - Open ticket tier management section for an event with sold tickets.
   - Click **"Delete Tier"** on a tier where `sold_count > 0`.

2. **Expected Outcome**:
   - Server blocks hard deletion.
   - Tier status becomes `is_archived: true`.
   - UI displays an "Archived" badge on the tier, preventing new ticket holds while preserving historic sales records.

---

### Scenario 6: Mandatory Cancellation & Wallet Refunds (UC-25 / FR-010..012)

**Goal**: Verify event cancellation workflow and store-credit wallet refund trigger.

1. **Steps**:
   - Click **"Cancel Event"** on an active event.
   - Modal prompts for mandatory cancellation reason. Enter `"Khu vực xảy ra sự cố thiên tai."`
   - Click **"Confirm Cancellation"**.

2. **Expected Outcome**:
   - Event status updates immediately to `Canceled`.
   - Banner displays cancellation timestamp and reason.
   - Further ticket sales/holds are blocked instantaneously (0ms delay).
   - Store-credit wallet refund processing is dispatched for all ticket holders (SC-004).

---

### Scenario 7: Hide Organizer Application CTA for Organizer Accounts (FR-016 / UC-37)

**Goal**: Verify that authenticated organizer accounts do not see the "Đăng ký làm nhà tổ chức" CTA block.

1. **Steps**:
   - Log in as an account with the `ORGANIZER` role.
   - Scroll down to the website Footer on any page.

2. **Expected Outcome**:
   - The "Bán vé cùng TixHub / Đăng ký làm nhà tổ chức" CTA section is hidden from the DOM.
   - Logging in as a non-organizer account reveals the "Đăng ký làm nhà tổ chức" CTA block as expected.

