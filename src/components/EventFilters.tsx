/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { Check, Tag, X } from "lucide-react";
import { formatVnd } from "../services/currency";
import { formatEventDate } from "../services/formatDate";
import DatePicker from "./DatePicker";
import Disclosure from "./Disclosure";
import type { DateFilter } from "../services/dateFilter";

interface EventFiltersProps {
  /**
   * The categories in force. Empty means no category filter — there is no `"all"` member.
   *
   * An explicit `"all"` in the list would be a fifth value that has to be excluded from every
   * `includes` test and stripped before the filter runs, and two ways to say "everything" (the
   * token, or the other four all ticked) that mean the same thing and look different on screen.
   * The `"all"` row is a *control* that clears the list, not a value in it.
   */
  activeCategories: string[];
  /** Fired with the row that was clicked, `"all"` included. The caller toggles or clears. */
  onCategoryChange: (category: string) => void;
  activeDate: DateFilter;
  onDateChange: (date: DateFilter) => void;
  activeCities: string[];
  onCityChange: (city: string) => void;
  /** `null` means no ceiling is in force yet — the slider then opens on `priceCeiling`. */
  maxPrice: number | null;
  /** The dearest ticket still reachable through the other filters. Where the rule ends, full stop. */
  priceCeiling: number;
  onMaxPriceChange: (price: number) => void;
  availabilities: string[];
  onAvailabilityChange: (status: string) => void;
  /** Puts every control in this rail back to its opening state in one go. */
  onResetFilters: () => void;
  /**
   * How many events survive the filters, printed above the first group.
   *
   * There used to be a second shape of this component — a horizontal `bar` the landing page ran
   * under its hero. The landing page is a stack of curated bands now and carries no filter at all,
   * so the rail beside the catalog grid is the only one left and the variant went with the bar.
   */
  resultCount?: number;
  /**
   * Every date the loaded events actually run on, ISO and ascending. Derived from the catalog rather
   * than hardcoded: the option value is compared against `movie.dates` verbatim, so a fixed list
   * silently stops matching the moment the catalog moves on.
   */
  dateOptions: string[];
  /**
   * The categories present in the catalogue, derived from it — not a fixed list.
   *
   * Exactly the reasoning `dateOptions` above already carries, and the one place it was not applied.
   * The hardcoded three (`movie`, `music`, `theatre`) stopped describing a catalogue that grew to a
   * dozen: `Phim` matched nothing at all, and `Ca nhạc` matched 461 of 503 events because the
   * adapter relabelled everything it did not recognise as music.
   */
  categoryOptions: ReadonlyArray<{ id: string; label: string }>;
  /**
   * The cities the catalogue actually sits in, derived from it — not a fixed list.
   *
   * The third list to need this and the one that failed worst. `["TP.HCM", "Hà Nội", "Đà Nẵng"]`,
   * compared verbatim against `movie.city`, matched the 12 events spelled exactly "TP.HCM" and hid
   * the 160 filed under "Hồ Chí Minh" and "Tp. Hồ Chí Minh". `npm run db:cities` has since settled
   * on one province name per place, which is exactly why the list cannot be hardcoded: the
   * canonical spelling is "Tp. Hồ Chí Minh" now, so the old buttons would match nothing at all.
   */
  cityOptions: string[];
}

const availabilityOptions = [
  ["available", "Còn vé"],
  ["sold_out", "Hết vé"],
  ["finished", "Đã diễn"],
  ["cancelled", "Đã hủy"],
] as const;

/**
 * The near end of the rule.
 *
 * Zero rather than a lowest sensible ticket price, because clearing the box means zero and zero has
 * to be a position on the rule like any other. There is no matching constant for the far end: that
 * one is the dearest ticket in the catalog, and it arrives as `priceCeiling`.
 */
const PRICE_FLOOR = 0;

