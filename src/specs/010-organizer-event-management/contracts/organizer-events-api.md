# Contract: Organizer Event Management API

**Feature Branch**: `010-organizer-event-management`  
**Date**: 2026-08-12  
**Base URL Path**: `/api/organizer/events`  
**Authentication**: Bearer Token / Session Cookie with `ORGANIZER` role.

---

## Endpoint Specifications

### 1. List Organizer Events (Portfolio Overview)

- **HTTP Method**: `GET`
- **Path**: `/api/organizer/events`
- **Query Parameters**:
  - `status` (optional): `all` | `draft` | `pending_review` | `published` | `canceled` | `completed`
  - `search` (optional): string keyword to filter by title or location
- **Response**: `200 OK`
  ```json
  {
    "success": true,
    "data": [
      {
        "eventId": "evt-101",
        "organizerId": "org-888",
        "title": "Đêm Nhạc Trịnh Công Sơn: Hạ Trắng",
        "bannerUrl": "https://cdn.tixhub.vn/banners/ha-trang.jpg",
        "status": "published",
        "startDatetime": "2026-09-15T19:30:00Z",
        "endDatetime": "2026-09-15T22:30:00Z",
        "locationName": "Nhà hát Hòa Bình, TP.HCM",
        "totalCapacity": 500,
        "soldTickets": 320,
        "remainingTickets": 180,
        "totalRevenueVnd": 160000000
      }
    ],
    "summary": {
      "totalEvents": 5,
      "draftCount": 1,
      "pendingCount": 1,
      "publishedCount": 2,
      "canceledCount": 0,
      "completedCount": 1
    }
  }
  ```

---

### 2. Get Single Event Management Workspace Detail

- **HTTP Method**: `GET`
- **Path**: `/api/organizer/events/:id`
- **Response**: `200 OK`
  ```json
  {
    "success": true,
    "data": {
      "eventId": "evt-101",
      "organizerId": "org-888",
      "title": "Đêm Nhạc Trịnh Công Sơn: Hạ Trắng",
      "description": "Đêm nhạc tưởng nhớ nhạc sĩ Trịnh Công Sơn với sự tham gia của nhiều nghệ sĩ nổi tiếng.",
      "category": "music",
      "categoryLabel": "Âm nhạc",
      "bannerUrl": "https://cdn.tixhub.vn/banners/ha-trang.jpg",
      "venueName": "Nhà hát Hòa Bình",
      "venueAddress": "240 3 Tháng 2, Phường 12, Quận 10, TP.HCM",
      "city": "TP.HCM",
      "startDatetime": "2026-09-15T19:30:00Z",
      "endDatetime": "2026-09-15T22:30:00Z",
      "salesStartDatetime": "2026-08-01T00:00:00Z",
      "salesEndDatetime": "2026-09-15T18:00:00Z",
      "status": "published",
      "computedStatus": "published",
      "rejectionReason": null,
      "cancellationReason": null,
      "metrics": {
        "totalCapacity": 500,
        "soldTickets": 320,
        "remainingTickets": 180,
        "totalRevenueVnd": 160000000
      },
      "ticketTiers": [
        {
          "tierId": "tier-v1",
          "name": "Vé VIP",
          "priceVnd": 800000,
          "capacity": 100,
          "soldCount": 100,
          "remainingCount": 0,
          "description": "Hàng ghế A-C, tặng kèm nước uống & quà lưu niệm",
          "isArchived": false
        },
        {
          "tierId": "tier-s1",
          "name": "Vé Standard",
          "priceVnd": 400000,
          "capacity": 400,
          "soldCount": 220,
          "remainingCount": 180,
          "description": "Hàng ghế D-M",
          "isArchived": false
        }
      ]
    }
  }
  ```
- **Errors**:
  - `403 Forbidden`: `{"success": false, "error": {"code": "FORBIDDEN", "message": "You do not own this event."}}`
  - `404 Not Found`: `{"success": false, "error": {"code": "NOT_FOUND", "message": "Event not found."}}`

---

### 3. Request Event Publication ("Request to Publish")

- **HTTP Method**: `POST`
- **Path**: `/api/organizer/events/:id/publish-request`
- **Response**: `200 OK`
  ```json
  {
    "success": true,
    "message": "Yêu cầu xuất bản đã được gửi tới Quản trị viên để phê duyệt.",
    "data": {
      "eventId": "evt-101",
      "status": "pending_review"
    }
  }
  ```
- **Validation Errors (`400 Bad Request`)**:
  - Returned if mandatory fields (title, banner, ticket tier with price) are missing.

---

### 4. Edit & Update Event Details

- **HTTP Method**: `PUT`
- **Path**: `/api/organizer/events/:id`
- **Request Body**:
  ```json
  {
    "title": "Đêm Nhạc Trịnh Công Sơn: Hạ Trắng (Bổ sung nghệ sĩ)",
    "description": "Mô tả cập nhật...",
    "venueName": "Nhà hát Hòa Bình",
    "venueAddress": "240 3 Tháng 2, Phường 12, Quận 10, TP.HCM",
    "city": "TP.HCM",
    "startDatetime": "2026-09-15T19:30:00Z",
    "endDatetime": "2026-09-15T22:30:00Z"
  }
  ```
- **Response**: `200 OK`
  ```json
  {
    "success": true,
    "message": "Cập nhật thông tin sự kiện thành công.",
    "statusRevertedToPending": true,
    "data": {
      "eventId": "evt-101",
      "status": "pending_review",
      "updatedAt": "2026-08-12T22:45:00Z"
    }
  }
  ```
  *(Note: `statusRevertedToPending: true` indicates that updating material fields of a Published event reverted its status to `pending_review` per UC-24 A6).*

---

### 5. Cancel Event

- **HTTP Method**: `POST`
- **Path**: `/api/organizer/events/:id/cancel`
- **Request Body**:
  ```json
  {
    "reason": "Ban tổ chức phải hủy sự kiện do điều kiện thời tiết bão lũ phức tạp."
  }
  ```
- **Response**: `200 OK`
  ```json
  {
    "success": true,
    "message": "Sự kiện đã hủy thành công. Hệ thống đang tiến hành hoàn tiền vào ví cho người mua vé.",
    "data": {
      "eventId": "evt-101",
      "status": "canceled",
      "cancellationReason": "Ban tổ chức phải hủy sự kiện do điều kiện thời tiết bão lũ phức tạp.",
      "canceledAt": "2026-08-12T22:45:00Z",
      "refundsDispatched": {
        "ticketsAffectedCount": 320,
        "totalRefundAmountVnd": 160000000
      }
    }
  }
  ```
- **Errors**:
  - `400 Bad Request`: Missing reason (`"Lý do hủy là bắt buộc"`) or event is already completed (`"Không thể hủy sự kiện đã kết thúc"`).

---

### 6. Delete / Archive Ticket Tier

- **HTTP Method**: `DELETE`
- **Path**: `/api/organizer/events/:id/tiers/:tierId`
- **Response**: `200 OK`
  ```json
  {
    "success": true,
    "actionTaken": "archived",
    "message": "Hạng vé đã bán vé nên đã được lưu trữ (archive) thay vì xóa vĩnh viễn.",
    "data": {
      "tierId": "tier-s1",
      "isArchived": true
    }
  }
  ```
