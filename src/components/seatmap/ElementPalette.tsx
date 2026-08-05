/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import type { ElementKind, LayoutElement } from "@/shared/catalog/seatmap";

/**
 * Non-sellable elements: stage, aisle, door, bar, free text label (FR-016).
 *
 * These are stored apart from seats and can never enter ticket inventory — they cannot be held,
 * sold, priced, blocked, or counted in capacity (FR-017). That separation is structural, in the
 * schema, not a rule this component is trusted to keep.
 */

const KINDS: { kind: ElementKind; label: string; w: number; h: number }[] = [
  { kind: "stage", label: "Sân khấu", w: 3000, h: 500 },
  { kind: "aisle", label: "Lối đi", w: 200, h: 2000 },
  { kind: "door", label: "Cửa", w: 400, h: 150 },
  { kind: "bar", label: "Quầy bar", w: 1200, h: 400 },
  { kind: "label", label: "Nhãn chữ", w: 800, h: 250 },
];

const btn = "rounded-lg border-2 border-beige-kem px-2.5 py-1.5 text-xs font-bold text-beige-kem/80 transition hover:text-beige-kem";

export default function ElementPalette({ onAdd }: { onAdd: (el: LayoutElement) => void }) {
  const [text, setText] = useState("");

  const add = (k: (typeof KINDS)[number]) =>
    onAdd({
      kind: k.kind,
      x: 5000,
      y: 5000,
      width: k.w,
      height: k.h,
      rotation: 0,
      // Free text on a label; the fixed kinds carry their own name so the map reads like a room.
      label: k.kind === "label" ? text.trim() || "Nhãn" : k.label,
    });

  return (
    <div className="rounded-2xl border-2 border-beige-kem bg-surface-2 p-4">
      <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-beige-kem/70">Chi tiết không bán</h3>
      <p className="mt-1 text-[11px] leading-4 text-beige-kem/50">
        Không bao giờ trở thành vé: không giữ, không bán, không tính vào sức chứa.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <button key={k.kind} className={btn} onClick={() => add(k)}>
            + {k.label}
          </button>
        ))}
      </div>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={60}
        placeholder="Nội dung nhãn chữ"
        className="mt-3 h-9 w-full rounded-lg border-2 border-beige-kem bg-surface-2 px-3 text-xs text-beige-kem outline-none focus:border-burgundy"
      />
    </div>
  );
}
