/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import type {
  BlockParams,
  DocumentBlock,
  DocumentCategory,
  DocumentSection,
  RowLabelScheme,
  SeatLabelScheme,
} from "@/shared/catalog/seatmap-document";
import { isSeatBearing } from "@/shared/catalog/seatmap-document";
import { type BlockGeometry, BLOCK_LABEL } from "./documentOps";

/**
 * The block inspector — the reason the editor moved to a document at all.
 *
 * Before this, a row of seats was drawn once and then existed only as coordinates: "6 rows of 18,
 * lettered A upward" was gone the instant the drag ended, so changing it to 20 per row meant deleting
 * the block and drawing it again — losing every seat's identity, and with it any ticket already sold
 * against one. Here those numbers ARE the block, so changing one is an edit: `regenerateBlock` keeps
 * the database row of every seat whose label survives.
 *
 * Two things the reference version of this panel had that are deliberately absent:
 *
 *   * **a price per category.** Price belongs to `ticket_tiers`, per showtime, so one chart can sell at
 *     different prices on different nights. A price here would be a second number that no sale reads.
 *   * **canvas width and height.** The layout space is fixed at 0–10000; a per-chart canvas size would
 *     mean every reader had to scale, and two charts could not be compared or cloned.
 *
 * One thing it lacked and needed: a **section** selector. Sections carry the seat shape and size that
 * reach buyers, and a block with no section projects to seats that cannot be published.
 */

const input =
  "h-8 w-full rounded-lg border-2 border-beige-kem bg-surface-2 px-2 text-xs text-beige-kem outline-none focus:border-burgundy";
const label = "block font-mono text-[11px] text-beige-kem/60";
const btn =
  "rounded-lg border-2 border-beige-kem px-2 py-1 text-xs font-bold text-beige-kem/80 transition hover:text-beige-kem disabled:opacity-40";

const ROW_SCHEMES: { value: RowLabelScheme; label: string }[] = [
  { value: "alpha-asc", label: "A, B, C… (từ đầu)" },
  { value: "alpha-desc", label: "…C, B, A (từ cuối)" },
  { value: "num-asc", label: "1, 2, 3… (từ đầu)" },
  { value: "num-desc", label: "…3, 2, 1 (từ cuối)" },
];

const SEAT_SCHEMES: { value: SeatLabelScheme; label: string }[] = [
  { value: "num-asc", label: "1, 2, 3…" },
  { value: "num-desc", label: "…3, 2, 1" },
  { value: "odd", label: "1, 3, 5… (số lẻ)" },
  { value: "even", label: "2, 4, 6… (số chẵn)" },
];

/** Parse a numeric field without letting a half-typed value wipe the block. */
/**
 * A number field that commits when you finish, not on every keystroke.
 *
 * Each commit regenerates the block's seats, re-projects the chart and revalidates it, so typing "120"
 * used to build the block three times — at 1, then 12, then 120 seats per row. The two intermediate
 * charts are pure waste, and on a large block they are the biggest of the three.
 *
 * Commits on blur and on Enter; Escape abandons the edit. Arrow keys step by one and commit
 * immediately, because nudging a value is meant to feel live.
 */
function CommittedNumber({
  value,
  onCommit,
  className,
  title,
}: {
  value: number;
  onCommit: (next: number) => void;
  className: string;
  title?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);

  // While the field is not being edited it mirrors the block, so an undo or a regeneration elsewhere
  // shows up here instead of leaving a stale number on screen.
  const shown = editing ? draft : String(value);

  const commit = (raw: string) => {
    setEditing(false);
    const next = num(raw, value);
    if (next !== value) onCommit(next);
  };

  return (
    <input
      value={shown}
      inputMode="numeric"
      title={title}
      className={className}
      onFocus={() => {
        setDraft(String(value));
        setEditing(true);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit((e.target as HTMLInputElement).value);
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setEditing(false);
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const next = Math.max(1, value + (e.key === "ArrowUp" ? 1 : -1));
          setDraft(String(next));
          onCommit(next);
        }
      }}
    />
  );
}

/** The palette a drawn outline may take. Same family as the price classes, so a chart reads as one set. */

