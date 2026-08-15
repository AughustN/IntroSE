/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";

/**
 * Row Properties (§49).
 *
 * The right panel is meant to follow the selection, and until rows became selectable there was
 * nothing between "a block" and "a seat" — so re-lettering one row, reversing its numbering or
 * removing it meant editing the whole block's parameters and hoping.
 *
 * Deliberately small. §50 puts numbering sixth and styling seventh in the interaction order, so this
 * panel is the four things an organizer does TO a row and nothing else; anything about how the block
 * generates its rows stays in the block inspector, where the parameters live.
 */

const btn =
  " border-2 border-beige-kem/50 px-2 py-1 text-eyebrow text-beige-kem/80 transition hover:border-beige-kem hover:text-beige-kem disabled:opacity-40";

export default function RowInspector({
  label,
  sectionName,
  seatCount,
  canEdit,
  onRename,
  onReverse,
  onDuplicate,
  onDelete,
}: {
  label: string;
  sectionName: string | null;
  seatCount: number;
  /** False when the row's block is locked — the existing "do not touch this" signal. */
  canEdit: boolean;
  onRename: (label: string) => void;
  onReverse: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  // Initialised once per row. The parent gives this component a `key` of the row it is showing, so
  // selecting a different row REMOUNTS it — which is how the field follows the selection without an
  // effect that writes state during render.
  const [draft, setDraft] = useState(label);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== label) onRename(next);
    else setDraft(label);
  };

  return (
    <div className="border-2 border-beige-kem bg-surface-2 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-beige-kem/70">
          Hàng {label}
        </h3>
        <span className="font-mono text-[10px] text-beige-kem/45">{seatCount} ghế</span>
      </div>
      <p className="mt-1 font-mono text-[10px] text-beige-kem/50">
        {sectionName ?? "chưa thuộc khu nào"}
      </p>

      <label className="mt-3 block font-mono text-[10px] uppercase tracking-wider text-beige-kem/45">
        Tên hàng
        <input
          value={draft}
          disabled={!canEdit}
          maxLength={8}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            // Escape abandons the edit rather than committing half a name.
            if (e.key === "Escape") setDraft(label);
          }}
          className="mt-1 h-9 w-full border-2 border-beige-kem bg-surface-2 px-3 text-xs text-beige-kem outline-none focus:border-burgundy disabled:opacity-40"
        />
      </label>
      <p className="mt-1 text-[10px] leading-4 text-beige-kem/45">
        Đổi tên chỉ đổi nhãn — ghế và vé đã bán giữ nguyên.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-1">
        <button onClick={onReverse} disabled={!canEdit} className={btn} title="Đảo thứ tự đánh số của hàng này">
          Đảo chiều
        </button>
        <button onClick={onDuplicate} disabled={!canEdit} className={btn} title="Nhân đôi hàng này">
          Nhân đôi
        </button>
      </div>
      <button
        onClick={onDelete}
        disabled={!canEdit}
        className={`${btn} mt-1 w-full border-bubblegum/70 text-bubblegum hover:border-bubblegum`}
        title="Xoá hàng này — các hàng khác giữ nguyên nhãn"
      >
        Xoá hàng
      </button>
      <p className="mt-1 text-[10px] leading-4 text-beige-kem/45">
        Xoá không đánh lại các hàng còn lại. Dùng “Đánh lại số” khi muốn dồn.
      </p>
    </div>
  );
}
