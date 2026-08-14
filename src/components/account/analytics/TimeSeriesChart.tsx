import React from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { RefreshCw, TrendingUp } from "lucide-react";
import type { DatePeriodFilter, TimeSeriesSalesPoint } from "../../../../shared/types/analytics";

interface Props {
  data: TimeSeriesSalesPoint[];
  period?: DatePeriodFilter;
  onPeriodChange?: (p: DatePeriodFilter) => void;
  onRefresh?: () => void;
  loading?: boolean;
}

function formatShortVND(val: number): string {
  if (val >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(1)}B`;
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(0)}k`;
  return `${val} ₫`;
}

export function TimeSeriesChart({ data, period, onPeriodChange, onRefresh, loading }: Props) {
  return (
    <div className="rounded-2xl border-2 border-beige-kem/30 bg-surface-2 p-5 text-beige-kem shadow-md">
      {/* Header with Title & Period Selector / Refresh controls */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-beige-kem/10 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="rounded-xl bg-burgundy/20 p-2 text-burgundy">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-base font-black text-beige-kem">Thống kê doanh số (Sales Analytics)</h4>
            <p className="text-xs text-beige-kem/60">Xu hướng doanh thu & lượt vé bán ra theo thời gian</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {period && onPeriodChange && (
            <select
              value={period}
              onChange={(e) => onPeriodChange(e.target.value as DatePeriodFilter)}
              className="h-8 rounded-lg border border-beige-kem/40 bg-surface-2 px-2.5 text-xs font-bold text-beige-kem outline-none transition focus:border-burgundy cursor-pointer"
            >
              <option value="7d">7 ngày gần đây</option>
              <option value="this_month">Tháng này</option>
              <option value="custom">Tùy chỉnh</option>
            </select>
          )}

          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-beige-kem/40 text-beige-kem/80 transition hover:border-beige-kem hover:text-beige-kem disabled:opacity-50"
              title="Làm mới biểu đồ"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-burgundy" : ""}`} />
            </button>
          )}
        </div>
      </div>

      {/* Chart Canvas or Empty State */}
      {!data || data.length === 0 ? (
        <div className="flex h-72 flex-col items-center justify-center rounded-xl border border-dashed border-beige-kem/30 bg-beige-kem/5 p-6 text-center text-beige-kem/70">
          <p className="text-body font-bold">Chưa có dữ liệu xu hướng doanh thu</p>
          <p className="mt-1 text-xs text-beige-kem/50">Dữ liệu sẽ xuất hiện khi có lượt mua vé trong khoảng thời gian này.</p>
        </div>
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#d93025" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#d93025" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorTickets" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#bfc0f2" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#bfc0f2" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff15" />
              <XAxis dataKey="label" stroke="#fdf6ea" fontSize={11} tickLine={false} />
              <YAxis yAxisId="left" stroke="#fdf6ea" fontSize={11} tickFormatter={formatShortVND} />
              <YAxis yAxisId="right" orientation="right" stroke="#bfc0f2" fontSize={11} />
              <Tooltip
                contentStyle={{ backgroundColor: "#3d0d1a", borderColor: "#fdf6ea30", borderRadius: "12px", boxShadow: "0 4px 12px rgba(0,0,0,0.3)" }}
                labelStyle={{ color: "#fdf6ea", fontWeight: "bold" }}
                formatter={(value: any, name: any) => {
                  if (name === "Doanh thu kỳ này") return [new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(value), name];
                  return [`${value} vé`, name];
                }}
              />
              <Legend wrapperStyle={{ paddingTop: 10, fontSize: "12px" }} />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="current_revenue_vnd"
                name="Doanh thu kỳ này"
                stroke="#d93025"
                fillOpacity={1}
                fill="url(#colorRev)"
                strokeWidth={2.5}
              />
              <Area
                yAxisId="right"
                type="monotone"
                dataKey="current_tickets_sold"
                name="Vé bán kỳ này"
                stroke="#bfc0f2"
                fillOpacity={1}
                fill="url(#colorTickets)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
