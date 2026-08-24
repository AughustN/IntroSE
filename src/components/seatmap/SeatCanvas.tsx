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
import { LAYOUT_SPACE, SEAT_DIAMETER } from "@/shared/catalog/seatmap-validate";
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

/** Only for a caller that passes no `space`; the real one always comes from the server payload.
 *  Read from the shared constants so it cannot drift from the space the server validates against. */
const DEFAULT_SPACE: SeatMapSpace = {
  width: LAYOUT_SPACE,
  height: LAYOUT_SPACE,
  seatDiameter: SEAT_DIAMETER,
};

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
  /**
   * The level this seat is on (0044), by name. Null or absent is the single implicit floor.
   *
   * The canvas itself never reads it — floors are a VIEW concern its callers resolve before handing
   * seats over. It rides here so the preview and the buyer's map can group by level without a second
   * parallel array keyed by seat id.
   */
  floor?: string | null;
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
  zoomIn(): void;
  zoomOut(): void;
  zoomTo(scale: number): void;
  zoomToBlock(blockId: number | string): void;
  /** Frame an arbitrary editor selection without teaching this shared renderer document block ids. */
  zoomToBounds(box: { x: number; y: number; w: number; h: number }): void;
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
   * Draw a measuring grid at this step, in layout units. `null`/absent draws none.
   *
   * The editor has had a grid TOGGLE since the beginning, and it has never drawn anything — it only
   * rounded coordinates. So the status bar said "Lưới bật" over a blank field, and the organizer
   * lining a block up against the one above it had nothing to line it up against; the aid was real
   * but entirely invisible, which is close to the worst case, because an invisible aid still moves
   * your block and you cannot see why.
   *
   * Rendered as an SVG `<pattern>`, not as lines. At the 30,000-unit space and a 50-unit step, the
   * explicit form is 1,200 `<line>` nodes; the pattern is one node whatever the extent, and the
   * browser tiles it on the GPU. Two frequencies — a light rule every step and a firmer one every
   * tenth — because a single frequency at drawing density reads as flat texture: the tenth line is
   * what lets the eye COUNT a distance rather than merely see that a distance exists.
   */
  gridStep?: number | null;
  /**
   * Draw each row's letter at the end of the row. On by default, on every screen.
   *
   * A buyer needs it at least as much as an organizer: a ticket says "K12", and until now the chart
   * that ticket refers to showed the 12 and never the K. Off is for a map with no meaningful rows —
   * a standing-only floor, or a thumbnail too small to read them.
   */
  showRowLabels?: boolean;
  /**
   * Click a row's letter to select the row (§19 seat mode, §49 row properties).
   *
   * Optional and undefined on the buyer's screens, so the letters stay inert there — the rule for
   * anything editor-only in this file, since it draws the buyer's map too.
   */
  onRowSelect?: (section: string | null, label: string) => void;
  /**
   * Report the zoom factor and the pointer's LAYOUT position, for a status bar (§3).
   *
   * Pushed out rather than exposed on the imperative handle because both change at pointer speed: a
   * handle would have to be polled, and polling a value that changes every frame is how a status bar
   * ends up driving the render loop of the canvas it is reporting on.
   */
  onViewReport?: (report: { zoom: number; x: number | null; y: number | null }) => void;
  /** Keep buyer zoom controls visible unless a surrounding surface provides the same controls. */
  showViewControls?: boolean;
  /** The row currently selected, as `section|label`, so it can be drawn as selected. */
  selectedRowKey?: string | null;

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
  /**
   * Elements to draw nothing for, BY INDEX.
   *
   * Hiding has to happen here rather than by handing this component a shorter array, because an
   * element's index IS its identity across the boundary: `selectedElementIndex` comes in as one and
   * `onElementPointerDown` / `onResize` / `onVertexDrag` go back out as one. A caller that filters
   * first shifts every index past the first hidden element, and the editor then resolves a click to
   * whichever block happens to sit at that position instead.
   */
  hiddenElementIndices?: ReadonlySet<number>;
  /**
   * Drawn but INERT — dimmed, unclickable, out of the tab order (0044).
   *
   * Different from hidden, and the difference is the whole point: an organizer editing the balcony
   * still needs to see the stalls underneath to line the two up, but must not be able to grab a seat
   * down there by accident. This is the layer behaviour every drawing tool has, and hiding was the
   * wrong half of it — you cannot align against something that is not on screen.
   */
  ghostSeatIds?: ReadonlySet<number>;
  ghostElementIndices?: ReadonlySet<number>;
  onElementPointerDown?: (index: number, additive: boolean) => void;
  /**
   * Drag one vertex of the selected polygon (the Nodes tool).
   *
   * Optional, and undefined on all three non-authoring screens, so the handles simply do not render
   * there. That is the rule for anything editor-only in this file: it draws the buyer's map too, and
   * a control a buyer can reach is a control a buyer can break.
   */
  /**
   * Drag one vertex of a drawn outline.
   *
   * Carries a `phase` for the same reason `onResize` does: without it the editor had no way to tell a
   * frame of a drag from the end of one, so it committed on every pointer move — a hundred undo steps
   * per drag, which at `UNDO_DEPTH` of 50 threw the whole history away and left Ctrl+Z rewinding a
   * sub-pixel. Preview on `move`, commit once on `end`.
   */
  onVertexDrag?: (
    elementIndex: number,
    vertex: number,
    x: number,
    y: number,
    phase: "move" | "end",
  ) => void;
  /**
   * Scale a whole drawn outline from a corner of its true bounding box.
   *
   * Separate from `onResize`, which drives `width`/`height` — those only approximate a polygon, which
   * is why the resize box stays suppressed for shapes. This reports the pointer in layout coordinates
   * and lets the editor scale the POINTS, the thing a shape actually is.
   */
  onShapeScale?: (
    elementIndex: number,
    corner: "nw" | "ne" | "sw" | "se",
    x: number,
    y: number,
    phase: "move" | "end",
  ) => void;
  /**
   * Drag one of the eight handles on the selected element's bounding box (§6).
   *
   * Reports a CUMULATIVE delta from where the drag began, like `onElementDrag`, so the editor applies
   * one resize rather than a hundred — and one undo step, not a hundred (§28).
   */
  onResize?: (
    elementIndex: number,
    handle: string,
    dx: number,
    dy: number,
    phase: "move" | "end",
  ) => void;
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
  // The showcase element: one ink treatment on both sides of the app — a solid semi-transparent
  // wash with a readable outline, no decorative colour of its own. The showcase (a stage) carries
  // the organiser's label, which has to read against it.
  stage: "fill-beige-kem/12 stroke-beige-kem/55",
  aisle: "fill-transparent stroke-beige-kem/20",
  door: "fill-la-co/20 stroke-la-co/50",
  bar: "fill-cam-dat/15 stroke-cam-dat/40",
  label: "fill-transparent stroke-transparent",
  area: "fill-beige-kem/8 stroke-beige-kem/60",
  // Hall outline and dividers — drawn behind the seats, never interactive (FR-060).
  boundary: "fill-transparent stroke-beige-kem/45",
  divider: "fill-transparent stroke-beige-kem/35",
  // Facility markers (FR-062): one outline treatment. The letter inside is what names the kind,
  // so a per-kind wash only competed with the text it was supposed to sit under.
  exit: "fill-transparent stroke-beige-kem/60",
  restroom: "fill-transparent stroke-beige-kem/60",
  food_drink: "fill-transparent stroke-beige-kem/60",
  smoking: "fill-transparent stroke-beige-kem/60",
  first_aid: "fill-transparent stroke-beige-kem/60",
  lift_stairs: "fill-transparent stroke-beige-kem/60",
  wheelchair: "fill-transparent stroke-beige-kem/60",
};

