# Cloudinary Media Architecture & Migration Guide

## 1. Overview
All binary and media uploads across TixHub (event banners, video trailers, user profile avatars, organizer application logos, venue floor plans, and designer reference charts) are streamed directly to Cloudinary without persisting raw or temporary binary files to the server's local file system.

## 2. Environment Configuration
Add the following keys to your `.env` configuration:

```env
# Cloudinary Media Storage Configuration
CLOUDINARY_CLOUD_NAME="your_cloud_name"
CLOUDINARY_API_KEY="your_api_key"
CLOUDINARY_API_SECRET="your_api_secret"
```

> **Fallback Mode**: If Cloudinary credentials are not defined in testing or offline local development environments, the backend automatically generates deterministic mock Cloudinary CDN URLs (`https://res.cloudinary.com/...`) and safely completes requests without crashing.

## 3. Deterministic Storage Hierarchy
Media files are stored under deterministic folder hierarchies with standardized naming to ensure automatic in-place cache invalidation and prevent orphan accumulation:

| Media Type | Cloudinary Folder Path | Public ID Pattern | Sanitization & Specs |
| :--- | :--- | :--- | :--- |
| **Event Banner** | `tixhub/events/{event_id}/banner/` | `{event_id}` | Magic bytes sniffed, EXIF stripped, WebP format, <= 5MB |
| **Event Trailer Video** | `tixhub/events/{event_id}/trailer/` | `{event_id}` | Magic bytes sniffed (MP4/WebM), fast-start enabled, <= 50MB |
| **User Profile Avatar** | `tixhub/users/{user_id}/avatar/` | `{user_id}` | WebP format, 512x512 square crop, <= 2MB |
| **Organizer Logo** | `tixhub/organizers/{organizer_id}/logo/` | `{organizer_id}` | WebP format, 512x512 square crop, <= 2MB |
| **Venue Floor Plan** | `tixhub/layouts/{layout_id}/floorplan/` | `{layout_id}` | WebP format (safe SVG rasterized), <= 5MB |
| **Reference Tracing Chart**| `tixhub/layouts/{layout_id}/reference/` | `{layout_id}` | WebP format (safe SVG rasterized), <= 5MB |

## 4. Client-Side Staging & UX Guarantees
- **Instant Preview**: The reusable `<MediaDropzone />` component creates local blob object URLs (`URL.createObjectURL`), delivering instant visual previews (< 100ms) with zero cloud network overhead.
- **Form Abandonment Safe**: No network upload requests are sent to Cloudinary until the user explicitly commits the form (e.g. clicking "Lưu sự kiện" or "Gửi đơn").
- **Automatic Memory Cleanup**: Previous object URLs are revoked (`URL.revokeObjectURL`) upon component unmount, replacement, or file removal.

## 5. Security & Attack Prevention
1. **Magic Bytes Validation**: File extensions and client `Content-Type` headers are never trusted. All buffers are inspected for signature headers (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF...WEBP`, MP4 `ftyp`, WebM `1A 45 DF A3`).
2. **SVG Threat Neutralization**: SVGs are pre-screened for SSRF external references, `<script>` injection, `<foreignObject>`, and entity bombs (`<!ENTITY`), then rasterized to WebP via Sharp before cloud upload.
3. **Decompression Bomb Protection**: Input dimensions are verified before memory allocation. Max dimensions: 8192px per side.

## 6. Legacy Disk Migration CLI
To migrate legacy assets stored on local disk under `/uploads/` to Cloudinary:

```bash
npm run db:migrate-cloudinary
```
The script reads `users.avatar_url`, `venue_layouts.plan_url`, `venue_layouts.reference_url`, and `organizers.logo_url`, uploads existing local files to Cloudinary, updates DB URLs to secure Cloudinary CDN URLs, and deletes migrated local files.
