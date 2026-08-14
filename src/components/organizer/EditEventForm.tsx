import React, { useState } from "react";
import { OrganizerEvent } from "../../types";
import { aiClient, type ListingSuggestion } from "../../services/aiClient";

interface EditEventFormProps {
  event: OrganizerEvent;
  onSave: (updatedData: Partial<OrganizerEvent>) => void;
  onClose: () => void;
}

export const EditEventForm: React.FC<EditEventFormProps> = ({ event, onSave, onClose }) => {
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description);
  const [venueName, setVenueName] = useState(event.venueName);
  const [venueAddress, setVenueAddress] = useState(event.venueAddress);
  const [city, setCity] = useState<"TP.HCM" | "Hà Nội" | "Đà Nẵng">(event.city);
  const [startDatetime, setStartDatetime] = useState(event.startDatetime);
  const [endDatetime, setEndDatetime] = useState(event.endDatetime);
  const [bannerUrl, setBannerUrl] = useState(event.bannerUrl);

  // AI Description Assistant State
  const [aiBrief, setAiBrief] = useState(event.title);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<ListingSuggestion | null>(null);

  const askAiAssistant = async () => {
    if (!aiBrief.trim()) return;
    setAiBusy(true);
    try {
      const res = await aiClient.eventAssistant({
        brief: aiBrief.trim(),
        category: event.category || "music",
        eventType: "general_admission"
      });
      setAiSuggestion(res.suggestion);
    } catch (err) {
      console.error("AI assistant error:", err);
    } finally {
      setAiBusy(false);
    }
  };

  const applyAiSuggestion = () => {
    if (!aiSuggestion) return;
    if (aiSuggestion.title) setTitle(aiSuggestion.title);
    if (aiSuggestion.description) setDescription(aiSuggestion.description);
  };

  const isPublished = event.computedStatus === "published";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      title,
      description,
      venueName,
      venueAddress,
      city,
      startDatetime,
      endDatetime,
      bannerUrl
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="max-h-[90vh] w-full max-w-2xl space-y-6 overflow-y-auto rounded-2xl border border-beige-kem/25 bg-surface-2 p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-beige-kem/25 pb-4">
          <h2 className="font-display text-title-s font-black text-beige-kem">Chỉnh Sửa Thông Tin Sự Kiện</h2>
          <button onClick={onClose} className="text-lg text-ink-soft transition-colors hover:text-beige-kem">
            ✕
          </button>
        </div>

        {/* Warning if event is Published */}
        {isPublished && (
          <div className="space-y-1 rounded-xl border border-cam-dat bg-cam-dat/15 p-4 text-xs text-beige-kem">
            <p className="font-semibold">⚠️ Chú ý về việc chỉnh sửa sự kiện đã đăng (Published):</p>
            <p className="text-ink-soft">
              Chỉnh sửa các thông tin quan trọng (Tên, Mô tả, Thời gian) sẽ tự động chuyển trạng thái sự kiện về <strong>Chờ Duyệt (Pending Approval)</strong> và ẩn khỏi danh mục công khai cho đến khi Admin duyệt lại (theo quy định UC-24 A6).
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Title */}
          <div>
            <label className="mb-1 block font-bold text-ink-soft">Tên Sự Kiện *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full rounded-lg border border-beige-kem/25 bg-xanh-pho p-2.5 text-beige-kem outline-none transition-colors placeholder:text-ink-soft/60 focus:border-burgundy"
            />
          </div>

          {/* Banner URL */}
          <div>
            <label className="mb-1 block font-bold text-ink-soft">Link Hình Ảnh Banner *</label>
            <input
              type="url"
              value={bannerUrl}
              onChange={(e) => setBannerUrl(e.target.value)}
              required
              className="w-full rounded-lg border border-beige-kem/25 bg-xanh-pho p-2.5 text-beige-kem outline-none transition-colors placeholder:text-ink-soft/60 focus:border-burgundy"
            />
          </div>

          {/* Venue & City */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="mb-1 block font-bold text-ink-soft">Tên Địa Điểm / Nhà Hát *</label>
              <input
                type="text"
                value={venueName}
                onChange={(e) => setVenueName(e.target.value)}
                required
                className="w-full rounded-lg border border-beige-kem/25 bg-xanh-pho p-2.5 text-beige-kem outline-none transition-colors placeholder:text-ink-soft/60 focus:border-burgundy"
              />
            </div>
            <div>
              <label className="mb-1 block font-bold text-ink-soft">Thành Phố *</label>
              <select
                value={city}
                onChange={(e) => setCity(e.target.value as any)}
                className="w-full rounded-lg border border-beige-kem/25 bg-xanh-pho p-2.5 text-beige-kem outline-none transition-colors placeholder:text-ink-soft/60 focus:border-burgundy"
              >
                <option value="TP.HCM">TP.HCM</option>
                <option value="Hà Nội">Hà Nội</option>
                <option value="Đà Nẵng">Đà Nẵng</option>
              </select>
            </div>
          </div>

          {/* Address */}
          <div>
            <label className="mb-1 block font-bold text-ink-soft">Địa Chỉ Chi Tiết *</label>
            <input
              type="text"
              value={venueAddress}
              onChange={(e) => setVenueAddress(e.target.value)}
              required
              className="w-full rounded-lg border border-beige-kem/25 bg-xanh-pho p-2.5 text-beige-kem outline-none transition-colors placeholder:text-ink-soft/60 focus:border-burgundy"
            />
          </div>

          {/* Datetimes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-bold text-ink-soft">Thời Gian Bắt Đầu *</label>
              <input
                type="text"
                value={startDatetime}
                onChange={(e) => setStartDatetime(e.target.value)}
                required
                placeholder="2026-09-15T19:30:00Z"
                className="w-full rounded-lg border border-beige-kem/25 bg-xanh-pho p-2.5 font-meta tabular-nums text-beige-kem outline-none transition-colors focus:border-burgundy"
              />
            </div>
            <div>
              <label className="mb-1 block font-bold text-ink-soft">Thời Gian Kết Thúc *</label>
              <input
                type="text"
                value={endDatetime}
                onChange={(e) => setEndDatetime(e.target.value)}
                required
                placeholder="2026-09-15T22:30:00Z"
                className="w-full rounded-lg border border-beige-kem/25 bg-xanh-pho p-2.5 font-meta tabular-nums text-beige-kem outline-none transition-colors focus:border-burgundy"
              />
            </div>
          </div>

          {/* AI Description Assistant */}
          <div className="space-y-2 rounded-xl border border-la-co bg-la-co/15 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1 font-bold text-beige-kem">
                <span>🤖</span> AI Trợ Lý Gợi Ý Mô Tả
              </span>
              <span className="rounded-full border border-la-co bg-la-co/25 px-2 py-0.5 font-meta text-meta text-beige-kem">
                TixHub AI
              </span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={aiBrief}
                onChange={(e) => setAiBrief(e.target.value)}
                placeholder="Nhập ý tưởng/chủ đề..."
                className="flex-1 rounded-lg border border-beige-kem/25 bg-xanh-pho p-2 text-xs text-beige-kem outline-none transition-colors focus:border-burgundy"
              />
              <button
                type="button"
                onClick={askAiAssistant}
                disabled={aiBusy}
                className="shrink-0 rounded-lg bg-burgundy px-3 py-1.5 text-xs font-bold text-white transition hover:brightness-110"
              >
                {aiBusy ? "⏳..." : "Nhờ AI Gợi Ý"}
              </button>
            </div>
            {aiSuggestion && (
              <div className="space-y-1.5 rounded-lg border border-beige-kem/25 bg-xanh-pho p-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-beige-kem">Gợi ý từ AI:</span>
                  <button
                    type="button"
                    onClick={applyAiSuggestion}
                    className="rounded bg-cam-dat px-2 py-0.5 font-meta text-meta font-bold text-on-tint"
                  >
                    ✨ Áp Dụng
                  </button>
                </div>
                <p className="line-clamp-3 rounded bg-surface-2 p-1.5 font-meta text-meta text-beige-kem">{aiSuggestion.description}</p>
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block font-bold text-ink-soft">Mô Tả Chi Tiết Sự Kiện *</label>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              className="w-full rounded-lg border border-beige-kem/25 bg-xanh-pho p-2.5 text-beige-kem outline-none transition-colors placeholder:text-ink-soft/60 focus:border-burgundy"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end space-x-3 border-t border-beige-kem/25 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-beige-kem/40 px-4 py-2 font-bold text-beige-kem transition-colors hover:bg-bubblegum/20"
            >
              Hủy
            </button>
            <button
              type="submit"
              className="rounded-lg bg-burgundy px-4 py-2 font-bold text-white transition hover:brightness-110"
            >
              Lưu Thay Đổi
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
