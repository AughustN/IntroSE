/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { SeatMapElement, SeatMapFloorPlan, SeatMapSeat, SeatMapSpace } from "@/shared/catalog/types";

/**
 * The one surface that turns layout coordinates into pixels (research R-4).
 *
 * Used by the organizer editor AND both buyer renderers, which is the structural reason the event
 * page's preview and the seat-selection screen can never disagree about where a seat is — there is
 * only one piece of code that places one.
 *
 * SVG rather than <canvas> on purpose:
 *   - `viewBox` gives resolution-independent scaling (PLAT-01, 360–1920 px) and zoom/pan for free;
 *   - real DOM nodes keep every seat focusable and labelled (FR-039a). A bitmap canvas would
 *     silently destroy the keyboard reach today's button grid has by accident, and nothing in the
 *     test suite would notice.
 */

const DEFAULT_SPACE: SeatMapSpace = { width: 10000, height: 10000, seatDiameter: 100 };

export interface SeatCanvasProps {
  seats: SeatMapSeat[];
  elements?: SeatMapElement[];
  floorPlan?: SeatMapFloorPlan | null;
  space?: SeatMapSpace;
  /** Per-seat fill/stroke classes, by seat id. */
  seatClass?: (seat: SeatMapSeat) => string;
  /** Accessible label — what a screen reader announces for this seat (FR-039a). */
  seatLabel?: (seat: SeatMapSeat) => string;
  onSeatActivate?: (seat: SeatMapSeat) => void;
  /** False for the read-only preview: seats are drawn but not focusable or clickable. */
  interactive?: boolean;
  className?: string;
}

const ELEMENT_FILL: Record<SeatMapElement["kind"], string> = {
  stage: "fill-beige-kem/20 stroke-beige-kem/40",
  aisle: "fill-transparent stroke-beige-kem/20",
  door: "fill-la-co/20 stroke-la-co/50",
  bar: "fill-cam-dat/15 stroke-cam-dat/40",
  label: "fill-transparent stroke-transparent",
  area: "fill-beige-kem/5 stroke-beige-kem/30",
};

const ZOOM_MIN = 1;
const ZOOM_MAX = 6;

