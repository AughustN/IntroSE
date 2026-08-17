import React from "react";
import { formatVnd } from "../../services/currency";

interface EventMetricsSummaryProps {
  metrics: {
    totalCapacity: number;
    soldTickets: number;
    remainingTickets: number;
    totalRevenueVnd: number;
  };
}

/**
 * The four figures at the top of an event.
 *
 * These cards used to be built from `zinc-900` fills and `text-white`, a dark theme hard-coded into
 * components that sit on a page which is cream in light mode. The result was a slab of night in the
 * middle of a daylight page — and every label on it was a colour the rest of the site never uses.
 * Everything here now reads from the palette, so the cards follow whichever theme the reader chose.
 */
export const EventMetricsSummary: React.FC<EventMetricsSummaryProps> = ({ metrics }) => {
  const selloutPercentage =
    metrics.totalCapacity > 0 ? Math.round((metrics.soldTickets / metrics.totalCapacity) * 100) : 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="space-y-2 border border-beige-kem/25 bg-surface-2 p-5">
        <div className="flex items-center justify-between font-meta text-meta text-ink-soft">
          <span>Vé đã bán</span>
          <span aria-hidden>🎟️</span>
        </div>
        <div className="font-display text-title-s font-black tabular-nums text-beige-kem">
          {metrics.soldTickets}{" "}
          <span className="font-meta text-meta font-normal text-ink-soft">
            / {metrics.totalCapacity}
          </span>
        </div>
        {/* The track is the ink at low opacity, so the bar keeps its contrast in both themes. */}
        <div className="h-1.5 w-full overflow-hidden bg-beige-kem/15">
          <div
            className="h-full bg-cam-dat transition-all duration-300"
            style={{ width: `${selloutPercentage}%` }}
          />
        </div>
        <div className="text-right font-meta text-meta text-ink-soft">
          {selloutPercentage}% đã bán
        </div>
      </div>

      <div className="space-y-2 border border-beige-kem/25 bg-surface-2 p-5">
        <div className="flex items-center justify-between font-meta text-meta text-ink-soft">
          <span>Vé còn lại</span>
          <span aria-hidden>📦</span>
        </div>
        <div className="font-display text-title-s font-black tabular-nums text-beige-kem">
          {metrics.remainingTickets}
        </div>
        <p className="font-meta text-meta text-ink-soft">Sức chứa khả dụng cho sự kiện này.</p>
      </div>

      <div className="space-y-2 border border-beige-kem/25 bg-surface-2 p-5">
        <div className="flex items-center justify-between font-meta text-meta text-ink-soft">
          <span>Tổng doanh thu</span>
          <span aria-hidden>💰</span>
        </div>
        <div className="font-display text-title-s font-black tabular-nums text-beige-kem">
          {formatVnd(metrics.totalRevenueVnd)}
        </div>
        {/* Said plainly, because it is not the platform's own revenue figure: it multiplies each
            tier's list price by what sold, and knows nothing about refunds. */}
        <p className="font-meta text-meta text-ink-soft">
          Tính theo đơn giá từng hạng vé, chưa trừ vé đã hoàn.
        </p>
      </div>

      <div className="space-y-2 border border-beige-kem/25 bg-surface-2 p-5">
        <div className="flex items-center justify-between font-meta text-meta text-ink-soft">
          <span>Tỷ lệ lấp đầy</span>
          <span aria-hidden>📊</span>
        </div>
        <div className="font-display text-title-s font-black tabular-nums text-beige-kem">
          {selloutPercentage}%
        </div>
        <p className="font-meta text-meta text-ink-soft">
          {selloutPercentage >= 90 ? "🔥 Gần cháy vé" : "Đang mở bán trực tuyến"}
        </p>
      </div>
    </div>
  );
};
