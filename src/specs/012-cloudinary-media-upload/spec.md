# Feature Specification: Cloudinary Media Upload Migration & Staged Upload Strategy

**Feature Branch**: `012-cloudinary-media-upload`

**Created**: 2026-08-17

**Status**: Draft

**Input**: User description: "based on the cloudinary_migration_plan.md on the IntroSE folder, help me to change every upload must be push on cloudinary"

## Clarifications

### Session 2026-08-17

- **Legacy Asset Migration**: All existing local-disk media assets (such as avatars and floor plans in `uploads/`) will be backfilled and migrated to Cloudinary via a dedicated one-time migration script that updates database URLs, after which local static file serving is decommissioned (FR-013).
- **Upload Routing Architecture**: Media uploads follow a server-mediated architecture where client forms send multipart file payloads to backend API endpoints; the server performs verification, sanitization, and optimization before streaming assets to Cloudinary with server credentials (FR-014).
- **Optional Asset Deletion & Cleanup**: When a user or organizer explicitly removes or clears an optional media attachment (e.g. trailer video, reference chart, or floor plan) during an edit flow, the backend actively invokes Cloudinary's deletion API to destroy the remote cloud asset, ensuring 0 orphaned cloud files (FR-012).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Event Banner & Trailer Video Upload with Staged Submission (Priority: P1)

An organizer creating or editing an event provides promotional media (a mandatory event poster/banner image and an optional trailer video). Instead of pasting external URLs, the organizer selects local media files from their device, sees an immediate visual preview, and continues filling out the event form. The files are uploaded to cloud media storage (Cloudinary) only when the organizer confirms and submits the form, attaching the returned secure media URLs to the event.

**Why this priority**: Event discovery and ticket sales depend directly on rich media (banners and trailers). Replacing raw external URL text fields with direct file uploads eliminates broken links and centralizes event media under platform control.

**Independent Test**: As an organizer, create a new event by selecting a local poster image (JPEG/PNG/WebP) and an optional trailer video (MP4/WebM). Confirm immediate local preview, submit the form, and verify that media files are securely stored under the event's cloud storage hierarchy and display properly on the event details page.

**Acceptance Scenarios**:

1. **Given** an organizer on the "Create Event" page, **When** they select a local image for the event banner, **Then** an immediate local preview appears, and no network request is sent to cloud storage yet.
2. **Given** an organizer with a staged banner and trailer, **When** they complete the form and click "Publish" or "Save Draft", **Then** the media files are uploaded to cloud storage under `tixhub/events/{event_id}/banner/` and `tixhub/events/{event_id}/trailer/`, and the returned cloud URLs are saved with the event record.
3. **Given** an organizer editing an existing event, **When** they replace the current banner with a new file and submit, **Then** the new banner overwrites the existing cloud asset for that event and updates the event record.
4. **Given** an organizer editing an existing event, **When** they submit changes without modifying the existing banner or trailer, **Then** no redundant re-upload occurs and existing media URLs are preserved.
5. **Given** an organizer attempting to submit an event without a banner image, **When** they attempt to save, **Then** the submission is prevented with a validation prompt requiring an event banner.

---

### User Story 2 - User Profile Avatar Upload (Priority: P1)

A signed-in attendee or organizer updates their profile avatar in Account Settings by uploading an image. The selected image is previewed instantly, validated, and uploaded to cloud storage under the user's dedicated path (`tixhub/users/{user_id}/avatar/`) upon saving, replacing any previously uploaded avatar.

**Why this priority**: Avatars represent user identity across the platform (reviews, header profile, organizer pages). Moving avatar storage from local server disk to cloud storage ensures persistence across server redeployments and unified asset handling.

**Independent Test**: Navigate to Account Settings, choose a new avatar image, submit the update, reload the page, and verify the avatar loads from the new cloud storage path.

**Acceptance Scenarios**:

