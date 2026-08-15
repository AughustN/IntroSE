import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  getOrganizerEventDetail,
  requestPublication,
  updateEventDetails,
  deleteOrArchiveTier,
  saveTicketTier,
  cancelEvent,
  completeEvent
} from "../../services/organizerClient";
import { organizerApi, ScanTicket } from "../../services/catalogClient";
import { OrganizerEvent, TicketTier } from "../../types";
import { EventMetricsSummary } from "../../components/organizer/EventMetricsSummary";
import { TicketTierBreakdown } from "../../components/organizer/TicketTierBreakdown";
import { EditEventForm } from "../../components/organizer/EditEventForm";
import { CancelEventModal } from "../../components/organizer/CancelEventModal";
import QrCameraScan from "../../components/QrCameraScan";

export const SingleEventPage: React.FC = () => {
  const params = useParams<{ id?: string; organizerEventId?: string }>();
  const navigate = useNavigate();

  const pathParts = window.location.pathname.split("/").filter(Boolean);
  const eventId = params.id || params.organizerEventId || (pathParts.length >= 2 ? pathParts[1] : undefined);

  const [eventData, setEventData] = useState<OrganizerEvent | null>(null);
  const [metrics, setMetrics] = useState({
    totalCapacity: 0,
    soldTickets: 0,
    remainingTickets: 0,
    totalRevenueVnd: 0
  });
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [toastMsg, setToastMsg] = useState<{ type: "success" | "error" | "warning"; text: string } | null>(null);

  const [showEditModal, setShowEditModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completeBusy, setCompleteBusy] = useState(false);
  const [editingTier, setEditingTier] = useState<TicketTier | null>(null);
  const [showTierModal, setShowTierModal] = useState(false);

  const [tierLabel, setTierLabel] = useState("");
  const [tierPrice, setTierPrice] = useState(100000);
  const [tierCapacity, setTierCapacity] = useState(100);
  const [tierDesc, setTierDesc] = useState("");

  // QR Scan / Check-in Modal State (reusing QrCameraScan & catalogClient)
  const [showScanModal, setShowScanModal] = useState(false);
  const [scanCode, setScanCode] = useState("");
  const [scanResult, setScanResult] = useState<ScanTicket | null>(null);
  const [scanAlready, setScanAlready] = useState(false);
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);

  const doCheckIn = async (codeToScan: string) => {
    const code = codeToScan.trim();
    if (!code) return;
    setScanBusy(true);
    setScanErr(null);
    setScanAlready(false);
    try {
      const { ticket, already } = await organizerApi.checkIn(code);
      setScanResult(ticket);
      setScanAlready(already);
      if (already) {
        showToast("warning", `Vé ${ticket.code} đã được check-in trước đó!`);
      } else {
        showToast("success", `Check-in thành công cho khán giả ${ticket.customerName}!`);
        loadEvent(); // refresh attendance metrics
      }
    } catch (e: any) {
      setScanResult(null);
      setScanErr(e.message || "Không thể thực hiện check-in cho vé này.");
    } finally {
      setScanBusy(false);
    }
  };

  const loadEvent = async () => {
    if (!eventId) return;
    setLoading(true);
    setErrorMsg("");
    try {
      const res = await getOrganizerEventDetail(eventId);
      setEventData(res.data);
      setMetrics(res.data.metrics);
    } catch (err: any) {
      setErrorMsg(err.message || "Không thể tải thông tin sự kiện.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    window.scrollTo(0, 0);
    loadEvent();
  }, [eventId]);

  const showToast = (type: "success" | "error" | "warning", text: string) => {
    setToastMsg({ type, text });
    setTimeout(() => setToastMsg(null), 5000);
  };

  const handleRequestPublish = async () => {
    if (!eventId) return;
    try {
      const updated = await requestPublication(eventId);
      setEventData({ ...updated, computedStatus: updated.status });
      showToast("success", "Yêu cầu xuất bản đã được gửi tới Quản trị viên để kiểm duyệt.");
      loadEvent();
    } catch (err: any) {
      showToast("error", err.message || "Gửi yêu cầu xuất bản thất bại.");
    }
  };

  const handleSaveEdit = async (updates: Partial<OrganizerEvent>) => {
    if (!eventId) return;
    try {
      const res = await updateEventDetails(eventId, updates);
      setShowEditModal(false);
      if (res.statusRevertedToPending) {
        showToast(
          "warning",
          "Đã cập nhật thông tin! Sự kiện đã chuyển về trạng thái 'Chờ Duyệt' (UC-24 A6)."
        );
      } else {
        showToast("success", "Cập nhật thông tin sự kiện thành công!");
      }
      loadEvent();
    } catch (err: any) {
      showToast("error", err.message || "Cập nhật sự kiện thất bại.");
    }
  };

  const handleDeleteOrArchiveTier = async (tierId: string) => {
    if (!eventId) return;
    try {
      const res = await deleteOrArchiveTier(eventId, tierId);
      if (res.actionTaken === "archived") {
        showToast("warning", "Hạng vé đã bán vé nên đã chuyển sang Lưu trữ.");
      } else {
        showToast("success", "Đã xóa hạng vé thành công.");
      }
      loadEvent();
    } catch (err: any) {
      showToast("error", err.message || "Thao tác hạng vé thất bại.");
    }
  };

  const handleOpenAddTier = () => {
    setEditingTier(null);
    setTierLabel("");
    setTierPrice(100000);
    setTierCapacity(100);
    setTierDesc("");
    setShowTierModal(true);
  };

  const handleOpenEditTier = (tier: TicketTier) => {
    setEditingTier(tier);
    setTierLabel(tier.label);
    setTierPrice(tier.price);
    setTierCapacity(tier.capacity || 100);
    setTierDesc(tier.description || "");
    setShowTierModal(true);
  };

  const isFreeTierModal = tierLabel.trim().toLowerCase() === "miễn phí" || tierLabel.trim().toLowerCase() === "free";

  const handleSaveTierForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId) return;

    try {
      await saveTicketTier(eventId, {
        id: editingTier?.id,
        label: tierLabel,
        price: isFreeTierModal ? 0 : Number(tierPrice),
        capacity: Number(tierCapacity),
        description: tierDesc
      });
      setShowTierModal(false);
      showToast("success", editingTier ? "Cập nhật hạng vé thành công!" : "Thêm hạng vé mới thành công!");
      loadEvent();
    } catch (err: any) {
      showToast("error", err.message || "Lưu hạng vé thất bại.");
    }
  };

  const handleConfirmCancelEvent = async (reason: string) => {
    if (!eventId) return;
    try {
      const res = await cancelEvent(eventId, reason);
      setShowCancelModal(false);
      showToast(
        "success",
        `Sự kiện đã bị hủy. Đã phát lệnh hoàn tiền cho ${res.auditRecord.ticketsAffectedCount} vé.`
      );
      loadEvent();
    } catch (err: any) {
      showToast("error", err.message || "Hủy sự kiện thất bại.");
    }
  };

  const handleConfirmCompleteEvent = async () => {
    if (!eventId) return;
    setCompleteBusy(true);
    try {
      await completeEvent(eventId);
      setShowCompleteModal(false);
      showToast('success', 'Sự kiện đã được đánh dấu Hoàn Tất. Bán vé và chỉnh sửa đã bị khóa.');
      loadEvent();
    } catch (err: any) {
      showToast('error', err.message || 'Hoàn tất sự kiện thất bại.');
    } finally {
      setCompleteBusy(false);
    }
  };

  const getStatusBanner = (status: string, cancellationReason?: string | null) => {
    switch (status) {
      case "published":
        return (
          <div className="bg-la-co/20 border border-la-co/50 rounded-xl p-4 text-xs text-on-tint flex items-center justify-between">
            <div>
              <p className="font-bold">● Sự kiện đang được đăng bán công khai</p>
              <p className="opacity-90">Người mua có thể tìm kiếm và đặt vé trên TixHub.</p>
            </div>
            <span className="px-3 py-1 border border-la-co bg-la-co/25 text-beige-kem rounded-full font-bold text-[10px]">ĐÃ DUYỆT</span>
          </div>
        );
      case "pending_review":
        return (
          <div className="bg-cam-dat/20 border border-cam-dat/50 rounded-xl p-4 text-xs text-on-tint flex items-center justify-between">
            <div>
              <p className="font-bold">▲ Sự kiện đang chờ Ban Quản Trị phê duyệt</p>
              <p className="opacity-90">Sự kiện tạm ẩn khỏi danh mục cho đến khi được duyệt.</p>
            </div>
            <span className="px-3 py-1 bg-cam-dat text-on-tint rounded-full font-bold text-[10px]">CHỜ DUYỆT</span>
          </div>
        );
      case "draft":
        return (
          <div className="bg-surface-2 border border-beige-kem/30 rounded-xl p-4 text-xs text-beige-kem flex items-center justify-between">
            <div>
              <p className="font-bold">○ Sự kiện ở trạng thái Bản Nháp</p>
              <p className="text-ink-soft">Hoàn thiện thông tin và bấm Gửi Yêu Cầu Duyệt.</p>
            </div>
            <span className="px-3 py-1 bg-beige-kem/20 text-beige-kem rounded-full font-bold text-[10px]">BẢN NHÁP</span>
          </div>
        );
      case "canceled":
        return (
          <div className="bg-burgundy/20 border border-burgundy/50 rounded-xl p-4 text-xs text-burgundy-ink space-y-1">
            <div className="flex items-center justify-between">
              <p className="font-bold">✕ Sự kiện đã bị hủy</p>
              <span className="px-3 py-1 bg-burgundy text-white rounded-full font-bold text-[10px]">ĐÃ HỦY</span>
            </div>
            {cancellationReason && (
              <p className="opacity-90 font-meta text-[11px]">
                <strong>Lý do hủy:</strong> {cancellationReason}
              </p>
            )}
          </div>
        );
      case "completed":
        return (
          <div className="bg-surface-2 border border-beige-kem/30 rounded-xl p-4 text-xs text-beige-kem flex items-center justify-between">
            <div>
              <p className="font-bold">✓ Sự kiện đã kết thúc thành công</p>
              <p className="text-ink-soft">Đã qua thời gian kết thúc sự kiện.</p>
            </div>
            <span className="px-3 py-1 bg-beige-kem/20 text-beige-kem rounded-full font-bold text-[10px]">ĐÃ KẾT THÚC</span>
          </div>
        );
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-xanh-pho text-beige-kem p-8 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-burgundy"></div>
      </div>
    );
  }

  if (errorMsg || !eventData) {
    return (
      <div className="min-h-screen bg-xanh-pho text-beige-kem p-8 max-w-xl mx-auto flex flex-col items-center justify-center space-y-4">
        <div className="text-4xl">⚠️</div>
        <h2 className="font-display text-xl font-bold">Không thể tải không gian quản lý sự kiện</h2>
        <p className="text-xs text-ink-soft text-center">{errorMsg || "Sự kiện không tồn tại hoặc bạn không có quyền truy cập."}</p>
        <button
          onClick={() => navigate("/organizer")}
          className="px-4 py-2 bg-burgundy text-white rounded-xl text-xs font-semibold hover:brightness-110 transition-colors"
        >
          ← Quay Lại Danh Mục Sự Kiện
        </button>
      </div>
    );
  }

  const isCanceledOrCompleted = eventData.computedStatus === "canceled" || eventData.computedStatus === "completed";
  const statusStr = String(eventData.computedStatus || eventData.status || "");
  const isPublished = statusStr === "published" || statusStr === "on_sale";

  // Show the Complete button when the event is published AND end time has passed.
  // This lets the organizer manually trigger the 'finished' DB write rather than
  // relying on a computed-only client-side flip that never persists.
  const endDatePassed =
    eventData.endDatetime ? new Date() > new Date(eventData.endDatetime) : false;
  const canManuallyComplete = isPublished && endDatePassed;

  return (
    <div className="min-h-screen bg-xanh-pho text-beige-kem p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-8 transition-colors duration-200">
      {toastMsg && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl border text-xs font-medium shadow-2xl flex items-center space-x-2 animate-bounce ${
            toastMsg.type === "success"
              ? "border-la-co bg-la-co/25 text-beige-kem"
              : toastMsg.type === "warning"
              ? "bg-cam-dat text-on-tint border-beige-kem"
              : "bg-burgundy text-white border-beige-kem"
          }`}
        >
          <span>{toastMsg.type === "success" ? "✓" : toastMsg.type === "warning" ? "⚠️" : "✕"}</span>
          <span>{toastMsg.text}</span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <button
            onClick={() => navigate("/organizer")}
            className="text-xs text-ink-soft hover:text-burgundy transition-colors mb-2 inline-flex items-center font-meta"
          >
            ← Danh Mục Sự Kiện Ban Tổ Chức
          </button>
          <h1 className="font-display text-2xl sm:text-3xl font-black text-burgundy-ink tracking-tight">{eventData.title}</h1>
          <p className="font-meta text-xs text-ink-soft mt-1">
            📍 {eventData.venueName}, {eventData.venueAddress} • 📅 {eventData.startDatetime.slice(0, 10)}
          </p>
        </div>

        <div className="flex items-center space-x-2 flex-wrap gap-y-2">
          {/* Scan Vé / Check-in button visible ONLY when event status is Published ('published' or 'on_sale') */}
          {isPublished && (
            <button
              type="button"
              onClick={() => {
                setShowScanModal(true);
                setScanErr(null);
                setScanResult(null);
              }}
              className="px-4 py-2 bg-la-co hover:brightness-110 text-on-tint font-bold rounded-xl text-xs transition-colors shadow-md flex items-center gap-1.5 cursor-pointer"
            >
              <span>📷</span>
              <span>Scan Vé / Check-in</span>
            </button>
          )}

          {canManuallyComplete && (
            <button
              type="button"
              onClick={() => setShowCompleteModal(true)}
              className="px-4 py-2 bg-beige-kem/15 hover:bg-beige-kem/25 text-beige-kem font-bold rounded-xl text-xs transition-colors border border-beige-kem/40 flex items-center gap-1.5 cursor-pointer"
            >
              <span>✓</span>
              <span>Hoàn Tất Sự Kiện</span>
            </button>
          )}

          {eventData.computedStatus === "draft" && (
            <button
              onClick={handleRequestPublish}
              className="px-4 py-2 border border-la-co bg-la-co/25 text-beige-kem hover:bg-la-co/40 font-bold rounded-xl text-xs transition-colors shadow-md"
            >
              🚀 Gửi Yêu Cầu Duyệt
            </button>
          )}

          {!isCanceledOrCompleted && (
            <button
              onClick={() => setShowEditModal(true)}
              className="px-4 py-2 bg-surface-2 hover:bg-beige-kem/10 text-beige-kem font-semibold rounded-xl text-xs transition-colors border border-beige-kem/30"
            >
              ✏️ Chỉnh Sửa Chi Tiết
            </button>
          )}

          {!isCanceledOrCompleted && (
            <button
              onClick={() => setShowCancelModal(true)}
              className="px-4 py-2 bg-burgundy/10 hover:bg-burgundy/20 text-burgundy-ink border border-burgundy/30 font-semibold rounded-xl text-xs transition-colors"
            >
              🚫 Hủy Sự Kiện
            </button>
          )}
        </div>
      </div>

      {getStatusBanner(eventData.computedStatus, eventData.cancellationReason)}

      <EventMetricsSummary metrics={metrics} />

      <TicketTierBreakdown
        ticketTiers={eventData.ticketTiers || []}
        onDeleteOrArchive={handleDeleteOrArchiveTier}
        onEditTier={handleOpenEditTier}
        onAddTier={handleOpenAddTier}
        isReadonly={isCanceledOrCompleted}
      />

      <div className="bg-surface-2 border border-beige-kem/25 rounded-2xl p-6 space-y-4 shadow-md">
        <h2 className="font-display text-lg font-bold text-beige-kem">Mô Tả & Thông Tin Chi Tiết</h2>
        <div className="font-meta text-xs text-beige-kem leading-relaxed whitespace-pre-line bg-xanh-pho p-4 rounded-xl border border-beige-kem/20">
          {eventData.description}
        </div>

        {eventData.videoUrl && (
          <div className="mt-4 pt-4 border-t border-beige-kem/20 space-y-2">
            <h3 className="font-meta text-xs font-bold text-burgundy uppercase tracking-wider flex items-center gap-1.5">
              <span>🎬</span> Video Giới Thiệu / Trailer (Tùy chọn)
            </h3>
            <a
              href={eventData.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center space-x-2 text-xs text-burgundy-ink hover:underline bg-xanh-pho px-3 py-2 rounded-xl border border-beige-kem/30 font-meta"
            >
              <span>▶ Xem Trailer: {eventData.videoUrl}</span>
            </a>
          </div>
        )}
      </div>

      {showEditModal && (
        <EditEventForm
          event={eventData}
          onSave={handleSaveEdit}
          onClose={() => setShowEditModal(false)}
        />
      )}

      {showCancelModal && (
        <CancelEventModal
          eventTitle={eventData.title}
          onConfirm={handleConfirmCancelEvent}
          onClose={() => setShowCancelModal(false)}
        />
      )}

      {showCompleteModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-2 border border-beige-kem/30 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-beige-kem/20 pb-3">
              <h3 className="font-display text-lg font-bold text-beige-kem">Xác Nhận Hoàn Tất Sự Kiện</h3>
              <button
                onClick={() => setShowCompleteModal(false)}
                className="text-ink-soft hover:text-beige-kem text-lg"
                disabled={completeBusy}
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs text-beige-kem/80">
              <p>
                Bạn sắp đánh dấu sự kiện{' '}
                <strong className="text-beige-kem">{eventData?.title}</strong>{' '}
                là <strong className="text-beige-kem">Đã Hoàn Tất</strong>.
              </p>
              <div className="bg-xanh-pho border border-beige-kem/20 rounded-xl p-3 space-y-1.5">
                <p className="font-bold text-beige-kem">Điều này sẽ:</p>
                <ul className="space-y-1 list-disc list-inside text-beige-kem/70">
                  <li>Khóa tất cả bán vé và đặt chỗ mới</li>
                  <li>Vô hiệu hóa chỉnh sửa thông tin sự kiện</li>
                  <li>Cập nhật trạng thái thành <strong>Đã Kết Thúc</strong></li>
                </ul>
              </div>
              <p className="text-beige-kem/50 italic">Hành động này không thể hoàn tác và không ảnh hưởng đến vé đã bán.</p>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-beige-kem/20">
              <button
                type="button"
                onClick={() => setShowCompleteModal(false)}
                disabled={completeBusy}
                className="px-4 py-2 rounded-xl bg-xanh-pho text-beige-kem font-semibold hover:bg-beige-kem/10 border border-beige-kem/20 text-xs"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmCompleteEvent()}
                disabled={completeBusy}
                className="px-4 py-2 rounded-xl bg-beige-kem/20 hover:bg-beige-kem/30 text-beige-kem font-bold border border-beige-kem/40 text-xs transition-colors disabled:opacity-50"
              >
                {completeBusy ? 'Đang xử lý...' : '✓ Xác Nhận Hoàn Tất'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTierModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-2 border border-beige-kem/30 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-beige-kem/20 pb-3">
              <h3 className="font-display text-lg font-bold text-beige-kem">
                {editingTier ? "Chỉnh Sửa Hạng Vé" : "Thêm Hạng Vé Mới"}
              </h3>
              <button onClick={() => setShowTierModal(false)} className="text-ink-soft hover:text-beige-kem">
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveTierForm} className="space-y-3 text-xs">
              <div>
                <label className="block text-ink-soft mb-1.5 font-semibold">Tên Hạng Vé * (Chọn mẫu nhanh hoặc nhập tùy chỉnh)</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {[
                    { label: "Vé Tiêu Chuẩn", defaultPrice: 200000 },
                    { label: "Miễn Phí", defaultPrice: 0 },
                    { label: "VIP", defaultPrice: 500000 }
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setTierLabel(preset.label);
                        if (preset.label === "Miễn Phí") setTierPrice(0);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                        tierLabel === preset.label
                          ? "bg-burgundy text-white border-burgundy shadow-sm"
                          : "bg-surface-2 text-beige-kem border-beige-kem/20 hover:border-beige-kem/40"
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={tierLabel}
                  onChange={(e) => setTierLabel(e.target.value)}
                  placeholder="Vd: Vé VIP, Vé Phổ Thông, Vé Tiêu Chuẩn..."
                  required
                  className="w-full bg-xanh-pho border border-beige-kem/30 rounded-xl p-2.5 text-beige-kem outline-none"
                />
              </div>

              <div>
                <label className="block text-ink-soft mb-1 font-semibold">
                  Giá Vé (VND) * {isFreeTierModal && <span className="font-bold text-la-co-ink">(Cố định 0đ cho Vé Miễn Phí)</span>}
                </label>
                <input
                  type="number"
                  value={isFreeTierModal ? 0 : tierPrice}
                  onChange={(e) => setTierPrice(Number(e.target.value))}
                  step={10000}
                  disabled={isFreeTierModal}
                  required
                  className={`w-full border rounded-xl p-2.5 outline-none font-meta ${
                    isFreeTierModal
                      ? "bg-xanh-pho/50 border-la-co/40 text-beige-kem cursor-not-allowed opacity-80 font-bold"
                      : "bg-xanh-pho border-beige-kem/30 text-beige-kem"
                  }`}
                />
              </div>

              <div>
                <label className="block text-ink-soft mb-1 font-semibold">Sức Chứa (Capacity) *</label>
                <input
                  type="number"
                  value={tierCapacity}
                  onChange={(e) => setTierCapacity(Number(e.target.value))}
                  min={editingTier?.soldCount || 1}
                  required
                  className="w-full bg-xanh-pho border border-beige-kem/30 rounded-xl p-2.5 text-beige-kem outline-none font-meta"
                />
              </div>

              <div>
                <label className="block text-ink-soft mb-1 font-semibold">Mô Tả Hạng Vé</label>
                <textarea
                  rows={2}
                  value={tierDesc}
                  onChange={(e) => setTierDesc(e.target.value)}
                  placeholder="Quyền lợi hạng vé..."
                  className="w-full bg-xanh-pho border border-beige-kem/30 rounded-xl p-2.5 text-beige-kem outline-none"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-beige-kem/20">
                <button
                  type="button"
                  onClick={() => setShowTierModal(false)}
                  className="px-4 py-2 rounded-xl bg-xanh-pho text-beige-kem font-semibold hover:bg-beige-kem/10 border border-beige-kem/20"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-burgundy hover:brightness-110 text-white font-bold shadow-md"
                >
                  Lưu Hạng Vé
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QR Code Scanner / Check-in Modal for Published Events */}
      {showScanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-lg rounded-2xl border-2 border-beige-kem/40 bg-surface-2 p-6 shadow-2xl text-beige-kem space-y-4">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-beige-kem/20 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">📷</span>
                <div>
                  <h3 className="font-display text-lg font-bold text-beige-kem">Quét Vé & Check-in</h3>
                  <p className="text-xs text-beige-kem/60">{eventData.title}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowScanModal(false);
                  setScanResult(null);
                  setScanErr(null);
                  setCameraOn(false);
                }}
                className="rounded-lg p-1.5 text-beige-kem/60 hover:bg-beige-kem/10 hover:text-beige-kem transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Manual Input / Action Bar */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-beige-kem/70">Mã QR vé / Barcode</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={scanCode}
                  onChange={(e) => setScanCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      doCheckIn(scanCode);
                    }
                  }}
                  placeholder="Quét hoặc nhập mã vé..."
                  className="flex-1 rounded-xl border border-beige-kem/30 bg-xanh-pho px-3 py-2 text-xs font-mono text-beige-kem focus:border-burgundy focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => doCheckIn(scanCode)}
                  disabled={scanBusy || !scanCode.trim()}
                  className="rounded-xl bg-la-co px-4 py-2 text-xs font-bold text-on-tint hover:brightness-110 disabled:opacity-50 transition shadow cursor-pointer"
                >
                  Check-in
                </button>
                <button
                  type="button"
                  onClick={() => setCameraOn((on) => !on)}
                  className={`rounded-xl border border-beige-kem/30 px-3 py-2 text-xs font-bold transition cursor-pointer ${
                    cameraOn ? "bg-burgundy text-white" : "bg-beige-kem/10 text-beige-kem hover:bg-beige-kem/20"
                  }`}
                >
                  {cameraOn ? "Tắt Camera" : "Mở Camera"}
                </button>
              </div>
            </div>

            {/* Camera Stream Component Reused from QrCameraScan */}
            {cameraOn && (
              <div className="overflow-hidden rounded-xl border border-beige-kem/30">
                <QrCameraScan
                  onDetect={(code) => {
                    setScanCode(code);
                    doCheckIn(code);
                  }}
                  onError={(msg) => setScanErr(msg)}
                  onClose={() => setCameraOn(false)}
                />
              </div>
            )}

            {/* Loading Indicator */}
            {scanBusy && (
              <div className="flex items-center gap-2 text-xs text-beige-kem/70 font-bold animate-pulse">
                <span className="animate-spin">⏳</span> Đang kiểm tra mã vé...
              </div>
            )}

            {/* Error Message Alert */}
            {scanErr && (
              <div className="rounded-xl border border-burgundy bg-burgundy/20 p-3 text-xs text-beige-kem font-bold">
                ⚠️ {scanErr}
              </div>
            )}

            {/* Scan Result Card */}
            {scanResult && (
              <div className="rounded-xl border border-beige-kem/30 bg-xanh-pho p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-beige-kem/10 pb-2">
                  <div>
                    <span className="font-mono text-xs font-bold text-burgundy-ink">{scanResult.code}</span>
                    <h4 className="font-display text-sm font-bold text-beige-kem">{scanResult.eventTitle}</h4>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                      scanResult.status === "checked_in"
                        ? "bg-la-co/20 text-la-co border border-la-co/40"
                        : scanResult.status === "void"
                        ? "bg-burgundy/20 text-burgundy border border-burgundy/40"
                        : "bg-cam-dat/20 text-cam-dat border border-cam-dat/40"
                    }`}
                  >
                    {scanResult.status === "checked_in"
                      ? scanAlready
                        ? "Đã soát vé (quét lại)"
                        : "Đã check-in thành công"
                      : scanResult.status === "void"
                      ? "Vé đã bị hủy"
                      : "Chưa check-in"}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-beige-kem/50 block text-[10px] uppercase font-bold">Khán giả</span>
                    <span className="font-semibold text-beige-kem">{scanResult.customerName}</span>
                  </div>
                  <div>
                    <span className="text-beige-kem/50 block text-[10px] uppercase font-bold">Hạng vé</span>
                    <span className="font-semibold text-beige-kem">{scanResult.tierLabel}</span>
                  </div>
                  <div>
                    <span className="text-beige-kem/50 block text-[10px] uppercase font-bold">Email</span>
                    <span className="font-semibold text-beige-kem">{scanResult.customerEmail}</span>
                  </div>
                  <div>
                    <span className="text-beige-kem/50 block text-[10px] uppercase font-bold">Chỗ ngồi</span>
                    <span className="font-semibold text-beige-kem">{scanResult.seatLabel || "Vé thường"}</span>
                  </div>
                </div>

                {scanResult.status === "unused" && (
                  <button
                    type="button"
                    onClick={() => doCheckIn(scanResult.code)}
                    disabled={scanBusy}
                    className="w-full rounded-xl bg-la-co py-2 text-xs font-bold text-on-tint hover:brightness-110 transition shadow cursor-pointer"
                  >
                    Xác Nhận Check-in Ngay
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
