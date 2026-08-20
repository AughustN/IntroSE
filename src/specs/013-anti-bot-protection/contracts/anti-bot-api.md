# API Interface Contracts: Anti-Bot Protection Suite

**Feature**: Comprehensive Anti-Bot Protection Suite  
**Branch**: `013-anti-bot-protection`  
**Date**: 2026-08-20  

---

## 1. Authentication Endpoints

### 1.1 User Registration (`POST /api/auth/register`)

**Headers**:
- `Content-Type: application/json`

**Request Body**:
```json
{
  "fullName": "Nguyen Van A",
  "email": "nguyen.a+bot123@gmail.com",
  "phone": "0912345678",
  "password": "SecurePassword123!",
  "turnstileToken": "0.XXXXX.YYYYY"
}
```

**Success Response (`201 Created`)**:
```json
{
  "user": {
    "id": 42,
    "email": "nguyen.a@gmail.com",
    "fullName": "Nguyen Van A",
    "role": "attendee"
  },
  "token": "jwt.access.token"
}
```
*Note*: Email is saved as normalized `nguyen.a@gmail.com` (stripped `+bot123`).

**Error Responses**:
- `400 Bad Request` (`captcha_failed`):
  ```json
  {
    "error": "captcha_failed",
    "message": "Xác thực CAPTCHA thất bại, vui lòng thử lại."
  }
  ```
- `400 Bad Request` (`disposable_email_blocked`):
  ```json
  {
    "error": "disposable_email_blocked",
    "message": "Vui lòng sử dụng địa chỉ email chính thức, không dùng email tạm thời."
  }
  ```
- `400 Bad Request` (`registration_limit_challenge_required`):
  ```json
  {
    "error": "registration_limit_challenge_required",
    "message": "Phát hiện nhiều lượt đăng ký từ mạng của bạn. Vui lòng hoàn thành xác thực bảo mật.",
    "requireCaptcha": true
  }
  ```

---

### 1.2 User Login (`POST /api/auth/login`)

**Headers**:
- `Content-Type: application/json`

**Request Body**:
```json
{
  "identifier": "nguyen.a@gmail.com",
  "password": "SecurePassword123!",
  "turnstileToken": "0.XXXXX.YYYYY" // Required if previous response indicated requireCaptcha: true
}
```

**Success Response (`200 OK`)**:
```json
{
  "user": {
    "id": 42,
    "email": "nguyen.a@gmail.com",
    "role": "attendee"
  },
  "token": "jwt.access.token"
}
```

**Error Responses**:
- `401 Unauthorized` (Normal failed attempt < 3):
  ```json
  {
    "error": "invalid_credentials",
    "message": "Email hoặc mật khẩu không chính xác.",
    "failedAttempts": 1,
    "requireCaptcha": false
  }
  ```
- `401 Unauthorized` (Adaptive CAPTCHA triggered ≥ 3 failures):
  ```json
  {
    "error": "captcha_required",
    "message": "Bạn đã nhập sai mật khẩu nhiều lần. Vui lòng giải CAPTCHA để tiếp tục.",
    "failedAttempts": 3,
    "requireCaptcha": true
  }
  ```
- `429 Too Many Requests` (IP rate limit 15 attempts / 15 min exceeded):
  ```json
  {
    "error": "too_many_login_attempts",
    "message": "Quá nhiều lần thử đăng nhập từ địa chỉ IP này. Vui lòng thử lại sau 15 phút.",
    "retryAfterSeconds": 900
  }
  ```

---

## 2. Seat Map & Timing Verification

### 2.1 Seat Map with Timing Ticket (`GET /api/showtimes/:id/seat-map`)

**Response (`200 OK`)**:
```json
{
  "showtime": {
    "id": 105,
    "eventId": 48,
    "startTime": "2026-09-15T19:30:00Z",
    "isHighDemand": true
  },
  "seats": [
    { "id": 1001, "code": "A-01", "status": "available", "price": 500000 },
    { "id": 1002, "code": "A-02", "status": "held", "price": 500000 }
  ],
  "timingTicket": "eyJzaG93dGltZUlkIjoxMDUsInZpZXdUaW1lc3RhbXAiOjE3NzE0ODgwMDAwMDB9.8f3a9b..."
}
```

