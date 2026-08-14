/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  SeatMapElement,
  SeatMapFloorPlan,
  SeatMapSpace,
  SeatMapTable,
} from "@/shared/catalog/types";
import { readableInk, rowMarkers } from "./layoutOps";

/**
 * The one surface that turns layout coordinates into pixels (research R-4).
 *
 * Used by the organizer's editor AND both buyer renderers, which is the structural reason the event
 * page's preview, the seat-selection screen and the canvas the organizer drew on can never disagree
 * about where a seat is — there is only one piece of code that places one. Everything below the
 * rendering exists to keep that true now that the editor authors ON this canvas rather than in an
 * SVG of its own: the editor's gestures are props here, not a second renderer.
 *
 * SVG rather than <canvas> on purpose:
 *   - `viewBox` gives resolution-independent scaling (PLAT-01, 360–1920 px) and zoom/pan for free;
 *   - real DOM nodes keep every seat focusable and labelled (FR-039a). A bitmap canvas would
 *     silently destroy the keyboard reach today's button grid has by accident, and nothing in the
 *     test suite would notice.
 */

const DEFAULT_SPACE: SeatMapSpace = { width: 10000, height: 10000, seatDiameter: 100 };

/**
 * Seat count above which the canvas draws only what the viewport shows.
 *
 * Set well clear of a normal cinema or theatre, so the venues this platform sees every day render
 * exactly as they did and the optimisation cannot be the cause of a bug reported against them.
 */
const CULL_ABOVE = 400;

/**
 * The least a shape has to be to get drawn here.
 *
 * `SeatMapSeat` (the buyer's read contract) satisfies it as-is; the editor adapts its `LayoutSeat`
 * draft onto it. That adapter is the seam that lets one renderer serve a document being edited and a
 * showtime being sold from. `shape` and `sizeMultiplier` are optional because a pre-amendment
 * snapshot has neither and must still render (FR-064).
 */
export interface CanvasSeat {
  id: number;
  x: number;
  y: number;
  rotation: number;
  row: string;
  number: number;
  section: string | null;
  shape?: "circle" | "square";
  sizeMultiplier?: number;
  /**
   * `single` or `double` — a love seat, one unit seating two. Absent means `single`, which is what
   * the column defaults to, so a snapshot taken before this existed still renders.
   */
  seatType?: "single" | "double" | "standing";
  /** Drawn with a wheelchair mark, on every screen — a buyer needs this more than an organizer. */
  isAccessible?: boolean;
}

/** A named group of seats, drawn as a titled hull behind them. */
export interface CanvasBlock {
  id: number | string;
  name: string;
  color: string;
}

export interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Imperative view control. The editor's section list and the buyer's section chips both drive it. */
export interface SeatCanvasHandle {
  zoomToVenue(): void;
  zoomToBlock(blockId: number | string): void;
  zoomToSeat(seatId: number): void;
  /** Layout coordinates for a client point — for editors that place things where the pointer is. */
  toLayout(clientX: number, clientY: number): { x: number; y: number } | null;
}

export interface SeatCanvasProps<T extends CanvasSeat> {
  seats: T[];
  elements?: SeatMapElement[];
  floorPlan?: SeatMapFloorPlan | null;
  space?: SeatMapSpace;
  /** Snapshotted tables, drawn beneath the seats so "Bàn 5 - Ghế 3" has a table (FR-082). */
  tables?: SeatMapTable[];

  /** Section grouping. Omit for a flat map. */
  blocks?: CanvasBlock[];
  /** Which block a seat sits in. Defaults to matching `seat.section` against the block name. */
  seatBlockId?: (seat: T) => number | string | null;

  /** Per-seat fill/stroke classes, by seat id. */
  seatClass?: (seat: T) => string;
  /**
   * Per-seat fill colour, for colouring by PRICE TIER (FR-067). Returned as a colour rather than a
   * class because tier colours are derived from the tier list at read time, not from a fixed set.
   * Status still outranks it: the caller returns undefined for a seat that is not available, so a
   * sold or held seat keeps its unavailable styling whatever it costs (FR-068).
   */
  seatFill?: (seat: T) => string | undefined;
  /**
   * Per-seat stroke colour. Only the editor uses it, to outline a seat in its section's colour —
   * which is an editor-only aid, because on the buyer's map colour means price and nothing else
   * (FR-064).
   */
  seatStroke?: (seat: T) => string | undefined;
  /** Accessible label — what a screen reader announces for this seat (FR-039a). */
  seatLabel?: (seat: T) => string;
  /** Hover card contents. Omit for no tooltip. */
  seatTooltip?: (seat: T) => ReactNode;

  onSeatActivate?: (seat: T) => void;
  /** False for the read-only preview: seats are drawn but not focusable or clickable. */
  interactive?: boolean;
  /**
   * Whether the viewBox tracks the content, or stays the whole coordinate space.
   *
   * `true` (the default, and what a viewer wants) frames the seats that exist, so a small venue is not
   * lost in a 10,000-unit space.
   *
   * `false` is for AUTHORING. With content-fitting on, the viewBox is recomputed from the seats and
   * elements present, so every add, delete or outward drag rescales the whole map — place a stage near
   * an edge and the chart you were working on visibly shrinks. One unit is then worth a different number
   * of pixels from one edit to the next, which makes judging a size or a gap impossible. Pinning the box
   * to the space keeps the ratio constant no matter what is added; "fit to frame" is still there for
   * when the organizer actually wants to re-frame.
   */
  fitContent?: boolean;
  /**
   * Draw each row's letter at the end of the row. On by default, on every screen.
   *
   * A buyer needs it at least as much as an organizer: a ticket says "K12", and until now the chart
   * that ticket refers to showed the 12 and never the K. Off is for a map with no meaningful rows —
   * a standing-only floor, or a thumbnail too small to read them.
   */
  showRowLabels?: boolean;

