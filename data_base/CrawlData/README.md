# CrawlData - Dữ liệu & Trình cào dữ liệu cho TixHub

Thư mục này chứa toàn bộ mã nguồn các công cụ cào (scraper/crawler), pipeline tải tài nguyên đa phương tiện (poster ảnh, trailer video) và các tập dữ liệu sự kiện / phim phục vụ cho đồ án **TixHub**.

---

## 1. Cài đặt môi trường

Cài đặt các thư viện Python cần thiết:
```bash
pip install -r requirements.txt
```

---

## 2. Danh sách các trình cào dữ liệu (Scrapers)

### 🎬 A. Dữ liệu Phim (Movies & Cinemas)
- **`imdb_scraper.py`**: Pipeline tự động cào 250 bộ phim (phim hot, phim mới, top rated) từ IMDb, tự động tải poster chất lượng cao và trailer video MP4, ghi nhận trạng thái vào SQLite và xuất dữ liệu chuẩn schema TixHub.
- **`cgv_scraper.py`**: Cào danh sách phim đang chiếu / sắp chiếu từ hệ thống rạp CGV Vietnam.
- **`moveek_scraper.py`**: Cào dữ liệu phim điện ảnh và thông tin chi tiết từ nền tảng Moveek.

### 🎟️ B. Dữ liệu Sự kiện & Ban tổ chức (Events & Organizers)
- **Ticketbox**:
  - `ticketbox_scraper.py`: Cào danh sách sự kiện từ Ticketbox.
  - `ticketbox_organizer_scraper.py`: Cào thông tin ban tổ chức từ Ticketbox.
- **C-Ticket**:
  - `cticket_scraper.py`: Cào danh sách sự kiện từ C-Ticket.
  - `cticket_organizer_scraper.py`: Cào thông tin ban tổ chức từ C-Ticket.
- **Eventbrite**:
  - `eventbrite_scraper.py`: Cào danh sách sự kiện từ Eventbrite.
  - `eventbrite_organizer_scraper.py`: Cào thông tin ban tổ chức từ Eventbrite.

---

## 3. Tổng hợp dữ liệu (Consolidation)

- **`merge_events.py`**: Tổng hợp dữ liệu sự kiện và banner từ 3 nguồn (`data_cticket`, `data_eventbrite`, `data_ticketbox`) thành một tập dataset chuẩn thống nhất.

---

## 4. Cấu trúc thư mục dữ liệu

- `data_cticket/`: Dữ liệu sự kiện, ban tổ chức và ảnh thô cào từ C-Ticket.
- `data_eventbrite/`: Dữ liệu sự kiện, ban tổ chức và ảnh thô cào từ Eventbrite.
- `data_ticketbox/`: Dữ liệu sự kiện, ban tổ chức và ảnh thô cào từ Ticketbox.
