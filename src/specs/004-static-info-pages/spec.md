# Feature Specification: Static Information Pages & Shared Footer Navigation

**Feature Branch**: `004-static-info-pages`

**Created**: 2026-08-06

**Status**: Draft

**Input**: User description: "Tôi cần thêm 4 trang nội dung tĩnh (static info pages) vào website, được truy cập thông qua các nút/link ở footer (đáy trang) của mọi trang trong site: 1. "Về chúng tôi" (About Us) route /about-us 2. "Điều khoản sử dụng" (Terms of Service cho khách hàng) route /terms-of-service 3. "Điều khoản website" (Website Terms) route /website-terms 4. "Chính sách hoàn vé" (Refund Policy) route /refund-policy. Nội dung của từng trang được lấy từ các file tài liệu nằm trong D:\HCMUS\NhapMonCongNghePhanMem\Project\source\IntroSE\docs\AboutUsInformation (mỗi file tương ứng với một trang, tôi sẽ cung cấp/copy nội dung file vào khi triển khai). Yêu cầu: Footer hiển thị 4 link này trên tất cả các trang của site (dùng chung 1 component Footer); khi người dùng click vào 1 link, điều hướng sang trang tương ứng, hiển thị nội dung dạng văn bản có định dạng (heading, đoạn văn, danh sách... theo đúng cấu trúc file gốc); mỗi trang có tiêu đề (title) tương ứng, dễ đọc trên cả desktop và mobile; nội dung các trang có thể được cập nhật sau này mà không cần sửa code (ví dụ: đọc từ file markdown/CMS) nêu rõ giả định nếu chưa quyết định cách lưu trữ nội dung; không yêu cầu đăng nhập để xem các trang này."

## Clarifications

### Session 2026-08-06

- Q: How should the static document content be stored and loaded in the application? (FR-007) → A: Store as `.md` Markdown files in a dedicated content assets folder and parse/render them using a Markdown renderer component.
- Q: How should the 4 static page links be grouped and arranged within the Footer component? (FR-002) → A: Group links into 2 separate Footer columns matching the existing layout: "Dành cho Khách hàng" (containing "Điều khoản sử dụng" and "Chính sách hoàn vé") and "Về công ty chúng tôi" (containing "Về chúng tôi" and "Điều khoản website").

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Access Static Info Pages from Categorized Shared Footer (Priority: P1)

As any visitor or user browsing the website, I want to see navigation links to "Về chúng tôi", "Điều khoản sử dụng", "Điều khoản website", and "Chính sách hoàn vé" neatly organized under their corresponding Footer columns ("Về công ty chúng tôi" and "Dành cho Khách hàng") on all pages, so that I can easily locate and navigate to these informational pages.

**Why this priority**: Categorized navigational access from every page is essential for users seeking legal terms, platform background, or customer policies.

**Independent Test**: Can be tested by navigating to any existing page on the site, locating the shared footer, verifying the links under "Về công ty chúng tôi" and "Dành cho Khách hàng", clicking each link, and verifying correct URL routing.

**Acceptance Scenarios**:

1. **Given** a user is on any page of the site, **When** they scroll to the footer, **Then** they see "Về chúng tôi" and "Điều khoản website" under the "Về công ty chúng tôi" section, and "Điều khoản sử dụng" and "Chính sách hoàn vé" under the "Dành cho Khách hàng" section.
2. **Given** a user clicks on "Về chúng tôi" in the footer, **When** navigation occurs, **Then** the browser routes to `/about-us` without requiring authentication.
3. **Given** a user clicks on "Điều khoản sử dụng" in the footer, **When** navigation occurs, **Then** the browser routes to `/terms-of-service` without requiring authentication.
4. **Given** a user clicks on "Điều khoản website" in the footer, **When** navigation occurs, **Then** the browser routes to `/website-terms` without requiring authentication.
5. **Given** a user clicks on "Chính sách hoàn vé" in the footer, **When** navigation occurs, **Then** the browser routes to `/refund-policy` without requiring authentication.

---

### User Story 2 - Read Formatted Static Document Content (Priority: P1)

As a visitor reading one of the static information pages, I want to see properly structured formatted text (headings, paragraphs, bullet/numbered lists) matching the original source document structure, so that the information is easy to read and understand.

**Why this priority**: Displaying structured, readable content guarantees that legal policies and corporate information are communicated clearly to users.

**Independent Test**: Can be tested by opening `/about-us`, `/terms-of-service`, `/website-terms`, or `/refund-policy` directly in a browser and verifying that document headings, paragraphs, and list formatting render cleanly.

**Acceptance Scenarios**:

1. **Given** a user navigates to `/about-us`, **When** the page loads, **Then** the page displays the title "Về chúng tôi" and renders the formatted document content.
2. **Given** a user navigates to `/terms-of-service`, **When** the page loads, **Then** the page displays the title "Điều khoản sử dụng" and renders formatted legal terms text.
3. **Given** a user navigates to `/website-terms`, **When** the page loads, **Then** the page displays the title "Điều khoản website" and renders formatted website terms text.
4. **Given** a user navigates to `/refund-policy`, **When** the page loads, **Then** the page displays the title "Chính sách hoàn vé" and renders formatted refund policy text.
5. **Given** document content contains structural elements (headings, paragraphs, lists), **When** rendered on any static info page, **Then** visual formatting (font hierarchy, line spacing, list indentation) is preserved.

