/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Layout, LayoutElement, LayoutSeat } from "@/shared/catalog/seatmap";
import { type ValidationIssue, validateLayout } from "@/shared/catalog/seatmap-validate";
import { layoutApi, organizerApi } from "../../services/catalogClient";
import {
  type AlignEdge,
  alignSeats,
  arcSeats,
  deleteSeats,
  distributeSeats,
  moveSeats,
  rotateSeats,
  seatsInRect,
  snap,
} from "./layoutOps";
import ElementPalette from "./ElementPalette";
import FloorPlanPanel from "./FloorPlanPanel";
import ValidationPanel from "./ValidationPanel";
import { useLayoutHistory } from "./useLayoutHistory";

/**
 * The seat-map authoring canvas (FR-009..FR-014).
 *
 * A layout editor, not a CAD program (Principle V): place, drag, marquee-select, align, distribute,
 * rotate, arc, delete — and nothing more. Editing a layout is never gated on inventory, because a
 * showtime's generated map is a snapshot (FR-005, FR-027); the only inventory-aware action here is
 * re-applying to a chosen showtime, which previews first.
 */

const btn = "rounded-lg border-2 border-beige-kem px-2.5 py-1.5 text-xs font-bold text-beige-kem/80 transition hover:text-beige-kem disabled:opacity-40";
const primary = "rounded-lg bg-burgundy px-3 py-1.5 text-xs font-black text-white transition hover:brightness-95 disabled:opacity-40";

