/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import type { LayoutCategory, LayoutSeat } from "@/shared/catalog/seatmap";
import { CATEGORY_COLORS } from "./layoutOps";

/**
 * Categories — the chart's PRICE CLASSES, and the one panel here that is not about geometry.
 *
 * The distinction from `SectionPanel` is the whole point of the feature. A section says WHERE a seat
 * is ("Khu A", "Ban công"); a category says WHAT KIND it is ("SVIP", "VIP", "Thường"). They are
 * genuinely independent: a section can hold two classes (VIP front rows inside Khu A), and one class
 * can span several sections.
 *
 * A category carries NO price. Price is set per showtime, on the ticket tier that names this
 * category — which is what lets the same chart sell at different prices on different nights without
 * being redrawn. Saying so on-screen matters, because "hạng vé" reads like a price to most people.
 *
 * Unlike a section's, a category's colour is not merely an editor aid: it is what the buyer's map is
 * coloured by, so the swatch here is the real thing rather than a preview.
 */

const btn =
  "rounded-lg border-2 border-beige-kem px-2 py-1 text-xs font-bold text-beige-kem/80 transition hover:text-beige-kem disabled:opacity-40";

export default function CategoryPanel({
  categories,
  seats,
  selectedCount,
  activeCategoryId,
  onActivate,
  onAdd,
  onRename,
  onRecolor,
  onRemove,
  onAssign,
}: {
  categories: LayoutCategory[];
  seats: LayoutSeat[];
  selectedCount: number;
  activeCategoryId: number | null;
  onActivate: (id: number | null) => void;
  onAdd: (name: string) => void;
  onRename: (id: number, name: string) => void;
  onRecolor: (id: number, color: string) => void;
  onRemove: (id: number) => void;
  onAssign: (id: number | null) => void;
}) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");

  const countIn = (id: number | null) => seats.filter((s) => (s.categoryId ?? null) === id).length;
  const unclassified = countIn(null);

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setName("");
  };

  return (
    <div className="rounded-2xl border-2 border-beige-kem bg-surface-2 p-4">
      <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-beige-kem/70">
        Hạng vé
      </h3>
      <p className="mt-1 text-[11px] leading-4 text-beige-kem/50">
        Hạng vé chỉ có tên và màu. Giá được đặt riêng cho từng suất diễn, nên một sơ đồ dùng lại
        được cho nhiều suất với các mức giá khác nhau.
      </p>

      <div className="mt-3 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          maxLength={40}
          placeholder="Tên hạng (VD VIP)"
          className="h-9 w-full rounded-lg border-2 border-beige-kem bg-surface-2 px-3 text-xs text-beige-kem outline-none focus:border-burgundy"
        />
        <button onClick={add} disabled={!name.trim()} className={btn}>
          Thêm
        </button>
      </div>

      <ul className="mt-3 space-y-1">
        {categories.map((category) => {
          const id = category.id as number;
          const active = activeCategoryId === id;
          return (
            <li
              key={id}
              className={`rounded-lg border-2 p-2 transition ${
                active ? "border-burgundy bg-burgundy/10" : "border-beige-kem/30"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 rounded-sm border-2"
                  style={{ borderColor: category.color, backgroundColor: `${category.color}59` }}
                />
                {editing === id ? (
                  <input
                    autoFocus
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={() => {
                      if (draftName.trim()) onRename(id, draftName.trim());
                      setEditing(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setEditing(null);
                    }}
                    maxLength={40}
                    className="h-7 min-w-0 flex-1 rounded-md border-2 border-burgundy bg-surface-2 px-2 text-xs text-beige-kem outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => onActivate(active ? null : id)}
                    className="min-w-0 flex-1 truncate text-left text-xs font-bold text-beige-kem"
                    aria-pressed={active}
                  >
                    {category.name}
                  </button>
                )}
                <span className="shrink-0 font-mono text-[11px] text-beige-kem/45">
                  {countIn(id)} ghế
                </span>
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {CATEGORY_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={`Đổi màu hạng "${category.name}"`}
                    aria-label={`Đổi màu hạng ${category.name}`}
                    aria-pressed={category.color.toLowerCase() === c.toLowerCase()}
                    onClick={() => onRecolor(id, c)}
                    className={`h-5 w-5 rounded-sm border-2 transition ${
                      category.color.toLowerCase() === c.toLowerCase()
                        ? "border-beige-kem"
                        : "border-transparent"
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>

              <div className="mt-1.5 flex flex-wrap gap-1">
                <button
                  className={btn}
                  onClick={() => {
                    setEditing(id);
                    setDraftName(category.name);
                  }}
                >
                  Đổi tên
                </button>
                <button className={btn} disabled={selectedCount === 0} onClick={() => onAssign(id)}>
                  Gán {selectedCount > 0 ? `${selectedCount} ghế` : "ghế"}
                </button>
                <button className={btn} onClick={() => onRemove(id)}>
                  Xoá hạng
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {categories.length === 0 && (
        <p className="mt-3 text-[11px] text-beige-kem/50">
          Chưa có hạng vé nào. Ghế chưa thuộc hạng nào sẽ chặn phát hành, vì không thể đặt giá cho
          nó.
        </p>
      )}

      {unclassified > 0 && categories.length > 0 && (
        <div className="mt-3 rounded-lg border-2 border-bubblegum/60 p-2">
          <p className="font-mono text-[11px] text-beige-kem/70">
            {unclassified} ghế chưa thuộc hạng nào.
          </p>
          <button
            className={`${btn} mt-1.5`}
            disabled={selectedCount === 0}
            onClick={() => onAssign(null)}
          >
            Bỏ hạng khỏi {selectedCount} ghế đang chọn
          </button>
        </div>
      )}
    </div>
  );
}
