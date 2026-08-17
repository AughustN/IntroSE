# Research & Technical Decisions: Cloudinary Media Upload Migration

**Feature**: `012-cloudinary-media-upload` | **Date**: 2026-08-17

This document captures the technical evaluations, architectural decisions, and integration patterns for migrating all local and external media uploads to Cloudinary with a staged client-side submission strategy.

---

## 1. Cloudinary Integration & Storage Client

### Decision
Use the official `cloudinary` Node.js SDK on the server (`server/src/services/cloudinary.ts`), initialized from environment variables (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`). Use `cloudinary.v2.uploader.upload_stream` to pipe sanitized buffers directly from memory to Cloudinary without writing intermediate files to disk.

### Rationale
- **Zero Local Disk Writes**: Uploading via streams eliminates the need for temporary directories (`uploads/tmp`), avoiding disk cleanup cron jobs or concurrency race conditions.
- **Secure Credentials**: API secrets remain strictly confined to the backend server.
- **Configurable CDN URLs**: Returns secure `https://res.cloudinary.com/...` URLs with automatic CDN optimization.

### Alternatives Considered
- *Direct browser uploads via signed presets*: Offloads traffic from server, but bypasses the server-side magic-byte inspection and `sharp` re-encoding required by Principle II and ADR-0004.
- *Local VPS disk storage*: The legacy approach (`uploads/avatars/`, `uploads/floorplans/`), which is non-scalable, complicates VPS migrations, and is decommissioned by this feature.

---

## 2. Server-Mediated Sanitization & Validation Pipeline

### Decision
All uploads pass through a unified backend validation and sanitization pipeline prior to being dispatched to Cloudinary:

1. **Magic-Byte Inspection**: Inspect initial buffer bytes to verify actual image/video file signatures (`detectImage` for JPEG/PNG/WebP, magic bytes for MP4/WebM), refusing disguised scripts/executables.
2. **Dimension Bomb Defense**: Read image metadata before allocating decoded pixel buffers; reject images exceeding 8192px on any dimension.
3. **SVG Sanitization**: Reject SVGs containing `<script>`, `<foreignObject>`, `<!DOCTYPE` entity bombs, or external URL/file references. Rasterize safe SVGs to WebP at 150 DPI before uploading.
4. **EXIF Stripping & WebP Optimization**: Strip all camera metadata and re-encode raster images to WebP (quality 80–82).
5. **Video Verification**: Check container format and enforce max size boundary (≤ 50MB) before streaming with `resource_type: "video"`.

### Rationale
Centralizing validation on the backend protects against malicious uploads, remote code execution, and SSRF attacks before assets reach public CDN storage.

---

## 3. Deterministic Folder Structure & Public ID Convention

### Decision
Organize Cloudinary assets into a deterministic directory hierarchy where `public_id` corresponds to the parent entity's database ID:

| Media Type | Cloudinary Folder Path | Public ID Pattern | Resource Type |
|---|---|---|---|
| **Event Banner** | `tixhub/events/{event_id}/banner` | `{event_id}` | `image` |
| **Event Trailer** | `tixhub/events/{event_id}/trailer` | `{event_id}` | `video` |
| **Event Gallery** | `tixhub/events/{event_id}/gallery` | `{asset_uuid}` | `image` |
| **User Avatar** | `tixhub/users/{user_id}/avatar` | `{user_id}` | `image` |
| **Organizer Logo** | `tixhub/organizers/{organizer_id}/logo` | `{organizer_id}` | `image` |
| **Floor Plan** | `tixhub/layouts/{layout_id}/floorplan` | `{layout_id}` | `image` |
| **Reference Chart** | `tixhub/layouts/{layout_id}/reference` | `{layout_id}` | `image` |

Upload options specify `overwrite: true, invalidate: true` to overwrite existing files upon replacement and immediately bust CDN caches.

### Rationale
- **Zero Duplicate Proliferation**: Re-uploading an avatar, banner, or floor plan updates the asset in place rather than creating dangling UUIDs.
- **Predictable Deletions**: Deleting an entity or removing an attachment uses the known `public_id` directly without database lookup ambiguities.

---

## 4. Staged Local Upload UX Flow ("Stage Locally, Upload on Submit")

### Decision
Implement a two-phase staging workflow in frontend forms:

1. **Phase 1: Local Staging (Selection)**:
   - When the user selects or drops a file, the browser creates an in-memory object URL (`URL.createObjectURL(file)`).
   - The UI immediately displays a visual preview (<100ms) with replace/remove controls.
   - The raw `File` object is held in React state (`stagedFile`). No HTTP request is sent.
2. **Phase 2: Execution (Submit)**:
   - When the user clicks the form submit button, the button enters a disabled state with a progress indicator ("Đang tải lên media...").
   - The frontend transmits the staged file(s) via `multipart/form-data` to the backend.
   - For new records, the backend generates/reserves the entity record ID, processes and uploads the file to Cloudinary, and saves the resulting CDN URL in the database record.
   - Upon completion, the form completes its submit cycle.
3. **Phase 3: Form Abandonment**:
   - If the user clicks "Hủy", closes a modal, or navigates away, React cleans up the object URL (`URL.revokeObjectURL(previewUrl)`). Zero network requests occur.

### Rationale
Eliminates orphaned assets in Cloudinary caused by abandoned drafts or incomplete forms.

---

## 5. Active Remote Deletion & Cleanup

### Decision
When an optional media asset (e.g. event trailer, floor plan, or reference chart) is explicitly removed in an edit form, or when an entity is deleted:
- The backend invokes `cloudinary.v2.uploader.destroy(publicId, { resource_type })`.
- The database record's URL column is set to `NULL`.

### Rationale
Prevents accumulating stale, unreachable files in the Cloudinary tenant.

---

## 6. Legacy Asset Migration & Backfill Strategy

### Decision
Provide a migration script (`server/src/db/migrate-cloudinary.ts`) executable via `npm run db:migrate-cloudinary`:
1. Scans existing database records with local file references:
   - `users.avatar_url` containing `/uploads/avatars/`
   - `venue_layouts.plan_url` containing `/uploads/floorplans/`
   - `venue_layouts.reference_url` containing `/uploads/`
   - `organizers.logo_url` containing `/uploads/`
2. Reads the local files from the `uploads/` directory on disk.
3. Uploads each file to its corresponding Cloudinary folder using the entity's ID as `public_id`.
4. Updates the database row with the new Cloudinary HTTPS URL in an ACID transaction.
5. Decommissions Express `/uploads` static file serving in `server/src/app.ts`.

### Rationale
Ensures an orderly transition from local disk storage to Cloudinary with zero broken links across existing accounts and layouts.
