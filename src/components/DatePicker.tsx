/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useDismiss } from "../hooks/useDismiss";
import { monthRange, orderedRange, weekRange, type DateFilter } from "../services/dateFilter";

interface DatePickerProps {
  label: string;
  value: DateFilter;
  /** Every date the catalog runs on. Marks which cells have something behind them. */
  available: readonly string[];
  onChange: (value: DateFilter) => void;
}

const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const MONTHS = [
  "Th1",
  "Th2",
  "Th3",
  "Th4",
  "Th5",
  "Th6",
  "Th7",
  "Th8",
  "Th9",
  "Th10",
  "Th11",
  "Th12",
];

/**
 * ISO parts without going through `Date`.
 *
 * `new Date("2026-08-07")` parses as UTC midnight, which in GMT+7 is still the 7th but in any
 * negative offset is the 6th — the calendar would highlight the wrong cell for half the world.
 * These strings are plain civil dates, so they are only ever split, never parsed.
 */
function parseISO(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}

const toISO = (y: number, m: number, d: number): string =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Monday-first column for a JS day index, which counts from Sunday. */
const mondayFirst = (jsDay: number): number => (jsDay + 6) % 7;

function shortLabel(iso: string): string {
  const p = parseISO(iso);
  return p ? `${p.d} ${MONTHS[p.m]}` : iso;
}

