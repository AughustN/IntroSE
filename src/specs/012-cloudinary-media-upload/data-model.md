# Data Model: Cloudinary Media Upload Migration

**Feature**: `012-cloudinary-media-upload` | **Date**: 2026-08-17

This document details the database schema mappings, transient client staging models, validation boundaries, and lifecycle state transitions for media assets across the TixHub platform.

---

## 1. Database Schema Mappings

All media columns store absolute, secure HTTPS Cloudinary CDN URLs (`https://res.cloudinary.com/{cloud_name}/...`).

### 1.1 Users (`users`)
| Column | Type | Nullable | Description & Cloudinary Mapping |
|---|---|---|---|
| `id` | `UUID` | No | Primary Key |
| `avatar_url` | `TEXT` | Yes | Points to `https://res.cloudinary.com/{cloud_name}/image/upload/v.../tixhub/users/{id}/avatar/{id}.webp`. NULL by default. |

### 1.2 Organizers (`organizers`)
| Column | Type | Nullable | Description & Cloudinary Mapping |
|---|---|---|---|
| `id` | `UUID` | No | Primary Key |
| `user_id` | `UUID` | No | Foreign Key to `users(id)` |
| `logo_url` | `TEXT` | Yes | Points to `https://res.cloudinary.com/{cloud_name}/image/upload/v.../tixhub/organizers/{id}/logo/{id}.webp`. |

### 1.3 Events (`events`)
| Column | Type | Nullable | Description & Cloudinary Mapping |
|---|---|---|---|
| `id` | `UUID` | No | Primary Key |
| `organizer_id` | `UUID` | No | Foreign Key to `organizers(id)` |
| `banner_url` | `TEXT` | No | Mandatory poster image: `https://res.cloudinary.com/{cloud_name}/image/upload/v.../tixhub/events/{id}/banner/{id}.webp`. |
| `trailer_url` | `TEXT` | Yes | Optional video trailer: `https://res.cloudinary.com/{cloud_name}/video/upload/v.../tixhub/events/{id}/trailer/{id}.mp4`. |
| `gallery_urls` | `TEXT[]` | Yes | Optional additional images array under `tixhub/events/{id}/gallery/{asset_uuid}.webp`. |

### 1.4 Venue Layouts (`venue_layouts`)
| Column | Type | Nullable | Description & Cloudinary Mapping |
|---|---|---|---|
| `id` | `UUID` | No | Primary Key |
| `organizer_id` | `UUID` | No | Foreign Key to `organizers(id)` |
| `plan_url` | `TEXT` | Yes | Background venue floor plan: `https://res.cloudinary.com/{cloud_name}/image/upload/v.../tixhub/layouts/{id}/floorplan/{id}.webp`. |
| `reference_url` | `TEXT` | Yes | Reference tracing chart: `https://res.cloudinary.com/{cloud_name}/image/upload/v.../tixhub/layouts/{id}/reference/{id}.webp`. |

---

## 2. Transient Client-Side Staging Model

In React frontend components, files selected by the user are held in local state without triggering cloud network requests until form confirmation.

```typescript
export interface StagedMedia {
  file: File | null;              // Raw File object selected from file input/dropzone
  previewUrl: string | null;      // Local Object URL (URL.createObjectURL) for <100ms instant rendering
  existingUrl: string | null;     // Existing Cloudinary URL (if editing an existing record)
  mediaType: 'avatar' | 'logo' | 'banner' | 'trailer' | 'floorplan' | 'reference';
  status: 'idle' | 'staged' | 'uploading' | 'error';
  errorMessage?: string;
}
```

---

## 3. Media Validation Rules & Limits

| Media Type | Allowed MIME Types | Max Size | Max Resolution | Re-encoding Target |
|---|---|---|---|---|
| **User Avatar** | `image/jpeg`, `image/png`, `image/webp` | 2 MB | 2048 x 2048 px | WebP, 512x512 cover, quality 82 |
| **Organizer Logo** | `image/jpeg`, `image/png`, `image/webp` | 2 MB | 2048 x 2048 px | WebP, 512x512 cover, quality 82 |
| **Event Banner** | `image/jpeg`, `image/png`, `image/webp` | 5 MB | 4096 x 4096 px | WebP, 1920x1080 fit, quality 80 |
| **Floor Plan** | `image/jpeg`, `image/png`, `image/webp`, `image/svg+xml` | 5 MB | 8192 x 8192 px | WebP, quality 80 |
| **Reference Chart** | `image/jpeg`, `image/png`, `image/webp`, `image/svg+xml` | 5 MB | 8192 x 8192 px | WebP, quality 80 |
| **Event Trailer** | `video/mp4`, `video/webm` | 50 MB | 1920 x 1080 px | Stored directly in Cloudinary video format |

---

## 4. Lifecycle & State Transitions

```
[No File / Current URL]
         │
         │ (User selects/drops file)
         ▼
    [Staged Locally]  ──(User navigates away / cancel)──► [Discarded / ObjectURL Revoked]
         │                                                (0 Cloudinary Requests)
         │ (User clicks Form Submit)
         ▼
    [Uploading via Server]
         │
         ├──(Upload Error)──► [Staged with Error] (Text inputs preserved; retry available)
         │
         ▼ (Success)
    [Cloudinary Stored & DB Updated]
         │
         │ (User deletes / removes optional media in Edit)
         ▼
    [Cloudinary Destroyed & DB set to NULL]
```
