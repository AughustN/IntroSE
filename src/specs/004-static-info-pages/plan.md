# Implementation Plan: Static Information Pages & Shared Footer Navigation

**Branch**: `004-static-info-pages` | **Date**: 2026-08-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-static-info-pages/spec.md`

## Summary

Implement 4 static information pages ("Về chúng tôi", "Điều khoản sử dụng", "Điều khoản website", "Chính sách hoàn vé") accessible via a shared `Footer` component across all pages without authentication. Store page contents as `.md` Markdown files in `src/content/legal/`, render them using `react-markdown` inside a single reusable `LegalPage.tsx` component, register routes in `src/routes.ts`, and update the shared `Footer` layout in `App.tsx`.

## Technical Context

**Language/Version**: TypeScript / React 18 (Vite SPA)

**Primary Dependencies**: `react-router-dom`, `react-markdown`, `lucide-react`

**Storage**: Local `.md` static content files in `src/content/legal/` (imported via Vite `?raw` loaders)

**Testing**: Browser navigation verification, responsive layout checks, and build validation (`npm run build` / type-check)

**Target Platform**: Modern web browsers (Desktop & Mobile viewports down to 320px)

**Project Type**: Single Page Web Application (React SPA)

**Performance Goals**: Instant rendering (<50ms) of local bundled Markdown static documents

**Constraints**: Public access (no authentication required), reusable `LegalPage.tsx` component, clean responsive layout

**Scale/Scope**: 4 static pages, 1 shared reusable page component, 1 shared Footer component

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle II (Security & Trust by Default)**: Public static pages do not process sensitive data or perform user state mutations. Safe GFM HTML output via `react-markdown`. (PASS)
- **Principle V (Simplicity & YAGNI)**: No backend API or database endpoints required. Local Markdown files bundled via Vite `?raw` imports. (PASS)
- **Principle VI (Clean Codebase & Seamless FE/BE Integration)**: Single reusable `LegalPage.tsx` component, centralized route definitions in `routes.ts`, modular `Footer.tsx` component. (PASS)

## Project Structure

### Documentation (this feature)

```text
specs/004-static-info-pages/
├── plan.md              # Implementation plan
├── research.md          # Technical research & decisions
├── data-model.md        # Static document frontend data model
├── quickstart.md        # Validation guide
└── contracts/
    └── legal-page-contract.md  # UI component & route contract
```

### Source Code Layout

```text
src/
├── components/
│   ├── LegalPage.tsx    # Reusable Markdown page view component
│   └── Footer.tsx       # Shared footer component with categorized links
├── content/
│   └── legal/
│       ├── about-us.md
│       ├── terms-of-service.md
│       ├── website-terms.md
│       └── refund-policy.md
├── routes.ts            # Route constants, screen definitions & route resolution logic
└── App.tsx              # Main application shell incorporating Header, Page Views & Footer
```

**Structure Decision**: Single project layout matching existing Vite React codebase structure.

## Phase 0: Research

All technical choices (`react-markdown`, Vite `?raw` Markdown loading, reusable `LegalPage.tsx`, centralized routes in `src/routes.ts`, categorized `Footer` layout) documented in [research.md](./research.md).

## Phase 1: Design & Contracts

- Data model defined in [data-model.md](./data-model.md).
- Interface contracts defined in [contracts/legal-page-contract.md](./contracts/legal-page-contract.md).
- Runnable validation guide created in [quickstart.md](./quickstart.md).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| *None* | *Fully compliant with Constitution* | *N/A* |
