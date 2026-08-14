# Organizer Business Analytics — Metrics & Formulas Reference Guide

This document provides a comprehensive technical and plain-language specification for all calculated metrics, ratios, period comparisons, and percentage shares displayed across the **Organizer Business Analytics** dashboard (`/account?tab=organizer&section=analytics`).

---

## Audit & Verification Log (5 Core Issues Addressed)

> [!IMPORTANT]
> **Summary of Audit Corrections & Architectural Verifications**:
> 
> 1. **Partial Refunds Fix**: Updated `total_refund_amount_vnd` to aggregate individual voided ticket refunds via `SUM(CASE WHEN t.qr_status = 'void' THEN COALESCE(t.refundable_amount, t.price_cents) ELSE 0 END)` instead of applying a blanket sum over all tickets of orders marked `partially_refunded`.
> 2. **Capacity Fill Rate Decoupling**: Updated `capacity_fill_rate` to use **lifetime tickets sold for active events** in the numerator. Selecting a short date preset (e.g., `7d`) no longer produces artificially tiny fill rates.
> 3. **Revenue Basis Reconciliation**: Reconciled the Donut Breakdown percentage denominator to total period ticket face revenue ($\sum \text{t.price\_cents}$), guaranteeing slice percentage shares sum to **100.0%** while documenting the architectural nuance relative to order-level gross revenue (`o.final_total_cents`).
> 4. **Check-In Rate Queries**: Fully documented both the numerator ("Total Scanned Valid Tickets") and denominator ("Total Issued Valid Tickets") queries, confirming code isolation from general capacity or period ticket sold counters.
> 5. **VND Scale & `_cents` Naming Audit**: Verified that columns with `_cents` suffixes (`final_total_cents`, `price_cents`) store **integer VND đồng directly** with zero fractional scaling. Confirmed there are **no accidental `/ 100` or `* 100` conversion bugs** anywhere in the revenue pipeline.

---

## 1. Overview KPIs

### 1.1 Gross Revenue (`gross_revenue_vnd`)
* **Plain Language Explanation**: The total gross monetary value (in VND đồng) of all completed/paid ticket orders placed for the organizer's events during the selected time period, before deducting any refunds.
* **Formula**:
  $$\text{Gross Revenue} = \sum \text{final\_total\_cents}_{\text{order}}$$
* **Data Sources & Tables**: `events`, `showtimes`, `reservations`, `orders`.
* **SQL Query Logic**:
  ```sql
  SELECT COALESCE(SUM(o.final_total_cents), 0)::bigint AS gross_revenue
  FROM events e
  JOIN showtimes s ON s.event_id = e.id
  JOIN reservations r ON r.showtime_id = s.id
  JOIN orders o ON o.reservation_id = r.id
  WHERE e.organizer_id = $1
    AND o.payment_status IN ('paid', 'completed', 'refunded', 'partially_refunded')
    AND o.created_at >= $2 AND o.created_at <= $3;
  ```
* **Example Calculation**:
  - Order A: 3,150,000₫
  - Order B: 5,250,000₫
  - **Gross Revenue** = `3,150,000 + 5,250,000` = **8,400,000₫**.

---

### 1.2 Total Refunds (`total_refund_amount_vnd`)
* **Plain Language Explanation**: The exact total monetary value of tickets that have been voided/refunded within the selected time window, properly accounting for partial refunds per ticket instance.
* **Formula**:
  $$\text{Total Refunds} = \sum_{\text{tickets with } qr\_status = 'void'} \text{COALESCE}(\text{t.refundable\_amount}, \text{t.price\_cents})$$
* **Data Sources & Tables**: `events`, `showtimes`, `reservations`, `orders`, `tickets`.
* **SQL Query Logic**:
  ```sql
  SELECT COALESCE(SUM(
    CASE 
      WHEN t.qr_status = 'void' THEN COALESCE(t.refundable_amount, t.price_cents) 
      ELSE 0 
    END
  ), 0)::bigint AS total_refunds
  FROM events e
  JOIN showtimes s ON s.event_id = e.id
  JOIN reservations r ON r.showtime_id = s.id
  JOIN orders o ON o.reservation_id = r.id
  LEFT JOIN tickets t ON t.order_id = o.id
  WHERE e.organizer_id = $1
    AND o.created_at >= $2 AND o.created_at <= $3;
  ```
* **Example Calculation**:
  - In a 10-ticket order, 2 tickets are voided @ 600,000₫ refundable amount each = **1,200,000₫ Total Refunds** (only the 2 voided tickets are counted, ignoring the 8 valid tickets).

---

