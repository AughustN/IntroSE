# Research: Static Information Pages & Shared Footer Navigation

## Executive Summary

This research establishes the technical approach for adding 4 static information pages ("Về chúng tôi", "Điều khoản sử dụng", "Điều khoản website", "Chính sách hoàn vé") accessible via a shared `Footer` component on all pages without authentication.

---

## Technical Decisions & Rationale

### 1. Markdown Parsing Library (`react-markdown`)

- **Decision**: Use `react-markdown` to render raw Markdown text from `.md` files into React components.
- **Rationale**: `react-markdown` is the standard lightweight React library for parsing GFM/Markdown. It produces clean semantic HTML elements (`<h1>`-`<h6>`, `<p>`, `<ul>`, `<ol>`, `<li>`, `<a>`, `<blockquote>`) without needing `dangerouslySetInnerHTML`.
- **Alternatives Considered**:
  - `marked` / `dangerouslySetInnerHTML`: Rejected due to potential XSS vectors and manually parsing HTML elements.
  - Raw HTML string files: Rejected because user specified Markdown `.md` files for ease of editing.

### 2. Markdown File Storage & Dynamic Importing (`src/content/legal/`)

- **Decision**: Store Markdown content files inside `src/content/legal/`:
  - `about-us.md`
  - `terms-of-service.md`
  - `website-terms.md`
  - `refund-policy.md`
- **Import Strategy**: Vite raw import syntax (`import rawContent from './file.md?raw'`) or raw fetch string loader. Vite's standard `?raw` suffix allows bundling Markdown files as raw text strings directly at build time without network latency.
- **Rationale**: Keeps content separate from React component code and requires zero API endpoints or database queries.

### 3. Single Reusable Component (`LegalPage.tsx`)

- **Decision**: Implement a single component `src/components/LegalPage.tsx` accepting `title: string` and `content: string` (or `slug: string`).
- **Rationale**: Prevents code duplication across 4 separate pages. All static info pages share identical layout structure, heading styling, content container, and responsive behavior.

### 4. Centralized Route Integration (`src/routes.ts` & `App.tsx`)

- **Decision**: Extend `Screen` union type in `src/routes.ts` with `"about-us" | "terms-of-service" | "website-terms" | "refund-policy"`, and register their static paths in `STATIC_PATHS`:
  - `["about-us", "/about-us"]`
  - `["terms-of-service", "/terms-of-service"]`
  - `["website-terms", "/website-terms"]`
  - `["refund-policy", "/refund-policy"]`
- **Rationale**: Aligns with the project's existing custom SPA router state machine in `routes.ts` and `App.tsx`.

### 5. Shared `Footer` Component (`src/components/Footer.tsx`)

- **Decision**: Refactor the inline `<footer>` element in `App.tsx` into a modular `src/components/Footer.tsx` component. Group the 4 static page links into two distinct sections matching the site's design:
  - **"Về công ty chúng tôi"**: Link to `/about-us`, Link to `/website-terms`
  - **"Dành cho Khách hàng"**: Link to `/terms-of-service`, Link to `/refund-policy`
- **Rationale**: Provides consistent footer navigation across every screen rendered by `App.tsx`. Uses `react-router-dom` `Link` (or route navigation helper) so page transitions happen smoothly without full page reloads.

---

## Constitution & Security Evaluation

- **Principle II (Security & Trust by Default)**: Public static info pages do not consume user data or perform state changes. No auth checks required. `react-markdown` safely sanitizes rendered content.
- **Principle V (Simplicity & YAGNI)**: Zero backend endpoints needed; static Markdown files bundled via Vite `?raw` imports.
- **Principle VI (Clean Codebase & Seamless FE/BE)**: Single reusable `LegalPage.tsx` component and clean route additions maintain single-author codebase consistency.
