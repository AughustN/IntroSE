/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatVnd } from "../../services/currency";
import { EmptyState } from "./adminUi";
import type { ActivityPoint, CategorySlice, DayPoint } from "../../../shared/admin/types";
import type { AdPackageSales } from "../../../shared/ads/types";

/**
 * The console's charts, drawn by recharts instead of the old static bar strip.
 *
 * The organiser dashboard already proved the interactive pattern — hover a point, read the exact
 * figure in a tooltip — and the admin console was the only place still plotting dead columns. The
 * data shape is the console's own (`DayPoint`, `CategorySlice`); only the drawing changed.
 *
 * Colours stay the palette's: burgundy for the money series, the tint cycle for the pie slices,
 * and `ink-soft` for axis type, so the charts read as part of this screen rather than as a library
 * dropped onto it.
 */

/** Axis and tooltip type: the muted ink the console already uses for secondary text. */
const AXIS_INK = "#b4566a";
const TOOLTIP_SURFACE = "#fffcf5";
const TOOLTIP_BORDER = "rgba(138, 12, 36, 0.25)";

/** The palette's fill cycle, in the order the console's accents run. */
const SLICE_COLORS = ["#d93025", "#897523", "#f19502", "#b4566a", "#8a0c24", "#fbd0dc"];

/** `2025-03-08` → `08/03`, the way the reader says a date. */
const shortDay = (day: string) => {
  const parts = day.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : day;
};

/** Millions and billions keep the axis readable without a second currency formatter. */
function shortVnd(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return `${value}`;
}

const tooltipStyle = {
  backgroundColor: TOOLTIP_SURFACE,
  border: `1px solid ${TOOLTIP_BORDER}`,
  borderRadius: 0,
  fontFamily: "inherit",
  fontSize: 13,
};

/**
 * Daily revenue as an interactive area chart: hover any day for its exact figure.
 *
 * Replaces `MiniBars`, which could only offer a `title` attribute and a guess at the scale.
 *
 * `label` names the series in the tooltip because the same chart plots three different quantities:
 * the overview's total earnings (commission **and** advertising), the analytics screen's ticket
 * commission alone, and the ads screen's advertising alone. One hardcoded caption would be wrong on
 * two of the three screens.
 *
 * Typed on the two fields it actually plots rather than on `DayPoint`, so a series that carries no
 * ticket count — advertising has purchases, not tickets — can be drawn without inventing one.
 *
 * `endDay` is what lets one component draw both cadences. A point with one carries a RANGE, and the
 * tooltip names both ends of it — a bucket labelled with only its first day reads as a figure for
 * that day, which is wrong by a factor of seven.
 */
