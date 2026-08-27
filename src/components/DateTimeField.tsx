/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
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

/** Accept the same day-first format shown in the field, with an optional time. */
function parseManual(value: string): Parts | null {
  const match = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(
    value.trim(),
  );
  if (!match) return null;
  const y = Number(match[3]);
  const m = Number(match[2]) - 1;
  const d = Number(match[1]);
  const hh = match[4] === undefined ? 19 : Number(match[4]);
  const mm = match[5] === undefined ? 0 : Number(match[5]);
  const check = new Date(y, m, d, hh, mm);
  if (
    check.getFullYear() !== y ||
    check.getMonth() !== m ||
    check.getDate() !== d ||
    check.getHours() !== hh ||
    check.getMinutes() !== mm
  ) {
    return null;
  }
  return { y, m, d, hh, mm };
}

type SegmentKey = "d" | "m" | "y" | "hh" | "mm";
type ManualSegments = Record<SegmentKey, string>;

const segmentsFromParts = (p: Parts | null): ManualSegments => ({
  d: p ? pad(p.d) : "",
  m: p ? pad(p.m + 1) : "",
  y: p ? String(p.y) : "",
  hh: p ? pad(p.hh) : "",
  mm: p ? pad(p.mm) : "",
});

const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: pad(h), label: pad(h) }));
/** Calendar and manual entry accept exactly the same minutes. */
const MINUTES = Array.from({ length: 60 }, (_, i) => ({ value: pad(i), label: pad(i) }));

