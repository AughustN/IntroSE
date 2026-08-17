import React from "react";
import { Calendar, CheckCircle2, AlertCircle, Clock, Users } from "lucide-react";
import type { SoonestEventCapacity } from "../../../../shared/types/analytics";

interface Props {
  capacityData: SoonestEventCapacity;
}

export function CapacityGauge({ capacityData }: Props) {
  const {
    has_upcoming_event,
    event_title,
    category,
    start_date,
    sold_tickets = 0,
    total_capacity = 0,
    fill_percentage = 0,
  } = capacityData;

  if (!has_upcoming_event) {
    return (
      <div className="flex flex-col justify-between border-2 border-beige-kem/30 bg-surface-2 p-5 text-beige-kem">
        <div className="flex items-center justify-between border-b border-beige-kem/10 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="bg-beige-kem/15 p-2 text-beige-kem/70">
              <Calendar className="h-5 w-5" />
            </div>
            <h4 className="text-base font-black text-beige-kem">Sự kiện sắp diễn ra</h4>
          </div>
          <span className="bg-beige-kem/10 px-2.5 py-1 text-xs font-bold text-beige-kem/60">
            0% Lấp đầy
          </span>
        </div>

        <div className="my-6 flex flex-col items-center justify-center text-center">
          <div className="mb-3 bg-beige-kem/10 p-3.5 text-beige-kem/60">
            <AlertCircle className="h-6 w-6" />
          </div>
          <p className="text-body font-bold text-beige-kem/90">Không có sự kiện sắp diễn ra</p>
          <p className="mt-1 text-xs text-beige-kem/60 max-w-sm">
            Hiện không có sự kiện ở trạng thái Đang mở bán hoặc Chờ duyệt.
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-beige-kem/60 font-bold">
            <span>Tiến độ bán vé (0/0)</span>
            <span>0%</span>
          </div>
          <div className="h-3 w-full overflow-hidden bg-beige-kem/15">
            <div className="h-full bg-beige-kem/30" style={{ width: "0%" }} />
          </div>
        </div>
      </div>
    );
  }

  const formattedDate = start_date
    ? new Date(start_date).toLocaleDateString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Đang cập nhật";

  const remaining = Math.max(0, total_capacity - sold_tickets);
  const fillPct = Math.min(100, Math.max(0, fill_percentage));

  return (
    <div className="flex flex-col justify-between border-2 border-beige-kem/30 bg-surface-2 p-5 text-beige-kem">
      <div>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-beige-kem/10 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="bg-la-co/20 p-2 text-la-co">
              <Calendar className="h-5 w-5" />
            </div>
            <h4 className="text-base font-black text-beige-kem">Sự kiện sắp diễn ra</h4>
          </div>
          <span className="inline-flex items-center gap-1 bg-la-co/20 px-2.5 py-1 text-xs font-bold text-la-co">
            <CheckCircle2 className="h-3.5 w-3.5" /> Đang mở bán
          </span>
        </div>

        {/* Event Meta */}
        <div className="mt-4 border border-beige-kem/20 bg-xanh-pho p-4">
          <h5 className="text-base font-black text-beige-kem">{event_title}</h5>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-beige-kem/70">
            <span className="flex items-center gap-1 font-medium">
              <Clock className="h-3.5 w-3.5 text-la-co" /> {formattedDate}
            </span>
            {category && (
              <span className="bg-burgundy/20 px-2 py-0.5 font-bold text-burgundy">{category}</span>
            )}
          </div>
        </div>
      </div>

      {/* Capacity Horizontal Progress Bar */}
      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between text-xs font-bold">
          <span className="flex items-center gap-1 text-beige-kem/80">
            <Users className="h-3.5 w-3.5 text-la-co" /> Tiến độ vé (
            {sold_tickets.toLocaleString("vi-VN")}/{total_capacity.toLocaleString("vi-VN")})
          </span>
          <span className="bg-la-co/20 px-2 py-0.5 text-la-co font-black">{fillPct}% lấp đầy</span>
        </div>

        <div className="h-3.5 w-full overflow-hidden bg-beige-kem/20 p-0.5">
          <div
            className="h-full bg-la-co transition-all duration-500"
            style={{ width: `${fillPct}%` }}
          />
        </div>

        <div className="flex justify-between text-[11px] text-beige-kem/60 font-medium pt-1">
          <span>
            Đã bán:{" "}
            <strong className="text-beige-kem">{sold_tickets.toLocaleString("vi-VN")} vé</strong>
          </span>
          <span>
            Còn lại:{" "}
            <strong className="text-cam-dat">{remaining.toLocaleString("vi-VN")} vé</strong>
          </span>
        </div>
      </div>
    </div>
  );
}
