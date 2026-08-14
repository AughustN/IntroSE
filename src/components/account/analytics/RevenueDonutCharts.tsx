import React from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { PieChart as PieChartIcon } from "lucide-react";
import type { AnalyticsBreakdowns } from "../../../../shared/types/analytics";

interface Props {
  breakdowns: AnalyticsBreakdowns;
}

const TIER_COLORS = ["#d93025", "#f7a97c", "#bfc0f2", "#fbd0dc", "#8a0c24"];
const CATEGORY_COLORS = ["#bfc0f2", "#d93025", "#f7a97c", "#b4566a", "#fbd0dc"];

function formatVND(val: number): string {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(val);
}

export function RevenueDonutCharts({ breakdowns }: Props) {
  const { by_tier, by_category } = breakdowns;

  return (
    <div className="flex flex-col gap-5 rounded-2xl border-2 border-beige-kem/30 bg-surface-2 p-5 text-beige-kem shadow-md">
      {/* Side Panel Header */}
      <div className="flex items-center gap-2.5 border-b border-beige-kem/10 pb-3">
        <div className="rounded-xl bg-cam-dat/20 p-2 text-cam-dat">
          <PieChartIcon className="h-5 w-5" />
        </div>
        <div>
          <h4 className="text-base font-black text-beige-kem">Cơ cấu doanh thu</h4>
          <p className="text-xs text-beige-kem/60">Tỷ trọng doanh thu hạng vé & danh mục</p>
        </div>
      </div>

      {/* 1. Revenue by Ticket Tier */}
      <div className="rounded-xl border border-beige-kem/20 bg-ink-dark/40 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h5 className="text-xs font-bold uppercase tracking-wider text-beige-kem/80">Theo Hạng Vé</h5>
          <span className="text-[11px] font-bold text-la-co">{by_tier.length} hạng vé</span>
        </div>

        <div className="h-44 w-full">
          {by_tier.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-beige-kem/50">
              <p className="text-xs font-medium">Chưa có dữ liệu hạng vé</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={by_tier}
                  dataKey="revenue_vnd"
                  nameKey="tier_name"
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={65}
                  paddingAngle={4}
                >
                  {by_tier.map((entry, index) => (
                    <Cell key={`tier-${entry.tier_name}`} fill={TIER_COLORS[index % TIER_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: "#3d0d1a", borderColor: "#fdf6ea30", borderRadius: "12px" }}
                  formatter={(val: any) => [formatVND(val), "Doanh thu"]}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Legend pills */}
        {by_tier.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {by_tier.map((t, idx) => (
              <div key={t.tier_name} className="flex items-center gap-1.5 rounded-lg bg-beige-kem/10 px-2 py-1 text-[11px]">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: TIER_COLORS[idx % TIER_COLORS.length] }}
                />
                <span className="font-bold text-beige-kem">{t.tier_name}</span>
                <span className="text-beige-kem/60">({t.percentage_share}%)</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 2. Revenue by Event Category */}
      <div className="rounded-xl border border-beige-kem/20 bg-ink-dark/40 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h5 className="text-xs font-bold uppercase tracking-wider text-beige-kem/80">Theo Thể Loại</h5>
          <span className="text-[11px] font-bold text-cam-dat">{by_category.length} thể loại</span>
        </div>

        <div className="h-44 w-full">
          {by_category.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-beige-kem/50">
              <p className="text-xs font-medium">Chưa có dữ liệu thể loại</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={by_category}
                  dataKey="revenue_vnd"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={65}
                  paddingAngle={4}
                >
                  {by_category.map((entry, index) => (
                    <Cell key={`cat-${entry.category}`} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: "#3d0d1a", borderColor: "#fdf6ea30", borderRadius: "12px" }}
                  formatter={(val: any) => [formatVND(val), "Doanh thu"]}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Legend pills */}
        {by_category.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {by_category.map((c, idx) => (
              <div key={c.category} className="flex items-center gap-1.5 rounded-lg bg-beige-kem/10 px-2 py-1 text-[11px]">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: CATEGORY_COLORS[idx % CATEGORY_COLORS.length] }}
                />
                <span className="font-bold text-beige-kem">{c.category}</span>
                <span className="text-beige-kem/60">({c.percentage_share}%)</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
