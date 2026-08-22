/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { useDismiss } from "../hooks/useDismiss";
import Select from "./Select";

/**
 * A date and a time, in the site's own chrome.
 *
 * `<input type="datetime-local">` is drawn by the browser, and formatted from the browser's UI
 * language rather than the page's: on an English-language Chrome it reads `mm/dd/yyyy` in the
 * middle of a Vietnamese console, and setting `lang="vi"` on the document does not change it —
 * measured, not assumed. The calendar it opens is the platform's too, so no amount of styling
 * reaches it. The only way to make it match is to draw it.
 *
 * The wire format is unchanged: in and out is `YYYY-MM-DDTHH:mm`, exactly what the native input
 * produced, so every caller keeps working and nothing about the request changes.
 */

const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

/** Monday-first, because that is how a Vietnamese calendar is read. `getDay()` starts on Sunday. */
const mondayFirst = (jsDay: number) => (jsDay + 6) % 7;

const pad = (n: number) => String(n).padStart(2, "0");

interface Parts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
}

function parse(value: string): Parts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  return {
    y: Number(match[1]),
    m: Number(match[2]) - 1,
    d: Number(match[3]),
    hh: Number(match[4]),
    mm: Number(match[5]),
  };
}

const format = (p: Parts) => `${p.y}-${pad(p.m + 1)}-${pad(p.d)}T${pad(p.hh)}:${pad(p.mm)}`;

/** What the reader sees: day first, as Vietnamese dates are written. */
const display = (p: Parts) => `${pad(p.d)}/${pad(p.m + 1)}/${p.y} · ${pad(p.hh)}:${pad(p.mm)}`;

const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: pad(h), label: pad(h) }));
/** Five-minute steps: a showtime is not scheduled to the minute, and 60 rows is a scroll. */
const MINUTES = Array.from({ length: 12 }, (_, i) => ({ value: pad(i * 5), label: pad(i * 5) }));

export default function DateTimeField({
  value,
  onChange,
  className,
  disabled = false,
  placeholder = "Chọn ngày giờ",
}: {
  /** `YYYY-MM-DDTHH:mm`, or empty. */
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  const parsed = useMemo(() => parse(value), [value]);
  const now = new Date();

  /** The month on screen. Follows the value when there is one, otherwise opens on this month. */
  const [view, setView] = useState(() =>
    parsed ? { y: parsed.y, m: parsed.m } : { y: now.getFullYear(), m: now.getMonth() },
  );

  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const leadingBlanks = mondayFirst(new Date(view.y, view.m, 1).getDay());

  const step = (delta: number) =>
    setView(({ y, m }) => {
      const next = m + delta;
      if (next < 0) return { y: y - 1, m: 11 };
      if (next > 11) return { y: y + 1, m: 0 };
      return { y, m: next };
    });

  /**
   * Picking a day on a field that has no time yet needs one, and 19:00 is when a showtime starts
   * far more often than midnight does — which is what an empty time would otherwise mean.
   */
  const pickDay = (d: number) => {
    const base = parsed ?? { y: view.y, m: view.m, d, hh: 19, mm: 0 };
    onChange(format({ ...base, y: view.y, m: view.m, d }));
  };

  const setTime = (part: "hh" | "mm", raw: string) => {
    const base = parsed ?? { y: view.y, m: view.m, d: now.getDate(), hh: 19, mm: 0 };
    onChange(format({ ...base, [part]: Number(raw) }));
  };

  return (
    <div ref={ref} className="relative flex min-w-0 flex-col">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex min-w-0 w-full items-center justify-between gap-2 text-left text-beige-kem transition disabled:cursor-not-allowed disabled:opacity-50 ${className ?? ""}`}
      >
        <span className={parsed ? "truncate" : "truncate text-ink-soft"}>
          {parsed ? display(parsed) : placeholder}
        </span>
        <CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-soft" />
      </button>

      <div
        data-open={open}
        inert={!open}
        className="menu-panel absolute left-0 top-[calc(100%+8px)] z-30 w-max min-w-full"
      >
        <div>
          <div className="ticket-corners bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Tháng trước"
                className="px-2 py-1 text-beige-kem transition hover:bg-bubblegum/30"
              >
                ‹
              </button>
              <span className="label-eyebrow text-beige-kem">
                Th{view.m + 1} · {view.y}
              </span>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Tháng sau"
                className="px-2 py-1 text-beige-kem transition hover:bg-bubblegum/30"
              >
                ›
              </button>
            </div>

            <div className="mt-2 grid grid-cols-7 gap-px">
              {WEEKDAYS.map((w) => (
                <span
                  key={w}
                  className="grid h-7 place-items-center font-meta text-eyebrow text-ink-soft"
                >
                  {w}
                </span>
              ))}
              {Array.from({ length: leadingBlanks }, (_, i) => (
                <span key={`blank-${i}`} />
              ))}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const day = i + 1;
                const picked =
                  parsed !== null && parsed.y === view.y && parsed.m === view.m && parsed.d === day;
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={picked}
                    onClick={() => pickDay(day)}
                    className={`grid h-8 w-9 place-items-center font-meta text-body transition ${
                      picked
                        ? "bg-burgundy font-bold text-white"
                        : "text-beige-kem hover:bg-bubblegum/40"
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>

            {/*
              The time, on the same panel rather than behind a second control: a showtime is a
              moment, and splitting it across two fields is what makes somebody set the date, save,
              and discover the hour is still midnight.
            */}
            <div className="mt-3 flex items-end gap-2 border-t border-beige-kem/20 pt-3">
              <span className="label-eyebrow pb-2 text-ink-soft">Giờ</span>
              <div className="w-20">
                <Select
                  value={pad(parsed?.hh ?? 19)}
                  options={HOURS}
                  onChange={(v) => setTime("hh", v)}
                  triggerClassName="h-9 w-full border-2 border-beige-kem/40 bg-surface-2 px-2 text-xs"
                />
              </div>
              <span className="pb-2 text-beige-kem">:</span>
              <div className="w-20">
                <Select
                  value={pad(parsed?.mm ?? 0)}
                  options={MINUTES}
                  onChange={(v) => setTime("mm", v)}
                  triggerClassName="h-9 w-full border-2 border-beige-kem/40 bg-surface-2 px-2 text-xs"
                />
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ml-auto bg-burgundy px-3 py-1.5 text-xs font-black text-white transition hover:brightness-95"
              >
                Xong
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
