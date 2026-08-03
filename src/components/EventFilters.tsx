/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { formatEventDate } from "../services/formatDate";

interface EventFiltersProps {
  activeCategory: string;
  onCategoryChange: (category: string) => void;
  activeDate: string;
  onDateChange: (date: string) => void;
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
  const formatPrice = (price: number) =>
    new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency: "VND",
      maximumFractionDigits: 0,
    }).format(price);

  return (
    <section className="border-b border-beige-kem/25 bg-xanh-pho px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[92rem]">
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[11px] font-bold uppercase tracking-normal text-ink-soft">
              Bộ lọc nhanh
            </p>
            <h2 className="font-display text-xl font-black text-beige-kem">
              Tìm đúng suất diễn trước khi chọn vé
            </h2>
          </div>
          <p className="font-mono text-xs text-beige-kem/55">
            Lọc theo ngày, thành phố, giá và trạng thái vé
          </p>
        </div>

        <div className="grid gap-3 rounded-2xl border-2 border-beige-kem bg-surface-2 p-3 shadow-hard shadow-black/10 lg:grid-cols-12">
          <div className="flex min-w-0 flex-wrap items-center gap-1 rounded-xl border-2 border-beige-kem bg-xanh-pho p-1 lg:col-span-4">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => onCategoryChange(cat.id)}
                className={`h-9 min-w-fit rounded-lg px-3 text-xs font-bold transition ${
                  activeCategory === cat.id
                    ? "bg-beige-kem text-xanh-pho"
                    : "text-beige-kem/72 hover:bg-surface-2 hover:text-beige-kem"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <label className="block lg:col-span-2">
            <select
              value={activeDate}
              onChange={(e) => onDateChange(e.target.value)}
              className="h-11 w-full appearance-none rounded-xl border-2 border-beige-kem bg-xanh-pho px-4 text-xs font-bold text-beige-kem outline-none focus:border-burgundy"
            >
              {["all", ...dateOptions].map((date) => (
                <option key={date} value={date} className="bg-xanh-pho">
                  {date === "all" ? "Mọi ngày" : formatEventDate(date, true)}
                </option>
              ))}
            </select>
          </label>

          <label className="block lg:col-span-2">
            <select
              value={activeCity}
              onChange={(e) => onCityChange(e.target.value)}
              className="h-11 w-full appearance-none rounded-xl border-2 border-beige-kem bg-xanh-pho px-4 text-xs font-bold text-beige-kem outline-none focus:border-burgundy"
            >
              {cityOptions.map((city) => (
                <option key={city} value={city} className="bg-xanh-pho">
                  {city === "all" ? "Mọi thành phố" : city}
                </option>
              ))}
            </select>
          </label>

          <label className="rounded-xl border-2 border-beige-kem bg-xanh-pho px-3 py-2 lg:col-span-2">
            <span className="flex items-center justify-between text-[10px] font-bold uppercase text-beige-kem/60">
              <span>Giá tối đa</span>
              <span className="text-ink-soft">{formatPrice(maxPrice)}</span>
            </span>
            <input
              type="range"
              min={80000}
              max={1500000}
              step={50000}
              value={maxPrice}
              onChange={(e) => onMaxPriceChange(Number(e.target.value))}
              className="mt-2 w-full accent-cam-dat"
            />
          </label>

          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 lg:col-span-2">
            <select
              value={availability}
              onChange={(e) => onAvailabilityChange(e.target.value)}
              className="h-11 rounded-xl border-2 border-beige-kem bg-xanh-pho px-3 text-xs font-bold text-beige-kem outline-none focus:border-burgundy"
            >
              <option value="all" className="bg-xanh-pho">Mọi trạng thái</option>
              <option value="available" className="bg-xanh-pho">Còn vé</option>
              <option value="low" className="bg-xanh-pho">Sắp hết</option>
              <option value="sold_out" className="bg-xanh-pho">Hết vé</option>
              <option value="cancelled" className="bg-xanh-pho">Đã hủy</option>
            </select>
            <span className="inline-flex h-11 items-center rounded-xl border-2 border-beige-kem bg-bubblegum px-3 text-xs font-bold text-on-tint">
              Lưu {wishlistCount}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