const num = (raw: string, fallback: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
};

export default function BlockInspector({
  block,
  sections,
  categories,
  seatBudget,
  onChange,
  onParams,
  onRotate,
  onGeometry,
  onDuplicate,
  onDelete,
}: {
  block: DocumentBlock | null;
  sections: DocumentSection[];
  categories: DocumentCategory[];
  /** Seats still available before the layout ceiling — shown so a clip is never a surprise. */
  seatBudget: number;
  onChange: (patch: Partial<DocumentBlock>) => void;
  onParams: (patch: Partial<BlockParams>) => void;
  onRotate: (degrees: number) => void;
  /** Regenerate the outline as a named shape. `free` is not offered — a hand-drawn polygon is what a
   *  shape BECOMES when its points are dragged, not something to pick. */
  onGeometry?: (geometry: Exclude<BlockGeometry, "free">) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  if (!block) {
    return (
      <div className="rounded-2xl border-2 border-beige-kem/40 bg-surface-2 p-4">
        <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-beige-kem/70">
          Thuộc tính
        </h3>
        <p className="mt-1 text-[11px] leading-4 text-beige-kem/50">
          Bấm một khối trên sơ đồ để sửa số hàng, số ghế mỗi hàng, cách đánh số và khu vực.
        </p>
      </div>
    );
  }

  const p = block.params;
  const seats = block.seats?.length ?? 0;
  const parametric = p !== undefined && isSeatBearing(block.kind);
  const rows = p?.rowsCount ?? 1;
  const perRow = p?.seatsPerRow ?? 1;
  // What the block would become if the organizer grew it — so the clip is visible before they try.
  const wouldClip = parametric && rows * perRow > seats + seatBudget;

  return (
    <div className="rounded-2xl border-2 border-beige-kem bg-surface-2 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-beige-kem/70">
          {BLOCK_LABEL[block.kind]}
        </h3>
        <span className="font-mono text-[10px] text-beige-kem/45">{seats} ghế</span>
      </div>

      <label className={`${label} mt-3`}>
        Tên khối
        <input
          value={block.title}
          onChange={(e) => onChange({ title: e.target.value.slice(0, 80) })}
          className={`mt-1 ${input}`}
        />
      </label>

      {/* ---- Section and category: what makes the block publishable and priceable ---- */}
      <label className={`${label} mt-2`}>
        Khu vực
        <select
          value={block.sectionId ?? ""}
          onChange={(e) => onChange({ sectionId: e.target.value === "" ? null : Number(e.target.value) })}
          className={`mt-1 ${input}`}
        >
          <option value="" className="bg-xanh-pho">
            — chưa thuộc khu nào —
          </option>
          {sections.map((s) => (
            <option key={s.id} value={s.id} className="bg-xanh-pho">
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <label className={`${label} mt-2`}>
        Hạng ghế
        <select
          value={block.categoryId ?? ""}
          onChange={(e) => onChange({ categoryId: e.target.value === "" ? null : Number(e.target.value) })}
          className={`mt-1 ${input}`}
        >
          <option value="" className="bg-xanh-pho">
            — chưa thuộc hạng ghế nào —
          </option>
          {categories.map((c) => (
            <option key={c.id} value={c.id} className="bg-xanh-pho">
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {(block.sectionId === null || block.categoryId === null) && isSeatBearing(block.kind) && (
        <p className="mt-1 text-[10px] leading-4 text-cam-dat">
          Ghế chưa thuộc khu vực hoặc hạng ghế nào sẽ chặn phát hành.
        </p>
      )}

      {/* ---- The parametric controls ---- */}
      {parametric ? (
        <div className="mt-3 border-t border-beige-kem/25 pt-3">
          <p className="font-mono text-[11px] font-bold text-beige-kem/70">Bố cục</p>

          <div className="mt-2 grid grid-cols-2 gap-2">
            {block.kind !== "single-row" && block.kind !== "individual-seat" && (
              <label className={label}>
                Số hàng
                <CommittedNumber
                  value={rows}
                  onCommit={(rowsCount) => onParams({ rowsCount })}
                  className={`mt-1 ${input}`}
                />
              </label>
            )}
            {block.kind !== "individual-seat" && (
              <label className={label}>
                Ghế mỗi hàng
                <CommittedNumber
                  value={perRow}
                  onCommit={(seatsPerRow) => onParams({ seatsPerRow })}
                  className={`mt-1 ${input}`}
                />
              </label>
            )}
          </div>

          {wouldClip && (
            <p className="mt-1 text-[10px] leading-4 text-cam-dat">
              Chỉ còn {seatBudget} ghế trong hạn mức của sơ đồ — phần vượt sẽ bị cắt bỏ.
            </p>
          )}

          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className={label}>
              Khoảng cách ghế
              <CommittedNumber
                value={p.seatSpacing ?? 150}
                onCommit={(seatSpacing) => onParams({ seatSpacing })}
                className={`mt-1 ${input}`}
              />
            </label>
            <label className={label}>
              Khoảng cách hàng
              <CommittedNumber
                value={p.rowSpacing ?? 150}
                onCommit={(rowSpacing) => onParams({ rowSpacing })}
                className={`mt-1 ${input}`}
              />
            </label>
          </div>

          {block.kind === "curved-row" && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className={label}>
                Bán kính
                <CommittedNumber
                  value={p.radius ?? 1500}
                  onCommit={(radius) => onParams({ radius })}
                  className={`mt-1 ${input}`}
                />
              </label>
              <label className={label}>
                Góc cung ({p.arcAngle ?? 90}°)
                <input
                  type="range"
                  min={30}
                  max={180}
                  step={5}
                  value={p.arcAngle ?? 90}
                  onChange={(e) => onParams({ arcAngle: Number(e.target.value) })}
                  className="mt-1 w-full accent-burgundy"
                />
              </label>
            </div>
          )}

          <p className="mt-3 font-mono text-[11px] font-bold text-beige-kem/70">Cách đánh nhãn</p>
          {/* Changing either scheme relabels every seat in the block. Said plainly, because a relabel
              is refused for seats already sold and the organizer should know before they try. */}
          <p className="mt-1 text-[10px] leading-4 text-beige-kem/45">
            Đổi cách đánh nhãn sẽ đổi nhãn mọi ghế trong khối. Ghế đã bán không cho đổi nhãn.
          </p>

          <label className={`${label} mt-2`}>
            Nhãn hàng
            <select
              value={p.rowLabelScheme ?? "alpha-asc"}
              onChange={(e) => onParams({ rowLabelScheme: e.target.value as RowLabelScheme })}
              className={`mt-1 ${input}`}
            >
              {ROW_SCHEMES.map((o) => (
                <option key={o.value} value={o.value} className="bg-xanh-pho">
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className={`${label} mt-2`}>
            Số ghế
            <select
              value={p.seatLabelScheme ?? "num-asc"}
              onChange={(e) => onParams({ seatLabelScheme: e.target.value as SeatLabelScheme })}
              className={`mt-1 ${input}`}
            >
              {SEAT_SCHEMES.map((o) => (
                <option key={o.value} value={o.value} className="bg-xanh-pho">
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className={`${label} mt-2`}>
            Tiền tố hàng (VD “L-”)
            <input
              value={p.rowLabelPrefix ?? ""}
              maxLength={8}
              onChange={(e) => onParams({ rowLabelPrefix: e.target.value })}
              className={`mt-1 ${input}`}
            />
          </label>
        </div>
      ) : (
        isSeatBearing(block.kind) && (
          <p className="mt-3 border-t border-beige-kem/25 pt-3 text-[11px] leading-4 text-beige-kem/50">
            Khối này được vẽ trước khi sơ đồ có bố cục tham số, nên các ghế đang ở vị trí riêng lẻ.
            Đặt số hàng và số ghế để chuyển thành khối tham số — lưu ý việc này sẽ đánh nhãn lại toàn
            bộ ghế trong khối.
          </p>
        )
      )}

      {/* ---- Capacity zone (0027) ---- */}
      {block.kind === "ga-zone" && (
        <div className="mt-3 border-t border-beige-kem/25 pt-3">
          <label className={label}>
            Sức chứa (người)
            <CommittedNumber
              value={block.capacity ?? 0}
              onCommit={(capacity) => onChange({ capacity })}
              className={`mt-1 ${input}`}
            />
            <span className="mt-1 block text-[10px] leading-4 text-beige-kem/45">
              Bán theo số lượng, không theo từng chỗ — khu này không tạo ghế nào.
            </span>
          </label>
          {block.categoryId === null && (
            // The zone is drawn but unsellable until it names a seat class, and the publish gate will
            // say so. Saying it here means the organizer finds out while looking at the zone.
            <p className="mt-2 rounded-lg border border-bubblegum px-2 py-1 text-[10px] leading-4 text-bubblegum">
              Chưa có hạng ghế — chọn một hạng ở bảng “Hạng ghế” để bán được khu này.
            </p>
          )}
        </div>
      )}

      {/* ---- Drawn shape: which shape it is. Colour lives in the palette, with the blocks it
             applies to — every block kind can take one, not just this one. ---- */}
      {block.kind === "shape" && (
        <div className="mt-3 border-t border-beige-kem/25 pt-3">
          <p className={label}>Hình dạng</p>
          <div className="mt-1 grid grid-cols-3 gap-1">
            {(
              [
                ["rect", "▭", "Chữ nhật"],
                ["square", "◻", "Vuông"],
                ["circle", "◯", "Tròn"],
                ["oval", "⬭", "Bầu dục"],
                ["triangle", "△", "Tam giác"],
                ["hexagon", "⬡", "Lục giác"],
              ] as const
            ).map(([geometry, glyph, name]) => (
              <button
                key={geometry}
                title={name}
                aria-pressed={block.geometry === geometry}
                onClick={() => onGeometry?.(geometry)}
                className={`rounded-lg border-2 px-2 py-1.5 text-sm transition ${
                  block.geometry === geometry
                    ? "border-beige-kem bg-beige-kem/10 text-beige-kem"
                    : "border-beige-kem/40 text-beige-kem/70 hover:border-beige-kem"
                }`}
              >
                {glyph}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[10px] leading-4 text-beige-kem/45">
            {block.geometry
              ? "Kéo các điểm trên sơ đồ để chỉnh lại — hình sẽ thành tự do."
              : "Hình tự do: kéo từng điểm trên sơ đồ để sửa."}
          </p>
        </div>
      )}

      {/* ---- Decoration text ---- */}
      {/* `shape` included: a drawn outline is a PLACE — a stand, a wing, a pitch — and until it could
          be named it was an anonymous polygon in the validation list and on the buyer's map alike. */}
      {(block.kind === "stage" ||
        block.kind === "text" ||
        block.kind === "exit" ||
        block.kind === "shape" ||
        block.kind === "ga-zone") && (
        <label className={`${label} mt-3`}>
          Chữ hiển thị
          <input
            value={block.label ?? ""}
            maxLength={120}
            onChange={(e) => onChange({ label: e.target.value || null })}
            className={`mt-1 ${input}`}
          />
        </label>
      )}

      {/* ---- Geometry, common to every kind ---- */}
      <div className="mt-3 border-t border-beige-kem/25 pt-3">
        <div className="grid grid-cols-2 gap-2">
          <label className={label}>
            Rộng
            <CommittedNumber
              value={block.width}
              onCommit={(width) => onChange({ width })}
              className={`mt-1 ${input}`}
            />
          </label>
          <label className={label}>
            Cao
            <CommittedNumber
              value={block.height}
              onCommit={(height) => onChange({ height })}
              className={`mt-1 ${input}`}
            />
          </label>
        </div>

        <p className={`${label} mt-2`}>Xoay ({block.rotation}°)</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {[-90, -15, 15, 90].map((d) => (
            <button key={d} className={btn} onClick={() => onRotate(d)}>
              {d > 0 ? `+${d}°` : `${d}°`}
            </button>
          ))}
          <button className={btn} onClick={() => onRotate(-block.rotation)}>
            Về 0°
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-1">
          <button className={btn} onClick={onDuplicate}>
            Nhân đôi
          </button>
          <button className={btn} onClick={onDelete}>
            Xoá khối
          </button>
        </div>
      </div>
    </div>
  );
}