### 1.3 Net Revenue (`net_revenue_vnd`)
* **Plain Language Explanation**: Net earnings realized after subtracting total refunded ticket amounts from gross revenue for the selected period.
* **Formula**:
  $$\text{Net Revenue} = \max(0, \text{Gross Revenue} - \text{Total Refunds})$$
* **Data Sources & Tables**: Derived from `gross_revenue_vnd` and `total_refund_amount_vnd`.
* **Example Calculation**:
  - Gross Revenue = 60,000,000₫
  - Total Refunds = 1,200,000₫
  - **Net Revenue** = `60,000,000 - 1,200,000` = **58,800,000₫**.

---

### 1.4 Tickets Sold (`total_tickets_sold`)
* **Plain Language Explanation**: The total number of valid individual ticket instances issued for orders within the selected time period.
* **Formula**:
  $$\text{Tickets Sold} = \text{COUNT}(\text{tickets.id})$$
* **SQL Query Logic**:
  ```sql
  SELECT COALESCE(COUNT(t.id), 0)::int AS tickets_sold
  FROM events e
  JOIN showtimes s ON s.event_id = e.id
  JOIN reservations r ON r.showtime_id = s.id
  JOIN orders o ON o.reservation_id = r.id
  LEFT JOIN tickets t ON t.order_id = o.id
  WHERE e.organizer_id = $1
    AND o.payment_status IN ('paid', 'completed', 'refunded', 'partially_refunded')
    AND o.created_at >= $2 AND o.created_at <= $3;
  ```

---

### 1.5 Overall Capacity Fill Rate (`capacity_fill_rate`)
* **Plain Language Explanation**: The percentage of total available event capacity filled by ticket sales across all active events owned by the organizer. Uses **lifetime tickets sold** in the numerator so selecting short date filters (e.g. `7d`) does not distort fill rate visibility.
* **Formula**:
  $$\text{Capacity Fill Rate (\%)} = \left( \frac{\text{Lifetime Non-Void Tickets Sold}}{\text{Total Configured Capacity}} \right) \times 100$$
* **Data Sources & Tables**: `events`, `showtimes`, `ticket_tiers`, `reservation_items`, `tickets`, `orders`.
* **SQL Query Logic**:
  ```sql
  SELECT 
      COALESCE(SUM(tt.total_quantity), 0)::int AS total_capacity,
      COALESCE(COUNT(t.id), 0)::int AS lifetime_tickets_sold
  FROM events e
  JOIN showtimes s ON s.event_id = e.id
  JOIN ticket_tiers tt ON tt.showtime_id = s.id
  LEFT JOIN reservation_items ri ON ri.ticket_tier_id = tt.id
  LEFT JOIN tickets t ON t.reservation_item_id = ri.id AND t.qr_status != 'void'
  LEFT JOIN orders o ON o.id = t.order_id AND o.payment_status IN ('paid', 'completed')
  WHERE e.organizer_id = $1;
  ```
* **Example Calculation**:
  - Lifetime Non-Void Tickets Sold = 1,810
  - Total Configured Capacity = 2,250
  - **Capacity Fill Rate** = `(1810 / 2250) * 100` = **80.4%**.

---

## 2. Period Comparisons (% Deltas)

Period comparisons reflect performance velocity by comparing metrics from the **Current Time Window** against an equivalent **Previous Time Window**.

### 2.1 Time Window Resolution Rules
| Filter Preset | Current Window ($T_{\text{curr}}$) | Previous Window ($T_{\text{prev}}$) | Window Length |
| :--- | :--- | :--- | :--- |
| **7 Days (`7d`)** | `[NOW - 7 days, NOW]` | `[NOW - 14 days, NOW - 7 days]` | Exact 7 Days |
| **This Month (`this_month`)** | `[1st of Current Month 00:00, NOW]` | `[1st of Current Month - duration, 1st of Current Month]` | Equivalent Month Duration |
| **Custom Range (`custom`)** | `[startDate, endDate]` | `[startDate - (endDate - startDate), startDate]` | Matching Custom Span |

---

### 2.2 Delta Percentage Formula (`calcPctChange`)
* **Formula**:
  $$\text{Change (\%) } = \begin{cases} 
  100\% & \text{if } \text{Prev} = 0 \text{ and } \text{Curr} > 0 \\
  0\% & \text{if } \text{Prev} = 0 \text{ and } \text{Curr} = 0 \\
  \left( \frac{\text{Curr} - \text{Prev}}{\text{Prev}} \right) \times 100 & \text{if } \text{Prev} > 0 
  \end{cases}$$
