# Các tính năng backend đã triển khai

Tài liệu này tổng hợp các tính năng đang có trong mã nguồn `server/src` và các endpoint tương ứng. Prefix chung của API là `/api`.

## 1. Xác thực và tài khoản

Module: `server/src/modules/auth`

- Đăng ký bằng email/mật khẩu, chuẩn hóa email/số điện thoại, kiểm tra mật khẩu mạnh và chống trùng dữ liệu.
- Đăng nhập bằng email hoặc số điện thoại.
- Đăng nhập/đăng ký bằng Google OAuth.
- Access token JWT ngắn hạn và refresh token trong cookie `httpOnly`.
- Xoay vòng refresh token, giới hạn thời gian sống, phát hiện token reuse và thu hồi theo session family.
- Đăng xuất phiên hiện tại hoặc tất cả phiên.
- Khôi phục phiên qua refresh token.
- Đổi mật khẩu; các phiên khác bị thu hồi.
- Quên mật khẩu và đặt lại mật khẩu bằng token một lần, có thời hạn.
- Xem/cập nhật hồ sơ (nickname, phone).
- Upload avatar: giới hạn kích thước, xử lý lại thành WebP, lưu file và xóa avatar cũ.
- Ghi audit auth event (đăng nhập thành công/thất bại, logout, đổi/reset mật khẩu, phát hiện reuse...).
- Rate limit đăng ký/đăng nhập/forgot-password và progressive delay khi đăng nhập sai.

### Endpoint

| Method | Endpoint | Mô tả |
|---|---|---|
| `POST` | `/auth/register` | Đăng ký và tạo session |
| `POST` | `/auth/login` | Đăng nhập bằng email/phone |
| `POST` | `/auth/oauth/google` | Đăng nhập/đăng ký Google |
| `POST` | `/auth/refresh` | Xoay vòng refresh token |
| `POST` | `/auth/logout` | Đăng xuất session hiện tại |
| `POST` | `/auth/logout-all` | Thu hồi toàn bộ session |
| `GET` | `/me` | Lấy thông tin tài khoản hiện tại |
| `PATCH` | `/me` | Cập nhật nickname/phone |
| `POST` | `/me/password` | Đổi mật khẩu |
| `POST` | `/me/avatar` | Upload avatar |
| `POST` | `/auth/password/forgot` | Gửi liên kết đặt lại mật khẩu |
| `POST` | `/auth/password/reset` | Đặt lại mật khẩu bằng token |

## 2. Đăng ký nhà tổ chức

- Người dùng gửi đơn đăng ký nhà tổ chức.
- Chặn gửi đơn mới khi đang pending, đã approved hoặc đang suspended.
- Xem trạng thái hiện tại và lịch sử các đơn đăng ký.
- Chỉ organizer đã được duyệt mới truy cập được khu vực quản trị catalog.

| Method | Endpoint | Mô tả |
|---|---|---|
| `POST` | `/organizers/apply` | Gửi đơn đăng ký organizer |
| `GET` | `/organizers/me` | Xem trạng thái/lịch sử đơn |
| `GET` | `/organizers/dashboard` | Kiểm tra quyền truy cập dashboard organizer |

## 3. Catalog công khai

Module: `server/src/modules/catalog/catalog.public.routes.ts`

- Liệt kê sự kiện đang hiển thị công khai.
- Tìm kiếm/lọc theo từ khóa, danh mục, thành phố, ngày, khoảng giá và tình trạng còn vé.
- Phân trang danh sách sự kiện.
- Xem chi tiết sự kiện bằng slug.
- Xem các suất diễn.
- Xem seat map chỉ đọc.
- Sự kiện draft/pending/removed/flagged không bị lộ qua API công khai.

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/events` | Danh sách và bộ lọc sự kiện |
| `GET` | `/events/:slug` | Chi tiết sự kiện |
| `GET` | `/events/:id/showtimes` | Danh sách suất diễn |
| `GET` | `/showtimes/:id/seat-map` | Seat map của suất diễn |

## 4. Quản lý catalog cho organizer

Module: `server/src/modules/catalog/organizer.routes.ts` (mọi route yêu cầu đăng nhập và organizer đã duyệt)

- Tạo, xem, chỉnh sửa, publish và unpublish sự kiện.
- Hỗ trợ hai loại sự kiện: general admission và seated.
- Tạo/quản lý venue.
- Tạo suất diễn và các hạng vé.
- Tạo section, thêm ghế vật lý, xóa ghế chưa được dùng trong seat map.
- Tạo seat map cho suất diễn seated và gán hạng vé theo section.
- Kiểm tra ownership của event, venue, seat và showtime.

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/organizer/events` | Danh sách sự kiện của organizer |
| `POST` | `/organizer/events` | Tạo sự kiện |
| `PATCH` | `/organizer/events/:id` | Cập nhật sự kiện |
| `POST` | `/organizer/events/:id/publish` | Gửi sự kiện để duyệt |
| `POST` | `/organizer/events/:id/unpublish` | Gỡ publish |
| `POST` | `/organizer/events/:id/showtimes` | Tạo suất diễn và hạng vé |
| `GET` | `/organizer/events/:id/showtimes-manage` | Dữ liệu quản lý suất diễn |
| `GET` | `/organizer/venues` | Danh sách venue của organizer |
| `POST` | `/organizer/venues` | Tạo venue |
| `GET` | `/organizer/venues/:id/sections` | Danh sách section |
| `POST` | `/organizer/venues/:id/sections` | Tạo section |
| `POST` | `/organizer/venues/:id/seats` | Thêm nhiều ghế theo hàng |
| `DELETE` | `/organizer/seats/:id` | Xóa ghế chưa nằm trong seat map live |
| `POST` | `/organizer/showtimes/:id/seat-map` | Sinh seat map cho suất diễn |

