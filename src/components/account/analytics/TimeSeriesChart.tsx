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
import type { TimeSeriesSalesPoint } from "../../../../shared/types/analytics";

interface Props {
  data: TimeSeriesSalesPoint[];
}

function formatShortVND(val: number): string {
  if (val >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(1)}B`;
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(0)}k`;
  return `${val} ₫`;
}

export function TimeSeriesChart({ data }: Props) {
  // The bar the chart spans, stated once in the header — the period is already chosen in the filter
  // bar above, so repeating a selector here would be a second opinion about the same question.
  const rangeLabel =
    data.length > 0
      ? `${new Date(data[0].date).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })} – ${new Date(
          data[data.length - 1].date,
        ).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })}`
      : null;

  return (
    <div className="border-2 border-beige-kem/30 bg-surface-2 p-5 text-beige-kem">
      <div className="mb-4 flex items-center justify-between border-b border-beige-kem/20 pb-3">
        <h4 className="font-display text-base font-black text-beige-kem">
          Doanh thu & vé bán theo ngày
        </h4>
        {rangeLabel && <span className="font-meta text-meta text-ink-soft">{rangeLabel}</span>}
      </div>

      {/* Chart Canvas or Empty State */}
      {!data || data.length === 0 ? (
        <div className="flex h-72 flex-col items-center justify-center border border-dashed border-beige-kem/30 bg-beige-kem/5 p-6 text-center text-beige-kem/70">
          <p className="text-body font-bold">Chưa có dữ liệu xu hướng doanh thu</p>
          <p className="mt-1 text-xs text-beige-kem/50">
            Dữ liệu sẽ xuất hiện khi có lượt mua vé trong khoảng thời gian này.
          </p>
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
                  <stop offset="5%" stopColor="#f19502" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#f19502" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff15" />
              <XAxis dataKey="label" stroke="#fdf6ea" fontSize={11} tickLine={false} />
              <YAxis yAxisId="left" stroke="#fdf6ea" fontSize={11} tickFormatter={formatShortVND} />
              <YAxis yAxisId="right" orientation="right" stroke="#f19502" fontSize={11} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#3d0d1a",
                  borderColor: "#fdf6ea30",
                  borderRadius: "12px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                }}
                labelStyle={{ color: "#fdf6ea", fontWeight: "bold" }}
                formatter={(value: any, name: any) => {
                  if (name === "Doanh thu kỳ này")
                    return [
                      new Intl.NumberFormat("vi-VN", {
                        style: "currency",
                        currency: "VND",
                        maximumFractionDigits: 0,
                      }).format(value),
                      name,
                    ];
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
                stroke="#f19502"
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
