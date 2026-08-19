/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import type { LayoutElement, LayoutSection, LayoutTable, ShapePoint } from "@/shared/catalog/seatmap";

/**
 * Tables, hall shapes and the standing area (FR-076).
 *
 * A table is the only thing here that produces seats. Everything else — the hall outline, a divider,
 * a standing block — is either decoration or ordinary seats; none of it changes how a seat is claimed.
 *
 * Placing a table calls the server, because the seats it generates must be written where the sold/held
 * guards can see them. Shapes are layout content and ride on the ordinary versioned save.
 */

const btn =
  " border-2 border-beige-kem px-2.5 py-1.5 text-xs font-bold text-beige-kem/80 transition hover:text-beige-kem disabled:opacity-40";
const input =
  "h-9 w-full border-2 border-beige-kem bg-surface-2 px-3 text-xs text-beige-kem outline-none focus:border-burgundy";

export interface TableDraft {
  sectionId: number | null;
  name: string;
  shape: "round" | "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  seatCount: number;
  sideCounts?: number[] | null;
  bookingMode?: "per_seat" | "whole_table";
}

/** Grid spacing for newly placed tables — wider than the biggest table so slots never touch. */
const SLOT = 1600;

/**
 * The first grid slot no existing table overlaps.
 *
 * Deliberately dumb: walk the grid in reading order and take the first free cell. An organizer who
 * wants a specific arrangement drags the table there; all this has to guarantee is that a new table
 * is visible and separate, so it can be grabbed at all.
 */
function freeSlot(tables: LayoutTable[], w: number, h: number): { x: number; y: number } {
  const cols = 6;
  for (let i = 0; i < cols * cols; i += 1) {
    const x = 1200 + (i % cols) * SLOT;
    const y = 1200 + Math.floor(i / cols) * SLOT;
    const clash = tables.some(
      (t) =>
        Math.abs(t.x - x) < (t.width + w) / 2 + 200 && Math.abs(t.y - y) < (t.height + h) / 2 + 200,
    );
    if (!clash) return { x, y };
  }
  // A layout with 36 tables in the grid is past the point where auto-placement helps; drop it at the
  // centre and let the organizer sort it out by dragging.
  return { x: 5000, y: 5000 };
}

/**
 * A typed count as a whole positive number, or null when it is not one.
 *
 * Null rather than a silent fallback, so each caller says what an unusable value should become —
 * a table falls back to its default of 10, a standing area to 0, and neither pretends the organizer
 * typed something they did not.
 */
