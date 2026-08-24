/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import type { LayoutCategory, LayoutSeat } from "@/shared/catalog/seatmap";
import { CATEGORY_COLORS } from "./layoutOps";

import { RAIL_PANEL } from "./panelSurface";
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
 * being redrawn.
 *
 * Hence the vocabulary, which is three words for three tables and must not be collapsed again:
 *
 *   Khu vực   `sections`            a PLACE.            "Khu A", "Ban công".      Layout-wide.
 *   Hạng ghế  `layout_categories`   a CLASS of seat.    "VIP", "Thường".          Layout-wide. NO price.
 *   Hạng vé   `ticket_tiers`        the PRICED thing.   Prices one hạng ghế.      Per showtime.
 *
 * This panel used to call a category "hạng vé" — the same words the showtime's tier panel uses for the
 * priced object — and elsewhere "hạng giá", a third name for the same thing. So the editor asked the
 * organizer to set a "hạng vé" that had no price field anywhere on it, while the real hạng vé lived on
 * another screen. A hạng ghế is what a hạng vé attaches a price TO.
 *
 * Unlike a section's, a category's colour is not merely an editor aid: it is what the buyer's map is
 * coloured by, so the swatch here is the real thing rather than a preview.
 *
 * `tierLabels` is why this panel knows anything about the priced side at all.
 *
 * The two lists are independent by design — that independence is what lets one chart sell at
 * different prices on different nights — but independent was being read as UNRELATED. An organizer
 * types the tiers first (`flowSteps` step 3), opens the designer (step 4), invents "SVIP" here
 * because nothing suggested otherwise, publishes the chart (step 5), and only at step 6 meets
 * `category_without_tier`: a class with no price, discovered after the drawing was finished.
 *
 * So the tier labels come in as SUGGESTIONS and as a warning, not as a constraint. Naming a class
 * after a tier is one press instead of a typing exercise, and a class that matches nothing says so
 * while there is still a chart open to fix it. What it deliberately does NOT do is restrict the
 * input to the list: a chart outlives the event that first used it, and the next event at this
 * venue may price it with an entirely different set of names.
 */

const btn =
  " border-2 border-beige-kem px-2 py-1 text-xs font-bold text-beige-kem/80 transition hover:text-beige-kem disabled:opacity-40";

export default function CategoryPanel({
  categories,
  seats,
  selectedCount,
  selectedLabel,
  activeCategoryId,
  tierLabels = [],
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
  selectedLabel?: string;
  activeCategoryId: number | null;
  /** Labels of the ticket tiers already priced on this venue's showtimes. Advisory — see the note
   *  above. Empty when the editor was opened outside any event (the chart library). */
  tierLabels?: string[];
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

  /*
   * Matched case- and space-insensitively, because that is how the organizer means them: "VIP" here
   * and "Vip " on the tier are the same class to everyone except a string comparison, and warning
   * about that pair would train them to ignore the warning. The APPLY step still joins by
   * `ticket_tiers.category_id`, an explicit choice — so a loose match here can only under-warn, never
   * mis-bind anything.
   */
  const norm = (s: string) => s.trim().toLowerCase();
  const tierSet = new Set(tierLabels.map(norm));
  const knowsTiers = tierLabels.length > 0;
  /** Tiers with no class of that name yet — the one-press half of the suggestion. */
  const unused = tierLabels.filter((t) => !categories.some((c) => norm(c.name) === norm(t)));

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setName("");
  };

  return (
    <div className={RAIL_PANEL}>
      <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-beige-kem/70">
        Hạng ghế
      </h3>

      {/* One press per tier the chart has not named yet. Placed ABOVE the free-text box on purpose:
          the suggested path should be the one the eye lands on first. */}
      {unused.length > 0 && (
        <div className="mt-3">
          <p className="font-mono text-[11px] text-beige-kem/70">
            Hạng vé của sự kiện — bấm để tạo:
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {unused.map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => onAdd(label)}
                className="border-2 border-beige-kem/40 px-2 py-1 text-xs font-bold text-beige-kem/80 transition hover:border-beige-kem hover:text-beige-kem"
              >
                + {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          maxLength={40}
          placeholder="Tên hạng ghế (VD VIP)"
          className="h-9 w-full border-2 border-beige-kem bg-surface-2 px-3 text-xs text-beige-kem outline-none focus:border-burgundy"
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
              className={`border-2 p-2 transition ${
                active ? "border-burgundy bg-burgundy/10" : "border-beige-kem/30"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 border-2"
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
                    className="h-7 min-w-0 flex-1 border-2 border-burgundy bg-surface-2 px-2 text-xs text-beige-kem outline-none"
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
                <span className="shrink-0 font-mono text-[11px] text-beige-kem/70">
                  {countIn(id)} ghế
                </span>
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {CATEGORY_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={`Đổi màu hạng ghế "${category.name}"`}
                    aria-label={`Đổi màu hạng ghế ${category.name}`}
                    aria-pressed={category.color.toLowerCase() === c.toLowerCase()}
                    onClick={() => onRecolor(id, c)}
                    className={`h-5 w-5 border-2 transition ${
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
                  Gán {selectedCount > 0 ? (selectedLabel ?? `${selectedCount} ghế`) : "phần chọn"}
                </button>
                <button className={btn} onClick={() => onRemove(id)}>
                  Xoá hạng ghế
                </button>
              </div>

              {/* The refusal the organizer would otherwise meet at "Gán giá & áp dụng", said here
                  instead — while the chart is still open and renaming costs nothing. Only for
                  classes that actually hold seats: an empty class blocks nothing. */}
              {knowsTiers && !tierSet.has(norm(category.name)) && countIn(id) > 0 && (
                <p className="mt-1.5 font-mono text-[11px] leading-4 text-cam-dat-ink">
                  ⚠ Không có hạng vé nào tên “{category.name}”. Đổi tên cho khớp một hạng vé, hoặc
                  thêm hạng vé mới ở phần Hạng vé của suất — nếu không, bước áp dụng sơ đồ sẽ bị từ
                  chối.
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {categories.length === 0 && (
        <p className="mt-3 text-[11px] text-beige-kem/70">
          Chưa có hạng ghế nào. Ghế chưa thuộc hạng ghế nào sẽ chặn phát hành, vì không có gì để
          hạng vé gắn giá vào.
        </p>
      )}

      {unclassified > 0 && categories.length > 0 && (
        <div className="mt-3 border-2 border-bubblegum/60 p-2">
          <p className="font-mono text-[11px] text-beige-kem/70">
            {unclassified} ghế chưa thuộc hạng ghế nào.
          </p>
          <button
            className={`${btn} mt-1.5`}
            disabled={selectedCount === 0}
            onClick={() => onAssign(null)}
          >
            Bỏ hạng ghế khỏi {selectedLabel ?? `${selectedCount} ghế`} đang chọn
          </button>
        </div>
      )}
    </div>
  );
}
