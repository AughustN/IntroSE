import React from "react";
import { Calendar, Filter, RefreshCw } from "lucide-react";
import type { DatePeriodFilter } from "../../../../shared/types/analytics";
import Select from "../../Select";
import DatePicker from "../../DatePicker";

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

        {/*
          One range control, where there were two `<input type="date">` boxes.
          
          A native date field is drawn by the browser and formatted from its UI language, not from
          the page's: on an English-language Chrome it reads `mm/dd/yyyy` in the middle of a
          Vietnamese console, and setting `lang="vi"` on the document does not change it — measured.
          The calendar it opens is the platform's too, so nothing about it can be made to match.

          The catalogue filter's own picker already draws a Vietnamese month grid and already models
          exactly this shape — a `{ from, to }` span with an explicit commit — so the two boxes and
          the word "đến" between them collapse into it. `available` is empty here: it marks the days
          the catalogue has events on, and a revenue report has no such notion.
        */}
        {period === "custom" && (
          <DatePicker
            label="Khoảng ngày"
            value={startDate && endDate ? { from: startDate, to: endDate } : null}
            available={[]}
            onChange={(range) => {
              onStartDateChange(range?.from ?? "");
              onEndDateChange(range?.to ?? "");
            }}
          />
        )}
      </div>

      {/* Event Selector Filter & Refresh */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-beige-kem/70">
            <Filter className="h-4 w-4 text-cam-dat" /> Sự kiện:
          </span>
          {/*
            The shared dropdown. A native `<select>` hands its option list to the operating system,
            which draws a grey platform menu in the middle of a panel built entirely from hairlines
            and mono type — no styling on the element reaches inside it.
          */}
          <div className="max-w-[200px]">
            <Select
              value={selectedEventId}
              options={[
                { value: "all", label: "Tất cả sự kiện" },
                ...eventList.map((e) => ({ value: String(e.id), label: e.title })),
              ]}
              onChange={onEventChange}
              triggerClassName="h-10 w-full border-2 border-beige-kem/40 bg-surface-2 px-3 text-xs font-bold"
            />
          </div>
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
