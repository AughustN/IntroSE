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
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
          <h2 className="text-xl font-bold text-white">Chỉnh Sửa Thông Tin Sự Kiện</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white text-lg">
            ✕
          </button>
        </div>

        {/* Warning if event is Published */}
        {isPublished && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-xs text-amber-300 space-y-1">
            <p className="font-semibold">⚠️ Chú ý về việc chỉnh sửa sự kiện đã đăng (Published):</p>
            <p className="text-amber-300/80">
              Chỉnh sửa các thông tin quan trọng (Tên, Mô tả, Thời gian) sẽ tự động chuyển trạng thái sự kiện về <strong>Chờ Duyệt (Pending Approval)</strong> và ẩn khỏi danh mục công khai cho đến khi Admin duyệt lại (theo quy định UC-24 A6).
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Title */}
          <div>
            <label className="block text-zinc-400 mb-1 font-medium">Tên Sự Kiện *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500/60 rounded-lg p-2.5 text-white outline-none"
            />
          </div>

          {/* Banner URL */}
          <div>
            <label className="block text-zinc-400 mb-1 font-medium">Link Hình Ảnh Banner *</label>
            <input
              type="url"
              value={bannerUrl}
              onChange={(e) => setBannerUrl(e.target.value)}
              required
              className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500/60 rounded-lg p-2.5 text-white outline-none"
            />
          </div>

          {/* Venue & City */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-zinc-400 mb-1 font-medium">Tên Địa Điểm / Nhà Hát *</label>
              <input
                type="text"
                value={venueName}
                onChange={(e) => setVenueName(e.target.value)}
                required
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500/60 rounded-lg p-2.5 text-white outline-none"
              />
            </div>
            <div>
              <label className="block text-zinc-400 mb-1 font-medium">Thành Phố *</label>
              <select
                value={city}
                onChange={(e) => setCity(e.target.value as any)}
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500/60 rounded-lg p-2.5 text-white outline-none"
              >
                <option value="TP.HCM">TP.HCM</option>
                <option value="Hà Nội">Hà Nội</option>
                <option value="Đà Nẵng">Đà Nẵng</option>
              </select>
            </div>
          </div>

          {/* Address */}
          <div>
            <label className="block text-zinc-400 mb-1 font-medium">Địa Chỉ Chi Tiết *</label>
            <input
              type="text"
              value={venueAddress}
              onChange={(e) => setVenueAddress(e.target.value)}
              required
              className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500/60 rounded-lg p-2.5 text-white outline-none"
            />
          </div>

          {/* Datetimes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-zinc-400 mb-1 font-medium">Thời Gian Bắt Đầu *</label>
              <input
                type="text"
                value={startDatetime}
                onChange={(e) => setStartDatetime(e.target.value)}
                required
                placeholder="2026-09-15T19:30:00Z"
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500/60 rounded-lg p-2.5 text-white outline-none font-mono"
              />
            </div>
            <div>
              <label className="block text-zinc-400 mb-1 font-medium">Thời Gian Kết Thúc *</label>
              <input
                type="text"
                value={endDatetime}
                onChange={(e) => setEndDatetime(e.target.value)}
                required
                placeholder="2026-09-15T22:30:00Z"
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500/60 rounded-lg p-2.5 text-white outline-none font-mono"
              />
            </div>
          </div>

          {/* AI Description Assistant */}
          <div className="bg-gradient-to-r from-purple-950/60 to-zinc-900 p-3 rounded-xl border border-purple-500/30 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-purple-300 flex items-center gap-1">
                <span>🤖</span> AI Trợ Lý Gợi Ý Mô Tả
              </span>
              <span className="text-[10px] text-purple-400 bg-purple-900/40 px-2 py-0.5 rounded-full border border-purple-500/30">
                TixHub AI
              </span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={aiBrief}
                onChange={(e) => setAiBrief(e.target.value)}
                placeholder="Nhập ý tưởng/chủ đề..."
                className="flex-1 bg-zinc-950 border border-purple-500/30 rounded-lg p-2 text-white outline-none text-xs"
              />
              <button
                type="button"
                onClick={askAiAssistant}
                disabled={aiBusy}
                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-lg text-xs transition-colors shrink-0"
              >
                {aiBusy ? "⏳..." : "Nhờ AI Gợi Ý"}
              </button>
            </div>
            {aiSuggestion && (
              <div className="p-2 bg-zinc-950 rounded-lg border border-purple-500/40 space-y-1.5">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-purple-300 font-semibold">Gợi ý từ AI:</span>
                  <button
                    type="button"
                    onClick={applyAiSuggestion}
                    className="px-2 py-0.5 bg-amber-500 text-zinc-950 font-bold rounded text-[10px]"
                  >
                    ✨ Áp Dụng
                  </button>
                </div>
                <p className="text-zinc-300 text-[11px] line-clamp-3 bg-zinc-900 p-1.5 rounded">{aiSuggestion.description}</p>
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-zinc-400 mb-1 font-medium">Mô Tả Chi Tiết Sự Kiện *</label>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500/60 rounded-lg p-2.5 text-white outline-none"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold transition-colors shadow-md shadow-amber-500/10"
            >
              Lưu Thay Đổi
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
