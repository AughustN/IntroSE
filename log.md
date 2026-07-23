# Project Log

## Version of req

Dependencies installed for the monorepo (`npm install`), branch `BE`, 2026-07-23.

### Runtime dependencies

| Package | Version | Role |
|---|---|---|
| express | 4.22.2 | REST API |
| pg | 8.22.0 | PostgreSQL driver |
| bcrypt | 6.0.0 | password hashing (cost 12) |
| sharp | 0.35.3 | avatar re-encode / strip EXIF |
| jsonwebtoken | 9.0.3 | access token |
| google-auth-library | 9.15.1 | verify Google ID token |
| resend | 4.8.0 | transactional email (password reset) |
| multer | 2.2.0 | multipart avatar upload |
| zod | 3.25.76 | strict schema validation |
| cookie-parser | 1.4.7 | refresh cookie |
| uuid | 11.1.1 | random avatar filenames |
| dotenv | 17.x | env loading |
| react | 19.2.7 | SPA |
| react-dom | 19.x | SPA |
| lucide-react | ^1.17.0 | icons (FE) |
| motion | ^12.23.24 | animation (FE) |
| @google/genai | ^2.4.0 | Gemini (AI features) |

### Dev dependencies

| Package | Version |
|---|---|
| vite | 6.4.3 |
| @vitejs/plugin-react | 5.2.0 |
| @tailwindcss/vite / tailwindcss | 4.1.x |
| typescript | ~5.8.2 |
| tsx | 4.22.4 |
| vitest / @vitest/coverage-v8 | 2.1.9 |
| eslint | ^9.17.0 |
| prettier | ^3.4.2 |
| @types/* | node 22.x, express, pg, bcrypt, jsonwebtoken, multer, cookie-parser |

### Security bumps applied during install

- **bcrypt 5.1.1 → 6.0.0** — drops the `node-pre-gyp → tar` chain (was critical + high). Cost-12 API unchanged.
- **sharp 0.33.5 → 0.35.3** — patches libvips CVEs (high). Matters because sharp processes untrusted uploaded images (ADR 0004).
- **multer 1.4.5-lts → 2.2.0** — 1.x deprecated / vulnerable.

### Final `npm audit --omit=dev`

- **0 critical, 0 high.**
- **2 moderate (accepted)**: transitive `gaxios → uuid` inside `google-auth-library`. Not fixable without an upstream update; the vulnerable `uuid` path (`buf`-bounds) is not reached by gaxios's usage.

### Notes

- Node engine warning: `@vitejs/plugin-react` wants Node ≥ 22.12; machine runs 22.10 → warning only, builds fine. Upgrade Node to silence.
- `sharp` native binary builds/loads OK on Windows; `resend` (ESM) loads OK.
