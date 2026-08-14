# REST API Contract: Organizer Business Analytics

**Feature Branch**: `011-organizer-business-analytics`
**Date**: 2026-08-13
**Spec**: [spec.md](file:///D:/HCMUS/NhapMonCongNghePhanMem/Project/source/IntroSE/src/specs/011-organizer-business-analytics/spec.md)

All endpoints require authentication with role `ORGANIZER` and an approved organizer application state. All queries are strictly server-scoped to `organizer_id = session.user.id` [SEC-04].

---

## 1. `GET /api/organizer/analytics/dashboard`

Retrieves the complete consolidated analytics payload for the dashboard in a single request (or modular endpoints below).

### Query Parameters

| Parameter | Type | Required | Description | Default |
|---|---|---|---|---|
| `period` | string | No | Preset window: `'7d'`, `'this_month'`, `'custom'` | `'7d'` |
| `startDate` | string (ISO) | If custom | Custom window start timestamp | None |
| `endDate` | string (ISO) | If custom | Custom window end timestamp | None |
| `eventId` | string (UUID) | No | Filter by specific event ID or `'all'` | `'all'` |

### Request Headers

```http
Authorization: Bearer <JWT_TOKEN>
Accept: application/json
```

### Success Response (200 OK)

```json
{
  "success": true,
  "data": {
    "overview": {
      "gross_revenue_vnd": 125000000,
      "total_refund_amount_vnd": 5000000,
      "net_revenue_vnd": 120000000,
      "total_tickets_sold": 450,
      "total_capacity": 600,
      "capacity_fill_rate": 75.0,
      "event_counts_by_status": {
        "draft": 2,
        "pending_approval": 1,
        "published": 3,
        "canceled": 1,
        "completed": 5
      },
      "period_comparison": {
        "gross_revenue_change_pct": 15.4,
        "tickets_sold_change_pct": 10.0,
        "net_revenue_change_pct": 12.8
      }
    },
    "time_series": [
      {
        "date": "2026-08-07",
        "label": "07/08",
        "current_revenue_vnd": 15000000,
        "current_tickets_sold": 50,
        "previous_revenue_vnd": 12000000,
        "previous_tickets_sold": 40
      }
    ],
    "top_events": [
      {
        "event_id": "evt-101",
        "event_title": "Sơn Tùng M-TP Concert",
        "category": "Music",
        "status": "Published",
        "gross_revenue_vnd": 80000000,
        "tickets_sold": 300,
        "total_capacity": 350,
        "fill_percentage": 85.71
      }
    ],
    "breakdowns": {
      "by_tier": [
        {
          "tier_name": "VIP",
          "revenue_vnd": 60000000,
          "tickets_sold": 100,
          "percentage_share": 48.0
        },
        {
          "tier_name": "Standard",
          "revenue_vnd": 65000000,
          "tickets_sold": 350,
          "percentage_share": 52.0
        }
      ],
      "by_category": [
        {
          "category": "Music",
          "revenue_vnd": 100000000,
          "tickets_sold": 380,
          "percentage_share": 80.0
        },
        {
          "category": "Workshop",
          "revenue_vnd": 25000000,
          "tickets_sold": 70,
          "percentage_share": 20.0
        }
      ]
    },
    "soonest_event_capacity": {
      "has_upcoming_event": true,
      "event_id": "evt-102",
      "event_title": "Tech Workshop 2026",
      "category": "Technology",
      "start_date": "2026-08-20T09:00:00Z",
      "sold_tickets": 180,
      "total_capacity": 200,
      "fill_percentage": 90.0
    },
    "recent_transactions": [
      {
        "order_id": "ord-8812",
        "ticket_id": "tkt-00192",
        "event_name": "Tech Workshop 2026",
        "tier_name": "Standard",
        "amount_vnd": 500000,
        "purchase_timestamp": "2026-08-13T14:32:00Z",
        "payment_status": "COMPLETED",
        "refund_amount_vnd": 0
      }
    ]
  }
}
```

---

## 2. Empty State Response (200 OK when organizer has 0 sales / 0 upcoming events)

```json
{
  "success": true,
  "data": {
    "overview": {
      "gross_revenue_vnd": 0,
      "total_refund_amount_vnd": 0,
      "net_revenue_vnd": 0,
      "total_tickets_sold": 0,
      "total_capacity": 0,
      "capacity_fill_rate": 0.0,
      "event_counts_by_status": {
        "draft": 0,
        "pending_approval": 0,
        "published": 0,
        "canceled": 0,
        "completed": 0
      },
      "period_comparison": {
        "gross_revenue_change_pct": 0.0,
        "tickets_sold_change_pct": 0.0,
        "net_revenue_change_pct": 0.0
      }
    },
    "time_series": [],
    "top_events": [],
    "breakdowns": {
      "by_tier": [],
      "by_category": []
    },
    "soonest_event_capacity": {
      "has_upcoming_event": false
    },
    "recent_transactions": []
  }
}
```

---

## Error Responses

### 401 Unauthorized / Role Forbidden
```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN_ROLE",
    "message": "Chỉ nhà tổ chức đã được duyệt mới có quyền truy cập báo cáo kinh doanh."
  }
}
```

### 400 Invalid Date Range
```json
{
  "success": false,
  "error": {
    "code": "INVALID_DATE_RANGE",
    "message": "Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc."
  }
}
```
