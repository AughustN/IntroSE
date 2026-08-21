/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useDismiss } from "../hooks/useDismiss";
import { fold } from "@/shared/catalog/provinces";

interface ComboboxProps {
  label?: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  placeholder?: string;
  /** Styling for the field. Callers pass their own form's constant, as `Select`'s do. */
  className?: string;
  /**
   * Whether a value that matches no option is allowed through.
   *
   * True for a place: a list of provinces is authoritative today and stale the moment the next
   * reorganisation lands, and an organizer who genuinely is somewhere the list has not caught up
   * with should not be blocked from saying so. False where the list IS the set of valid answers.
   */
  allowCustom?: boolean;
  disabled?: boolean;
}

/**
 * Type to narrow, or open it and pick — one control that does both.
 *
 * `Select` is the right shape for a handful of options: it shows all of them and the reader chooses
 * by eye. At thirty-four it is the wrong one, because finding "Thừa Thiên Huế" in a scrolling column
 * is slower than typing three letters, and a reader who knows the answer should not have to hunt for
 * it. So the trigger is an input, and the panel is the same list `Select` draws.
 *
 * The match is fold-compared, so "da nang", "Đà Nẵng" and "DANANG" all find the same row — a
 * Vietnamese keyboard is not a given on every machine an organizer sits at.
 */
export default function Combobox({
  label,
  value,
  options,
  onChange,
  placeholder,
  className,
  allowCustom = false,
  disabled = false,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  /**
   * What is in the box, which is not the committed value.
   *
   * Null means "showing the committed value". Typing puts a draft here; committing or closing
   * throws it away. Without the split, the field would have to be cleared before it could be
   * searched, and a reader who opens it to check what they picked would have destroyed it.
   */
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setDraft(null);
  };

  useDismiss(ref, open, () => {
    // A free-text value is committed on the way out; anything else reverts to what was already set.
    if (allowCustom && draft !== null && draft.trim() !== "") onChange(draft.trim());
    close();
  });

  const query = draft ?? "";
  const matches = useMemo(() => {
    const needle = fold(query);
    if (draft === null || needle === "") return options;
    return options.filter((option) => fold(option).includes(needle));
  }, [options, query, draft]);

  const commit = (next: string) => {
    onChange(next);
    close();
  };

  return (
    <div ref={ref} className="relative flex min-w-0 flex-col gap-1.5">
      {label && <span className="label-eyebrow text-ink-soft">{label}</span>}

      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-label={label ?? placeholder}
          disabled={disabled}
          value={draft ?? value}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setDraft(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              close();
              return;
            }
            if (e.key !== "Enter") return;
            e.preventDefault();
            // Enter takes the single remaining match if there is one — the common case after
            // typing three letters — and otherwise the typed text, where that is allowed.
            if (matches.length === 1) commit(matches[0]);
            else if (allowCustom && query.trim() !== "") commit(query.trim());
          }}
          className={`w-full pr-8 text-beige-kem outline-none disabled:cursor-not-allowed disabled:opacity-50 ${className ?? ""}`}
        />
        <ChevronDown
          aria-hidden="true"
          className={`pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft transition ${ open ? "rotate-180" : ""
          }`}
        />
      </div>

      {/*
        Always mounted and `inert` when shut, matching `Select`: `grid-template-rows` can only
        animate between two rendered states, so unmounting would trade the reveal for a pop.
      */}
      <div
        data-open={open}
        inert={!open}
        className="menu-panel absolute left-0 top-[calc(100%+8px)] z-30 w-max min-w-full max-w-[min(92vw,32rem)]"
      >
        <div>
          <ul
            role="listbox"
            aria-label={label}
            className="ticket-corners max-h-64 w-max min-w-full max-w-[min(92vw,32rem)] overflow-y-auto bg-surface-2 py-1"
          >
            {matches.length === 0 ? (
              <li className="px-4 py-2 font-meta text-eyebrow text-ink-soft">
                {allowCustom
                  ? "Không có trong danh sách — nhấn Enter để dùng tên bạn vừa nhập."
                  : "Không tìm thấy."}
              </li>
            ) : (
              matches.map((option, i) => (
                <li key={option}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={option === value}
                    onClick={() => commit(option)}
                    className={`flex w-full items-center justify-between gap-3 overflow-clip px-4 py-2 text-left font-meta text-eyebrow transition-colors ${ option === value
                        ? "bg-bubblegum/50 text-on-tint"
                        : "text-beige-kem hover:bg-bubblegum/30"
                    }`}
                  >
                    <span
                      data-a="y"
                      style={{ "--menu-row-delay": `${0.04 + i * 0.03}s` } as React.CSSProperties}
                      className="line-clamp-2 block"
                    >
                      {option}
                    </span>
                    <Check
                      aria-hidden="true"
                      className={`h-3.5 w-3.5 shrink-0 text-burgundy ${ option === value ? "opacity-100" : "opacity-0"
                      }`}
                    />
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
