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
  "rounded-lg border-2 border-beige-kem px-2.5 py-1.5 text-xs font-bold text-beige-kem/80 transition hover:text-beige-kem disabled:opacity-40";
const input =
  "h-9 w-full rounded-lg border-2 border-beige-kem bg-surface-2 px-3 text-xs text-beige-kem outline-none focus:border-burgundy";

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
  const [name, setName] = useState("");
  const [standing, setStanding] = useState("200");

  // "Bàn 1", "Bàn 2", … — the next free number, so the organizer rarely types a name at all.
  const suggested = `Bàn ${tables.length + 1}`;

  const addTable = () => {
    const count = Number(seatCount);
    onAddTable({
      sectionId: sectionId === "" ? null : Number(sectionId),
      name: name.trim() || suggested,
      shape,
      // Dropped at the centre; the organizer drags it into place, which carries its seats (FR-050).
      x: 5000,
      y: 5000,
      width: shape === "round" ? 700 : 1400,
      height: shape === "round" ? 700 : 700,
      rotation: 0,
      seatCount: Number.isFinite(count) ? count : 10,
      sideCounts: null,
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
    <div className="rounded-2xl border-2 border-beige-kem bg-surface-2 p-4">
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
              count: Number(standing) || 0,
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
