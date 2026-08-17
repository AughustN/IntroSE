import React from "react";
import { Calendar, Filter, RefreshCw } from "lucide-react";
import type { DatePeriodFilter } from "../../../../shared/types/analytics";

interface EventOption {
  id: string;
  title: string;
}

interface Props {
  period: DatePeriodFilter;
  onPeriodChange: (p: DatePeriodFilter) => void;
  startDate: string;
  onStartDateChange: (d: string) => void;
  endDate: string;
  onEndDateChange: (d: string) => void;
  selectedEventId: string;
  onEventChange: (id: string) => void;
  eventList: EventOption[];
  onRefresh?: () => void;
  loading?: boolean;
}

export function AnalyticsFilterBar({
  period,
  onPeriodChange,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  selectedEventId,
  onEventChange,
  eventList,
  onRefresh,
  loading = false,
}: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-2 border-beige-kem/30 bg-surface-2 p-4 text-beige-kem">
      {/* Date Period Presets */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-beige-kem/70">
          <Calendar className="h-4 w-4 text-la-co" /> Thời gian:
        </span>
        <div className="inline-flex bg-xanh-pho p-1 border border-beige-kem/20">
          <button
            type="button"
            onClick={() => onPeriodChange("7d")}
            className={` px-3 py-1.5 text-xs font-bold transition ${
              period === "7d"
                ? "bg-burgundy text-white"
                : "text-beige-kem/70 hover:text-beige-kem hover:bg-beige-kem/10"
            }`}
          >
            7 ngày gần đây
          </button>
          <button
            type="button"
            onClick={() => onPeriodChange("this_month")}
            className={` px-3 py-1.5 text-xs font-bold transition ${
              period === "this_month"
                ? "bg-burgundy text-white"
                : "text-beige-kem/70 hover:text-beige-kem hover:bg-beige-kem/10"
            }`}
          >
            Tháng này
          </button>
          <button
            type="button"
            onClick={() => onPeriodChange("custom")}
            className={` px-3 py-1.5 text-xs font-bold transition ${
              period === "custom"
                ? "bg-burgundy text-white"
                : "text-beige-kem/70 hover:text-beige-kem hover:bg-beige-kem/10"
            }`}
          >
            Tùy chỉnh
          </button>
        </div>

        {/* Custom Date Pickers */}
        {period === "custom" && (
          <div className="flex items-center gap-2 text-xs">
            <input
              type="date"
              value={startDate}
              onChange={(e) => onStartDateChange(e.target.value)}
              className="border border-beige-kem/40 bg-surface-2 px-3 py-1.5 text-beige-kem outline-none focus:border-burgundy focus:ring-1 focus:ring-burgundy transition"
            />
            <span className="text-beige-kem/60 font-medium">đến</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => onEndDateChange(e.target.value)}
              className="border border-beige-kem/40 bg-surface-2 px-3 py-1.5 text-beige-kem outline-none focus:border-burgundy focus:ring-1 focus:ring-burgundy transition"
            />
          </div>
        )}
      </div>

      {/* Event Selector Filter & Refresh */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-beige-kem/70">
            <Filter className="h-4 w-4 text-cam-dat" /> Sự kiện:
          </span>
          <select
            value={selectedEventId}
            onChange={(e) => onEventChange(e.target.value)}
            className="h-10 border-2 border-beige-kem/40 bg-surface-2 px-3 text-xs font-bold text-beige-kem outline-none transition focus:border-burgundy cursor-pointer max-w-[200px] truncate"
          >
            <option value="all">Tất cả sự kiện</option>
            {eventList.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        </div>

        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex h-10 items-center justify-center gap-1.5 border-2 border-beige-kem/40 px-3.5 text-xs font-bold text-beige-kem/80 transition hover:border-beige-kem hover:text-beige-kem disabled:opacity-50"
            title="Tải lại dữ liệu"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin text-burgundy" : ""}`} />
            <span className="hidden sm:inline">Làm mới</span>
          </button>
        )}
      </div>
    </div>
  );
}