  // ---- Authoring (FR-009..FR-014). All inert unless `editable`. ----
  editable?: boolean;
  selectedIds?: ReadonlySet<number>;
  /** Fired before a drag begins, so the editor can adjust the selection first. */
  /** `alt` asks for SEAT-level intent rather than block-level — see `ChartEditor`. Optional so the
   *  showtime map, which only ever selects seats, need not care. */
  onSeatPointerDown?: (seat: T, additive: boolean, alt?: boolean) => void;
  /** Cumulative drag offset in LAYOUT units. `end` is the one the editor commits to history. */
  onSeatDrag?: (dx: number, dy: number, phase: "move" | "end") => void;
  /**
   * Decoration is interactive too, but ONLY while editing.
   *
   * Elements and tables are `pointerEvents="none"` for a buyer on purpose — a stage is not something
   * you can book, and letting it swallow a tap next to the front row is a real misclick. Editing is
   * the one context where grabbing them is the whole job, so the handlers below are gated on
   * `editable` rather than always live.
   */
  selectedElementIndex?: number | null;
  onElementPointerDown?: (index: number, additive: boolean) => void;
  /**
   * Drag one vertex of the selected polygon (the Nodes tool).
   *
   * Optional, and undefined on all three non-authoring screens, so the handles simply do not render
   * there. That is the rule for anything editor-only in this file: it draws the buyer's map too, and
   * a control a buyer can reach is a control a buyer can break.
   */
  onVertexDrag?: (elementIndex: number, vertex: number, x: number, y: number) => void;
  onElementDrag?: (dx: number, dy: number, phase: "move" | "end") => void;
  onTablePointerDown?: (index: number) => void;
  /**
   * Drag a whole table, seats and all.
   *
   * Paired with `onTablePointerDown`: without a drag handler a table could be selected but not moved,
   * which is exactly the state this file was left in — every table dropped at the centre of the map
   * and nothing able to separate them.
   */
  onTableDrag?: (dx: number, dy: number, phase: "move" | "end") => void;
  /** Which table is selected, so the editor can show what Delete would remove. Editor-only. */
  selectedTableIndex?: number | null;
  /**
   * A completed drag across empty space. `x1,y1` is where it started and `x2,y2` where it ended —
   * un-normalised on purpose, because a drawing tool cares which end is which and a marquee does not.
   */
  onMarquee?: (rect: Rect, additive: boolean, alt?: boolean) => void;
  /** The same rectangle, live, for tools that preview what they are about to create. */
  onMarqueeChange?: (rect: Rect | null) => void;
  /** `none` hands the drawing of the drag entirely to `underlay`, for tools that are not selecting. */
  marqueeStyle?: "rect" | "none";
  /** A click on empty space that was not a drag — the deselect gesture. */
  onBackgroundClick?: (point: { x: number; y: number }, additive: boolean) => void;

  /** Extra SVG in layout coordinates, drawn under the seats (guides, tool previews). */
  underlay?: ReactNode;
  /** Extra SVG in layout coordinates, drawn over everything (handles, badges). */
  overlay?: ReactNode;

  /** Row/number written inside each seat. `auto` shows them once seats are big enough to hold text. */
  seatNumbers?: "auto" | "always" | "never";
  className?: string;
  /** Tailwind max-height for the drawing area. */
  heightClass?: string;
}

const ELEMENT_FILL: Record<SeatMapElement["kind"], string> = {
  stage: "fill-beige-kem/20 stroke-beige-kem/40",
  aisle: "fill-transparent stroke-beige-kem/20",
  door: "fill-la-co/20 stroke-la-co/50",
  bar: "fill-cam-dat/15 stroke-cam-dat/40",
  label: "fill-transparent stroke-transparent",
  area: "fill-beige-kem/5 stroke-beige-kem/30",
  // Hall outline and dividers — drawn behind the seats, never interactive (FR-060).
  boundary: "fill-transparent stroke-beige-kem/45",
  divider: "fill-transparent stroke-beige-kem/35",
  // Facility icons (FR-062).
  exit: "fill-la-co/20 stroke-la-co/60",
  restroom: "fill-beige-kem/10 stroke-beige-kem/50",
  food_drink: "fill-cam-dat/15 stroke-cam-dat/50",
  smoking: "fill-beige-kem/10 stroke-beige-kem/40",
  first_aid: "fill-bubblegum/20 stroke-bubblegum/60",
  lift_stairs: "fill-beige-kem/10 stroke-beige-kem/40",
  wheelchair: "fill-la-co/15 stroke-la-co/50",
};

/** Kinds drawn from a point list rather than a rectangle (FR-058). */
const SHAPE_KINDS = new Set(["boundary", "divider"]);

const ZOOM_MIN = 1;
const ZOOM_MAX = 16;
/** Below this the seat is smaller than the text would be, so `auto` keeps the numbers off. */
const NUMBER_VISIBILITY_THRESHOLD = 0.022;
/** A pointer that moved less than this (in layout units) was a click, not a drag. */
const CLICK_SLOP = 30;

interface Gesture {
  kind: "pan" | "marquee" | "seat" | "element" | "table";
  clientX: number;
  clientY: number;
  originX: number;
  originY: number;
  moved: boolean;
  additive: boolean;
  /** Held at press time: the editor reads it as "act on seats, not blocks". */
  alt: boolean;
}

