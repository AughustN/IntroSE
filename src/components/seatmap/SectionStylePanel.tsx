/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LayoutSection, SeatShape } from "@/shared/catalog/seatmap";

/**
 * Per-section visual style (FR-064).
 *
 * Two of these three reach buyers and one does not, which is the whole point:
 *
 *  - **colour is editor-only.** On the buyer's map colour means PRICE and nothing else, so a section
 *    colour there would make one fill mean two things. Here it is a working aid — it is how an
 *    organizer checks at a glance that they tiered the right block.
 *  - **shape and size do reach buyers**, so sections stay distinguishable to them by form.
 *
 * The size multiplier feeds the overlap test (FR-065), so scaling seats up can newly make a layout
 * fail validation — deliberately. What is drawn and what the publish gate enforces always agree.
 */

const SWATCHES = ["#4C9A6B", "#3E7CB1", "#C9762F", "#9B4D8E", "#B3453C", "#6C6F7D"];

const input =
  "h-9 rounded-lg border-2 border-beige-kem bg-surface-2 px-2 text-xs text-beige-kem outline-none focus:border-burgundy";

export default function SectionStylePanel({
  sections,
  onChange,
}: {
  sections: LayoutSection[];
  onChange: (sectionId: number, patch: Partial<LayoutSection>) => void;
}) {
  if (sections.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-beige-kem bg-surface-2 p-4">
        <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-beige-kem/70">Kiểu khu vực</h3>
        <p className="mt-2 text-[11px] text-beige-kem/50">Chưa có khu vực nào để đặt kiểu.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-beige-kem bg-surface-2 p-4">
      <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-beige-kem/70">Kiểu khu vực</h3>
      <p className="mt-1 text-[11px] leading-4 text-beige-kem/50">
        Màu chỉ hiển thị trong trình thiết kế. Trên sơ đồ của khách, màu thể hiện <b>giá vé</b>; hình
        dạng và kích thước ghế thì khách vẫn thấy.
      </p>

      <div className="mt-3 space-y-3">
        {sections.map((sec) => (
          <div key={sec.id ?? sec.name} className="rounded-xl border-2 border-beige-kem/40 p-3">
            <p className="mb-2 text-sm font-bold">{sec.name}</p>

            <div className="flex flex-wrap items-center gap-1.5">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  aria-label={`Màu ${c}`}
                  onClick={() => sec.id !== undefined && onChange(sec.id, { color: c })}
                  className={`h-6 w-6 rounded border-2 ${sec.color === c ? "border-beige-kem" : "border-transparent"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
              {!sec.color && <span className="font-mono text-[10px] text-cam-dat">Chưa chọn màu</span>}
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <select
                value={sec.seatShape ?? "circle"}
                onChange={(e) => sec.id !== undefined && onChange(sec.id, { seatShape: e.target.value as SeatShape })}
                className={input}
              >
                <option value="circle" className="bg-xanh-pho">
                  Ghế tròn
                </option>
                <option value="square" className="bg-xanh-pho">
                  Ghế vuông
                </option>
              </select>
              <label className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-beige-kem/60">Cỡ</span>
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={sec.seatSizeMultiplier ?? 1}
                  onChange={(e) =>
                    sec.id !== undefined && onChange(sec.id, { seatSizeMultiplier: Number(e.target.value) })
                  }
                  className="w-full"
                />
                <span className="font-mono text-[10px] text-beige-kem/60">
                  {(sec.seatSizeMultiplier ?? 1).toFixed(1)}×
                </span>
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