1. **Given** a signed-in user on the Account Settings page, **When** they select an avatar image (JPEG/PNG/WebP ≤ 2MB), **Then** a local preview is displayed immediately.
2. **Given** a user with a staged avatar preview, **When** they click "Save Profile" / "Update Avatar", **Then** the image is validated, re-encoded for web delivery, uploaded to cloud storage under `tixhub/users/{user_id}/avatar/`, and the new avatar URL is saved to their profile.
3. **Given** a user uploading a new avatar to replace an existing one, **When** the upload succeeds, **Then** the previous avatar is overwritten or updated, preventing duplicate asset accumulation.
4. **Given** a user attempting to upload an unsupported format (e.g. executable, text) or a file > 2MB, **When** the file is chosen, **Then** an error message is displayed and the file is not staged or submitted.

---

### User Story 3 - Organizer Application Logo Upload (Priority: P2)

An attendee applying for organizer status uploads their brand or company logo as a file rather than entering an external URL string. The logo is staged locally and uploaded to cloud storage under `tixhub/organizers/{organizer_id}/logo/` upon submitting the application for admin review.

**Why this priority**: Professional organizers require seamless onboarding. Allowing direct file uploads for logos improves application completion rates and ensures administrators review authentic, hosted assets.

**Independent Test**: Submit an organizer application with a chosen logo file. Confirm the application enters the admin review queue with the logo securely hosted in cloud storage.

**Acceptance Scenarios**:

1. **Given** an attendee on the "Apply to Become an Organizer" form, **When** they select a logo file (JPEG/PNG/WebP ≤ 2MB), **Then** an instant preview renders in the application form.
2. **Given** an applicant with a staged logo, **When** they submit the application, **Then** the logo is uploaded to cloud storage under `tixhub/organizers/{organizer_id}/logo/` and associated with the pending application record.
3. **Given** an applicant who closes or navigates away from the application form before submitting, **Then** the staged file is discarded and no cloud assets are created.

---

### User Story 4 - Venue Seat Map Floor Plan & Tracing Reference Chart Upload (Priority: P2)

An organizer designing a custom seat map uploads an architectural floor plan or a reference tracing chart. The image is staged locally for visual alignment on the designer canvas. When the organizer saves the layout, the floor plan or reference image is uploaded to cloud storage under `tixhub/layouts/{layout_id}/floorplan/` or `tixhub/layouts/{layout_id}/reference/`.

**Why this priority**: Seat map designers rely on background floor plans and tracing charts to position seats accurately. Moving these large design assets from local disk to cloud storage reduces backend load and improves global CDN delivery.

**Independent Test**: In the Seat Map Designer, upload a floor plan image (raster or SVG) and a tracing reference chart, adjust alignment, save layout, and verify that the layout displays both background layers correctly from cloud storage.

**Acceptance Scenarios**:

1. **Given** an organizer in the Seat Map Designer, **When** they upload a floor plan image or rasterizable SVG (≤ 5MB), **Then** the canvas renders the image layer immediately for seat positioning.
2. **Given** an organizer with a staged floor plan or reference chart, **When** they click "Save Layout", **Then** the assets are processed, uploaded to `tixhub/layouts/{layout_id}/floorplan/` and `tixhub/layouts/{layout_id}/reference/`, and the layout record is updated.
3. **Given** an organizer removing an existing floor plan from a layout, **When** the layout is saved, **Then** the layout's floor plan reference is cleared, the backend actively deletes the remote asset from Cloudinary via deletion API, and the record is unlinked.

---

### User Story 5 - Form Abandonment & Orphan Prevention (Priority: P3)

A user or organizer selects media files in any creation or edit flow (event, profile, organizer application, seat map layout) but decides to cancel, navigate away, or close the browser tab before submitting. The system ensures no network upload to cloud storage occurs, keeping storage clean and cost-efficient.

**Why this priority**: Prevents storage bloat, avoids unnecessary API bandwidth consumption, and eliminates orphaned media files that have no parent database record.

**Independent Test**: Open an event creation form, select a 50MB trailer video and a 5MB banner, close the tab, and confirm via network monitoring that zero bytes were sent to cloud storage.

**Acceptance Scenarios**:

1. **Given** any form with a staged file input, **When** the user clicks "Cancel" or closes the modal/tab, **Then** the local file reference is dropped from memory and no upload request is initiated.
2. **Given** a form where media upload fails halfway through submit due to network interruption, **When** the error occurs, **Then** the user is notified, existing form data is preserved, and the user can retry submission without re-typing their inputs.

