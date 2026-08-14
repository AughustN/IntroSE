/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import type { LayoutSeat, LayoutSection } from "@/shared/catalog/seatmap";

/**
 * Sections as BLOCKS — the organising idea taken from seatmap-canvas, where a map is a list of
 * blocks and seats only exist inside one.
 *
 * The panel does two jobs that used to have no home. It names the *drawing target*: the section a
 * newly drawn row or grid lands in, so building a block is draw-then-draw rather than
 * draw-then-go-find-the-assign-control. And it is where an existing selection gets moved between
 * sections, which previously could not be done at all once seats existed.
 *
 * The swatch shows the section's STORED colour (FR-064), which `SectionStylePanel` below owns. It is
 * an editor-only aid: on the buyer's map colour means price and nothing else.
 */

const btn =
  "rounded-lg border-2 border-beige-kem px-2 py-1 text-xs font-bold text-beige-kem/80 transition hover:text-beige-kem disabled:opacity-40";

export default function SectionPanel({
  sections,
  seats,
  selectedCount,
  activeSectionId,
  onActivate,
  onAdd,
  onRename,
  onRemove,
  onAssign,
  onZoom,
}: {
  sections: LayoutSection[];
  seats: LayoutSeat[];
  selectedCount: number;
  activeSectionId: number | null;
  onActivate: (id: number | null) => void;
  onAdd: (name: string) => void;
  onRename: (id: number, name: string) => void;
  onRemove: (id: number) => void;
  onAssign: (id: number | null) => void;
  onZoom: (id: number) => void;
}) {
  const [name, setName] = useState("");
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

  return (
    <div className="rounded-2xl border-2 border-beige-kem bg-surface-2 p-4">
      <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-beige-kem/70">
        Khu vực
      </h3>
      <p className="mt-1 text-[11px] leading-4 text-beige-kem/50">
        Ghế vẽ mới sẽ vào khu đang chọn. Ghế trùng nhãn ở hai khu khác nhau là hợp lệ.
      </p>

      <div className="mt-3 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          maxLength={60}
          placeholder="Tên khu (VD Khu A)"
          className="h-9 w-full rounded-lg border-2 border-beige-kem bg-surface-2 px-3 text-xs text-beige-kem outline-none focus:border-burgundy"
        />
        <button onClick={add} disabled={!name.trim()} className={btn}>
          Thêm
        </button>
      </div>

      <ul className="mt-3 space-y-1">
        {sections.map((section) => {
          const id = section.id as number;
          const active = activeSectionId === id;
          const color = section.color ?? "#8a8a8a";
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
                    className="h-7 min-w-0 flex-1 rounded-md border-2 border-burgundy bg-surface-2 px-2 text-xs text-beige-kem outline-none"
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
                <span className="shrink-0 font-mono text-[11px] text-beige-kem/45">
                  {countIn(id)} ghế
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                <button className={btn} onClick={() => onZoom(id)}>
                  Xem
                </button>
                <button
                  className={btn}
                  onClick={() => {
                    setEditing(id);
                    setDraftName(section.name);
                  }}
                >
                  Đổi tên
                </button>
                <button className={btn} disabled={selectedCount === 0} onClick={() => onAssign(id)}>
                  Gán {selectedCount > 0 ? `${selectedCount} ghế` : "ghế"}
                </button>
                <button className={btn} onClick={() => onRemove(id)}>
                  Xoá khu
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {sections.length === 0 && (
        <p className="mt-3 text-[11px] text-beige-kem/50">
          Chưa có khu nào. Thêm một khu trước khi vẽ ghế — ghế không thuộc khu nào sẽ chặn phát
          hành.
        </p>
      )}

      {orphans > 0 && (
        <div className="mt-3 rounded-lg border-2 border-bubblegum/60 p-2">
          <p className="font-mono text-[11px] text-beige-kem/70">{orphans} ghế chưa thuộc khu nào.</p>
          <button
            className={`${btn} mt-1.5`}
            disabled={selectedCount === 0}
            onClick={() => onAssign(null)}
          >
            Bỏ khu khỏi {selectedCount} ghế đang chọn
          </button>
        </div>
      )}
    </div>
  );
}
