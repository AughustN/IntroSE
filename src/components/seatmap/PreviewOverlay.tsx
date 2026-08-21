/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import type { SeatMapElement, SeatMapSpace } from "@/shared/catalog/types";
import SeatCanvas, { type CanvasBlock, type CanvasSeat } from "./SeatCanvas";

/**
 * Preview mode (§34): the chart as a customer will meet it.
 *
 * The whole thing is one prop change — `editable={false}` — because the organizer's canvas and the
 * buyer's are the same component. That is the point of there being one renderer: a preview built from
 * a second implementation would be a picture of what the buyer's screen is SUPPOSED to look like,
 * which is exactly the drift a preview exists to catch.
 *
 * What genuinely differs is what is drawn ON it. The editor colours seats by price class and outlines
 * them by section, both of which are authoring aids; a buyer sees availability and price. So the
 * preview drops the section outlines, keeps the class colours (which is what the buyer's map is
 * coloured by), and lets seats be picked so the organizer can feel the selection.
 *
 * Deliberately NOT a route. It is a way of looking at the chart you already have open, and a route
 * would mean leaving the editor — and an unsaved draft with it.
 */
export default function PreviewOverlay({
  seats,
  elements,
  blocks,
  space,
  colorOfSeat,
  onClose,
}: {
  seats: CanvasSeat[];
  elements: SeatMapElement[];
  blocks: CanvasBlock[];
  space?: SeatMapSpace;
  colorOfSeat: Map<number, string>;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const [sold, setSold] = useState<ReadonlySet<number>>(new Set());

  /** A third of the chart marked unavailable, so the organizer can see what a busy night looks like. */
  const simulate = () => {
    if (sold.size > 0) {
      setSold(new Set());
      return;
    }
    setSold(new Set(seats.filter((_, i) => i % 3 === 0).map((s) => s.id)));
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-xanh-pho">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b-2 border-beige-kem/30 px-4 py-2">
        <span className="font-mono text-xs font-bold uppercase tracking-widest text-beige-kem/70">
          Xem trước — góc nhìn khách hàng
        </span>
        <span className="font-mono text-[10px] text-beige-kem/45">
          {picked.size > 0 ? `${picked.size} ghế đang chọn` : `${seats.length} ghế`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={simulate}
            className="border-2 border-beige-kem/50 px-2 py-1 text-eyebrow text-beige-kem/80 transition hover:border-beige-kem hover:text-beige-kem"
            title="Giả lập ghế đã bán, để thử cảm giác khi sơ đồ gần hết chỗ"
          >
            {sold.size > 0 ? "Bỏ giả lập" : "Giả lập đã bán"}
          </button>
          <button
            onClick={onClose}
            className="border-2 border-beige-kem bg-burgundy px-3 py-1 text-eyebrow font-bold text-beige-kem"
          >
            Đóng (Esc)
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <SeatCanvas<CanvasSeat>
          className="h-full"
          heightClass="h-full"
          seats={seats}
          elements={elements}
          blocks={blocks}
          space={space}
          interactive
          selectedIds={picked}
          // A sold seat reads as OUT of the room: a solid dark warm neutral, not a washed-out ghost
          // of the ink — tint-only states were the failure the hatch pattern was added to end, and
          // a preview that whispers "sold" defeats the point of previewing.
          seatClass={(s) =>
            sold.has(s.id)
              ? "fill-stone-800 stroke-stone-900"
              : picked.has(s.id)
                ? "fill-burgundy stroke-burgundy"
                : ""
          }
          // No `seatStroke`: a section outline is an editor aid, and on the buyer's map colour means
          // price and nothing else (FR-064). Picked seats solidify to the selection red — the same
          // state the buyer's screen will show.
          seatFill={(s) => (sold.has(s.id) || picked.has(s.id) ? undefined : colorOfSeat.get(s.id))}
          seatLabel={(s) => `Ghế ${s.row}${s.number}${sold.has(s.id) ? " — đã bán" : ""}`}
          onSeatActivate={(s) => {
            if (sold.has(s.id)) return; // an unavailable seat is not selectable, as for a buyer
            setPicked((cur) => {
              const next = new Set(cur);
              if (next.has(s.id)) next.delete(s.id);
              else next.add(s.id);
              return next;
            });
          }}
        />
      </div>

      <p className="shrink-0 px-4 py-1 font-mono text-[10px] text-beige-kem/45">
        Bấm ghế để chọn · lăn chuột để phóng to · giữ Ctrl và kéo để di chuyển. Đây là bản nháp đang
        mở, chưa phải sơ đồ đã phát hành.
      </p>
    </div>
  );
}