export function RevenueAreaChart({
  points,
  label = "Doanh thu",
}: {
  points: Array<Pick<DayPoint, "day" | "amount"> & { endDay?: string }>;
  label?: string;
}) {
  if (points.length === 0) return <EmptyState text="Chưa có dữ liệu trong khoảng này." />;

  const data = points.map((point) => ({ ...point, label: shortDay(point.day) }));

  return (
    <div className="h-64 w-full" role="img" aria-label={`${label} theo thời gian`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="adminRevenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#d93025" stopOpacity={0.45} />
              <stop offset="95%" stopColor="#d93025" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(138, 12, 36, 0.12)" vertical={false} />
          <XAxis
            dataKey="label"
            stroke={AXIS_INK}
            fontSize={11}
            tickLine={false}
            axisLine={{ stroke: "rgba(138, 12, 36, 0.25)" }}
            minTickGap={24}
          />
          <YAxis
            stroke={AXIS_INK}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tickFormatter={shortVnd}
            width={44}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            labelStyle={{ color: "#8a0c24", fontWeight: 700 }}
            labelFormatter={(label, payload) => {
              const point = payload?.[0]?.payload as { day?: string; endDay?: string } | undefined;
              if (!point?.day) return String(label);
              return point.endDay ? `${point.day} → ${point.endDay}` : point.day;
            }}
            formatter={(value) => [formatVnd(Number(value)), label]}
          />
          <Area
            type="monotone"
            dataKey="amount"
            stroke="#d93025"
            strokeWidth={2}
            fill="url(#adminRevenueFill)"
            activeDot={{ r: 4, fill: "#d93025", stroke: TOOLTIP_SURFACE }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Advertising revenue per package, as bars.
 *
 * Bars rather than a donut because the question here is "which package earns most", a comparison of
 * magnitudes against a common baseline — and because there are only three of them, so a pie would
 * spend a whole panel saying what three numbers say.
 */
export function PackageSalesChart({ packages }: { packages: AdPackageSales[] }) {
  if (packages.length === 0) return <EmptyState text="Chưa có gói quảng cáo nào được bán." />;

  return (
    <div className="h-56 w-full" role="img" aria-label="Doanh thu theo gói quảng cáo">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={packages} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(138, 12, 36, 0.12)" vertical={false} />
          <XAxis
            dataKey="name"
            stroke={AXIS_INK}
            fontSize={11}
            tickLine={false}
            axisLine={{ stroke: "rgba(138, 12, 36, 0.25)" }}
          />
          <YAxis
            stroke={AXIS_INK}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tickFormatter={shortVnd}
            width={44}
          />
          <Tooltip
            cursor={{ fill: "rgba(138, 12, 36, 0.06)" }}
            contentStyle={tooltipStyle}
            labelStyle={{ color: "#8a0c24", fontWeight: 700 }}
            formatter={(value, _name, entry) => [
              `${formatVnd(Number(value))} · ${(entry?.payload as AdPackageSales | undefined)?.purchases ?? 0} lượt mua`,
              "Doanh thu 30 ngày",
            ]}
          />
          <Bar dataKey="revenue" radius={0}>
            {packages.map((row, index) => (
              <Cell key={row.code} fill={SLICE_COLORS[index % SLICE_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * DAU against MAU, as two lines over the last thirty days.
 *
 * The console's every other figure begins at a transaction, which measures conversion and calls it
 * traffic. These two come from `user_activity_days` (0035): one row per user per day they were on
 * the site at all.
 *
 * Two lines on ONE axis, deliberately, even though MAU dwarfs DAU. The distance between them is the
 * chart's whole subject — a monthly audience that shows up daily converges, one that visits once a
 * month spreads — and a second axis scaled to flatter the smaller series would erase exactly that.
 * The stickiness figure below states the ratio outright rather than making anybody eyeball it.
 */
export function ActiveUsersLineChart({ points }: { points: ActivityPoint[] }) {
  if (points.length === 0) return <EmptyState text="Chưa có dữ liệu truy cập." />;

  const data = points.map((point) => ({ ...point, label: shortDay(point.day) }));
  const latest = points[points.length - 1]!;
  const stickiness = latest.mau === 0 ? 0 : Math.round((latest.dau / latest.mau) * 100);

  return (
    <div className="space-y-3">
      <div className="h-56 w-full" role="img" aria-label="Người dùng hoạt động theo ngày">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(138, 12, 36, 0.12)"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              stroke={AXIS_INK}
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: "rgba(138, 12, 36, 0.25)" }}
              minTickGap={24}
            />
            <YAxis
              stroke={AXIS_INK}
              fontSize={11}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={40}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={{ color: "#8a0c24", fontWeight: 700 }}
              labelFormatter={(label, payload) => payload?.[0]?.payload?.day ?? String(label)}
              formatter={(value, name) => [
                `${Number(value).toLocaleString("vi-VN")} người`,
                name === "dau" ? "Hoạt động trong ngày" : "Hoạt động 30 ngày",
              ]}
            />
            <Line
              type="monotone"
              dataKey="mau"
              stroke="#897523"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "#897523", stroke: TOOLTIP_SURFACE }}
            />
            <Line
              type="monotone"
              dataKey="dau"
              stroke="#d93025"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "#d93025", stroke: TOOLTIP_SURFACE }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap gap-2">
        <LegendPill
          color="#d93025"
          label="DAU · trong ngày"
          value={latest.dau.toLocaleString("vi-VN")}
        />
        <LegendPill
          color="#897523"
          label="MAU · 30 ngày"
          value={latest.mau.toLocaleString("vi-VN")}
        />
        {/* DAU/MAU: of everyone who used the site this month, the share who used it today. */}
        <LegendPill color="#f19502" label="Độ gắn bó" value={`${stickiness}%`} />
      </div>
    </div>
  );
}

/** The swatch-label-figure chip the donuts already use, shared so the panels match. */
function LegendPill({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 border border-beige-kem/25 px-2 py-1 font-meta text-meta">
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0"
        style={{ backgroundColor: color }}
      />
      <span className="text-beige-kem">{label}</span>
      <span className="tabular-nums text-ink-soft">{value}</span>
    </span>
  );
}

/**
 * Where the platform's money came from: ticket commission against advertising.
 *
 * Replaces the sentence the revenue tile used to append to itself. The two streams are earned on
 * completely different terms — 5% of somebody else's sale versus 100% of the site's own — so the
 * question "how much of this is ours outright" is worth a shape rather than a clause, and the
 * shares matter more here than the absolute figures the tile above already gives.
 */
export function RevenueSplitChart({ commission, ads }: { commission: number; ads: number }) {
  const total = commission + ads;
  if (total <= 0) return <EmptyState text="Chưa có doanh thu trong 30 ngày." />;

  const slices = [
    { key: "commission", label: "Hoa hồng vé (5%)", value: commission, color: "#d93025" },
    { key: "ads", label: "Gói quảng cáo", value: ads, color: "#f19502" },
  ];

  return (
    <div className="space-y-3">
      <div className="h-52 w-full" role="img" aria-label="Cơ cấu doanh thu">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={48}
              outerRadius={80}
              paddingAngle={3}
              stroke="none"
            >
              {slices.map((slice) => (
                <Cell key={slice.key} fill={slice.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value, name) => [
                `${formatVnd(Number(value))} · ${Math.round((Number(value) / total) * 100)}%`,
                name,
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap gap-2">
        {slices.map((slice) => (
          <span
            key={slice.key}
            className="inline-flex items-center gap-1.5 border border-beige-kem/25 px-2 py-1 font-meta text-meta"
          >
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0"
              style={{ backgroundColor: slice.color }}
            />
            <span className="text-beige-kem">{slice.label}</span>
            <span className="tabular-nums text-ink-soft">
              {formatVnd(slice.value)} · {Math.round((slice.value / total) * 100)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Tickets by category as an interactive donut: hover a slice for its count and share.
 *
 * Replaces the ruled share rows. The legend pills underneath keep the words beside the colours —
 * a pie you can only read by hovering is a pie that hides its own answer.
 */
export function CategoryDonutChart({ slices }: { slices: CategorySlice[] }) {
  if (slices.length === 0) return <EmptyState text="Chưa bán được vé nào trong 30 ngày." />;

  const total = slices.reduce((sum, slice) => sum + slice.tickets, 0);

  return (
    <div className="space-y-3">
      <div className="h-52 w-full" role="img" aria-label="Vé theo danh mục">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="tickets"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={48}
              outerRadius={80}
              paddingAngle={3}
              stroke="none"
            >
              {slices.map((slice, index) => (
                <Cell key={slice.code} fill={SLICE_COLORS[index % SLICE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value, name) => {
                const share = total === 0 ? 0 : Math.round((Number(value) / total) * 100);
                return [`${Number(value).toLocaleString("vi-VN")} vé · ${share}%`, name];
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap gap-2">
        {slices.map((slice, index) => {
          const share = total === 0 ? 0 : Math.round((slice.tickets / total) * 100);
          return (
            <span
              key={slice.code}
              className="inline-flex items-center gap-1.5 border border-beige-kem/25 px-2 py-1 font-meta text-meta"
            >
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0"
                style={{ backgroundColor: SLICE_COLORS[index % SLICE_COLORS.length] }}
              />
              <span className="text-beige-kem">{slice.label}</span>
              <span className="tabular-nums text-ink-soft">
                {slice.tickets.toLocaleString("vi-VN")} vé · {share}%
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
