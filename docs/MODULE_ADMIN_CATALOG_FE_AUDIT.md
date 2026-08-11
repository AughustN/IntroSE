# Admin va Catalog: backend va lien ket frontend

Ngay ra soat: 2026-08-10  
Pham vi: `server/src/modules/admin`, `server/src/modules/catalog` va cac diem goi tu `src/`.

## Tong quan mount route

| Module | Base path | Bao ve | Muc dich |
| --- | --- | --- | --- |
| Catalog public | `/api` | Public | Duyet, xem chi tiet su kien, suat dien va so do ghe de mua ve. |
| Catalog organizer | `/api/organizer` | `requireAuth` + `requireOrganizer` | Quan ly su kien, dia diem, suat dien va tao so do ghe cua ban to chuc. |
| Admin | `/api/admin` | `requireAuth` + `requireAdmin` | Kiem duyet, quan ly danh muc/su kien noi bat va cau hinh he thong. |

Router duoc mount trong [server/src/app.ts](../server/src/app.ts). Frontend dung contract chung o `shared/catalog/types.ts` va `shared/admin/types.ts`; cac client tu dong gui access token va thu refresh mot lan khi bi `401`.

## Module `admin`

### File va trach nhiem

| File | Chuc nang |
| --- | --- |
| `admin.routes.ts` | Khai bao API admin, validate payload bang Zod, ap dung RBAC toan router. |
| `admin.service.ts` | Dieu phoi cac thao tac trong transaction: khoa ban ghi, chuyen trang thai, tao notification noi bo va audit log. |
| `admin.repo.ts` | SQL cho hang doi kiem duyet, danh muc, featured events, report va cac cap nhat moderation. |
| `audit.ts` | Ghi audit log bat bien va doc toi da 200 ban ghi moi nhat. |
| `settings.service.ts` | Doc/ghi `system_settings`, validate rang buoc cheo va cache 15 giay. |

### API va frontend lien quan

