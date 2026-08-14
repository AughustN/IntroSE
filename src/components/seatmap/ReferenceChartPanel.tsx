/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import type { LayoutReferenceChart } from "@/shared/catalog/seatmap";
import { layoutApi } from "../../services/catalogClient";

/**
 * The reference chart — the venue's real floor plan, shown ONLY while drawing.
 *
 * The distinction from `FloorPlanPanel` is the whole reason this exists. That panel manages the
 * picture a BUYER may see behind the seats: something presentable, usually a stylised render. This
 * one manages the picture the ORGANIZER traces over: a CAD export, a PDF screenshot, a photo of a
 * printed plan — accurate and usually ugly. Before, there was one image and one `visibleToBuyers`
 * toggle, which forced a choice between tracing accurately and showing customers something good.
 *
 * It is never snapshotted onto a showtime and never reaches the buyer read, so it has no visibility
 * switch: there is nothing to expose. Alignment moves the picture only — no seat ever follows it.
 */

const btn =
  "rounded-lg border-2 border-beige-kem px-2.5 py-1.5 text-eyebrow font-bold text-beige-kem/80 transition hover:text-beige-kem disabled:opacity-40";

export default function ReferenceChartPanel({
  layoutId,
  reference,
  onChange,
}: {
  layoutId: number;
  reference: LayoutReferenceChart;
  onChange: (reference: LayoutReferenceChart) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<LayoutReferenceChart | void>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await fn();
      if (next) onChange(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const align = (patch: Partial<Omit<LayoutReferenceChart, "url">>) =>
    run(() =>
      layoutApi.alignReference(layoutId, {
        scale: patch.scale ?? reference.scale,
        offsetX: patch.offsetX ?? reference.offsetX,
        offsetY: patch.offsetY ?? reference.offsetY,
        opacity: patch.opacity ?? reference.opacity,
      }),
    );

  return (
    <div className="rounded-2xl border-2 border-beige-kem bg-surface-2 p-4">
      <h3 className="font-meta text-eyebrow font-bold uppercase tracking-widest text-beige-kem/70">
        Bản vẽ tham chiếu
      </h3>
      <p className="mt-1 text-eyebrow leading-4 text-beige-kem/50">
        Ảnh chỉ hiện khi thiết kế, để bạn vẽ ghế đè lên cho khớp. Người mua không bao giờ thấy ảnh
        này.
      </p>

      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void run(() => layoutApi.uploadReference(layoutId, file));
        }}
        className="mt-2 w-full text-meta text-beige-kem/70"
      />

      {error && <p className="mt-2 text-meta text-on-tint">{error}</p>}

      {reference.url && (
        <>
          <label className="mt-3 block font-meta text-eyebrow text-beige-kem/60">
            Tỉ lệ {reference.scale}‰
            <input
              type="range"
              min={100}
              max={3000}
              step={50}
              value={reference.scale}
              disabled={busy}
              onChange={(e) => align({ scale: Number(e.target.value) })}
              className="w-full"
            />
          </label>
          <label className="block font-meta text-eyebrow text-beige-kem/60">
            Lệch ngang {reference.offsetX}
            <input
              type="range"
              min={-5000}
              max={5000}
              step={50}
              value={reference.offsetX}
              disabled={busy}
              onChange={(e) => align({ offsetX: Number(e.target.value) })}
              className="w-full"
            />
          </label>
          <label className="block font-meta text-eyebrow text-beige-kem/60">
            Lệch dọc {reference.offsetY}
            <input
              type="range"
              min={-5000}
              max={5000}
              step={50}
              value={reference.offsetY}
              disabled={busy}
              onChange={(e) => align({ offsetY: Number(e.target.value) })}
              className="w-full"
            />
          </label>
          <label className="block font-meta text-eyebrow text-beige-kem/60">
            Độ mờ {reference.opacity}%
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={reference.opacity}
              disabled={busy}
              onChange={(e) => align({ opacity: Number(e.target.value) })}
              className="w-full"
            />
          </label>

          <button
            className={`${btn} mt-3`}
            disabled={busy}
            onClick={() =>
              run(async () => {
                await layoutApi.removeReference(layoutId);
                return { ...reference, url: null };
              })
            }
          >
            Xoá bản vẽ tham chiếu
          </button>
        </>
      )}
    </div>
  );
}
