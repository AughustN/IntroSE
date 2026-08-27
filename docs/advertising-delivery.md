# Quảng cáo luân phiên — fair_v1

## Hợp đồng

- Mỗi vị trí có hàng đợi riêng, cùng trọng số, không ưu tiên theo giá. Gói khác nhau ở vị trí và thời hạn.
- Trang chủ lấy một trailer và tối đa 10 sự kiện hot mỗi 30 giây khi tab đang hiển thị.
- Backend chia **cơ hội phân phối** theo bộ đếm bền vững; vị trí các thẻ hot được xáo trộn để tránh một sự kiện luôn cuối hàng.
- Đây không phải cam kết số lượt xem thực tế, số người duy nhất, nhấp hoặc doanh số. Không thể chia đều chính xác lượt nhìn thấy khi người xem cuộn/đóng trang khác nhau.
- Chỉ nhận sự kiện đang mở bán, đã duyệt, organizer đã duyệt, có suất diễn cuối sau ngày hết hạn gói. Gói trailer cần URL video được player hỗ trợ.
- Mặc định 4 chiến dịch trailer, 20 hot; điều chỉnh bằng `AD_HERO_CAPACITY` và `AD_HOT_CAPACITY` (1–1000). Đây là giới hạn ban đầu, phải đánh giá lại bằng lưu lượng thật; không phải dự báo khả năng phục vụ.
- Chiến dịch bị ẩn vẫn giữ chỗ và tiếp tục tính thời hạn. Hết chỗ từ chối toàn bộ combo trước khi động tới ví. Chưa hỗ trợ đặt lịch tương lai.

## Triển khai và hợp đồng cũ

1. Sao lưu và thử migration `0047_ad_fair_delivery.sql` trên DB riêng đã có migrations 0001–0046.
2. Triển khai migration, backend và frontend trong cùng đợt bảo trì; không dùng client cũ để mua gói mới.
3. `npm run db:migrate` dùng `DATABASE_URL`: xác nhận đúng môi trường trước khi chạy.
4. Không chạy `npm test` trên DB ứng dụng. Suite integration dùng `TEST_DATABASE_URL` và **TRUNCATE dữ liệu**.

Migration đánh dấu mọi giao dịch cũ `legacy`, giữ giá, thời hạn và cơ chế hiển thị cũ. Không có chuyển đổi ngầm.
Vị trí còn hợp đồng legacy (kể cả tạm ẩn) ngừng nhận gói mới cho tới khi các hợp đồng đó kết thúc.
Muốn chuyển hợp đồng cũ cần thỏa thuận với organizer và migration có kiểm soát riêng; không chỉ đổi trường policy, vì còn cần khởi tạo stats.

## Chống tranh chấp và chống đếm ảo

- Mua, cấp lượt và bù thời gian dùng cùng PostgreSQL advisory transaction lock `740047`. Ví, ledger và campaign được ghi trong cùng transaction. Không dựa vào khóa trong một process.
- Campaign mới/được phục hồi eligibility bắt đầu ở mức lượt hiện tại, không được chiếm hàng đợi để bù lịch sử.
- POST `/api/ads/delivery`: cấp receipt UUID ngẫu nhiên, tối đa 90 giây, không vượt ngày kết thúc chiến dịch. Cùng dấu vết truy cập và batch 30 giây nhận lại receipt cũ.
- POST `/api/ads/metrics`: receipt phải còn hạn, thuộc cùng dấu vết truy cập và sự kiện vẫn đủ điều kiện. Không lấy campaign ID do client tự khai.
- Impression cần 50% khung quảng cáo trong một giây liên tục ở tab foreground. Play chỉ gửi khi video đang phát; click chỉ ở hành động tới sự kiện.
- Dedupe mỗi loại chỉ số theo campaign/vị trí/dấu vết/bucket 30 phút, bằng upsert nguyên tử và counter trong cùng transaction. Một lượt ở hai phía ranh giới bucket có thể được tính hai lần.
- Dấu vết là HMAC của IP đã chuẩn hóa + User-Agent + ngày UTC; không lưu IP thô/cookie theo dõi. Người cùng mạng và trình duyệt có thể bị gộp. Đây **không** phải unique reach.
- Loại User-Agent bot phổ biến, rate limit riêng (60 delivery và 240 metric/phút/IP), không nới bộ chống cào danh mục. Các rate limit HTTP là process-local; production nhiều instance nên thêm giới hạn dùng chung ở ingress.
- Không thể xác thực việc nhìn màn hình bằng API đơn thuần. Bot giả trình duyệt vẫn có thể tạo số liệu; chưa có phát hiện gian lận chuyên dụng/chứng nhận đo lường.
- Receipt và dấu vết dedupe được dọn từng lô 500 sau 24 giờ trên luồng cấp lượt không cache. Khi không có traffic, dữ liệu chờ tới lần cấp tiếp theo; triển khai yêu cầu TTL cứng cần job dọn độc lập. Aggregate được giữ lại.
- Metrics là best effort, một lần gửi/receipt để tránh retry storm. Khi dịch vụ quảng cáo lỗi, nội dung biên tập vẫn dùng được và quảng cáo cũ được bỏ khi receipt hết hạn.

## Bù sự cố

Admin → Quảng cáo → Bù thời gian. Nhập mã sự cố, khoảng thời gian, bằng chứng/lý do và xác nhận đã kiểm chứng.
Backend chỉ tính phần sự cố giao với thời hạn đã mua; khoảng tương lai bị từ chối. Mỗi sự cố/campaign chỉ một bản ghi, các khoảng đã bù không được chồng nhau. Lưu admin xác nhận, lý do, thời gian và số giây bù.
Chiến dịch còn hạn được nối dài; chiến dịch hết hạn được chạy lại từ hiện tại nếu còn chỗ. Không thay đổi tiền đã trả.
Không cho gia hạn qua suất cuối hoặc chồng campaign khác. Trường hợp đó cần hỗ trợ xử lý riêng; bản này **không tự hoàn tiền**, không tự bù khi ít traffic. Không có quyền bù cho organizer.

## Kiểm chứng

- `npm run test:web -- server/src/modules/ads src/hooks/useAdFeed.test.ts src/hooks/useAdExposure.test.ts`: unit tests không kết nối DB.
- `npm run typecheck`, `npm run build`.
- Chỉ trên DB test dùng riêng: `npm test -- server/tests/ads` (đã migrate; suite xóa dữ liệu test).
- Trước phát hành: mua đồng thời hai chiến dịch tranh chỗ cuối, kiểm tra chỉ một debit; phát ít nhất hai trailer qua nhiều lượt truy cập; xem báo cáo và bù cùng sự cố hai lần; kiểm tra role admin/organizer và hai theme.
