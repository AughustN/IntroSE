# Implementation Plan: Cloudinary Media Upload Migration & Staged Upload Strategy

**Branch**: `012-cloudinary-media-upload` | **Date**: 2026-08-17 | **Spec**: [`spec.md`](file:///D:/HCMUS/NhapMonCongNghePhanMem/Project/source/IntroSE/src/specs/012-cloudinary-media-upload/spec.md)

**Input**: Feature specification from `/specs/012-cloudinary-media-upload/spec.md`

## Summary

Migrate 100% of media upload endpoints (Event Banners, Event Trailers, User Avatars, Organizer Logos, Venue Floor Plans, and Seat Map Reference Charts) from local VPS disk storage (`uploads/`) and external raw URL inputs to a centralized, deterministic Cloudinary storage structure (`tixhub/{entity_type}/{entity_id}/...`). Implement a consistent "Stage Locally, Upload on Confirmed Submit" client-side lifecycle across all creation/edit forms to prevent orphaned cloud assets upon form abandonment, while enforcing server-side magic-byte inspection, dimension bomb checks, EXIF stripping, and WebP re-encoding before streaming to Cloudinary.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 22 & React 19)  
**Primary Dependencies**: `cloudinary` (v2), `sharp`, `multer`, Express, React 19, Lucide React  
**Storage**: PostgreSQL (Neon), Cloudinary CDN (Asset Storage)  
**Testing**: Vitest / Supertest (Unit & API Integration tests)  
**Target Platform**: Node.js API server & Web Browser (SPA)  
**Project Type**: Full-stack web application (React SPA + Express REST API)  
**Performance Goals**: Local file preview < 100ms (SC-003), image upload < 5s, video trailer upload < 15s (SC-004)  
**Constraints**: Zero local disk writes for uploads, deterministic ID-based `public_id`, 0 orphaned cloud assets (SC-002), server-side magic-byte sanitization (Principle II)  
**Scale/Scope**: 6 media upload types, legacy asset backfill script (`db:migrate-cloudinary`), UI component upgrades (file dropzones replacing URL textboxes).

## Constitution Check

*GATE: Passed pre-research and post-design validation.*

1. **Reliability Under Load (Principle I)**:
   - Database stores the authoritative Cloudinary HTTPS URLs.
   - Streaming memory buffers to Cloudinary via `upload_stream` prevents local disk I/O bottlenecks and disk-full crashes on high concurrency.
2. **Security & Trust by Default (Principle II)**:
   - Magic-byte verification and `sharp` metadata parsing reject malicious files and decompression bombs (>8192px) before cloud storage.
   - Private Cloudinary API credentials stay on the backend server.
   - EXIF metadata stripped and SVG files strictly sanitized before rasterization.
3. **AI Is Assistive, Grounded, and Non-Blocking (Principle III)**:
   - Media storage operates completely independently of AI services.
4. **Verifiable Requirements & Test-First (Principle IV)**:
   - All 5 user stories and 8 measurable success criteria have explicit automated test verification defined in `quickstart.md`.
5. **Simplicity & Free-Tier Discipline (Principle V)**:
   - Eliminates complex local VPS disk backup infrastructure and Nginx static file proxy routing by leveraging Cloudinary's free-tier CDN capabilities.
   - Deterministic entity-ID naming prevents duplicate asset bloat.
6. **Clean Codebase & Seamless FE/BE Integration (Principle VI)**:
   - Shared TypeScript definitions (`StagedMedia`, API response contracts) imported across frontend and backend.

## Project Structure

### Documentation (this feature)

```text
specs/012-cloudinary-media-upload/
├── spec.md              # Feature specification
├── plan.md              # Implementation plan (this file)
├── research.md          # Phase 0 technical decisions & rationale
├── data-model.md        # Phase 1 schema, state transitions & staging models
├── quickstart.md        # Phase 1 verification & test guide
├── contracts/           # Phase 1 interface contracts
│   └── media-upload-api.md
└── checklists/
    └── requirements.md
```

### Source Code Layout

```text
server/src/
├── services/
│   └── cloudinary.ts            # Cloudinary SDK client & upload_stream helpers
├── modules/
│   ├── auth/
│   │   └── avatar.ts            # Avatar validation & Cloudinary stream pipeline
│   ├── seatmap/
│   │   ├── floorplan.ts         # Floorplan/Reference validation & Cloudinary pipeline
│   │   └── seatmap.routes.ts    # Floorplan & reference chart upload/delete routes
│   └── events/
│       ├── eventMedia.ts        # Event banner & trailer validation / upload helpers
│       └── event.routes.ts      # Event creation & update multipart handlers
└── db/
    └── migrate-cloudinary.ts    # One-time legacy disk asset backfill CLI script

src/
├── types.ts                     # Shared media types & interfaces
├── components/
│   ├── common/
│   │   ├── MediaDropzone.tsx    # Reusable staged image/video upload UI component
│   │   └── TrailerPanel.tsx     # Cloudinary video preview & streaming player
│   ├── organizer/
│   │   ├── EditEventForm.tsx    # Event form updated with MediaDropzone
│   │   └── EventCard.tsx        # Render Cloudinary CDN banner images
│   ├── seatmap/
│   │   └── FloorPlanPanel.tsx   # Seat map designer floor plan / reference staging
│   └── admin/screens/
│       └── OrganizerPreview.tsx # Render Cloudinary organizer logos
└── services/
    ├── api.ts                   # Updated API client removing local /uploads prefix
    ├── authClient.ts            # Avatar upload client calls
    └── organizerClient.ts       # Event banner & trailer client calls

server/tests/
└── media/
    ├── cloudinaryUpload.test.ts # Magic bytes, size caps, and upload stream tests
    └── legacyMigration.test.ts  # Database backfill migration tests
```

**Structure Decision**: Integrated directly into existing Express backend and React SPA architecture, standardizing all media management into `server/src/services/cloudinary.ts` and `src/components/common/MediaDropzone.tsx`.

## Complexity Tracking

> **No violations**. All architectural choices comply strictly with the TixHub Constitution v2.0.0.