* **Metrics Calculated**: `gross_revenue_change_pct`, `tickets_sold_change_pct`, `net_revenue_change_pct`.

---

## 3. Donut Breakdowns & Percentage Share (Tier & Category)

### 3.1 Definition & Revenue Basis Reconciliation
* **Plain Language Explanation**: Represents the relative proportion of ticket face revenue contributed by each ticket tier or event category during the active date filter period.
* **Architectural Nuance & Reconciliation**:
  - Top-level `gross_revenue_vnd` measures net cash collected at the **order level** (`SUM(o.final_total_cents)` = ticket subtotals + service fees - voucher discounts).
  - Donut breakdowns measure **ticket sales volume and revenue by face value** (`SUM(t.price_cents)`).
  - To guarantee that slice `percentage_share` values sum to **exactly 100.0%** without being distorted by unallocated order fees, the denominator is the sum of ticket face revenues across all breakdown slices within the period ($\sum_{\text{all}} \text{t.price\_cents}$).
* **Formula**:
  $$\text{Percentage Share (\%)} = \left( \frac{\sum_{\text{tier/cat}} \text{t.price\_cents}}{\sum_{\text{all tiers/cats}} \text{t.price\_cents}} \right) \times 100$$

---

### 3.2 SQL Query Logic
```sql
-- Tier Breakdown Query (Filtered by Period)
SELECT 
    COALESCE(tt.label, 'Tiêu chuẩn') AS tier_name,
    COALESCE(SUM(t.price_cents), 0)::bigint AS revenue_vnd,
    COALESCE(COUNT(t.id), 0)::int AS tickets_sold
FROM events e
JOIN showtimes s ON s.event_id = e.id
JOIN ticket_tiers tt ON tt.showtime_id = s.id
JOIN reservation_items ri ON ri.ticket_tier_id = tt.id
JOIN tickets t ON t.reservation_item_id = ri.id
JOIN orders o ON o.id = t.order_id AND o.payment_status IN ('paid', 'completed', 'refunded', 'partially_refunded')
WHERE e.organizer_id = $1
  AND o.created_at >= $2 AND o.created_at <= $3
GROUP BY tt.label;
```

```typescript
const totalTierRevenue = tierBreakdownRes.rows.reduce((acc, r) => acc + Number(r.revenue_vnd || 0), 0);

const tierBreakdown = tierBreakdownRes.rows.map((r) => {
  const rev = Number(r.revenue_vnd || 0);
  return {
    tier_name: String(r.tier_name),
    revenue_vnd: rev,
    tickets_sold: Number(r.tickets_sold || 0),
    percentage_share: totalTierRevenue > 0 ? Number(((rev / totalTierRevenue) * 100).toFixed(1)) : 0,
  };
});
```

* **Example Calculation**:
  - VIP Pass Revenue = 240,000,000₫
  - Standard Pass Revenue = 210,000,000₫
  - Early Bird Revenue = 105,000,000₫
  - Total Tier Revenue = **555,000,000₫**
  - **VIP Share**: `(240,000,000 / 555,000,000) * 100` = **43.2%**
  - **Standard Share**: `(210,000,000 / 555,000,000) * 100` = **37.8%**
  - **Early Bird Share**: `(105,000,000 / 555,000,000) * 100` = **18.9%**
  - **Sum of Shares** = `43.2% + 37.8% + 18.9%` = **100.0%**.

---

## 4. Upcoming Event Capacity Gauge (`fill_percentage`)

* **Plain Language Explanation**: Measures ticket sales progress against maximum capacity for the organizer's **soonest upcoming event** (`starts_at > NOW()` & `status IN ('on_sale', 'draft')`).
* **Formula**:
  $$\text{Upcoming Event Fill (\%)} = \left( \frac{\text{Sold Tickets for Event}}{\text{Total Ticket Capacity for Event}} \right) \times 100$$
* **SQL Query Logic**:
  ```sql
  SELECT 
      e.id,
      e.title,
      COALESCE(ec.label_vi, 'Khác') AS category,
      s.starts_at,
      COALESCE(SUM(tt.total_quantity), 0)::int AS capacity,
      COALESCE(COUNT(t.id), 0)::int AS sold
  FROM events e
  JOIN showtimes s ON s.event_id = e.id
  LEFT JOIN event_categories ec ON ec.id = e.category_id
  LEFT JOIN ticket_tiers tt ON tt.showtime_id = s.id
  LEFT JOIN reservations r ON r.showtime_id = s.id
  LEFT JOIN orders o ON o.reservation_id = r.id AND o.payment_status IN ('paid', 'completed')
  LEFT JOIN tickets t ON t.order_id = o.id
  WHERE e.organizer_id = $1
    AND e.status IN ('on_sale', 'draft')
    AND s.starts_at > NOW()
  GROUP BY e.id, e.title, ec.label_vi, s.starts_at
  ORDER BY s.starts_at ASC
  LIMIT 1;
  ```