function SeatCanvasInner<T extends CanvasSeat>(
  {
    seats,
    elements = [],
    floorPlan = null,
    space = DEFAULT_SPACE,
    tables = [],
    blocks,
    seatBlockId,
    seatClass,
    seatFill,
    seatStroke,
    seatLabel,
    seatTooltip,
    onSeatActivate,
    interactive = false,
    fitContent = true,
    showRowLabels = true,
    editable = false,
    selectedIds,
    onSeatPointerDown,
    onSeatDrag,
    selectedElementIndex = null,
    onElementPointerDown,
    onVertexDrag,
    onElementDrag,
    onTableDrag,
    selectedTableIndex = null,
    onTablePointerDown,
    onMarquee,
    onMarqueeChange,
    marqueeStyle = "rect",
    onBackgroundClick,
    underlay,
    overlay,
    seatNumbers = "auto",
    className = "",
    heightClass = "max-h-[70vh]",
  }: SeatCanvasProps<T>,
  ref: React.Ref<SeatCanvasHandle>,
) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [hover, setHover] = useState<{ seat: T; left: number; top: number } | null>(null);
  /** Drives the cursor only. Mirrors the live gesture, as state rather than as a ref read, because a
   *  cursor is something the render decides and a ref is not. */
  const [panning, setPanning] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);

  // What the drawn content occupies, padded by two seat diameters so edge seats are never clipped.
  // Whether the viewBox follows this is `fitContent`'s decision, not this value's.
  const contentBounds = useMemo(() => {
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

  const bounds = useMemo(
    () =>
      fitContent ? contentBounds : { x: 0, y: 0, w: space.width, h: space.height },
    [fitContent, contentBounds, space.width, space.height],
  );

  const view = useMemo(() => viewOf(bounds, zoom, pan), [bounds, zoom, pan]);

  /**
   * Only draw the seats the viewport can actually show.
   *
   * Every seat is an interactive SVG node, so a large venue paid for thousands of them on every render
   * whether or not they were on screen. Culling to the visible rectangle is what lets the seat ceiling
   * rise past a couple of thousand.
   *
   * Below the threshold nothing is filtered at all: a normal cinema or theatre renders exactly the
   * nodes it did before, so this cannot change behaviour in the common case — and the interaction code
   * that reads `seats` (marquee, selection, zoom-to-seat) works off the FULL list its caller holds,
   * not this one, so nothing off-screen becomes unreachable.
   */
  const drawnSeats = useMemo(() => {
    if (seats.length < CULL_ABOVE) return seats;
    // A generous margin: a seat whose centre is just outside still has a visible edge, and panning
    // reveals the next band before the render catches up.
    const pad = space.seatDiameter * 4;
    return seats.filter(
      (s) =>
        s.x >= view.x - pad &&
        s.x <= view.x + view.w + pad &&
        s.y >= view.y - pad &&
        s.y <= view.y + view.h + pad,
    );
  }, [seats, view, space.seatDiameter]);

  /**
   * The row letters, and where they go.
   *
   * Off the FULL seat list rather than `drawnSeats`: a row that runs off the edge of the viewport
   * still ends where it ends, and computing from the culled list would put its letter beside whichever
   * seat happened to be the last one on screen. The markers are culled separately, below.
   */
  const markers = useMemo(
    () => (showRowLabels ? rowMarkers(seats, space.seatDiameter * 1.4) : []),
    [showRowLabels, seats, space.seatDiameter],
  );

  const drawnMarkers = useMemo(() => {
    if (markers.length < CULL_ABOVE) return markers;
    const pad = space.seatDiameter * 4;
    return markers.filter(
      (m) =>
        m.x >= view.x - pad && m.x <= view.x + view.w + pad && m.y >= view.y - pad && m.y <= view.y + view.h + pad,
    );
  }, [markers, view, space.seatDiameter]);

  /**
   * Zoom and pan are ALSO held in refs, and the refs are the ones a gesture reads.
   *
   * Not an optimisation — a correctness requirement. Wheel and pointer events fire faster than React
   * renders, so several of them coalesce into one update; anything derived from state would still be
   * showing the pre-gesture view on the second event of a frame, and a fast scroll would zoom about
   * the wrong point and drift. `applyView` writes the ref synchronously and the state for the render,
   * so the two can never separate.
   */
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  // Bounds is the one of the three a gesture never writes — it is derived from the seats prop — so
  // an effect is enough: it has always flushed by the time a pointer event can arrive, and no
  // gesture can invalidate it halfway through.
  const boundsRef = useRef(bounds);
  useEffect(() => {
    boundsRef.current = bounds;
  }, [bounds]);

  const applyView = useCallback((nextZoom: number, nextPan: { x: number; y: number }) => {
    zoomRef.current = nextZoom;
    panRef.current = nextPan;
    setZoom(nextZoom);
    setPan(nextPan);
  }, []);

  /** The view a gesture must reason about: built from the refs, never from a render's snapshot. */
  const liveView = useCallback(() => viewOf(boundsRef.current, zoomRef.current, panRef.current), []);

  /**
   * Client pixels → layout units, via the SVG's own screen matrix.
   *
   * Not a bounding-rect division: that assumes the viewBox fills the element exactly, and it does
   * not. The default `preserveAspectRatio` letterboxes whenever the container's aspect differs from
   * the viewBox's, so rect-relative maths drifts — and the drift is worst on a wide editor canvas
   * showing a square floor, which is precisely the shape this component is used in. `getScreenCTM()`
   * already accounts for the letterboxing, the zoom and the pan.
   */
  const toLayout = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }, []);

  /** Point the view at a rectangle of layout space — the primitive under every zoom-to-* below. */
  const frame = useCallback(
    (box: { x: number; y: number; w: number; h: number }) => {
      const b = boundsRef.current;
      const pad = 1.15; // a little air, so a framed block is not flush with the edges
      const z = Math.max(
        ZOOM_MIN,
        Math.min(ZOOM_MAX, Math.min(b.w / (box.w * pad), b.h / (box.h * pad))),
      );
      const w = b.w / z;
      const h = b.h / z;
      applyView(z, {
        x: box.x + box.w / 2 - w / 2 - b.x - (b.w - w) / 2,
        y: box.y + box.h / 2 - h / 2 - b.y - (b.h - h) / 2,
      });
    },
    [applyView],
  );

  const resetView = useCallback(() => applyView(1, { x: 0, y: 0 }), [applyView]);

  /**
   * Zoom about a fixed layout point, so the thing under the cursor stays under the cursor.
   *
   * Both values are computed up front rather than nesting `setPan` inside a `setZoom` updater: an
   * updater must be pure, React may run it twice under StrictMode, and a doubled `setPan` would send
   * the map skidding off on every wheel tick.
   */
  const zoomAt = useCallback(
    (factor: number, anchor?: { x: number; y: number }) => {
      const b = boundsRef.current;
      const v = liveView();
      const current = zoomRef.current;
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current * factor));
      if (next === current) return;

      const w = b.w / next;
      const h = b.h / next;
      const a = anchor ?? { x: v.x + v.w / 2, y: v.y + v.h / 2 };
      // Where the anchor sits in the viewport, as a fraction — preserved across the zoom.
      const fx = (a.x - v.x) / v.w;
      const fy = (a.y - v.y) / v.h;
      applyView(next, {
        x: a.x - fx * w - b.x - (b.w - w) / 2,
        y: a.y - fy * h - b.y - (b.h - h) / 2,
      });
    },
    [applyView, liveView],
  );

  const nudgeView = useCallback(
    (dx: number, dy: number) => {
      const v = liveView();
      const p = panRef.current;
      applyView(zoomRef.current, { x: p.x + (dx * v.w) / 8, y: p.y + (dy * v.h) / 8 });
    },
    [applyView, liveView],
  );

  // ---- Blocks -------------------------------------------------------------------------------

  const blockOf = useCallback(
    (seat: T): number | string | null => {
      if (seatBlockId) return seatBlockId(seat);
      if (!seat.section || !blocks) return null;
      return blocks.find((b) => b.name === seat.section)?.id ?? null;
    },
    [seatBlockId, blocks],
  );

  /** One padded hull per block, from the seats actually in it. A block with no seats has no hull —
   *  an empty rectangle floating on the map reads as a mistake rather than as an empty section. */
  const hulls = useMemo(() => {
    if (!blocks?.length) return [];
    const byBlock = new Map<number | string, T[]>();
    for (const seat of seats) {
      const id = blockOf(seat);
      if (id === null || id === undefined) continue;
      const list = byBlock.get(id);
      if (list) list.push(seat);
      else byBlock.set(id, [seat]);
    }
    const pad = space.seatDiameter * 0.9;
    return blocks.flatMap((block) => {
      const members = byBlock.get(block.id);
      if (!members?.length) return [];
      const xs = members.map((s) => s.x);
      const ys = members.map((s) => s.y);
      const x = Math.min(...xs) - pad;
      const y = Math.min(...ys) - pad;
      return [
        {
          block,
          x,
          y,
          w: Math.max(...xs) + pad - x,
          h: Math.max(...ys) + pad - y,
        },
      ];
    });
  }, [blocks, seats, blockOf, space.seatDiameter]);

  useImperativeHandle(
    ref,
    (): SeatCanvasHandle => ({
      // With a pinned viewBox, resetting to zoom 1 would show the whole 10,000-unit space rather than
      // the chart, so "fit to frame" frames the CONTENT instead — which is what the organizer means by
      // it, and the one moment they are asking to be re-scaled.
      zoomToVenue: () => (fitContent ? resetView() : frame(contentBounds)),
      zoomToBlock: (blockId) => {
        const hull = hulls.find((h) => h.block.id === blockId);
        if (hull) frame(hull);
      },
      zoomToSeat: (seatId) => {
        const seat = seats.find((s) => s.id === seatId);
        if (!seat) return;
        const d = space.seatDiameter * 6;
        frame({ x: seat.x - d, y: seat.y - d, w: d * 2, h: d * 2 });
      },
      toLayout,
    }),
    [resetView, hulls, frame, seats, space.seatDiameter, toLayout, fitContent, contentBounds],
  );

  // ---- Pointer gestures ---------------------------------------------------------------------

  /** In edit mode the plain drag belongs to the tools, so panning moves to the modifier chords a
   *  drawing app trains you to reach for anyway: middle button, or Ctrl/⌘ held. */
  const wantsPan = (e: React.PointerEvent) => !editable || e.button === 1 || e.ctrlKey || e.metaKey;

  /** The drag rectangle is both drawn here and reported out, so a tool can preview what it will
   *  create from the very same numbers the marquee is using. */
  const updateMarquee = (rect: Rect | null) => {
    setMarquee(rect);
    onMarqueeChange?.(rect);
  };

  /**
   * Pointer capture goes on the <svg>, never on the seat that started the gesture: the move and up
   * handlers live on the <svg>, and capturing on a child makes `releasePointerCapture` throw there
   * for a pointer it was never given — which strands the gesture and leaves the map dragging after
   * the button is up.
   */
  /**
   * The seat a non-editing viewer pressed, if any.
   *
   * Needed because pointer capture goes on the <svg> (see above), which retargets the pointerup — and
   * with it the `click` the browser would otherwise dispatch to the seat. A buyer's tap therefore never
   * reached the seat's own handler and selecting a seat by pointer did nothing at all; only the keyboard
   * path worked. The press is remembered here and completed in `endGesture`.
   */
  const tapped = useRef<T | null>(null);

  const beginGesture = (e: React.PointerEvent, grabbed: "seat" | "element" | "table" | null) => {
    const p = toLayout(e.clientX, e.clientY);
    if (!p) return;
    const kind: Gesture["kind"] = wantsPan(e) ? "pan" : (grabbed ?? "marquee");
    gesture.current = {
      kind,
      clientX: e.clientX,
      clientY: e.clientY,
      originX: p.x,
      originY: p.y,
      moved: false,
      additive: e.shiftKey,
      alt: e.altKey,
    };
    if (kind === "marquee") updateMarquee({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
    if (kind !== "marquee") setHover(null); // a tooltip has no business following a drag
    if (kind === "pan") setPanning(true);
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g) return;
    const p = toLayout(e.clientX, e.clientY);
    if (!p) return;
    const dx = p.x - g.originX;
    const dy = p.y - g.originY;
    if (Math.abs(dx) > CLICK_SLOP || Math.abs(dy) > CLICK_SLOP) g.moved = true;

    if (g.kind === "pan") {
      const rect = e.currentTarget.getBoundingClientRect();
      const scale = liveView().w / rect.width;
      const prev = panRef.current;
      applyView(zoomRef.current, {
        x: prev.x - (e.clientX - g.clientX) * scale,
        y: prev.y - (e.clientY - g.clientY) * scale,
      });
      g.clientX = e.clientX;
      g.clientY = e.clientY;
    } else if (g.kind === "marquee") {
      updateMarquee({ x1: g.originX, y1: g.originY, x2: p.x, y2: p.y });
    } else if (g.kind === "element") {
      onElementDrag?.(dx, dy, "move");
    } else if (g.kind === "table") {
      onTableDrag?.(dx, dy, "move");
    } else {
      onSeatDrag?.(dx, dy, "move");
    }
  };

  const endGesture = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    gesture.current = null;
    const tap = tapped.current;
    tapped.current = null;
    setPanning(false);
    if (svgRef.current?.hasPointerCapture(e.pointerId)) {
      svgRef.current.releasePointerCapture(e.pointerId);
    }
    if (!g) return;
    const p = toLayout(e.clientX, e.clientY);

    if (g.kind === "marquee") {
      updateMarquee(null);
      if (g.moved && p) {
        onMarquee?.({ x1: g.originX, y1: g.originY, x2: p.x, y2: p.y }, g.additive, g.alt);
      } else {
        onBackgroundClick?.({ x: g.originX, y: g.originY }, g.additive);
      }
    } else if (g.kind === "pan") {
      // A pan that never left the slop is a tap. For a viewer every press is a pan (there is nothing to
      // drag), so this is where a buyer's seat selection is actually completed.
      if (!g.moved && tap) onSeatActivate?.(tap);
    } else if (p && (g.kind === "seat" || g.kind === "element" || g.kind === "table")) {
      // A drag that never left the slop is a plain click; committing it would push a no-op onto the
      // undo stack, so pressing Ctrl+Z after clicking around would appear to do nothing.
      const dx = g.moved ? p.x - g.originX : 0;
      const dy = g.moved ? p.y - g.originY : 0;
      if (g.kind === "element") onElementDrag?.(dx, dy, "end");
      else if (g.kind === "table") onTableDrag?.(dx, dy, "end");
      else onSeatDrag?.(dx, dy, "end");
    }
  };

  // Wheel zoom, bound natively: React's synthetic wheel listener is passive, so `preventDefault`
  // there is ignored and the page scrolls out from under the map while you zoom.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, toLayout(e.clientX, e.clientY) ?? undefined);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomAt, toLayout]);

  const showNumbers =
    seatNumbers === "always" ||
    (seatNumbers === "auto" && space.seatDiameter / view.w > NUMBER_VISIBILITY_THRESHOLD);
  const strokeScale = Math.max(1.5, 6 / Math.sqrt(zoom)); // hairlines stay visible when zoomed in

  return (
    <div className={`relative ${className}`}>
      {/* Zoom and pan are reachable from the keyboard, not only by pointer gesture (FR-039a). */}
      <div className="absolute right-2 top-2 z-10 flex gap-1 font-mono text-xs">
        <button
          type="button"
          onClick={() => zoomAt(1.4)}
          aria-label="Phóng to sơ đồ"
          className="grid h-7 w-7 place-items-center rounded-md border border-beige-kem/40 bg-surface-2 text-beige-kem"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => zoomAt(1 / 1.4)}
          aria-label="Thu nhỏ sơ đồ"
          className="grid h-7 w-7 place-items-center rounded-md border border-beige-kem/40 bg-surface-2 text-beige-kem"
        >
          −
        </button>
        <button
          type="button"
          onClick={resetView}
          aria-label="Đặt lại khung nhìn"
          className="grid h-7 w-auto place-items-center rounded-md border border-beige-kem/40 bg-surface-2 px-2 text-beige-kem"
        >
          ⟲
        </button>
      </div>

      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        role="group"
        aria-label="Sơ đồ chỗ ngồi"
        tabIndex={0}
        className={`w-full touch-none select-none ${heightClass}`}
        style={{ cursor: panning ? "grabbing" : editable ? "default" : "grab" }}
        onKeyDown={(e) => {
          // In edit mode the arrows belong to the selection, not to the viewport — the editor binds
          // them. Only the zoom keys stay, because nothing in the editor wants them.
          const map: Record<string, () => void> = {
            "+": () => zoomAt(1.4),
            "=": () => zoomAt(1.4),
            "-": () => zoomAt(1 / 1.4),
            "0": resetView,
            ...(editable
              ? {}
              : {
                  ArrowLeft: () => nudgeView(-1, 0),
                  ArrowRight: () => nudgeView(1, 0),
                  ArrowUp: () => nudgeView(0, -1),
                  ArrowDown: () => nudgeView(0, 1),
                }),
          };
          const fn = map[e.key];
          if (fn) {
            e.preventDefault();
            fn();
          }
        }}
        onPointerDown={(e) => beginGesture(e, null)}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onPointerLeave={() => setHover(null)}
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

        {/* Section hulls: the shape of the room read before any seat is. Decoration — a hull holds
            no seat and no status. */}
        {hulls.map((hull) => (
          <g key={`b-${hull.block.id}`} aria-hidden="true" pointerEvents="none">
            <rect
              x={hull.x}
              y={hull.y}
              width={hull.w}
              height={hull.h}
              rx={space.seatDiameter}
              fill={`${hull.block.color}14`}
              stroke={`${hull.block.color}66`}
              strokeWidth={strokeScale}
              strokeDasharray={`${space.seatDiameter / 2} ${space.seatDiameter / 3}`}
            />
            <text
              x={hull.x + space.seatDiameter / 3}
              y={hull.y - space.seatDiameter / 3}
              fontSize={space.seatDiameter * 1.1}
              fill={hull.block.color}
              className="font-mono"
            >
              {hull.block.name}
            </text>
          </g>
        ))}

        {/* Tables first: they sit under their seats. Never inventory (FR-082) — a table is grabbable
            while editing so it can be repositioned, and inert for a buyer. */}
        {tables.map((t, i) => (
          <g
            key={`tbl-${i}`}
            transform={`rotate(${t.rotation} ${t.x} ${t.y})`}
            aria-hidden="true"
            pointerEvents={editable && onTablePointerDown ? undefined : "none"}
            style={editable && onTablePointerDown ? { cursor: "move" } : undefined}
            onPointerDown={
              editable && onTablePointerDown
                ? (e) => {
                    if (wantsPan(e)) return;
                    e.stopPropagation();
                    onTablePointerDown(i);
                    // Begin the gesture on the SVG, same as a seat: the move/up handlers live there.
                    beginGesture(e, "table");
                  }
                : undefined
            }
          >
            {selectedTableIndex === i && (
              // Same dashed ring the selected element gets, so "what will Delete remove" is legible.
              <rect
                x={t.x - t.width / 2 - 30}
                y={t.y - t.height / 2 - 30}
                width={t.width + 60}
                height={t.height + 60}
                rx={14}
                fill="none"
                className="stroke-burgundy"
                strokeWidth={strokeScale * 1.5}
                strokeDasharray={`${strokeScale * 5} ${strokeScale * 4}`}
              />
            )}
            {t.shape === "round" ? (
              <circle
                cx={t.x}
                cy={t.y}
                r={t.width / 2}
                className="fill-beige-kem/10 stroke-beige-kem/40"
                strokeWidth={8}
              />
            ) : (
              <rect
                x={t.x - t.width / 2}
                y={t.y - t.height / 2}
                width={t.width}
                height={t.height}
                rx={24}
                className="fill-beige-kem/10 stroke-beige-kem/40"
                strokeWidth={8}
              />
            )}
            <text
              x={t.x}
              y={t.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={110}
              className="fill-beige-kem/70"
            >
              {t.name}
            </text>
          </g>
        ))}

        {/* Non-sellable decoration. Excluded from the seat tab order (FR-040), and inert for a
            buyer — a stage that swallows the tap meant for the front row is a real misclick. */}
        {elements.map((el, i) => {
          const grabbable = editable && !!onElementPointerDown;
          return (
          <g
            key={`el-${i}`}
            transform={`rotate(${el.rotation} ${el.x} ${el.y})`}
            aria-hidden="true"
            pointerEvents={grabbable ? undefined : "none"}
            style={grabbable ? { cursor: "grab" } : undefined}
            onPointerDown={
              grabbable
                ? (e) => {
                    e.stopPropagation();
                    if (!wantsPan(e)) onElementPointerDown(i, e.shiftKey);
                    beginGesture(e, "element");
                  }
                : undefined
            }
          >
            {/* Selection ring, drawn only for the one being edited. */}
            {selectedElementIndex === i && (
              <rect
                x={el.x - el.width / 2 - 20}
                y={el.y - el.height / 2 - 20}
                width={el.width + 40}
                height={el.height + 40}
                rx={12}
                fill="none"
                className="stroke-burgundy"
                strokeWidth={strokeScale * 1.5}
                strokeDasharray={`${strokeScale * 5} ${strokeScale * 4}`}
              />
            )}
            {SHAPE_KINDS.has(el.kind) && el.points && el.points.length >= 2 && (
              <polyline
                // A boundary closes back to its first point; a divider stays an open line.
                points={(el.kind === "boundary" ? [...el.points, el.points[0]] : el.points)
                  .map((p) => `${p.x},${p.y}`)
                  .join(" ")}
                className={el.color ? "" : ELEMENT_FILL[el.kind]}
                strokeWidth={10}
                // A closed outline takes its colour as a translucent wash with a solid edge, so shapes
                // stay tellable apart without hiding the seats drawn over them. A divider is an open
                // line and only ever takes a stroke.
                style={
                  el.color
                    ? {
                        stroke: el.color,
                        fill: el.kind === "boundary" ? `${el.color}33` : "none",
                      }
                    : undefined
                }
                fill="none"
              />
            )}
            {/* Vertex handles — only for the selected shape, and only when an editor asked for them. */}
            {onVertexDrag &&
              selectedElementIndex === i &&
              SHAPE_KINDS.has(el.kind) &&
              el.points?.map((p, v) => (
                <circle
                  key={v}
                  cx={p.x}
                  cy={p.y}
                  r={Math.max(18, 60 / Math.sqrt(zoom))}
                  className="cursor-move fill-burgundy stroke-beige-kem"
                  strokeWidth={strokeScale}
                  onPointerDown={(e) => {
                    if (wantsPan(e)) return;
                    e.stopPropagation();
                    (e.target as Element).setPointerCapture(e.pointerId);
                    const move = (ev: PointerEvent) => {
                      const at = toLayout(ev.clientX, ev.clientY);
                      if (at) onVertexDrag(i, v, at.x, at.y);
                    };
                    const up = () => {
                      window.removeEventListener("pointermove", move);
                      window.removeEventListener("pointerup", up);
                    };
                    window.addEventListener("pointermove", move);
                    window.addEventListener("pointerup", up);
                  }}
                />
              ))}
            {el.kind !== "label" && !SHAPE_KINDS.has(el.kind) && (
              <rect
                x={el.x - el.width / 2}
                y={el.y - el.height / 2}
                width={el.width}
                height={el.height}
                rx={el.kind === "stage" ? 40 : 8}
                strokeWidth={6}
                strokeDasharray={el.kind === "aisle" ? "40 30" : undefined}
                // A chosen colour replaces the theme's own ink for this element, the same way it does
                // for a drawn outline above: solid edge, translucent wash, so a stage or a standing
                // zone can be told apart from the one beside it at a glance.
                className={el.color ? "" : ELEMENT_FILL[el.kind]}
                style={el.color ? { stroke: el.color, fill: `${el.color}33` } : undefined}
              />
            )}
            {el.label && (
              // Text content, never markup — React escapes it (FR-018, SEC-07).
              <text
                x={el.x}
                y={el.y - (el.kind === "area" && el.capacity ? Math.max(40, el.height / 10) : 0)}
                textAnchor="middle"
                dominantBaseline="central"
                // Has to fit the element BOTH ways. Height alone was enough while every labelled
                // element was a fixed-size stage; a named shape can be any proportion, and a long name
                // in a tall narrow one ran clean off both sides of it.
                fontSize={Math.min(
                  Math.max(60, el.height / 3),
                  // 0.62em is about the width of a monospace glyph; the 0.9 keeps it off the edges.
                  Math.max(40, (el.width * 0.9) / Math.max(1, el.label.length * 0.62)),
                )}
                className="fill-beige-kem/70 font-mono"
              >
                {el.label}
              </text>
            )}
            {/* A capacity zone says how many it holds. Without this it draws as an anonymous shape,
                and a standing floor is indistinguishable from a decorative outline — for the buyer
                as much as for the organizer, since both sides render through this component. */}
            {el.kind === "area" && (el.capacity ?? 0) > 0 && (
              <text
                x={el.x}
                y={el.y + (el.label ? Math.max(60, el.height / 6) : 0)}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={Math.max(50, el.height / 5)}
                className="fill-beige-kem/55 font-mono"
              >
                {el.capacity} chỗ
              </text>
            )}
          </g>
          );
        })}

        {underlay}

        {/* The row's letter, past the end of the row. Drawn BEFORE the seats so that a letter which
            lands near a seat on a tight layout sits under it rather than over its number, and marked
            aria-hidden because every seat already announces its own row in its label. */}
        {drawnMarkers.map((m) => (
          <text
            key={m.key}
            x={m.x}
            y={m.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={space.seatDiameter * 0.95}
            aria-hidden="true"
            className="pointer-events-none fill-beige-kem/55 font-mono font-bold"
          >
            {m.label}
          </text>
        ))}

        {/* Seats, in the payload's section → row → number order, which IS the tab order (FR-039a). */}
        {drawnSeats.map((seat) => {
          const label = seatLabel?.(seat) ?? `Ghế ${seat.row}${seat.number}`;
          const selected = selectedIds?.has(seat.id) ?? false;
          // The seat's own footprint: its section's size multiplier scaled off the space's nominal
          // diameter, and its section's shape (FR-064). What is drawn is exactly what the
          // publish-time overlap rule measures, so a map that looks clear is one.
          const d = space.seatDiameter * (seat.sizeMultiplier ?? 1);
          const rr = d / 2;
          const fill = seatFill?.(seat);
          const stroke = seatStroke?.(seat);
          // The number has to be readable on whatever colour the seat's class carries; with no fill it
          // keeps the theme ink, which already contrasts with the map's own background.
          const ink = readableInk(fill);
          return (
            <g
              key={seat.id}
              transform={`rotate(${seat.rotation} ${seat.x} ${seat.y})`}
              role={interactive ? "button" : "img"}
              aria-label={label}
              aria-pressed={interactive && selectedIds ? selected : undefined}
              tabIndex={interactive ? 0 : -1}
              onPointerDown={
                editable
                  ? (e) => {
                      e.stopPropagation();
                      if (!wantsPan(e)) onSeatPointerDown?.(seat, e.shiftKey, e.altKey);
                      beginGesture(e, "seat");
                    }
                  : interactive
                    ? () => {
                        // Deliberately does NOT stop propagation: the <svg> still needs the event to
                        // start a pan, so a drag across the map keeps working and only a stationary
                        // press counts as choosing this seat.
                        tapped.current = seat;
                      }
                    : undefined
              }
              onPointerMove={
                seatTooltip
                  ? (e) => {
                      if (gesture.current) return;
                      const box = svgRef.current?.parentElement?.getBoundingClientRect();
                      if (box) {
                        setHover({ seat, left: e.clientX - box.left, top: e.clientY - box.top });
                      }
                    }
                  : undefined
              }
              onPointerLeave={
                // Leaving seat A for seat B fires this before B's enter, so the card never blinks
                // out between neighbours — it just moves.
                seatTooltip ? () => setHover((h) => (h?.seat.id === seat.id ? null : h)) : undefined
              }
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
              className={
                interactive || editable ? "cursor-pointer outline-none focus-visible:opacity-80" : ""
              }
            >
              <title>{label}</title>
              {/* A chair read from above: backrest behind, cushion in front. The whole glyph stays
                  inside the seat's effective diameter, so what you see is what the overlap rule
                  measures. A `square` section drops the backrest for a plain block.

                  Drawn HERE rather than in the editor, which is where it used to live: the organizer
                  arranging a room and the buyer picking a seat now look at the same shape, which is
                  the entire point of there being one renderer. */}
              {seat.shape !== "square" && (
                <rect
                  x={seat.x - rr * 0.92}
                  y={seat.y - rr * 0.96}
                  width={d * 0.92}
                  height={d * 0.26}
                  rx={d * 0.1}
                  strokeWidth={selected ? strokeScale * 1.6 : strokeScale * 0.85}
                  className={seatClass?.(seat) ?? "fill-transparent stroke-beige-kem/50"}
                  style={fill || stroke ? { fill, stroke } : undefined}
                />
              )}
              <rect
                x={seat.x - rr * 0.8}
                y={seat.y - rr * (seat.shape === "square" ? 0.8 : 0.36)}
                width={d * 0.8}
                height={d * (seat.shape === "square" ? 0.8 : 0.58)}
                rx={seat.shape === "square" ? rr * 0.16 : rr * 0.32}
                strokeWidth={selected ? strokeScale * 1.8 : strokeScale}
                className={seatClass?.(seat) ?? "fill-transparent stroke-beige-kem/50"}
                style={fill || stroke ? { fill, stroke } : undefined}
              />
              {/* A double seat: one unit, two places. Marked with a divider down the cushion rather
                  than drawn WIDER, deliberately — the glyph is kept inside the seat's effective
                  diameter so what is drawn stays exactly what the publish-time overlap rule measures.
                  A wider double would look right and validate against the wrong footprint. */}
              {seat.seatType === "double" && (
                <line
                  x1={seat.x}
                  y1={seat.y - rr * (seat.shape === "square" ? 0.7 : 0.26)}
                  x2={seat.x}
                  y2={seat.y + rr * (seat.shape === "square" ? 0.7 : 0.5)}
                  strokeWidth={strokeScale * 0.9}
                  className={seatClass?.(seat) ?? "stroke-beige-kem/50"}
                  style={stroke ? { stroke } : fill ? { stroke: readableInk(fill) } : undefined}
                />
              )}
              {/* Invisible hit area — a thin chair is hard to grab, and a buyer on a phone hits the
                  gap between backrest and cushion constantly without it. */}
              <rect
                x={seat.x - rr}
                y={seat.y - rr}
                width={d}
                height={d}
                fill="transparent"
              />
              {/* The accessibility mark. Drawn instead of the number, not beside it: at the size a
                  seat renders, two glyphs in one cushion is illegible. The label still announces it. */}
              {seat.isAccessible && showNumbers && (
                <text
                  x={seat.x}
                  y={seat.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={d * 0.5}
                  pointerEvents="none"
                  className={ink ? "" : "fill-beige-kem/80"}
                  style={ink ? { fill: ink } : undefined}
                >
                  ♿
                </text>
              )}
              {showNumbers && !seat.isAccessible && (
                <text
                  x={seat.x}
                  y={seat.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={d * 0.42}
                  pointerEvents="none"
                  className={ink ? "font-mono" : "fill-beige-kem/70 font-mono"}
                  style={ink ? { fill: ink } : undefined}
                >
                  {seat.number}
                </text>
              )}
            </g>
          );
        })}

        {marquee && marqueeStyle === "rect" && (
          <rect
            x={Math.min(marquee.x1, marquee.x2)}
            y={Math.min(marquee.y1, marquee.y2)}
            width={Math.abs(marquee.x2 - marquee.x1)}
            height={Math.abs(marquee.y2 - marquee.y1)}
            className="fill-burgundy/10 stroke-burgundy/60"
            strokeWidth={strokeScale}
            pointerEvents="none"
          />
        )}

        {overlay}
      </svg>

      {/* Hover card. Pointer-transparent, so it can never eat the click it is describing. */}
      {hover && seatTooltip && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-[calc(100%+12px)] whitespace-nowrap rounded-lg border-2 border-beige-kem bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-beige-kem shadow-lg"
          style={{ left: hover.left, top: hover.top }}
          role="presentation"
        >
          {seatTooltip(hover.seat)}
        </div>
      )}
    </div>
  );
}

/** The visible rectangle of layout space, for a given fit, zoom level and pan offset. */
function viewOf(
  bounds: { x: number; y: number; w: number; h: number },
  zoom: number,
  pan: { x: number; y: number },
): { x: number; y: number; w: number; h: number } {
  const w = bounds.w / zoom;
  const h = bounds.h / zoom;
  return {
    x: bounds.x + (bounds.w - w) / 2 + pan.x,
    y: bounds.y + (bounds.h - h) / 2 + pan.y,
    w,
    h,
  };
}

/**
 * `forwardRef` erases the generic, so it is restored by the cast. The alternative — dropping the
 * generic and having callers cast every callback argument back to their own seat type — moves the
 * same unsoundness to a dozen call sites instead of one.
 */
const SeatCanvas = forwardRef(SeatCanvasInner) as <T extends CanvasSeat>(
  props: SeatCanvasProps<T> & { ref?: React.Ref<SeatCanvasHandle> },
) => React.ReactElement;

export default SeatCanvas;
