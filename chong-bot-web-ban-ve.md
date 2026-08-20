# Đánh Giá Chống Bot Dựa Trên Source Code Hiện Tại (TixHub)

> Đánh giá dựa trên audit thực tế source code (Node.js/Express, PostgreSQL, Socket.IO, Nginx) đối chiếu với 5 loại bot đã xác định. Không bao gồm Cloudflare CDN/WAF (giải pháp hạ tầng bên thứ ba). Không dùng OTP — CAPTCHA (Cloudflare Turnstile) đóng vai trò lớp phòng thủ chính cho các luồng đăng ký/đăng nhập/giữ chỗ.

---

## Bảng tóm tắt đối chiếu thực trạng và giải pháp

| Loại Bot | Nguy cơ | Tình trạng Codebase hiện tại | Điểm cần điều chỉnh / bổ sung |
|---|---|---|---|
| **1. Scalping / Sniping** (săn/gom vé tự động) | Rất cao (vấn đề cốt lõi của web bán vé) | Có khóa dòng DB (`SELECT FOR UPDATE`, `lockSeats`). Giới hạn số vé/người (`max_tickets_per_buyer = 8`). Throttle giữ chỗ: `holdRateLimit` (12 req/phút in-memory). | Chưa có Virtual Waiting Room khi mở bán vé hot. Chưa có kiểm tra thời gian tương tác hợp lý (behavioral timing). Chưa tích hợp CAPTCHA Turnstile khi tạo đơn giữ chỗ. |
| **2. Multiple / Fake Account** (tạo nick ảo hàng loạt) | Trung bình – Cao (lách quota mua vé) | Rate limit đăng ký: 30 req/phút/IP (`reg:${ipKey}`). Chuẩn hóa email, regex SĐT. | Không có bước xác thực nào ngoài rate limit IP. Rate limit 30 nick/phút/IP quá rộng. Chưa chặn domain email tạm/rác (tempmail, 10minutemail). Chưa có CAPTCHA ở form đăng ký. |
| **3. Carding** (dò/thử thẻ tín dụng bị đánh cắp) | Thấp (do kiến trúc hiện tại) | Hệ thống dùng Ví nội bộ + Sandbox VNPay (`POST /api/checkout`). Không trực tiếp nhận/xử lý thẻ tín dụng trên web. | Có thể bị spam tạo giao diện Nạp ví (`/wallet/topups`) để trục lợi gia hạn giữ chỗ (+7 phút `extendOnce`). Cần rate limit nạp ví. |
| **4. Credential Stuffing** (dò mật khẩu tự động) | Trung bình | Rate limit IP: 100 req/phút. Áp dụng progressive delay (tăng dần 0–5000ms theo số lần sai) trên hash email/SĐT. Không khóa tài khoản cứng (tránh DoS). | Ngưỡng IP 100 req/phút còn cao đối với bot phân tán. Cần kích hoạt CAPTCHA Turnstile khi phát hiện đăng nhập sai từ 3 lần trở lên. |
| **5. Price & Inventory Scraping** (cào dữ liệu vé/giá) | Trung bình | Endpoint đọc công khai: `/api/events`, `/api/showtimes/:id/seat-map`. Trả về trực tiếp trạng thái ghế và số lượng vé còn lại. | Chưa có bất kỳ rate limit nào trên các route public catalog. Chưa có cache ngắn hạn ở API/Nginx để giảm tải DB. |

---

## Chi tiết phân tích và đề xuất điều chỉnh theo từng loại bot

### 1. Scalping / Sniping Bot (Bot săn vé, gom vé)

**Hiện trạng trong code:**
- Endpoint `reservations.routes.ts:54-62` đã có middleware `holds.throttle.ts:14-35` giới hạn 12 thao tác/phút trên mỗi tài khoản và kiểm tra `max_tickets_per_buyer` trong `holds.service.ts:122-127`.
- Khóa ghế chống trùng lặp sử dụng Transaction + Row lock PostgreSQL rất chuẩn xác (`lockSeats` / `bumpReserved`).

**Lỗ hổng:**
- Khi mở bán các sự kiện hot (Flash Drop), bot có thể gửi lệnh giữ chỗ đúng mili-giây mở bán. `holdRateLimit` chỉ giới hạn tần suất thao tác, nhưng không ngăn được bot gửi 1 request giữ trọn 8 vé nhanh hơn người thường hàng trăm lần.

**Đề xuất điều chỉnh & bổ sung:**