export default function LayoutEditor({ layoutId, onClose }: { layoutId: number; onClose: () => void }) {
  const [layout, setLayout] = useState<Layout | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [grid, setGrid] = useState(true); // snap on by default (FR-011)
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [venues, setVenues] = useState<{ id: number; name: string }[]>([]);

  const history = useLayoutHistory({ sections: [], seats: [], elements: [] });
  const { draft, commit, reset, undo, redo, canUndo, canRedo } = history;

  useEffect(() => {
    layoutApi
      .get(layoutId)
      .then((l) => {
        setLayout(l);
        reset({ sections: l.sections, seats: l.seats, elements: l.elements });
      })
      .catch((e) => setError((e as Error).message));
  }, [layoutId, reset]);

  // Live feedback from the SAME validator the server runs, so the editor can never disagree with the
  // publish gate about what "overlapping" means. Advisory — the server still decides (R-11).
  useEffect(() => {
    setIssues(
      validateLayout({
        seats: draft.seats.map((s) => ({
          id: s.id ?? 0,
          sectionId: s.sectionId,
          rowLabel: s.rowLabel,
          seatNumber: s.seatNumber,
          x: s.x,
          y: s.y,
        })),
        sections: draft.sections.map((s) => ({ id: s.id ?? 0, name: s.name })),
      }),
    );
  }, [draft]);

  const overlapping = useMemo(() => {
    const ids = new Set<number>();
    for (const i of issues) if (i.code === "overlapping_seats") for (const id of i.seatIds ?? []) ids.add(id);
    return ids;
  }, [issues]);

  // Every operation is ONE commit, so one undo reverses a 40-seat align (FR-012).
  const op = useCallback(
    (fn: (seats: LayoutSeat[]) => LayoutSeat[]) => commit((d) => ({ ...d, seats: fn(d.seats) })),
    [commit],
  );

  const addElement = (el: LayoutElement) => commit((d) => ({ ...d, elements: [...d.elements, el] }));

  const save = async () => {
    if (!layout) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await layoutApi.save(layout.id, {
        version: layout.version,
        sections: draft.sections,
        seats: draft.seats,
        elements: draft.elements,
      });
      setLayout(saved);
      reset({ sections: saved.sections, seats: saved.seats, elements: saved.elements });
      setStatus("Đã lưu bản nháp.");
    } catch (e) {
      // A stale version means another session saved first — reload rather than overwrite (FR-015).
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Offer this layout as a starting point for new ones (FR-036). */
  const toggleTemplate = async () => {
    if (!layout) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await layoutApi.save(layout.id, {
        version: layout.version,
        isTemplate: !layout.isTemplate,
        sections: draft.sections,
        seats: draft.seats,
        elements: draft.elements,
      });
      setLayout(saved);
      setStatus(saved.isTemplate ? "Đã lưu làm mẫu." : "Đã bỏ đánh dấu mẫu.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!layout) return;
    setBusy(true);
    setError(null);
    try {
      const published = await layoutApi.publish(layout.id);
      setLayout(published);
      setStatus("Đã phát hành sơ đồ.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !layout) return <p className="p-6 text-sm text-on-tint">{error}</p>;
  if (!layout) return <p className="p-6 font-mono text-xs text-beige-kem/60">Đang tải sơ đồ…</p>;

  const space = 10000;
  const selectedCount = selected.size;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-xanh-pho">
      <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 text-beige-kem">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-black">{layout.name}</h2>
          <div className="flex flex-wrap gap-2">
            <button onClick={undo} disabled={!canUndo} className={btn}>↶ Hoàn tác</button>
            <button onClick={redo} disabled={!canRedo} className={btn}>↷ Làm lại</button>
            <button onClick={() => setGrid((g) => !g)} className={btn}>
              {grid ? "Bám lưới: BẬT" : "Bám lưới: TẮT"}
            </button>
            <button onClick={save} disabled={busy} className={primary}>Lưu nháp</button>
            <button onClick={publish} disabled={busy || issues.length > 0} className={primary}>Phát hành</button>
            <button onClick={toggleTemplate} disabled={busy} className={btn}>
              {layout.isTemplate ? "★ Mẫu" : "☆ Lưu làm mẫu"}
            </button>
            <button onClick={() => setCloning(true)} className={btn}>Nhân bản</button>
            <button onClick={onClose} className={btn}>Đóng</button>
          </div>
        </div>

        {cloning && (
          <div className="rounded-xl border-2 border-beige-kem bg-surface-2 p-3">
            <p className="mb-2 font-mono text-[11px] text-beige-kem/60">
              Nhân bản sang một địa điểm khác của bạn. Bản sao là bản nháp độc lập — không mang theo vé
              đã bán hay lượt giữ nào.
            </p>
            <div className="flex flex-wrap gap-2">
              <select
                onFocus={() => venues.length === 0 && void organizerApi.myVenues().then((v) => setVenues(v))}
                onChange={(e) => {
                  const targetVenueId = Number(e.target.value);
                  if (!targetVenueId) return;
                  setBusy(true);
                  void layoutApi
                    .clone(layout.id, { targetVenueId, name: `${layout.name} (bản sao)` })
                    .then(() => { setStatus("Đã nhân bản sơ đồ."); setCloning(false); })
                    .catch((err2) => setError((err2 as Error).message))
                    .finally(() => setBusy(false));
                }}
                defaultValue=""
                className="h-9 rounded-lg border-2 border-beige-kem bg-surface-2 px-2 text-xs text-beige-kem"
              >
                <option value="" className="bg-xanh-pho">Chọn địa điểm đích</option>
                {venues.map((v) => <option key={v.id} value={v.id} className="bg-xanh-pho">{v.name}</option>)}
              </select>
              <button onClick={() => setCloning(false)} className={btn}>Huỷ</button>
            </div>
          </div>
        )}

        {status && <div className="rounded-xl border-2 border-beige-kem bg-la-co p-3 text-xs text-on-tint">{status}</div>}
        {error && <div className="rounded-xl border-2 border-beige-kem bg-bubblegum p-3 text-xs text-on-tint">{error}</div>}

        {/* Selection tools. Disabled until a selection exists so the affordance is honest. */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-beige-kem/40 p-3">
          <span className="font-mono text-[11px] text-beige-kem/60">Đã chọn {selectedCount} ghế</span>
          {(["left", "centerX", "right", "top", "centerY", "bottom"] as AlignEdge[]).map((edge) => (
            <button key={edge} disabled={selectedCount < 2} className={btn} onClick={() => op((s) => alignSeats(s, selected, edge))}>
              {edge}
            </button>
          ))}
          <button disabled={selectedCount < 3} className={btn} onClick={() => op((s) => distributeSeats(s, selected))}>Dàn đều</button>
          <button disabled={selectedCount < 1} className={btn} onClick={() => op((s) => rotateSeats(s, selected, 15))}>Xoay +15°</button>
          <button disabled={selectedCount < 2} className={btn} onClick={() => op((s) => arcSeats(s, selected, 400))}>Uốn cong</button>
          <button disabled={selectedCount < 2} className={btn} onClick={() => op((s) => arcSeats(s, selected, -400))}>Uốn ngược</button>
          <button disabled={selectedCount < 1} className={btn} onClick={() => { op((s) => deleteSeats(s, selected)); setSelected(new Set()); }}>Xoá ghế</button>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-2xl border-2 border-beige-kem bg-surface-2 p-3">
            <svg
              viewBox={`0 0 ${space} ${space}`}
              className="w-full touch-none select-none"
              style={{ maxHeight: "70vh" }}
              onPointerDown={(e) => {
                const p = toLayout(e);
                if (p) setMarquee({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
              }}
              onPointerMove={(e) => {
                if (!marquee) return;
                const p = toLayout(e);
                if (p) setMarquee((m) => (m ? { ...m, x2: p.x, y2: p.y } : m));
              }}
              onPointerUp={() => {
                if (marquee) setSelected(new Set(seatsInRect(draft.seats, marquee)));
                setMarquee(null);
              }}
            >
              {draft.elements.map((el, i) => (
                <g key={`e${i}`} transform={`rotate(${el.rotation} ${el.x} ${el.y})`} pointerEvents="none">
                  <rect
                    x={el.x - el.width / 2}
                    y={el.y - el.height / 2}
                    width={el.width}
                    height={el.height}
                    rx={el.kind === "stage" ? 40 : 8}
                    className="fill-beige-kem/10 stroke-beige-kem/40"
                    strokeWidth={6}
                  />
                  {el.label && (
                    <text x={el.x} y={el.y} textAnchor="middle" dominantBaseline="central" fontSize={120} className="fill-beige-kem/70">
                      {el.label}
                    </text>
                  )}
                </g>
              ))}

              {draft.seats.map((seat) => {
                const id = seat.id ?? -1;
                const isSel = selected.has(id);
                const bad = overlapping.has(id);
                return (
                  <rect
                    key={id}
                    x={seat.x - 50}
                    y={seat.y - 50}
                    width={100}
                    height={100}
                    rx={35}
                    transform={`rotate(${seat.rotation} ${seat.x} ${seat.y})`}
                    strokeWidth={8}
                    className={
                      bad
                        ? "fill-bubblegum/40 stroke-bubblegum"
                        : isSel
                          ? "fill-burgundy/40 stroke-burgundy"
                          : "fill-transparent stroke-beige-kem/50"
                    }
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setSelected((cur) => {
                        const next = new Set(e.shiftKey ? cur : []);
                        next.add(id);
                        return next;
                      });
                    }}
                  />
                );
              })}

              {marquee && (
                <rect
                  x={Math.min(marquee.x1, marquee.x2)}
                  y={Math.min(marquee.y1, marquee.y2)}
                  width={Math.abs(marquee.x2 - marquee.x1)}
                  height={Math.abs(marquee.y2 - marquee.y1)}
                  className="fill-burgundy/10 stroke-burgundy/60"
                  strokeWidth={6}
                  pointerEvents="none"
                />
              )}
            </svg>

            {/* Nudge: keyboard-reachable movement for a selection, and the snap toggle applies here. */}
            <div className="mt-2 flex gap-2">
              {([[-100, 0, "←"], [100, 0, "→"], [0, -100, "↑"], [0, 100, "↓"]] as const).map(([dx, dy, glyph]) => (
                <button
                  key={glyph}
                  disabled={selectedCount < 1}
                  className={btn}
                  onClick={() => op((s) => moveSeats(s, selected, snap(dx, grid), snap(dy, grid), grid))}
                >
                  {glyph}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <ValidationPanel issues={issues} />
            <ElementPalette onAdd={addElement} />
            <FloorPlanPanel layoutId={layout.id} plan={layout.floorPlan} onChange={(fp) => setLayout({ ...layout, floorPlan: fp })} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Pointer position in layout units. */
function toLayout(e: React.PointerEvent<SVGSVGElement>): { x: number; y: number } | null {
  const svg = e.currentTarget;
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return {
    x: ((e.clientX - rect.left) / rect.width) * 10000,
    y: ((e.clientY - rect.top) / rect.height) * 10000,
  };
}
