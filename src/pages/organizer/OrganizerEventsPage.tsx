import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { EventCard } from "../../components/organizer/EventCard";
import { PortfolioSummaryHeader } from "../../components/organizer/PortfolioSummaryHeader";
import { getOrganizerEvents, createOrganizerEvent, CreateEventInput } from "../../services/organizerClient";
import { aiClient, type ListingSuggestion } from "../../services/aiClient";
import { OrganizerPortfolioSummary } from "../../types";

export const OrganizerEventsPage: React.FC = () => {
  const navigate = useNavigate();

  // Active Part / Tab: "manage" (Quản lý sự kiện) or "create" (Tạo sự kiện mới)
  const [activeTab, setActiveTab] = useState<"manage" | "create">("manage");

  // Portfolio State
  const [events, setEvents] = useState<OrganizerPortfolioSummary[]>([]);
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [toastMsg, setToastMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [summary, setSummary] = useState({
    totalEvents: 0,
    draftCount: 0,
    pendingCount: 0,
    publishedCount: 0,
    canceledCount: 0,
    completedCount: 0
  });

  // Create Event Form State
  const [createTitle, setCreateTitle] = useState("");
  const [createCategory, setCreateCategory] = useState("music");
  const [createCategoryLabel, setCreateCategoryLabel] = useState("Âm nhạc");
  const [createPictureUrl, setCreatePictureUrl] = useState("");
  const [createVideoUrl, setCreateVideoUrl] = useState("");
  const [createVenueName, setCreateVenueName] = useState("");
  const [createVenueAddress, setCreateVenueAddress] = useState("");
  const [createCity, setCreateCity] = useState<"TP.HCM" | "Hà Nội" | "Đà Nẵng">("TP.HCM");
  const [createStartDatetime, setCreateStartDatetime] = useState("2026-09-20T19:30");
  const [createEndDatetime, setCreateEndDatetime] = useState("2026-09-20T22:30");
  const [createDescription, setCreateDescription] = useState("");
  const [createTierLabel, setCreateTierLabel] = useState("Vé Standard");
  const [createTierPrice, setCreateTierPrice] = useState(200000);
  const [createTierCapacity, setCreateTierCapacity] = useState(100);

  // AI Description Assistant State
  const [aiBrief, setAiBrief] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<ListingSuggestion | null>(null);

  const showToast = (type: "success" | "error", text: string) => {
    setToastMsg({ type, text });
    setTimeout(() => setToastMsg(null), 5000);
  };

  const askAiDescriptionAssistant = async () => {
    if (!aiBrief.trim()) {
      showToast("error", "Vui lòng nhập ý tưởng/tóm tắt sự kiện trước khi nhờ AI gợi ý.");
      return;
    }
    setAiBusy(true);
    try {
      const res = await aiClient.eventAssistant({
        brief: aiBrief.trim(),
        category: createCategory,
        eventType: "general_admission"
      });
      setAiSuggestion(res.suggestion);
      showToast("success", "AI đã tạo gợi ý tiêu đề & mô tả thành công!");
    } catch (err: any) {
      showToast("error", err.message || "Không thể gọi AI gợi ý mô tả.");
    } finally {
      setAiBusy(false);
    }
  };

  const applyAiSuggestion = () => {
    if (!aiSuggestion) return;
    if (aiSuggestion.title) setCreateTitle(aiSuggestion.title);
    if (aiSuggestion.description) setCreateDescription(aiSuggestion.description);
    if (aiSuggestion.ticketPriceSuggestions && aiSuggestion.ticketPriceSuggestions.length > 0) {
      setCreateTierLabel(aiSuggestion.ticketPriceSuggestions[0].name);
      setCreateTierPrice(aiSuggestion.ticketPriceSuggestions[0].price);
    }
    showToast("success", "Đã áp dụng tiêu đề & mô tả từ AI vào biểu mẫu!");
  };

  const loadPortfolio = async () => {
    setLoading(true);
    try {
      const res = await getOrganizerEvents({ status: activeFilter, search: searchTerm });
      setEvents(res.data);
      setSummary(res.summary);
    } catch (err) {
      console.error("Failed to load organizer events portfolio:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "manage") {
      loadPortfolio();
    }
  }, [activeFilter, searchTerm, activeTab]);

  const handleSelectEvent = (eventId: string) => {
    navigate(`/organizer/${eventId}`);
  };

  // Submit Create Event Form
  const handleCreateEventSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createPictureUrl || createPictureUrl.trim() === "") {
      showToast("error", "Hình ảnh sự kiện (Picture) là bắt buộc!");
      return;
    }

    try {
      const input: CreateEventInput = {
        title: createTitle,
        category: createCategory,
        categoryLabel: createCategoryLabel,
        bannerUrl: createPictureUrl,
        videoUrl: createVideoUrl || undefined,
        venueName: createVenueName,
        venueAddress: createVenueAddress,
        city: createCity,
        startDatetime: createStartDatetime.includes("Z") ? createStartDatetime : `${createStartDatetime}:00Z`,
        endDatetime: createEndDatetime.includes("Z") ? createEndDatetime : `${createEndDatetime}:00Z`,
        description: createDescription,
        ticketTiers: [
          {
            label: createTierLabel,
            price: Number(createTierPrice),
            capacity: Number(createTierCapacity),
            description: "Hạng vé khởi tạo mặc định"
          }
        ]
      };

      const newEvt = await createOrganizerEvent(input);
      showToast("success", "Tạo sự kiện mới thành công! Dữ liệu đã được lưu vào hệ thống.");
      
      // Reset Form
      setCreateTitle("");
      setCreatePictureUrl("");
      setCreateVideoUrl("");
      setCreateVenueName("");
      setCreateVenueAddress("");
      setCreateDescription("");

      // Switch to Management view & navigate to newly created event
      setActiveTab("manage");
      navigate(`/organizer/${newEvt.eventId}`);
    } catch (err: any) {
      showToast("error", err.message || "Tạo sự kiện thất bại.");
    }
  };

  return (
    <div className="min-h-screen bg-xanh-pho text-beige-kem p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-8 transition-colors duration-200">
      {/* Toast Notification */}
      {toastMsg && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl border text-xs font-medium shadow-2xl flex items-center space-x-2 animate-bounce ${
            toastMsg.type === "success"
              ? "bg-la-co text-on-tint border-beige-kem"
              : "bg-burgundy text-white border-beige-kem"
          }`}
        >
          <span>{toastMsg.type === "success" ? "✓" : "✕"}</span>
          <span>{toastMsg.text}</span>
        </div>
      )}

      {/* Main Page Title & Top Section Navigation */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl font-black tracking-tight text-burgundy-ink">
              Quản Lý Sự Kiện Ban Tổ Chức
            </h1>
            <p className="font-meta text-xs text-ink-soft mt-1">
              Phân chia thành 2 phần: Quản lý danh mục sự kiện hiện có và Khởi tạo sự kiện mới.
            </p>
          </div>
        </div>

        {/* 2-Part Section Selector Tabs */}
        <div className="flex items-center space-x-2 border-b border-beige-kem/20 pb-3">
          <button
            onClick={() => setActiveTab("manage")}
            className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 flex items-center space-x-2 ${
              activeTab === "manage"
                ? "bg-burgundy text-white shadow-lg shadow-burgundy/20"
                : "bg-surface-2 text-ink-soft border border-beige-kem/20 hover:text-beige-kem"
            }`}
          >
            <span>📋 Phần 1: Quản Lý Sự Kiện Hiện Có</span>
            <span className="px-1.5 py-0.5 rounded-full bg-black/20 text-[10px]">
              {summary.totalEvents}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("create")}
            className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 flex items-center space-x-2 ${
              activeTab === "create"
                ? "bg-burgundy text-white shadow-lg shadow-burgundy/20"
                : "bg-surface-2 text-ink-soft border border-beige-kem/20 hover:text-beige-kem"
            }`}
          >
            <span>➕ Phần 2: Tạo Sự Kiện Mới</span>
          </button>
        </div>
      </div>

      {/* PART 1: MANAGE CURRENT EVENTS */}
      {activeTab === "manage" && (
        <div className="space-y-6">
          <PortfolioSummaryHeader
            summary={summary}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            onSearchChange={setSearchTerm}
            searchTerm={searchTerm}
            onCreateEvent={() => setActiveTab("create")}
          />

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-burgundy"></div>
            </div>
          ) : events.length === 0 ? (
            /* Empty State */
            <div className="bg-surface-2 border border-beige-kem/20 rounded-2xl p-12 text-center space-y-4 max-w-md mx-auto my-12 shadow-md">
              <div className="w-16 h-16 bg-cam-dat/20 text-burgundy rounded-full flex items-center justify-center mx-auto text-2xl font-bold">
                📅
              </div>
              <h3 className="font-display text-lg font-bold text-beige-kem">Chưa có sự kiện nào</h3>
              <p className="font-meta text-xs text-ink-soft">
                {searchTerm || activeFilter !== "all"
                  ? "Không tìm thấy sự kiện khớp với bộ lọc hoặc từ khóa tìm kiếm của bạn."
                  : "Bạn chưa tạo sự kiện nào trên TixHub. Chuyển sang Phần 2 để tạo sự kiện đầu tiên!"}
              </p>
              {searchTerm || activeFilter !== "all" ? (
                <button
                  onClick={() => {
                    setActiveFilter("all");
                    setSearchTerm("");
                  }}
                  className="font-meta text-xs text-burgundy-ink hover:underline font-bold"
                >
                  Xóa bộ lọc tìm kiếm
                </button>
              ) : (
                <button
                  onClick={() => setActiveTab("create")}
                  className="inline-flex items-center px-4 py-2 text-xs font-bold bg-burgundy hover:brightness-110 text-white rounded-xl transition-colors"
                >
                  + Sang Phần Tạo Sự Kiện Mới
                </button>
              )}
            </div>
          ) : (
            /* Event Cards Grid with Background Image Overlay Layout */
            <div className="grid grid-cols-1 gap-6">
              {events.map((event) => (
                <EventCard key={event.eventId} event={event} onSelect={handleSelectEvent} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* PART 2: CREATE NEW EVENT FORM */}
      {activeTab === "create" && (
        <div className="bg-surface-2 border border-beige-kem/25 rounded-2xl p-6 sm:p-8 max-w-3xl mx-auto space-y-6 shadow-2xl transition-colors">
          <div className="border-b border-beige-kem/20 pb-4">
            <h2 className="font-display text-xl font-bold text-beige-kem flex items-center gap-2">
              <span>✨</span> Tạo Sự Kiện Mới
            </h2>
            <p className="font-meta text-xs text-ink-soft mt-1">
              Nhập thông tin chi tiết sự kiện, tải lên hình ảnh (bắt buộc) và video giới thiệu (tùy chọn).
            </p>
          </div>

          <form onSubmit={handleCreateEventSubmit} className="space-y-5 text-xs">
            {/* Title & Category */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block font-meta text-beige-kem font-semibold mb-1">Tên Sự Kiện *</label>
                <input
                  type="text"
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                  placeholder="Vd: Live Concert Mùa Hè 2026"
                  required
                  className="w-full bg-xanh-pho border border-beige-kem/30 focus:border-burgundy rounded-xl p-3 text-beige-kem outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block font-meta text-beige-kem font-semibold mb-1">Thể Loại *</label>
                <select
                  value={createCategory}
                  onChange={(e) => {
                    setCreateCategory(e.target.value);
                    const labels: Record<string, string> = {
                      music: "Âm nhạc",
                      art: "Triển lãm",
                      conference: "Hội thảo",
                      concert: "Concert"
                    };
                    setCreateCategoryLabel(labels[e.target.value] || "Khác");
                  }}
                  className="w-full bg-xanh-pho border border-beige-kem/30 focus:border-burgundy rounded-xl p-3 text-beige-kem outline-none transition-colors"
                >
                  <option value="music">Âm nhạc</option>
                  <option value="art">Triển lãm</option>
                  <option value="conference">Hội thảo</option>
                  <option value="concert">Concert</option>
                </select>
              </div>
            </div>

            {/* Media Upload Section: Picture (Required) & Video (Optional) */}
            <div className="bg-xanh-pho p-4 rounded-xl border border-beige-kem/25 space-y-4">
              <h3 className="font-meta text-xs font-bold text-burgundy uppercase tracking-wider">
                🖼️ Hình Ảnh & Video Sự Kiện
              </h3>

              {/* Required Picture Upload */}
              <div>
                <label className="block font-meta text-beige-kem font-semibold mb-1">
                  Hình Ảnh Sự Kiện (Picture / Banner Cover) <span className="text-burgundy-ink">* (Bắt buộc)</span>
                </label>
                <input
                  type="url"
                  value={createPictureUrl}
                  onChange={(e) => setCreatePictureUrl(e.target.value)}
                  placeholder="Dán link ảnh (https://...jpg/png) hoặc chọn file làm hình nền cho sự kiện"
                  required
                  className="w-full bg-surface-2 border border-beige-kem/30 focus:border-burgundy rounded-xl p-3 text-beige-kem outline-none font-meta"
                />
                {createPictureUrl && (
                  <div className="mt-2 h-28 w-full rounded-lg overflow-hidden relative border border-beige-kem/30">
                    <img src={createPictureUrl} alt="Preview" className="w-full h-full object-cover" />
                    <span className="absolute bottom-1 right-2 bg-black/70 px-2 py-0.5 rounded text-[10px] text-white">
                      ✓ Xem trước Picture
                    </span>
                  </div>
                )}
              </div>

              {/* Optional Video Upload */}
              <div>
                <label className="block font-meta text-beige-kem font-semibold mb-1">
                  Video Giới Thiệu / Trailer <span className="text-ink-soft font-normal">(Tùy chọn)</span>
                </label>
                <input
                  type="url"
                  value={createVideoUrl}
                  onChange={(e) => setCreateVideoUrl(e.target.value)}
                  placeholder="Dán link video/trailer (https://youtube.com/... hoặc .mp4)"
                  className="w-full bg-surface-2 border border-beige-kem/30 focus:border-burgundy rounded-xl p-3 text-beige-kem outline-none font-meta"
                />
              </div>
            </div>

            {/* Location & City */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block font-meta text-beige-kem font-semibold mb-1">Tên Địa Điểm / Nhà Hát *</label>
                <input
                  type="text"
                  value={createVenueName}
                  onChange={(e) => setCreateVenueName(e.target.value)}
                  placeholder="Vd: Nhà hát Hòa Bình"
                  required
                  className="w-full bg-xanh-pho border border-beige-kem/30 focus:border-burgundy rounded-xl p-3 text-beige-kem outline-none"
                />
              </div>
              <div>
                <label className="block font-meta text-beige-kem font-semibold mb-1">Thành Phố *</label>
                <select
                  value={createCity}
                  onChange={(e) => setCreateCity(e.target.value as any)}
                  className="w-full bg-xanh-pho border border-beige-kem/30 focus:border-burgundy rounded-xl p-3 text-beige-kem outline-none"
                >
                  <option value="TP.HCM">TP.HCM</option>
                  <option value="Hà Nội">Hà Nội</option>
                  <option value="Đà Nẵng">Đà Nẵng</option>
                </select>
              </div>
            </div>

            {/* Address */}
            <div>
              <label className="block font-meta text-beige-kem font-semibold mb-1">Địa Chỉ Chi Tiết *</label>
              <input
                type="text"
                value={createVenueAddress}
                onChange={(e) => setCreateVenueAddress(e.target.value)}
                placeholder="Vd: 240 3 Tháng 2, Phường 12, Quận 10"
                required
                className="w-full bg-xanh-pho border border-beige-kem/30 focus:border-burgundy rounded-xl p-3 text-beige-kem outline-none"
              />
            </div>

            {/* Schedule */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-meta text-beige-kem font-semibold mb-1">Thời Gian Bắt Đầu *</label>
                <input
                  type="datetime-local"
                  value={createStartDatetime}
                  onChange={(e) => setCreateStartDatetime(e.target.value)}
                  required
                  className="w-full bg-xanh-pho border border-beige-kem/30 focus:border-burgundy rounded-xl p-3 text-beige-kem outline-none font-meta"
                />
              </div>
              <div>
                <label className="block font-meta text-beige-kem font-semibold mb-1">Thời Gian Kết Thúc *</label>
                <input
                  type="datetime-local"
                  value={createEndDatetime}
                  onChange={(e) => setCreateEndDatetime(e.target.value)}
                  required
                  className="w-full bg-xanh-pho border border-beige-kem/30 focus:border-burgundy rounded-xl p-3 text-beige-kem outline-none font-meta"
                />
              </div>
            </div>

            {/* AI Assistant for Recommended Description */}
            <div className="bg-surface-2 p-4 rounded-xl border border-beige-kem/30 space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="font-meta text-xs font-bold text-burgundy uppercase tracking-wider flex items-center gap-1.5">
                  <span>🤖</span> AI Trợ Lý Viết Mô Tả Sự Kiện
                </h3>
                <span className="text-[10px] font-semibold text-white bg-burgundy px-2 py-0.5 rounded-full">
                  TixHub AI
                </span>
              </div>
              <p className="font-meta text-[11px] text-ink-soft leading-relaxed">
                Nhập ý tưởng ngắn hoặc chủ đề sự kiện (vd: "Đêm nhạc acoustic Trịnh Công Sơn không gian ấm cúng"), AI sẽ tự động tạo tiêu đề & mô tả hấp dẫn cho bạn!
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={aiBrief}
                  onChange={(e) => setAiBrief(e.target.value)}
                  placeholder="Nhập ý tưởng/tóm tắt nội dung sự kiện..."
                  className="flex-1 bg-xanh-pho border border-beige-kem/30 focus:border-burgundy rounded-xl p-2.5 text-beige-kem outline-none text-xs"
                />
                <button
                  type="button"
                  onClick={askAiDescriptionAssistant}
                  disabled={aiBusy}
                  className="px-4 py-2.5 bg-burgundy hover:brightness-110 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition-all shadow-md shrink-0 flex items-center justify-center space-x-1"
                >
                  {aiBusy ? <span>⏳ AI Đang Tạo...</span> : <span>Nhờ AI Gợi Ý Mô Tả</span>}
                </button>
              </div>

              {aiSuggestion && (
                <div className="mt-3 p-3.5 bg-xanh-pho rounded-xl border border-beige-kem/30 space-y-2 text-xs">
                  <div className="flex items-center justify-between border-b border-beige-kem/20 pb-2">
                    <span className="font-bold text-burgundy">💡 Gợi Ý Từ AI:</span>
                    <button
                      type="button"
                      onClick={applyAiSuggestion}
                      className="px-3 py-1 bg-la-co text-on-tint font-bold rounded-lg text-[11px] transition-colors shadow-md"
                    >
                      ✨ Áp Dụng Tiêu Đề & Mô Tả Này
                    </button>
                  </div>
                  <div>
                    <span className="text-ink-soft font-semibold">Tiêu đề gợi ý:</span>{" "}
                    <span className="text-beige-kem font-bold">{aiSuggestion.title}</span>
                  </div>
                  <div>
                    <span className="text-ink-soft font-semibold block mb-1">Mô tả gợi ý:</span>
                    <p className="text-beige-kem bg-surface-2 p-2.5 rounded-lg border border-beige-kem/20 line-clamp-4 whitespace-pre-line text-[11px]">
                      {aiSuggestion.description}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Description */}
            <div>
              <label className="block font-meta text-beige-kem font-semibold mb-1">Mô Tả Chi Tiết Sự Kiện *</label>
              <textarea
                rows={4}
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                placeholder="Nhập mô tả sự kiện (hoặc dùng AI gợi ý ở trên)..."
                required
                className="w-full bg-xanh-pho border border-beige-kem/30 focus:border-burgundy rounded-xl p-3 text-beige-kem outline-none"
              />
            </div>

            {/* Initial Ticket Tier Setup */}
            <div className="bg-xanh-pho p-4 rounded-xl border border-beige-kem/25 space-y-3">
              <h3 className="font-meta text-xs font-bold text-burgundy uppercase tracking-wider">
                🎟️ Hạng Vé Đầu Tiên (Khởi tạo)
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-ink-soft mb-1">Tên Hạng Vé</label>
                  <input
                    type="text"
                    value={createTierLabel}
                    onChange={(e) => setCreateTierLabel(e.target.value)}
                    required
                    className="w-full bg-surface-2 border border-beige-kem/30 rounded-lg p-2 text-beige-kem outline-none"
                  />
                </div>
                <div>
                  <label className="block text-ink-soft mb-1">Giá Vé (VND)</label>
                  <input
                    type="number"
                    value={createTierPrice}
                    onChange={(e) => setCreateTierPrice(Number(e.target.value))}
                    step={10000}
                    required
                    className="w-full bg-surface-2 border border-beige-kem/30 rounded-lg p-2 text-beige-kem outline-none font-meta"
                  />
                </div>
                <div>
                  <label className="block text-ink-soft mb-1">Sức Chứa (Capacity)</label>
                  <input
                    type="number"
                    value={createTierCapacity}
                    onChange={(e) => setCreateTierCapacity(Number(e.target.value))}
                    min={1}
                    required
                    className="w-full bg-surface-2 border border-beige-kem/30 rounded-lg p-2 text-beige-kem outline-none font-meta"
                  />
                </div>
              </div>
            </div>

            {/* Form Actions */}
            <div className="flex items-center justify-end space-x-3 pt-4 border-t border-beige-kem/20">
              <button
                type="button"
                onClick={() => setActiveTab("manage")}
                className="px-5 py-2.5 rounded-xl bg-surface-2 hover:bg-beige-kem/10 text-beige-kem font-semibold transition-colors border border-beige-kem/30"
              >
                Hủy & Quay Lại Danh Sách
              </button>
              <button
                type="submit"
                className="px-6 py-2.5 rounded-xl bg-burgundy hover:brightness-110 text-white font-bold transition-all shadow-lg shadow-burgundy/20"
              >
                + Hoàn Tất Tạo Sự Kiện
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