/** Kinds drawn from a point list rather than a rectangle (FR-058). */
const SHAPE_KINDS = new Set(["boundary", "divider"]);

/** Zooming out stops where the viewBox already frames everything — see `zoomMin`, which relaxes
 *  this in authoring, where 100% deliberately shows only as much of the floor as the canvas fits. */
const ZOOM_MAX = 16;
const ZOOM_STEP = 1.4;
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
    gridStep = null,
    showRowLabels = true,
    onRowSelect,
    onViewReport,
    showViewControls = true,
    selectedRowKey,
    editable = false,
    selectedIds,
    onSeatPointerDown,
    onSeatDrag,
    selectedElementIndex = null,
    hiddenElementIndices,
    ghostSeatIds,
    ghostElementIndices,
    onElementPointerDown,
    onVertexDrag,
    onShapeScale,
    onResize,
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
  const onViewReportRef = useRef(onViewReport);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [hover, setHover] = useState<{ seat: T; left: number; top: number } | null>(null);

  /**
   * Whether this is a touch device, which decides where the tooltip goes.
   *
   * A card anchored to the pointer works on a mouse, where the cursor sits beside what it describes.
   * Under a fingertip it covers the very seat just tapped — and on touch the card never appeared at
   * all, because it was only ever raised by `pointerenter`. So on coarse pointers the card is raised
   * by the tap itself and pinned to the bottom edge instead, clear of the hand.
   */
  const [coarsePointer, setCoarsePointer] = useState(false);

  useEffect(() => {
    onViewReportRef.current = onViewReport;
  }, [onViewReport]);

  /** Header and keyboard controls live outside the SVG pointer surface, so zoom changes report
   *  themselves instead of waiting for the pointer to move over the canvas again. */
  useEffect(() => {
    onViewReportRef.current?.({ zoom, x: null, y: null });
  }, [zoom]);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(pointer: coarse)");
    const sync = () => setCoarsePointer(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  /** Drives the cursor only. Mirrors the live gesture, as state rather than as a ref read, because a
   *  cursor is something the render decides and a ref is not. */
  const [panning, setPanning] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const minimapRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);

  /** Element identity stays as its original index even when hidden entries are omitted from a view. */
  const visibleElements = useMemo(
    () =>
      elements.flatMap((element, index) =>
        hiddenElementIndices?.has(index) ? [] : [{ element, index }],
      ),
    [elements, hiddenElementIndices],
  );

  // What the drawn content occupies, padded by two seat diameters so edge seats are never clipped.
  // Whether the viewBox follows this is `fitContent`'s decision, not this value's.
  const contentBounds = useMemo(() => {
    const pts = [
      ...seats.map((s) => ({ x: s.x, y: s.y })),
      ...visibleElements.flatMap(({ element: e }) => {
        const rad = ((((e.rotation ?? 0) % 360) + 360) % 360) * (Math.PI / 180);
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const source = e.points?.length
          ? e.points
          : [
              { x: e.x - e.width / 2, y: e.y - e.height / 2 },
              { x: e.x + e.width / 2, y: e.y - e.height / 2 },
              { x: e.x + e.width / 2, y: e.y + e.height / 2 },
              { x: e.x - e.width / 2, y: e.y + e.height / 2 },
            ];
        return source.map((point) => {
          const dx = point.x - e.x;
          const dy = point.y - e.y;
          return { x: e.x + dx * cos - dy * sin, y: e.y + dx * sin + dy * cos };
        });
      }),
      // A point whose coordinates are not finite is DROPPED rather than allowed into the extent
      // maths. `Math.min` propagates a single NaN through every bound, which reaches the DOM as
      // `viewBox="NaN NaN NaN NaN"` — and that blanks the entire map, seats included. One
      // positionless decoration element is never worth a showtime's whole seating chart, so the
      // rule here is: a thing that cannot say where it is does not get a vote on where the map is.
    ].filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (pts.length === 0) return { x: 0, y: 0, w: space.width, h: space.height };
    const pad = space.seatDiameter * 2;
    const minX = Math.min(...pts.map((p) => p.x)) - pad;
    const maxX = Math.max(...pts.map((p) => p.x)) + pad;
    const minY = Math.min(...pts.map((p) => p.y)) - pad;
    const maxY = Math.max(...pts.map((p) => p.y)) + pad;
    return { x: minX, y: minY, w: Math.max(maxX - minX, 1), h: Math.max(maxY - minY, 1) };
  }, [seats, visibleElements, space]);

  /**
   * The canvas's rendered size, measured — so authoring can shape its viewBox to the element.
   *
   * `setState` here is inside the observer's callback rather than the effect body: that is the
   * subscribe-to-an-external-system shape, which is what an effect is actually for.
   */
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r || r.width <= 0 || r.height <= 0) return;
      setViewport((prev) =>
        prev && Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1
          ? prev
          : { w: r.width, h: r.height },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * What the viewBox covers at 100%.
   *
   * Buying fits the content. AUTHORING used to pin this to the whole 10,000-unit square, and an SVG
   * letterboxes whatever it cannot fit — so a square space inside the editor's wide canvas was
   * scaled down to the SHORTER side and centred, leaving roughly 60% of the canvas width as dead
   * margin (measured: a 443×443 working square inside 1112×443 of canvas).
   *
   * So the rectangle is cut to the canvas's own aspect instead — full width when the canvas is
   * wider than the space, full height when it is taller — which is `slice` rather than `meet`. The
   * placement area is unchanged at 0–10000 on both axes; what changes is that 100% now means "as
   * much of it as this canvas can actually show", and the rest is a pan away. `zoomMin` below keeps
   * the whole floor reachable by zooming out.
   */
  const bounds = useMemo(() => {
    if (fitContent) return contentBounds;
    const full = { x: 0, y: 0, w: space.width, h: space.height };
    if (!viewport) return full;
    const canvasAspect = viewport.w / viewport.h;
    const spaceAspect = space.width / space.height;
    if (!Number.isFinite(canvasAspect) || canvasAspect <= 0) return full;
    if (canvasAspect > spaceAspect) {
      const h = space.width / canvasAspect;
      return { x: 0, y: (space.height - h) / 2, w: space.width, h };
    }
    const w = space.height * canvasAspect;
    return { x: (space.width - w) / 2, y: 0, w, h: space.height };
  }, [fitContent, contentBounds, space.width, space.height, viewport]);

  /**
   * How far out zooming may go. One while the viewBox already frames everything worth seeing;
   * in authoring it is whatever ratio brings the WHOLE space back on screen, since `bounds` now
   * deliberately shows less than all of it at 100%.
   */
  const zoomMin = useMemo(() => {
    if (fitContent) return 1;
    return Math.min(1, bounds.w / space.width, bounds.h / space.height);
  }, [fitContent, bounds.w, bounds.h, space.width, space.height]);

  /**
   * The visible rectangle — and the last line of defence for the `viewBox` attribute.
   *
   * `contentBounds` already drops non-finite points, so this should never fire. It stays because
   * the failure it guards is total: a NaN anywhere in the viewBox blanks the map, and a buyer
   * looking at an empty chart cannot tell that from a sold-out show. Falling back to the whole
   * coordinate space shows the seats; showing nothing shows nothing.
   */
  const view = useMemo(() => {
    const v = viewOf(bounds, zoom, pan);
    const finite = Number.isFinite(v.x) && Number.isFinite(v.y) && v.w > 0 && v.h > 0;
    return finite ? v : { x: 0, y: 0, w: space.width, h: space.height };
  }, [bounds, zoom, pan, space.width, space.height]);

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
        m.x >= view.x - pad &&
        m.x <= view.x + view.w + pad &&
        m.y >= view.y - pad &&
        m.y <= view.y + view.h + pad,
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

  /** Same reasoning as `boundsRef`: derived from props, read by gestures. */
  const zoomMinRef = useRef(zoomMin);
  useEffect(() => {
    zoomMinRef.current = zoomMin;
  }, [zoomMin]);

  /**
   * Keep a BUYER's view on the map. Panning there is a way to look closer, never a way to lose it.
   *
   * The drag applied whatever delta the pointer travelled, with nothing bounding it, so a buyer who
   * flicked the map could end up staring at empty floor with the chart somewhere off-screen and only
   * the reset button to find it again — on a phone, where the flick is the natural gesture and the
   * button is the smallest thing on screen. Since `bounds` for a buyer IS the content, holding the
   * view inside it is exactly "stay on the seats".
   *
   * At 100% the limit is zero, which is right: the whole chart already fits, so there is nothing to
   * pan TO, and a drag that visibly does nothing is better than one that slides the map away.
   *
   * The editor is deliberately exempt. There `bounds` is the slice of the coordinate space this
   * canvas happens to frame, not the content, and an organizer has to be able to reach the parts of
   * the floor outside it — clamping to the current frame would wall them into whatever they could
   * already see.
   */
  const clampPan = useCallback(
    (z: number, p: { x: number; y: number }) => {
      if (!fitContent) return p;
      const b = boundsRef.current;
      const limitX = Math.max(0, (b.w - b.w / z) / 2);
      const limitY = Math.max(0, (b.h - b.h / z) / 2);
      return {
        x: Math.min(limitX, Math.max(-limitX, p.x)),
        y: Math.min(limitY, Math.max(-limitY, p.y)),
      };
    },
    [fitContent],
  );

  const applyView = useCallback(
    (nextZoom: number, nextPan: { x: number; y: number }) => {
      // Every gesture — drag, wheel, zoom buttons, zoom-to-seat — lands here, so the bound is
      // applied once rather than at each call site where one could be forgotten.
      const pan = clampPan(nextZoom, nextPan);
      zoomRef.current = nextZoom;
      panRef.current = pan;
      setZoom(nextZoom);
      setPan(pan);
    },
    [clampPan],
  );

  /** The view a gesture must reason about: built from the refs, never from a render's snapshot. */
  const liveView = useCallback(
    () => viewOf(boundsRef.current, zoomRef.current, panRef.current),
    [],
  );

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
        zoomMinRef.current,
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
      const next = Math.min(ZOOM_MAX, Math.max(zoomMinRef.current, current * factor));
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
  const zoomIn = useCallback(() => zoomAt(ZOOM_STEP), [zoomAt]);
  const zoomOut = useCallback(() => zoomAt(1 / ZOOM_STEP), [zoomAt]);
  const zoomTo = useCallback((scale: number) => zoomAt(scale / zoomRef.current), [zoomAt]);

  const nudgeView = useCallback(
    (dx: number, dy: number) => {
      const v = liveView();
      const p = panRef.current;
      applyView(zoomRef.current, { x: p.x + (dx * v.w) / 8, y: p.y + (dy * v.h) / 8 });
    },
    [applyView, liveView],
  );

  /** Centre the current zoom on a layout point — used by the orientation inset. */
  const centerViewAt = useCallback(
    (point: { x: number; y: number }) => {
      const b = boundsRef.current;
      const z = zoomRef.current;
      const w = b.w / z;
      const h = b.h / z;
      applyView(z, {
        x: point.x - w / 2 - b.x - (b.w - w) / 2,
        y: point.y - h / 2 - b.y - (b.h - h) / 2,
      });
    },
    [applyView],
  );

  const navigateFromMinimap = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const svg = minimapRef.current;
      const ctm = svg?.getScreenCTM();
      if (!svg || !ctm) return;
      const point = svg.createSVGPoint();
      point.x = e.clientX;
      point.y = e.clientY;
      const layoutPoint = point.matrixTransform(ctm.inverse());
      if (
        layoutPoint.x < contentBounds.x ||
        layoutPoint.x > contentBounds.x + contentBounds.w ||
        layoutPoint.y < contentBounds.y ||
        layoutPoint.y > contentBounds.y + contentBounds.h
      ) {
        return;
      }
      centerViewAt(layoutPoint);
    },
    [centerViewAt, contentBounds],
  );

  /** Keep the inset cheap even when the main canvas is virtualising a stadium-sized seat list. */
  const minimapSeats = useMemo(() => {
    const step = Math.max(1, Math.ceil(seats.length / 600));
    return seats.filter((_, index) => index % step === 0);
  }, [seats]);

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
      zoomIn,
      zoomOut,
      zoomTo,
      zoomToBlock: (blockId) => {
        const hull = hulls.find((h) => h.block.id === blockId);
        if (hull) frame(hull);
      },
      zoomToBounds: frame,
      zoomToSeat: (seatId) => {
        const seat = seats.find((s) => s.id === seatId);
        if (!seat) return;
        const d = space.seatDiameter * 6;
        frame({ x: seat.x - d, y: seat.y - d, w: d * 2, h: d * 2 });
      },
      toLayout,
    }),
    [
      resetView,
      zoomIn,
      zoomOut,
      zoomTo,
      hulls,
      frame,
      seats,
      space.seatDiameter,
      toLayout,
      fitContent,
      contentBounds,
    ],
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

  /**
   * Begin a resize-handle drag.
   *
   * Hoisted out of the JSX deliberately. Inline, it captured a value derived from a ref inside the
   * element map's callback, and the React Compiler then declined to compile that whole map — one
   * handler cost the memoisation of every element on the canvas. Out here it is an ordinary event
   * handler, which is exactly what it is.
   */
  const beginResize = (index: number, handle: string, e: React.PointerEvent<SVGRectElement>) => {
    if (wantsPan(e) || !onResize) return;
    e.stopPropagation();
    const from = toLayout(e.clientX, e.clientY);
    if (!from) return;
    (e.target as Element).setPointerCapture(e.pointerId);

    const report = (ev: PointerEvent, phase: "move" | "end") => {
      const at = toLayout(ev.clientX, ev.clientY);
      onResize(index, handle, (at?.x ?? from.x) - from.x, (at?.y ?? from.y) - from.y, phase);
    };
    const move = (ev: PointerEvent) => report(ev, "move");
    const up = (ev: PointerEvent) => {
      report(ev, "end");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    // Reported on EVERY move, gesture or not: a status bar's coordinates are most useful while
    // simply hovering, which is exactly when there is no gesture in flight.
    if (onViewReport) {
      const at = toLayout(e.clientX, e.clientY);
      onViewReport({ zoom, x: at ? Math.round(at.x) : null, y: at ? Math.round(at.y) : null });
    }

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
      if (!g.moved && tap) {
        onSeatActivate?.(tap);
        // And where a touch device shows the seat's details. It has to happen HERE rather than on the
        // press: `beginGesture` clears the card on the way down (so it cannot trail a drag), and a
        // finger raises no `pointerenter` to bring it back. Resolving it with the tap also means a
        // drag across the map never raises a card for a seat the buyer was only scrolling past.
        if (coarsePointer && seatTooltip) setHover({ seat: tap, left: 0, top: 0 });
      }
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

  /** Screen pixels per layout unit at the current view — what pins a hairline to a real pixel. */
  const unitPx = useMemo(() => {
    if (!viewport || view.w <= 0) return null;
    const v = viewport.w / view.w;
    return Number.isFinite(v) && v > 0 ? v : null;
  }, [viewport, view.w]);

  /**
   * The grid actually worth drawing at this zoom, or `null` for none.
   *
   * Two things have to adapt or the grid is useless at one end of the zoom range and unreadable at
   * the other, and the first attempt at this drew nothing at all on a 30,000-unit space:
   *
   *   * The STEP. At the zoom that fits a whole venue, 50-unit cells are under two pixels apart —
   *     not a grid, a flat wash. So the step doubles until the cells are far enough apart to read.
   *     Doubling (not an arbitrary jump) keeps every drawn line a multiple of the organizer's chosen
   *     step, so a visible line is always a real snap target — the grid shows FEWER positions than
   *     it snaps to, never different ones.
   *   * The STROKE. Widths live in layout units, so a fixed one shrinks with the view: two units is
   *     a fourteenth of a pixel at full-venue zoom. Dividing by `unitPx` pins them to roughly a
   *     pixel on screen at any zoom, which is what a rule should be.
   *
   * Gives up rather than drawing junk: past 64 doublings-worth the lines are so far apart they say
   * nothing about the work, and a grid nobody can use is worse than an honest blank.
   */
  const gridPlan = useMemo(() => {
    if (!gridStep || gridStep <= 0 || unitPx === null) return null;
    const MIN_CELL_PX = 7;
    let step = gridStep;
    while (step * unitPx < MIN_CELL_PX && step <= gridStep * 64) step *= 2;
    if (step * unitPx < MIN_CELL_PX) return null;
    return { step, minor: 1 / unitPx, major: 1.7 / unitPx };
  }, [gridStep, unitPx]);

  /**
   * Whether to draw the orientation inset.
   *
   * Only once the visible rectangle is meaningfully smaller than the content, and only when there is
   * enough content to get lost in. Comparing rectangles rather than a magic zoom value also works in
   * authoring, where fitting a large drawing may put the numeric zoom below one.
   */
  const showMinimap =
    seats.length + visibleElements.length > 1 &&
    (view.w < contentBounds.w * 0.9 || view.h < contentBounds.h * 0.9);

  return (
    <div className={`relative ${className}`}>
      {showMinimap && (
        <div className="absolute bottom-2 left-2 z-10 border border-beige-kem/40 bg-surface-2/90 p-1 shadow-sm">
          <svg
            ref={minimapRef}
            role="button"
            aria-label="Bản đồ thu nhỏ — bấm để chuyển khung nhìn"
            tabIndex={0}
            width={112}
            height={84}
            viewBox={`${contentBounds.x} ${contentBounds.y} ${contentBounds.w} ${contentBounds.h}`}
            className="cursor-crosshair"
            onPointerDown={navigateFromMinimap}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                centerViewAt({
                  x: contentBounds.x + contentBounds.w / 2,
                  y: contentBounds.y + contentBounds.h / 2,
                });
              }
            }}
          >
            {/* Every seat as a plain dot: the inset answers "where am I", not "which seat". */}
            {minimapSeats.map((s) => (
              <circle
                key={s.id}
                cx={s.x}
                cy={s.y}
                r={space.seatDiameter}
                className="fill-beige-kem/35"
              />
            ))}
            {visibleElements.map(({ element, index }) => {
              const shared = {
                className: "fill-transparent stroke-beige-kem/35",
                strokeWidth: Math.max(contentBounds.w, contentBounds.h) / 180,
                transform: `rotate(${element.rotation} ${element.x} ${element.y})`,
                // This is the SHAPE layer, drawn under the interactive one; it has its own copy of
                // the outline and would otherwise stay at full strength while its twin above faded.
                opacity: ghostElementIndices?.has(index) ? 0.22 : undefined,
              };
              if (element.points?.length) {
                const points = element.points.map((point) => `${point.x},${point.y}`).join(" ");
                return element.kind === "divider" ? (
                  <polyline key={`${element.kind}-${index}`} points={points} {...shared} />
                ) : (
                  <polygon key={`${element.kind}-${index}`} points={points} {...shared} />
                );
              }
              return (
                <rect
                  key={`${element.kind}-${index}`}
                  x={element.x - element.width / 2}
                  y={element.y - element.height / 2}
                  width={element.width}
                  height={element.height}
                  {...shared}
                />
              );
            })}
            {/* The slice currently on screen. */}
            <rect
              x={view.x}
              y={view.y}
              width={view.w}
              height={view.h}
              className="fill-burgundy/15 stroke-burgundy"
              strokeWidth={Math.max(contentBounds.w, contentBounds.h) / 120}
            />
          </svg>
          {editable && (
            <span className="block pt-0.5 text-center font-mono text-[9px] text-beige-kem/70">
              Bấm để di chuyển
            </span>
          )}
        </div>
      )}

      {/* Standalone buyer surfaces keep an on-canvas zoom cluster. A surrounding surface may relocate
          the same commands into its own chrome, as the editor and preview do. */}
      {!editable && showViewControls && (
        <div className="absolute right-2 top-2 z-10 flex gap-1 font-mono text-xs">
          <button
            type="button"
            onClick={zoomIn}
            aria-label="Phóng to sơ đồ"
            className="grid h-7 w-7 place-items-center border border-beige-kem/40 bg-surface-2 text-beige-kem"
          >
            +
          </button>
          <button
            type="button"
            onClick={zoomOut}
            aria-label="Thu nhỏ sơ đồ"
            className="grid h-7 w-7 place-items-center border border-beige-kem/40 bg-surface-2 text-beige-kem"
          >
            −
          </button>
          <button
            type="button"
            onClick={resetView}
            aria-label="Đặt lại khung nhìn"
            className="grid h-7 w-auto place-items-center border border-beige-kem/40 bg-surface-2 px-2 text-beige-kem"
          >
            ⟲
          </button>
        </div>
      )}

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
            "+": zoomIn,
            "=": zoomIn,
            "-": zoomOut,
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
        onPointerLeave={() => {
          setHover(null);
          // The status bar's coordinates go blank rather than freezing at the last point inside.
          onViewReport?.({ zoom, x: null, y: null });
        }}
      >
        {/*
          Hatching, so a seat's STATE survives losing its colour.

          Sold, held and withheld were three shades of the same grey, separated by opacity alone.
          At the size a seat is drawn — single-digit pixels at the default zoom — that is no
          separation at all, and for a colourblind buyer, or anyone outdoors, it is none whatever.
          Category colour already carries price; state has to carry itself some other way, so it
          gets a texture.

          `userSpaceOnUse` in layout units: the stripes then scale with the map instead of with the
          screen, so they stay the same size relative to a seat at every zoom level.
        */}
        <defs>
          <pattern
            id="seat-hatch"
            patternUnits="userSpaceOnUse"
            width={40}
            height={40}
            patternTransform="rotate(45)"
          >
            <rect width={40} height={40} className="fill-stone-800/40" />
            <line x1={0} y1={0} x2={0} y2={40} className="stroke-stone-500" strokeWidth={14} />
          </pattern>

          {/*
            The measuring grid. Two nested patterns: `chart-grid` tiles one cell, and `chart-grid-10`
            tiles ten of them and paints the firmer rule over the top.

            Widths come from `gridPlan`, which pins them to about a pixel on screen at any zoom — see
            the note there for why a fixed width in layout units draws nothing at all once the view is
            wide enough.
          */}
          {gridPlan && (
            <>
              <pattern
                id="chart-grid"
                patternUnits="userSpaceOnUse"
                width={gridPlan.step}
                height={gridPlan.step}
              >
                <path
                  d={`M ${gridPlan.step} 0 L 0 0 0 ${gridPlan.step}`}
                  fill="none"
                  className="stroke-beige-kem"
                  strokeOpacity={0.2}
                  strokeWidth={gridPlan.minor}
                />
              </pattern>
              <pattern
                id="chart-grid-10"
                patternUnits="userSpaceOnUse"
                width={gridPlan.step * 10}
                height={gridPlan.step * 10}
              >
                <rect
                  width={gridPlan.step * 10}
                  height={gridPlan.step * 10}
                  fill="url(#chart-grid)"
                />
                <path
                  d={`M ${gridPlan.step * 10} 0 L 0 0 0 ${gridPlan.step * 10}`}
                  fill="none"
                  className="stroke-beige-kem"
                  strokeOpacity={0.42}
                  strokeWidth={gridPlan.major}
                />
              </pattern>
            </>
          )}
        </defs>

        {/*
          Under the floor plan as well as the seats: the grid measures the SPACE, and a traced venue
          photo is content laid on that space, not the ground beneath it.

          Covers the VIEW, not the space. Zoomed all the way out the visible rectangle is wider than
          the space — `bounds` is cropped to the canvas aspect, so `zoomMin` pulls back until the
          shorter axis fits and the longer one then overshoots — and a grid drawn only across
          `0..space.width` ended there, leaving bare strips down both sides. The pattern tiles from
          the coordinate origin whatever rectangle is painted with it, so widening the rectangle
          moves no line: the same grid simply stops running out.

          Padded by a cell so a pan cannot outrun the fill between frames.
        */}
        {gridPlan && (
          <rect
            x={view.x - gridPlan.step}
            y={view.y - gridPlan.step}
            width={view.w + gridPlan.step * 2}
            height={view.h + gridPlan.step * 2}
            fill="url(#chart-grid-10)"
            aria-hidden="true"
            pointerEvents="none"
          />
        )}

        {/*
          No boundary is drawn.

          There was one, briefly, marking the wall `allowedDelta` enforces — on the reasoning that an
          invisible stop reads as the editor refusing to work. That reasoning belonged to the version
          where the wall sat at the edge of the frame and a drag met it constantly. Since 0041 it is
          a full frame outside the furthest the editor can zoom out, so an organizer reaches it only
          by deliberately panning into empty space, and a line permanently on screen to warn about
          something nobody arrives at is just furniture.
        */}

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
              fill="transparent"
              stroke="currentColor"
              strokeOpacity={0.3}
              strokeWidth={strokeScale * 1.5}
              strokeDasharray={`${space.seatDiameter * 0.6} ${space.seatDiameter * 0.4}`}
              className="text-beige-kem"
            />
            <text
              x={hull.x + space.seatDiameter / 3}
              y={hull.y - space.seatDiameter / 3}
              fontSize={space.seatDiameter * 1.25}
              fill="currentColor"
              fillOpacity={0.5}
              className="font-sans text-beige-kem"
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
            {t.shape === "round" ? (
              <circle
                cx={t.x}
                cy={t.y}
                r={t.width / 2}
                className={
                  selectedTableIndex === i
                    ? "fill-burgundy/15 stroke-burgundy"
                    : "fill-beige-kem/10 stroke-beige-kem/40"
                }
                strokeWidth={selectedTableIndex === i ? 12 : 8}
              />
            ) : (
              <rect
                x={t.x - t.width / 2}
                y={t.y - t.height / 2}
                width={t.width}
                height={t.height}
                className={
                  selectedTableIndex === i
                    ? "fill-burgundy/15 stroke-burgundy"
                    : "fill-beige-kem/10 stroke-beige-kem/40"
                }
                strokeWidth={selectedTableIndex === i ? 12 : 8}
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
          // A capacity zone without an explicit colour defaults to the standing-yellow: the faint
          // ink wash made it nearly invisible at overview zoom, and its label carried no colour.
          const zoneYellow = el.kind === "area" && !el.color ? "#F0E442" : undefined;
          // Skipped IN PLACE rather than filtered out: `i` is this element's identity for
          // `selectedElementIndex`, `onElementPointerDown`, `onResize` and `onVertexDrag`, so
          // removing entries would silently re-point the editor's selection at its neighbour.
          if (hiddenElementIndices?.has(i)) return null;
          if (!Number.isFinite(el.x) || !Number.isFinite(el.y)) return null;
          const ghosted = ghostElementIndices?.has(i) ?? false;
          const grabbable = editable && !ghosted && !!onElementPointerDown;
          return (
            <g
              key={`el-${i}`}
              transform={`rotate(${el.rotation} ${el.x} ${el.y})`}
              aria-hidden="true"
              pointerEvents={grabbable ? undefined : "none"}
              opacity={ghosted ? 0.22 : undefined}
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
              {SHAPE_KINDS.has(el.kind) && el.points && el.points.length >= 2 && (
                <polyline
                  // A boundary closes back to its first point; a divider stays an open line.
                  points={(el.kind === "boundary" ? [...el.points, el.points[0]] : el.points)
                    .map((p) => `${p.x},${p.y}`)
                    .join(" ")}
                  className={el.color ? "" : ELEMENT_FILL[el.kind]}
                  strokeWidth={selectedElementIndex === i ? 16 : 10}
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
              {/*
              Resize handles (§6). Only on a single selected element, and only where `width`/`height`
              ARE the geometry — a drawn shape is defined by its points, and dragging a box around it
              would claim to resize something the box only approximates.
            */}
              {onResize &&
                selectedElementIndex === i &&
                !SHAPE_KINDS.has(el.kind) &&
                (["nw", "n", "ne", "w", "e", "sw", "s", "se"] as const).map((handle) => {
                  const hx =
                    el.x +
                    (handle.includes("w")
                      ? -el.width / 2
                      : handle.includes("e")
                        ? el.width / 2
                        : 0);
                  const hy =
                    el.y +
                    (handle.includes("n")
                      ? -el.height / 2
                      : handle.includes("s")
                        ? el.height / 2
                        : 0);
                  return (
                    <rect
                      key={handle}
                      x={hx - Math.max(14, 44 / Math.sqrt(zoom))}
                      y={hy - Math.max(14, 44 / Math.sqrt(zoom))}
                      width={Math.max(28, 88 / Math.sqrt(zoom))}
                      height={Math.max(28, 88 / Math.sqrt(zoom))}
                      className="fill-burgundy stroke-beige-kem"
                      strokeWidth={strokeScale}
                      style={{ cursor: `${handle}-resize` }}
                      onPointerDown={(e) => beginResize(i, handle, e)}
                    />
                  );
                })}

              {/*
                Corner handles for a drawn outline, measured from the POINTS.

                The resize box above is suppressed for shapes because `width`/`height` only
                approximate a polygon — a true statement that left shapes with no size control at all,
                so the only way to enlarge a hand-drawn outline was to drag every vertex by eye. These
                handles sit on the real extent and scale the points themselves, which is the operation
                the box could not honestly offer.

                Corners only, no edge midpoints: the scale is uniform, and a midpoint handle would
                promise a per-axis stretch these do not do.
              */}
              {onShapeScale &&
                selectedElementIndex === i &&
                SHAPE_KINDS.has(el.kind) &&
                el.points &&
                el.points.length >= 2 &&
                (() => {
                  const xs = el.points.map((p) => p.x);
                  const ys = el.points.map((p) => p.y);
                  const box = {
                    minX: Math.min(...xs),
                    maxX: Math.max(...xs),
                    minY: Math.min(...ys),
                    maxY: Math.max(...ys),
                  };
                  const size = Math.max(28, 88 / Math.sqrt(zoom));
                  return (
                    <g>
                      {(["nw", "ne", "sw", "se"] as const).map((corner) => {
                        const hx = corner.includes("w") ? box.minX : box.maxX;
                        const hy = corner.includes("n") ? box.minY : box.maxY;
                        return (
                          <rect
                            key={corner}
                            x={hx - size / 2}
                            y={hy - size / 2}
                            width={size}
                            height={size}
                            className="fill-beige-kem stroke-burgundy"
                            strokeWidth={strokeScale}
                            style={{ cursor: `${corner}-resize` }}
                            onPointerDown={(e) => {
                              if (wantsPan(e)) return;
                              e.stopPropagation();
                              (e.target as Element).setPointerCapture(e.pointerId);
                              let last = { x: hx, y: hy };
                              const move = (ev: PointerEvent) => {
                                const at = toLayout(ev.clientX, ev.clientY);
                                if (!at) return;
                                last = at;
                                onShapeScale(i, corner, at.x, at.y, "move");
                              };
                              const up = () => {
                                onShapeScale(i, corner, last.x, last.y, "end");
                                window.removeEventListener("pointermove", move);
                                window.removeEventListener("pointerup", up);
                              };
                              window.addEventListener("pointermove", move);
                              window.addEventListener("pointerup", up);
                            }}
                          />
                        );
                      })}
                    </g>
                  );
                })()}

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
                      // The last position the pointer actually reported, so the commit on release
                      // lands exactly where the preview was — `pointerup` does not always carry a
                      // usable coordinate, and re-reading it there could snap the vertex back.
                      let last = { x: p.x, y: p.y };
                      const move = (ev: PointerEvent) => {
                        const at = toLayout(ev.clientX, ev.clientY);
                        if (!at) return;
                        last = at;
                        onVertexDrag(i, v, at.x, at.y, "move");
                      };
                      const up = () => {
                        onVertexDrag(i, v, last.x, last.y, "end");
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
                  strokeWidth={
                    selectedElementIndex === i
                      ? Math.max(10, strokeScale * 2.4)
                      : zoneYellow
                        ? strokeScale * 2.4
                        : 6
                  }
                  strokeDasharray={el.kind === "aisle" ? "40 30" : undefined}
                  // A chosen colour replaces the theme's own ink for this element, the same way it does
                  // for a drawn outline above: solid edge, translucent wash, so a stage or a standing
                  // zone can be told apart from the one beside it at a glance. A capacity zone without
                  // a chosen colour falls back to the standing-yellow rather than the faint wash — an
                  // almost-invisible outline was a zone nobody noticed until they zoomed in.
                  className={el.color || zoneYellow ? "" : ELEMENT_FILL[el.kind]}
                  style={
                    el.color
                      ? { stroke: el.color, fill: `${el.color}33` }
                      : zoneYellow
                        ? { stroke: zoneYellow, fill: `${zoneYellow}47` }
                        : undefined
                  }
                />
              )}
              {el.label && !SHAPE_KINDS.has(el.kind) && (
                // Text content, never markup — React escapes it (FR-018, SEC-07).
                <text
                  x={el.x}
                  y={el.y - (el.kind === "area" && el.capacity ? Math.max(40, el.height / 10) : 0)}
                  textAnchor="middle"
                  dominantBaseline="central"
                  // Fit both dimensions: stages, areas and text blocks can be tall and narrow, so a
                  // long caption must not run past the component's own edges.
                  fontSize={Math.min(
                    Math.max(60, el.height / 3),
                    // 0.62em is about the width of a monospace glyph; the 0.9 keeps it off the edges.
                    Math.max(40, (el.width * 0.9) / Math.max(1, el.label.length * 0.62)),
                  )}
                  className={
                    el.kind === "stage" || el.kind === "area"
                      ? "fill-beige-kem font-display font-bold"
                      : "fill-beige-kem/70 font-mono"
                  }
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
                  className="fill-beige-kem/65 font-sans"
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
        {drawnMarkers.map((m) => {
          const picked = selectedRowKey === m.key;
          return (
            <g key={m.key}>
              {/* A letter is a thin target. The disc behind it is what makes the row clickable at any
                  zoom, and it doubles as the selected state — the same trick the seat hit-area uses. */}
              {onRowSelect && (
                <circle
                  cx={m.x}
                  cy={m.y}
                  r={space.seatDiameter * 0.62}
                  className={
                    picked ? "fill-burgundy/35 stroke-burgundy" : "fill-transparent stroke-none"
                  }
                  strokeWidth={strokeScale}
                  style={{ cursor: "pointer" }}
                  role="button"
                  aria-label={`Hàng ${m.label}`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onRowSelect(m.key.split("|")[0] || null, m.label);
                  }}
                />
              )}
              <text
                x={m.x}
                y={m.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={space.seatDiameter * 0.95}
                aria-hidden="true"
                className={`pointer-events-none font-mono font-bold ${picked ? "fill-beige-kem" : "fill-beige-kem/55"}`}
              >
                {m.label}
              </text>
            </g>
          );
        })}

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
          const ghosted = ghostSeatIds?.has(seat.id) ?? false;
          return (
            <g
              key={seat.id}
              transform={`rotate(${seat.rotation} ${seat.x} ${seat.y})`}
              role={interactive && !ghosted ? "button" : "img"}
              aria-label={label}
              aria-pressed={interactive && !ghosted && selectedIds ? selected : undefined}
              tabIndex={interactive && !ghosted ? 0 : -1}
              // `pointer-events: none` rather than merely skipping the handlers: a ghosted seat must
              // also stop swallowing the drag that starts on top of it, or panning across another
              // floor would stall wherever the pointer happened to land.
              pointerEvents={ghosted ? "none" : undefined}
              opacity={ghosted ? 0.22 : undefined}
              onPointerDown={
                editable && !ghosted
                  ? (e) => {
                      e.stopPropagation();
                      if (!wantsPan(e)) onSeatPointerDown?.(seat, e.shiftKey, e.altKey);
                      beginGesture(e, "seat");
                    }
                  : interactive && !ghosted
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
                // out between neighbours — it just moves. Skipped on touch, where lifting the finger
                // fires it and would snatch the card away the instant the tap produced it.
                seatTooltip && !coarsePointer
                  ? () => setHover((h) => (h?.seat.id === seat.id ? null : h))
                  : undefined
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
                interactive || editable
                  ? "cursor-pointer outline-none focus-visible:opacity-80"
                  : ""
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
              <rect x={seat.x - rr} y={seat.y - rr} width={d} height={d} fill="transparent" />
              {/*
                The accessibility mark: a ring around the seat, not a pictogram inside it.

                It used to be a wheelchair glyph drawn INSTEAD of the seat number, because two
                characters do not fit in one cushion — so an accessible seat was the only seat on the
                map whose number you could not read. A ring says the same thing in the margin the seat
                already has, and the number stays. The label still announces it for anyone who cannot
                see either.
              */}
              {seat.isAccessible && (
                <rect
                  x={seat.x - rr - strokeScale * 1.5}
                  y={seat.y - rr - strokeScale * 1.5}
                  width={d + strokeScale * 3}
                  height={d + strokeScale * 3}
                  fill="none"
                  strokeWidth={strokeScale * 1.2}
                  strokeDasharray={`${strokeScale * 3} ${strokeScale * 2}`}
                  pointerEvents="none"
                  className={ink ? "" : "stroke-beige-kem/80"}
                  style={ink ? { stroke: ink } : undefined}
                />
              )}
              {showNumbers && seat.section !== null && (
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

      {/* Seat card. Pointer-transparent, so it can never eat the click it is describing. On touch it
          is pinned to the bottom edge rather than to the finger — see `coarsePointer`. */}
      {hover && seatTooltip && (
        <div
          className={
            coarsePointer
              ? "pointer-events-none absolute inset-x-2 bottom-2 z-20 border-2 border-beige-kem bg-surface-2 px-2.5 py-2 text-center font-mono text-xs text-beige-kem shadow-lg"
              : "pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-[calc(100%+12px)] whitespace-nowrap border-2 border-beige-kem bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-beige-kem shadow-lg"
          }
          style={coarsePointer ? undefined : { left: hover.left, top: hover.top }}
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