/**
 * One option in the rail, as a row with a tick.
 *
 * The rail used to put a `Select` inside each accordion, which meant opening a panel to reach a
 * control that opened another panel — two clicks and two animations to change one value, and the
 * inner listbox floated over the grid because that is what a dropdown does. The reference does not
 * have a dropdown anywhere on its collection page: every facet is a list of rows you tick.
 *
 * `aria-checked` with `role="checkbox"` rather than a real `<input>`: these are one-of-N and
 * clicking the active row does not clear it, so the row is a toggle in appearance only. The tick is
 * the affordance; the box around it would be a promise the behaviour does not keep.
 */
function OptionRow({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={active}
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 py-1.5 text-left font-meta text-body transition ${
        active ? "text-beige-kem" : "text-ink-soft hover:text-beige-kem"
      }`}
    >
      <span className="truncate">{label}</span>
      {/*
        The tick keeps its space when it is not showing. Rendered conditionally the labels would
        shift left by the width of the glyph every time the selection moved down the list.
      */}
      <Check
        aria-hidden="true"
        className={`h-3.5 w-3.5 shrink-0 text-burgundy-ink transition-opacity ${
          active ? "opacity-100" : "opacity-0"
        }`}
      />
    </button>
  );
}

export default function EventFilters({
  activeCategories,
  onCategoryChange,
  activeDate,
  onDateChange,
  activeCities,
  onCityChange,
  maxPrice,
  priceCeiling,
  onMaxPriceChange,
  availabilities,
  onAvailabilityChange,
  onResetFilters,
  dateOptions,
  resultCount = 0,
  categoryOptions,
  cityOptions,
}: EventFiltersProps) {
  /*
   * Whether there is anything to undo. Drives whether the reset appears at all: a permanently
   * visible "clear" on a bar that is already clear is a control that does nothing most of the time,
   * and the reader has to read it to find that out.
   */
  const hasActiveFilters =
    activeCategories.length > 0 ||
    activeDate !== null ||
    activeCities.length > 0 ||
    availabilities.length > 0 ||
    maxPrice !== null;

  /*
   * What is in the price box while it is being typed in, or `null` when it is not.
   *
   * The box has to show two different strings for the same number. Sitting there it shows the
   * formatted price, because that is what the rest of the page shows and a bare 1500000 is hard to
   * read. Being typed in it has to show exactly what was typed, because reformatting between
   * keystrokes fights the caret — insert a digit mid-number, the separators shift, and the caret is
   * suddenly somewhere else.
   *
   * `null` rather than a separate `editing` flag: one piece of state cannot disagree with itself.
   */
  const [priceDraft, setPriceDraft] = useState<string | null>(null);

  /**
   * Take whatever is in the box and make a price out of it, inside the catalog's own range.
   *
   * Dropping everything that is not a digit is what keeps the result whole — a typed "12,5" is 125,
   * not 12.5 — and it also disposes of the "đ" and the thousands dots that were in the box before
   * the reader started typing over them.
   *
   * Then the figure is held between zero and the dearest ticket on sale. Above that there is nothing
   * left to exclude, so a larger ceiling would be a number that changes no result while making the
   * rule and the box disagree about where the far end is.
   *
   * An empty box is zero, not a cancel. Clearing a ceiling is a thing someone can mean, and putting
   * the old number back would make the box impossible to empty.
   *
   * Runs on blur and on Enter, never per keystroke — reformatting mid-word fights the caret, and a
   * half-typed "8" is not yet the 8đ it would briefly become.
   */
  const commitPriceDraft = (raw: string) => {
    setPriceDraft(null);
    const typed = Number(raw.replace(/\D/g, "") || 0);
    onMaxPriceChange(Math.min(priceCeiling, Math.max(PRICE_FLOOR, typed)));
  };

  /**
   * The number both controls show.
   *
   * No ceiling in force yet means the rule opens at the top of the catalog. The clamp is for a
   * `maxPrice` that arrives from outside these controls already too large — the catalog can shrink
   * under a stored value — and it costs nothing, since a ceiling above the dearest ticket and one
   * exactly at it filter identically.
   */
  const effectiveMax = Math.min(priceCeiling, maxPrice ?? priceCeiling);

  /**
   * What the rail prints beside a closed group. `undefined` where the filter is not in force.
   *
   * One name while there is one, a count past that. Three names do not fit a 240px header and a
   * truncated list of three is less use than the number three.
   */
  const summarise = (labels: string[]) =>
    labels.length === 0 ? undefined : labels.length === 1 ? labels[0] : `${labels.length} mục`;

  const categorySummary = summarise(
    categoryOptions.filter((c) => activeCategories.includes(c.id)).map((c) => c.label),
  );
  /** One day prints as itself; a span prints as its two ends, which is all a 240px header holds. */
  const dateSummary = !activeDate
    ? undefined
    : activeDate.from === activeDate.to
      ? formatEventDate(activeDate.from)
      : `${formatEventDate(activeDate.from)} – ${formatEventDate(activeDate.to)}`;
  const citySummary = summarise(activeCities);
  const availabilitySummary = summarise(
    availabilityOptions.filter(([value]) => availabilities.includes(value)).map(([, l]) => l),
  );

  const dateControl = (
    <DatePicker label="Ngày" value={activeDate} available={dateOptions} onChange={onDateChange} />
  );

  /*
    Two ways into one number: drag it, or type it.

    A `div` and an explicit `htmlFor`, not a wrapping `label`. A label binds to the first labelable
    thing inside it, so wrapping both controls would name the box and leave the slider anonymous to
    a screen reader. Naming the box and giving the slider its own `aria-label` is the only
    arrangement where both are announced.
  */
  const priceControl = (
    <div className="flex min-w-0 flex-col gap-1.5">
      {/* The group it sits in is already headed "Giá tối đa"; the second copy is for screen readers. */}
      <label htmlFor="filter-max-price" className="sr-only">
        Giá tối đa
      </label>

      {/* The same hairline and `h-8` the other triggers carry, so the rail's controls stay one family. */}
      <div className="flex h-8 items-center gap-2 border-b border-beige-kem/40 pr-1 transition focus-within:border-burgundy hover:border-beige-kem">
        {/*
          `type="text"` with `inputMode="numeric"`, not `type="number"`: a number input refuses to
          hold "1.500.000đ", so the formatted value could not be shown in the box at rest — and its
          spinners step by one, which is meaningless here. The phone keypad comes from `inputMode`
          either way.
        */}
        <input
          id="filter-max-price"
          type="text"
          inputMode="numeric"
          value={priceDraft ?? formatVnd(effectiveMax)}
          // Swapping the formatted string for bare digits on focus means the first keystroke types
          // into a number, not into "1.500.000đ" with a caret parked after the "đ".
          onFocus={() => setPriceDraft(String(effectiveMax))}
          onChange={(e) => setPriceDraft(e.target.value)}
          onBlur={(e) => commitPriceDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
            // Escape puts the old number back into the DOM node before blurring, not just into
            // state. `setPriceDraft` does not land until the next render, so the blur fired on the
            // line after it would still read the abandoned draft off the element and commit the
            // very value Escape was pressed to throw away.
            if (e.key === "Escape") {
              e.currentTarget.value = String(effectiveMax);
              setPriceDraft(null);
              e.currentTarget.blur();
            }
          }}
          className="w-full min-w-0 bg-transparent font-meta text-body text-beige-kem outline-none"
        />
        <Tag className="h-3.5 w-3.5 shrink-0 text-ink-soft" />
      </div>

      {/*
        The rule runs the whole width of the catalog's prices and no further, so the two ends are
        the cheapest thing you could ask for and the dearest thing on sale.

        `step={1}` so it can hold any whole number the box produces. A coarser step would round the
        value on the way in and the two controls would disagree about what was typed — the reason
        the old fifty-thousand step had to go.

        CSS cannot read a range's value, so the filled length of the track is handed over as a
        percentage. Nothing clamps it here: `effectiveMax` is already inside the two ends, and
        pinning it a second time would only hide the day that stops being true.
      */}
      <input
        id="filter-max-price-range"
        type="range"
        aria-label="Giá tối đa"
        min={PRICE_FLOOR}
        max={priceCeiling}
        step={1}
        value={effectiveMax}
        onChange={(e) => onMaxPriceChange(Number(e.target.value))}
        style={
          {
            "--range-fill": `${((effectiveMax - PRICE_FLOOR) / (priceCeiling - PRICE_FLOOR)) * 100}%`,
          } as React.CSSProperties
        }
        className="filter-range mt-1"
      />
    </div>
  );

  /*
    One control that undoes all five. Only rendered when there is something to undo — see
    `hasActiveFilters`.

    Filled, and in the burgundy the rest of the page uses for its one real action, so it reads as
    the thing to press rather than as another category. It does not get confused with the chips
    beside it despite being a filled box like the selected one, because that chip is cream-on-ink
    and this is white-on-red — and because it carries a glyph.
  */
  const resetButton = hasActiveFilters ? (
    <button
      type="button"
      onClick={onResetFilters}
      className="label-eyebrow flex h-9 items-center gap-1.5 bg-burgundy px-4 text-white transition hover:brightness-110"
    >
      <X className="h-3.5 w-3.5" />
      Xóa bộ lọc
    </button>
  ) : null;

  /*
   * The collection rail, after the reference: a count, then one accordion per filter, each a row
   * of type over a hairline with a `+` at the far end.
   *
   * Every group starts closed, which is also what the reference does. On a rail this narrow, five
   * open controls would run past the fold and the reader would be scrolling the filters to reach
   * the grid; closed, the whole vocabulary of the page fits in one glance and only the group being
   * used takes any room.
   */
  return (
    <div>
      <p className="font-meta text-body text-ink-soft">{resultCount} kết quả</p>

      <div className="mt-5 border-t border-beige-kem/30">
        {/*
            "Thể loại", not "Loại". The rows under it are the catalogue's own categories — Phim, Ca
            nhạc, Sân khấu & Nghệ thuật, Khác — which is what a Vietnamese reader calls a thể loại;
            "loại" on its own could as easily be asking about the kind of ticket.
          */}
        <Disclosure label="Thể loại" summary={categorySummary}>
          <OptionRow
            label="Tất cả"
            active={activeCategories.length === 0}
            onClick={() => onCategoryChange("all")}
          />
          {categoryOptions.map((cat) => (
            <OptionRow
              key={cat.id}
              label={cat.label}
              active={activeCategories.includes(cat.id)}
              onClick={() => onCategoryChange(cat.id)}
            />
          ))}
        </Disclosure>

        {/*
            The date group, which the rail used to leave to the landing page's filter bar.

            That bar is gone — the landing page is a stack of curated bands now and carries no
            filter at all — so a group left out here is a filter the app no longer has. The picker
            still needs three times this column's width to draw a month, so its panel opens over the
            grid; that is the cost of keeping the filter, and it is a popover that dismisses itself
            rather than a permanent obstruction.
          */}
        <Disclosure label="Ngày" summary={dateSummary}>
          {dateControl}
        </Disclosure>

        <Disclosure label="Thành phố" summary={citySummary}>
          <OptionRow
            label="Mọi thành phố"
            active={activeCities.length === 0}
            onClick={() => onCityChange("all")}
          />
          {cityOptions.map((city) => (
            <OptionRow
              key={city}
              label={city}
              active={activeCities.includes(city)}
              onClick={() => onCityChange(city)}
            />
          ))}
        </Disclosure>

        <Disclosure label="Trạng thái" summary={availabilitySummary}>
          <OptionRow
            label="Mọi trạng thái"
            active={availabilities.length === 0}
            onClick={() => onAvailabilityChange("all")}
          />
          {availabilityOptions.map(([value, label]) => (
            <OptionRow
              key={value}
              label={label}
              active={availabilities.includes(value)}
              onClick={() => onAvailabilityChange(value)}
            />
          ))}
        </Disclosure>

        <Disclosure
          label="Giá tối đa"
          summary={maxPrice === null ? undefined : formatVnd(maxPrice)}
        >
          {priceControl}
        </Disclosure>
      </div>

      {resetButton && <div className="mt-6">{resetButton}</div>}
    </div>
  );
}
