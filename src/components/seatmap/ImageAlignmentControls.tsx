/**
 * Shared calibration controls for the attendee-visible floor plan and editor-only tracing image.
 * Preview changes are local and immediate; persistence happens once when a gesture finishes.
 */

import { useRef } from "react";
import { LAYOUT_SPACE } from "@/shared/catalog/seatmap-validate";

export interface ImageAlignment {
  scale: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
}

const btn =
  "border border-beige-kem/50 px-2 py-1 font-mono text-[10px] font-bold text-beige-kem/80 transition hover:border-beige-kem hover:text-beige-kem disabled:opacity-40";

export default function ImageAlignmentControls({
  value,
  disabled,
  onPreview,
  onCommit,
}: {
  value: ImageAlignment;
  disabled?: boolean;
  onPreview: (patch: Partial<ImageAlignment>) => void;
  onCommit: (patch: Partial<ImageAlignment>) => void;
}) {
  const pending = useRef<Partial<ImageAlignment>>({});
  const preview = (patch: Partial<ImageAlignment>) => {
    pending.current = { ...pending.current, ...patch };
    onPreview(patch);
  };
  const flush = () => {
    if (Object.keys(pending.current).length === 0) return;
    const patch = pending.current;
    pending.current = {};
    onCommit(patch);
  };
  const finish = (patch: Partial<ImageAlignment>) => {
    pending.current = {};
    onPreview(patch);
    onCommit(patch);
  };

  const centeredOffsets = (scale: number) => {
    const imageSize = (LAYOUT_SPACE * scale) / 1000;
    const offset = Math.round((LAYOUT_SPACE - imageSize) / 2);
    return { offsetX: offset, offsetY: offset };
  };

  const nudge = (axis: "offsetX" | "offsetY", amount: number) =>
    finish({ [axis]: value[axis] + amount });
  const persistRangeKey = (key: string) => {
    if (
      [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
        "PageUp",
        "PageDown",
      ].includes(key)
    ) {
      flush();
    }
  };

  return (
    <section className="space-y-3 border-t border-beige-kem/25 pt-3">
      <div>
        <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-beige-kem/70">
          Căn chỉnh ảnh
        </p>
      </div>

      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          className={btn}
          disabled={disabled}
          onClick={() => finish({ scale: 1000, offsetX: 0, offsetY: 0 })}
          title="Đưa ảnh về đúng kích thước khung làm việc"
        >
          Khớp khung
        </button>
        <button
          type="button"
          className={btn}
          disabled={disabled}
          onClick={() => finish(centeredOffsets(value.scale))}
          title="Giữ nguyên tỉ lệ và đặt ảnh vào giữa khung"
        >
          Căn giữa
        </button>
        <button
          type="button"
          className={btn}
          disabled={disabled}
          onClick={() => finish({ opacity: 50 })}
        >
          Độ mờ 50%
        </button>
      </div>

      <label className="block font-mono text-[11px] text-beige-kem/70">
        Tỉ lệ <strong className="text-beige-kem">{(value.scale / 10).toFixed(0)}%</strong>
        <input
          type="range"
          min={100}
          max={3000}
          step={10}
          value={value.scale}
          disabled={disabled}
          onChange={(e) => preview({ scale: Number(e.target.value) })}
          onPointerUp={flush}
          onPointerCancel={flush}
          onBlur={flush}
          onKeyUp={(e) => persistRangeKey(e.key)}
          className="mt-1 w-full accent-burgundy"
        />
      </label>

      <div className="grid grid-cols-[1fr_auto] gap-2">
        <div className="space-y-2">
          <label className="block font-mono text-[11px] text-beige-kem/70">
            Ngang <strong className="text-beige-kem">{value.offsetX}</strong>
            <input
              type="range"
              min={-LAYOUT_SPACE}
              max={LAYOUT_SPACE}
              step={50}
              value={value.offsetX}
              disabled={disabled}
              onChange={(e) => preview({ offsetX: Number(e.target.value) })}
              onPointerUp={flush}
              onPointerCancel={flush}
              onBlur={flush}
              onKeyUp={(e) => persistRangeKey(e.key)}
              className="mt-1 w-full accent-burgundy"
            />
          </label>
          <label className="block font-mono text-[11px] text-beige-kem/70">
            Dọc <strong className="text-beige-kem">{value.offsetY}</strong>
            <input
              type="range"
              min={-LAYOUT_SPACE}
              max={LAYOUT_SPACE}
              step={50}
              value={value.offsetY}
              disabled={disabled}
              onChange={(e) => preview({ offsetY: Number(e.target.value) })}
              onPointerUp={flush}
              onPointerCancel={flush}
              onBlur={flush}
              onKeyUp={(e) => persistRangeKey(e.key)}
              className="mt-1 w-full accent-burgundy"
            />
          </label>
        </div>
        <div className="grid grid-cols-3 place-self-center" aria-label="Dịch ảnh từng bước">
          <span />
          <button className={btn} disabled={disabled} onClick={() => nudge("offsetY", -10)}>
            ↑
          </button>
          <span />
          <button className={btn} disabled={disabled} onClick={() => nudge("offsetX", -10)}>
            ←
          </button>
          <button
            className={btn}
            disabled={disabled}
            onClick={() => finish({ offsetX: 0, offsetY: 0 })}
            title="Đưa góc ảnh về gốc sơ đồ"
          >
            ·
          </button>
          <button className={btn} disabled={disabled} onClick={() => nudge("offsetX", 10)}>
            →
          </button>
          <span />
          <button className={btn} disabled={disabled} onClick={() => nudge("offsetY", 10)}>
            ↓
          </button>
          <span />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["scale", "Tỉ lệ ‰", 1, 10000],
            ["offsetX", "Ngang", undefined, undefined],
            ["offsetY", "Dọc", undefined, undefined],
          ] as const
        ).map(([field, label, min, max]) => (
          <label key={field} className="font-mono text-[10px] text-beige-kem/70">
            {label}
            <input
              type="number"
              value={value[field]}
              min={min}
              max={max}
              step={10}
              disabled={disabled}
              onChange={(e) => {
                const next = e.currentTarget.valueAsNumber;
                if (Number.isFinite(next)) preview({ [field]: Math.round(next) });
              }}
              onBlur={flush}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className="mt-1 h-8 w-full border border-beige-kem/50 bg-transparent px-1 text-center text-beige-kem outline-none focus:border-burgundy"
            />
          </label>
        ))}
      </div>

      <label className="block font-mono text-[11px] text-beige-kem/70">
        Độ mờ <strong className="text-beige-kem">{value.opacity}%</strong>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={value.opacity}
          disabled={disabled}
          onChange={(e) => preview({ opacity: Number(e.target.value) })}
          onPointerUp={flush}
          onPointerCancel={flush}
          onBlur={flush}
          onKeyUp={(e) => persistRangeKey(e.key)}
          className="mt-1 w-full accent-burgundy"
        />
      </label>
    </section>
  );
}
