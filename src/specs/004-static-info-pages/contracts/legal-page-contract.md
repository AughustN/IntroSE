# UI Contract: LegalPage & Footer Components

## 1. Route Specifications

| Route Path | Screen Identifier | Title | Source File | Footer Section |
|------------|-------------------|-------|-------------|----------------|
| `/about-us` | `about-us` | Về chúng tôi | `src/content/legal/about-us.md` | Về công ty chúng tôi |
| `/terms-of-service` | `terms-of-service` | Điều khoản sử dụng | `src/content/legal/terms-of-service.md` | Dành cho Khách hàng |
| `/website-terms` | `website-terms` | Điều khoản website | `src/content/legal/website-terms.md` | Về công ty chúng tôi |
| `/refund-policy` | `refund-policy` | Chính sách hoàn vé | `src/content/legal/refund-policy.md` | Dành cho Khách hàng |

---

## 2. Component Contracts

### `LegalPage.tsx`

- **Location**: `src/components/LegalPage.tsx`
- **Props**:
  - `title: string` — Page display title
  - `content: string` — Raw Markdown string to be rendered via `react-markdown`
- **Container Styling Requirements**:
  - Max width: `max-w-4xl` (~896px) for optimal reading line length.
  - Padding: `px-4 py-8 sm:px-6 sm:py-12 lg:px-8`.
  - Typography: Clean headings (`h1`, `h2`, `h3`), comfortable paragraph line height (`leading-relaxed`), structured bullet/numbered list spacing.
  - Theme compatibility: Dark and light theme colors matching project palette (`text-beige-kem`, `bg-surface`, etc.).

### `Footer.tsx`

- **Location**: `src/components/Footer.tsx`
- **Structure**:
  - Rendered at the bottom of `App.tsx` on all screens.
  - Two categorized columns:
    1. **"Về công ty chúng tôi"**:
       - `Link` to `/about-us` ("Về chúng tôi")
       - `Link` to `/website-terms` ("Điều khoản website")
    2. **"Dành cho Khách hàng"**:
       - `Link` to `/terms-of-service` ("Điều khoản sử dụng")
       - `Link` to `/refund-policy` ("Chính sách hoàn vé")
  - Branding and copyright footer notice.
- **Responsiveness**: Flex/grid wrapping smoothly on mobile screens (`flex-col md:flex-row`).
