# Data Model: Static Information Pages & Shared Footer Navigation

## Static Content Entity Definition

While this feature operates entirely in the frontend without a database schema, the static information documents follow a structured frontend data model.

### 1. `LegalDocument` Entity

Represents a static legal or platform information document.

| Field Name | Type | Description | Example |
|------------|------|-------------|---------|
| `slug` | `string` | Unique identifier matching URL path segment | `"about-us"` |
| `title` | `string` | Display title shown in page header | `"Về chúng tôi"` |
| `route` | `string` | Canonical URL route path | `"/about-us"` |
| `category` | `"company" \| "customer"` | Footer section grouping | `"company"` |
| `content` | `string` | Raw Markdown content loaded from `.md` file | `"# Về chúng tôi\n\nTixHub là..."` |

### 2. Static Document Registry Map

```typescript
export interface LegalDocConfig {
  slug: string;
  title: string;
  route: string;
  category: "company" | "customer";
  rawContent: string;
}
```

#### Pre-registered Documents:

1. **About Us (`/about-us`)**
   - Slug: `about-us`
   - Title: `Về chúng tôi`
   - Category: `Về công ty chúng tôi` (`company`)
   - Source File: `src/content/legal/about-us.md`

2. **Terms of Service (`/terms-of-service`)**
   - Slug: `terms-of-service`
   - Title: `Điều khoản sử dụng`
   - Category: `Dành cho Khách hàng` (`customer`)
   - Source File: `src/content/legal/terms-of-service.md`

3. **Website Terms (`/website-terms`)**
   - Slug: `website-terms`
   - Title: `Điều khoản website`
   - Category: `Về công ty chúng tôi` (`company`)
   - Source File: `src/content/legal/website-terms.md`

4. **Refund Policy (`/refund-policy`)**
   - Slug: `refund-policy`
   - Title: `Chính sách hoàn vé`
   - Category: `Dành cho Khách hàng` (`customer`)
   - Source File: `src/content/legal/refund-policy.md`

---

## Component Interface Contracts

### `LegalPageProps`

```typescript
export interface LegalPageProps {
  title: string;
  content: string;
  onBack?: () => void;
}
```

### `FooterProps`

```typescript
export interface FooterProps {
  onNavigate?: (path: string) => void;
}
```
