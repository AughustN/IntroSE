# API Contract: Cloudinary Media Upload Endpoints

**Feature**: `012-cloudinary-media-upload` | **Date**: 2026-08-17

This document defines the REST API contracts, multipart payloads, and JSON response shapes for all media upload, replacement, and deletion operations across TixHub.

---

## 1. User Avatar Management

### 1.1 Upload / Replace User Avatar
- **Endpoint**: `POST /api/me/avatar`
- **Auth**: Required (`Cookie: session_token` / `Bearer token`)
- **Content-Type**: `multipart/form-data`
- **Request Form Data**:
  - `avatar`: Binary file (JPEG, PNG, WebP ≤ 2MB)
- **Response `200 OK`**:
  ```json
  {
    "avatarUrl": "https://res.cloudinary.com/tixhub/image/upload/v1723900000/tixhub/users/018f-user-uuid/avatar/018f-user-uuid.webp"
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: `{ "error": "invalid_image" }` or `{ "error": "file_too_large" }`
  - `401 Unauthorized`: `{ "error": "unauthorized" }`

---

## 2. Organizer Application Logo

### 2.1 Submit Organizer Application with Logo
- **Endpoint**: `POST /api/organizers/apply`
- **Auth**: Required (Attendee role)
- **Content-Type**: `multipart/form-data` (or JSON with pre-staged upload)
- **Request Form Data**:
  - `displayName`: String (3..100 chars)
  - `description`: String (10..1000 chars)
  - `logo`: Optional Binary file (JPEG, PNG, WebP ≤ 2MB)
- **Response `201 Created`**:
  ```json
  {
    "id": "018f-org-uuid",
    "userId": "018f-user-uuid",
    "displayName": "Sài Gòn Sound Stage",
    "description": "Nhà tổ chức sự kiện âm nhạc chuyên nghiệp",
    "logoUrl": "https://res.cloudinary.com/tixhub/image/upload/v1723900000/tixhub/organizers/018f-org-uuid/logo/018f-org-uuid.webp",
    "status": "pending"
  }
  ```

---

## 3. Event Media Management (Banner & Trailer)

### 3.1 Create Event with Media
- **Endpoint**: `POST /api/organizer/events`
- **Auth**: Required (Approved Organizer role)
- **Content-Type**: `multipart/form-data`
- **Request Form Data**:
  - `title`: String (mandatory)
  - `description`: String (mandatory)
  - `venueId`: UUID / String
  - `banner`: Binary file (Mandatory, JPEG, PNG, WebP ≤ 5MB)
  - `trailer`: Optional Binary file (MP4, WebM ≤ 50MB)
  - `ticketTiers`: JSON String representation of tiers array
- **Response `201 Created`**:
  ```json
  {
    "id": "018f-event-uuid",
    "title": "Hạ Trắng Live Concert 2026",
    "bannerUrl": "https://res.cloudinary.com/tixhub/image/upload/v1723900000/tixhub/events/018f-event-uuid/banner/018f-event-uuid.webp",
    "trailerUrl": "https://res.cloudinary.com/tixhub/video/upload/v1723900000/tixhub/events/018f-event-uuid/trailer/018f-event-uuid.mp4",
    "status": "draft"
  }
  ```

### 3.2 Update Event Media
- **Endpoint**: `PATCH /api/organizer/events/:id`
- **Auth**: Required (Organizer owner of event)
- **Content-Type**: `multipart/form-data`
- **Request Form Data**:
  - `banner`: Optional Binary file (replaces banner if provided)
  - `trailer`: Optional Binary file (replaces trailer if provided)
  - `removeTrailer`: Optional Boolean (`"true"` to remove trailer and destroy cloud asset)
- **Response `200 OK`**:
  ```json
  {
    "id": "018f-event-uuid",
    "bannerUrl": "https://res.cloudinary.com/tixhub/image/upload/v1723900000/tixhub/events/018f-event-uuid/banner/018f-event-uuid.webp",
    "trailerUrl": null,
    "status": "draft"
  }
  ```

---

## 4. Seat Map Layout Floor Plan & Reference Chart

### 4.1 Upload Floor Plan
- **Endpoint**: `POST /api/organizer/layouts/:id/floorplan`
- **Auth**: Required (Organizer owner of layout)
- **Content-Type**: `multipart/form-data`
- **Request Form Data**:
  - `floorplan`: Binary file (JPEG, PNG, WebP, SVG ≤ 5MB)
- **Response `200 OK`**:
  ```json
  {
    "planUrl": "https://res.cloudinary.com/tixhub/image/upload/v1723900000/tixhub/layouts/018f-layout-uuid/floorplan/018f-layout-uuid.webp"
  }
  ```

### 4.2 Delete Floor Plan
- **Endpoint**: `DELETE /api/organizer/layouts/:id/floorplan`
- **Auth**: Required (Organizer owner of layout)
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "planUrl": null
  }
  ```

### 4.3 Upload Reference Chart
- **Endpoint**: `POST /api/organizer/layouts/:id/reference`
- **Auth**: Required (Organizer owner of layout)
- **Content-Type**: `multipart/form-data`
- **Request Form Data**:
  - `reference`: Binary file (JPEG, PNG, WebP, SVG ≤ 5MB)
- **Response `200 OK`**:
  ```json
  {
    "url": "https://res.cloudinary.com/tixhub/image/upload/v1723900000/tixhub/layouts/018f-layout-uuid/reference/018f-layout-uuid.webp",
    "scale": 1000,
    "offsetX": 0,
    "offsetY": 0,
    "opacity": 50
  }
  ```

### 4.4 Delete Reference Chart
- **Endpoint**: `DELETE /api/organizer/layouts/:id/reference`
- **Auth**: Required (Organizer owner of layout)
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "url": null
  }
  ```