function wholeCount(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export default function TablePalette({
  sections,
  tables,
  onAddTable,
  onAddElement,
  onAddStandingArea,
  busy,
}: {
  sections: LayoutSection[];
  tables: LayoutTable[];
  onAddTable: (t: TableDraft) => void;
  onAddElement: (el: LayoutElement) => void;
  onAddStandingArea: (a: { sectionId: number; rowLabel: string; count: number; points: ShapePoint[] }) => void;
  busy: boolean;
}) {
  const [sectionId, setSectionId] = useState<number | "">("");
  const [shape, setShape] = useState<"round" | "rect">("round");
  const [seatCount, setSeatCount] = useState("10");
  const [wholeTable, setWholeTable] = useState(false);
  const [name, setName] = useState("");
  const [standing, setStanding] = useState("200");

  // "Bàn 1", "Bàn 2", … — the next free number, so the organizer rarely types a name at all.
  const suggested = `Bàn ${tables.length + 1}`;

  const addTable = () => {
    // `Number("")` is 0 and `Number.isFinite(0)` is true, so an empty box used to create a table with
    // no seats — and `Number("150.5")` is finite too, so a fractional seat count went through as
    // well. A table's seat count is a whole number of chairs or it is not a seat count.
    const count = wholeCount(seatCount);
    onAddTable({
      sectionId: sectionId === "" ? null : Number(sectionId),
      name: name.trim() || suggested,
      shape,
      // The first free slot on a coarse grid, NOT the centre of the map.
      //
      // Every table used to be dropped at (5000, 5000) on the assumption the organizer would
      // immediately drag it into place. Two tables therefore landed exactly on top of each other —
      // and their seats with them, which the overlap check then reported as an unpublishable map.
      ...freeSlot(tables, shape === "round" ? 700 : 1400, 700),
      width: shape === "round" ? 700 : 1400,
      height: shape === "round" ? 700 : 700,
      rotation: 0,
      seatCount: count ?? 10,
      sideCounts: null,
      bookingMode: wholeTable ? "whole_table" : "per_seat",
    });
    setName("");
  };

  /** A square hall outline the organizer then drags into the room's real shape. */
  const addBoundary = () =>
    onAddElement({
      kind: "boundary",
      x: 5000,
      y: 5000,
      width: 8000,
      height: 8000,
      rotation: 0,
      label: null,
      points: [
        { x: 1000, y: 1000 },
        { x: 9000, y: 1000 },
        { x: 9000, y: 9000 },
        { x: 1000, y: 9000 },
      ],
    });

  const addDivider = () =>
    onAddElement({
      kind: "divider",
      x: 5000,
      y: 5000,
      width: 4000,
      height: 1,
      rotation: 0,
      label: null,
      points: [
        { x: 3000, y: 5000 },
        { x: 7000, y: 5000 },
      ],
    });

  return (
    <div className="border-2 border-beige-kem bg-surface-2 p-4">
      <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-beige-kem/70">Bàn tiệc</h3>
      <p className="mt-1 text-[11px] leading-4 text-beige-kem/50">
        Đặt một bàn và ghế được xếp sẵn quanh bàn. Kéo bàn thì ghế đi theo.
      </p>

      <div className="mt-3 grid gap-2">
        <select value={sectionId} onChange={(e) => setSectionId(Number(e.target.value) || "")} className={input}>
          <option value="" className="bg-xanh-pho">
            Khu vực cho bàn
          </option>
          {sections.map((s) => (
            <option key={s.id} value={s.id} className="bg-xanh-pho">
              {s.name}
            </option>
          ))}
        </select>

        <div className="grid grid-cols-2 gap-2">
          <select value={shape} onChange={(e) => setShape(e.target.value as "round" | "rect")} className={input}>
            <option value="round" className="bg-xanh-pho">
              Bàn tròn
            </option>
            <option value="rect" className="bg-xanh-pho">
              Bàn chữ nhật
            </option>
          </select>
          <input
            value={seatCount}
            onChange={(e) => setSeatCount(e.target.value)}
            inputMode="numeric"
            placeholder="Số ghế (2–20)"
            className={input}
          />
        </div>

        <label className="flex items-center gap-2 font-mono text-[11px] text-beige-kem/60">
          <input
            type="checkbox"
            checked={wholeTable}
            onChange={(e) => setWholeTable(e.target.checked)}
            className="accent-burgundy"
          />
          Bán trọn bàn — khách chọn một ghế là lấy cả bàn
        </label>

        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={suggested} maxLength={40} className={input} />

        <button onClick={addTable} disabled={busy} className={btn}>
          + Thêm bàn
        </button>
      </div>

      <h4 className="mt-4 font-mono text-xs font-bold uppercase tracking-widest text-beige-kem/70">Hình dạng sảnh</h4>
      <p className="mt-1 text-[11px] leading-4 text-beige-kem/50">
        Chỉ để nhìn: không bao giờ thành vé, không bấm được trên sơ đồ của khách.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button className={btn} onClick={addBoundary}>
          + Đường bao sảnh
        </button>
        <button className={btn} onClick={addDivider}>
          + Vách ngăn
        </button>
      </div>

      <h4 className="mt-4 font-mono text-xs font-bold uppercase tracking-widest text-beige-kem/70">Khu vực đứng</h4>
      <p className="mt-1 text-[11px] leading-4 text-beige-kem/50">
        Sinh sẵn chỗ đứng trong một vùng vẽ. Mỗi chỗ vẫn là một ghế, khách chọn từng chỗ như bình thường.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <input
          value={standing}
          onChange={(e) => setStanding(e.target.value)}
          inputMode="numeric"
          placeholder="Số chỗ"
          className={input}
        />
        <button
          className={btn}
          disabled={busy || sectionId === ""}
          onClick={() =>
            onAddStandingArea({
              sectionId: Number(sectionId),
              rowLabel: "ĐỨNG",
              // Same rule as a table's: a standing area holds a whole number of people. `|| 0` used
              // to turn both "" and "abc" into a zero-capacity zone that publishes and sells nothing.
              count: wholeCount(standing) ?? 0,
              // A square dropped at the centre; the organizer reshapes it like any other polygon.
              points: [
                { x: 3000, y: 3000 },
                { x: 7000, y: 3000 },
                { x: 7000, y: 7000 },
                { x: 3000, y: 7000 },
              ],
            })
          }
        >
          + Vùng đứng
        </button>
      </div>
      {sectionId === "" && (
        <p className="mt-1 font-mono text-[10px] text-cam-dat">Chọn khu vực trước khi tạo vùng đứng.</p>
      )}
    </div>
  );
}