1. **Virtual Waiting Room (Hàng đợi ảo):**
   - Triển khai hàng đợi bằng Redis Sorted Set (như gợi ý trong tài liệu) hoặc token queue trong bộ nhớ.
   - Khi sự kiện mở bán, người dùng truy cập trang chọn ghế sẽ được đưa vào Waiting Room và cấp một `queueToken` (được xáo trộn ngẫu nhiên thứ tự ưu tiên). `POST /api/reservations` bắt buộc phải kèm `queueToken` hợp lệ mới cho phép giữ chỗ.

2. **Behavioral Timing Verification (Kiểm tra thời gian tương tác):**
   - Client khi tải sơ đồ ghế sẽ nhận một token kèm thời gian (`viewTimestamp`).
   - Khi gửi request giữ chỗ, server kiểm tra `Date.now() - viewTimestamp >= 1500ms`. Nếu dưới 1.5s, từ chối vì không khả thi với thao tác người thật.

3. **CAPTCHA Challenge (Cloudflare Turnstile):**
   - Yêu cầu xác thực Turnstile (không xâm nhập, gần như vô hình với người dùng thật) tại thời điểm bấm "Xác nhận giữ vé" cho các sự kiện Flash Drop / vé hot.
   - Xem [phần triển khai Turnstile](#triển-khai-cloudflare-turnstile) ở cuối tài liệu.

---

### 2. Multiple Account / Fake Account Bot (Bot tạo tài khoản ảo)

**Hiện trạng trong code:**
- Route `auth.routes.ts:120-167` có `allow('reg:${ipKey(req.ip)}', 30, 60_000)` (cho phép tối đa 30 đăng ký/phút/IP).
- Chuẩn hóa email bằng `identifier.ts:33` và số điện thoại bằng `identifier.ts:42`.

**Lỗ hổng:**
- 30 tài khoản/phút từ 1 địa chỉ IP là quá lỏng, tạo điều kiện cho bot sinh tài khoản ảo hàng loạt để gom vé hoặc lách quota.
- Chưa có bộ lọc tên miền email rác/dùng 1 lần.
- Không có bước xác thực nào chặn được bot tự động submit form đăng ký hàng loạt.

**Đề xuất điều chỉnh & bổ sung:**

1. **Bắt buộc CAPTCHA Turnstile ở form đăng ký:**
   - Đây là lớp chính thay thế cho OTP — chặn được bot script tự động submit hàng loạt vì Turnstile yêu cầu chạy JS thật trong trình duyệt và có risk-score phân tích hành vi.
   - `POST /api/auth/register` bắt buộc kèm `turnstileToken` hợp lệ mới được xử lý.

2. **Chặn Disposable Email Domains:**
   - Cài đặt thư viện `disposable-email-domains` và thêm bước kiểm tra trong `auth.routes.ts:131`:
     ```ts
     import disposableDomains from 'disposable-email-domains';

     const domain = email.split('@')[1];
     if (disposableDomains.includes(domain)) {
       throw err.badRequest('disposable_email_blocked', 'Vui lòng sử dụng địa chỉ email chính thức, không dùng email tạm thời.');
     }
     ```

3. **Siết chặt Rate Limit Đăng ký (lớp lọc thô, bổ trợ):**
   - Giảm từ 30 req/phút xuống **5-8 tài khoản mới / 1 IP / 1 giờ**.
   - *(Xem phần "Xác nhận về IP & NAT" ở cuối tài liệu.)*

4. **Chặn alias email dạng +tag (Sub-addressing):**
   - Kẻ gian thường dùng `user+1@gmail.com`, `user+2@gmail.com` để trở về 1 hộp thư. Chuẩn hóa loại bỏ phần `+...` đối với Gmail/Outlook trước khi lưu để ngăn 1 người tạo nhiều nick từ 1 hộp thư gốc.

---

### 3. Carding Bot (Dò thẻ ngân hàng bị đánh cắp)

**Hiện trạng trong code:**
- TixHub không sử dụng cổng thanh toán trực tiếp qua thẻ tín dụng mà áp dụng mô hình Ví người dùng + Cổng VNPay Sandbox (`wallet.routes.ts`).
- Do đó, TixHub không có rủi ro bị dùng làm nơi test thẻ tín dụng bị đánh cắp trực tiếp trên hệ thống.

**Lỗ hổng phụ cần lưu ý:**
- Khi `wallet.routes.ts:99-147`, hệ thống có cơ chế giữ chỗ thêm tối đa 7 phút để chờ thanh toán VNPay.
- Bot có thể liên tục tạo top-up ảo để làm rác database và giữ ghế lâu hơn bình thường (lợi dụng `extendOnce`).

**Đề xuất điều chỉnh:**
- Thêm Rate Limit cho `POST /api/wallet/topups` (tối đa 5 lượt tạo yêu cầu nạp tiền / 10 phút / user).
- Giới hạn mỗi tài khoản chỉ được có tối đa 2 lệnh nạp tiền ở trạng thái `initiated` cùng lúc.

---

### 4. Credential Stuffing Bot (Dò mật khẩu tự động)

**Hiện trạng trong code:**
- Codebase đã có thiết kế rất tốt trong `throttle.ts:38-56`: sử dụng `throttle.ts:53` làm chậm phản hồi khi đăng nhập sai nhiều lần và `password.ts:22` để chống timing attack.
- Không khóa tài khoản vĩnh viễn (tránh kẻ xấu cố tình khóa tài khoản của người khác) — thiết kế hợp lý.

**Lỗ hổng:**
- Rate limit IP `allow('login:${ipKey(req.ip)}', 100, 60_000)` hiện tại (100 lần/phút/IP) vẫn đủ rộng để bot xoay vòng mật khẩu thử nghiệm.

**Đề xuất điều chỉnh & bổ sung:**

1. **Hạ ngưỡng rate limit IP:**
   - Đưa về mức tối đa **10-15 lần thử / 15 phút** trên mỗi IP.

2. **Yêu cầu CAPTCHA theo ngữ cảnh (Adaptive Turnstile):**
   - Khi số lần đăng nhập sai của 1 email/IP vượt quá 3 lần, response trả về yêu cầu client phải giải một CAPTCHA Turnstile trước khi cho phép bấm đăng nhập tiếp.

---

### 5. Price & Inventory Scraping Bot (Cào dữ liệu giá và sơ đồ ghế)

**Hiện trạng trong code:**
- Router `catalog.public.routes.ts` cung cấp các endpoint công khai:
  - `GET /api/events`
  - `GET /api/events/:slug`
  - `GET /api/events/:id/showtimes`
  - `GET /api/showtimes/:id/seat-map`
- Tất cả các route trên hoàn toàn chưa có rate limiting và không có bộ nhớ đệm (cache).

**Lỗ hổng:**
- Bot cào dữ liệu có thể liên tục gọi `GET /api/showtimes/:id/seat-map` mỗi 100ms để phát hiện khi nào có vé/ghế mới được nhả ra (hoặc khi ai đó hủy đơn) để kích hoạt bot săn vé mua ngay.
- Gây quá tải CPU và connection pool của PostgreSQL.

**Đề xuất điều chỉnh & bổ sung:**

1. **Áp dụng Rate Limiting cho API Catalog:**
   - Thêm middleware giới hạn `GET /api/events` và `GET /api/showtimes/:id/seat-map` (ví dụ: tối đa 30 requests / phút / IP).

2. **Bộ nhớ đệm (Caching / Stale-While-Revalidate):**
   - Thiết lập cache ngắn hạn (5-10 giây) tại Nginx (`nginx.conf`) hoặc trong bộ nhớ Node.js cho endpoint `GET /api/events/:slug`.

3. **Tận dụng WebSocket / SSE thay vì cho phép Polling:**
   - Vì TixHub đã có kênh sóng real-time `Socket.IO` (`io.ts`), client thực tế không cần gọi lại API REST liên tục. Cần chặn các IP polling REST API quá mức bình thường.

---

## Triển khai Cloudflare Turnstile

Turnstile là widget CAPTCHA độc lập của Cloudflare — **không yêu cầu trỏ domain qua Cloudflare CDN/proxy**, chỉ cần nhúng script + verify token ở backend. Phù hợp để dùng làm lớp chính thay thế OTP.

### Bước 1 — Lấy Site Key & Secret Key
1. Vào https://dash.cloudflare.com → tạo tài khoản free.
2. Vào mục **Turnstile** → **Add Site** → nhập domain.
3. Lưu `Site Key` và `Secret Key` vào `.env`:

```dotenv
# Cloudflare Turnstile
TURNSTILE_SITE_KEY=""
TURNSTILE_SECRET_KEY=""
```

> Lưu ý: nên đổi tên biến sang `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` (viết hoa, gạch dưới) thay vì `site-key` / `secret-key` — dấu gạch ngang `-` không phải ký tự hợp lệ chuẩn cho tên biến môi trường, dù hầu hết thư viện `dotenv` vẫn parse được, việc đổi tên giúp tránh lỗi khi truy cập qua `process.env.TURNSTILE_SITE_KEY` (cú pháp dấu chấm không dùng được với tên có gạch ngang, phải viết `process.env['site-key']`).

### Bước 2 — Nhúng ở Frontend

```html
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<div class="cf-turnstile" data-sitekey="TURNSTILE_SITE_KEY_HERE"></div>
```

Token sinh ra tự động nằm trong input ẩn tên `cf-turnstile-response` khi form submit — gửi kèm giá trị này lên backend (field `turnstileToken`).

### Bước 3 — Verify ở Backend

```ts
async function verifyTurnstile(token: string, remoteIp?: string): Promise<boolean> {
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: process.env.TURNSTILE_SECRET_KEY,
      response: token,
      remoteip: remoteIp,
    }),
  });
  const data = await response.json();
  return data.success === true;
}

// Dùng trong route đăng ký / đăng nhập / giữ chỗ
app.post('/api/auth/register', async (req, res) => {
  const ok = await verifyTurnstile(req.body.turnstileToken, req.ip);
  if (!ok) {
    return res.status(400).json({ error: 'captcha_failed', message: 'Xác thực CAPTCHA thất bại, vui lòng thử lại.' });
  }
  // ... tiếp tục xử lý đăng ký
});
```

Không cần cài thêm package nếu dùng Node.js 18+ (đã có `fetch` built-in). Với Node cũ hơn: `npm install node-fetch`.

### Nơi áp dụng Turnstile trong TixHub

| Route | Mục đích |
|---|---|
| `POST /api/auth/register` | Chặn bot tạo tài khoản ảo hàng loạt |
| `POST /api/auth/login` (khi sai ≥ 3 lần) | Chặn credential stuffing |
| `POST /api/reservations` (sự kiện Flash Drop) | Chặn scalping bot giữ chỗ tự động |

---

## Xác nhận về việc chặn theo IP & rủi ro NAT

**Câu hỏi đặt ra:** Giới hạn 5 tài khoản / 1 IP / 1 giờ cho đăng ký — có ổn không, khi 1 nhà/1 mạng dùng chung router có thể có nhiều thiết bị khác nhau?

**Đánh giá:**

- Ngưỡng 5 acc/IP/giờ là **hợp lý cho hành vi bình thường**. Người dùng thật hiếm khi tự đăng ký 5 tài khoản mới trong cùng 1 giờ, kể cả hộ gia đình nhiều thành viên dùng chung wifi.
- Rủi ro NAT thật sự đáng lo ở các mạng có **mật độ người dùng cao trên ít IP**: mạng 4G nhà mạng, ký túc xá, văn phòng, quán net, trường học — nơi hàng chục đến hàng trăm người có thể chia sẻ chung 1 địa chỉ IP public.

**Khuyến nghị triển khai (không dùng OTP):**

1. Dùng rate limit IP như **lớp lọc thô ban đầu**, không phải lớp chặn cuối cùng quyết định — khi vượt ngưỡng, trả về yêu cầu CAPTCHA Turnstile thay vì chặn cứng hoàn toàn.
2. Chặn tạm thời theo IP nên có TTL ngắn (khôi phục sau 1 giờ), tránh ảnh hưởng lâu dài đến người dùng ở mạng chia sẻ.
3. **CAPTCHA Turnstile là lớp chính** thay thế OTP để chặn fake account — vì Turnstile chặn được bot script tự động (không chạy được JS thật hoặc bị risk-score thấp), trong khi vẫn gần như vô hình với người dùng thật.
4. Kết hợp thêm kiểm tra domain email disposable (mục 2) làm lớp bổ trợ chi phí thấp, không phụ thuộc vào IP.

**Đánh đổi khi bỏ OTP:** Turnstile chặn tốt bot tự động (script, headless browser cấp thấp), nhưng không ngăn được người thật cố tình tạo nhiều tài khoản thủ công bằng tay (vì Turnstile vẫn pass được nếu có người thật đứng sau click). Nếu sau này phát hiện tình trạng lách quota bằng tay xảy ra nhiều, nên cân nhắc bổ sung xác thực SĐT/OTP trở lại cho riêng luồng mua vé số lượng lớn.

**Kết luận:** 5 acc/IP/giờ là mức khởi điểm ổn để áp dụng, kết hợp CAPTCHA Turnstile làm lớp chính chặn bot script và cơ chế phản hồi mềm (yêu cầu CAPTCHA) thay vì chặn cứng khi vượt ngưỡng.

---

*Tài liệu dựa trên audit thực tế source code TixHub (Node.js/Express, PostgreSQL, Socket.IO, Nginx). Không bao gồm Cloudflare CDN/WAF. Không dùng OTP — CAPTCHA (Cloudflare Turnstile) là lớp phòng thủ chính cho các luồng đăng ký, đăng nhập, và giữ chỗ vé.*