| API | Backend lam gi | Frontend dang dung |
| --- | --- | --- |
| `GET /api/admin/moderation` | Tra danh sach su kien can kiem duyet; endpoint tuong thich cu. | `adminApi.queue()` trong `src/services/catalogClient.ts`, duoc `AdminModeration.tsx` dung. |
| `GET /api/admin/moderation/queue` | Tra gom `organizers`, `events`, `reports`. | `adminClient.queue()` trong `src/services/adminClient.ts`, duoc `AdminPanel.tsx` tai khi mo trang admin. |
| `GET /api/admin/organizers` | Tra danh sach organizer trong queue. | Khong co client goi rieng; `AdminPanel` dung du lieu tu `/moderation/queue`. |
| `POST /api/admin/organizers/:id/approve` | Duyet organizer dang `pending`; ghi notification va audit. | `AdminPanel.tsx` qua `adminClient.approveOrganizer()`. |
| `POST /api/admin/organizers/:id/reject` | Tu choi organizer dang `pending`; bat buoc `reason`; ghi notification va audit. | `AdminPanel.tsx` qua `adminClient.rejectOrganizer()`. |
| `POST /api/admin/organizers/:id/suspend` | Dinh chi organizer dang `approved`; bat buoc `reason`; su kien cua ho an ngay lap tuc khoi catalog public. | `AdminPanel.tsx` qua `adminClient.suspendOrganizer()`. |
| `POST /api/admin/events/:id/approve` | Duyet event dang `pending_review`; ghi notification va audit. | `AdminPanel.tsx` qua `adminClient.approveEvent()`; `AdminModeration.tsx` co client cu `adminApi.approve()`. |
| `POST /api/admin/events/:id/reject` | Tu choi event; bat buoc `reason`; event chuyen `removed`. | `adminClient.rejectEvent()` ton tai, nhung UI hien tai cua `AdminPanel` chi co nut go, chua co nut tu choi rieng. `AdminModeration.tsx` co dung client cu. |
| `POST /api/admin/events/:id/flag` | Danh dau event dang `approved`; `reason` tuy chon. | Co trong `adminClient` va `adminApi`, chua thay thao tac flag trong `AdminPanel` hien tai. |
| `POST /api/admin/events/:id/remove` | Go event; `reason` tuy chon; ghi notification va audit. | `AdminPanel.tsx` qua `adminClient.removeEvent()`; `AdminModeration.tsx` qua `adminApi.remove()`. |
| `POST /api/admin/reports/:id/dismiss` | Dong report ma khong xu ly doi tuong bi report; ghi audit. | Co `adminClient.dismissReport()`, nhung chua thay nut/UI xu ly report trong `AdminPanel`. |
| `POST /api/admin/reports/:id/resolve` | Xu ly report: `flag` hoac `remove`; voi target event thi chuyen moderation trong cung transaction. | **Chua co method/client va UI frontend tuong ung.** |
| `GET /api/admin/audit-logs` | Tra 200 audit logs moi nhat. | `AdminPanel.tsx` qua `adminClient.auditLogs()`. |
| `GET /api/admin/categories` | Liet ke danh muc event. | `AdminPanel.tsx` qua `adminClient.categories()`. |
| `POST /api/admin/categories` | Tao danh muc; tao code tu nhan; conflict neu trung. | `AdminPanel.tsx` qua `adminClient.createCategory()`. |
| `PUT /api/admin/categories/:id` | Doi ten danh muc; ghi audit. | `AdminPanel.tsx` qua `adminClient.renameCategory()`. |
| `DELETE /api/admin/categories/:id` | Xoa danh muc chi khi khong con event su dung; neu co se `409 category_in_use`. | `AdminPanel.tsx` qua `adminClient.deleteCategory()`. |
| `GET /api/admin/homepage/featured` | Liet ke su kien noi bat theo thu tu hien thi. | `AdminPanel.tsx` qua `adminClient.featured()`. |
| `PUT /api/admin/homepage/featured` | Thay toan bo danh sach featured trong transaction, validate event va thu tu. | `AdminPanel.tsx` qua `adminClient.replaceFeatured()`. |
| `GET /api/admin/settings` | Tra cau hinh hieu luc; neu DB rong/loi thi dung default. | `AdminPanel.tsx` qua `adminClient.settings()`. |
| `PUT /api/admin/settings` | Cap nhat atomically: hold TTL, gioi han top-up/so du, max tickets, co AI; kiem tra rang buoc cheo. | `AdminPanel.tsx` qua `adminClient.updateSettings()`. |

### Hanh vi quan trong

- Tat ca mutation admin dung transaction va ghi `audit_logs` khi thanh cong.
- Transition moderator co khoa dong (`lockEvent`, `lockOrganizer`) nen tranh dua tranh khi hai admin thao tac cung luc.
- Duyet, tu choi, dinh chi organizer va event deu tao notification trong app cho organizer.
- `settings.service.ts` cache 15 giay; `updateSettings()` cap nhat lai cache ngay sau khi commit.
- Mot so tab trong `AdminPanel` hien chi dung mock/local state: `Don hang`, `Voucher`, `Check-in`, mot phan `Bao cao`, `Phan quyen`. Khong phai API cua module `admin` tuong ung.

## Module `catalog`

### File va trach nhiem

| File | Chuc nang |
| --- | --- |
| `catalog.public.routes.ts` | API public de liet ke/xem event, showtime va seat map. |
| `catalog.repo.ts` | SQL projection cho public catalog, loc, phan trang, tier, showtime va seat map. |
| `organizer.routes.ts` | API quan ly catalog cua organizer; kiem tra dang nhap, organizer da duyet va quyen so huu. |
| `catalog.write.ts` | SQL ghi event, venue, showtime, section, seat va tao seat map. |
| `visibility.ts` | Predicate dung chung: chi event `on_sale`, admin `approved`, organizer `approved` moi public. |
| `slug.ts` | Tao slug khong dau, unique khi tao event; khong doi slug khi doi tieu de. |

### API public va frontend lien quan

