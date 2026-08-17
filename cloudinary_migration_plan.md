# Cloudinary Migration Plan — All Media Uploads

**Purpose**: Move every file/media upload currently saved to local VPS disk (or accepted only as an external URL string) into Cloudinary, using one consistent folder convention.

**Status**: Planning only — no code changed yet. This document is for review before implementation.

---

## 1. Proposed Cloudinary Folder Structure

Based on the structure already in use for the movie event batch (`tixhub/events/{event_id}/banner/`, `tixhub/events/{event_id}/trailer/`), extended to cover every media type in the project:

```
tixhub/
├── events/
│   └── {event_id}/
│       ├── banner/         → event poster/banner image
│       ├── trailer/        → event trailer video
│       └── gallery/        → optional additional event images
├── organizers/
│   └── {organizer_id}/
│       └── logo/           → organizer application logo
├── users/
│   └── {user_id}/
│       └── avatar/         → user profile avatar
└── layouts/
    └── {layout_id}/
        ├── floorplan/      → venue floor plan / architectural background image
        └── reference/      → seat-map tracing/reference chart image
```

**Naming rule**: use the entity's own database ID as the Cloudinary `public_id` (not the original filename), so re-uploads overwrite the existing asset instead of creating duplicates.

---

## 2. Feature-by-Feature Migration Summary

| # | Feature | Current State | Save Trigger (When) | New Cloudinary Path |
|---|---|---|---|---|
| 1 | **User Avatar Upload** | Already a file upload (not URL). Saved locally via `sharp` re-encode to WebP at `uploads/avatars/<uuid>.webp` | On avatar file select in Account Settings → immediate upload via `POST /api/me/avatar` | `tixhub/users/{user_id}/avatar/` |
| 2 | **Seat Map Floor Plan Upload** | Already a file upload. Saved locally via `POST /api/organizer/layouts/:id/floorplan`, throttled, EXIF-stripped, resized to WebP | On floor plan file select in the layout designer's Floor Plan panel | `tixhub/layouts/{layout_id}/floorplan/` |
| 3 | **Seat Map Reference/Tracing Chart Upload** | Already a file upload. Saved locally via `POST /api/organizer/layouts/:id/reference`, same pipeline as floor plan | On reference chart file select in the designer's Reference Chart panel | `tixhub/layouts/{layout_id}/reference/` |
| 4 | **Event Poster/Banner** | **URL-only today** — organizer pastes an existing HTTPS image URL; no file upload occurs | *To change*: on banner file select in the Create/Edit Event form | `tixhub/events/{event_id}/banner/` |
| 5 | **Organizer Application Logo** | **URL-only today** — applicant pastes an existing HTTPS URL | *To change*: on logo file select in the Organizer Application form | `tixhub/organizers/{organizer_id}/logo/` |
| 6 | **Event Trailer Video** | **URL-only today** — organizer pastes a direct `.mp4`/`.webm` link or external Cloudinary link; the player just consumes the URL string | *To change*: on trailer file select in the Create/Edit Event form | `tixhub/events/{event_id}/trailer/` |

---

## 3. Upload Timing Strategy — Stage Locally, Upload Only on Confirmed Submit

To avoid pushing files to Cloudinary before the user actually confirms they want to keep them (e.g. an organizer picks a banner image and video but then abandons the "Create Event" form without submitting), **no file is uploaded to Cloudinary at the moment it's selected**. Instead:

1. **On file select**: the file is held client-side only (e.g. as a local object URL for instant preview). Nothing is sent to the server or Cloudinary yet.
2. **User keeps filling out the rest of the form** — the pending file just sits in local component state.
3. **On form submit/confirm** (e.g. "Hoàn Tất Tạo Sự Kiện", "Lưu Thay Đổi", "Gửi Đơn"):
   - The pending file(s) are uploaded to Cloudinary first.
   - The returned Cloudinary URL(s) are then used when creating/updating the underlying database record, in the same submit action.
   - The submit button shows an uploading/progress state so the form doesn't appear to hang.
4. **If the user cancels or navigates away without submitting**, the file is simply discarded from local state — nothing was ever sent to Cloudinary, so no orphaned assets are created.

This "stage locally, upload only on confirmed submit" pattern applies consistently across **all six upload features** (event banner, event trailer, organizer logo, user avatar, seat map floor plan, seat map reference chart) — not just the event creation flow — replacing any immediate-upload-on-file-select behavior.

---

## 4. What Changes vs. What Stays the Same

- **Items 1–3** (avatar, floor plan, reference chart) already accept real file uploads — the only change needed is swapping the storage backend from local VPS disk to Cloudinary, keeping the same validation rules (size caps, WebP re-encoding, EXIF stripping) before the upload call.
- **Items 4–6** (event banner, organizer logo, trailer) currently only accept a pasted URL — these need a new file-input UI component added (reusing the existing avatar/floor-plan upload component pattern) plus a new upload call to Cloudinary, replacing the plain URL text field.
- New event/organizer/layout IDs won't exist yet at the moment of upload for brand-new records (create flow) — uploads for new entities will need to either (a) create the DB record first to get a real ID, then upload and patch the URL field, or (b) upload to a temporary staging folder and move/rename after the record is created. This needs to be decided before implementation.

---

## 5. Open Questions Before Implementation

1. ~~For brand-new event/organizer creation (no ID yet), which upload sequencing approach should be used — create record first, or stage-then-move?~~ **Resolved**: record is created first (on submit), then the staged file(s) are uploaded and the returned URL(s) are attached to that record — see Section 3.
2. Should existing local-disk assets (avatars, floor plans, reference charts already saved under `uploads/`) be migrated/backfilled into Cloudinary, or only new uploads going forward?
3. File size/type limits for the two new upload types (event banner, trailer) — should they match the existing avatar (≤2MB) / floor plan (≤5MB) caps, or need their own limits given video files are typically much larger?
4. For edit flows on existing records (e.g. editing an already-Published event's banner), should the old Cloudinary asset be deleted/replaced when a new one is uploaded on submit, to avoid orphaned files accumulating under that entity's folder?