export default function DatePicker({ label, value, available, onChange }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  /**
   * The selection being built. Nothing reaches the filter until "Áp dụng" — with an explicit
   * commit on the panel, every other control has to edit a draft, or half the controls would apply
   * instantly and half would wait.
   */
  const [draft, setDraft] = useState<DateFilter>(value);
  /**
   * The first end of a span the reader is still drawing. Non-null means the next click closes the
   * span rather than starting a new one.
   */
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  /** Leaves without committing. Dismissing the panel is a cancel, not a silent apply. */
  const close = () => {
    setOpen(false);
    setAnchor(null);
    setHovered(null);
  };
  useDismiss(ref, open, close);

  const availableSet = useMemo(() => new Set(available), [available]);

  const start = value ? parseISO(value.from) : null;
  const now = new Date();
  const [view, setView] = useState<{ y: number; m: number }>(() => {
    const seed = start ?? parseISO(available[0] ?? "");
    return seed ? { y: seed.y, m: seed.m } : { y: now.getFullYear(), m: now.getMonth() };
  });

  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const leadingBlanks = mondayFirst(new Date(view.y, view.m, 1).getDay());

  const step = (delta: number) =>
    setView(({ y, m }) => {
      const next = m + delta;
      if (next < 0) return { y: y - 1, m: 11 };
      if (next > 11) return { y: y + 1, m: 0 };
      return { y, m: next };
    });

  /*
   * Opening seeds the draft from the committed value and re-anchors the month. The catalog
   * arrives from a fetch, so a picker mounted before it lands would otherwise stay parked on
   * today with an empty grid.
   */
  const openPanel = () => {
    setDraft(value);
    setAnchor(null);
    const seed = (value ? parseISO(value.from) : null) ?? parseISO(available[0] ?? "");
    if (seed) setView({ y: seed.y, m: seed.m });
    setOpen(true);
  };

  /*
   * One click picks a day. A second click, before the panel closes, turns that day into the far end
   * of a span — so the common case costs one click and a range costs two, with no mode to switch
   * between. The panel deliberately stays open after the first click; that is the only thing
   * telling the reader a second click is available.
   */
  const clickDay = (iso: string) => {
    if (anchor === null) {
      setDraft({ from: iso, to: iso });
      setAnchor(iso);
      return;
    }
    setDraft(orderedRange(anchor, iso));
    setAnchor(null);
  };

  const apply = () => {
    onChange(draft);
    close();
  };

  /**
   * Clears the filter that is already in force — not just the draft.
   *
   * Dismissing the panel (outside click, Escape) is what abandons an edit and leaves the applied
   * value alone; this button is the one that undoes the filter itself.
   */
  const cancel = () => {
    onChange(null);
    setDraft(null);
    close();
  };

  /*
   * Which week "Cả tuần" means: the one holding the day just picked, so clicking a date and then
   * the button widens that date to its week. With nothing picked it falls back to the week the
   * grid is showing — its 1st — rather than to today, which may be in a month the reader has
   * already navigated away from.
   */
  const weekOfDraft = weekRange(draft?.from ?? toISO(view.y, view.m, 1));

  /* While a span is being drawn, the cell under the cursor previews the far end. */
  const preview = anchor && hovered ? orderedRange(anchor, hovered) : null;
  const band = preview ?? draft;

  const triggerText = !value
    ? "Mọi ngày"
    : value.from === value.to
      ? `${shortLabel(value.from)} ${parseISO(value.from)?.y ?? ""}`
      : `${shortLabel(value.from)} – ${shortLabel(value.to)}`;

  return (
    <div ref={ref} className="relative flex min-w-0 flex-col gap-1.5">
      <span className="label-eyebrow text-ink-soft">{label}</span>

      {/* Same hairline trigger as the other filters, with a calendar glyph to mark what it opens. */}
      <button
        type="button"
        onClick={() => (open ? close() : openPanel())}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex h-8 w-full items-center gap-2 border-b border-beige-kem/40 pr-1 text-left font-mono text-xs text-beige-kem transition hover:border-beige-kem"
      >
        <CalendarDays className="h-3.5 w-3.5 shrink-0 text-ink-soft" />
        <span className={`truncate ${value ? "" : "text-ink-soft"}`}>{triggerText}</span>
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 shrink-0 text-ink-soft transition-transform duration-300 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      <div
        data-open={open}
        inert={!open}
        className="menu-panel absolute left-0 top-[calc(100%+8px)] z-30 w-[21rem]"
      >
        <div>
          <div className="ticket-corners bg-surface-2 pb-3">
            {/*
             * The binding: a tomato head-band with holes punched through it, so the panel reads as a
             * page off a wall calendar rather than as one more dropdown. The holes are filled with
             * the panel's own colour — a real hole would show the page behind and break the paper.
             */}
            <div className="flex h-5 items-center justify-around bg-burgundy px-4">
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className="h-1.5 w-1.5 rounded-full bg-surface-2" />
              ))}
            </div>

            {/*
             * The shortcut sits above the grid, where it is read before the reader starts clicking
             * days rather than offered once the work is already done. It edits the draft like every
             * other control here — nothing commits until "Áp dụng".
             *
             * There is no "Mọi ngày" beside it any more: "Hủy" below clears the filter outright,
             * and two controls for the same outcome, one needing a second click and one not, is
             * worse than one.
             */}
            <div className="mt-3 flex items-center gap-2 px-4">
              <button
                type="button"
                onClick={() => setDraft(weekOfDraft)}
                title={`${shortLabel(weekOfDraft.from)} – ${shortLabel(weekOfDraft.to)}`}
                className="label-eyebrow h-8 flex-1 text-ink-soft transition hover:bg-bubblegum/40 hover:text-beige-kem"
              >
                Cả tuần
              </button>
              <button
                type="button"
                onClick={() => setDraft(monthRange(view.y, view.m))}
                className="label-eyebrow h-8 flex-1 text-ink-soft transition hover:bg-bubblegum/40 hover:text-beige-kem"
              >
                Cả {MONTHS[view.m]}
              </button>
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
                {MONTHS[view.m]} · {view.y}
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

            <div
              className="mt-3 grid grid-cols-7 gap-y-0.5 px-4"
              onMouseLeave={() => setHovered(null)}
            >
              {WEEKDAYS.map((w) => (
                <span
                  key={w}
                  className="grid h-6 place-items-center font-mono text-[12px] text-ink-soft"
                >
                  {w}
                </span>
              ))}

              {Array.from({ length: leadingBlanks }, (_, i) => (
                <span key={`blank-${i}`} />
              ))}

              {Array.from({ length: daysInMonth }, (_, i) => {
                const day = i + 1;
                const iso = toISO(view.y, view.m, day);
                const hasEvents = availableSet.has(iso);
                const inBand = band !== null && iso >= band.from && iso <= band.to;
                const isEnd = band !== null && (iso === band.from || iso === band.to);

                return (
                  <button
                    key={iso}
                    type="button"
                    aria-pressed={inBand}
                    onClick={() => clickDay(iso)}
                    onMouseEnter={() => setHovered(iso)}
                    className={`relative grid h-9 place-items-center font-mono text-sm transition ${
                      isEnd
                        ? "bg-burgundy font-bold text-white"
                        : inBand
                          ? "bg-bubblegum/60 text-on-tint"
                          : hasEvents
                            ? "text-beige-kem hover:bg-bubblegum/40"
                            : "text-ink-soft/40 hover:bg-bubblegum/20"
                    }`}
                  >
                    {day}
                    {/*
                     * Days without events stay clickable — a span often has to start or end on a
                     * quiet day — so the dot, not the disabled state, is what says where the
                     * events actually are.
                     */}
                    {hasEvents && !isEnd && (
                      <span className="absolute bottom-1 h-1 w-1 rounded-full bg-burgundy" />
                    )}
                  </button>
                );
              })}
            </div>

            <p className="mt-3 px-4 font-mono text-[12px] leading-4 text-ink-soft">
              {anchor
                ? "Chọn ngày thứ hai để lấy cả khoảng."
                : "Bấm một ngày, rồi bấm ngày nữa để chọn khoảng."}
            </p>

            <div className="mt-3 flex items-center gap-2 border-t border-beige-kem/25 px-4 pt-3">
              <button
                type="button"
                onClick={cancel}
                className="label-eyebrow h-9 flex-1 text-ink-soft transition hover:bg-bubblegum/40 hover:text-beige-kem"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={apply}
                className="label-eyebrow h-9 flex-1 bg-burgundy text-white transition hover:brightness-110"
              >
                Áp dụng
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
