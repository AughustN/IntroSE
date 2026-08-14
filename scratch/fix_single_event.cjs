const fs = require('fs');

const code = `import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  getOrganizerEventDetail,
  requestPublication,
  updateEventDetails,
  deleteOrArchiveTier,
  saveTicketTier,
  cancelEvent
} from "../../services/organizerClient";
import { OrganizerEvent, TicketTier } from "../../types";
import { EventMetricsSummary } from "../../components/organizer/EventMetricsSummary";
import { TicketTierBreakdown } from "../../components/organizer/TicketTierBreakdown";
import { EditEventForm } from "../../components/organizer/EditEventForm";
import { CancelEventModal } from "../../components/organizer/CancelEventModal";

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
  const [editingTier, setEditingTier] = useState<TicketTier | null>(null);
  const [showTierModal, setShowTierModal] = useState(false);

  const [tierLabel, setTierLabel] = useState("");
  const [tierPrice, setTierPrice] = useState(100000);
  const [tierCapacity, setTierCapacity] = useState(100);
  const [tierDesc, setTierDesc] = useState("");

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

  const handleSaveTierForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId) return;

    try {
      await saveTicketTier(eventId, {
        id: editingTier?.id,
        label: tierLabel,
        price: Number(tierPrice),
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
        \`Sự kiện đã bị hủy. Đã phát lệnh hoàn tiền cho \${res.auditRecord.ticketsAffectedCount} vé.\`
      );
      loadEvent();
    } catch (err: any) {
      showToast("error", err.message || "Hủy sự kiện thất bại.");
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
            <span className="px-3 py-1 bg-la-co text-on-tint rounded-full font-bold text-[10px]">ĐÃ DUYỆT</span>
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

  return (
    <div className="min-h-screen bg-xanh-pho text-beige-kem p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-8 transition-colors duration-200">
      {toastMsg && (
        <div
          className={\`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl border text-xs font-medium shadow-2xl flex items-center space-x-2 animate-bounce \${
            toastMsg.type === "success"
              ? "bg-la-co text-on-tint border-beige-kem"
              : toastMsg.type === "warning"
              ? "bg-cam-dat text-on-tint border-beige-kem"
              : "bg-burgundy text-white border-beige-kem"
          }\`}
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
          <h1 className="font-display text-2xl sm:text-3xl font-black text-beige-kem tracking-tight">{eventData.title}</h1>
          <p className="font-meta text-xs text-ink-soft mt-1">
            📍 {eventData.venueName}, {eventData.venueAddress} • 📅 {eventData.startDatetime.slice(0, 10)}
          </p>
        </div>

        <div className="flex items-center space-x-2 flex-wrap gap-y-2">
          {eventData.computedStatus === "draft" && (
            <button
              onClick={handleRequestPublish}
              className="px-4 py-2 bg-la-co hover:brightness-110 text-on-tint font-bold rounded-xl text-xs transition-colors shadow-md"
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
                <label className="block text-ink-soft mb-1 font-semibold">Tên Hạng Vé *</label>
                <input
                  type="text"
                  value={tierLabel}
                  onChange={(e) => setTierLabel(e.target.value)}
                  placeholder="Vd: Vé VIP, Vé Phổ Thông"
                  required
                  className="w-full bg-xanh-pho border border-beige-kem/30 rounded-xl p-2.5 text-beige-kem outline-none"
                />
              </div>

              <div>
                <label className="block text-ink-soft mb-1 font-semibold">Giá Vé (VND) *</label>
                <input
                  type="number"
                  value={tierPrice}
                  onChange={(e) => setTierPrice(Number(e.target.value))}
                  step={10000}
                  required
                  className="w-full bg-xanh-pho border border-beige-kem/30 rounded-xl p-2.5 text-beige-kem outline-none font-meta"
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
    </div>
  );
};
`;

fs.writeFileSync('src/pages/organizer/SingleEventPage.tsx', code, 'utf8');
