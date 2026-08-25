/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { formatVnd } from "../services/currency";
import Select from "./Select";
import DatePicker from "./DatePicker";
import type { DateFilter } from "../services/dateFilter";

interface EventFiltersProps {
  activeCategory: string;
  onCategoryChange: (category: string) => void;
  activeDate: DateFilter;
  onDateChange: (date: DateFilter) => void;
  activeCity: string;
  onCityChange: (city: string) => void;
  maxPrice: number;
  onMaxPriceChange: (price: number) => void;
  availability: string;
  onAvailabilityChange: (status: string) => void;
  wishlistCount: number;
  /**
   * Every date the loaded events actually run on, ISO and ascending. Derived from the catalog rather
   * than hardcoded: the option value is compared against `movie.dates` verbatim, so a fixed list
   * silently stops matching the moment the catalog moves on.
   */
  dateOptions: string[];
}

const categories = [
  { id: "all", label: "Tất cả" },
  { id: "movie", label: "Phim" },
  { id: "music", label: "Ca nhạc" },
  { id: "theatre", label: "Kịch" },
];

const cityOptions = ["all", "TP.HCM", "Hà Nội", "Đà Nẵng"];

const availabilityOptions = [
  ["all", "Mọi trạng thái"],
  ["available", "Còn vé"],
  ["low", "Sắp hết"],
  ["sold_out", "Hết vé"],
  ["cancelled", "Đã hủy"],
] as const;

/**
 * A filter chip. Flat and square — selection is carried by fill, not by a border or a shadow, so a
 * row of these reads as one ruled strip rather than a row of separate objects.
 */
function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] transition ${
        active
          ? "bg-beige-kem text-xanh-pho"
          : "text-ink-soft hover:bg-bubblegum/40 hover:text-beige-kem"
      }`}
    >
      {label}
    </button>
  );
}

export default function EventFilters({
  activeCategory,
  onCategoryChange,
  activeDate,
  onDateChange,
  activeCity,
  onCityChange,
  maxPrice,
  onMaxPriceChange,
  availability,
  onAvailabilityChange,
  wishlistCount,
  dateOptions,
}: EventFiltersProps) {
  return (
    <section className="border-y border-beige-kem/25 bg-xanh-pho px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        {/*
         * Categories on their own rule, the four remaining controls on the next. Doron separates
         * its "shop by type" row from the rest the same way — one decision per line.
         */}
        <div className="flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-beige-kem/25 pb-4">
          <span className="label-eyebrow mr-3 text-ink-soft">Loại</span>
          {categories.map((cat) => (
            <Chip
              key={cat.id}
              label={cat.label}
              active={activeCategory === cat.id}
              onClick={() => onCategoryChange(cat.id)}
            />
          ))}
          <span className="ml-auto font-mono text-[11px] text-ink-soft">
            Đã lưu {wishlistCount}
          </span>
        </div>

        <div className="grid gap-6 pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <DatePicker
            label="Ngày"
            value={activeDate}
            available={dateOptions}
            onChange={onDateChange}
          />

          <Select
            label="Thành phố"
            value={activeCity}
            onChange={onCityChange}
            options={cityOptions.map((city) => ({
              value: city,
              label: city === "all" ? "Mọi thành phố" : city,
            }))}
          />

          <Select
            label="Trạng thái"
            value={availability}
            onChange={onAvailabilityChange}
            options={availabilityOptions.map(([value, label]) => ({ value, label }))}
          />

          {/* The only control whose current value is not readable from the control itself. */}
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="label-eyebrow flex items-baseline justify-between gap-2 text-ink-soft">
              <span>Giá tối đa</span>
              <span className="font-mono normal-case tracking-normal text-beige-kem">
                {formatVnd(maxPrice)}
              </span>
            </span>
            <input
              type="range"
              min={80000}
              max={1500000}
              step={50000}
              value={maxPrice}
              onChange={(e) => onMaxPriceChange(Number(e.target.value))}
              className="mt-1.5 w-full accent-burgundy"
            />
          </label>
        </div>
      </div>
    </section>
  );
}
