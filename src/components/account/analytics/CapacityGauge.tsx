import React from "react";
import { AlertCircle } from "lucide-react";
import type { SoonestEventCapacity } from "../../../../shared/types/analytics";

interface Props {
  capacityData: SoonestEventCapacity;
}

function shortDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
}

/**
 * The soonest showtime's fill, as one bar — the question is "how full is the next night?", which a
 * fraction bar answers without a meta card getting in the way.
 */
export function CapacityGauge({ capacityData }: Props) {
  const {
    has_upcoming_event,
    event_title,
    start_date,
    sold_tickets = 0,
    total_capacity = 0,
    fill_percentage = 0,
  } = capacityData;

  if (!has_upcoming_event) {
    return (
      <div className="border-2 border-beige-kem/30 bg-surface-2 p-5 text-beige-kem">
        <div className="flex items-center justify-between border-b border-beige-kem/20 pb-3">
          <h4 className="font-display text-base font-black text-beige-kem">
            Sức chứa suất gần nhất
          </h4>
        </div>
        <div className="mt-4 flex flex-col items-center justify-center py-6 text-center">
          <AlertCircle className="h-6 w-6 text-beige-kem/60" />
          <p className="mt-2 text-sm font-bold text-beige-kem/90">Không có sự kiện sắp diễn ra</p>
          <p className="mt-1 text-xs text-beige-kem/60 max-w-sm">
            Hiện không có sự kiện ở trạng thái Đang mở bán hoặc Chờ duyệt.
          </p>
        </div>
      </div>
    );
  }

  const remaining = Math.max(0, total_capacity - sold_tickets);
  const fillPct = Math.min(100, Math.max(0, fill_percentage));
  const dateLabel = shortDate(start_date);

  return (
    <div className="border-2 border-beige-kem/30 bg-surface-2 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-beige-kem/20 pb-3">
        <h4 className="font-display text-base font-black text-beige-kem">Sức chứa suất gần nhất</h4>
        <span className="max-w-[50%] truncate font-meta text-meta text-ink-soft">
          {event_title}
          {dateLabel ? ` · ${dateLabel}` : ""}
        </span>
      </div>

      <div className="mt-4 flex items-center gap-6">
        <div className="min-w-0 flex-1">
          <div className="h-4 w-full border border-beige-kem/25 bg-xanh-pho">
            <div
              className="h-full bg-la-co transition-all duration-500"
              style={{ width: `${fillPct}%` }}
            />
          </div>
          <p className="mt-2 font-meta text-meta text-beige-kem/70">
            {sold_tickets.toLocaleString("vi-VN")} / {total_capacity.toLocaleString("vi-VN")} ghế đã
            bán · còn {remaining.toLocaleString("vi-VN")} ghế
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-display text-title-m font-black text-la-co">{fillPct}%</div>
          <div className="font-meta text-meta text-beige-kem/60">lấp đầy</div>
        </div>
      </div>
    </div>
  );
}
