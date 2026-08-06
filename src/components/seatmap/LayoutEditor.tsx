/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Layout, LayoutElement, LayoutSeat, ShapePoint } from "@/shared/catalog/seatmap";
import { type ValidationIssue, validateLayout } from "@/shared/catalog/seatmap-validate";
import { layoutApi, organizerApi } from "../../services/catalogClient";
import {
  type AlignEdge,
  alignSeats,
  arcSeats,
  deleteElement,
  deleteSeats,
  distributeSeats,
  moveElement,
  moveSeats,
  rotateSeats,
  seatsInRect,
  snap,
} from "./layoutOps";
import ElementPalette from "./ElementPalette";
import SectionStylePanel from "./SectionStylePanel";
import TablePalette, { type TableDraft } from "./TablePalette";
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

const btn =
  "rounded-lg border-2 border-beige-kem px-2.5 py-1.5 text-xs font-bold text-beige-kem/80 transition hover:text-beige-kem disabled:opacity-40";
const primary =
  "rounded-lg bg-burgundy px-3 py-1.5 text-xs font-black text-white transition hover:brightness-95 disabled:opacity-40";

export default function LayoutEditor({
  layoutId,
  onClose,
}: {
  layoutId: number;
  onClose: () => void;
}) {
  const [layout, setLayout] = useState<Layout | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [grid, setGrid] = useState(true); // snap on by default (FR-011)
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(
    null,
  );
  /** Which non-sellable element is selected, by index (they have no id until saved). */
  const [selectedElement, setSelectedElement] = useState<number | null>(null);
  /**
   * A drag in progress. The delta is previewed live and committed ONCE on pointer-up, so dragging
   * forty seats across the canvas is a single undo step rather than sixty (FR-012).
   */
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragStart = useRef<{
    x: number;
    y: number;
    kind: "seats" | "element";
    index: number;
    /** The seats to move, captured at grab time — state updated in the same tick is not visible yet. */
    ids: Set<number>;
  } | null>(null);
  const [dragDelta, setDragDelta] = useState<{ dx: number; dy: number } | null>(null);
  /**
   * The visible window in layout units. The canvas used to be hard-wired to the whole 10 000 × 10 000
   * floor, so a 10-seat layout occupied ~1.5% of the frame and every seat rendered as a speck. Seats
   * are drawn at exactly SEAT_DIAMETER because that is the distance the overlap rule uses — making
   * the rectangle bigger would make legal seats look like they collide. Zooming the view is the
   * honest way to make them bigger.
   */
  const [view, setView] = useState<{ x: number; y: number; w: number; h: number }>({
    x: 0,
    y: 0,
    w: 10000,
    h: 10000,
  });
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
        sections: draft.sections.map((s) => ({
          id: s.id ?? 0,
          name: s.name,
          color: s.color,
          seatSizeMultiplier: s.seatSizeMultiplier,
        })),
        elements: draft.elements.map((e) => ({ kind: e.kind, x: e.x, y: e.y, points: e.points })),
      }),
    );
  }, [draft]);

  const overlapping = useMemo(() => {
    const ids = new Set<number>();
    for (const i of issues)
      if (i.code === "overlapping_seats") for (const id of i.seatIds ?? []) ids.add(id);
    return ids;
  }, [issues]);

  // Every operation is ONE commit, so one undo reverses a 40-seat align (FR-012).
  const op = useCallback(
    (fn: (seats: LayoutSeat[]) => LayoutSeat[]) => commit((d) => ({ ...d, seats: fn(d.seats) })),
    [commit],
  );

  /**
   * Placing a table calls the server: it generates the seats, enforces the ceilings and the name
   * collision, and refuses if any seat is already sold or held. The editor then reloads, because the
   * authoritative seat positions came from that call — not from anything the canvas guessed.
   */
  const addTable = async (t: TableDraft) => {
    if (!layout) return;
    setBusy(true);
    setError(null);
    try {
      await layoutApi.addTable(layout.id, t as unknown as Record<string, unknown>);
      const fresh = await layoutApi.get(layout.id);
      setLayout(fresh);
      reset({ sections: fresh.sections, seats: fresh.seats, elements: fresh.elements });
      setStatus(`Đã thêm ${t.name}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * A standing area, like a table, is generated on the SERVER: it writes real seats, so the seat
   * ceiling, the polygon rules and the "area too small" refusal all belong where the data is. The
   * editor reloads afterwards rather than guessing the generated positions.
   */
  const addStandingArea = async (a: {
    sectionId: number;
    rowLabel: string;
    count: number;
    points: ShapePoint[];
  }) => {
    if (!layout) return;
    setBusy(true);
    setError(null);
    try {
      const { created } = await layoutApi.addStandingArea(
        layout.id,
        a as unknown as Record<string, unknown>,
      );
      const fresh = await layoutApi.get(layout.id);
      setLayout(fresh);
      reset({ sections: fresh.sections, seats: fresh.seats, elements: fresh.elements });
      setStatus(`Đã tạo ${created} chỗ đứng.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Section style is ordinary layout content — one commit, one undo step (FR-077). */
  const setSectionStyle = (sectionId: number, patch: Partial<(typeof draft.sections)[number]>) =>
    commit((d) => ({
      ...d,
      sections: d.sections.map((sec) => (sec.id === sectionId ? { ...sec, ...patch } : sec)),
    }));

  const addElement = (el: LayoutElement) =>
    commit((d) => ({ ...d, elements: [...d.elements, el] }));

  /** Frame the drawing: the content's bounding box plus a margin, so seats fill the canvas. */
  const fitToContent = useCallback(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const st of draft.seats) {
      xs.push(st.x);
      ys.push(st.y);
    }
    for (const el of draft.elements) {
      xs.push(el.x - el.width / 2, el.x + el.width / 2);
      ys.push(el.y - el.height / 2, el.y + el.height / 2);
    }
    if (xs.length === 0) {
      setView({ x: 0, y: 0, w: 10000, h: 10000 });
      return;
    }
    const pad = 400;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    // One square window keeps the aspect honest, so a row of seats is never stretched.
    const side = Math.max(Math.max(...xs) - minX + pad, Math.max(...ys) - minY + pad, 800);
    setView({ x: minX, y: minY, w: side, h: side });
  }, [draft.seats, draft.elements]);

  /** Zoom about the centre of the current window. */
  const zoom = (factor: number) =>
    setView((v) => {
      const side = Math.min(20000, Math.max(600, v.w * factor));
      return { x: v.x + (v.w - side) / 2, y: v.y + (v.h - side) / 2, w: side, h: side };
    });

  // Frame the layout once it has loaded, so the editor opens on the drawing rather than on empty floor.
  const framed = useRef(false);
  useEffect(() => {
    if (!framed.current && (draft.seats.length > 0 || draft.elements.length > 0)) {
      framed.current = true;
      fitToContent();
    }
  }, [draft.seats.length, draft.elements.length, fitToContent]);

  /**
   * A colour per SECTION, read from the section's STORED colour (FR-064) rather than derived from its
   * position in the list. Order-derived colour re-coloured the whole map whenever a section was added
   * or removed, and disagreed with the swatch the organizer had actually picked; the stored value is
   * the one thing both the palette and the canvas can agree on.
   *
   * Seats have no tier while drafting — a tier attaches to a section when the layout is applied to a
   * showtime — so the section stays the design-time stand-in for "which price class is this". This
   * colour is editor-only: buyers see colour by PRICE, never by section.
   */
  const sectionPalette = useMemo(() => {
    const byId = new Map<number, string>();
    for (const sec of draft.sections) {
      if (sec.id !== undefined && sec.color) byId.set(sec.id, sec.color);
    }
    return byId;
  }, [draft.sections]);

  /** Seat shape and size per section — the two style fields buyers DO see (FR-064). */
  const sectionForm = useMemo(() => {
    const byId = new Map<number, { shape: string; size: number }>();
    for (const sec of draft.sections) {
      if (sec.id !== undefined) {
        byId.set(sec.id, { shape: sec.seatShape ?? "circle", size: sec.seatSizeMultiplier ?? 1 });
      }
    }
    return byId;
  }, [draft.sections]);

  const sectionName = useMemo(() => {
    const m = new Map<number, string>();
    for (const sec of draft.sections) if (sec.id !== undefined) m.set(sec.id, sec.name);
    return m;
  }, [draft.sections]);

  /** One commit per element operation, same rule as seats. */
  const elementOp = useCallback(
    (fn: (els: LayoutElement[]) => LayoutElement[]) =>
      commit((d) => ({ ...d, elements: fn(d.elements) })),
    [commit],
  );

  /**
   * Pointer-drag. Seats and elements both move by grabbing them, which is what anyone expects of a
   * drawing surface — the arrow buttons below stay because they are the keyboard-reachable path
   * (FR-039a) and give exact one-grid steps.
   */
  const beginDrag = (
    e: React.PointerEvent,
    kind: "seats" | "element",
    index: number,
    ids: Set<number> = new Set(),
  ) => {
    const p = svgRef.current && toLayoutIn(svgRef.current, e.clientX, e.clientY);
    if (!p) return;
    dragStart.current = { x: p.x, y: p.y, kind, index, ids };
    setDragDelta({ dx: 0, dy: 0 });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const endDrag = () => {
    const start = dragStart.current;
    const delta = dragDelta;
    dragStart.current = null;
    setDragDelta(null);
    // A click without movement is a selection, not a move — do not push an empty undo step.
    if (!start || !delta || (delta.dx === 0 && delta.dy === 0)) return;
    if (start.kind === "seats")
      op((seats) => moveSeats(seats, start.ids, delta.dx, delta.dy, grid));
    else elementOp((els) => moveElement(els, start.index, delta.dx, delta.dy, grid));
  };

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

  const selectedCount = selected.size;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-xanh-pho">
      <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 text-beige-kem">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-black">{layout.name}</h2>
          <div className="flex flex-wrap gap-2">
            <button onClick={undo} disabled={!canUndo} className={btn}>
              ↶ Hoàn tác
            </button>
            <button onClick={redo} disabled={!canRedo} className={btn}>
              ↷ Làm lại
            </button>
            <button onClick={() => setGrid((g) => !g)} className={btn}>
              {grid ? "Bám lưới: BẬT" : "Bám lưới: TẮT"}
            </button>
            <button onClick={save} disabled={busy} className={primary}>
              Lưu nháp
            </button>
            <button onClick={publish} disabled={busy || issues.length > 0} className={primary}>
              Phát hành
            </button>
            <button onClick={toggleTemplate} disabled={busy} className={btn}>
              {layout.isTemplate ? "★ Mẫu" : "☆ Lưu làm mẫu"}
            </button>
            <button onClick={() => setCloning(true)} className={btn}>
              Nhân bản
            </button>
            <button onClick={onClose} className={btn}>
              Đóng
            </button>
          </div>
        </div>

        {cloning && (
          <div className="rounded-xl border-2 border-beige-kem bg-surface-2 p-3">
            <p className="mb-2 font-mono text-[11px] text-beige-kem/60">
              Nhân bản sang một địa điểm khác của bạn. Bản sao là bản nháp độc lập — không mang theo
              vé đã bán hay lượt giữ nào.
            </p>
            <div className="flex flex-wrap gap-2">
              <select
                onFocus={() =>
                  venues.length === 0 && void organizerApi.myVenues().then((v) => setVenues(v))
                }
                onChange={(e) => {
                  const targetVenueId = Number(e.target.value);
                  if (!targetVenueId) return;
                  setBusy(true);
                  void layoutApi
                    .clone(layout.id, { targetVenueId, name: `${layout.name} (bản sao)` })
                    .then(() => {
                      setStatus("Đã nhân bản sơ đồ.");
                      setCloning(false);
                    })
                    .catch((err2) => setError((err2 as Error).message))
                    .finally(() => setBusy(false));
                }}
                defaultValue=""
                className="h-9 rounded-lg border-2 border-beige-kem bg-surface-2 px-2 text-xs text-beige-kem"
              >
                <option value="" className="bg-xanh-pho">
                  Chọn địa điểm đích
                </option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id} className="bg-xanh-pho">
                    {v.name}
                  </option>
                ))}
              </select>
              <button onClick={() => setCloning(false)} className={btn}>
                Huỷ
              </button>
            </div>
          </div>
        )}

        {status && (
          <div className="rounded-xl border-2 border-beige-kem bg-la-co p-3 text-xs text-on-tint">
            {status}
          </div>
        )}
        {error && (
          <div className="rounded-xl border-2 border-beige-kem bg-bubblegum p-3 text-xs text-on-tint">
            {error}
          </div>
        )}

        {/* Selection tools. Disabled until a selection exists so the affordance is honest. */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-beige-kem/40 p-3">
          <span className="font-mono text-[11px] text-beige-kem/60">
            Đã chọn {selectedCount} ghế
          </span>
          {(["left", "centerX", "right", "top", "centerY", "bottom"] as AlignEdge[]).map((edge) => (
            <button
              key={edge}
              disabled={selectedCount < 2}
              className={btn}
              onClick={() => op((s) => alignSeats(s, selected, edge))}
            >
              {edge}
            </button>
          ))}
          <button
            disabled={selectedCount < 3}
            className={btn}
            onClick={() => op((s) => distributeSeats(s, selected))}
          >
            Dàn đều
          </button>
          <button
            disabled={selectedCount < 1}
            className={btn}
            onClick={() => op((s) => rotateSeats(s, selected, 15))}
          >
            Xoay +15°
          </button>
          <button
            disabled={selectedCount < 2}
            className={btn}
            onClick={() => op((s) => arcSeats(s, selected, 400))}
          >
            Uốn cong
          </button>
          <button
            disabled={selectedCount < 2}
            className={btn}
            onClick={() => op((s) => arcSeats(s, selected, -400))}
          >
            Uốn ngược
          </button>
          <button
            disabled={selectedCount < 1}
            className={btn}
            onClick={() => {
              op((s) => deleteSeats(s, selected));
              setSelected(new Set());
            }}
          >
            Xoá ghế
          </button>
          <button
            disabled={selectedElement === null}
            className={btn}
            onClick={() => {
              if (selectedElement === null) return;
              elementOp((els) => deleteElement(els, selectedElement));
              setSelectedElement(null);
            }}
          >
            Xoá thành phần
          </button>
        </div>

        <p className="font-mono text-[11px] text-beige-kem/55">
          Kéo chuột vào ghế hoặc thành phần để di chuyển. Kéo trên nền trống để chọn nhiều ghế; giữ
          Shift để chọn thêm. Các nút mũi tên bên dưới di chuyển từng ô lưới. Màu ghế theo khu vực;
          dùng “Resize" để phóng vào phần đã vẽ.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button className={btn} onClick={fitToContent}>
            Resize 
          </button>
          <button className={btn} onClick={() => zoom(0.75)}>
            Phóng to +
          </button>
          <button className={btn} onClick={() => zoom(1 / 0.75)}>
            Thu nhỏ −
          </button>
          <button className={btn} onClick={() => setView({ x: 0, y: 0, w: 10000, h: 10000 })}>
            Toàn mặt bằng
          </button>

          {/* Each section becomes one ticket tier when the layout is applied to a showtime, so the
              colours here are the design-time preview of the price classes. */}
          {draft.sections.length > 0 && (
            <div className="ml-auto flex flex-wrap items-center gap-3">
              <span className="font-mono text-[11px] text-beige-kem/50">Khu vực → hạng vé:</span>
              {draft.sections.map((sec) => {
                const tone = sec.id !== undefined ? sectionPalette.get(sec.id) : undefined;
                return (
                  <span key={sec.id ?? sec.name} className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-3 w-3 rounded"
                      style={{ backgroundColor: tone ?? "rgba(233,225,204,0.3)" }}
                    />
                    <span className="font-mono text-[11px] text-beige-kem/70">{sec.name}</span>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-2xl border-2 border-beige-kem bg-surface-2 p-3">
            <svg
              ref={svgRef}
              viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
              className="w-full touch-none select-none"
              style={{ maxHeight: "70vh" }}
              onPointerDown={(e) => {
                // Empty canvas: start a marquee, and clear any element selection.
                setSelectedElement(null);
                const p = toLayout(e);
                if (p) setMarquee({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
              }}
              onPointerMove={(e) => {
                const start = dragStart.current;
                if (start) {
                  const p = toLayout(e);
                  if (p) setDragDelta({ dx: p.x - start.x, dy: p.y - start.y });
                  return;
                }
                if (!marquee) return;
                const p = toLayout(e);
                if (p) setMarquee((m) => (m ? { ...m, x2: p.x, y2: p.y } : m));
              }}
              onPointerUp={() => {
                if (dragStart.current) {
                  endDrag();
                  return;
                }
                if (marquee) setSelected(new Set(seatsInRect(draft.seats, marquee)));
                setMarquee(null);
              }}
              onPointerLeave={() => {
                // Releasing outside the canvas must still land the move, not silently discard it.
                if (dragStart.current) endDrag();
              }}
            >
              {draft.elements.map((el, i) => {
                // Dragged elements follow the pointer live; everything else stays put.
                const d =
                  dragStart.current?.kind === "element" && dragStart.current.index === i
                    ? dragDelta
                    : null;
                const ex = el.x + (d?.dx ?? 0);
                const ey = el.y + (d?.dy ?? 0);
                const isSel = selectedElement === i;
                return (
                  <g
                    key={`e${i}`}
                    transform={`rotate(${el.rotation} ${ex} ${ey})`}
                    style={{ cursor: "grab" }}
                  >
                    <rect
                      x={ex - el.width / 2}
                      y={ey - el.height / 2}
                      width={el.width}
                      height={el.height}
                      rx={el.kind === "stage" ? 40 : 8}
                      className={
                        isSel
                          ? "fill-burgundy/20 stroke-burgundy"
                          : "fill-beige-kem/10 stroke-beige-kem/40"
                      }
                      strokeWidth={6}
                      onPointerDown={(e) => {
                        // Stop the canvas from starting a marquee under us.
                        e.stopPropagation();
                        setSelectedElement(i);
                        setSelected(new Set());
                        beginDrag(e, "element", i);
                      }}
                    />
                    {el.label && (
                      <text
                        x={ex}
                        y={ey}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={120}
                        className="fill-beige-kem/70"
                        pointerEvents="none"
                      >
                        {el.label}
                      </text>
                    )}
                  </g>
                );
              })}

              {draft.seats.map((seat) => {
                const id = seat.id ?? -1;
                const isSel = selected.has(id);
                const bad = overlapping.has(id);
                // Selected seats follow the pointer live while a seat drag is running.
                const d =
                  dragStart.current?.kind === "seats" && dragStart.current.ids.has(id)
                    ? dragDelta
                    : null;
                const sx = seat.x + (d?.dx ?? 0);
                const sy = seat.y + (d?.dy ?? 0);
                const tone =
                  seat.sectionId !== null ? sectionPalette.get(seat.sectionId) : undefined;
                const form =
                  seat.sectionId !== null ? sectionForm.get(seat.sectionId) : undefined;
                // Overlap and selection outrank the section colour: they are what needs acting on, and
                // an unusable map must read as unusable whatever the organizer styled it.
                const skin = bad
                  ? "fill-bubblegum/50 stroke-bubblegum"
                  : isSel
                    ? "fill-burgundy/50 stroke-burgundy"
                    : "stroke-beige-kem/40";
                const paint =
                  bad || isSel || !tone ? undefined : { fill: tone, fillOpacity: 0.45, stroke: tone };
                // The section's size multiplier, so the drawn seat matches the footprint the publish
                // gate measures for overlap (FR-065).
                const k = form?.size ?? 1;
                const square = form?.shape === "square";
                return (
                  <g
                    key={id}
                    transform={`rotate(${seat.rotation} ${sx} ${sy})`}
                    style={{ cursor: "grab" }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setSelectedElement(null);
                      // Grabbing a seat that is already part of a multi-selection drags the WHOLE
                      // selection; grabbing an unselected one selects just it first.
                      const next = selected.has(id)
                        ? selected
                        : new Set(e.shiftKey ? [...selected, id] : [id]);
                      setSelected(next);
                      beginDrag(e, "seats", id, next);
                    }}
                  >
                    {/* A chair read from above: backrest behind, cushion in front. The whole glyph
                        stays inside the seat's effective diameter, so what you see is what the overlap
                        rule measures. A `square` section drops the backrest for a plain block. */}
                    {!square && (
                      <rect
                        x={sx - 46 * k}
                        y={sy - 48 * k}
                        width={92 * k}
                        height={26 * k}
                        rx={10 * k}
                        strokeWidth={6}
                        className={skin}
                        style={paint}
                      />
                    )}
                    <rect
                      x={sx - 40 * k}
                      y={sy - (square ? 40 : 18) * k}
                      width={80 * k}
                      height={(square ? 80 : 58) * k}
                      rx={(square ? 8 : 16) * k}
                      strokeWidth={7}
                      className={skin}
                      style={paint}
                    />
                    {/* Invisible hit area — a thin chair is hard to grab otherwise. */}
                    <rect
                      x={sx - 50 * k}
                      y={sy - 50 * k}
                      width={100 * k}
                      height={100 * k}
                      fill="transparent"
                    />
                  </g>
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
              {(
                [
                  [-100, 0, "←"],
                  [100, 0, "→"],
                  [0, -100, "↑"],
                  [0, 100, "↓"],
                ] as const
              ).map(([dx, dy, glyph]) => (
                <button
                  key={glyph}
                  disabled={selectedCount < 1}
                  className={btn}
                  onClick={() =>
                    op((s) => moveSeats(s, selected, snap(dx, grid), snap(dy, grid), grid))
                  }
                >
                  {glyph}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <ValidationPanel issues={issues} />
            <TablePalette
              sections={draft.sections}
              tables={layout?.tables ?? []}
              onAddTable={addTable}
              onAddElement={addElement}
              onAddStandingArea={addStandingArea}
              busy={busy}
            />
            <SectionStylePanel sections={draft.sections} onChange={setSectionStyle} />
            <ElementPalette onAdd={addElement} />
            <FloorPlanPanel
              layoutId={layout.id}
              plan={layout.floorPlan}
              onChange={(fp) => setLayout({ ...layout, floorPlan: fp })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Pointer position in layout units. */
function toLayout(e: React.PointerEvent<SVGSVGElement>): { x: number; y: number } | null {
  return toLayoutIn(e.currentTarget, e.clientX, e.clientY);
}

/**
 * Client pixels → layout units, via the SVG's own screen matrix.
 *
 * The old version divided by the bounding rect and assumed the viewBox filled it exactly. That was
 * already slightly wrong whenever the canvas was not square (preserveAspectRatio letterboxes), and it
 * would break outright now that the viewBox pans and zooms. `getScreenCTM()` knows about all of it.
 */
function toLayoutIn(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}
