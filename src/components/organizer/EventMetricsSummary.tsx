import React from "react";

interface EventMetricsSummaryProps {
  metrics: {
    totalCapacity: number;
    soldTickets: number;
    remainingTickets: number;
    totalRevenueVnd: number;
  };
}

export const EventMetricsSummary: React.FC<EventMetricsSummaryProps> = ({ metrics }) => {
  const formatVND = (amount: number) => {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);
  };

  const selloutPercentage =
    metrics.totalCapacity > 0
      ? Math.round((metrics.soldTickets / metrics.totalCapacity) * 100)
      : 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Metric 1: Sold Tickets */}
      <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-xl space-y-2">
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <span>Vé đã bán</span>
          <span>🎟️</span>
        </div>
        <div className="text-2xl font-bold text-white">
          {metrics.soldTickets}{" "}
          <span className="text-sm font-normal text-zinc-500">/ {metrics.totalCapacity}</span>
        </div>
        <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
          <div
            className="bg-amber-500 h-full rounded-full transition-all duration-300"
            style={{ width: `${selloutPercentage}%` }}
          />
        </div>
        <div className="text-[10px] text-zinc-500 text-right">{selloutPercentage}% đã bán</div>
      </div>

      {/* Metric 2: Remaining Inventory */}
      <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-xl space-y-2">
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <span>Vé còn lại</span>
          <span>📦</span>
        </div>
        <div className="text-2xl font-bold text-amber-400">{metrics.remainingTickets}</div>
        <p className="text-[11px] text-zinc-500">Sức chứa khả dụng cho sự kiện này.</p>
      </div>

      {/* Metric 3: Gross Revenue */}
      <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-xl space-y-2">
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <span>Tổng doanh thu (VND)</span>
          <span>💰</span>
        </div>
        <div className="text-2xl font-bold text-emerald-400">
          {formatVND(metrics.totalRevenueVnd)}
        </div>
        <p className="text-[11px] text-zinc-500">Tính theo đơn giá từng hạng vé (VND nguyên).</p>
      </div>

      {/* Metric 4: Capacity Rate */}
      <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-xl space-y-2">
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <span>Tỷ lệ lấp đầy</span>
          <span>📊</span>
        </div>
        <div className="text-2xl font-bold text-blue-400">{selloutPercentage}%</div>
        <p className="text-[11px] text-zinc-500">
          {selloutPercentage >= 90 ? "🔥 Gần cháy vé" : "Đang mở bán trực tuyến"}
        </p>
      </div>
    </div>
  );
};
