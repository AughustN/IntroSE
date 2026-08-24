/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useRef, useState } from "react";
import type { SeatMapElement, SeatMapFloorPlan, SeatMapSpace } from "@/shared/catalog/types";
import SeatCanvas, { type CanvasBlock, type CanvasSeat, type SeatCanvasHandle } from "./SeatCanvas";
import { floorShifts } from "./floorLayout";

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
  floorPlan,
  floors = [],
  colorOfSeat,
  onClose,
}: {
  seats: CanvasSeat[];
  elements: SeatMapElement[];
  blocks: CanvasBlock[];
  space?: SeatMapSpace;
  floorPlan?: SeatMapFloorPlan | null;
  /**
   * The chart's levels, in the organizer's order (0044). Empty on a single-floor chart, and then the
   * preview shows no layer control at all — this screen is what the BUYER sees, and a buyer at a
   * one-level venue is offered nothing.
   */
  floors?: { name: string; displayOrder: number }[];
  colorOfSeat: Map<number, string>;
  onClose: () => void;
}) {
  const canvas = useRef<SeatCanvasHandle>(null);
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  /*
   * The same three-way layer view the buyer's map offers, for the same reason and by the same
   * arithmetic (`floorShifts`): stacked levels cover each other, so seeing the venue means pulling
   * them apart and choosing a seat means narrowing to one.
   *
   * It matters MORE here than it looks. This screen is how an organizer judges whether their chart
   * is legible before anyone buys from it — a preview that cannot show what the buyer's layer control
   * does would let a two-tier chart look fine here and arrive unreadable in the shop.
   */
  const SPLIT = "__split__";
  const [layer, setLayer] = useState<string>(SPLIT);
  const ordered = useMemo(
    () => [...floors].sort((a, b) => a.displayOrder - b.displayOrder),
    [floors],
  );
  const multiFloor = ordered.length > 1;
  const view = multiFloor ? layer : null;
  const splitting = view === SPLIT;

  const shown = useMemo(
    () => (view === null || splitting ? seats : seats.filter((s) => (s.floor ?? null) === view)),
    [seats, view, splitting],
  );
  const shownElements = useMemo(
    () =>
      view === null || splitting ? elements : elements.filter((e) => !e.floor || e.floor === view),
    [elements, view, splitting],
  );
  const shift = useMemo(
    () => (splitting ? floorShifts([...seats, ...elements], ordered) : new Map<string, number>()),
    [splitting, seats, elements, ordered],
  );
  const drawnSeats = useMemo(
    () =>
      shift.size === 0
        ? shown
        : shown.map((s) => {
            const dx = shift.get(s.floor ?? "") ?? 0;
            return dx === 0 ? s : { ...s, x: s.x + dx };
          }),
    [shown, shift],
  );
  const drawnElements = useMemo(() => {
    if (shift.size === 0) return shownElements;
    const moved = shownElements.map((e) => {
      const dx = e.floor ? (shift.get(e.floor) ?? 0) : 0;
      return dx === 0 ? e : { ...e, x: e.x + dx };
    });
    // A name over each level, synthesised rather than stored — see the buyer's map for why.
    const captions = ordered.flatMap((f) => {
      const own = drawnSeats.filter((s) => (s.floor ?? null) === f.name);
      if (own.length === 0) return [];
      const xs = own.map((s) => s.x);
      return [
        {
          kind: "label" as const,
          x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
          y: Math.round(Math.min(...own.map((s) => s.y)) - 900),
          width: 1,
          height: 1,
          rotation: 0,
          label: f.name,
          points: null,
        },
      ];
    });
    return [...moved, ...captions];
  }, [shownElements, shift, ordered, drawnSeats]);
  const [sold, setSold] = useState<ReadonlySet<number>>(new Set());
  const [zoom, setZoom] = useState(1);

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
        <span className="font-mono text-[10px] text-beige-kem/70">
          {picked.size > 0 ? `${picked.size} ghế đang chọn` : `${seats.length} ghế`}
        </span>
        <div className="ml-auto flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
          <div
            role="group"
            className="flex items-center gap-1 border-r border-beige-kem/25 pr-2 font-mono text-xs"
            aria-label="Điều khiển khung nhìn xem trước"
          >
            <button
              type="button"
              onClick={() => canvas.current?.zoomOut()}
              className="grid h-8 w-8 place-items-center border border-beige-kem/50 text-base text-beige-kem transition hover:border-beige-kem"
              aria-label="Thu nhỏ sơ đồ"
              title="Thu nhỏ"
            >
              −
            </button>
            <span
              className="min-w-12 text-center font-bold tabular-nums text-beige-kem"
              title="Mức phóng to"
            >
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => canvas.current?.zoomIn()}
              className="grid h-8 w-8 place-items-center border border-beige-kem/50 text-base text-beige-kem transition hover:border-beige-kem"
              aria-label="Phóng to sơ đồ"
              title="Phóng to"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => canvas.current?.zoomToVenue()}
              className="grid h-8 min-w-8 place-items-center border border-beige-kem/50 px-2 text-beige-kem transition hover:border-beige-kem"
              aria-label="Vừa sơ đồ"
              title="Đưa toàn bộ sơ đồ vừa khung nhìn"
            >
              ⟲
            </button>
          </div>
          {multiFloor && (
            <div className="flex items-center gap-1" role="group" aria-label="Lớp tầng">
              {[
                { name: SPLIT, text: "Tách lớp" },
                ...ordered.map((f) => ({ name: f.name, text: f.name })),
              ].map((opt) => (
                <button
                  key={opt.name}
                  type="button"
                  onClick={() => setLayer(opt.name)}
                  aria-pressed={view === opt.name}
                  className={`border-2 px-2 py-1 text-eyebrow font-bold transition ${
                    view === opt.name
                      ? "border-beige-kem bg-burgundy text-beige-kem"
                      : "border-beige-kem/50 text-beige-kem/80 hover:border-beige-kem"
                  }`}
                >
                  {opt.text}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={simulate}
            className="border-2 border-beige-kem/50 px-2 py-1 text-eyebrow text-beige-kem/80 transition hover:border-beige-kem hover:text-beige-kem"
            title="Giả lập ghế đã bán, để thử cảm giác khi sơ đồ gần hết chỗ"
          >
            {sold.size > 0 ? "Bỏ giả lập" : "Giả lập đã bán"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="border-2 border-beige-kem bg-burgundy px-3 py-1 text-eyebrow font-bold text-beige-kem"
          >
            Đóng (Esc)
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <SeatCanvas<CanvasSeat>
          ref={canvas}
          className="h-full"
          heightClass="h-full"
          seats={drawnSeats}
          elements={drawnElements}
          blocks={blocks}
          space={space}
          floorPlan={floorPlan}
          interactive
          showViewControls={false}
          onViewReport={(report) => setZoom(report.zoom)}
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
          seatLabel={(s) =>
            `${s.section === null ? "Ghế chưa thuộc khu vực" : `Ghế ${s.row}${s.number}`}${
              sold.has(s.id) ? " — đã bán" : ""
            }`
          }
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

      <p className="shrink-0 px-4 py-1 font-mono text-[10px] text-beige-kem/70">
        Bấm ghế để chọn · lăn chuột để phóng to · giữ Ctrl và kéo để di chuyển. Đây là bản nháp đang
        mở, chưa phải sơ đồ đã phát hành.
      </p>
    </div>
  );
}