---

### Edge Cases

- **Network interruption during large video trailer upload**: System displays a clear upload progress bar and an actionable error toast on network drop; all textual inputs remain intact for a one-click retry.
- **Decompression bombs and malicious files**: Server rejects files whose uncompressed pixel dimensions exceed safe bounds (> 8192px on any side) before processing or cloud upload.
- **MIME-type spoofing (renamed executables/scripts)**: Magic-byte inspection validates true raster/video structure; SVG files are strictly vetted against script tags, external entities, and SSRF constructs before rasterization.
- **Rapid double-click on submit**: The submit button enters a disabled loading state showing "Đang tải lên media..." to prevent duplicate concurrent upload tasks.
- **Brand-new entity creation without prior ID**: For new events, layouts, or organizer applications, the database transaction/record creation establishes the unique ID first before or during cloud upload, ensuring assets land in the strictly structured folder path.
- **Re-uploading asset with the same name**: Cloud asset naming uses the entity's database ID as the primary key/public identifier (e.g. `tixhub/events/{event_id}/banner/`), ensuring re-uploads overwrite cleanly without duplicate file proliferation.

## Requirements *(mandatory)*

### Functional Requirements

**Unified Cloud Storage Architecture & Structure**

- **FR-001**: System MUST store all uploaded media files in cloud media storage (Cloudinary) under a structured hierarchical folder convention:
  - Event Banner: `tixhub/events/{event_id}/banner/`
  - Event Trailer Video: `tixhub/events/{event_id}/trailer/`
  - Event Gallery (optional): `tixhub/events/{event_id}/gallery/`
  - User Avatar: `tixhub/users/{user_id}/avatar/`
  - Organizer Application Logo: `tixhub/organizers/{organizer_id}/logo/`
  - Seat Map Floor Plan: `tixhub/layouts/{layout_id}/floorplan/`
  - Seat Map Reference Chart: `tixhub/layouts/{layout_id}/reference/`
- **FR-002**: System MUST name uploaded media assets using deterministic entity identifiers (e.g. user ID, event ID, layout ID) so that re-uploads cleanly update or overwrite existing assets without creating dangling duplicates.

**Staged Local Upload Flow ("Stage Locally, Upload on Submit")**

- **FR-003**: System MUST stage media files client-side upon selection (using local object URLs or memory streams for immediate preview) across all 6 upload features, and MUST NOT initiate cloud upload until the user clicks submit/save.
- **FR-004**: System MUST discard staged media files if the user cancels, navigates away, or closes the form, ensuring 0 orphaned cloud assets are generated from uncompleted forms.
- **FR-005**: System MUST display a clear uploading indicator or progress state on the form's submit action while media files are being transmitted to cloud storage.
- **FR-006**: System MUST preserve all entered text inputs if a media upload fails during form submission, enabling the user to retry without data loss.

**UI Input Upgrades & Validation**

- **FR-007**: System MUST replace plain URL text input fields with interactive file-upload components (with drag-and-drop, file browsing, format validation, and remove/replace actions) for:
  - Event Banner Image (required for event publishing)
  - Event Trailer Video (optional)
  - Organizer Application Logo (optional)
- **FR-008**: System MUST enforce strict file size and type boundaries prior to cloud transmission:
  - User Avatar: JPEG, PNG, WebP; max size ≤ 2MB.
  - Organizer Logo: JPEG, PNG, WebP; max size ≤ 2MB.
  - Event Banner: JPEG, PNG, WebP; max size ≤ 5MB.
  - Seat Map Floor Plan & Reference Chart: JPEG, PNG, WebP, SVG; max size ≤ 5MB.
  - Event Trailer Video: MP4, WebM; max size ≤ 50MB.
- **FR-009**: System MUST inspect magic bytes and sanitize all image uploads (stripping EXIF metadata, re-encoding raster images to optimized WebP format, rasterizing safe SVGs) before finalizing storage.

**Entity Lifecycle & Replacement**

