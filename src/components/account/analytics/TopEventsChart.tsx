import React from "react";
import type { EventRevenueRankingItem } from "../../../../shared/types/analytics";

interface Props {
  data: EventRevenueRankingItem[];
}

function formatVND(amount: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** The top earners, one line each — revenue beside the name, a bar describing the ratio. */
export function TopEventsChart({ data }: Props) {
  const maxRevenue = Math.max(1, ...data.map((i) => i.gross_revenue_vnd));

  return (
    <div className="border-2 border-beige-kem/30 bg-surface-2 p-5 text-beige-kem">
      <h4 className="border-b border-beige-kem/20 pb-3 font-display text-base font-black text-beige-kem">
        Sự kiện bán chạy
      </h4>

      {!data || data.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center border border-dashed border-beige-kem/30 p-6 text-center text-beige-kem/60">
          <p className="text-body font-bold">Chưa có xếp hạng sự kiện</p>
          <p className="mt-1 text-xs text-beige-kem/50">
            Tạo sự kiện và bán vé để theo dõi các sự kiện dẫn đầu.
          </p>
        </div>
      ) : (
        <ul className="mt-3 space-y-3">
          {data.map((item) => (
            <li key={item.event_id}>
              <div className="flex justify-between gap-3 font-meta text-meta text-beige-kem">
                <span className="min-w-0 truncate">{item.event_title}</span>
                <span className="shrink-0 tabular-nums">{formatVND(item.gross_revenue_vnd)}</span>
              </div>
              <div className="mt-1 h-2 w-full border border-beige-kem/20 bg-xanh-pho">
                <div
                  className="h-full bg-burgundy transition-all duration-500"
                  style={{ width: `${Math.max(4, (item.gross_revenue_vnd / maxRevenue) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
