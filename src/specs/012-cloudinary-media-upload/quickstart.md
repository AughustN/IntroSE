# Quickstart & Verification Guide: Cloudinary Media Upload Migration

**Feature**: `012-cloudinary-media-upload` | **Date**: 2026-08-17

This guide describes the manual and automated validation procedures to verify that all 6 media types are properly staged, processed, uploaded to Cloudinary, and persisted.

---

## 1. Prerequisites & Environment Setup

Ensure the following environment variables are present in your `.env` file:

```env
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

Install any updated dependencies:
```bash
npm install
```

---

## 2. Automated Test Execution

Run the media upload integration test suite:

```bash
npm test server/tests/media/cloudinaryUpload.test.ts
```

**Expected Results**:
- Magic byte detection accepts valid JPEG, PNG, WebP and rejects SVG scripts/executables (`invalid_image`).
- Dimension checks reject images > 8192px (`image_too_large`).
- Buffer is converted to clean WebP format and piped to Cloudinary without local disk file creation.
- Deterministic public IDs match entity IDs (`tixhub/users/{user_id}/avatar/{user_id}`).
- Cloudinary deletion API (`uploader.destroy`) is called when optional media is removed.

---

## 3. End-to-End User Flow Validation

### Scenario 1: Event Banner & Trailer Staged Submission
1. Log in as an approved organizer and navigate to `/organizer`.
2. Click "Tạo Sự Kiện Mới".
3. Drag and drop a banner image (`poster.png`) and select a trailer video (`trailer.mp4`).
4. **Verify**: Preview renders in < 100ms in the browser. Network tab shows **no network requests** to Cloudinary or `/api/organizer/events` yet.
5. Click "Hủy" or close modal. **Verify**: 0 cloud assets created.
6. Re-open modal, select files, fill details, and click "Hoàn Tất Tạo Sự Kiện".
7. **Verify**: Submit button shows loading/uploading spinner. Event is created with `bannerUrl` pointing to `https://res.cloudinary.com/.../tixhub/events/{id}/banner/{id}.webp` and `trailerUrl` pointing to `.../trailer/{id}.mp4`.

### Scenario 2: User Profile Avatar Upload
1. Log in as an attendee and navigate to `/account`.
2. Select a new avatar photo (`avatar.jpg` ≤ 2MB).
3. Click "Lưu Thay Đổi".
4. **Verify**: Avatar updates immediately and URL matches `https://res.cloudinary.com/.../tixhub/users/{id}/avatar/{id}.webp`. Reloading the page retains the avatar.

### Scenario 3: Seat Map Floor Plan & Reference Chart
1. Navigate to `/organizer/layouts/new` (Seat Map Designer).
2. Upload a venue background image (`floorplan.png`) and a reference tracing image.
3. Save layout.
4. **Verify**: Floor plan and reference chart URLs point to `tixhub/layouts/{id}/floorplan/{id}.webp` and `.../reference/{id}.webp`.

### Scenario 4: Legacy Local Disk Migration Script
1. Seed database with legacy records containing local `/uploads/avatars/...` paths.
2. Run the migration backfill command:
   ```bash
   npm run db:migrate-cloudinary
   ```
3. **Verify**: All `/uploads/...` strings in `users`, `venue_layouts`, and `organizers` are replaced with valid `https://res.cloudinary.com/...` URLs, and console reports 100% success.
