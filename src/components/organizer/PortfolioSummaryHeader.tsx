import React from "react";

interface PortfolioSummaryHeaderProps {
  summary: {
    totalEvents: number;
    draftCount: number;
    pendingCount: number;
    publishedCount: number;
    canceledCount: number;
    completedCount: number;
  };
  activeFilter: string;
  onFilterChange: (status: string) => void;
  onSearchChange: (keyword: string) => void;
  searchTerm: string;
  onCreateEvent: () => void;
}

export const PortfolioSummaryHeader: React.FC<PortfolioSummaryHeaderProps> = ({
  summary,
  activeFilter,
  onFilterChange,
  onSearchChange,
  searchTerm,
  onCreateEvent,
}) => {
  const filterTabs = [
    { key: "all", label: "Tất cả", count: summary.totalEvents },
    { key: "published", label: "Đã đăng", count: summary.publishedCount },
    { key: "pending_review", label: "Chờ duyệt", count: summary.pendingCount },
    { key: "draft", label: "Bản nháp", count: summary.draftCount },
    { key: "canceled", label: "Đã hủy", count: summary.canceledCount },
    { key: "completed", label: "Đã kết thúc", count: summary.completedCount },
  ];

  return (
    <div className="space-y-6">
      {/* Header Title & CTA */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-black text-burgundy-ink tracking-tight">
            Quản Lý Sự Kiện Ban Tổ Chức
          </h1>
          <p className="font-meta text-xs text-ink-soft mt-1">
            Theo dõi tổng quan danh mục sự kiện, sức chứa, doanh thu và phê duyệt xuất bản.
          </p>
        </div>

        <button
          onClick={onCreateEvent}
          className="inline-flex items-center justify-center px-4 py-2.5 text-xs font-bold bg-burgundy hover:brightness-110 text-white transition-all flex-shrink-0"
        >
          <span className="mr-1.5 text-base">+</span> Tạo Sự Kiện Mới
        </button>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-surface-2 p-3 border border-beige-kem/25">
        {/* Status Tabs */}
        <div className="flex items-center space-x-1 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
          {filterTabs.map((tab) => {
            const isActive = activeFilter === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => onFilterChange(tab.key)}
                className={`px-3 py-1.5 text-xs font-bold whitespace-nowrap transition-colors flex items-center space-x-1.5 ${
                  isActive
                    ? "border border-la-co bg-la-co/25 text-beige-kem"
                    : "text-ink-soft hover:text-beige-kem hover:bg-beige-kem/10"
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`px-1.5 py-0.2 text-[10px] ${
                    isActive ? "bg-beige-kem/15 text-beige-kem" : "bg-xanh-pho text-ink-soft"
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search Bar */}
        <div className="relative md:w-64">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Tìm kiếm sự kiện, địa điểm..."
            className="w-full bg-xanh-pho border border-beige-kem/30 focus:border-burgundy text-beige-kem placeholder-ink-soft text-xs px-3 py-2 outline-none transition-colors font-meta"
          />
          {searchTerm && (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-2.5 top-2 text-ink-soft hover:text-beige-kem text-xs"
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