export default function DateTimeField({
  value,
  onChange,
  className,
  disabled = false,
  placeholder = "Chọn ngày giờ",
  ariaLabel,
}: {
  /** `YYYY-MM-DDTHH:mm`, or empty. */
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  /** Required when the surrounding form does not render a visible field label. */
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  /**
   * A calendar interaction is a small form, not an immediate server mutation. Keeping an open
   * panel's value locally lets a reader choose day, month, year and time before "Xong" commits
   * one coherent datetime to the caller.
   */
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  const committed = useMemo(() => parse(value), [value]);
  const [manual, setManual] = useState<ManualSegments>(() => segmentsFromParts(committed));
  const [manualError, setManualError] = useState<string | null>(null);
  const manualRefs = useRef<Array<HTMLInputElement | null>>([]);
  const parsed = useMemo(() => parse(open ? draft : value), [draft, open, value]);
  const now = new Date();

  // An external refresh (for example, a server-confirmed showtime edit) becomes the next draft.
  useEffect(() => {
    if (!open && !manualError) {
      setDraft(value);
      setManual(segmentsFromParts(committed));
    }
  }, [committed, open, value, manualError]);

  /** The month on screen. Follows the value when there is one, otherwise opens on this month. */
  const [view, setView] = useState(() =>
    committed ? { y: committed.y, m: committed.m } : { y: now.getFullYear(), m: now.getMonth() },
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
    setDraft(format({ ...base, y: view.y, m: view.m, d }));
  };

  const setTime = (part: "hh" | "mm", raw: string) => {
    const base = parsed ?? {
      y: view.y,
      m: view.m,
      d: Math.min(now.getDate(), daysInMonth),
      hh: 19,
      mm: 0,
    };
    setDraft(format({ ...base, [part]: Number(raw) }));
  };

  const openPanel = () => {
    const seed = parse(value);
    setDraft(value);
    if (seed) setView({ y: seed.y, m: seed.m });
    setOpen(true);
  };

  const commitManual = () => {
    const complete = Object.values(manual).every((segment) => segment.length > 0);
    const next = complete
      ? parseManual(`${manual.d}/${manual.m}/${manual.y} ${manual.hh}:${manual.mm}`)
      : null;
    if (!next) {
      setManualError("Nhập đủ ngày, tháng, năm, giờ và phút hợp lệ.");
      onChange("");
      return;
    }
    setManualError(null);
    const nextValue = format(next);
    setDraft(nextValue);
    setManual(segmentsFromParts(next));
    onChange(nextValue);
  };

  const updateManual = (key: SegmentKey, raw: string) => {
    const maxLength = key === "y" ? 4 : 2;
    const nextValue = raw.replace(/\D/g, "").slice(0, maxLength);
    setManual((current) => ({ ...current, [key]: nextValue }));
    if (nextValue.length === maxLength) {
      const index = ["d", "m", "y", "hh", "mm"].indexOf(key);
      manualRefs.current[index + 1]?.focus();
    }
  };

  const handleSegmentKeyDown = (e: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === "Backspace" && e.currentTarget.value === "" && index > 0) {
      manualRefs.current[index - 1]?.focus();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      commitManual();
    }
  };

  const blurSegment = (e: React.FocusEvent<HTMLInputElement>) => {
    // Focus moves synchronously, before React commits the final digit. Do not commit between parts.
    if (manualRefs.current.some((input) => input === e.relatedTarget)) return;
    commitManual();
  };

  const commit = () => {
    if (parsed) {
      setManualError(null);
      onChange(format(parsed));
    }
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative flex min-w-0 flex-col">
      <div
        className={`flex min-w-0 items-center gap-2 focus-within:border-burgundy ${className ?? ""}`}
      >
        <div className="flex min-w-0 flex-1 items-center justify-start gap-0.5 font-sans text-xs text-beige-kem">
          {(["d", "m", "y"] as const).map((key, index) => (
            <span key={key} className="flex items-center gap-0.5">
              <input
                ref={(el) => {
                  manualRefs.current[index] = el;
                }}
                type="text"
                inputMode="numeric"
                aria-invalid={Boolean(manualError)}
                value={manual[key]}
                disabled={disabled}
                onChange={(e) => updateManual(key, e.target.value)}
                onBlur={blurSegment}
                onFocus={(e) => e.currentTarget.select()}
                onKeyDown={(e) => handleSegmentKeyDown(e, index)}
                placeholder={key === "d" ? "DD" : key === "m" ? "MM" : "YYYY"}
                aria-label={`${ariaLabel ?? placeholder} — ${key === "d" ? "ngày" : key === "m" ? "tháng" : "năm"}`}
                className={`${key === "y" ? "w-12" : "w-7"} bg-transparent px-0.5 text-left font-sans outline-none placeholder:text-ink-soft/70`}
              />
              {index < 2 && <span aria-hidden>/</span>}
            </span>
          ))}
          {(["hh", "mm"] as const).map((key, offset) => (
            <span key={key} className={`flex items-center gap-0.5 ${offset === 0 ? "ml-1" : ""}`}>
              <input
                ref={(el) => {
                  manualRefs.current[offset + 3] = el;
                }}
                type="text"
                inputMode="numeric"
                aria-invalid={Boolean(manualError)}
                value={manual[key]}
                disabled={disabled}
                onChange={(e) => updateManual(key, e.target.value)}
                onBlur={blurSegment}
                onFocus={(e) => e.currentTarget.select()}
                onKeyDown={(e) => handleSegmentKeyDown(e, offset + 3)}
                placeholder={key === "hh" ? "HH" : "mm"}
                aria-label={`${ariaLabel ?? placeholder} — ${key === "hh" ? "giờ" : "phút"}`}
                className="w-7 bg-transparent px-0.5 text-left font-sans outline-none placeholder:text-ink-soft/70"
              />
              {offset === 0 && <span aria-hidden>:</span>}
            </span>
          ))}
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => (open ? setOpen(false) : openPanel())}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={open ? "Đóng lịch" : "Mở lịch chọn ngày giờ"}
          className="grid shrink-0 place-items-center text-ink-soft transition hover:text-beige-kem disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-soft" />
        </button>
      </div>

      {manualError && (
        <p role="alert" className="mt-1 text-xs text-burgundy-ink">
          {manualError}
        </p>
      )}
      <div
        data-open={open}
        inert={!open}
        role="dialog"
        aria-label={ariaLabel ?? "Chọn ngày và giờ"}
        className="menu-panel absolute left-0 top-[calc(100%+8px)] z-30 w-[21rem] max-w-[calc(100vw-2rem)]"
      >
        <div>
          <div className="ticket-corners bg-surface-2 pb-3">
            {/* Same calendar binding as the Admin date picker: this is a TixHub control, not a
                browser popup wearing a different border. */}
            <div className="flex h-5 items-center justify-around bg-burgundy px-4">
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className="h-1.5 w-1.5 bg-surface-2" />
              ))}
            </div>

            <div className="mt-3 flex items-center justify-between px-4">
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Tháng trước"
                className="grid h-7 w-7 place-items-center text-beige-kem transition hover:bg-bubblegum/40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="label-eyebrow text-beige-kem">
                Th{view.m + 1} · {view.y}
              </span>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Tháng sau"
                className="grid h-7 w-7 place-items-center text-beige-kem transition hover:bg-bubblegum/40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 grid grid-cols-7 gap-y-0.5 px-4">
              {WEEKDAYS.map((w) => (
                <span
                  key={w}
                  className="grid h-6 place-items-center font-meta text-eyebrow text-ink-soft"
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
                    className={`grid h-9 place-items-center font-meta text-body transition ${
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
            <div className="mt-3 flex items-end gap-2 border-t border-beige-kem/20 px-4 pt-3">
              <span className="label-eyebrow pb-2 text-ink-soft">Giờ</span>
              <div className="w-20">
                <Select
                  value={pad(parsed?.hh ?? 19)}
                  options={HOURS}
                  onChange={(v) => setTime("hh", v)}
                  placeholder="Giờ"
                  menuPlacement="up"
                  triggerClassName="h-9 w-full border-2 border-beige-kem/40 bg-surface-2 px-2 text-xs"
                />
              </div>
              <span className="pb-2 text-beige-kem">:</span>
              <div className="w-20">
                <Select
                  value={pad(parsed?.mm ?? 0)}
                  options={MINUTES}
                  onChange={(v) => setTime("mm", v)}
                  placeholder="Phút"
                  menuPlacement="up"
                  triggerClassName="h-9 w-full border-2 border-beige-kem/40 bg-surface-2 px-2 text-xs"
                />
              </div>
              <button
                type="button"
                onClick={commit}
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