---

## 5. Check-In & Attendance Analytics (`checkin_rate_pct`)

* **Plain Language Explanation**: The ratio of entrance-scanned valid tickets to total valid tickets issued for the organizer's events.
* **Formula**:
  $$\text{Check-In Rate (\%)} = \left( \frac{\text{Total Scanned Valid Tickets}}{\text{Total Issued Valid Tickets}} \right) \times 100$$

### 5.1 Numerator Query ("Total Scanned Valid Tickets")
```sql
SELECT COALESCE(COUNT(CASE WHEN t.qr_status = 'checked_in' THEN 1 END), 0)::int AS total_scanned
FROM events e
JOIN showtimes s ON s.event_id = e.id
JOIN reservations r ON r.showtime_id = s.id
JOIN orders o ON o.reservation_id = r.id AND o.payment_status IN ('paid', 'completed')
JOIN tickets t ON t.order_id = o.id AND t.qr_status != 'void'
WHERE e.organizer_id = $1;
```

### 5.2 Denominator Query ("Total Issued Valid Tickets")
```sql
SELECT COALESCE(COUNT(t.id), 0)::int AS total_issued
FROM events e
JOIN showtimes s ON s.event_id = e.id
JOIN reservations r ON r.showtime_id = s.id
JOIN orders o ON o.reservation_id = r.id AND o.payment_status IN ('paid', 'completed')
JOIN tickets t ON t.order_id = o.id AND t.qr_status != 'void'
WHERE e.organizer_id = $1;
```

* **Confirmation**: The denominator `total_issued` specifically measures valid, non-void tickets issued for active orders. It is completely isolated and does not reuse overall venue capacity or period-bounded sales counters.
* **Example Calculation**:
  - Total Scanned Tickets (`qr_status = 'checked_in'`) = 45
  - Total Issued Valid Tickets = 880
  - **Check-In Rate** = `(45 / 880) * 100` = **5.1%**.

---

## 6. Audit of VND Scale & `_cents` Column Naming

> [!NOTE]
> **Schema Naming vs Storage Scale Audit**:
> - **Column Names**: `final_total_cents`, `price_cents`, `subtotal_cents`, `service_fee_cents`, `amount_cents`.
> - **Storage Scale**: Stores **raw integer VND đồng directly** (e.g. `1500000` = 1,500,000 VNĐ).
> - **Rationale**: In Vietnam Dong (VND), currency values are integer đồng without fractional cents/subunits. The `_cents` suffix is a legacy schema naming artifact from US dollar template codebases.
> - **Conversion Audit**: Confirmed there is **zero division or multiplication by 100** anywhere in `analyticsService.ts`, `wallet.service.ts`, or the seed scripts. Database integers flow 1-to-1 into VND formatters.

---

## 7. Summary Metric Matrix

| Metric Name | Type | Key Table Sources | Scope / Period | Range Bounds |
| :--- | :--- | :--- | :--- | :--- |
| `gross_revenue_vnd` | Integer VND | `orders`, `reservations`, `events` | Filtered (`7d`/`this_month`/`custom`) | $[0, \infty)$ |
| `total_refund_amount_vnd` | Integer VND | `tickets`, `orders`, `events` | Filtered (`7d`/`this_month`/`custom`) | $[0, \infty)$ |
| `net_revenue_vnd` | Integer VND | Derived | Filtered (`7d`/`this_month`/`custom`) | $[0, \infty)$ |
| `total_tickets_sold` | Count | `tickets`, `orders`, `events` | Filtered (`7d`/`this_month`/`custom`) | $[0, \infty)$ |
| `capacity_fill_rate` | Percentage | `tickets`, `ticket_tiers`, `events` | Organizer Active Events Lifetime | $[0\%, 100\%]$ |
| `percentage_share` | Percentage | `tickets`, `ticket_tiers`, `orders` | Filtered (`7d`/`this_month`/`custom`) | Sum $= 100\%$ |
| `fill_percentage` (Gauge)| Percentage | `tickets`, `ticket_tiers`, `showtimes` | Soonest Upcoming Event | $[0\%, 100\%]$ |
| `checkin_rate_pct` | Percentage | `tickets`, `checkin_records`, `orders` | Lifetime Issued Valid Tickets | $[0\%, 100\%]$ |