- **FR-010**: System MUST associate uploaded cloud URLs with their respective database records in a single coordinated submit action.
- **FR-011**: For edit workflows, system MUST only upload media files that have been changed or replaced, avoiding redundant uploads for unchanged assets.
- **FR-012**: When an asset is replaced or deleted, the system MUST unlink the old asset from the database record and actively invoke Cloudinary's deletion API (`uploader.destroy`) to delete the remote cloud asset, preventing orphaned assets.

**Migration & Backfill**

- **FR-013**: System MUST provide an automated migration utility to backfill all pre-existing local disk assets (avatars, floor plans, reference charts) into Cloudinary and update database URL references, enabling complete decommissioning of local disk asset storage.

**Upload Pipeline & Server Processing**

- **FR-014**: System MUST process uploads through a server-mediated pipeline where the backend API validates, sanitizes, and streams media to Cloudinary using private server credentials, keeping all security checks centralized on the server.

### Key Entities

- **Media Asset**: Represents a stored media file (image or video) associated with an entity. Attributes include public cloud identifier, secure HTTPS URL, media type (banner, trailer, avatar, logo, floorplan, reference), MIME type, file size, and timestamp.
- **Event Media**: Media attachments for an event, consisting of a mandatory banner poster and an optional promotional trailer video.
- **User Profile Avatar**: The visual representation of an attendee or organizer account, replacing local disk file storage.
- **Organizer Logo**: Brand imagery submitted as part of an organizer application and displayed on public organizer profile pages.
- **Layout Design Layers**: Background architectural floor plans and alignment reference charts used in the interactive seat map designer.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of media upload endpoints across the application store assets in Cloudinary cloud media storage, eliminating all dependencies on local VPS disk storage (`uploads/` directory).
- **SC-002**: 100% of unsubmitted/abandoned forms result in 0 cloud upload requests and 0 orphaned cloud assets.
- **SC-003**: Local media previews render in less than 100 milliseconds upon file selection across all 6 upload workflows.
- **SC-004**: Standard image uploads (≤ 5MB) complete within 5 seconds and video trailer uploads (≤ 50MB) complete within 15 seconds under typical broadband connections (≥ 10 Mbps).
- **SC-005**: 100% of failed media uploads preserve all user-entered form data and present actionable feedback within 1 second of failure.
- **SC-006**: Re-uploading or editing an existing entity's media overwrites or updates the asset with 0 leftover duplicate assets in that entity's cloud folder.
- **SC-007**: 100% of uploaded images are sanitized (EXIF metadata stripped, verified magic bytes) before public delivery.
- **SC-008**: 100% of legacy local disk assets in database records are migrated to Cloudinary URLs via the migration utility.

## Assumptions

- **Cloudinary Integration**: Cloudinary serves as the centralized media hosting provider configured via secure environment variables (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`).
- **CDN Delivery**: All generated media URLs return secure HTTPS CDN links (`https://res.cloudinary.com/...`) for high-speed delivery.
- **Backfill Strategy**: All legacy local files under `uploads/` are backfilled to Cloudinary via the migration utility (FR-013) during rollout.
- **Language and UX**: User-facing error messages, file upload dropzones, and progress indicators are rendered in Vietnamese.
- **Video Playback**: The frontend video player (e.g. `TrailerPanel`) seamlessly streams Cloudinary video URLs without requiring third-party video embed wrappers.

## Dependencies

- **Cloudinary Configuration**: Availability of valid Cloudinary credentials in server environment.
- **Governance Alignment**: Media hosting via Cloudinary replaces local disk storage (`uploads/avatars/`, `uploads/floorplans/`), aligning with scalable VPS deployment architecture.
- **Downstream Consumer Modules**:
  - `server/src/modules/auth` (User avatars & organizer applications)
  - `server/src/modules/seatmap` (Floor plans & reference charts)
  - `server/src/modules/organizer` / `server/src/modules/events` (Event banners & trailers)
  - Frontend components (`EditEventForm`, `OrganizerEventsPage`, `AccountPage`, `OrganizerApplicationModal`, `SeatMapDesigner`, `TrailerPanel`)