---

### User Story 3 - Responsive and Maintenance-Friendly Static Pages (Priority: P2)

As a site maintainer or mobile reader, I want the static info pages to render comfortably on mobile and desktop screens, and allow updating text content without altering application source code, so that content changes can be performed easily in the future.

**Why this priority**: Good mobile readability ensures accessibility across devices, and decoupling content from application logic simplifies future legal/informational updates.

**Independent Test**: Can be tested by switching device viewport sizes from desktop to mobile (e.g. 375px width) to confirm layout responsiveness, and updating a content file to verify the content updates without changing React code logic.

**Acceptance Scenarios**:

1. **Given** a user accesses any static info page on a mobile device or narrow screen, **When** the content renders, **Then** text wraps naturally without horizontal overflow or tiny unreadable fonts.
2. **Given** a maintainer updates the content file for a page, **When** the page is reloaded, **Then** the new text and formatting display immediately without modifying React component logic.

---

### Edge Cases

- What happens if a static content file is missing or failing to load? The system SHOULD display a clean, user-friendly fallback error message (e.g. "Nội dung đang được cập nhật, vui lòng thử lại sau") with navigation options back to home.
- What happens if a user accesses a static page URL directly via deep link without logging in? The static page MUST render completely for unauthenticated visitors without triggering an authentication redirect or auth modal.
- What happens on extremely long document pages? Page layout SHOULD include comfortable typography, max-width content containers, and smooth scrolling to top when navigating between pages.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a single shared Footer component (`Footer`) rendered on all public pages of the website.
- **FR-002**: System MUST include 4 distinct navigation links organized under 2 Footer columns matching the site layout:
  - Column **"Về công ty chúng tôi"**:
    1. "Về chúng tôi" pointing to `/about-us`
    2. "Điều khoản website" pointing to `/website-terms`
  - Column **"Dành cho Khách hàng"**:
    3. "Điều khoản sử dụng" pointing to `/terms-of-service`
    4. "Chính sách hoàn vé" pointing to `/refund-policy`
- **FR-003**: System MUST route each of the 4 routes (`/about-us`, `/terms-of-service`, `/website-terms`, `/refund-policy`) to dedicated static information view components.
- **FR-004**: System MUST allow public access to all 4 static information pages without requiring user authentication or authorization.
- **FR-005**: System MUST render each page's content with proper formatting, preserving headings, paragraphs, and lists according to the original document structure.
- **FR-006**: System MUST display an explicit title header for each static information page corresponding to its topic.
- **FR-007**: System MUST load static document contents from separated `.md` Markdown files in a content asset directory parsed by a Markdown renderer component, allowing content updates without editing React source code.
- **FR-008**: System MUST render static info pages responsively across screen sizes (mobile viewports down to 320px and desktop viewports up to 4K).

### Key Entities *(include if feature involves data)*

- **StaticDocument**: Represents a static information page's content document.
  - `id`: Unique identifier matching the route (e.g., `about-us`, `terms-of-service`, `website-terms`, `refund-policy`).
  - `title`: Display title of the static page (e.g., "Về chúng tôi").
  - `route`: URL path for accessing the document.
  - `category`: Footer column category (`Về công ty chúng tôi` or `Dành cho Khách hàng`).
  - `content`: Raw Markdown document string containing headings, paragraphs, and lists.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of website pages present the unified Footer containing all 4 static page links correctly grouped into "Về công ty chúng tôi" and "Dành cho Khách hàng".
- **SC-002**: 100% of the 4 static info routes (`/about-us`, `/terms-of-service`, `/website-terms`, `/refund-policy`) load successfully without authentication.
- **SC-003**: Document text formatting (headings, lists, paragraphs) matches original document structure across 100% of static info pages.
- **SC-004**: Static info page layouts achieve mobile responsiveness with zero horizontal scroll bar artifacts on viewports >= 320px width.
- **SC-005**: Updating content in a `.md` Markdown content file reflects on the webpage without editing React UI component code.

## Assumptions

- **Content Storage**: Document contents are stored as `.md` Markdown files in a content directory (`src/assets/docs/` or `public/docs/`) and rendered dynamically by a Markdown component.
- **Footer Structure**: Footer columns follow the existing visual pattern with "Về công ty chúng tôi" and "Dành cho Khách hàng" section headers.
- **Document Source Files**: The initial contents for the 4 pages will be copied into the Markdown files from the specified folder `D:\HCMUS\NhapMonCongNghePhanMem\Project\source\IntroSE\docs\AboutUsInformation` during implementation.
- **Layout Consistency**: All 4 static pages will use a standardized container layout with clean typography (max content width ~800px to 1000px for optimal readability).
