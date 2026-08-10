/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useDismiss } from "../hooks/useDismiss";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  /** Rendered above the trigger. Omit where the surrounding form already labels the control. */
  label?: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  /**
   * Styling for the trigger. Defaults to the filter bar's hairline.
   *
   * A prop rather than a fixed set of variants, because the two admin panels already keep their own
   * `input` constant and they do not agree with each other — one is `h-11 rounded-xl`, the other
   * `h-10 rounded-lg`. Passing that constant straight through is what keeps a dropdown looking like
   * the text field next to it instead of like a third kind of control.
   */
  triggerClassName?: string;
  /** Shown when `value` matches no option — the "Chọn địa điểm" case in the admin forms. */
  placeholder?: string;
}

const UNDERLINE_TRIGGER =
  "h-8 border-b border-beige-kem/40 pr-1 font-mono text-xs hover:border-beige-kem";

/**
 * A dropdown built on the same motion as the nav's ticket panel, after siena.film.
 *
 * A native `<select>` cannot be styled below the button — the option list is drawn by the operating
 * system, so on this page it opened as a grey Windows menu in the middle of a cream, mono-set
 * filter bar. This renders the list itself, which is the only way to make it match.
 *
 * The reveal reuses `.menu-panel` and `[data-a="y"]` rather than defining new keyframes: the panel
 * animates `grid-template-rows: 0fr → 1fr`, so it grows to whatever its content measures without
 * anyone hard-coding a height, and each row slides up on the shared stagger. Same curve, same
 * duration, same asymmetry — 0.8s open, 0.2s closed — as the ticket menu.
 */
export default function Select({
  label,
  value,
  options,
  onChange,
  triggerClassName,
  placeholder,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useDismiss(ref, open, () => setOpen(false));

  const current = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative flex min-w-0 flex-col gap-1.5">
      {label && <span className="label-eyebrow text-ink-soft">{label}</span>}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        // A form that already labels the field in its own markup passes no `label`; the placeholder
        // is then the only description a screen reader has to go on.
        aria-label={label ?? placeholder}
        className={`flex w-full items-center justify-between gap-2 text-left text-beige-kem transition ${triggerClassName ?? UNDERLINE_TRIGGER}`}
      >
        <span className={`truncate ${current ? "" : "text-ink-soft"}`}>
          {current?.label ?? placeholder ?? "—"}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-ink-soft transition-transform duration-300 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {/*
       * Always mounted, like the ticket panel: `grid-template-rows` only animates between two
       * rendered states, so unmounting on close would trade the reveal for a pop. `inert` keeps the
       * collapsed rows out of the tab order in the meantime.
       */}
      <div
        data-open={open}
        inert={!open}
        className="menu-panel absolute left-0 right-0 top-[calc(100%+8px)] z-30"
      >
        <div>
          <ul
            role="listbox"
            aria-label={label}
            className="ticket-corners max-h-64 overflow-y-auto bg-surface-2 py-1"
          >
            {options.map((option, i) => {
              const selected = option.value === value;
              return (
                <li key={option.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-3 overflow-clip px-4 py-2 text-left font-mono text-xs transition-colors ${
                      selected
                        ? "bg-bubblegum/50 text-on-tint"
                        : "text-beige-kem hover:bg-bubblegum/30"
                    }`}
                  >
                    <span
                      data-a="y"
                      style={{ "--menu-row-delay": `${0.04 + i * 0.03}s` } as React.CSSProperties}
                      className="block truncate"
                    >
                      {option.label}
                    </span>
                    {selected && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-burgundy" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
