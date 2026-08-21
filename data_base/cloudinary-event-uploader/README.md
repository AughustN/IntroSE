# Cloudinary Event Uploader

Công cụ tải tài nguyên đa phương tiện (ảnh banner sự kiện, logo ban tổ chức, poster phim và trailer video) từ dataset lên tài khoản Cloudinary và đồng bộ đường dẫn vào cơ sở dữ liệu.

---

## 1. Cấu hình biến môi trường (.env)

Tạo file `.env` từ file mẫu `.env.example`:
```bash
cp .env.example .env
```

Điền thông tin tài khoản Cloudinary và Database vào `.env`:
```env
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
```

---

## 2. Cài đặt thư viện

```bash
npm install
```

---

## 3. Hướng dẫn chạy các kịch bản Upload

### A. Upload Banner sự kiện (`upload.js`)
Tải ảnh banner sự kiện từ file CSV lên Cloudinary thư mục `tixhub/events/`:
```bash
npm start
# Hoặc truyền đường dẫn CSV tùy chỉnh:
node upload.js ../data/events/events.csv
```

### B. Upload Logo Ban tổ chức (`upload-organizers.js`)
Tải logo ban tổ chức lên Cloudinary thư mục `tixhub/organizers/`:
```bash
npm run upload:organizers
# Hoặc truyền đường dẫn CSV tùy chỉnh:
node upload-organizers.js ../data/events/organizers.csv
```

### C. Upload Phim & Video Trailer (`upload-movies.js`)
Tải đồng thời poster phim và trailer video lên Cloudinary, tạo file `events_with_cloudinary.csv` và cập nhật trực tiếp vào cơ sở dữ liệu Neon PostgreSQL:
```bash
npm run upload:movies
```
