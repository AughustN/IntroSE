# Ghi chú điều khoản quảng cáo cho TixHub

Khảo sát ngày 28/08/2026.

## Quan sát

[Spotify](https://www.spotify.com/us/brands/legal/advertiser-terms-and-conditions/) (01/07/2026): 21 mục, từ vận hành đến thanh toán, trách nhiệm, hủy. Hợp đồng gồm Master Terms, Program Terms và đơn chiến dịch (IO); ưu tiên khi xung đột: Program Terms → Master Terms → IO (§20). Chấp thuận qua sử dụng, ký đơn hoặc nút/ô xác nhận. Mặc định hủy báo trước 14 ngày; podcast/gói phí cố định: 30 ngày, trừ IO/Program Terms quy định khác; vẫn trả phần đã chạy và cam kết không hủy. Thiếu trên 10% lượng cam kết, nếu thống nhất bù, Spotify chọn chạy bù/gia hạn (§8). Không bảo đảm hiệu quả. Bản US chọn luật New York; không suy rộng sang Việt Nam.

[Google](https://support.google.com/adspolicy/answer/54818?hl=en): trang hướng dẫn theo quốc gia, kèm bản Australia 09/11/2023 gồm 14 mục; không phải hợp đồng toàn cầu. Bản Australia chấp thuận bằng ký/điện tử; dẫn chiếu chính sách và IO, không ràng buộc Google bằng IO do khách tự cung cấp. Hủy thường trước đấu giá/đặt quảng cáo, có ngoại lệ; vẫn trả phần đã chạy; sau mốc cam kết có thể mất phí đã thông báo (§5). Thiếu lượng hiển thị đặt trước: khiếu nại được xác nhận có thể không tính phí, cấp tín dụng hoặc chạy bù/gia hạn; đấu giá không được bù (§7). Không bảo đảm kết quả, bảo lưu quyền luật định (§9).

## Đề xuất cho TixHub

Tách trang giới thiệu, điều khoản dịch vụ và đơn chiến dịch. Trang giới thiệu nêu vị trí, thời lượng, giá, cách đo; phân biệt lượng phân phối cam kết với dự báo bán vé. Trước thanh toán, cho xem đơn và xác nhận phiên bản điều khoản. Công khai điều kiện duyệt, hủy, chi phí phát sinh, xử lý thiếu phân phối và đầu mối khiếu nại.

Không sao chép điều khoản nước ngoài thành pháp luật Việt Nam; cần rà soát pháp lý phù hợp trước áp dụng.

## Tham khảo cách trình bày

- [Spotify Advertising](https://ads.spotify.com/en-US/): mở đầu bằng lợi ích và hình minh họa quảng cáo; tách các định dạng, đo lường, tài liệu và điều khoản. Đã xem trực tiếp giao diện desktop.
- [Reddit for Business](https://www.business.reddit.com/advertise): tiêu đề lớn, minh họa rõ, hành động chính/phụ phân cấp; có câu hỏi thường gặp và minh chứng kèm nguồn. Đã xem trực tiếp giao diện desktop.
- [Eventbrite Ads](https://www.eventbrite.com/organizer/features/eventbrite-ads/): nội dung hướng tới nhà tổ chức, giải thích quảng bá sự kiện và quy trình thiết lập chiến dịch. [Điều khoản quảng cáo](https://www.eventbrite.com/help/en-gb/articles/526880/eventbrite-ads-terms-and-conditions/) tách riêng dịch vụ, thanh toán, nội dung, chấm dứt và trách nhiệm. Chỉ đối chiếu nội dung được lập chỉ mục trên nguồn chính thức; truy cập trực tiếp bị giới hạn, chưa kiểm chứng bố cục bằng ảnh.
- [TikTok Advertising Policies](https://ads.tiktok.com/resources/help/article/tiktok-advertising-policies?lang=en): phân nhóm yêu cầu nội dung, định dạng, sở hữu trí tuệ, dữ liệu và quy định theo thị trường. Có thể học cách tổ chức quy định, không sao chép nguyên chính sách.

Các nền tảng có mô hình bán quảng cáo khác nhau. Chỉ tham khảo bố cục và cách giải thích; không chuyển cơ chế đấu giá hay chính sách bồi hoàn của họ thành cam kết TixHub.

## Đối chiếu trang trước khi chỉnh sửa

Nguồn nội bộ: `src/components/organizer/AdPackagesPanel.tsx`, `shared/ads/types.ts`, `server/src/modules/ads/ads.repo.ts`, `server/src/modules/ads/ads.routes.ts`, `server/src/db/migrations/0047_ad_fair_delivery.sql`.

- Đoạn điều khoản dài nằm trước các gói, chưa có minh họa vị trí hiển thị.
- Thẻ gói nhấn mạnh giá nhưng thông tin thời lượng nhỏ; quyền lợi nằm sau nút chọn, khó so sánh nhanh.
- Phần mua và danh sách chiến dịch cùng một trang dài, phục vụ hai nhu cầu khác nhau.
- Có xác nhận điều khoản nhưng chưa có bản xem lại đơn đầy đủ, dễ lưu/tải về.

## Phương án thiết kế

### 1. Mở đầu bằng lợi ích và vị trí thực tế

Tiêu đề: **Đưa sự kiện của bạn lên vị trí nổi bật**.

Mô tả: “Chọn vị trí và thời gian quảng bá phù hợp. Theo dõi lượt hiển thị và lượt nhấp trong trang quản lý chiến dịch.”

Hai hành động: **Xem các gói** và **Xem vị trí hiển thị**. Bên cạnh là bản minh họa trang chủ TixHub, đánh dấu trailer và danh sách sự kiện hot. Minh họa phải ghi rõ là ví dụ, không phải cam kết vị trí độc quyền.

### 2. Giải thích hai vị trí trước khi bán gói

Hai khối xem trước: **Trailer trang chủ** và **Sự kiện hot**. Mỗi khối mô tả vị trí, loại nội dung cần có và cách luân phiên; nêu điều kiện video với trailer. Không đưa số liệu tiếp cận, lời chứng thực hay bảo đảm bán vé chưa có căn cứ.

### 3. Thẻ gói dễ đối chiếu

Giữ tên và quyền lợi từ dữ liệu hiện hành. Mỗi thẻ theo thứ tự: tên → mô tả ngắn → giá/thời lượng → quyền lợi → tình trạng nhận chiến dịch → nút chọn.

Trong chiều rộng trang organizer, ưu tiên lưới 2×2; màn hình nhỏ một cột. Căn cùng hàng giá và nút, không ép tiêu đề dài vào chiều cao cố định gây cắt chữ. Bảng so sánh ngắn bên dưới gồm vị trí, thời lượng, báo cáo và giá. Không gắn nhãn “bán chạy” hoặc “phổ biến” nếu chưa có dữ liệu.

### 4. Quy trình mua ba bước

**Chọn gói và sự kiện → Xem lại, đồng ý và thanh toán → Theo dõi chiến dịch.**

Trước thanh toán hiển thị tổng tiền, sự kiện, vị trí, thời lượng và thời điểm bắt đầu dự kiến; xác nhận sau thanh toán ghi thời gian thực tế. Đưa điều kiện quan trọng ngay gần nút mua, không chỉ giấu trong FAQ: chạy ngay sau thanh toán, không độc quyền, không bảo đảm doanh số, và thời gian vẫn tính khi sự kiện bị ẩn theo cơ chế hiện tại.

### 5. Quy định và bản xác nhận đặt quảng cáo

Tách thành ba lớp:

1. **Tóm tắt dễ đọc:** phạm vi quyền lợi, điều kiện chạy, thanh toán, luân phiên, gián đoạn.
2. **Điều khoản đầy đủ:** mục lục, phiên bản/ngày hiệu lực, phạm vi dịch vụ, nội dung được phép, quyền sử dụng nội dung, thời hạn, hủy/hoàn/bù, đo lường, dữ liệu và đầu mối hỗ trợ.
3. **Bản xác nhận từng đơn:** nhà tổ chức, sự kiện, tên gói tại lúc mua, giá, vị trí, thời gian và múi giờ, phiên bản điều khoản đã chấp thuận, mã giao dịch; có thể xem lại/tải về.

Hiện đã lưu phiên bản `fair_v1` cùng một số dữ liệu giao dịch, nhưng chưa có toàn văn điều khoản bất biến/hash và bản xác nhận riêng đầy đủ. Bổ sung phần này cần thay đổi backend, không chỉ sửa giao diện. Không tự gọi một checkbox là hợp đồng điện tử hoàn chỉnh.

Các mục cần chủ hệ thống quyết định và rà soát pháp lý trước khi công bố: thông tin pháp nhân, thuế/hóa đơn, quyền hủy, hoàn tiền, giới hạn trách nhiệm và giải quyết tranh chấp. Không hứa tự động hoàn tiền; cơ chế hiện tại chỉ hỗ trợ bù thời gian có điều kiện cho gián đoạn nền tảng đã được xác nhận.

### 6. Tách nhu cầu mua và quản lý

Hai tab **Khám phá gói** / **Chiến dịch của bạn**, giữ đường dẫn trực tiếp tới chiến dịch. FAQ cuối phần giới thiệu giải thích mua cùng gói, cách chia lượt, điều kiện sự kiện/video và báo cáo.

### Nguyên tắc giao diện

- Giữ phong cách TixHub: viền chữ nhật, góc vuông, màu theo token sáng/tối; không sao chép nút pill của trang tham khảo.
- Tăng khoảng trắng, giảm hộp lồng nhau; font tiêu đề có cá tính, nội dung và điều khiển dùng cùng font UI dễ đọc.
- Quyền lợi và điều kiện mua không dùng chữ quá nhỏ. Không dùng màu làm dấu hiệu duy nhất cho trạng thái.
- Có nhãn trường, focus bàn phím rõ, FAQ điều khiển bằng nút thực, thông báo lỗi gần trường, và khả năng đọc bảng so sánh trên mobile.

## Cập nhật triển khai 28/08/2026

Đã triển khai phần giới thiệu có minh họa, hai vị trí quảng cáo, thẻ gói 2×2/một cột, bảng so sánh, quy trình ba bước, FAQ, điều khoản có phiên bản và tab chiến dịch riêng. Bước mua có tóm tắt quyền lợi/số tiền, xác nhận điều khoản, lỗi tại chỗ và kiểm tra lại dữ liệu đã tải mới. Sau thanh toán chuyển sang chiến dịch; giữ kết quả mua nếu tải lại danh sách thất bại. Chi tiết giao dịch có thể tải xuống dạng văn bản.

Giữ nguyên giá, quyền lợi và cơ chế thanh toán/phân phối phía máy chủ. Bản tải là thông tin giao dịch hiện tại, **không phải** toàn văn điều khoản bất biến, hóa đơn hoặc hợp đồng có chữ ký. Phần lưu hợp đồng bất biến, pháp nhân, thuế và chính sách pháp lý mới chưa triển khai; cần quyết định nghiệp vụ và rà soát pháp lý như đã nêu ở trên. Có thể mở thẳng tab chiến dịch qua `/organizer/events?section=ads&adTab=campaigns`.
