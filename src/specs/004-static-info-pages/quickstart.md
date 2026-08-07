# Quickstart Validation Guide: Static Info Pages

This guide outlines step-by-step verification procedures to validate the implementation of 4 static info pages and the shared Footer component.

---

## Prerequisites & Installation

1. Ensure `react-markdown` is installed:
   ```bash
   npm install react-markdown
   ```
2. Verify content Markdown files exist in `src/content/legal/`:
   - `src/content/legal/about-us.md`
   - `src/content/legal/terms-of-service.md`
   - `src/content/legal/website-terms.md`
   - `src/content/legal/refund-policy.md`

---

## Verification Scenarios

### Scenario 1: Footer Navigation Links Verification

1. Start dev server: `npm run dev`
2. Open home page `http://localhost:5173/` in browser.
3. Scroll down to the Footer.
4. Verify two categorized columns are visible:
   - **Về công ty chúng tôi**: contains "Về chúng tôi" and "Điều khoản website"
   - **Dành cho Khách hàng**: contains "Điều khoản sử dụng" and "Chính sách hoàn vé"
5. Click each link and confirm navigation to the respective URL:
   - Click "Về chúng tôi" → URL changes to `/about-us`
   - Click "Điều khoản sử dụng" → URL changes to `/terms-of-service`
   - Click "Điều khoản website" → URL changes to `/website-terms`
   - Click "Chính sách hoàn vé" → URL changes to `/refund-policy`

---

### Scenario 2: Unauthenticated Direct Deep-Link Access

1. Open a new incognito window (unauthenticated state).
2. Enter `http://localhost:5173/refund-policy` directly into the address bar.
3. **Expected Result**: Page renders cleanly without triggering login modal or redirecting to home.

---

### Scenario 3: Markdown Formatting & Content Accuracy

1. Navigate to `/about-us`.
2. Verify headings (`h1`, `h2`), paragraphs, and bullet lists render with proper typography and spacing matching the original document structure.
3. Edit `src/content/legal/about-us.md` (add a temporary paragraph).
4. Save and check browser: Content updates immediately without modifying `LegalPage.tsx` or React component code.

---

### Scenario 4: Responsive Viewport Verification

1. Open DevTools and switch viewport to Mobile (375px width).
2. Navigate through each static page and the Footer.
3. **Expected Result**: Text wraps naturally, zero horizontal scrollbar appears, and footer links wrap stacked vertically.
