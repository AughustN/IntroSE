/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import type { LayoutFloor, LayoutSeat, LayoutSection } from "@/shared/catalog/seatmap";
import { resolvedSeatSectionId, type DocumentBlock } from "@/shared/catalog/seatmap-document";

/**
 * Sections as BLOCKS — the organising idea taken from seatmap-canvas, where a map is a list of
 * blocks and seats only exist inside one.
 *
 * The panel does two jobs that used to have no home. It names the *drawing target*: the section a
 * newly drawn row or grid lands in, so building a block is draw-then-draw rather than
 * draw-then-go-find-the-assign-control. Existing content is moved by the contextual selector above
 * this panel, keeping creation defaults separate from changes to the current selection.
 *
 * The swatch shows the section's STORED colour (FR-064), which `SectionStylePanel` below owns. It is
 * an editor-only aid: on the buyer's map colour means price and nothing else.
 */

const textAction =
  "px-1 py-1 text-[11px] font-bold text-beige-kem/70 transition hover:text-beige-kem disabled:opacity-35";

export default function SectionPanel({
  sections,
  floors,
  seats,
  blocks,
  activeSectionId,
  onActivate,
  onAdd,
  onAddFloor,
  onSetFloor,
  onRename,
  onRemove,
  onZoom,
}: {
  sections: LayoutSection[];
  /**
   * The chart's levels (0044). Empty on a single-floor chart, and then this panel shows nothing
   * about floors at all — a venue on one floor must not be asked which floor anything is on.
   */
  floors: LayoutFloor[];
  seats: LayoutSeat[];
  blocks: Array<Pick<DocumentBlock, "sectionId" | "seats">>;
  activeSectionId: number | null;
  onActivate: (id: number | null) => void;
  onAdd: (name: string) => void;
  onAddFloor: (name: string) => void;
  /** Null moves the section back to the implicit single floor. */
  onSetFloor: (sectionId: number, floorId: number | null) => void;
  onRename: (id: number, name: string) => void;
  onRemove: (id: number) => void;
  onZoom: (id: number) => void;
}) {
  const [name, setName] = useState("");
  const [floorName, setFloorName] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");

  const countIn = (id: number | null) => seats.filter((s) => s.sectionId === id).length;
  const orphans = countIn(null);

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setName("");
  };

  const addFloor = () => {
    const trimmed = floorName.trim();
    if (!trimmed) return;
    onAddFloor(trimmed);
    setFloorName("");
  };

  return (
    <div className="px-1 py-2">
      <div className="mt-3 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          maxLength={60}
          placeholder="Tên khu (VD Khu A)"
          className="h-9 w-full border-2 border-beige-kem bg-surface-2 px-3 text-xs text-beige-kem outline-none focus:border-burgundy"
        />
        <button
          type="button"
          onClick={add}
          disabled={!name.trim()}
          className="bg-burgundy px-3 text-xs font-bold text-white transition hover:brightness-95 disabled:opacity-35"
        >
          Thêm
        </button>
      </div>

      {/*
        Floors (0044). A chart is on one floor until an organizer says otherwise, so this whole strip
        only appears once there is a reason for it — and the FIRST floor an organizer adds is what
        turns a flat chart into a levelled one, which is why the add box shows even when the list is
        empty but the per-section picker below does not.
      */}
      <div className="mt-4 border-t border-beige-kem/20 pt-3">
        <div className="flex items-center gap-2">
          <label className="font-meta text-[11px] font-bold text-beige-kem/70" htmlFor="floor-add">
            Tầng
          </label>
          <input
            id="floor-add"
            value={floorName}
            onChange={(e) => setFloorName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addFloor();
            }}
            placeholder="Thêm tầng (VD: Ban công)"
            className="min-w-0 flex-1 border-2 border-beige-kem/40 bg-transparent px-2 py-1 font-meta text-xs text-beige-kem placeholder:text-beige-kem/40"
          />
          <button onClick={addFloor} disabled={!floorName.trim()} className={textAction}>
            Thêm
          </button>
        </div>
        {floors.length > 0 && (
          <p className="mt-1 font-meta text-[11px] text-beige-kem/55">
            {floors.map((f) => f.name).join(" · ")}
          </p>
        )}
      </div>

      <ul className="mt-3 space-y-1">
        {sections.map((section) => {
          const id = section.id as number;
          const active = activeSectionId === id;
          const color = section.color ?? "#8a8a8a";
          const seatTotal = countIn(id);
          const blockTotal = blocks.filter(
            (block) =>
              block.sectionId === id ||
              block.seats?.some((seat) => resolvedSeatSectionId(seat, block) === id),
          ).length;
          return (
            <li
              key={id}
              className={`border-b px-1 py-2.5 transition ${
                active ? "border-burgundy bg-burgundy/10" : "border-beige-kem/20"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 border-2"
                  style={{ borderColor: color, backgroundColor: `${color}59` }}
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
                    maxLength={60}
                    className="h-7 min-w-0 flex-1 border-2 border-burgundy bg-surface-2 px-2 text-xs text-beige-kem outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => onActivate(active ? null : id)}
                    className="min-w-0 flex-1 truncate text-left text-xs font-bold text-beige-kem"
                    aria-pressed={active}
                  >
                    {section.name}
                  </button>
                )}
                <span className="shrink-0 font-mono text-[11px] text-beige-kem/70">
                  {seatTotal} ghế
                </span>
              </div>
              {/*
                Which level this part of the room is on. Shown only once floors exist, because on a
                single-floor chart the answer is never in doubt and the control would be noise.

                "Không thuộc tầng nào" is a real, choosable answer, not a placeholder: null means the
                implicit single floor, and an organizer has to be able to move a section back off a
                balcony as easily as onto one.
              */}
              {floors.length > 0 && (
                <label className="mt-1 flex items-center gap-2 font-meta text-[11px] text-beige-kem/70">
                  Tầng
                  <select
                    value={section.floorId ?? ""}
                    onChange={(e) =>
                      onSetFloor(id, e.target.value === "" ? null : Number(e.target.value))
                    }
                    className="min-w-0 flex-1 border-2 border-beige-kem/40 bg-transparent px-1 py-0.5 font-meta text-[11px] text-beige-kem"
                  >
                    <option value="">Không thuộc tầng nào</option>
                    {floors.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-x-2">
                <button
                  type="button"
                  className={textAction}
                  disabled={blockTotal === 0}
                  onClick={() => onZoom(id)}
                  title={
                    blockTotal === 0
                      ? "Khu này chưa có nội dung để vừa khung"
                      : "Vừa khu vào khung nhìn"
                  }
                >
                  Vừa khung
                </button>
                <button
                  type="button"
                  className={textAction}
                  onClick={() => {
                    setEditing(id);
                    setDraftName(section.name);
                  }}
                >
                  Đổi tên
                </button>
                <button
                  type="button"
                  className={`${textAction} text-bubblegum hover:text-bubblegum`}
                  onClick={() => onRemove(id)}
                >
                  Xoá khu
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {sections.length === 0 && (
        <p className="mt-3 text-[11px] text-beige-kem/70">
          Chưa có khu nào. Thêm một khu trước khi vẽ ghế — ghế không thuộc khu nào sẽ chặn phát
          hành.
        </p>
      )}

      {orphans > 0 && (
        <div className="mt-3 border-l-2 border-bubblegum/60 pl-2">
          <p className="font-mono text-[11px] text-beige-kem/70">
            {orphans} ghế chưa thuộc khu nào.
          </p>
        </div>
      )}
    </div>
  );
}
