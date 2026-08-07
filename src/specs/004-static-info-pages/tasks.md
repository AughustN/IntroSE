# Tasks: Static Information Pages & Shared Footer Navigation

**Input**: Design documents from `/specs/004-static-info-pages/`

**Prerequisites**: `plan.md` (required), `spec.md` (required for user stories), `research.md`, `data-model.md`, `contracts/legal-page-contract.md`, `quickstart.md`

**Tests**: Verification via runnable scenarios defined in `quickstart.md` and TypeScript compile check (`npm run build`).

**Organization**: Tasks are grouped by User Story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Includes exact file paths in all task descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependency installation and content asset directory initialization

- [x] T001 Install `react-markdown` library in `src/package.json`
- [x] T002 [P] Create legal content directory `src/content/legal/`
- [x] T003 [P] Copy and format `about-us.md` content in `src/content/legal/about-us.md`
- [x] T004 [P] Copy and format `terms-of-service.md` content in `src/content/legal/terms-of-service.md`
- [x] T005 [P] Copy and format `website-terms.md` content in `src/content/legal/website-terms.md`
- [x] T006 [P] Copy and format `refund-policy.md` content in `src/content/legal/refund-policy.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Centralized route definitions required before rendering static page components

**⚠️ CRITICAL**: Route resolution must be defined before UI navigation can be wired

- [x] T007 Add `about-us`, `terms-of-service`, `website-terms`, and `refund-policy` to `Screen` type and `STATIC_PATHS` registry in `src/routes.ts`

**Checkpoint**: Foundation ready - route system supports static info page paths

---

## Phase 3: User Story 1 - Access Static Info Pages from Categorized Shared Footer (Priority: P1) 🎯 MVP

**Goal**: Display navigation links to all 4 static pages categorized under "Về công ty chúng tôi" and "Dành cho Khách hàng" within a shared `Footer` component across all pages.

**Independent Test**: Navigate to any page, scroll to footer, verify the two categorized columns, click each link, and confirm address bar updates to the target path without authentication.

### Implementation for User Story 1

- [x] T008 [US1] Create modular `Footer` component in `src/components/Footer.tsx` with links organized under "Về công ty chúng tôi" (`/about-us`, `/website-terms`) and "Dành cho Khách hàng" (`/terms-of-service`, `/refund-policy`)
- [x] T009 [US1] Replace inline footer elements in `src/App.tsx` with the new `Footer` component
- [x] T010 [US1] Update `App` navigation state handling in `src/App.tsx` to process static route transitions from `Footer` links

**Checkpoint**: User Story 1 is functional — links appear in footer and route URLs change on click across all pages.

---

## Phase 4: User Story 2 - Read Formatted Static Document Content (Priority: P1)

**Goal**: Render structured Markdown content (headings, paragraphs, bullet lists) accurately for each static page URL using a single reusable `LegalPage.tsx` component.

**Independent Test**: Navigate to `/about-us`, `/terms-of-service`, `/website-terms`, and `/refund-policy` to verify that document title, heading hierarchy, and list formatting render properly.

### Implementation for User Story 2

- [x] T011 [US2] Implement reusable `LegalPage` component in `src/components/LegalPage.tsx` using `react-markdown` to render raw Markdown strings into GFM HTML elements
- [x] T012 [US2] Import Markdown files (`?raw`) and render `LegalPage` views for `/about-us`, `/terms-of-service`, `/website-terms`, and `/refund-policy` inside `src/App.tsx`

**Checkpoint**: User Story 2 is functional — all 4 static pages render formatted document text matching the original files.

---

## Phase 5: User Story 3 - Responsive and Maintenance-Friendly Static Pages (Priority: P2)

**Goal**: Ensure mobile and desktop viewport responsiveness and decoupled content updating without editing React component code.

**Independent Test**: Switch viewport to 375px mobile view to confirm zero horizontal overflow, and modify a `.md` content file in `src/content/legal/` to verify immediate hot-reloading update.

### Implementation for User Story 3

- [x] T013 [US3] Add responsive container constraints (`max-w-4xl`), padding, typography styling, and dark/light mode compatibility in `src/components/LegalPage.tsx` and `src/index.css`
- [x] T014 [US3] Verify content independence by updating a test paragraph in `src/content/legal/about-us.md` without modifying React source code

**Checkpoint**: All 3 user stories functional and fully responsive across screen sizes.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verification and quality assurance

- [x] T015 [P] Run TypeScript compiler check (`npm run build`) to ensure zero type errors in `src/`
- [x] T016 Execute quickstart validation scenarios defined in `specs/004-static-info-pages/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Can start immediately.
- **Foundational (Phase 2)**: Depends on Setup (T001-T006). Blocks User Stories.
- **User Story 1 (Phase 3)**: Depends on Foundational (T007).
- **User Story 2 (Phase 4)**: Depends on User Story 1 (T008-T010).
- **User Story 3 (Phase 5)**: Depends on User Story 2 (T011-T012).
- **Polish (Phase 6)**: Depends on all User Stories completion.

---

## Parallel Execution Opportunities

- Tasks **T002**, **T003**, **T004**, **T005**, **T006** can run in parallel during Setup.
- Task **T015** can run in parallel with polish checks.

---

## Implementation Strategy

### MVP Scope (User Stories 1 & 2)

1. Complete Phase 1 (Setup: Markdown files & `react-markdown`)
2. Complete Phase 2 (Foundational: Routes definition in `src/routes.ts`)
3. Complete Phase 3 (US1: `Footer.tsx` component & routing)
4. Complete Phase 4 (US2: `LegalPage.tsx` Markdown renderer)
5. **STOP and VALIDATE**: Verify all 4 routes and Footer navigation links.
