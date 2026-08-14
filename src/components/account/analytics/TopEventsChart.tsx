import React from "react";
import { Award, Ticket, Flame } from "lucide-react";
import type { EventRevenueRankingItem } from "../../../../shared/types/analytics";

interface Props {
  data: EventRevenueRankingItem[];
}

function formatVND(amount: number): string {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(amount);
}

const RANK_BADGE_COLORS = [
  "bg-cam-dat text-ink-dark font-black", // #1 Gold / Peach
  "bg-la-co text-ink-dark font-black",   // #2 Periwinkle
  "bg-bubblegum text-ink-dark font-black", // #3 Bubblegum
  "bg-beige-kem/20 text-beige-kem font-bold",
  "bg-beige-kem/20 text-beige-kem font-bold",
];

const BAR_PROGRESS_COLORS = [
  "bg-burgundy",
  "bg-cam-dat",
  "bg-la-co",
  "bg-bubblegum",
  "bg-beige-kem/60",
];

export function TopEventsChart({ data }: Props) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border-2 border-beige-kem/30 bg-surface-2 p-5 text-beige-kem shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-beige-kem/10 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="rounded-xl bg-burgundy/20 p-2 text-burgundy">
            <Flame className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-base font-black text-beige-kem">Top sự kiện (Top Events)</h4>
            <p className="text-xs text-beige-kem/60">Xếp hạng sự kiện theo doanh thu & lượng vé</p>
          </div>
        </div>
        <span className="rounded-full bg-burgundy/20 px-2.5 py-1 text-xs font-bold text-burgundy">
          Top {data?.length || 0}
        </span>
      </div>

      {/* Empty State */}
      {!data || data.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-beige-kem/30 p-6 text-center text-beige-kem/60">
          <Award className="h-8 w-8 mb-2 text-beige-kem/40" />
          <p className="text-body font-bold">Chưa có xếp hạng sự kiện</p>
          <p className="mt-1 text-xs text-beige-kem/50">Tạo sự kiện và bán vé để theo dõi các sự kiện dẫn đầu.</p>
        </div>
      ) : (
        /* Ranked List Items */
        <div className="space-y-3">
          {data.map((item, index) => {
            const fillPct = Math.min(100, Math.max(0, item.fill_percentage || 0));
            const barColor = BAR_PROGRESS_COLORS[index % BAR_PROGRESS_COLORS.length];
            const badgeColor = RANK_BADGE_COLORS[index % RANK_BADGE_COLORS.length] || RANK_BADGE_COLORS[3];

            return (
              <div
                key={item.event_id}
                className="group relative flex flex-col gap-2 rounded-xl border border-beige-kem/20 bg-ink-dark/40 p-3.5 transition hover:border-beige-kem/50 hover:bg-ink-dark/60"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5">
                    {/* Rank Badge */}
                    <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${badgeColor}`}>
                      #{index + 1}
                    </span>

                    <div>
                      <h5 className="text-xs font-black text-beige-kem line-clamp-1 group-hover:text-la-co transition">
                        {item.event_title}
                      </h5>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-beige-kem/60">
                        {item.category && (
                          <span className="rounded bg-beige-kem/10 px-1.5 py-0.5 font-bold text-beige-kem/80">
                            {item.category}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Ticket className="h-3 w-3 text-la-co" />
                          {item.tickets_sold.toLocaleString("vi-VN")}/{item.total_capacity.toLocaleString("vi-VN")} vé
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Revenue Value */}
                  <div className="text-right shrink-0">
                    <span className="text-xs font-black text-la-co">
                      {formatVND(item.gross_revenue_vnd)}
                    </span>
                    <span className="block text-[10px] text-beige-kem/60 font-bold">
                      {fillPct}% lấp đầy
                    </span>
                  </div>
                </div>

                {/* Capacity / Revenue Progress Bar */}
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-beige-kem/15">
                  <div
                    className={`h-full ${barColor} transition-all duration-500`}
                    style={{ width: `${fillPct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