| API | Backend lam gi | Frontend dang dung |
| --- | --- | --- |
| `GET /api/events/featured` | Tra featured events, dong thoi ap dung public-visibility; event bi an se tu bien mat. | Khong thay `catalogClient` hien tai expose/goi endpoint nay. Trang chu co the dang dung danh sach event thong thuong. |
| `GET /api/events` | Tim kiem/loc theo `q`, `category`, `city`, `date`, gia, availability; 20 event/trang; event het ve xuong cuoi. | `catalogClient.listEvents()`; duoc `App.tsx` dung cho trang chu va `/events`. |
| `GET /api/events/:slug` | Tra chi tiet event public, tiers tom tat, related events, SEO; draft/pending/removed tra 404 de khong ro ri du lieu. | `catalogClient.getEvent()`; duoc `App.tsx` va `EventDetail.tsx` dung cho `/events/:slug`. |
| `GET /api/events/:id/showtimes` | Tra showtime sap toi cua event public, bo qua cancelled/finished; kem trang thai con ve. | `catalogClient.getShowtimes()`; duoc `App.tsx`, `EventDetail.tsx`, `SeatMapView.tsx`. |
| `GET /api/showtimes/:id/seat-map` | Tra ghe theo trang thai cho event seated, hoac tiers/con lai cho general admission; chi doc. | `catalogClient.getSeatMap()`; duoc `SeatLayout.tsx` va `SeatMapView.tsx` de hien thi buoc chon ghe. |

### API organizer va frontend lien quan

| API | Backend lam gi | Frontend dang dung |
| --- | --- | --- |
| `GET /api/organizer/events` | Liet ke event cua organizer dang dang nhap. | `organizerApi.myEvents()` trong `OrganizerPanel.tsx`. |
| `POST /api/organizer/events` | Tao event draft, tao slug va kiem tra category. | `organizerApi.createEvent()` trong `OrganizerPanel.tsx`. |
| `PATCH /api/organizer/events/:id` | Sua noi dung event cua chu so huu; sau do queue notification event cap nhat. | **Chua co method trong `organizerApi` va chua thay UI goi endpoint nay.** |
| `POST /api/organizer/events/:id/publish` | Gui event di kiem duyet; bat buoc co it nhat mot showtime tuong lai co tier. | `organizerApi.publish()` trong `OrganizerPanel.tsx`. |
| `POST /api/organizer/events/:id/unpublish` | Dua event ve khong public. | `organizerApi.unpublish()` trong `OrganizerPanel.tsx`. |
| `POST /api/organizer/events/:id/announcements` | Tao announcement va queue email/in-app cho nguoi mua ve; tra `202` va so nguoi nhan. | **Chua co frontend client/UI.** |
| `POST /api/organizer/events/:id/cancel` | Huy event qua ticket service, xu ly ve/hoan theo service. | **Chua co frontend client/UI.** |
| `POST /api/organizer/events/:id/showtimes` | Them showtime va 1-4 ticket tiers; venue phai thuoc organizer. | `organizerApi.addShowtime()` trong `OrganizerPanel.tsx`. |
| `GET /api/organizer/events/:id/showtimes-manage` | Tra showtime, tiers, venue va thong tin co seat map de quan ly. | `organizerApi.showtimesManage()` trong `SeatMapBuilder.tsx`. |
| `GET /api/organizer/venues` | Liet ke venue cua organizer. | `organizerApi.myVenues()` trong `OrganizerPanel.tsx`. |
| `POST /api/organizer/venues` | Tao venue thuoc organizer. | `organizerApi.createVenue()` trong `OrganizerPanel.tsx`. |
| `GET /api/organizer/venues/:id/sections` | Liet ke section va so ghe theo venue. | `organizerApi.venueSections()` trong `SeatMapBuilder.tsx`. |
| `POST /api/organizer/venues/:id/sections` | Tao section trong default layout cua venue. | `organizerApi.createSection()` trong `SeatMapBuilder.tsx`. |
| `POST /api/organizer/venues/:id/seats` | Them ghe hang loat theo dong/so luong vao section. | `organizerApi.addSeats()` trong `SeatMapBuilder.tsx`. |
| `DELETE /api/organizer/seats/:id` | Xoa ghe vat ly neu chua co trong live map. | **Chua co method/UI tuong ung.** Editor moi xoa ghe trong layout bang API seatmap khac. |
| `POST /api/organizer/showtimes/:id/seat-map` | Gan ticket tier theo section va sinh showtime seats; chi cho event seated va map chua ton tai. | `organizerApi.generateSeatMap()` trong `SeatMapBuilder.tsx`. |