**Caching Headers**:
- `Cache-Control: public, max-age=5, stale-while-revalidate=10`

---

## 3. Virtual Waiting Room Endpoints

### 3.1 Join Waiting Room (`POST /api/waiting-room/join`)

**Headers**:
- `Authorization: Bearer <JWT>`
- `Content-Type: application/json`

**Request Body**:
```json
{
  "showtimeId": 105
}
```

**Response (`200 OK`)**:
```json
{
  "status": "waiting",
  "queuePosition": 45,
  "estimatedWaitSeconds": 30,
  "showtimeId": 105
}
```
*Or, if immediate admission is available*:
```json
{
  "status": "admitted",
  "queueToken": "qt_9a8b7c6d5e4f...",
  "expiresAt": 1771488180000
}
```

### 3.2 Poll / Query Waiting Room Status (`GET /api/waiting-room/status?showtimeId=105`)

**Headers**:
- `Authorization: Bearer <JWT>`

**Response (`200 OK`)**:
```json
{
  "status": "admitted",
  "queueToken": "qt_9a8b7c6d5e4f...",
  "expiresAt": 1771488180000,
  "validitySecondsRemaining": 180
}
```

---

## 4. Seat Hold & Reservation Creation

### 4.1 Create Reservation Hold (`POST /api/reservations`)

**Headers**:
- `Authorization: Bearer <JWT>`
- `Content-Type: application/json`

**Request Body**:
```json
{
  "showtimeId": 105,
  "seatIds": [1001, 1002],
  "timingTicket": "eyJzaG93dGltZUlkIjoxMDUsInZpZXdUaW1lc3RhbXAiOjE3NzE0ODgwMDAwMDB9.8f3a9b...",
  "queueToken": "qt_9a8b7c6d5e4f...", // Required if isHighDemand is true
  "turnstileToken": "0.XXXXX.YYYYY"   // Required if isHighDemand is true
}
```

**Success Response (`201 Created`)**:
```json
{
  "reservation": {
    "id": 8801,
    "showtimeId": 105,
    "userId": 42,
    "status": "held",
    "seatIds": [1001, 1002],
    "totalAmount": 1000000,
    "holdExpiresAt": "2026-09-15T19:37:00Z"
  }
}
```

**Error Responses**:
- `400 Bad Request` (`inhuman_interaction_speed`):
  ```json
  {
    "error": "inhuman_interaction_speed",
    "message": "Thao tác quá nhanh. Vui lòng tương tác bình thường để giữ vé."
  }
  ```
- `403 Forbidden` (`queue_token_required`):
  ```json
  {
    "error": "queue_token_required",
    "message": "Sự kiện đang mở bán vé hot. Vui lòng tham gia phòng chờ để nhận lượt giữ vé."
  }
  ```
- `403 Forbidden` (`queue_token_expired`):
  ```json
  {
    "error": "queue_token_expired",
    "message": "Lượt phòng chờ đã hết hạn (quá 3 phút). Vui lòng xếp hàng lại."
  }
  ```

---

## 5. Wallet Top-Up Protection

### 5.1 Create Top-up Order (`POST /api/wallet/topups`)

**Headers**:
- `Authorization: Bearer <JWT>`
- `Content-Type: application/json`

**Request Body**:
```json
{
  "amount": 500000,
  "paymentMethod": "vnpay"
}
```

**Error Responses**:
- `400 Bad Request` (`too_many_pending_topups`):
  ```json
  {
    "error": "too_many_pending_topups",
    "message": "Bạn đang có 2 giao dịch nạp tiền chưa hoàn tất. Vui lòng thanh toán hoặc hủy trước khi tạo thêm."
  }
  ```
- `429 Too Many Requests` (`topup_rate_limited`):
  ```json
  {
    "error": "topup_rate_limited",
    "message": "Bạn đã tạo quá nhiều yêu cầu nạp tiền gần đây. Vui lòng thử lại sau ít phút."
  }
  ```