export default function SeatCanvas({
  seats,
  elements = [],
  floorPlan = null,
  space = DEFAULT_SPACE,
  seatClass,
  seatLabel,
  onSeatActivate,
  interactive = false,
  className = "",
}: SeatCanvasProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragging = useRef<{ x: number; y: number } | null>(null);

  // Fit the viewBox to the seats actually present, so a small layout is not lost in a 10000-unit
  // space. Padded by two seat diameters so edge seats are never clipped.
  const bounds = useMemo(() => {
    const pts = [
      ...seats.map((s) => ({ x: s.x, y: s.y })),
      ...elements.flatMap((e) => [
        { x: e.x - e.width / 2, y: e.y - e.height / 2 },
        { x: e.x + e.width / 2, y: e.y + e.height / 2 },
      ]),
    ];
    if (pts.length === 0) return { x: 0, y: 0, w: space.width, h: space.height };
    const pad = space.seatDiameter * 2;
    const minX = Math.min(...pts.map((p) => p.x)) - pad;
    const maxX = Math.max(...pts.map((p) => p.x)) + pad;
    const minY = Math.min(...pts.map((p) => p.y)) - pad;
    const maxY = Math.max(...pts.map((p) => p.y)) + pad;
    return { x: minX, y: minY, w: Math.max(maxX - minX, 1), h: Math.max(maxY - minY, 1) };
  }, [seats, elements, space]);

  const view = useMemo(() => {
    const w = bounds.w / zoom;
    const h = bounds.h / zoom;
    const x = bounds.x + (bounds.w - w) / 2 + pan.x;
    const y = bounds.y + (bounds.h - h) / 2 + pan.y;
    return `${x} ${y} ${w} ${h}`;
  }, [bounds, zoom, pan]);

  const step = useCallback(
    (factor: number) => setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * factor))),
    [],
  );
  const nudge = useCallback(
    (dx: number, dy: number) => setPan((p) => ({ x: p.x + (dx * bounds.w) / 8, y: p.y + (dy * bounds.h) / 8 })),
    [bounds],
  );
  const reset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const r = space.seatDiameter / 2;

  return (
    <div className={`relative ${className}`}>
      {/* Zoom and pan are reachable from the keyboard, not only by pointer gesture (FR-039a). */}
      <div className="absolute right-2 top-2 z-10 flex gap-1 font-mono text-xs">
        <button type="button" onClick={() => step(1.4)} aria-label="Phóng to sơ đồ" className="grid h-7 w-7 place-items-center rounded-md border border-beige-kem/40 bg-surface-2 text-beige-kem">+</button>
        <button type="button" onClick={() => step(1 / 1.4)} aria-label="Thu nhỏ sơ đồ" className="grid h-7 w-7 place-items-center rounded-md border border-beige-kem/40 bg-surface-2 text-beige-kem">−</button>
        <button type="button" onClick={reset} aria-label="Đặt lại khung nhìn" className="grid h-7 w-auto place-items-center rounded-md border border-beige-kem/40 bg-surface-2 px-2 text-beige-kem">⟲</button>
      </div>

      <svg
        viewBox={view}
        role="group"
        aria-label="Sơ đồ chỗ ngồi"
        tabIndex={0}
        className="w-full touch-none select-none"
        style={{ maxHeight: "70vh", cursor: dragging.current ? "grabbing" : "grab" }}
        onKeyDown={(e) => {
          const map: Record<string, () => void> = {
            ArrowLeft: () => nudge(-1, 0),
            ArrowRight: () => nudge(1, 0),
            ArrowUp: () => nudge(0, -1),
            ArrowDown: () => nudge(0, 1),
            "+": () => step(1.4),
            "=": () => step(1.4),
            "-": () => step(1 / 1.4),
            "0": reset,
          };
          const fn = map[e.key];
          if (fn) {
            e.preventDefault();
            fn();
          }
        }}
        onPointerDown={(e) => {
          dragging.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const from = dragging.current;
          if (!from) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const scale = bounds.w / zoom / rect.width;
          setPan((p) => ({ x: p.x - (e.clientX - from.x) * scale, y: p.y - (e.clientY - from.y) * scale }));
          dragging.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => {
          dragging.current = null;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
      >
        {/* Background layer only. Drawn behind everything, never interactive, and it can never
            determine a seat's status — the database decides (Principle I, FR-020). */}
        {floorPlan && (
          <image
            href={floorPlan.url}
            x={floorPlan.offsetX}
            y={floorPlan.offsetY}
            width={(space.width * floorPlan.scale) / 1000}
            height={(space.height * floorPlan.scale) / 1000}
            opacity={floorPlan.opacity / 100}
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
            pointerEvents="none"
          />
        )}

        {/* Non-sellable decoration. Excluded from the seat tab order (FR-040). */}
        {elements.map((el, i) => (
          <g key={`el-${i}`} transform={`rotate(${el.rotation} ${el.x} ${el.y})`} aria-hidden="true" pointerEvents="none">
            {el.kind !== "label" && (
              <rect
                x={el.x - el.width / 2}
                y={el.y - el.height / 2}
                width={el.width}
                height={el.height}
                rx={el.kind === "stage" ? 40 : 8}
                strokeWidth={6}
                strokeDasharray={el.kind === "aisle" ? "40 30" : undefined}
                className={ELEMENT_FILL[el.kind]}
              />
            )}
            {el.label && (
              // Text content, never markup — React escapes it (FR-018, SEC-07).
              <text
                x={el.x}
                y={el.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={Math.max(60, el.height / 3)}
                className="fill-beige-kem/70 font-mono"
              >
                {el.label}
              </text>
            )}
          </g>
        ))}

        {/* Seats, in the payload's section → row → number order, which IS the tab order (FR-039a). */}
        {seats.map((seat) => {
          const label = seatLabel?.(seat) ?? `Ghế ${seat.row}${seat.number}`;
          return (
            <g
              key={seat.id}
              transform={`rotate(${seat.rotation} ${seat.x} ${seat.y})`}
              role={interactive ? "button" : "img"}
              aria-label={label}
              tabIndex={interactive ? 0 : -1}
              onClick={interactive ? () => onSeatActivate?.(seat) : undefined}
              onKeyDown={
                interactive
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        onSeatActivate?.(seat);
                      }
                    }
                  : undefined
              }
              className={interactive ? "cursor-pointer outline-none focus-visible:opacity-80" : ""}
            >
              <title>{label}</title>
              <rect
                x={seat.x - r}
                y={seat.y - r}
                width={space.seatDiameter}
                height={space.seatDiameter}
                rx={r * 0.35}
                strokeWidth={6}
                className={seatClass?.(seat) ?? "fill-transparent stroke-beige-kem/50"}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