## 5. Moderation cho admin

Module: `server/src/modules/catalog/moderation.routes.ts` (mọi route yêu cầu admin)

- Xem hàng đợi sự kiện chờ duyệt.
- Approve để sự kiện đủ điều kiện hiển thị.
- Reject với lý do.
- Flag sự kiện đã duyệt để ẩn và xem xét lại.
- Remove/takedown sự kiện, lưu lý do tùy chọn.
- Ghi audit log cho các thao tác moderation.

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/admin/moderation` | Hàng đợi duyệt |
| `POST` | `/admin/events/:id/approve` | Duyệt sự kiện |
| `POST` | `/admin/events/:id/reject` | Từ chối sự kiện |
| `POST` | `/admin/events/:id/flag` | Gắn cờ và ẩn sự kiện |
| `POST` | `/admin/events/:id/remove` | Gỡ sự kiện |

## 6. Giữ chỗ và seat inventory

Module: `server/src/modules/holds`

- Giữ ghế cụ thể cho sự kiện seated hoặc giữ số lượng vé theo tier cho general admission.
- Mỗi người dùng chỉ có một reservation active cho một suất diễn.
- Thao tác giữ chỗ có tính idempotent khi giữ lại đúng ghế đã sở hữu.
- Giới hạn số vé giữ trên mỗi tài khoản/suất diễn.
- Khóa hàng trong transaction để tránh hai người cùng giữ một ghế.
- Kiểm tra tồn kho tier và trạng thái bán của showtime.
- Thêm vào, bỏ bớt ghế và hủy toàn bộ reservation.
- Reservation có TTL, thời hạn tuyệt đối và sweep phía server để giải phóng tự động.
- Không gia hạn TTL khi thêm lựa chọn; có helper nội bộ cho grace một lần theo cấu hình (chưa có public wallet/top-up route).
- Phát broadcast seat/tier update sau khi transaction commit.
- Rate limit thao tác giữ/bỏ/hủy chỗ.

| Method | Endpoint | Mô tả |
|---|---|---|
| `POST` | `/reservations` | Tạo hoặc nối vào reservation active |
| `GET` | `/reservations/active?showtimeId=:id` | Lấy reservation active của người dùng |
| `GET` | `/reservations/:id` | Xem reservation thuộc quyền sở hữu |
| `PATCH` | `/reservations/:id` | Thêm lựa chọn hoặc bỏ ghế |
| `DELETE` | `/reservations/:id` | Hủy và giải phóng toàn bộ |

## 7. Realtime và nền tảng backend

- Socket.IO dùng room riêng cho từng showtime.
- Guest có thể theo dõi thay đổi seat map; chỉ REST API đã xác thực mới được thay đổi trạng thái.
- Xác thực token Socket.IO là tùy chọn; token không hợp lệ chỉ được kết nối read-only.
- Express có JSON body limit, cookie parser, static serving cho avatar với `nosniff`, middleware 404 và error handler.
- Middleware `validate` dùng Zod và trả lỗi `validation_failed` thống nhất.
- Migration runner chạy các file SQL theo thứ tự và lưu ledger `schema_migrations`.
- Database PostgreSQL có schema cho users/session/password reset/auth events, organizers, events/venues/seats/showtimes/ticket tiers, reservations và audit logs.

## 8. Ví và checkout

Module: `server/src/modules/payments`

- Mỗi tài khoản có ví số dư VND, được tạo cùng tài khoản.
- Tạo giao dịch nạp ví và URL redirect đến VNPay sandbox.
- Chỉ IPN VNPay có chữ ký HMAC-SHA512 hợp lệ mới ghi có số dư; browser return URL chỉ hiển thị trạng thái.
- IPN lặp được xử lý idempotent: mỗi top-up chỉ có một bút toán ledger.
- Checkout chỉ dùng số dư ví: khóa reservation, ví và inventory; trừ ví, chuyển held thành sold, tăng lượng đã bán, tạo order/ticket và ledger trong cùng transaction.
- Mỗi reservation chỉ chuyển thành một order; retry checkout trả lại order đã tạo.

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/wallet` | Xem số dư ví |
| `POST` | `/wallet/topups` | Tạo top-up VNPay và lấy payment URL |
| `GET` | `/wallet/topups/:id` | Xem trạng thái top-up |
| `GET`/`POST` | `/payments/vnpay/ipn` | VNPay callback, xác thực chữ ký và credit ví |
| `GET` | `/payments/vnpay/return` | Kết quả redirect hiển thị cho browser, không credit ví |
| `POST` | `/checkout` | Thanh toán reservation bằng ví, tạo ticket |
| `GET` | `/orders/:id` | Xem order/ticket thuộc tài khoản |

## Chưa thấy backend implementation trong module hiện tại

QR đang được lưu dưới dạng ticket code duy nhất nhưng chưa có renderer QR hoặc route check-in. Waitlist, review/rating, notification và recommendation/AI cũng chưa có module backend.