### Luu y ve Seatmap Designer

`src/services/catalogClient.ts` con co `layoutApi` va cac component `SeatMapBuilder.tsx`, `seatmap/LayoutEditor.tsx`, `FloorPlanPanel.tsx`, `ShowtimeMapPanel.tsx`. Cac API nay bat dau bang `/api/organizer/...` nhung **khong nam trong `modules/catalog`**; chung duoc xu ly boi `server/src/modules/seatmap/seatmap.routes.ts`.

Chuc nang FE do bao gom CRUD layout, sinh/xoa ghe theo layout, validate/publish/clone layout, upload/align floor plan, preview/reapply showtime map, block ghe va doi ticket tier. Duoc neu o day de tranh nham rang cac endpoint organizer nay do `catalog/organizer.routes.ts` xu ly.

## Ma tran frontend

| Man hinh/component | Client | Chuc nang backend lien quan |
| --- | --- | --- |
| `App.tsx` | `catalogClient` | Tai danh sach su kien, chi tiet va showtime khi dieu huong trang home/browse/detail. |
| `EventDetail.tsx` | `catalogClient` | Xem chi tiet su kien va chon showtime. |
| `SeatLayout.tsx`, `SeatMapView.tsx` | `catalogClient` | Doc seat map de hien thi/chon ghe; giu cho/checkout nam o module khac. |
| `OrganizerPanel.tsx` | `organizerApi` | Quan ly event, venue, showtime va publish/unpublish. |
| `SeatMapBuilder.tsx` | `organizerApi`, `layoutApi` | Tao section/ghe va sinh map; quan ly layout chi tiet qua module `seatmap`. |
| `AdminPanel.tsx` | `adminClient` | Kiem duyet, audit, danh muc, featured va settings. |
| `AdminModeration.tsx` | `adminApi` cu trong `catalogClient` | Kiem duyet event co ban. Co nguy co trung lap voi `AdminPanel`; nen uu tien `adminClient` cho chuc nang admin moi. |

## Cac khoang trong FE nen biet

1. `GET /api/events/featured` da co backend, nhung chua duoc expose boi `catalogClient` va chua thay caller frontend.
2. Admin report resolution `POST /api/admin/reports/:id/resolve` chua co client/UI; `dismiss` co client nhung chua thay UI action.
3. API organizer sua event, gui announcement, huy event va xoa physical seat chua co client/UI tuong ung.
4. `AdminPanel` van hien thi mot so bang/chi so mock. Khong nen hieu cac phan do la du lieu tu module `admin`.
5. Co hai client admin: `src/services/adminClient.ts` la client day du; `adminApi` trong `catalogClient.ts` la client cu chi cho moderation. Neu mo rong, nen dung `adminClient` de tranh trung lap.

## File can xem khi can sua

- Router/middleware: `server/src/app.ts`, `server/src/modules/admin/admin.routes.ts`, `server/src/modules/catalog/catalog.public.routes.ts`, `server/src/modules/catalog/organizer.routes.ts`.
- Logic/SQL: `server/src/modules/admin/admin.service.ts`, `server/src/modules/admin/settings.service.ts`, `server/src/modules/admin/admin.repo.ts`, `server/src/modules/catalog/catalog.repo.ts`, `server/src/modules/catalog/catalog.write.ts`, `server/src/modules/catalog/visibility.ts`.
- Frontend: `src/services/adminClient.ts`, `src/services/catalogClient.ts`, `src/components/AdminPanel.tsx`, `src/components/OrganizerPanel.tsx`, `src/components/EventDetail.tsx`, `src/components/SeatMapBuilder.tsx`.
