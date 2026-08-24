/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BlockKind,
  BlockParams,
  ChartDocument,
  DocumentBlock,
  DocumentSeat,
} from "@/shared/catalog/seatmap-document";
import {
  emptyDocument,
  nextBlockKey,
  resolvedSeatSectionId,
} from "@/shared/catalog/seatmap-document";
import { projectDocument } from "@/shared/catalog/seatmap-project";
import {
  LAYOUT_SPACE,
  clampCoord,
  type ValidationIssue,
  blockingIssues,
  validateLayout,
} from "@/shared/catalog/seatmap-validate";
import type { Layout, ShapePoint } from "@/shared/catalog/seatmap";
import {
  CircleHelp,
  Eye,
  EyeOff,
  Grid3x3,
  Hexagon,
  Keyboard,
  Layers3,
  ListChecks,
  Maximize,
  MousePointer2,
  PenTool,
  RectangleHorizontal,
  Redo2,
  Rows3,
  Settings2,
  Tags,
  Type,
  Undo2,
  Users,
  X,
} from "lucide-react";
import ConfirmDialog, { type ConfirmRequest } from "../ConfirmDialog";
import { layoutApi } from "../../services/catalogClient";
import BlockInspector from "./BlockInspector";
import BlockPalette from "./BlockPalette";
import { editorHint } from "./editorHint";
import ChartEditorCoachmarks from "./ChartEditorCoachmarks";
import LayersPanel from "./LayersPanel";
import PreviewOverlay from "./PreviewOverlay";
import OrientationPanel from "./OrientationPanel";
import { renumberSection, renumberSelection } from "./numbering";
import RowInspector from "./RowInspector";
import { assignRowToSection, deleteRow, duplicateRow, renameRow, reverseRow } from "./rowOps";
import CategoryPanel from "./CategoryPanel";
import FloorPlanPanel from "./FloorPlanPanel";
import ReferenceChartPanel from "./ReferenceChartPanel";
import { ghostedBlockKeys } from "./floorLayout";
import { RAIL_PANEL } from "./panelSurface";
import SeatCanvas, { type CanvasBlock, type CanvasSeat, type SeatCanvasHandle } from "./SeatCanvas";
import TablePalette from "./TablePalette";
import ValidationPanel from "./ValidationPanel";
import {
  addBlock,
  addCategory,
  BLOCK_DRAG_TYPE,
  addSection,
  assignBlocksToSection,
  assignSeatsToSection,
  BLOCK_LABEL,
  type BlockAlignEdge,
  type BlockGeometry,
  type BlockTarget,
  alignBlocks,
  angleFromPointer,
  alignedPosition,
  allowedDelta,
  colorable,
  copyBlocks,
  distributeBlocks,
  duplicateBlocks,
  flipBlocks,
  EDITABLE_SEAT_TYPES,
  type EditableSeatType,
  geometryPoints,
  groupBlocks,
  hasPlaceholderIds,
  moveBlocks,
  movedPosition,
  nextBlockContext,
  occupiedBounds,
  pasteBlocks,
  parseBlockDrag,
  NUDGE,
  remainingBudget,
  removeBlocks,
  removeCategory,
  repackRowLabels,
  removeSection,
  type ResizeHandle,
  resizedBox,
  rotateBlocks,
  type SeatRef,
  seatCount,
  selectionAfterPress,
  selectionBounds,
  setBlockColor,
  setHidden,
  shapeBounds,
  scaleShapePoints,
  type SnapGuide,
  type SpacingMark,
  snapToObjects,
  spacingMarks,
  setRotation,
  setSeatType,
  setBlockParams,
  setLocked,
  updateBlock,
  updateCategory,
  ungroupBlocks,
  updateSeats,
  withGroups,
} from "./documentOps";
import SectionPanel from "./SectionPanel";
import { useLayoutHistory } from "./useLayoutHistory";
import {
  CATEGORY_COLORS,
  GRID,
  GRID_STEPS,
  SEAT_PITCH,
  mintId,
  type Snap,
  snap,
  translateElement,
} from "./layoutOps";

/**
 * The chart editor.
 *
 * It edits a `ChartDocument` — the authoring document — and renders it by PROJECTING it to seats and
 * feeding those into `SeatCanvas`, the very renderer the buyer sees. That is not a shortcut; it is the
 * point. The organizer is always looking at the seats that would actually go on sale, computed by the
 * same `projectDocument` the server runs when it saves, so the picture and the inventory cannot drift.
 * A second, document-specific renderer would have hidden exactly that.
 *
 * Editing is at BLOCK level. A block knows it is "6 rows of 18, lettered A upward", so changing it to
 * 20 per row is an edit that keeps every seat's database row (and therefore any ticket sold against
 * one). The previous editor moved individual seats, which meant that description existed only until the
 * drag ended.
 */

const btn =
  " border-2 border-beige-kem px-2.5 py-1.5 text-xs font-bold text-beige-kem/80 transition hover:text-beige-kem disabled:cursor-not-allowed disabled:opacity-40";

/** Shared text-button treatment for compact editor actions. */
const primary =
  " bg-burgundy px-3 py-1.5 text-xs font-black text-white transition hover:brightness-95 disabled:opacity-40";

/**
 * A square icon button, for controls whose meaning a glyph can carry.
 *
 * Same height as `btn` so the two sit on one baseline in a mixed row. `aria-pressed` styling is left
 * to the caller: some of these are toggles and some are one-shot actions, and a shared "on" look
 * would imply state on the ones that have none.
 */
const icon =
  " grid h-[30px] w-[30px] place-items-center border-2 border-beige-kem text-beige-kem/80 transition hover:text-beige-kem disabled:cursor-not-allowed disabled:opacity-40";

/**
 * The way OUT of a full-screen editor, sized apart from the icon row it sits in.
 *
 * `icon` is shared by four buttons whose glyphs are incidental — hide labels, shortcuts, help — and
 * widening that class would have swollen all of them. This one earns the extra room on its own: it
 * is the only control that leaves the editor, the header is 56px tall so 40px fits without pushing
 * anything, and it lands near the 44px hit target the picker guidance asks for rather than the 30px
 * a decorative toggle can live with.
 */
const closeButton =
  " grid h-10 w-10 place-items-center border-2 border-beige-kem text-beige-kem/80 transition hover:bg-beige-kem hover:text-xanh-pho disabled:cursor-not-allowed disabled:opacity-40";

/** Compact control treatment used by the canvas status dock. */
const statusButton =
  "flex h-8 items-center gap-1.5 whitespace-nowrap border border-beige-kem/35 px-2 font-mono text-xs font-bold text-beige-kem/80 transition hover:border-beige-kem hover:text-beige-kem";

/** Compact semantic badge used for lifecycle, save, and validation status in the editor header. */
const headerStatus =
  "inline-flex min-h-6 items-center border px-2.5 py-0.5 font-mono text-[10px] font-bold leading-none";

const ALIGN_EDGES: readonly BlockAlignEdge[] = [
  "left",
  "centerX",
  "right",
  "top",
  "centerY",
  "bottom",
];
const ALIGN_LABEL: Record<BlockAlignEdge, string> = {
  left: "Canh trái",
  centerX: "Canh giữa ngang",
  right: "Canh phải",
  top: "Canh trên",
  centerY: "Canh giữa dọc",
  bottom: "Canh dưới",
};
const ALIGN_GLYPH: Record<BlockAlignEdge, string> = {
  left: "⇤",
  centerX: "↔",
  right: "⇥",
  top: "⇧",
  centerY: "↕",
  bottom: "⇩",
};

/** Describe grid spacing in the unit an organizer sees on the canvas, not raw layout coordinates. */
function gridSpacingLabel(step: number): string {
  const pitches = step / SEAT_PITCH;
  return `${Number(pitches.toFixed(1)).toLocaleString("vi-VN")} khoảng ghế`;
}

/**
 * Where an unsaved draft is parked.
 *
 * Keyed by layout so two charts cannot overwrite each other's recovery copy, and stamped with the
 * layout version it was built on: a draft written against version 7 is meaningless once the stored
 * chart has moved to 8 (someone else saved, or this browser saved from another tab), and restoring it
 * would silently undo that save. Such a draft is dropped rather than offered.
 */
const draftKey = (layoutId: number) => `tixhub:chart-draft:${layoutId}`;

interface StoredDraft {
  baseVersion: number;
  savedAt: number;
  document: ChartDocument;
}

function readStoredDraft(layoutId: number, version: number): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(layoutId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    if (parsed.baseVersion !== version || !parsed.document?.blocks) {
      window.localStorage.removeItem(draftKey(layoutId));
      return null;
    }
    return parsed;
  } catch {
    // A corrupt or unreadable entry must never stop the editor opening — the chart on the server is
    // intact, and the recovery copy is by definition the expendable one.
    return null;
  }
}

function forgetStoredDraft(layoutId: number): void {
  try {
    window.localStorage.removeItem(draftKey(layoutId));
  } catch {
    /* private mode, quota, disabled storage — recovery is best-effort by design */
  }
}

/** How long the editor waits after the last edit before parking a recovery copy. */
const RECOVERY_DEBOUNCE_MS = 800;

/** What a freshly drawn outline is coloured, so it is visible the moment it exists. */
const SHAPE_DEFAULT_COLOR = "#BFC0F2";

/**
 * How near a neighbour's centre line a drag has to come before it locks on, in layout units.
 *
 * 150 is one seat pitch — near enough that a deliberate placement a seat away is never stolen, far
 * enough that a drag aimed at alignment finds it. In LAYOUT units rather than pixels on purpose: a
 * threshold in pixels would grab from further away the more the organizer zoomed out, which is
 * exactly when they are placing blocks roughly and do not want to be corrected.
 */
const SNAP_DISTANCE = 150;

/**
 * How long the organizer must be still before an autosave fires.
 *
 * Well past the recovery debounce, so the local copy is always parked first — if the save fails, the
 * net is already under it. Long enough that a pause for thought is not a save, short enough that a
 * closed laptop loses at most a few seconds of work.
 */
const AUTOSAVE_IDLE_MS = 12_000;

type WorkspaceMode =
  "select" | "draw" | "sections" | "labels" | "seatClasses" | "check" | "settings";

const WORKSPACE_MODES = [
  { id: "select", label: "Chọn", icon: MousePointer2 },
  { id: "draw", label: "Thêm", icon: Grid3x3 },
  { id: "sections", label: "Khu vực", icon: Layers3 },
  { id: "labels", label: "Đánh nhãn", icon: Type },
  { id: "seatClasses", label: "Hạng ghế", icon: Tags },
  { id: "check", label: "Kiểm tra", icon: ListChecks },
  { id: "settings", label: "Thiết lập", icon: Settings2 },
] as const satisfies ReadonlyArray<{
  id: WorkspaceMode;
  label: string;
  icon: typeof MousePointer2;
}>;

/*
 * Just the name of the mode. The `body` line that used to sit under each of these described what the
 * controls directly below it already are — "Tạo khu và gán phần đang chọn vào đúng khu" above a
 * panel whose every button says so. Prose that restates the UI is read once and skipped forever,
 * while the space it costs is paid on every glance.
 */
const WORKSPACE_TITLE: Record<WorkspaceMode, string> = {
  select: "Chọn & chỉnh sửa",
  draw: "Thêm vào sơ đồ",
  sections: "Khu vực",
  labels: "Đánh nhãn",
  seatClasses: "Hạng ghế",
  check: "Kiểm tra",
  settings: "Thiết lập",
};

/** `bestAvailable` uses the first projected stage. Centralize the authoring side of that invariant. */
const makeStagePrimary = (doc: ChartDocument, key: string): ChartDocument => {
  const stage = doc.blocks.find((block) => block.key === key && block.kind === "stage");
  return stage
    ? { ...doc, blocks: [stage, ...doc.blocks.filter((block) => block.key !== key)] }
    : doc;
};

/**
 * "vừa xong" / "30 giây trước" / "4 phút trước".
 *
 * Coarse on purpose: the question a save-state answers is "did my work land", not "exactly when", and
 * a second-by-second counter draws the eye to a number that does not matter.
 */
function agoLabel(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 10) return "vừa xong";
  if (seconds < 60) return `${Math.round(seconds / 10) * 10} giây trước`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} phút trước`;
  return `${Math.round(minutes / 60)} giờ trước`;
}

/**
 * One collapsible group in the right rail.
 *
 * The rail carried eight panels in a single scrolling column, none of them foldable, with the
 * inspector — the one an organizer touches most — sitting third behind two palettes. Folding the
 * set-up-once tools away puts the working panels within reach without hiding anything.
 */
/**
 * A status-bar toggle that states itself in a box.
 *
 * The box is the point. These used to read "Hiện lưới bật" / "Hiện lưới tắt", which spends the
 * label's width twice and leaves the reader parsing a sentence to learn a boolean — and once four of
 * them sat in a row, that was most of the bar. A checkbox is read, not parsed.
 *
 * Colour still shifts with the state, but it is no longer the only carrier: a filled box and an
 * empty one differ in shape, so the bar survives greyscale and a dim screen. `aria-pressed` gives a
 * screen reader the same fact a third way.
 */
function BarToggle({
  on,
  onClick,
  label,
  title,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={title}
      className={`flex w-full items-center gap-2 border border-beige-kem/30 px-2 py-1.5 text-left text-xs font-bold transition hover:border-beige-kem hover:text-beige-kem ${
        on ? "bg-burgundy/15 text-beige-kem" : "text-beige-kem/70"
      }`}
    >
      <span aria-hidden="true">{on ? "☑" : "☐"}</span>
      {label}
    </button>
  );
}

function RailGroup({
  title,
  openWhen = false,
  children,
}: {
  title: string;
  /**
   * Whether this group should be showing — re-evaluated, NOT an initial value.
   *
   * It used to be named for a default, which reads as "open it the first time, then leave it alone".
   * That is not what it does: React re-applies `open` to the <details> every time this boolean
   * changes, and two callers derive it from the selection — so selecting a block really does close
   * "Cấu trúc & tìm kiếm" and open "Khu vực & hạng ghế" over whatever the organizer last set.
   *
   * That is the intended behaviour: the rail follows what is being worked on. It is also why the
   * groups whose value never changes — the palette and the two inspectors — keep a manual toggle for
   * as long as the editor stays open. The old name was the whole problem, because it described a
   * component that would ignore the selection, and reading it that way is how a plan to "stop the
   * rail overriding the organizer" got written against behaviour that was working as designed.
   */
  openWhen?: boolean;
  children: React.ReactNode;
}) {
  return (
    // A RULE between groups, not a box around each. The panels inside no longer draw their own
    // borders (see `RAIL_PANEL`), so this is the rail's only edge — and one hairline per group reads
    // as a list of sections rather than as a stack of cards.
    <details open={openWhen} className="border-t border-beige-kem/25 first:border-t-0">
      <summary className="cursor-pointer select-none py-2 font-mono text-[11px] font-bold uppercase tracking-widest text-beige-kem/70 marker:text-beige-kem/70">
        {title}
      </summary>
      <div className="space-y-3 pb-3">{children}</div>
    </details>
  );
}

export default function ChartEditor({
  layoutId,
  tierLabels,
  onClose,
}: {
  layoutId: number;
  /**
   * Ticket-tier labels already priced on the showtimes this chart serves, passed through to
   * `CategoryPanel` as suggestions and as an early warning (see its header note).
   *
   * Optional because the chart library opens the editor with no event behind it — a venue's chart
   * exists independently of any one event, which is the whole reason the two lists are separate
   * tables. Absent means the panel simply says nothing about tiers.
   */
  tierLabels?: string[];
  onClose: () => void;
}) {
  const [layout, setLayout] = useState<Layout | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const arrangementMenu = useRef<HTMLDetailsElement>(null);
  const arrangementTrigger = useRef<HTMLElement>(null);
  const inspectorRail = useRef<HTMLElement>(null);
  const bottomDock = useRef<HTMLElement>(null);
  const [bottomMenu, setBottomMenu] = useState<"zoom" | "grid" | "snap" | "legend" | null>(null);
  /**
   * Individual seats, for the case a block is a default rather than a uniform group: a wheelchair place
   * in the middle of a row, two VIP seats at the front of an otherwise standard block.
   *
   * Mutually exclusive with the block selection, so the inspector rail always has one unambiguous subject.
   * Held as canvas seat ids and resolved to document positions through `originOfSeat`, because a seat
   * that has never been saved has no database id to hold on to.
   */
  const [seatSel, setSeatSel] = useState<Set<number>>(new Set());

  /** The arrangement menu is a temporary tool surface: selection changes, outside clicks and Escape dismiss it. */
  useEffect(() => {
    const menu = arrangementMenu.current;
    if (menu) {
      const focusWasInside =
        document.activeElement instanceof Node && menu.contains(document.activeElement);
      menu.open = false;
      if (focusWasInside) arrangementTrigger.current?.focus();
    }
    inspectorRail.current?.scrollTo({ top: 0 });
  }, [selected, seatSel]);
  useEffect(() => {
    const dismiss = (event: PointerEvent | KeyboardEvent) => {
      const menu = arrangementMenu.current;
      if (!menu?.open) return;
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        menu.open = false;
        arrangementTrigger.current?.focus();
        return;
      }
      if (
        event instanceof PointerEvent &&
        event.target instanceof Node &&
        !menu.contains(event.target)
      ) {
        menu.open = false;
      }
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", dismiss);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", dismiss);
    };
  }, []);
  useEffect(() => {
    if (!bottomMenu) return;
    const dismiss = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        const menu = bottomMenu;
        setBottomMenu(null);
        requestAnimationFrame(() =>
          bottomDock.current
            ?.querySelector<HTMLButtonElement>(`[data-bottom-menu="${menu}"]`)
            ?.focus(),
        );
        return;
      }
      if (
        event instanceof PointerEvent &&
        event.target instanceof Node &&
        !bottomDock.current?.contains(event.target)
      ) {
        setBottomMenu(null);
      }
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", dismiss);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", dismiss);
    };
  }, [bottomMenu]);
  /**
   * The grid STEP, in layout units.
   *
   * A number rather than the boolean this used to be, because the one step (50, half a seat) is the
   * wrong step for most of what gets placed: an organizer positioning blocks and aisles is working
   * in seat-pitches, and a half-seat grid under that work rounds to lines that mean nothing to the
   * thing being moved. Always positive — whether the grid is drawn or obeyed is the business of the
   * two flags below, so turning it off and on again cannot lose the chosen step.
   */
  const [gridStep, setGridStep] = useState<number>(GRID);
  /**
   * Showing the grid and obeying it are SEPARATE (§3).
   *
   * They were one flag, which forced a false choice on both sides: an organizer who wanted the
   * lines only as a visual reference had to accept every drag being rounded, and one who wanted
   * clean snapping had to accept the ruling drawn over their chart. Every drawing tool splits these
   * for the same reason, and the pairing is not even symmetric in practice — tracing a venue photo
   * wants the lines off and the snapping on, checking a finished chart wants the reverse.
   *
   * The step they share is the same number, so what is drawn is still exactly what is snapped to
   * whenever both are on.
   */
  const [showGrid, setShowGrid] = useState(true);
  const [snapGrid, setSnapGrid] = useState(true);
  /** What the ops actually round to — `false` is the `Snap` spelling for "leave it alone". */
  const grid: Snap = snapGrid ? gridStep : false;
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<SeatCanvasHandle>(null);
  const dragging = useRef(false);
  const draggingElement = useRef(false);
  /** The document as the server last gave it to us, so a table gesture can tell whether there are
   *  unsaved block edits it would otherwise throw away. */
  /**
   * The document as the server last gave it to us, serialized — the baseline "unsaved" is measured
   * against. State rather than a ref because it decides what renders, and a string rather than the
   * object because every use is a comparison.
   */
  const [serverJson, setServerJson] = useState("");
  const [recovery, setRecovery] = useState<StoredDraft | null>(null);
  /** Where the last block was put, so the next one goes to the same place. State rather than a ref
   *  because the palette SHOWS the destination, and a ref read during render is not reactive. */
  /** Highlights the canvas while a palette item is being dragged over it. */
  const [dropping, setDropping] = useState(false);
  /**
   * Points placed so far while drawing a free-form outline, or null when not drawing.
   *
   * A shape is a run of points closed back to the first, so drawing one is just collecting clicks. The
   * mode is a separate state rather than a variant of the selection gesture: selecting and drawing want
   * opposite things from a click on empty space, and overloading that is how the seat tap was lost.
   */
  const [drawing, setDrawing] = useState<{ x: number; y: number }[] | null>(null);
  /** What the organizer has PINNED as the destination for new blocks. Both fields start `undefined`,
   *  which is "nothing said" — the block follows the selection, exactly as it always has. */
  const [lastUsed, setLastUsed] = useState<BlockTarget>({
    sectionId: undefined,
    categoryId: undefined,
  });
  /** The colour the next block takes, remembered like the section and class above it: drawing five
   *  zones in one colour should be five clicks, not five clicks and five trips to a swatch. */
  const [shapeColor, setShapeColor] = useState<string | null>(null);
  /**
   * The row the organizer has clicked, as `section|label` — the same key `rowMarkers` draws with.
   *
   * A THIRD selection level beside blocks and seats (§19: section mode and seat mode), so a row can be
   * renamed or reversed without first working out which block it belongs to. Held as the label rather
   * than a row id because a row drawn this session has no id until the chart is saved.
   */
  const [rowSel, setRowSel] = useState<string | null>(null);
  /**
   * The clipboard (§27, §48).
   *
   * In editor state rather than the system clipboard: what is copied is a run of document blocks with
   * their parameters and seats, which has no sensible text form, and reading the system clipboard
   * needs a permission prompt for something that never leaves this screen.
   */
  const [clipboard, setClipboard] = useState<DocumentBlock[]>([]);
  /** Preview mode (§34) — the same chart, drawn as a buyer meets it. */
  const [previewing, setPreviewing] = useState(false);
  /**
   * Section hulls on/off (FR-035, §12).
   *
   * They are a VIEW aid — a coloured outline telling the organizer which seats belong to which named
   * area. But on a dense chart they become visual noise that fights the seat grid for attention, so
   * they start hidden and remain available through the eye toggle when the organizer needs them.
   */
  const [showHulls, setShowHulls] = useState(false);
  /** The keyboard-shortcuts reference (§44). Hidden until asked for. */
  const [showKeys, setShowKeys] = useState(false);
  /** When the last successful server save landed, for the save-state readout (§29). */
  const [savedAt, setSavedAt] = useState<number | null>(null);
  /** When the recovery copy was last parked locally — the safety net's own state. */
  const [parkedAt, setParkedAt] = useState<number | null>(null);
  /**
   * The last save was refused, so the autosave stands down.
   *
   * A refused save is not a transient hiccup to retry every twelve seconds. The clearest case is
   * `stale_version`: the version travels with the document, `setLayout` only runs on success, so a
   * conflict left the editor resending the SAME stale version forever — a silent failure loop that
   * ended only in a reload, with the organizer's later manual saves failing for a reason the banner
   * had already scrolled past. The same is true of a seat-limit refusal or a 500: re-sending a
   * document the server has just rejected is not progress.
   *
   * Cleared when the organizer acts — pressing Lưu, or reloading the chart.
   */
  const [saveRefused, setSaveRefused] = useState(false);
  /**
   * Connectivity, for §29's offline case.
   *
   * `navigator.onLine` is only ever trustworthy when it says FALSE — a machine can be "online" and
   * still unable to reach this server. So it drives the reassuring half of the message only, and a
   * failed save is what actually tells the organizer something is wrong.
   */
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  /**
   * The clock the save-state reads, ticked rather than sampled.
   *
   * Held in state instead of calling `Date.now()` while rendering: reading the clock during render is
   * impure — two renders in the same frame can disagree — and it is what the React Compiler refuses
   * to memoise around. Coarse by design; the label it feeds is coarse too.
   */
  const [now, setNow] = useState(() => Date.now());
  /** Zoom and pointer position, pushed up by the canvas for the status bar (§3). */
  const [viewReport, setViewReport] = useState<{
    zoom: number;
    x: number | null;
    y: number | null;
  }>({
    zoom: 1,
    x: null,
    y: null,
  });
  /**
   * Whether deleting or shrinking closes the gap in a section's row lettering.
   *
   * The specification (§9, §16, §42 Rules 2 and 5) says numbering must be explicit and that deleting
   * must never renumber. Automatic is nevertheless the default here, deliberately: it is the behaviour
   * that was asked for and it is what most organizers want while drawing. This toggle is what makes
   * that a choice rather than an omission — turned off, nothing re-letters a chart except the explicit
   * "Đánh lại số" command, which is exactly the specification's model.
   *
   * A PREFERENCE, not chart data: it lives in localStorage rather than in the document, because it
   * describes how this person likes to work and not how this venue is laid out.
   */
  const [autoRenumber, setAutoRenumber] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("tixhub.autoRenumber") !== "off";
    } catch {
      return true; // private mode, or storage disabled — the default stands
    }
  });
  const toggleAutoRenumber = useCallback(() => {
    setAutoRenumber((current) => {
      const next = !current;
      try {
        window.localStorage.setItem("tixhub.autoRenumber", next ? "on" : "off");
      } catch {
        // Storage refused; the choice still applies for this session.
      }
      return next;
    });
  }, []);
  const repack = useCallback(
    (d: ChartDocument) => (autoRenumber ? repackRowLabels(d) : d),
    [autoRenumber],
  );
  const [confirm, setConfirm] = useState<(ConfirmRequest & { onConfirm: () => void }) | null>(null);
  const [dragDelta, setDragDelta] = useState<{ dx: number; dy: number } | null>(null);
  /** The lines a snapped drag is currently locked to, drawn while the pointer is down (§25). */
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  /** Gaps to the nearest blocks along the active guides — cleared wherever `guides` is. */
  const [spacing, setSpacing] = useState<SpacingMark[]>([]);
  /**
   * The size a block is being dragged to, while the handle is held.
   *
   * A preview, exactly like `dragDelta`: committing on every pointer move would push a hundred
   * intermediate sizes onto the undo stack, and §28 is explicit that a resize is ONE history entry.
   */
  const [resizing, setResizing] = useState<{
    key: string;
    box: { x: number; y: number; width: number; height: number };
  } | null>(null);
  /**
   * The outline a shape is being dragged to, while a vertex or a corner handle is held.
   *
   * A preview, exactly like `resizing` and `rotatePreview`: the committed document is untouched until
   * the pointer comes up, so one gesture is one undo step.
   */
  const [shapeEdit, setShapeEdit] = useState<{ key: string; points: ShapePoint[] } | null>(null);
  /** The angle a block is being dragged to, while the rotation handle is held. */
  const [rotatePreview, setRotatePreview] = useState<{ key: string; angle: number } | null>(null);
  /** Snap to other blocks while dragging (§25). Sits beside the grid toggle it complements. */
  const [snapObjects, setSnapObjects] = useState(true);
  /**
   * The active tool (§4).
   *
   * `null` is the Select tool — the state the editor has always been in, where a click on empty space
   * clears the selection. With a tool held, the next click on empty space PLACES that kind of block
   * where the pointer is.
   *
   * One-shot rather than sticky: placing returns to Select. A sticky tool is how an organizer ends up
   * with four stages they did not mean to draw, and the palette is already there for placing several
   * of the same thing.
   */
  const [tool, setTool] = useState<BlockKind | null>(null);
  /**
   * First-open coachmarks (Phase 4). Shown once per browser — the flag survives per-chart keys, and
   * the panel only mounts while the chart it opened on is still EMPTY, because five sentences about
   * "how to start drawing" are exactly wrong advice on a chart that already has work in it.
   */
  const [showCoachmarks, setShowCoachmarks] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("select");
  const [calibrationLayer, setCalibrationLayer] = useState<"floorPlan" | "reference">("reference");
  const framedLayout = useRef<number | null>(null);

  const { draft, commit, reset, undo, redo, canUndo, canRedo } =
    useLayoutHistory<ChartDocument>(emptyDocument());

  useEffect(() => {
    layoutApi
      .get(layoutId)
      .then((l) => {
        setLayout(l);
        setCalibrationLayer(l.referenceChart.url ? "reference" : "floorPlan");
        // The server always supplies a document — synthesised from the rows for a chart drawn before
        // documents existed — so there is no "no document yet" state to handle here.
        const doc = l.document ?? emptyDocument();
        // Empty charts have nothing to frame; mark them handled so placing the first block does not
        // unexpectedly change zoom. Existing charts are framed by the effect below after the canvas mounts.
        if (doc.blocks.length === 0 && l.tables.length === 0 && l.elements.length === 0) {
          framedLayout.current = l.id;
        }
        const json = JSON.stringify(doc);
        setServerJson(json);
        reset(doc);
        // An unsaved draft from a previous session is OFFERED, never applied silently: the organizer
        // may well have abandoned it on purpose, and quietly resurrecting it would be its own surprise.
        const stored = readStoredDraft(layoutId, l.version);
        if (stored && JSON.stringify(stored.document) !== json) setRecovery(stored);
        // Coachmarks: the once-in-a-browser flag AND an empty chart. Both, or neither — a full chart
        // skips them even on a first visit, and a first visit to a full chart keeps the flag unset so
        // the NEXT empty chart still gets its walkthrough.
        try {
          const seen = window.localStorage.getItem("tixhub:coachmarks:chart-editor") === "seen";
          const isEmpty = doc.blocks.length === 0;
          if (!seen && isEmpty) setShowCoachmarks(true);
        } catch {
          /* storage unavailable — skip the walkthrough, never block the editor */
        }
      })
      .catch((e) => setError((e as Error).message));
  }, [layoutId, reset]);

  // Frame an existing chart once after load. Editing still uses a stable coordinate scale; this is
  // the same explicit “Vừa khung” command as the toolbar, not continuous content-based rescaling.
  useEffect(() => {
    if (!layout) return;
    const hasRenderableContent =
      draft.blocks.length > 0 || layout.tables.length > 0 || layout.elements.length > 0;
    if (!hasRenderableContent || framedLayout.current === layout.id) return;
    let cancelled = false;
    let frame = 0;
    let attempts = 0;
    const frameWhenReady = () => {
      frame = window.requestAnimationFrame(() => {
        if (cancelled) return;
        if (canvas.current) {
          canvas.current.zoomToVenue();
          framedLayout.current = layout.id;
        } else if (attempts++ < 4) {
          frameWhenReady();
        }
      });
    };
    frameWhenReady();
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [layout, draft.blocks.length]);

  /**
   * Is there unsaved work?
   *
   * Serialized once per edit and compared as a string. The document is the whole chart, so a deep
   * compare on every render would be the most expensive thing in the editor; edits are user actions,
   * not animation frames, and the live drag preview runs off `dragDelta` without touching `draft`.
   */
  const draftJson = useMemo(() => JSON.stringify(draft), [draft]);
  const dirty = layout !== null && serverJson !== "" && draftJson !== serverJson;

  /**
   * Park a recovery copy shortly after the organizer stops editing.
   *
   * Deliberately NOT an autosave to the server: saving bumps the version, clears the selection and
   * replaces the draft with the server's copy, so doing it on a timer would yank the chart out from
   * under someone mid-edit. This keeps the safety net without the interference — and unlike a server
   * autosave it also survives a crash, an offline moment, or a closed laptop.
   */
  useEffect(() => {
    if (!layout || !dirty) return;
    const t = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          draftKey(layout.id),
          JSON.stringify({ baseVersion: layout.version, savedAt: Date.now(), document: draft }),
        );
        setParkedAt(() => Date.now());
      } catch {
        /* best-effort: a full or disabled store must not break editing */
      }
    }, RECOVERY_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [draft, dirty, layout]);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  useEffect(() => {
    // Only while there is something whose age is being shown; an idle editor should not tick.
    if (savedAt === null && parkedAt === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [savedAt, parkedAt]);

  /** The browser's own "leave site?" prompt. The only guard that survives a tab close. */
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /** Every operation is ONE commit, so one Ctrl+Z reverses a whole block re-shape. */
  const op = useCallback((fn: (d: ChartDocument) => ChartDocument) => commit(fn), [commit]);

  // ---- Derived: the sellable rows, recomputed from the document ---------------------------------

  const projected = useMemo(() => projectDocument(draft), [draft]);

  const issues = useMemo<ValidationIssue[]>(() => {
    /*
     * Companion pointers (0036) live in the DOCUMENT's seat-id space — editor-minted negatives as
     * well as database ids — but the validator below addresses seats by the VALIDATOR id space,
     * where a never-saved seat is a position-derived `-(index+1)`. The two spaces agree only for
     * saved seats, so the pointer is translated through `seatOrigin` before the call or the live
     * validation would flag `companion_wrong_target` on every freshly drawn pair until its first
     * save (and then, worse, silently stop flagging real breakage once ids settle).
     */
    const docSeatByOrigin = new Map<string, DocumentSeat>();
    for (const b of draft.blocks) {
      (b.seats ?? []).forEach((s, i) => docSeatByOrigin.set(`${b.key}|${i}`, s));
    }
    const toValidatorId = new Map<number, number>();
    projected.seatOrigin.forEach((origin, i) => {
      const docSeat = docSeatByOrigin.get(`${origin.blockKey}|${origin.index}`);
      if (docSeat) toValidatorId.set(docSeat.seatId, projected.seats[i]?.id ?? -(i + 1));
    });
    return validateLayout({
      // The same validator the publish gate runs, on the same geometry it will judge — so a problem
      // shows up here rather than at the moment the organizer presses "Phát hành".
      seats: projected.seats.map((s, i) => ({
        id: s.id ?? -(i + 1),
        sectionId: s.sectionId,
        categoryId: s.categoryId,
        rowLabel: s.rowLabel,
        seatNumber: s.seatNumber,
        x: s.x,
        y: s.y,
        isAccessible: s.isAccessible,
        companionSeatId:
          s.companionSeatId === null || s.companionSeatId === undefined
            ? (s.companionSeatId ?? undefined)
            : (toValidatorId.get(s.companionSeatId) ?? s.companionSeatId),
      })),
      sections: projected.sections.map((s) => ({
        id: s.id as number,
        name: s.name,
        seatSizeMultiplier: s.seatSizeMultiplier,
        // Same reason as the server's copy: the overlap rule reaches a seat's level through here.
        floorId: s.floorId ?? null,
      })),
      categories: projected.categories.map((c) => ({ id: c.id as number, name: c.name })),
      // So the focal warning stays quiet on a chart that states its own answer (0043).
      focalPoint: layout?.focalPoint ?? null,
      elements: projected.elements.map((e) => ({
        kind: e.kind,
        x: e.x,
        y: e.y,
        points: e.points,
        capacity: e.capacity,
        categoryId: e.categoryId,
        // A zone drawn as a plain rectangle has no `points`, so `zone_over_seats` has nothing to ask
        // "what stands inside this?" with unless its box comes too.
        width: e.width,
        height: e.height,
      })),
    });
    // `layout?.focalPoint` belongs here: it is read above, and without it setting a focal point left
    // the `focal_point_unset` warning on screen until some unrelated edit happened to re-run this.
  }, [projected, draft.blocks, layout?.focalPoint]);

  /**
   * What actually stops a publish, and what merely wants saying.
   *
   * The button and the badge below read this rather than `issues`, or a warning would disable
   * "Phát hành" on a chart the server would have accepted — a client refusing what the gate allows,
   * with no way for the organizer to get past it.
   */
  const blocking = useMemo(() => blockingIssues(issues), [issues]);
  const warningCount = issues.length - blocking.length;

  const overlapping = useMemo(() => {
    const ids = new Set<number>();
    for (const i of issues) {
      if (i.code === "overlapping_seats") for (const id of i.seatIds ?? []) ids.add(id);
    }
    return ids;
  }, [issues]);

  /** Canvas seat id → where that seat lives in the document. */
  const originOfSeat = useMemo(() => {
    const map = new Map<number, { blockKey: string; index: number }>();
    projected.seatOrigin.forEach((origin, i) => {
      map.set(projected.seats[i]?.id ?? -(i + 1), origin);
    });
    return map;
  }, [projected]);

  /** Which block each projected seat came from, so selecting a block highlights its seats. */
  const blockOfSeat = useMemo(() => {
    const map = new Map<number, string>();
    projected.seatOrigin.forEach((origin, i) => {
      const id = projected.seats[i]?.id ?? -(i + 1);
      map.set(id, origin.blockKey);
    });
    return map;
  }, [projected]);

  /**
   * Which block each rendered element belongs to.
   *
   * Decoration blocks — a stage, an aisle, a facility icon — produce no seats, so `blockOfSeat` cannot
   * reach them. Without this map the canvas draws them and the editor has no way to say what was
   * clicked, which is precisely why they could not be selected or moved at all.
   */
  const blockOfElement = useMemo(() => projected.elementOrigin, [projected.elementOrigin]);

  /**
   * Seat id → "Khu A · B12", for the validation panel.
   *
   * Built from the projection rather than from the document, because the validator judges the
   * projection — so the ids in an issue are exactly the ids in this map, including the negative
   * placeholders a seat carries before its first save.
   */
  const seatLabels = useMemo(() => {
    const names = new Map(draft.sections.map((sec) => [sec.id, sec.name]));
    const map = new Map<number, string>();
    projected.seats.forEach((s, i) => {
      const id = s.id ?? -(i + 1);
      const section = s.sectionId === null ? null : names.get(s.sectionId);
      map.set(id, `${section ? `${section} · ` : ""}${s.rowLabel}${s.seatNumber}`);
    });
    return map;
  }, [projected.seats, draft.sections]);

  /** Select the block a seat belongs to and drive the canvas to it. */
  const focusSeat = useCallback(
    (seatId: number) => {
      const key = blockOfSeat.get(seatId);
      if (key) setSelected(new Set([key]));
      canvas.current?.zoomToSeat(seatId);
    },
    [blockOfSeat],
  );

  /** Every navigation surface frames document geometry through the same occupied-bounds rule. */
  const frameBlocks = useCallback(
    (keys: Iterable<string>) => {
      const box = occupiedBounds(draft, new Set(keys));
      if (box) canvas.current?.zoomToBounds(box);
    },
    [draft],
  );

  /** Frame only the members of a section, not every seat in a partly reassigned source block. */
  const frameSection = useCallback(
    (sectionId: number) => {
      const seatsInSection = projected.seats.filter((seat) => seat.sectionId === sectionId);
      const standingBounds = occupiedBounds(
        draft,
        new Set(
          draft.blocks
            .filter((block) => block.kind === "ga-zone" && block.sectionId === sectionId)
            .map((block) => block.key),
        ),
      );
      const padding = 75;
      const extents = seatsInSection.map((seat) => ({
        minX: seat.x - padding,
        minY: seat.y - padding,
        maxX: seat.x + padding,
        maxY: seat.y + padding,
      }));
      if (standingBounds) {
        extents.push({
          minX: standingBounds.x,
          minY: standingBounds.y,
          maxX: standingBounds.x + standingBounds.w,
          maxY: standingBounds.y + standingBounds.h,
        });
      }
      if (extents.length === 0) return;
      const x = Math.min(...extents.map((extent) => extent.minX));
      const y = Math.min(...extents.map((extent) => extent.minY));
      const right = Math.max(...extents.map((extent) => extent.maxX));
      const bottom = Math.max(...extents.map((extent) => extent.maxY));
      canvas.current?.zoomToBounds({ x, y, w: Math.max(1, right - x), h: Math.max(1, bottom - y) });
    },
    [draft, projected.seats],
  );

  const sectionName = useMemo(
    () => new Map(draft.sections.map((s) => [s.id, s.name])),
    [draft.sections],
  );
  const sectionOfSeat = useMemo(() => {
    const map = new Map<number, number | null>();
    projected.seats.forEach((seat, index) => map.set(seat.id ?? -(index + 1), seat.sectionId));
    return map;
  }, [projected.seats]);

  /**
   * Seat id → the colour of the price class that seat sells under.
   *
   * Resolved from the SEAT, not its block, because a block is only a default: a VIP pair inside an
   * otherwise standard block must read as VIP. This is also what the buyer sees — their map colours by
   * price too — so the organizer is no longer arranging seats whose class they cannot see.
   */
  const colorOfSeat = useMemo(() => {
    const byCategory = new Map(draft.categories.map((c) => [c.id, c.color]));
    const map = new Map<number, string>();
    projected.seats.forEach((s, i) => {
      const colour = s.categoryId == null ? undefined : byCategory.get(s.categoryId);
      if (colour) map.set(s.id ?? -(i + 1), colour);
    });
    return map;
  }, [projected.seats, draft.categories]);

  /**
   * The category legend: colour, name, how much of the chart sells under each one.
   *
   * Counted from the document itself — seats for seat-bearing blocks, capacity for standing zones —
   * because a legend that listed every category ever created would show colours that appear nowhere
   * on the picture. Alphabetical, matching the way the server orders categories, so the two readers
   * of categories cannot disagree about order (Principle VI).
   */
  const categoryLegend = useMemo(() => {
    const inUse = [...draft.categories]
      .map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        count: projected.seats.filter((s) => s.categoryId === c.id).length,
        capacity: draft.blocks
          .filter((b) => b.kind === "ga-zone" && b.categoryId === c.id)
          .reduce((n, b) => n + (b.capacity ?? 0), 0),
      }))
      .filter((c) => c.count > 0 || c.capacity > 0)
      .sort((a, b) => a.name.localeCompare(b.name, "vi"));
    return inUse;
  }, [draft.categories, draft.blocks, projected.seats]);

  /**
   * Section hulls, drawn behind the seats — the canvas already knows how to title a group.
   */
  const blocks = useMemo<CanvasBlock[]>(
    () =>
      // The hulls are a view aid the organizer can switch off (§44), so an empty list when hidden
      // rather than a filtered one: the canvas treats "no blocks" as "draw no hulls", which is the
      // intended off-state and avoids computing a colour palette nobody reads.
      showHulls
        ? draft.sections.map((s) => ({
            id: s.id,
            name: s.name,
            // Stable per section id, so a hull keeps its colour as sections are added and removed. It
            // is an IDENTITY colour, never a price: a section may hold several classes, and the seats
            // carry those.
            color: CATEGORY_COLORS[Math.abs(s.id) % CATEGORY_COLORS.length],
          }))
        : [],
    [draft.sections, showHulls],
  );

  /**
   * Seats for the canvas, with a live drag applied HERE rather than committed — so dragging a block of
   * 200 seats is one undo step at the end, not one per animation frame.
   */
  /**
   * The level being worked on (0044). Null means "every floor at once", which is what a single-floor
   * chart always shows and what a levelled chart shows until the organizer narrows it.
   */
  const [editFloor, setEditFloor] = useState<number | null>(null);
  const floors = useMemo(
    () => [...(draft.floors ?? [])].sort((a, b) => a.displayOrder - b.displayOrder),
    [draft.floors],
  );
  /** Section → floor, so a block reaches its level the same way a seat does: through its section. */
  const floorOfSection = useMemo(
    () => new Map(draft.sections.map((s) => [s.id, s.floorId ?? null])),
    [draft.sections],
  );
  /** Floor id → name. The preview and the buyer's map both identify a level by name, not by id. */
  const floorName = useMemo(
    () => new Map((draft.floors ?? []).map((f) => [f.id, f.name])),
    [draft.floors],
  );

  /*
   * Keys the organizer has hidden. A VIEW filter — `projected` is untouched, so nothing stops selling.
   *
   * The floor filter joins it rather than becoming a second mechanism, and for the same reason: both
   * answer "what is drawn right now?", neither answers "what is for sale?". Folding them together is
   * also what keeps `hiddenElementIndices` and the preview honest without touching either.
   *
   * A block with NO section stays visible on every floor. Structural drawing — a hall outline, a
   * boundary — carries no section, and it is not something the second storey stops having.
   */
  const hiddenKeys = useMemo(
    () => new Set(draft.blocks.filter((b) => b.hidden).map((b) => b.key)),
    [draft.blocks],
  );

  /*
   * Blocks on a level the organizer is NOT editing.
   *
   * Ghosted, not hidden — and that was the first version's mistake. Working on the balcony while the
   * stalls are gone from the screen means aligning against nothing: the whole reason to look at one
   * level is to place it correctly over the other. Every drawing tool solves this the same way, by
   * dimming the inactive layer rather than removing it, and leaving it unclickable so a stray drag
   * cannot pick up something one storey down.
   *
   * A block with NO section stays FULL strength on every level. Structural drawing — a hall outline,
   * a boundary — carries no section, and it is not a thing the second storey stops having, so
   * fading it would make every floor look like it was missing its walls.
   */
  const ghostKeys = useMemo(
    () => ghostedBlockKeys(draft.blocks, floorOfSection, editFloor),
    [draft.blocks, editFloor, floorOfSection],
  );

  const canvasSeats = useMemo<CanvasSeat[]>(() => {
    const moving = dragDelta;
    return projected.seats.map((s, i) => {
      const id = s.id ?? -(i + 1);
      const inSelection = moving !== null && selected.has(blockOfSeat.get(id) ?? "");
      return {
        id,
        x: inSelection ? s.x + moving.dx : s.x,
        y: inSelection ? s.y + moving.dy : s.y,
        rotation: s.rotation,
        row: s.rowLabel,
        number: s.seatNumber,
        section: s.sectionId === null ? null : (sectionName.get(s.sectionId) ?? null),
        isAccessible: s.isAccessible,
        seatType: s.seatType,
        // Resolved through the section, exactly as the buyer's map resolves it — so the preview can
        // offer the same layer control the shop will.
        floor:
          s.sectionId === null
            ? null
            : (floorName.get(floorOfSection.get(s.sectionId) ?? -1) ?? null),
      };
    });
    // `floorName` and `floorOfSection` belong here: a seat's level is resolved above, so renaming a
    // floor or moving a section between levels has to re-derive the canvas seats — otherwise the
    // preview's layer control keeps grouping by the arrangement that existed at the last edit.
  }, [projected.seats, dragDelta, selected, blockOfSeat, sectionName, floorName, floorOfSection]);

  /**
   * The live rotation preview, applied to the SEATS of the block being turned.
   *
   * The projection places a seat at `block + (dx,dy) rotated by block.rotation`, and it runs off the
   * committed document — so without this a seating block's outline would swing round while its seats
   * stayed where they were, which is the one thing a rotation preview exists to show.
   */
  const previewedSeats = useMemo(() => {
    if (!rotatePreview) return canvasSeats;
    const block = draft.blocks.find((b) => b.key === rotatePreview.key);
    if (!block?.seats?.length) return canvasSeats;

    const rad = (rotatePreview.angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return canvasSeats.map((s) => {
      const origin = originOfSeat.get(s.id);
      if (!origin || origin.blockKey !== rotatePreview.key) return s;
      const seat = block.seats?.[origin.index];
      if (!seat) return s;
      return {
        ...s,
        x: block.x + seat.dx * cos - seat.dy * sin,
        y: block.y + seat.dx * sin + seat.dy * cos,
        rotation: (((seat.rotation + rotatePreview.angle) % 360) + 360) % 360,
      };
    });
  }, [canvasSeats, rotatePreview, draft.blocks, originOfSeat]);

  /** What the canvas actually draws: everything except the blocks the organizer has hidden. */
  const visibleSeats = useMemo(
    () =>
      hiddenKeys.size === 0
        ? previewedSeats
        : previewedSeats.filter((s) => !hiddenKeys.has(blockOfSeat.get(s.id) ?? "")),
    [previewedSeats, hiddenKeys, blockOfSeat],
  );

  /** Decoration, with the dragged block offset live — same one-commit-at-the-end rule as seats. */
  const canvasElements = useMemo(
    () =>
      projected.elements
        .map((el, i) =>
          dragDelta && selected.has(blockOfElement[i] ?? "")
            ? // `points` come along too — see `translateElement`. Offsetting only the origin left a
              // drawn outline standing still under the pointer until the drop.
              translateElement(el, dragDelta.dx, dragDelta.dy)
            : el,
        )
        // Hidden is a VIEW state (§5): it leaves the canvas and never the projection, so `projected`
        // above — which is what the save writes — still holds every element.
        // The live resize preview, applied to the one element being dragged by a handle.
        .map((el, i) =>
          resizing && blockOfElement[i] === resizing.key
            ? {
                ...el,
                x: resizing.box.x,
                y: resizing.box.y,
                width: resizing.box.width,
                height: resizing.box.height,
              }
            : el,
        )
        // The live outline, while a vertex or a corner handle is held.
        .map((el, i) =>
          shapeEdit && blockOfElement[i] === shapeEdit.key
            ? { ...el, points: shapeEdit.points }
            : el,
        )
        .map((el, i) =>
          rotatePreview && blockOfElement[i] === rotatePreview.key
            ? { ...el, rotation: rotatePreview.angle }
            : el,
        ),
    [projected.elements, dragDelta, selected, blockOfElement, resizing, shapeEdit, rotatePreview],
  );

  /**
   * Which elements the canvas draws nothing for — as INDICES, not by shortening the array.
   *
   * An element's index is its identity across the canvas boundary: `selectedElementIndex` goes down
   * as one, and `onElementPointerDown`, `onResize` and `onVertexDrag` come back up as one, each
   * resolved through `blockOfElement`, which indexes the UNFILTERED projection. `canvasElements`
   * used to drop hidden entries, which shifted every index past the first hidden block — so with
   * anything hidden, clicking a stage selected a different block and dragging moved it.
   */
  const hiddenElementIndices = useMemo(
    () =>
      new Set(
        canvasElements
          .map((_, i) => (hiddenKeys.has(blockOfElement[i] ?? "") ? i : -1))
          .filter((i) => i >= 0),
      ),
    [canvasElements, hiddenKeys, blockOfElement],
  );

  /** The same mapping for the ghost layer — indices the canvas dims and makes inert. */
  const ghostElementIndices = useMemo(
    () =>
      new Set(
        canvasElements
          .map((_, i) => (ghostKeys.has(blockOfElement[i] ?? "") ? i : -1))
          .filter((i) => i >= 0),
      ),
    [canvasElements, ghostKeys, blockOfElement],
  );

  /** Seats belonging to a ghosted block, by the id the canvas draws them under. */
  const ghostSeatIds = useMemo(() => {
    if (ghostKeys.size === 0) return new Set<number>();
    const ids = new Set<number>();
    for (const s of visibleSeats) {
      if (ghostKeys.has(blockOfSeat.get(s.id) ?? "")) ids.add(s.id);
    }
    return ids;
  }, [visibleSeats, ghostKeys, blockOfSeat]);

  const selectedBlock = useMemo(
    () => (selected.size === 1 ? (draft.blocks.find((b) => selected.has(b.key)) ?? null) : null),
    [selected, draft.blocks],
  );
  const stages = useMemo(
    () => draft.blocks.filter((block) => block.kind === "stage"),
    [draft.blocks],
  );
  const primaryStage = stages[0] ?? null;

  const budget = remainingBudget(draft);

  /**
   * The selected row, resolved against the draft: which block holds it, and what is in it.
   *
   * Derived on each render rather than memoised: it walks the blocks once, the editor re-renders on
   * every draft change regardless, and the loop's early exits are a shape the React Compiler declines
   * to memoise — so a `useMemo` here bought nothing and cost a compilation.
   */
  const selectedRow = ((): {
    label: string;
    blockKey: string;
    sectionName: string | null;
    sectionId: number | null;
    seatCount: number;
    rowId: number | null;
    canEdit: boolean;
  } | null => {
    if (!rowSel) return null;
    const [section, label] = rowSel.split("|");
    const sectionName = section || null;
    for (const b of draft.blocks) {
      const seats = (b.seats ?? []).filter((seat) => seat.rowLabel === label);
      if (seats.length === 0) continue;
      const name =
        draft.sections.find((x) => x.id === resolvedSeatSectionId(seats[0], b))?.name ?? null;
      if (name !== sectionName) continue;
      return {
        label,
        blockKey: b.key,
        sectionName: name,
        sectionId: resolvedSeatSectionId(seats[0], b),
        seatCount: seats.length,
        rowId: seats.find((seat) => seat.rowId != null)?.rowId ?? null,
        canEdit: b.locked !== true && b.kind !== "table",
      };
    }
    return null;
  })();

  /**
   * What a swatch in the palette would do right now.
   *
   * With blocks selected it repaints them; with none it sets the colour the next block takes. The
   * active swatch follows the same split, and shows nothing when the selection is of mixed colours —
   * highlighting one of them would claim the others are that colour too.
   */
  const paint = useMemo(() => {
    const targets = draft.blocks.filter(
      (b) => selected.has(b.key) && colorable(b.kind) && !b.locked,
    );
    if (targets.length === 0) return { targets: 0, color: shapeColor };
    const first = targets[0].color ?? null;
    const uniform = targets.every((b) => (b.color ?? null) === first);
    return { targets: targets.length, color: uniform ? first : null };
  }, [draft.blocks, selected, shapeColor]);

  // ---- Persistence -----------------------------------------------------------------------------

  /**
   * Persist a document. Returns whether it stuck, because a table gesture has to abandon itself when
   * the save ahead of it was refused (`seat_in_use`) rather than press on and lose the refusal.
   *
   * Takes the document to send rather than reading `draft`, so a caller that has just computed a new
   * one can save THAT instead of the state value React has not committed yet.
   */
  /**
   * @param quiet an AUTOSAVE — keep the selection and the undo history.
   *
   * Only ever passed when `hasPlaceholderIds(doc)` is false, which is what makes it safe: with every
   * id already real the server's stitched copy is what we sent, so declining to adopt it changes
   * nothing except that `reset` is not called and the undo stack survives.
   */
  const persist = async (doc: ChartDocument, quiet = false): Promise<boolean> => {
    if (!layout) return false;
    setBusy(true);
    setError(null);
    try {
      // The document is the ONLY thing sent. The server projects the rows from it, so there is nothing
      // for the client to keep in step.
      const saved = await layoutApi.save(layout.id, { version: layout.version, document: doc });
      setLayout(saved);
      // The saved document carries the database's own ids, so the next edit updates rows rather than
      // re-creating them. Taking the server's copy is what keeps seat identity stable across saves.
      const back = saved.document ?? doc;
      setServerJson(JSON.stringify(back));
      // The work is on the server now, so the recovery copy is not just redundant, it is misleading.
      forgetStoredDraft(layout.id);
      // Read inside the updater rather than here: `persist` lives in the component body, so the
      // compiler treats a bare `Date.now()` in it as a clock read during render — which it refuses,
      // rightly, since two renders in a frame would disagree. An updater runs at update time.
      setSavedAt(() => Date.now());
      setNow(() => Date.now());
      setParkedAt(null);
      setSaveRefused(false);
      if (!quiet) {
        reset(back);
        setSelected(new Set());
        setStatus("Đã lưu bản nháp.");
      }
      return true;
    } catch (e) {
      setError((e as Error).message);
      setSaveRefused(true);
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** A manual save is the organizer deciding to try again, so it lifts the autosave's stand-down. */
  const save = () => {
    setSaveRefused(false);
    void persist(draft);
  };

  /**
   * Take the server's copy, discarding local edits — what `stale_version` actually asks for.
   *
   * Deliberately NOT an automatic re-fetch that keeps the local document and adopts the new version:
   * that would make the next save overwrite whatever the other session wrote, which is the exact
   * outcome optimistic locking exists to prevent. The organizer is told the chart moved and chooses.
   */
  const reloadFromServer = async () => {
    if (!layout) return;
    setBusy(true);
    try {
      const fresh = await layoutApi.get(layout.id);
      setLayout(fresh);
      const doc = fresh.document ?? emptyDocument();
      setServerJson(JSON.stringify(doc));
      forgetStoredDraft(layout.id);
      reset(doc);
      setSelected(new Set());
      setError(null);
      setSaveRefused(false);
      setStatus("Đã tải lại sơ đồ từ máy chủ.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Autosave (§29).
   *
   * Four conditions, and each one is there because breaking it is a real failure:
   *
   *   dirty && online     nothing to save, or nowhere to save it
   *   !busy               a save is already in flight; two would race on the version
   *   no placeholders     the server's copy would have to be adopted, which clears the undo stack
   *   nothing in hand     saving mid-drag or mid-drawing yanks the chart out from under the pointer
   *
   * The recovery copy in localStorage above stays regardless. It is the safety net; this is the
   * convenience, and the net has to hold in the cases the convenience declines to act.
   */
  useEffect(() => {
    if (!layout || !dirty || !online || busy) return;
    if (drawing || dragDelta || resizing) return;
    if (hasPlaceholderIds(draft)) return;
    // See `saveRefused`: never re-send what the server has just refused.
    if (saveRefused) return;

    const t = window.setTimeout(() => void persist(draft, true), AUTOSAVE_IDLE_MS);
    return () => window.clearTimeout(t);
    // `persist` is re-created every render and would restart the timer forever; the values it closes
    // over are all in this list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, dirty, online, busy, drawing, dragDelta, resizing, layout, saveRefused]);

  /**
   * Publish — but only ever the chart that was actually judged.
   *
   * The panel and this button read `issues`, which is computed from the DRAFT. The server's gate reads
   * the stored ROWS. With unsaved edits those are two different charts, so fixing the last overlap by
   * dragging turned the panel green and enabled the button while the gate went on refusing the old
   * geometry — "Sơ đồ hợp lệ" on the right, "Sơ đồ chưa hợp lệ" on the click.
   *
   * Saving first is what makes the two agree. If the save is refused — a sold seat, a duplicate label —
   * the publish is abandoned and that refusal is what the organizer sees, because publishing stale rows
   * after a failed save would be worse than not publishing at all.
   */
  const publish = async () => {
    if (!layout) return;
    if (dirty && !(await persist(draft))) return;
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

  /**
   * Re-read after an operation the server owns.
   *
   * Tables and standing areas generate their seats server-side, so those endpoints null the stored
   * document (`forgetDocument`) and the next read adopts a fresh one from the rows. Taking the server's
   * document back is therefore mandatory here, not an optimisation — keeping the local one would leave
   * the editor describing a chart the database no longer has.
   *
   * It also means unsaved block edits are lost, so it asks first.
   */
  const serverOp = async (fn: () => Promise<unknown>, done: string) => {
    if (!layout) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      const fresh = await layoutApi.get(layout.id);
      setLayout(fresh);
      const doc = fresh.document ?? emptyDocument();
      setServerJson(JSON.stringify(doc));
      forgetStoredDraft(layout.id);
      reset(doc);
      setSelected(new Set());
      setStatus(done);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * A gesture that lands on a table.
   *
   * A table's geometry lives in `layout_tables`, which only these endpoints write — the document just
   * mirrors it (see `documentOps.serverOwned`). Editing the block instead would move the table's SEATS
   * on the next save and leave the table behind, detaching seats from the table that owns them.
   *
   * `keep` is the document as it should stand once the gesture is applied to the non-table blocks. It
   * is saved FIRST, because `serverOp` re-reads and replaces the draft: without this, dragging a table
   * would silently discard every unsaved block edit. If that save is refused — a sold seat somewhere
   * else in the chart — the table op is abandoned so the refusal is the thing the organizer sees.
   */
  const tableOp = async (keep: ChartDocument, fn: () => Promise<unknown>, done: string) => {
    if (JSON.stringify(keep) !== serverJson) {
      if (!(await persist(keep))) return;
    }
    await serverOp(fn, done);
  };

  /** How near the first point a click has to land to close the outline, in layout units. */
  const CLOSE_RADIUS = 250;

  /**
   * Turn the collected points into a shape block.
   *
   * Three points is the minimum that encloses anything; below that the run is discarded rather than
   * saved as a line nobody can see or select.
   */
  const finishDrawing = (points: { x: number; y: number }[]) => {
    setDrawing(null);
    if (points.length < 3) return;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    commit((d) => {
      const ctx = nextBlockContext(d, selected, lastUsed);
      const key = nextBlockKey(d);
      setSelected(new Set([key]));
      return {
        ...d,
        blocks: [
          ...d.blocks,
          {
            key,
            kind: "shape" as const,
            title: BLOCK_LABEL.shape,
            // The box is the outline's bounding centre, so moving the block moves its points with it.
            x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
            y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2),
            rotation: 0,
            width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
            height: Math.max(1, Math.max(...ys) - Math.min(...ys)),
            sectionId: ctx.sectionId,
            categoryId: ctx.categoryId,
            // Text is a separate block. Keeping it out of the polygon means scaling the outline
            // cannot leave a caption behind with unrelated geometry.
            label: null,
            points,
            // Hand-drawn: no named geometry to regenerate it from.
            geometry: null,
            color: shapeColor ?? SHAPE_DEFAULT_COLOR,
          },
        ],
      };
    });
  };

  /** A click while drawing: close the outline if it lands on the first point, else add a point. */
  const addDrawingPoint = (p: { x: number; y: number }) => {
    setDrawing((cur) => {
      if (!cur) return cur;
      const first = cur[0];
      if (first && cur.length >= 3 && Math.hypot(p.x - first.x, p.y - first.y) <= CLOSE_RADIUS) {
        finishDrawing(cur);
        return null;
      }
      return [...cur, { x: clampCoord(snap(p.x, grid)), y: clampCoord(snap(p.y, grid)) }];
    });
  };

  /** Pose a question before doing something that throws work away. */
  const ask = (req: ConfirmRequest, onConfirm: () => void) => setConfirm({ ...req, onConfirm });

  /** Closing with unsaved work is the commonest way a design is lost, so it is the one guarded exit. */
  const closeGuarded = () => {
    if (!dirty) {
      onClose();
      return;
    }
    ask(
      {
        title: "Đóng mà chưa lưu?",
        message:
          "Sơ đồ có thay đổi chưa lưu. Bản nháp được giữ lại trên máy này, nên bạn có thể khôi phục khi mở lại.",
        confirmLabel: "Đóng",
        cancelLabel: "Ở lại",
        tone: "danger",
      },
      onClose,
    );
  };

  /** Split a selection into the tables (which the server owns) and everything else. */
  const partition = (keys: Set<string>) => {
    const blocks = draft.blocks.filter((b) => keys.has(b.key));
    const tables = blocks.filter(
      (b): b is DocumentBlock & { tableId: number } => b.kind === "table" && b.tableId != null,
    );
    return { tables, others: new Set(blocks.filter((b) => b.kind !== "table").map((b) => b.key)) };
  };

  // The four gestures that can land on a table. Each applies the document half locally and sends the
  // table half to the endpoint that owns it, so a mixed selection behaves as one action.

  const applyMove = (dx: number, dy: number) => {
    if (dx === 0 && dy === 0) return;
    const { tables, others } = partition(selected);
    const next = others.size > 0 ? moveBlocks(draft, others, dx, dy, grid) : draft;
    if (others.size > 0) op(() => next);
    if (tables.length === 0) return;
    void tableOp(
      next,
      () =>
        Promise.all(
          // `movedPosition` is the same arithmetic `moveBlocks` applies, so a table dragged alongside
          // a block lands on the same grid step rather than a snap away from it.
          tables.map((t) => layoutApi.updateTable(t.tableId, movedPosition(t, dx, dy, grid))),
        ),
      tables.length > 1 ? "Đã dời các bàn." : `Đã dời ${tables[0].title}.`,
    );
  };

  const applyRotate = (degrees: number) => {
    const { tables, others } = partition(selected);
    const next = others.size > 0 ? rotateBlocks(draft, others, degrees) : draft;
    if (others.size > 0) op(() => next);
    if (tables.length === 0) return;
    void tableOp(
      next,
      () =>
        Promise.all(
          tables.map((t) =>
            layoutApi.updateTable(t.tableId, {
              rotation: (((t.rotation + degrees) % 360) + 360) % 360,
            }),
          ),
        ),
      "Đã xoay bàn.",
    );
  };

  /**
   * Delete, behind a confirmation whenever seats or a table are at stake.
   *
   * A bare decoration block is not worth a dialog — that would train the organizer to dismiss the
   * prompt without reading it, which is exactly how the dangerous one gets clicked through.
   */
  const applyDelete = () => {
    const doomed = draft.blocks.filter((b) => selected.has(b.key) && b.locked !== true);
    const seatsLost = doomed.reduce((n, b) => n + (b.seats?.length ?? 0), 0);
    const tablesLost = doomed.filter((b) => b.kind === "table").length;
    if (seatsLost === 0 && tablesLost === 0) {
      applyDeleteNow();
      return;
    }
    ask(
      {
        title: tablesLost > 0 ? "Xoá bàn và ghế của bàn?" : "Xoá ghế?",
        message:
          `Sẽ xoá ${doomed.length} khối và ${seatsLost} ghế.` +
          " Các hàng còn lại trong khu sẽ được đánh lại chữ cho liền mạch (khoá khối để giữ nguyên chữ)." +
          (tablesLost > 0
            ? " Ghế đã bán hoặc đang được giữ sẽ khiến thao tác bị từ chối."
            : // Since 0032 a bound seat is ARCHIVED rather than refused, so promising a refusal here
              // would be telling the organizer the save will fail when it will succeed.
              " Ghế mà suất diễn đã tạo vé sẽ được lưu trữ thay vì xoá — vé đã bán không bị ảnh hưởng."),
        confirmLabel: "Xoá",
        cancelLabel: "Huỷ",
        tone: "danger",
      },
      applyDeleteNow,
    );
  };

  const applyDeleteNow = () => {
    const { tables, others } = partition(selected);
    // Re-lettered in the SAME commit as the delete, so one Ctrl+Z puts both the blocks and their old
    // labels back. Two commits would leave an undo that restored the rows under the wrong letters.
    const next = others.size > 0 ? repack(removeBlocks(draft, others)) : draft;
    if (others.size > 0) op(() => next);
    if (tables.length === 0) {
      if (others.size > 0) setSelected(new Set());
      return;
    }
    // Deleting a table deletes the seats it owns, which the server refuses outright if any is sold or
    // held (FR-051/FR-052) — that refusal is the whole reason this cannot be a document edit.
    void tableOp(
      next,
      async () => {
        for (const t of tables) await layoutApi.deleteTable(t.tableId);
      },
      tables.length > 1 ? "Đã xoá các bàn." : `Đã xoá ${tables[0].title}.`,
    );
  };

  const applyAlign = (edge: BlockAlignEdge) => {
    const { tables, others } = partition(selected);
    const box = selectionBounds(draft, selected);
    const next = alignBlocks(draft, selected, edge);
    if (others.size > 0) op(() => next);
    if (tables.length === 0 || !box || selected.size < 2) return;
    void tableOp(
      next,
      () =>
        Promise.all(
          tables.map((t) => layoutApi.updateTable(t.tableId, alignedPosition(box, t, edge))),
        ),
      "Đã canh hàng.",
    );
  };

  // ---- Interaction -----------------------------------------------------------------------------

  /** Clicking a seat selects the BLOCK it belongs to: blocks are what this editor moves. */
  /**
   * Put the selected block in a section / price class, and remember the choice.
   *
   * Remembering is what makes the NEXT block land in the same place — see `nextBlockContext`. Written
   * as named handlers because the alternative, an assignment wedged into a `&&` chain, works only
   * because an object happens to be truthy.
   */
  /** The document positions of the seats currently selected, if any. */
  const selectedSeatRefs = useMemo(
    () =>
      [...seatSel].map((id) => originOfSeat.get(id)).filter((r): r is SeatRef => r !== undefined),
    [seatSel, originOfSeat],
  );

  const selectedRowRefs: SeatRef[] = selectedRow
    ? draft.blocks.flatMap((block) =>
        (block.seats ?? []).flatMap((seat, index) => {
          const sameRow =
            selectedRow.rowId !== null
              ? seat.rowId === selectedRow.rowId
              : block.key === selectedRow.blockKey &&
                seat.rowLabel === selectedRow.label &&
                resolvedSeatSectionId(seat, block) === selectedRow.sectionId;
          return sameRow ? [{ blockKey: block.key, index }] : [];
        }),
      )
    : [];

  /** The seats the selection panel is speaking for: selected seats, else seats of selected blocks. */
  const subjectSeats = (() => {
    if (seatSel.size > 0) {
      return projected.seats.filter((s, i) => seatSel.has(s.id ?? -(i + 1)));
    }
    if (selectedRow) {
      const targets = new Set(selectedRowRefs.map((ref) => `${ref.blockKey}|${ref.index}`));
      return projected.seats.filter((seat, index) => {
        const origin = originOfSeat.get(seat.id ?? -(index + 1));
        return origin ? targets.has(`${origin.blockKey}|${origin.index}`) : false;
      });
    }
    return projected.seats.filter((s, i) => selected.has(blockOfSeat.get(s.id ?? -(i + 1)) ?? ""));
  })();
  const assignmentCount = subjectSeats.length > 0 ? subjectSeats.length : selected.size;
  const assignmentLabel =
    selectedRow && subjectSeats.length > 0
      ? `hàng ${selectedRow.label} · ${subjectSeats.length} ghế`
      : subjectSeats.length > 0
        ? `${subjectSeats.length} ghế`
        : `${selected.size} khối`;
  const selectedSectionIds = new Set<number | null>(
    subjectSeats.length > 0
      ? subjectSeats.map((seat) => seat.sectionId)
      : draft.blocks.filter((block) => selected.has(block.key)).map((block) => block.sectionId),
  );
  const selectedSectionValue =
    selectedSectionIds.size === 1
      ? [...selectedSectionIds][0] === null
        ? "none"
        : String([...selectedSectionIds][0])
      : "mixed";
  const sectionAssignmentDisabled =
    (selectedRow !== null && !selectedRow.canEdit) ||
    selectedRowRefs.some((ref) => {
      const block = draft.blocks.find((candidate) => candidate.key === ref.blockKey);
      return block?.locked === true || block?.kind === "table";
    }) ||
    selectedSeatRefs.some((ref) => {
      const block = draft.blocks.find((candidate) => candidate.key === ref.blockKey);
      return block?.locked === true || block?.kind === "table";
    }) ||
    [...selected].some((key) => {
      const block = draft.blocks.find((candidate) => candidate.key === key);
      return block?.locked === true || block?.kind === "table";
    });

  /**
   * Seat id → its label ("A1" or "Khu A · A1") — lookups for the pairing UI (0036). Built from the
   * projection so the id space matches what `subjectSeats` rows and `selectedSeatRefs` address.
   */
  const seatLabelOf = useMemo(() => {
    const map = new Map<number, string>();
    projected.seats.forEach((s, i) => {
      map.set(s.id ?? -(i + 1), `${s.rowLabel}${s.seatNumber}`);
    });
    return map;
  }, [projected.seats]);

  /**
   * The two selections the pairing panel needs (0036), both derived from `subjectSeats`:
   * - `pairableAccessible`: the selection holds exactly one wheelchair seat — the TARGET of a pair.
   * - `pairableCompanion`: exactly one ordinary (non-wheelchair) seat — the would-be companion.
   *
   * The "Ghép ghế đi kèm" button is enabled only when BOTH are true for a two-seat selection: one
   * wheelchair, one ordinary. Unpairing is offered whenever one of the selected seats carries a
   * pointer — dangling included (a deleted partner must still be clearable).
   */
  const pairPairable = useMemo(() => {
    const accessibleOnes = subjectSeats.filter((s) => s.isAccessible);
    const ordinaryOnes = subjectSeats.filter((s) => !s.isAccessible);
    return {
      canPair:
        subjectSeats.length === 2 && accessibleOnes.length === 1 && ordinaryOnes.length === 1,
      accessible: accessibleOnes[0] ?? null,
      companion: ordinaryOnes[0] ?? null,
    };
  }, [subjectSeats]);

  /** The pair link the current selection already carries, for the "Đang đi kèm" readout. */
  const existingPair = useMemo(() => {
    if (subjectSeats.length !== 1) return null;
    const s = subjectSeats[0];
    if (!s) return null;
    const docCompanionId = (() => {
      // Find the document seat behind this projected one to read its pointer. The projection SHOWS
      // the pointer on the LayoutSeat, but the document is the source — and this also works for
      // unsaved seats, where the projected id is a position-derived negative.
      const origin = originOfSeat.get(s.id ?? -(projected.seats.indexOf(s) + 1));
      if (!origin) return null;
      return (
        draft.blocks.find((b) => b.key === origin.blockKey)?.seats?.[origin.index]
          ?.companionSeatId ?? null
      );
    })();
    if (docCompanionId === null || docCompanionId === undefined) return null;
    // The label resolves only for a target seat THIS chart still holds — a pointer at one the
    // organizer already deleted shows "(ghế đã xoá)", which is exactly the state to repair.
    return { seat: s, targetLabel: seatLabelOf.get(docCompanionId) ?? "(ghế đã xoá)" };
  }, [subjectSeats, originOfSeat, draft.blocks, seatLabelOf, projected.seats]);

  const hasGroupedSelection = useMemo(
    () => [...selected].some((k) => draft.blocks.find((b) => b.key === k)?.groupId),
    [selected, draft.blocks],
  );

  /**
   * Assign to whatever is selected: the seats if seats are selected, else the blocks.
   *
   * Setting it on the block clears any per-seat override in that block as well, so the control means
   * what it says — otherwise assigning "VIP" to a block would leave individually-classed seats behind
   * and the selection panel would report a mix the organizer thought they had just resolved.
   */
  const assignTo = (patch: { sectionId?: number | null; categoryId?: number | null }) => {
    if (seatSel.size > 0) {
      op((d) => updateSeats(d, selectedSeatRefs, patch));
      return;
    }
    if (selectedRow) {
      op((d) => updateSeats(d, selectedRowRefs, patch));
      return;
    }
    if (selected.size === 0) return;
    op((d) =>
      [...selected].reduce((acc, key) => {
        const withBlock = updateBlock(acc, key, patch);
        const block = withBlock.blocks.find((b) => b.key === key);
        const refs = (block?.seats ?? []).map((_, index) => ({ blockKey: key, index }));
        // `undefined` means "inherit the block", which is exactly what clearing an override is.
        return updateSeats(withBlock, refs, {
          ...(patch.sectionId !== undefined ? { sectionId: undefined } : {}),
          ...(patch.categoryId !== undefined ? { categoryId: undefined } : {}),
        });
      }, d),
    );
  };

  const assignSectionTo = (id: number | null) => {
    setLastUsed((cur) => ({ ...cur, sectionId: id }));
    if (seatSel.size > 0) {
      op((d) => assignSeatsToSection(d, selectedSeatRefs, id));
      return;
    }
    if (selectedRow) {
      op((d) =>
        assignRowToSection(
          d,
          {
            blockKey: selectedRow.blockKey,
            label: selectedRow.label,
            rowId: selectedRow.rowId,
            sectionId: selectedRow.sectionId,
          },
          id,
        ),
      );
      setRowSel(null);
      return;
    }
    if (selected.size === 0) return;
    op((d) => assignBlocksToSection(d, selected, id));
  };

  const assignCategoryTo = (id: number | null) => {
    setLastUsed((cur) => ({ ...cur, categoryId: id }));
    assignTo({ categoryId: id });
  };

  /** Mark or unmark the selected seats as accessible — a per-seat property by nature. */
  const setSeatsAccessible = (accessible: boolean) =>
    op((d) => updateSeats(d, selectedSeatRefs, { isAccessible: accessible }));

  /**
   * Companion pairing (0036): the inspector's "Ghép ghế đi kèm" sets the pointer on the ORDINARY seat
   * of a two-seat selection (one wheelchair, one ordinary). The pointer lives in the document's
   * seat-id space, so the value written is the TARGET's DOCUMENT seatId, not its projection id —
   * resolved through `originOfSeat` back into the block.
   */
  const pairSeats = () => {
    const { accessible, companion } = pairPairable;
    if (!accessible || !companion) return;
    const accessibleOrigin = originOfSeat.get(
      accessible.id ?? -(projected.seats.indexOf(accessible) + 1),
    );
    if (!accessibleOrigin) return;
    const targetBlock = draft.blocks.find((b) => b.key === accessibleOrigin.blockKey);
    const targetDocSeat = targetBlock?.seats?.[accessibleOrigin.index];
    if (!targetDocSeat) return;
    const companionOrigin = originOfSeat.get(
      companion.id ?? -(projected.seats.indexOf(companion) + 1),
    );
    if (!companionOrigin) return;
    op((d) => updateSeats(d, [companionOrigin], { companionSeatId: targetDocSeat.seatId }));
  };

  /** Break the current selection's partner link (0036). Offered whenever the one selected seat
   *  carries a pointer — including a dangling one. */
  const unpairSeats = () =>
    op((d) => {
      const cleared = updateSeats(d, selectedSeatRefs, { companionSeatId: undefined });
      return cleared;
    });

  /**
   * Begin a rotation drag from the handle.
   *
   * A named function rather than a closure built in the JSX: inside the overlay it read `canvas.current`
   * while rendering, which the React Compiler refuses — and rightly, since a ref read during render is
   * not something a re-render can be trusted to have seen.
   */
  const beginRotate = (block: DocumentBlock, e: React.PointerEvent<SVGCircleElement>) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);

    /*
     * Where the grip sits relative to the block's "up", measured once at pointer-down.
     *
     * `angleFromPointer` reads straight-up-from-centre as 0°, which was exactly true while the
     * handle sat on a stalk above the block: grabbing it reported the angle the block already had,
     * so nothing moved until the pointer did. The handle is now at the top-LEFT corner, so the raw
     * reading is off by the corner's bearing — and taking it neat would snap the block by that much
     * the instant it was grabbed, before any drag.
     *
     * Held as an offset rather than hardcoded to 45°, because the bearing depends on the block's
     * proportions: the corner of a wide, shallow stage sits at a quite different angle from the
     * corner of a square one.
     */
    const grabbed = canvas.current?.toLayout(e.clientX, e.clientY);
    const offset = grabbed ? angleFromPointer(block, grabbed) - block.rotation : 0;

    const to = (ev: PointerEvent, phase: "move" | "end") => {
      const at = canvas.current?.toLayout(ev.clientX, ev.clientY);
      if (!at) return;
      // Shift snaps to 15°, so a deliberate right angle does not need a steady hand. Snapped AFTER
      // the offset comes off, or the grid of angles would be tilted by the grab point.
      const raw = angleFromPointer(block, at) - offset;
      const step = ev.shiftKey ? 15 : 0;
      const snapped = step > 0 ? Math.round(raw / step) * step : Math.round(raw);
      const angle = ((snapped % 360) + 360) % 360;
      if (phase === "move") setRotatePreview({ key: block.key, angle });
      else {
        setRotatePreview(null);
        op((d) => setRotation(d, new Set([block.key]), angle));
      }
    };
    const move = (ev: PointerEvent) => to(ev, "move");
    const up = (ev: PointerEvent) => {
      to(ev, "end");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Ordinary seat or love seat. Per seat, like the column and like accessibility above. */
  const setSeatsType = (seatType: EditableSeatType) =>
    op((d) => setSeatType(d, selectedSeatRefs, seatType));

  /** Shared by seats and decoration, so the two cannot drift apart. The rule itself is pure and lives
   *  in `documentOps`, where it can be tested — this canvas has no harness. */
  const selectOnPress = (key: string, additive: boolean) =>
    // Expanded to whole groups HERE, at the single point every press passes through, so grouping is
    // one rule rather than a condition repeated in drag, delete, align and the rest.
    setSelected((cur) => withGroups(draft, selectionAfterPress(cur, key, additive)));

  const onSeatPointerDown = (seat: CanvasSeat, additive: boolean, alt?: boolean) => {
    if (alt) {
      // Seat-level intent. No drag is armed: a block is what moves, and a seat is only ever re-labelled,
      // re-classed or marked accessible.
      dragging.current = false;
      setSelected(new Set());
      setSeatSel((cur) => selectionAfterPress(cur, seat.id, additive));
      return;
    }
    const key = blockOfSeat.get(seat.id);
    if (!key) return;
    dragging.current = true;
    setSeatSel(new Set());
    selectOnPress(key, additive);
  };

  /**
   * The delta a drag should actually apply: clamped to the map, then pulled onto a neighbour (§25).
   *
   * Snapping is computed from the anchor block's landing position and applied as a CORRECTION to the
   * delta, so every block in a multi-block drag shifts by the same amount — snapping each one to its
   * own nearest neighbour would tear the selection apart.
   */
  const dragWithSnap = (dx: number, dy: number): { dx: number; dy: number } => {
    const limit = allowedDelta(draft, selected, dx, dy);
    const anchor = draft.blocks.find((b) => selected.has(b.key));
    if (!anchor || !snapObjects) {
      setGuides([]);
      setSpacing([]);
      return limit;
    }
    const landed = { x: anchor.x + limit.dx, y: anchor.y + limit.dy };
    const snapped = snapToObjects(draft, selected, landed, SNAP_DISTANCE);
    setGuides(snapped.guides);
    // Measured from the SNAPPED position, not the raw one: the number has to describe where the
    // block is about to land, or it disagrees with the guide drawn beside it.
    setSpacing(spacingMarks(draft, selected, { x: snapped.x, y: snapped.y }, snapped.guides));
    return { dx: limit.dx + (snapped.x - landed.x), dy: limit.dy + (snapped.y - landed.y) };
  };

  const onSeatDrag = (dx: number, dy: number, phase: "move" | "end") => {
    if (!dragging.current || selected.size === 0) return;
    if (phase === "move") {
      // Previewed through the SAME limit the commit applies, or the block appears to slide past the
      // edge of the map and then jumps back when the pointer is released.
      setDragDelta(dragWithSnap(dx, dy));
      return;
    }
    const final = dragWithSnap(dx, dy);
    setDragDelta(null);
    setGuides([]);
    setSpacing([]);
    dragging.current = false;
    applyMove(final.dx, final.dy);
  };

  /** Dragging decoration moves its block, exactly as dragging a seat moves the block it belongs to. */
  const onElementDrag = (dx: number, dy: number, phase: "move" | "end") => {
    if (!draggingElement.current || selected.size === 0) return;
    if (phase === "move") {
      setDragDelta(dragWithSnap(dx, dy));
      return;
    }
    const final = dragWithSnap(dx, dy);
    setDragDelta(null);
    setGuides([]);
    setSpacing([]);
    draggingElement.current = false;
    applyMove(final.dx, final.dy);
  };

  /** A marquee selects every block with a seat inside the rectangle. */
  const onMarquee = (
    rect: { x1: number; y1: number; x2: number; y2: number },
    additive: boolean,
    alt?: boolean,
  ) => {
    const minX = Math.min(rect.x1, rect.x2);
    const maxX = Math.max(rect.x1, rect.x2);
    const minY = Math.min(rect.y1, rect.y2);
    const maxY = Math.max(rect.y1, rect.y2);
    // Ghosted and hidden blocks are excluded HERE as well as in the canvas: a marquee runs over the
    // data, not over what the pointer can touch, so `pointer-events: none` does not stop it. Without
    // this, dragging a box across the balcony also grabbed every stall seat under it — the exact
    // accident dimming the other level exists to prevent.
    const inert = (id: number) => {
      const key = blockOfSeat.get(id);
      return key !== undefined && (ghostKeys.has(key) || hiddenKeys.has(key));
    };
    const inside = projected.seats
      .map((s, i) => ({ id: s.id ?? -(i + 1), x: s.x, y: s.y }))
      .filter((s) => s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY)
      .filter((s) => !inert(s.id));

    if (alt) {
      const hitSeats = new Set(inside.map((s) => s.id));
      setSelected(new Set());
      setSeatSel((cur) => (additive ? new Set([...cur, ...hitSeats]) : hitSeats));
      return;
    }

    const hit = new Set<string>();
    for (const s of inside) {
      const key = blockOfSeat.get(s.id);
      if (key) hit.add(key);
    }
    setSeatSel(new Set());
    setSelected((cur) => (additive ? new Set([...cur, ...hit]) : hit));
  };

  const addAt = (
    kind: BlockKind,
    geometry?: Exclude<BlockGeometry, "free">,
    dropAt?: { clientX: number; clientY: number },
  ) => {
    // Where the organizer dropped it, else the centre of what they are looking at — never the centre of
    // the coordinate space, which is how the reference editor ended up with everything stacked.
    const at = (dropAt
      ? canvas.current?.toLayout(dropAt.clientX, dropAt.clientY)
      : canvas.current?.toLayout(window.innerWidth / 2, window.innerHeight / 2)) ?? {
      x: 5000,
      y: 5000,
    };
    addAtPoint(kind, at, geometry);
  };

  /** The half of `addAt` that already knows WHERE, for the tool row, which is handed layout coords. */
  const addAtPoint = (
    kind: BlockKind,
    at: { x: number; y: number },
    geometry?: Exclude<BlockGeometry, "free">,
  ) => {
    commit((d) => {
      // Inherit from what is selected, else from the last block placed — see `nextBlockContext`.
      const resolved = nextBlockContext(d, selected, lastUsed);
      // A loose chair begins outside every section. Its internal storage label stays hidden until the
      // organizer deliberately places it into a section with the contextual selector.
      const ctx = kind === "individual-seat" ? { ...resolved, sectionId: null } : resolved;
      // A shape is born coloured so it is visible the moment it lands; every other kind keeps the
      // theme's own ink until it is painted.
      const color = shapeColor ?? (kind === "shape" ? SHAPE_DEFAULT_COLOR : null);
      const made = addBlock(d, kind, at, { ...ctx, grid, geometry, color });
      // Only fills in what has NOT been pinned: overwriting a pin with the resolved value would turn
      // "tự động" into a fixed choice the moment one block was placed.
      setLastUsed((cur) => ({
        sectionId: cur.sectionId === undefined ? undefined : resolved.sectionId,
        categoryId: cur.categoryId === undefined ? undefined : resolved.categoryId,
      }));
      setSelected(new Set([made.key]));
      return made.doc;
    });
  };

  // ---- Keyboard --------------------------------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === "Escape" && tool) {
        e.preventDefault();
        setTool(null);
        return;
      }
      if (previewing) {
        // The overlay owns the keyboard while it is up: nudging or deleting behind a preview would be
        // editing a chart the organizer cannot see.
        if (e.key === "Escape") {
          e.preventDefault();
          setPreviewing(false);
        }
        return;
      }
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelected(new Set(draft.blocks.map((b) => b.key)));
        return;
      }
      if (mod && e.key.toLowerCase() === "c") {
        // Copy is not a document change, so it takes no history entry — undo must not step back
        // through it and leave the organizer wondering what it undid.
        if (selected.size === 0) return;
        e.preventDefault();
        setClipboard(copyBlocks(draft, selected));
        return;
      }
      if (mod && e.key.toLowerCase() === "v") {
        if (clipboard.length === 0) return;
        e.preventDefault();
        commit((d) => {
          const pasted = pasteBlocks(d, clipboard, { x: 300, y: 300 });
          setSelected(pasted.keys);
          setRowSel(null);
          return pasted.doc;
        });
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (selected.size === 0) return;
        commit((d) => {
          const dup = duplicateBlocks(d, selected, 300, 300);
          setSelected(dup.keys);
          return dup.doc;
        });
        return;
      }
      if (drawing) {
        // While drawing, the block shortcuts below would delete or nudge a selection that is not the
        // subject of what the organizer is doing.
        if (e.key === "Escape") {
          e.preventDefault();
          setDrawing(null);
        } else if (e.key === "Enter") {
          e.preventDefault();
          finishDrawing(drawing);
        } else if (e.key === "Backspace" || e.key === "Delete") {
          e.preventDefault(); // take back the last point
          setDrawing((cur) => (cur && cur.length > 0 ? cur.slice(0, -1) : cur));
        }
        return;
      }
      if (e.key === "Escape") {
        setSelected(new Set());
        setSeatSel(new Set());
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected.size > 0) {
        e.preventDefault();
        applyDelete();
        return;
      }
      const dir: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      if (dir[e.key] && selected.size > 0) {
        e.preventDefault();
        const step = e.shiftKey ? NUDGE * 4 : NUDGE;
        applyMove(dir[e.key][0] * step, dir[e.key][1] * step);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // `layout` is a dependency because a table gesture reached from the keyboard saves first, and that
    // save sends `layout.version` — a listener still holding the previous layout would post a stale
    // version and be refused. The appliers themselves are deliberately absent: they are rebuilt every
    // render, so listing them would re-bind the listener on every render to no purpose, and everything
    // they actually read (`draft.blocks`, `selected`, `grid`, `layout`) is already here.
    // `clipboard` and `draft` are real dependencies, not lint noise: the handler closes over both, and
    // without them a paste after a copy would use the clipboard as it was when the listener was bound
    // — which is to say empty.
  }, [draft, draft.blocks, selected, clipboard, grid, layout, drawing, op, commit, undo, redo]);

  if (error && !layout) return <p className="p-6 text-sm text-on-tint">{error}</p>;
  if (!layout) return <p className="p-6 font-mono text-xs text-beige-kem/70">Đang tải sơ đồ…</p>;

  const seats = seatCount(draft);
  const standingCapacity = draft.blocks
    .filter((block) => block.kind === "ga-zone")
    .reduce((total, block) => total + (block.capacity ?? 0), 0);
  const places = seats + standingCapacity;
  const selectedStandingCapacity = draft.blocks
    .filter((block) => selected.has(block.key) && block.kind === "ga-zone")
    .reduce((total, block) => total + (block.capacity ?? 0), 0);
  const selectionStatus =
    seatSel.size > 0
      ? `${seatSel.size} ghế`
      : rowSel
        ? `Hàng ${rowSel.split("|")[1]}`
        : selected.size > 0
          ? `${selected.size} khối${subjectSeats.length > 0 ? ` · ${subjectSeats.length} ghế` : ""}${selectedStandingCapacity > 0 ? ` · ${selectedStandingCapacity} chỗ đứng` : ""}`
          : "Không có phần chọn";
  const activeHint = editorHint({
    drawingPoints: drawing ? drawing.length : null,
    tool,
    seatCount: seatSel.size,
    rowLabel: rowSel ? (rowSel.split("|")[1] ?? null) : null,
    blockCount: selected.size,
  });
  const calibration =
    calibrationLayer === "floorPlan"
      ? {
          image: layout.floorPlan.url ? { ...layout.floorPlan, url: layout.floorPlan.url } : null,
          panel: (
            <FloorPlanPanel
              key={`floor-plan-${layout.id}`}
              layoutId={layout.id}
              plan={layout.floorPlan}
              onChange={(floorPlan) => setLayout({ ...layout, floorPlan })}
            />
          ),
        }
      : {
          image: layout.referenceChart.url
            ? { ...layout.referenceChart, url: layout.referenceChart.url }
            : null,
          panel: (
            <ReferenceChartPanel
              key={`reference-chart-${layout.id}`}
              layoutId={layout.id}
              reference={layout.referenceChart}
              onChange={(referenceChart) => setLayout({ ...layout, referenceChart })}
            />
          ),
        };
  const editorBackground = layout.referenceChart.url
    ? { ...layout.referenceChart, url: layout.referenceChart.url }
    : layout.floorPlan.url
      ? { ...layout.floorPlan, url: layout.floorPlan.url }
      : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-xanh-pho text-beige-kem">
      {/*
        `min-h-14`, never `h-14`.

        This row WRAPS, and a fixed height on a wrapping flex container is a contradiction: the second
        line still lays out, the box stays 3.5rem tall, and the overflow paints straight over the
        canvas below — which is what "Lưới" and "Tự đánh số" were doing sitting on top of the map. It
        only appeared once the row grew past one line, so every button added here made it likelier.

        `shrink-0` stays: the header must keep its content's height, and the canvas takes what is left.
      */}
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b-2 border-beige-kem px-4 py-1">
        <h2 className="font-display text-lg font-black">{layout.name}</h2>
        <span className="font-mono text-[11px] text-beige-kem/70">
          {seats} ghế · {draft.blocks.length} khối · {draft.sections.length} khu ·{" "}
          {draft.categories.length} hạng ghế
        </span>
        {layout.status === "ready" ? (
          <span className={`${headerStatus} border-la-co/60 bg-la-co/20 text-beige-kem`}>
            Đã phát hành
          </span>
        ) : (
          <span className={`${headerStatus} border-beige-kem/25 bg-beige-kem/10 text-beige-kem/85`}>
            Bản nháp
          </span>
        )}
        {/*
          The save state (§29), as one badge that always says the true thing.

          Four states, in the order they outrank each other: saving now, offline, unsaved, saved. The
          offline case matters most and is the one a "Chưa lưu" badge alone got wrong — it looked like
          the organizer had forgotten to press save, when in fact pressing it would have failed.
        */}
        <span
          aria-live="polite"
          className={`${headerStatus} ${
            busy
              ? "border-beige-kem/25 bg-surface-2 text-beige-kem/75"
              : !online
                ? "border-cam-dat/70 bg-cam-dat/25 text-cam-dat-ink"
                : dirty
                  ? "border-cam-dat/70 bg-cam-dat/25 text-cam-dat-ink"
                  : "border-la-co/60 bg-la-co/20 text-beige-kem"
          }`}
          title={
            !online
              ? "Mất kết nối. Bản nháp vẫn được giữ trên máy này và sẽ lưu được khi có mạng trở lại."
              : dirty
                ? "Thay đổi chưa lưu — bản nháp được giữ trên máy này"
                : "Đã lưu lên máy chủ"
          }
        >
          {busy
            ? "Đang lưu…"
            : !online
              ? parkedAt
                ? "Ngoại tuyến · đã giữ trên máy"
                : "Ngoại tuyến"
              : dirty
                ? parkedAt
                  ? "Chưa lưu · đã giữ trên máy"
                  : "Chưa lưu"
                : savedAt
                  ? `Đã lưu ${agoLabel(savedAt, now)}`
                  : "Đã lưu"}
        </span>
        {blocking.length > 0 ? (
          <span className={`${headerStatus} border-burgundy/60 bg-bubblegum text-on-tint`}>
            {blocking.length} vấn đề
          </span>
        ) : (
          <span className={`${headerStatus} border-la-co/60 bg-la-co/20 text-beige-kem`}>
            Hợp lệ
          </span>
        )}
        {warningCount > 0 && (
          <span className={`${headerStatus} border-cam-dat/70 bg-cam-dat/25 text-cam-dat-ink`}>
            {warningCount} lưu ý
          </span>
        )}

        {/*
          Zoned by WHAT THE ACTION ACTS ON, not by how often it is reached for (designer teardown,
          §"Toolbar zoned by target").

          Two groups here, divided by a rule: DESIGNER actions change the view or the editing session
          and are icon-only; DOCUMENT actions change or leave the saved chart and keep their words.
          The split is what the icons are safe on — an organizer can afford to hover an unfamiliar
          glyph to learn "fit to frame", and cannot afford to guess at "Phát hành".

          A third zone, OBJECT actions, lives in the inspector rail's selection panel. Renumbering
          belongs there because it acts on the SELECTION; a chart-wide toolbar is the wrong home for
          a control whose effect depends on what is highlighted.
        */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button onClick={undo} disabled={!canUndo} className={icon} title="Hoàn tác (Ctrl+Z)">
            <Undo2 size={15} aria-label="Hoàn tác" />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className={icon}
            title="Làm lại (Ctrl+Shift+Z)"
          >
            <Redo2 size={15} aria-label="Làm lại" />
          </button>
          <button
            onClick={() => setShowHulls((h) => !h)}
            aria-pressed={showHulls}
            className={icon}
            title={
              showHulls
                ? "Ẩn viền khu — lớp trợ giúp nhìn, không ảnh hưởng dữ liệu"
                : "Hiện viền khu — lớp trợ giúp nhìn, không ảnh hưởng dữ liệu"
            }
          >
            {showHulls ? (
              <Eye size={15} aria-label="Ẩn viền khu" />
            ) : (
              <EyeOff size={15} aria-label="Hiện viền khu" />
            )}
          </button>
          <button
            onClick={() => setShowKeys(true)}
            className={icon}
            title="Bảng phím tắt của trình thiết kế"
          >
            <Keyboard size={15} aria-label="Phím tắt" />
          </button>
          <button
            onClick={() => setShowCoachmarks(true)}
            className={icon}
            title="Xem lại hướng dẫn nhanh"
          >
            <CircleHelp size={15} aria-label="Hướng dẫn" />
          </button>

          <span aria-hidden="true" className="mx-1 h-6 w-px bg-beige-kem/30" />

          <button
            onClick={() => setPreviewing(true)}
            disabled={draft.blocks.length === 0}
            className={btn}
            title="Xem sơ đồ đúng như khách hàng sẽ thấy"
          >
            Xem trước
          </button>
          <button onClick={() => void save()} disabled={busy || !dirty} className={btn}>
            Lưu ngay
          </button>
          <button
            onClick={() => (blocking.length > 0 ? setWorkspaceMode("check") : void publish())}
            disabled={busy}
            className={blocking.length > 0 ? btn : primary}
            title={blocking.length > 0 ? "Mở danh sách vấn đề cần sửa" : "Phát hành sơ đồ"}
          >
            {blocking.length > 0 ? `Sửa ${blocking.length} vấn đề` : "Phát hành"}
          </button>
          <button onClick={closeGuarded} className={closeButton} title="Đóng trình thiết kế">
            <X size={22} aria-label="Đóng" strokeWidth={2.5} />
          </button>
        </div>
      </header>

      {recovery && (
        <div className="flex flex-wrap items-center gap-3 border-b-2 border-cam-dat bg-cam-dat/15 px-4 py-2 text-eyebrow">
          <span className="text-beige-kem">
            Có bản nháp chưa lưu từ{" "}
            {new Date(recovery.savedAt).toLocaleString("vi-VN", {
              hour: "2-digit",
              minute: "2-digit",
              day: "2-digit",
              month: "2-digit",
            })}
            .
          </span>
          <button
            className={btn}
            onClick={() => {
              // `reset`, not `commit`: the recovered draft becomes the new baseline for undo, so one
              // Ctrl+Z does not silently throw the recovery away again.
              reset(recovery.document);
              setRecovery(null);
              setStatus("Đã khôi phục bản nháp chưa lưu.");
            }}
          >
            Khôi phục
          </button>
          <button
            className={btn}
            onClick={() => {
              forgetStoredDraft(layout.id);
              setRecovery(null);
            }}
          >
            Bỏ bản nháp
          </button>
        </div>
      )}

      {(status || error) && (
        <div className="flex shrink-0 flex-wrap gap-2 border-b border-beige-kem/25 px-4 py-2">
          {status && (
            <div
              role="status"
              className="border-l-2 border-la-co bg-la-co/20 px-3 py-1.5 text-xs font-medium text-beige-kem"
            >
              {status}
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 border-2 border-beige-kem bg-bubblegum px-3 py-1.5 text-xs text-on-tint">
              <span>{error}</span>
              {saveRefused && (
                <button
                  type="button"
                  onClick={() => void reloadFromServer()}
                  disabled={busy}
                  className="shrink-0 border border-on-tint/50 px-2 py-0.5 font-bold disabled:opacity-50"
                >
                  Tải lại sơ đồ
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="sr-only" aria-live="polite">
            {seatSel.size > 0
              ? `${seatSel.size} ghế đang chọn`
              : selected.size > 0
                ? `${selected.size} khối đang chọn`
                : "Chưa chọn gì"}
          </div>
          <div className="flex min-h-0 flex-1">
            <nav
              aria-label="Chế độ làm việc"
              className="flex w-[76px] shrink-0 flex-col gap-1 border-r border-beige-kem/25 px-1.5 py-2"
            >
              {WORKSPACE_MODES.map(({ id, label, icon: Glyph }) => (
                <button
                  key={id}
                  type="button"
                  aria-current={workspaceMode === id ? "page" : undefined}
                  onClick={() => {
                    setWorkspaceMode(id);
                    if (id !== "draw") {
                      setTool(null);
                      setDrawing(null);
                    }
                  }}
                  className={`flex min-h-12 flex-col items-center justify-center gap-1 border-l-2 px-1 py-1.5 text-[10px] font-bold transition ${
                    workspaceMode === id
                      ? "border-burgundy bg-burgundy/15 text-beige-kem"
                      : "border-transparent text-beige-kem/70 hover:bg-beige-kem/5 hover:text-beige-kem"
                  }`}
                >
                  <Glyph size={17} aria-hidden="true" />
                  <span>{label}</span>
                  {id === "check" && blocking.length > 0 && (
                    <span className="min-w-4 bg-burgundy px-1 text-[9px] leading-4 text-white">
                      {blocking.length}
                    </span>
                  )}
                </button>
              ))}
            </nav>

            {/*
              The tools, as a vertical icon rail (designer teardown, §"Tools").

              Moved out of a horizontal row above the canvas, which is what seats.io does and for the
              reason it does it: the editor had four stacked bands of chrome over the map — header,
              contextual actions, tools, then the canvas — and on a laptop that left the chart itself
              a letterbox. A rail spends WIDTH, of which a wide screen has plenty, instead of HEIGHT,
              of which it has none to spare.

              Icon-only is the trade the rail makes, and it is the reason every button here carries
              both a `title` and an `aria-label`: a first-timer pays a hover to learn each glyph once.
              Deliberately NOT every block kind — the palette on the right holds all nineteen, and a
              rail that listed them would be a palette in the wrong place.
            */}
            {workspaceMode === "draw" && (
              <div
                role="toolbar"
                aria-orientation="vertical"
                aria-label="Công cụ vẽ"
                className="flex shrink-0 flex-col gap-1 border-r border-beige-kem/25 px-1.5 py-2"
              >
                {(
                  [
                    ["select", MousePointer2, "Chọn và di chuyển (Esc)"],
                    ["seating-block", Grid3x3, "Khối ghế — bấm lên sơ đồ để đặt"],
                    ["single-row", Rows3, "Hàng ghế — bấm lên sơ đồ để đặt"],
                    ["ga-zone", Users, "Khu đứng — bấm lên sơ đồ để đặt"],
                    ["stage", RectangleHorizontal, "Sân khấu — bấm lên sơ đồ để đặt"],
                    ["text", Type, "Ghi chú — bấm lên sơ đồ để đặt"],
                    ["shape", Hexagon, "Hình khối — bấm lên sơ đồ để đặt"],
                    ["draw", PenTool, "Vẽ tự do: bấm từng điểm, bấm lại điểm đầu để khép hình"],
                  ] as const
                ).map(([key, Glyph, hint]) => {
                  // `Chọn` and `Vẽ tự do` are not block kinds, so the pressed test and the click differ
                  // for them; everything between is the same one-shot tool.
                  const active =
                    key === "select"
                      ? tool === null && !drawing
                      : key === "draw"
                        ? drawing !== null
                        : tool === key;
                  return (
                    <button
                      key={key}
                      onClick={() => {
                        if (key === "draw") {
                          setTool(null);
                          setDrawing((cur) => (cur ? null : []));
                          setSelected(new Set());
                          setSeatSel(new Set());
                          return;
                        }
                        if (key === "select") setWorkspaceMode("select");
                        setTool(key === "select" ? null : key);
                        setDrawing(null);
                      }}
                      aria-pressed={active}
                      title={hint}
                      className={`grid h-9 w-9 place-items-center border-2 transition ${
                        active
                          ? "border-burgundy bg-burgundy text-white"
                          : "border-transparent text-beige-kem/70 hover:border-beige-kem/40 hover:text-beige-kem"
                      }`}
                    >
                      {/* The accessible name lives on the icon, so the button reads as its tool and not
                        as the whole sentence the tooltip needs to teach the gesture. */}
                      <Glyph size={17} aria-label={hint.split(" — ")[0].split(":")[0]} />
                    </button>
                  );
                })}
              </div>
            )}

            {/*
              Drop target for the palette. Deliberately HTML5 drag-and-drop rather than the canvas's own
              pointer gestures: those already carry pan, marquee and block dragging, and threading a
              fourth meaning through them is how the seat tap got swallowed. Drag events are a separate
              channel, so nothing existing has to change to make room for this.
            */}
            <div
              className={`relative min-h-0 min-w-0 flex-1 `}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(BLOCK_DRAG_TYPE)) return;
                e.preventDefault(); // without this the browser refuses the drop
                e.dataTransfer.dropEffect = "copy";
                if (!dropping) setDropping(true);
              }}
              onDragLeave={(e) => {
                // Only when the pointer leaves the container itself, not on every child crossing.
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                setDropping(false);
              }}
              onDrop={(e) => {
                const dragged = parseBlockDrag(e.dataTransfer.getData(BLOCK_DRAG_TYPE));
                setDropping(false);
                if (!dragged) return;
                e.preventDefault();
                addAt(dragged.kind, dragged.geometry ?? undefined, {
                  clientX: e.clientX,
                  clientY: e.clientY,
                });
              }}
            >
              {draft.blocks.length === 0 && (
                // §40. A blank canvas with no guidance is the state an organizer opening their first
                // chart lands in, and it says nothing about what to do next.
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
                  <div className="pointer-events-auto max-w-sm border-2 border-dashed border-beige-kem/40 bg-surface-2/90 p-5 text-center">
                    <p className="font-mono text-xs font-bold uppercase tracking-widest text-beige-kem/70">
                      Sơ đồ trống
                    </p>
                    <p className="mt-2 text-[11px] leading-5 text-beige-kem/70">
                      Mở bảng Thêm để chọn loại khối, hoặc thiết lập ảnh nền để vẽ theo mặt bằng.
                    </p>
                    <div className="mt-3 flex justify-center gap-2">
                      <button onClick={() => setWorkspaceMode("draw")} className={primary}>
                        Mở công cụ thêm
                      </button>
                      <button onClick={() => setWorkspaceMode("settings")} className={btn}>
                        Thêm ảnh nền
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <SeatCanvas<CanvasSeat>
                ref={canvas}
                // Authoring wants a CONSTANT ratio: with the viewBox tracking the content, adding a stage
                // near an edge rescaled the whole chart, and a gap judged by eye changed size between edits.
                fitContent={false}
                // The grid the toggle below has always claimed to be showing.
                gridStep={showGrid ? gridStep : null}
                // Drawn under the seats: a guide is a hint about where a block is going, and it must
                // never sit over the thing it is guiding.
                underlay={
                  guides.length > 0 || (workspaceMode === "settings" && primaryStage) ? (
                    <g pointerEvents="none">
                      {workspaceMode === "settings" && primaryStage && (
                        <g
                          transform={`translate(${primaryStage.x + primaryStage.width / 2} ${
                            primaryStage.y + primaryStage.height / 2
                          })`}
                          className="stroke-cam-dat"
                        >
                          <circle r={190} fill="none" strokeWidth={12} strokeDasharray="45 28" />
                          <line x1={-280} y1={0} x2={280} y2={0} strokeWidth={10} />
                          <line x1={0} y1={-280} x2={0} y2={280} strokeWidth={10} />
                          <text
                            x={0}
                            y={-340}
                            textAnchor="middle"
                            stroke="none"
                            fontSize={120}
                            className="fill-cam-dat font-mono font-bold"
                          >
                            ĐIỂM HƯỚNG
                          </text>
                        </g>
                      )}
                      {guides.map((g) => (
                        <line
                          key={`${g.axis}-${g.at}`}
                          x1={g.axis === "x" ? g.at : 0}
                          y1={g.axis === "x" ? 0 : g.at}
                          x2={g.axis === "x" ? g.at : LAYOUT_SPACE}
                          y2={g.axis === "x" ? LAYOUT_SPACE : g.at}
                          className="stroke-burgundy"
                          strokeWidth={6}
                          strokeDasharray="60 40"
                        />
                      ))}
                      {/*
                      The measured gap: a solid bar between the two centres, capped at each end, with
                      the distance written beside it.

                      Solid where the guide is dashed, so the two never read as one line — the guide
                      says "in line with", the bar says "this far from", and at a glance they have to
                      be separable. Ticks are what turn a line into a measurement; without them the
                      bar just looks like a second guide running the other way.
                    */}
                      {spacing.map((m, i) => {
                        const vertical = m.axis === "x";
                        const mid = (m.from + m.to) / 2;
                        const tick = 90;
                        const x1 = vertical ? m.at : m.from;
                        const y1 = vertical ? m.from : m.at;
                        const x2 = vertical ? m.at : m.to;
                        const y2 = vertical ? m.to : m.at;
                        return (
                          <g key={`s${i}`} className="stroke-cam-dat">
                            <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={10} />
                            {[
                              [x1, y1],
                              [x2, y2],
                            ].map(([cx, cy], k) => (
                              <line
                                key={k}
                                x1={vertical ? cx - tick : cx}
                                y1={vertical ? cy : cy - tick}
                                x2={vertical ? cx + tick : cx}
                                y2={vertical ? cy : cy + tick}
                                strokeWidth={10}
                              />
                            ))}
                            <text
                              x={vertical ? m.at + tick * 1.6 : mid}
                              y={vertical ? mid : m.at - tick * 0.9}
                              fontSize={130}
                              textAnchor={vertical ? "start" : "middle"}
                              dominantBaseline="middle"
                              stroke="none"
                              className="fill-cam-dat font-mono"
                            >
                              {/*
                                Rounded to one decimal, and `Number` drops the trailing zero so a
                                whole number reads as "1500" rather than "1500.0".

                                The gap is measured from the SNAPPED landing position, and a drag that
                                is snapped on one axis only carries the raw pointer delta on the other
                                — which is fractional. So this printed things like
                                "1499.9999999999998": seventeen digits of noise for a number the eye
                                needed to read at a glance mid-gesture.
                              */}
                              {Number(m.distance.toFixed(1))}
                            </text>
                          </g>
                        );
                      })}
                    </g>
                  ) : undefined
                }
                selectedRowKey={rowSel}
                onViewReport={setViewReport}
                onRowSelect={(section, label) => {
                  // A row selection replaces the others: three levels of selection at once would make
                  // "what does Delete delete?" unanswerable.
                  setRowSel(`${section ?? ""}|${label}`);
                  setSelected(new Set());
                  setSeatSel(new Set());
                }}
                className="h-full"
                heightClass="h-full"
                editable
                interactive
                seats={visibleSeats}
                elements={canvasElements}
                hiddenElementIndices={hiddenElementIndices}
                ghostElementIndices={ghostElementIndices}
                ghostSeatIds={ghostSeatIds}
                selectedElementIndex={
                  selectedBlock ? blockOfElement.findIndex((k) => k === selectedBlock.key) : null
                }
                onElementPointerDown={(index, additive) => {
                  const key = blockOfElement[index];
                  if (!key) return;
                  draggingElement.current = true;
                  selectOnPress(key, additive);
                }}
                onElementDrag={onElementDrag}
                // Vertex editing has existed in the canvas all along and was never handed a callback, so
                // no polygon in this editor could be reshaped. Moving a point also clears `geometry`: the
                // outline is no longer the circle the generator would produce, and saying otherwise would
                // mean the next "make it a circle" silently discarded the organizer's edits.
                onResize={(index, handle, dx, dy, phase) => {
                  const key = blockOfElement[index];
                  const block = key ? draft.blocks.find((b) => b.key === key) : undefined;
                  if (!block || block.locked) return;
                  // Previewed live, committed once: `commit` on every pointer move would fill the undo
                  // stack with a hundred intermediate sizes (§28).
                  const box = resizedBox(block, handle as ResizeHandle, dx, dy);
                  const apply = (d: ChartDocument) => updateBlock(d, block.key, box);
                  if (phase === "move") setResizing({ key: block.key, box });
                  else {
                    setResizing(null);
                    commit(apply);
                  }
                }}
                onVertexDrag={(elementIndex, vertex, x, y, phase) => {
                  const key = blockOfElement[elementIndex];
                  const block = key ? draft.blocks.find((b) => b.key === key) : undefined;
                  if (!key || !block?.points || block.locked) return;
                  const points = block.points.map((p, i) =>
                    i === vertex ? { x: clampCoord(x), y: clampCoord(y) } : p,
                  );
                  // Previewed live, committed once — the same rule the resize handles follow (§28).
                  // This used to `op()` on every pointer move, so ONE drag pushed a hundred snapshots
                  // and, at an undo depth of 50, wiped the history it was filling: Ctrl+Z afterwards
                  // rewound a fraction of the drag and could never reach the edit before it.
                  if (phase === "move") setShapeEdit({ key, points });
                  else {
                    setShapeEdit(null);
                    commit((d) => updateBlock(d, key, { points, geometry: null }));
                  }
                }}
                onShapeScale={(elementIndex, corner, x, y, phase) => {
                  const key = blockOfElement[elementIndex];
                  const block = key ? draft.blocks.find((b) => b.key === key) : undefined;
                  if (!key || !block?.points?.length || block.locked) return;
                  const box = shapeBounds(block.points);
                  if (!box) return;
                  // The corner opposite the one being held stays put, so the shape grows away from a
                  // fixed point instead of sliding while it scales.
                  const anchor = {
                    x: corner.includes("w") ? box.maxX : box.minX,
                    y: corner.includes("n") ? box.maxY : box.minY,
                  };
                  const held = {
                    x: corner.includes("w") ? box.minX : box.maxX,
                    y: corner.includes("n") ? box.minY : box.maxY,
                  };
                  const points = scaleShapePoints(block.points, anchor, held, { x, y });
                  if (phase === "move") setShapeEdit({ key, points });
                  else {
                    setShapeEdit(null);
                    // `geometry` survives a scale, unlike a vertex drag: scaling a circle uniformly
                    // leaves a circle, so the outline still IS what the generator would produce and
                    // "make it a circle" has nothing to discard.
                    commit((d) => updateBlock(d, key, { points }));
                  }
                }}
                floorPlan={workspaceMode === "settings" ? calibration.image : editorBackground}
                blocks={blocks}
                seatBlockId={(s) => {
                  return sectionOfSeat.get(s.id) ?? null;
                }}
                seatClass={(s) =>
                  overlapping.has(s.id)
                    ? "fill-bubblegum/40 stroke-bubblegum"
                    : selected.has(blockOfSeat.get(s.id) ?? "") || seatSel.has(s.id)
                      ? "fill-burgundy/40 stroke-burgundy"
                      : "fill-transparent stroke-beige-kem/50"
                }
                // Price class as fill. Withheld for a seat that is selected or overlapping, so the state
                // the organizer is acting on is never hidden behind its colour — the same precedence the
                // buyer's map uses, where status outranks price.
                seatFill={(s) =>
                  overlapping.has(s.id) ||
                  selected.has(blockOfSeat.get(s.id) ?? "") ||
                  seatSel.has(s.id)
                    ? undefined
                    : colorOfSeat.get(s.id)
                }
                seatLabel={(s) =>
                  s.section
                    ? `${s.section}, hàng ${s.row}, ghế ${s.number}`
                    : "Ghế chưa thuộc khu vực nào"
                }
                selectedIds={
                  new Set(
                    canvasSeats
                      .filter((s) => selected.has(blockOfSeat.get(s.id) ?? ""))
                      .map((s) => s.id),
                  )
                }
                onSeatPointerDown={onSeatPointerDown}
                onSeatDrag={onSeatDrag}
                onSeatActivate={(s) => onSeatPointerDown(s, true)}
                onMarquee={onMarquee}
                onBackgroundClick={(p, additive) => {
                  if (drawing) {
                    addDrawingPoint(p);
                    return;
                  }
                  if (tool) {
                    // Placed at the POINTER, not at the centre of the view — the whole reason to hold a
                    // tool rather than click the palette is to say where the thing goes.
                    addAtPoint(tool, p);
                    setTool(null);
                    return;
                  }
                  if (!additive) {
                    setSelected(new Set());
                    setSeatSel(new Set());
                    setRowSel(null);
                  }
                }}
                // While drawing, the drag rectangle would be a marquee nobody asked for.
                marqueeStyle={drawing ? "none" : "rect"}
                overlay={
                  selectedBlock && !drawing ? (
                    /*
                    The rotation handle (§6), drawn for whatever single block is selected.

                    In the editor's overlay rather than on the canvas's elements, because a SEAT block
                    projects to seats and has no element to hang a handle on — and a seating block is
                    the thing an organizer most wants to swing round to face the stage. One handle for
                    every kind beats two implementations that disagree about which blocks can rotate.

                    Positioned by the block's own angle, so the grip stays where the block's "up" now
                    is and a second drag continues the first instead of snapping back to vertical.
                  */
                    (() => {
                      // The object's own tint/stroke says "selected"; these bounds only anchor the
                      // rotation grip. No second rectangle is drawn around the component.
                      const bSeats = canvasSeats.filter((s) =>
                        selected.has(blockOfSeat.get(s.id) ?? ""),
                      );
                      // Keep the control fully clear of the object. Its old 150-unit radius was
                      // centred only 90 units outside the bounds, so it necessarily covered the
                      // corner and could obscure a short block's label.
                      const handleOffset = 200;
                      let handleAnchor: { x: number; y: number };
                      if (bSeats.length > 0) {
                        let minX = Infinity;
                        let minY = Infinity;
                        for (const s of bSeats) {
                          if (s.x < minX) minX = s.x;
                          if (s.y < minY) minY = s.y;
                        }
                        handleAnchor = {
                          x: minX - handleOffset,
                          y: minY - handleOffset,
                        };
                      } else if (selectedBlock.kind === "shape" && selectedBlock.points?.length) {
                        // A scaled polygon changes its points, not its advisory width/height. Anchor
                        // the grip to the true outline so it follows the component as it grows.
                        const extent = shapeBounds(selectedBlock.points)!;
                        handleAnchor = {
                          x: extent.minX - handleOffset,
                          y: extent.minY - handleOffset,
                        };
                      } else {
                        // No seats or points to measure — the declared box is the real extent.
                        handleAnchor = {
                          x: selectedBlock.x - selectedBlock.width / 2 - handleOffset,
                          y: selectedBlock.y - selectedBlock.height / 2 - handleOffset,
                        };
                      }

                      /*
                      The rotation handle (§6), drawn for whatever single block is selected.

                      In the editor's overlay rather than on the canvas's elements, because a SEAT
                      block projects to seats and has no element to hang a handle on — and a seating
                      block is the thing an organizer most wants to swing round to face the stage.
                      One handle for every kind beats two implementations that disagree about which
                      blocks can rotate.

                      Sat at the block's TOP-LEFT corner rather than on a stalk above its centre.
                      The stalk had two problems the corner does not: it reached `height/2 + 400`
                      into whatever happened to be above the block, so on a chart of stacked rows it
                      hovered over the neighbouring block and looked like that one's handle; and it
                      moved as the block turned, so the grip an organizer reached for was somewhere
                      new after every rotation. A corner is a fixed place to reach for, and it is
                      where every drawing tool puts this control.

                      The glyph is the circular arrow that means "turn this" everywhere else — the
                      bare dot said only "drag me", leaving rotate and resize looking like the same
                      affordance.
                      */
                      const hx = handleAnchor.x;
                      const hy = handleAnchor.y;
                      const handleRadius = 88;
                      const glyphRadius = 44;
                      const pt = (deg: number) => {
                        const r = (deg * Math.PI) / 180;
                        return [
                          hx + Math.cos(r) * glyphRadius,
                          hy + Math.sin(r) * glyphRadius,
                        ] as const;
                      };
                      // 270° of arc with the gap on the east side, so the opening reads as a gap
                      // rather than as a broken circle.
                      const [ax, ay] = pt(45);
                      const [bx, by] = pt(315);
                      // Arrowhead at the swept-to end, along the tangent there (radius turned +90°).
                      const tang = [
                        -Math.sin((315 * Math.PI) / 180),
                        Math.cos((315 * Math.PI) / 180),
                      ];
                      const norm = [-tang[1], tang[0]];
                      const arrowLength = 30;
                      const arrowWidth = 17;
                      const head = [
                        [bx + tang[0] * arrowLength, by + tang[1] * arrowLength],
                        [
                          bx - tang[0] * 4 + norm[0] * arrowWidth,
                          by - tang[1] * 4 + norm[1] * arrowWidth,
                        ],
                        [
                          bx - tang[0] * 4 - norm[0] * arrowWidth,
                          by - tang[1] * 4 - norm[1] * arrowWidth,
                        ],
                      ]
                        .map(([x, y]) => `${x},${y}`)
                        .join(" ");

                      return (
                        <g>
                          <circle
                            cx={hx}
                            cy={hy}
                            r={handleRadius}
                            className="fill-transparent stroke-burgundy"
                            strokeWidth={6}
                            style={{ cursor: "grab" }}
                            role="button"
                            aria-label={`Xoay ${selectedBlock.title}`}
                            onPointerDown={(e) => beginRotate(selectedBlock, e)}
                          />
                          {/* Inert: the circle above is the whole hit target, so the glyph can never
                              swallow the gesture that starts a rotation. */}
                          <g pointerEvents="none">
                            <path
                              d={`M ${ax} ${ay} A ${glyphRadius} ${glyphRadius} 0 1 1 ${bx} ${by}`}
                              fill="none"
                              className="stroke-burgundy"
                              strokeWidth={15}
                              strokeLinecap="round"
                            />
                            <polygon points={head} className="fill-burgundy" />
                          </g>
                        </g>
                      );
                    })()
                  ) : drawing && drawing.length > 0 ? (
                    <g pointerEvents="none">
                      <polyline
                        points={drawing.map((p) => `${p.x},${p.y}`).join(" ")}
                        fill="none"
                        stroke={shapeColor ?? SHAPE_DEFAULT_COLOR}
                        strokeWidth={12}
                        strokeDasharray="30 20"
                      />
                      {drawing.map((p, i) => (
                        <circle
                          key={i}
                          cx={p.x}
                          cy={p.y}
                          r={i === 0 ? 90 : 60}
                          fill={i === 0 ? (shapeColor ?? SHAPE_DEFAULT_COLOR) : "none"}
                          stroke={shapeColor ?? SHAPE_DEFAULT_COLOR}
                          strokeWidth={10}
                        />
                      ))}
                    </g>
                  ) : null
                }
              />
            </div>
          </div>

          {/* A single editor dock. View commands stay immediately available; precision controls and
              the colour key disclose upward so they do not consume canvas height. The centre reports
              what the active tool expects, while the stable right edge reports selection and capacity. */}
          <footer
            ref={bottomDock}
            className="relative z-30 flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-t-2 border-beige-kem/30 bg-surface-2 px-2 py-1.5 text-xs text-beige-kem/70"
            aria-label="Trạng thái và điều khiển sơ đồ"
          >
            <div
              className="flex shrink-0 items-center gap-1 border-r border-beige-kem/20 pr-2"
              aria-label="Điều khiển khung nhìn"
            >
              <button
                type="button"
                className={`${statusButton} w-8 justify-center px-0 text-base`}
                onClick={() => canvas.current?.zoomOut()}
                aria-label="Thu nhỏ"
                title="Thu nhỏ"
              >
                −
              </button>
              <div className="relative">
                <button
                  type="button"
                  data-bottom-menu="zoom"
                  aria-controls="bottom-zoom-panel"
                  aria-expanded={bottomMenu === "zoom"}
                  onClick={() => setBottomMenu((menu) => (menu === "zoom" ? null : "zoom"))}
                  className={`${statusButton} min-w-14 justify-center px-1 tabular-nums`}
                  title="Chọn mức phóng to"
                >
                  {Math.round(viewReport.zoom * 100)}%
                  <span aria-hidden="true" className="text-[9px]">
                    ▴
                  </span>
                </button>
                {bottomMenu === "zoom" && (
                  <div
                    id="bottom-zoom-panel"
                    role="group"
                    aria-label="Mức phóng to"
                    className="absolute bottom-[calc(100%+8px)] left-0 z-50 w-36 border-2 border-beige-kem bg-surface-2 p-2 shadow-xl"
                  >
                    {[1, 2, 4].map((scale) => (
                      <button
                        key={scale}
                        type="button"
                        onClick={() => {
                          canvas.current?.zoomTo(scale);
                          setBottomMenu(null);
                          requestAnimationFrame(() =>
                            bottomDock.current
                              ?.querySelector<HTMLButtonElement>('[data-bottom-menu="zoom"]')
                              ?.focus(),
                          );
                        }}
                        aria-pressed={Math.abs(viewReport.zoom - scale) < 0.01}
                        className={`block w-full border px-2 py-1.5 text-left font-mono text-xs font-bold transition hover:border-beige-kem ${
                          Math.abs(viewReport.zoom - scale) < 0.01
                            ? "border-burgundy bg-burgundy/15 text-beige-kem"
                            : "border-transparent text-beige-kem/70"
                        }`}
                      >
                        {scale * 100}%
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                className={`${statusButton} w-8 justify-center px-0 text-base`}
                onClick={() => canvas.current?.zoomIn()}
                aria-label="Phóng to"
                title="Phóng to"
              >
                +
              </button>
              <button
                type="button"
                className={`${statusButton} w-8 justify-center px-0`}
                onClick={() => canvas.current?.zoomToVenue()}
                aria-label="Vừa sơ đồ"
                title="Đưa toàn bộ sơ đồ vừa khung nhìn"
              >
                <Maximize size={14} />
              </button>
            </div>

            {/*
              Layer picker (0044) — in the status dock beside zoom, because it is the same KIND of
              control: it changes what is EDITABLE on screen without changing what is in the chart.
              Appears only once the chart has levels; a flat chart never grows it.

              Choosing a level does not hide the others — they stay on screen, dimmed and inert, the
              way an inactive layer behaves in any drawing tool. That is what makes it possible to
              place a balcony over the stalls: you cannot align against something you cannot see.

              "Mọi tầng" is a real option, not an empty state — some edits genuinely span levels.
            */}
            {floors.length > 0 && (
              <label className="flex items-center gap-1.5">
                <span className="sr-only">Tầng đang xem</span>
                <select
                  value={editFloor ?? ""}
                  onChange={(e) =>
                    setEditFloor(e.target.value === "" ? null : Number(e.target.value))
                  }
                  className={`${statusButton} ${editFloor !== null ? "border-burgundy bg-burgundy/15 text-beige-kem" : ""}`}
                  title="Chọn tầng để sửa. Các tầng còn lại vẫn hiện, mờ đi và không bấm được."
                >
                  <option value="">Mọi tầng · sửa được hết</option>
                  {floors.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="relative">
              <button
                type="button"
                data-bottom-menu="grid"
                aria-controls="bottom-grid-panel"
                aria-expanded={bottomMenu === "grid"}
                onClick={() => setBottomMenu((menu) => (menu === "grid" ? null : "grid"))}
                className={`${statusButton} ${showGrid ? "border-burgundy bg-burgundy/15 text-beige-kem" : ""}`}
              >
                <Grid3x3 size={14} aria-hidden="true" />
                Lưới · {gridSpacingLabel(gridStep)}
                <span aria-hidden="true">▴</span>
              </button>
              {bottomMenu === "grid" && (
                <div
                  id="bottom-grid-panel"
                  role="group"
                  aria-label="Thiết lập lưới căn chỉnh"
                  className="absolute bottom-[calc(100%+8px)] left-0 z-50 w-64 border-2 border-beige-kem bg-surface-2 p-3 shadow-xl"
                >
                  <p className="font-mono text-xs font-bold uppercase tracking-wider text-beige-kem">
                    Lưới căn chỉnh
                  </p>
                  <div className="mt-2">
                    <BarToggle
                      on={showGrid}
                      onClick={() => setShowGrid((value) => !value)}
                      label="Hiện lưới trên nền"
                      title="Chỉ thay đổi cách hiển thị, không di chuyển thành phần"
                    />
                  </div>
                  <p className="mt-3 font-mono text-xs font-bold text-beige-kem/70">Khoảng lưới</p>
                  <div className="mt-1 grid grid-cols-2 gap-1">
                    {GRID_STEPS.map((step) => (
                      <button
                        key={step}
                        type="button"
                        aria-pressed={gridStep === step}
                        onClick={() => setGridStep(step)}
                        className={`border px-2 py-1.5 text-left transition hover:border-beige-kem ${
                          gridStep === step
                            ? "border-burgundy bg-burgundy/15 text-beige-kem"
                            : "border-beige-kem/30 text-beige-kem/70"
                        }`}
                      >
                        <span className="block font-bold">{gridSpacingLabel(step)}</span>
                        <span className="font-mono text-[10px] opacity-70">{step} đơn vị</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="relative">
              <button
                type="button"
                data-bottom-menu="snap"
                aria-controls="bottom-snap-panel"
                aria-expanded={bottomMenu === "snap"}
                onClick={() => setBottomMenu((menu) => (menu === "snap" ? null : "snap"))}
                className={`${statusButton} ${
                  snapGrid || snapObjects ? "border-burgundy bg-burgundy/15 text-beige-kem" : ""
                }`}
              >
                Bám · {Number(snapGrid) + Number(snapObjects)}/2
                <span aria-hidden="true">▴</span>
              </button>
              {bottomMenu === "snap" && (
                <div
                  id="bottom-snap-panel"
                  role="group"
                  aria-label="Thiết lập hỗ trợ căn chỉnh"
                  className="absolute bottom-[calc(100%+8px)] left-0 z-50 w-64 space-y-1 border-2 border-beige-kem bg-surface-2 p-3 shadow-xl"
                >
                  <p className="mb-2 font-mono text-xs font-bold uppercase tracking-wider text-beige-kem">
                    Hỗ trợ căn chỉnh
                  </p>
                  <BarToggle
                    on={snapGrid}
                    onClick={() => setSnapGrid((value) => !value)}
                    label="Bám vào lưới"
                    title="Làm tròn vị trí về ô lưới khi kéo"
                  />
                  <BarToggle
                    on={snapObjects}
                    onClick={() => setSnapObjects((value) => !value)}
                    label="Bám tâm khối khác"
                    title="Canh tâm với khối khác khi kéo"
                  />
                </div>
              )}
            </div>

            <div className="hidden min-w-0 flex-1 items-center gap-2 border-l border-beige-kem/20 pl-2 xl:flex">
              <Keyboard size={14} className="shrink-0" aria-hidden="true" />
              <span className="truncate" title={activeHint}>
                {activeHint}
              </span>
            </div>
            <button
              type="button"
              className={`${statusButton} w-8 justify-center px-0 xl:hidden`}
              onClick={() => setShowKeys(true)}
              aria-label={`Mở phím tắt. ${activeHint}`}
              title={activeHint}
            >
              <Keyboard size={14} aria-hidden="true" />
            </button>

            <span
              className="hidden whitespace-nowrap font-mono tabular-nums text-beige-kem/60 2xl:inline"
              title="Toạ độ con trỏ trên sơ đồ"
            >
              {viewReport.x === null ? "X — · Y —" : `X ${viewReport.x} · Y ${viewReport.y}`}
            </span>

            <div className="ml-auto flex shrink-0 items-center gap-2">
              {categoryLegend.length > 0 && (
                <div className="relative">
                  <button
                    type="button"
                    data-bottom-menu="legend"
                    aria-controls="bottom-legend-panel"
                    aria-expanded={bottomMenu === "legend"}
                    onClick={() => setBottomMenu((menu) => (menu === "legend" ? null : "legend"))}
                    className={statusButton}
                  >
                    Hạng ghế · {categoryLegend.length}
                    <span aria-hidden="true">▴</span>
                  </button>
                  {bottomMenu === "legend" && (
                    <div
                      id="bottom-legend-panel"
                      role="group"
                      aria-label="Chú giải hạng ghế"
                      className="absolute bottom-[calc(100%+8px)] right-0 z-50 max-h-72 w-72 overflow-y-auto border-2 border-beige-kem bg-surface-2 p-3 shadow-xl"
                    >
                      <p className="font-mono text-xs font-bold uppercase tracking-wider text-beige-kem">
                        Chú giải hạng ghế
                      </p>
                      <div className="mt-2 space-y-1">
                        {categoryLegend.map((category) => (
                          <div
                            key={category.id}
                            className="flex items-center gap-2 border border-beige-kem/20 px-2 py-1.5"
                          >
                            <span
                              aria-hidden="true"
                              className="h-3.5 w-3.5 shrink-0 border"
                              style={{
                                borderColor: category.color,
                                backgroundColor: category.color,
                              }}
                            />
                            <span className="min-w-0 flex-1 truncate font-bold text-beige-kem">
                              {category.name}
                            </span>
                            <span className="whitespace-nowrap font-mono text-beige-kem/70">
                              {category.count > 0
                                ? `${category.count} ghế`
                                : `${category.capacity} chỗ đứng`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <span className="whitespace-nowrap border-l border-beige-kem/20 pl-2 font-mono text-beige-kem">
                {selectionStatus}
              </span>
              <span
                className="whitespace-nowrap border-l border-beige-kem/20 pl-2 font-mono font-bold text-beige-kem"
                title={`${seats} ghế${standingCapacity > 0 ? ` · ${standingCapacity} chỗ đứng` : ""}`}
              >
                Tổng {places} chỗ
              </span>
            </div>
          </footer>
        </main>

        <aside
          ref={inspectorRail}
          className="w-80 shrink-0 space-y-2 overflow-y-auto border-l-2 border-beige-kem p-3"
        >
          <div className="pb-1">
            <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-beige-kem">
              {WORKSPACE_TITLE[workspaceMode]}
            </p>
            {/* Only when there IS something to report. The empty half used to spell out how to make a
                selection, which is a thing the canvas teaches by being used. */}
            {(workspaceMode === "sections" || workspaceMode === "seatClasses") &&
              assignmentCount > 0 && (
                <p className="mt-1 font-mono text-[10px] text-beige-kem/70">
                  {assignmentLabel} sẵn sàng để gán
                </p>
              )}
          </div>

          {assignmentCount > 0 && (
            <section
              className="border-b border-beige-kem/25 px-1 pb-3"
              aria-label="Đổi khu vực của phần đang chọn"
            >
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="selection-section"
                  className="font-mono text-xs font-bold uppercase tracking-wider text-beige-kem/70"
                >
                  Khu vực của phần chọn
                </label>
                <span className="font-mono text-[10px] text-beige-kem/60">{assignmentLabel}</span>
              </div>
              <select
                id="selection-section"
                value={selectedSectionValue}
                disabled={sectionAssignmentDisabled}
                onChange={(event) =>
                  assignSectionTo(event.target.value === "none" ? null : Number(event.target.value))
                }
                className="mt-2 h-9 w-full border border-beige-kem/50 bg-surface-2 px-2 text-xs font-bold text-beige-kem outline-none focus:border-burgundy disabled:cursor-not-allowed disabled:opacity-45"
              >
                {selectedSectionValue === "mixed" && (
                  <option value="mixed" disabled>
                    — nhiều khu vực —
                  </option>
                )}
                <option value="none">Không thuộc khu vực nào</option>
                {draft.sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name}
                  </option>
                ))}
              </select>
              {sectionAssignmentDisabled && (
                <p className="mt-1.5 text-[11px] leading-4 text-beige-kem/65">
                  Mở khoá phần chọn để đổi khu vực. Ghế quanh bàn được quản lý cùng bàn.
                </p>
              )}
              {seatSel.size > 0 && subjectSeats.every((seat) => seat.sectionId === null) && (
                <p className="mt-1.5 text-[11px] leading-4 text-beige-kem/65">
                  Ghế đứng riêng ngoài khu sẽ không hiện nhãn. Chọn một khu để đưa ghế vào hệ nhãn
                  của khu đó.
                </p>
              )}
            </section>
          )}

          {workspaceMode === "labels" && (
            <section className={RAIL_PANEL} aria-label="Tùy chọn đánh số hàng">
              <p className="font-mono text-xs font-bold uppercase tracking-wider text-beige-kem/70">
                Đánh số hàng
              </p>
              <button
                type="button"
                onClick={toggleAutoRenumber}
                aria-pressed={autoRenumber}
                className={`mt-2 flex w-full items-center gap-2 border-2 px-3 py-2 text-left text-xs font-bold transition hover:border-beige-kem ${
                  autoRenumber
                    ? "border-burgundy bg-burgundy/15 text-beige-kem"
                    : "border-beige-kem/40 text-beige-kem/80"
                }`}
              >
                <span aria-hidden="true">{autoRenumber ? "☑" : "☐"}</span>
                Tự dồn nhãn sau khi xoá
              </button>
              <p className="mt-2 text-xs leading-5 text-beige-kem/70">
                {autoRenumber
                  ? "Khi xoá hoặc thu nhỏ khối, nhãn hàng sẽ tự nối lại cho liền mạch."
                  : "Nhãn hàng được giữ nguyên. Dùng “Đánh lại hàng” khi bạn muốn dồn nhãn."}
              </p>
            </section>
          )}

          {seatSel.size > 0 && (
            <section className={RAIL_PANEL} aria-label="Thuộc tính ghế đang chọn">
              <p className="font-mono text-xs font-bold uppercase tracking-wider text-beige-kem/70">
                Ghế đang chọn
              </p>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <p className="text-sm font-bold text-beige-kem">{seatSel.size} ghế</p>
                <p className="font-mono text-xs text-beige-kem/70">Alt để chọn thêm</p>
              </div>

              <label className="mt-3 block text-xs text-beige-kem/70">
                <span className="font-mono font-bold uppercase tracking-wider text-beige-kem/80">
                  Loại ghế
                </span>
                <select
                  value={(() => {
                    const types = new Set(subjectSeats.map((seat) => seat.seatType ?? "single"));
                    return types.size === 1 ? [...types][0] : "mixed";
                  })()}
                  onChange={(event) => setSeatsType(event.target.value as EditableSeatType)}
                  className="mt-1 h-9 w-full border-2 border-beige-kem/50 bg-surface-2 px-2 text-xs text-beige-kem outline-none focus:border-burgundy"
                >
                  {new Set(subjectSeats.map((seat) => seat.seatType ?? "single")).size > 1 && (
                    <option value="mixed">— nhiều loại —</option>
                  )}
                  {EDITABLE_SEAT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type === "single" ? "Ghế đơn" : "Ghế đôi"}
                    </option>
                  ))}
                </select>
              </label>

              <div className="mt-3 grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() =>
                    setSeatsAccessible(!subjectSeats.every((seat) => seat.isAccessible))
                  }
                  aria-pressed={subjectSeats.every((seat) => seat.isAccessible)}
                  className={`${btn} ${
                    subjectSeats.every((seat) => seat.isAccessible)
                      ? "bg-burgundy/20 text-beige-kem"
                      : ""
                  }`}
                >
                  Xe lăn {subjectSeats.every((seat) => seat.isAccessible) ? "· bật" : ""}
                </button>
                {pairPairable.canPair && (
                  <button type="button" onClick={pairSeats} className={btn}>
                    Ghép đi kèm
                  </button>
                )}
              </div>

              {existingPair && (
                <div className="mt-3 border-t border-beige-kem/20 pt-3">
                  <p className="font-mono text-xs text-beige-kem/70">
                    Ghế đi kèm: {existingPair.targetLabel}
                  </p>
                  <button type="button" onClick={unpairSeats} className={`${btn} mt-2`}>
                    Bỏ ghép
                  </button>
                </div>
              )}
            </section>
          )}

          {selected.size > 0 && seatSel.size === 0 && (
            <section className={RAIL_PANEL} aria-label="Thao tác với khối đang chọn">
              <p className="font-mono text-xs font-bold uppercase tracking-wider text-beige-kem/70">
                {selected.size === 1 ? "Khối đang chọn" : "Nhiều khối đang chọn"}
              </p>
              <p className="mt-1 truncate text-sm font-bold text-beige-kem">
                {selectedBlock?.title ?? `${selected.size} khối`}
              </p>
              <p className="mt-0.5 font-mono text-xs text-beige-kem/70">
                {selectedBlock ? BLOCK_LABEL[selectedBlock.kind] : `${selected.size} khối`}
                {subjectSeats.length > 0 ? ` · ${subjectSeats.length} ghế` : ""}
                {selectedBlock?.locked ? " · đã khoá" : ""}
              </p>

              <p className="mt-3 border-t border-beige-kem/20 pt-3 font-mono text-xs font-bold uppercase tracking-wider text-beige-kem/70">
                Thao tác nhanh
              </p>
              <div className="mt-2 grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const anyOpen = draft.blocks.some(
                      (block) => selected.has(block.key) && block.locked !== true,
                    );
                    op((document) => setLocked(document, selected, anyOpen));
                  }}
                  className={btn}
                  title="Khoá khối để tránh kéo hoặc sửa nhầm"
                >
                  {draft.blocks.some((block) => selected.has(block.key) && block.locked !== true)
                    ? "Khoá"
                    : "Mở khoá"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    op((document) => {
                      const duplicate = duplicateBlocks(document, selected, 300, 300);
                      setSelected(duplicate.keys);
                      return duplicate.doc;
                    })
                  }
                  className={btn}
                  title="Nhân đôi (Ctrl+D)"
                >
                  Nhân đôi
                </button>
                <button
                  type="button"
                  onClick={() => op((document) => renumberSelection(document, selected))}
                  className={`${btn} col-span-2`}
                  disabled={subjectSeats.length === 0}
                  title={
                    subjectSeats.length > 0
                      ? "Dồn lại chữ hàng cho khối đang chọn — có thể hoàn tác"
                      : "Khối này không có hàng ghế để đánh lại"
                  }
                >
                  Đánh lại hàng
                </button>
              </div>

              <details
                ref={arrangementMenu}
                className="group mt-3 border-t border-beige-kem/20 pt-3"
              >
                <summary
                  ref={arrangementTrigger}
                  className={`${btn} flex w-full cursor-pointer list-none items-center justify-between [&::-webkit-details-marker]:hidden`}
                >
                  Sắp xếp
                  <span aria-hidden="true" className="transition group-open:rotate-180">
                    ▾
                  </span>
                </summary>
                <div className="mt-2 border border-beige-kem/30 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-xs font-bold uppercase tracking-wider text-beige-kem/80">
                      Canh khối
                    </p>
                    <span className="font-mono text-xs text-beige-kem/70">Từ 2 khối</span>
                  </div>
                  <div className="mt-2 grid grid-cols-6 gap-1">
                    {ALIGN_EDGES.map((edge) => (
                      <button
                        key={edge}
                        type="button"
                        className={icon}
                        disabled={selected.size < 2}
                        onClick={() => applyAlign(edge)}
                        title={ALIGN_LABEL[edge]}
                        aria-label={ALIGN_LABEL[edge]}
                      >
                        {ALIGN_GLYPH[edge]}
                      </button>
                    ))}
                  </div>

                  <div className="mt-3 border-t border-beige-kem/20 pt-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-mono text-xs font-bold uppercase tracking-wider text-beige-kem/80">
                        Dàn đều
                      </p>
                      <span className="font-mono text-xs text-beige-kem/70">Từ 3 khối</span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1">
                      {(["horizontal", "vertical"] as const).map((axis) => (
                        <button
                          key={axis}
                          type="button"
                          className={btn}
                          disabled={selected.size < 3}
                          onClick={() =>
                            op((document) => distributeBlocks(document, selected, axis))
                          }
                        >
                          {axis === "horizontal" ? "⇹ Ngang" : "⇳ Dọc"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-1 border-t border-beige-kem/20 pt-3">
                    <button
                      type="button"
                      className={btn}
                      onClick={() => op((document) => flipBlocks(document, selected, "horizontal"))}
                    >
                      ⇋ Lật ngang
                    </button>
                    <button
                      type="button"
                      className={btn}
                      onClick={() => op((document) => flipBlocks(document, selected, "vertical"))}
                    >
                      ⇅ Lật dọc
                    </button>
                    <button
                      type="button"
                      className={btn}
                      disabled={selected.size < 2}
                      onClick={() => op((document) => groupBlocks(document, selected))}
                    >
                      Nhóm
                    </button>
                    <button
                      type="button"
                      className={btn}
                      disabled={!hasGroupedSelection}
                      onClick={() => op((document) => ungroupBlocks(document, selected))}
                    >
                      Bỏ nhóm
                    </button>
                  </div>
                </div>
              </details>

              <button
                type="button"
                onClick={applyDelete}
                className="mt-3 w-full border-2 border-burgundy-ink px-3 py-1.5 text-xs font-bold text-burgundy-ink transition hover:bg-bubblegum hover:text-on-tint"
                title="Xoá (Delete)"
              >
                Xoá khối
              </button>
            </section>
          )}

          {/* Ordered by how often it is reached for, not by the order the features were built. Selection
              actions lead the inspector because choosing an object is the moment the organizer asks
              both "what is this?" and "what can I do with it?". */}
          {workspaceMode === "select" && (
            <RailGroup title="Cấu trúc & tìm kiếm" openWhen={!selectedBlock && !selectedRow}>
              <LayersPanel
                doc={draft}
                selected={selected}
                selectedRowKey={rowSel}
                onSelectBlock={(key, additive) => {
                  setSelected((cur) => selectionAfterPress(cur, key, additive));
                  setRowSel(null);
                  setSeatSel(new Set());
                  frameBlocks([key]);
                }}
                onSelectRow={(blockKey, sectionName, label) => {
                  setRowSel(`${sectionName ?? ""}|${label}`);
                  setSelected(new Set());
                  setSeatSel(new Set());
                  frameBlocks([blockKey]);
                }}
                onToggleLock={(key, locked) => op((d) => setLocked(d, new Set([key]), locked))}
                onToggleHidden={(key, hidden) => op((d) => setHidden(d, new Set([key]), hidden))}
              />
            </RailGroup>
          )}

          {selectedRow && (workspaceMode === "select" || workspaceMode === "labels") && (
            <RailGroup title="Thuộc tính hàng" openWhen>
              <RowInspector
                key={`${selectedRow.blockKey}|${selectedRow.label}`}
                label={selectedRow.label}
                sectionName={selectedRow.sectionName}
                seatCount={selectedRow.seatCount}
                canEdit={selectedRow.canEdit}
                onRename={(label) => {
                  // By row id when the row has one; by label when it is a row drawn this session and
                  // not yet saved, which has no id to address it by.
                  const ref = { blockKey: selectedRow.blockKey, label: selectedRow.label };
                  op((d) =>
                    selectedRow.rowId != null
                      ? renameRow(d, selectedRow.rowId, label)
                      : {
                          ...d,
                          blocks: d.blocks.map((b) =>
                            b.key === ref.blockKey
                              ? {
                                  ...b,
                                  seats: b.seats?.map((seat) =>
                                    seat.rowLabel === ref.label
                                      ? { ...seat, rowLabel: label }
                                      : seat,
                                  ),
                                }
                              : b,
                          ),
                        },
                  );
                  setRowSel(`${selectedRow.sectionName ?? ""}|${label}`);
                }}
                onReverse={() =>
                  op((d) =>
                    reverseRow(d, { blockKey: selectedRow.blockKey, label: selectedRow.label }),
                  )
                }
                onDuplicate={() =>
                  op((d) =>
                    duplicateRow(d, { blockKey: selectedRow.blockKey, label: selectedRow.label }),
                  )
                }
                onDelete={() =>
                  ask(
                    {
                      title: `Xoá hàng ${selectedRow.label}?`,
                      message: `${selectedRow.seatCount} ghế sẽ bị xoá. Các hàng còn lại giữ nguyên nhãn — dùng “Đánh lại số” nếu muốn dồn lại. Ghế mà suất diễn đã tạo vé sẽ được lưu trữ thay vì xoá.`,
                      confirmLabel: "Xoá hàng",
                      cancelLabel: "Huỷ",
                      tone: "danger",
                    },
                    () => {
                      op((d) =>
                        deleteRow(d, { blockKey: selectedRow.blockKey, label: selectedRow.label }),
                      );
                      setRowSel(null);
                    },
                  )
                }
              />
            </RailGroup>
          )}

          {selectedBlock && (workspaceMode === "select" || workspaceMode === "labels") && (
            <RailGroup title="Thuộc tính khối" openWhen>
              <BlockInspector
                block={selectedBlock}
                mode={workspaceMode === "labels" ? "labels" : "all"}
                seatBudget={budget}
                onChange={(patch: Partial<DocumentBlock>) =>
                  selectedBlock && op((d) => updateBlock(d, selectedBlock.key, patch))
                }
                onParams={(patch: Partial<BlockParams>) =>
                  selectedBlock &&
                  // Shrinking frees row labels exactly as deleting a block does, so the same close-the-gap
                  // rule applies — otherwise 8 rows cut to 4 would leave the block after it starting at I.
                  op((d) => repack(setBlockParams(d, selectedBlock.key, patch)))
                }
                onRotate={(deg) => applyRotate(deg)}
                onGeometry={(geometry) =>
                  selectedBlock &&
                  op((d) =>
                    updateBlock(d, selectedBlock.key, {
                      geometry,
                      points: geometryPoints(geometry, selectedBlock),
                    }),
                  )
                }
              />
            </RailGroup>
          )}

          {/* Always open, unlike the groups around it. It used to collapse the moment a block was
              selected — reasonable when it only made blocks, wrong now that it also paints them, which
              is something you do TO a selection. */}
          {workspaceMode === "draw" && (
            <RailGroup title="Thêm vào sơ đồ" openWhen>
              <BlockPalette
                onAdd={(kind, geometry) => addAt(kind, geometry)}
                onDraw={() => {
                  setDrawing((cur) => (cur ? null : []));
                  setSelected(new Set());
                  setSeatSel(new Set());
                }}
                drawing={drawing !== null}
                color={paint.color}
                colorTarget={paint.targets}
                onColor={(color) => {
                  // Remembered either way, so the next block matches what was just painted.
                  setShapeColor(color);
                  if (paint.targets > 0) op((d) => setBlockColor(d, selected, color));
                }}
                disabled={busy}
                remaining={budget}
                sections={draft.sections}
                categories={draft.categories}
                pinned={lastUsed}
                resolved={nextBlockContext(draft, selected, lastUsed)}
                onPin={(patch) => setLastUsed((cur) => ({ ...cur, ...patch }))}
              />

              {/* Tables and standing areas keep their own endpoints: their seat geometry is computed on the
              server (a table's seats sit outside its edge, a standing area's fall inside a polygon), so
              there is no document equivalent to draw them from. */}

              <TablePalette
                sections={draft.sections.map((sec) => ({ id: sec.id, name: sec.name }))}
                tables={layout.tables}
                busy={busy}
                onAddTable={(t) =>
                  void serverOp(
                    () => layoutApi.addTable(layout.id, t as unknown as Record<string, unknown>),
                    `Đã thêm ${t.name}.`,
                  )
                }
                onAddStandingArea={(a) =>
                  void serverOp(
                    () =>
                      layoutApi.addStandingArea(layout.id, a as unknown as Record<string, unknown>),
                    `Đã tạo ${a.count} chỗ đứng.`,
                  )
                }
                // Hall outlines and dividers are blocks now, so this routes to the document rather than to
                // a separate element list.
                onAddElement={() => addAt("shape")}
              />
            </RailGroup>
          )}

          {workspaceMode === "sections" && (
            <RailGroup title="Khu vực" openWhen>
              <SectionPanel
                sections={draft.sections.map((s) => ({
                  id: s.id,
                  name: s.name,
                  floorId: s.floorId ?? null,
                }))}
                floors={draft.floors ?? []}
                onAddFloor={(name) =>
                  op((d) => {
                    // Refused rather than silently merged: two floors of one chart may not share a
                    // name (0044 has the unique index), and the buyer picks by name.
                    if ((d.floors ?? []).some((f) => f.name === name)) return d;
                    const floors = d.floors ?? [];
                    return {
                      ...d,
                      floors: [
                        ...floors,
                        {
                          // Negative, like every other id the editor mints before a save — the
                          // writer resolves it, and the section that names it resolves with it.
                          id: mintId(),
                          name,
                          // Appended at the top of the building: the order an organizer builds in is
                          // ground upward, and a new level is the one they just added above.
                          displayOrder: floors.length,
                        },
                      ],
                    };
                  })
                }
                onSetFloor={(sectionId, floorId) =>
                  op((d) => ({
                    ...d,
                    sections: d.sections.map((s) => (s.id === sectionId ? { ...s, floorId } : s)),
                  }))
                }
                seats={projected.seats}
                blocks={draft.blocks}
                activeSectionId={nextBlockContext(draft, selected, lastUsed).sectionId}
                onActivate={(id) => setLastUsed((current) => ({ ...current, sectionId: id }))}
                onAdd={(name) => commit((d) => addSection(d, name).doc)}
                onRename={(id, name) =>
                  op((d) => ({
                    ...d,
                    sections: d.sections.map((s) => (s.id === id ? { ...s, name } : s)),
                  }))
                }
                onRemove={(id) => {
                  const affected = draft.blocks.filter(
                    (block) =>
                      block.sectionId === id ||
                      block.seats?.some((seat) => resolvedSeatSectionId(seat, block) === id),
                  );
                  const seats = projected.seats.filter((seat) => seat.sectionId === id).length;
                  if (seats === 0 && affected.length === 0) {
                    op((d) => removeSection(d, id));
                    return;
                  }
                  ask(
                    {
                      title: "Xoá khu vực?",
                      message: `${affected.length} khối (${seats} ghế) sẽ không còn thuộc khu vực nào, và sơ đồ sẽ không phát hành được cho tới khi bạn gán lại.`,
                      confirmLabel: "Xoá khu vực",
                      cancelLabel: "Huỷ",
                      tone: "danger",
                    },
                    () => op((d) => removeSection(d, id)),
                  );
                }}
                onZoom={frameSection}
              />
            </RailGroup>
          )}

          {workspaceMode === "seatClasses" && (
            <RailGroup title="Hạng ghế" openWhen>
              <CategoryPanel
                categories={draft.categories}
                seats={projected.seats}
                // Seats the assign button acts on, not blocks selected — with `selected.size` a single
                // 50-seat block read "Gán 1 ghế" even though the click below assigns all 50.
                selectedCount={assignmentCount}
                selectedLabel={assignmentLabel}
                activeCategoryId={selectedBlock?.categoryId ?? null}
                tierLabels={tierLabels}
                onActivate={(id) => assignCategoryTo(id)}
                onAdd={(name) => commit((d) => addCategory(d, name).doc)}
                onRename={(id, name) => op((d) => updateCategory(d, id, { name }))}
                onRecolor={(id, color) => op((d) => updateCategory(d, id, { color }))}
                onRemove={(id) => {
                  const affected = draft.blocks.filter((b) => b.categoryId === id);
                  const seats = affected.reduce((n, b) => n + (b.seats?.length ?? 0), 0);
                  if (seats === 0 && affected.length === 0) {
                    op((d) => removeCategory(d, id));
                    return;
                  }
                  ask(
                    {
                      title: "Xoá hạng ghế?",
                      message: `${seats} ghế sẽ mất hạng ghế. Suất chiếu nào đang bán hạng này sẽ phải chọn lại hạng ghế trước khi bán.`,
                      confirmLabel: "Xoá hạng ghế",
                      cancelLabel: "Huỷ",
                      tone: "danger",
                    },
                    () => op((d) => removeCategory(d, id)),
                  );
                }}
                onAssign={(id) => assignCategoryTo(id)}
              />
            </RailGroup>
          )}

          {/* Never folded: an unresolved problem must not be something the organizer has to go and
              look for before pressing publish. */}
          {workspaceMode === "check" && (
            <ValidationPanel
              issues={issues}
              labelOfSeat={(id) => seatLabels.get(id) ?? null}
              onFocusSeat={focusSeat}
              // One undoable commit, through the same explicit command the selection panel offers — so the
              // automatic path and this one can never produce different lettering.
              onRenumberSection={(sectionId) => op((d) => renumberSection(d, sectionId))}
              // Through the same `addAt` the tool row and the palette use, so it lands in the middle of
              // what the organizer is looking at and is one Ctrl+Z away from being undone.
              onAddStage={() => addAt("stage")}
            />
          )}

          {/* Set up once per venue, then never touched again — folded by default. */}
          {workspaceMode === "settings" && (
            <OrientationPanel
              stages={stages}
              primaryKey={primaryStage?.key ?? null}
              onAdd={() => addAt("stage")}
              onFocus={(key) => {
                setSelected(new Set([key]));
                setSeatSel(new Set());
                setRowSel(null);
                frameBlocks([key]);
              }}
              onMakePrimary={(key) => commit((doc) => makeStagePrimary(doc, key))}
            />
          )}

          {workspaceMode === "settings" && (
            <RailGroup title="Ảnh nền & bản vẽ tham chiếu" openWhen>
              <div className="grid grid-cols-2 gap-1 border border-beige-kem/30 p-1">
                <button
                  type="button"
                  aria-pressed={calibrationLayer === "floorPlan"}
                  onClick={() => setCalibrationLayer("floorPlan")}
                  className={`px-2 py-1.5 font-mono text-[10px] font-bold ${
                    calibrationLayer === "floorPlan"
                      ? "bg-burgundy text-white"
                      : "text-beige-kem/70 hover:text-beige-kem"
                  }`}
                >
                  Ảnh cho người tham dự
                </button>
                <button
                  type="button"
                  aria-pressed={calibrationLayer === "reference"}
                  onClick={() => setCalibrationLayer("reference")}
                  className={`px-2 py-1.5 font-mono text-[10px] font-bold ${
                    calibrationLayer === "reference"
                      ? "bg-burgundy text-white"
                      : "text-beige-kem/70 hover:text-beige-kem"
                  }`}
                >
                  Ảnh tham chiếu
                </button>
              </div>
              {calibration.panel}
            </RailGroup>
          )}

          {/*
            How the chart SELLS, as opposed to what it holds. Grouped apart from the drawing tools
            for that reason, and saved on change rather than with the chart: it moves no seat, so it
            has no business making the layout a new draft.
          */}
          {workspaceMode === "settings" && (
            <RailGroup title="Quy tắc bán vé" openWhen>
              <div className="space-y-2 border-b border-beige-kem/20 p-3">
                {/*
                  The focal point (0043) — what "chọn giúp tôi" ranks outward from.
                  
                  Set from the SELECTION rather than by typing coordinates: an organizer knows the
                  pitch when they see it and does not know its coordinates. Clearing restores the
                  inference — the stage's centre, else the middle of the seating — which is what every
                  chart drawn before this does and what most charts should keep doing.
                */}
                <p className="font-meta text-meta text-beige-kem/70">
                  Gợi ý “ghế tốt nhất” tính khoảng cách từ đâu?
                </p>
                <p className="font-meta text-meta text-beige-kem/50">
                  {layout.focalPoint
                    ? `Điểm đã đặt: ${layout.focalPoint.x}, ${layout.focalPoint.y}`
                    : draft.blocks.some((b) => b.kind === "stage")
                      ? "Đang tính từ sân khấu."
                      : "Chưa có sân khấu — đang tính từ giữa khu ghế."}
                </p>
                <div className="flex flex-wrap gap-1">
                  <button
                    className={btn}
                    disabled={!selectedBlock}
                    title={
                      selectedBlock
                        ? "Đặt điểm tựa vào tâm khối đang chọn"
                        : "Chọn một khối trên sơ đồ trước — ví dụ sân hoặc sân khấu"
                    }
                    onClick={() => {
                      if (!selectedBlock) return;
                      const point = {
                        x: Math.round(selectedBlock.x),
                        y: Math.round(selectedBlock.y),
                      };
                      setLayout({ ...layout, focalPoint: point });
                      void layoutApi.setFocalPoint(layout.id, point).catch((e) => {
                        // Same rule the orphan-rule radio follows: put the control back where the
                        // server still has it rather than leaving a lie on screen.
                        setLayout({ ...layout });
                        setError((e as Error).message);
                      });
                    }}
                  >
                    Đặt tại khối đang chọn
                  </button>
                  <button
                    className={btn}
                    disabled={!layout.focalPoint}
                    title="Quay lại cách tính tự động"
                    onClick={() => {
                      setLayout({ ...layout, focalPoint: null });
                      void layoutApi.setFocalPoint(layout.id, null).catch((e) => {
                        setLayout({ ...layout });
                        setError((e as Error).message);
                      });
                    }}
                  >
                    Bỏ điểm tựa
                  </button>
                </div>
              </div>
              <div className="space-y-2 p-3">
                <p className="font-meta text-meta text-beige-kem/70">
                  Khi khách bấm “chọn giúp tôi”, có được để lại một ghế trống lẻ không?
                </p>
                {(
                  [
                    [
                      "balanced",
                      "Cân bằng",
                      "Không để ghế lẻ kẹt giữa hàng. Ghế lẻ sát lối đi hoặc cuối hàng thì được.",
                    ],
                    [
                      "strict",
                      "Nghiêm ngặt",
                      "Không để ghế lẻ ở bất kỳ đâu. Lấp đầy tốt hơn, nhưng từ chối nhiều lựa chọn hợp lý.",
                    ],
                  ] as const
                ).map(([value, label, hint]) => (
                  <label
                    key={value}
                    className="flex cursor-pointer gap-2 border border-beige-kem/25 p-2"
                  >
                    <input
                      type="radio"
                      name="orphan-rule"
                      checked={layout.orphanRule === value}
                      onChange={() => {
                        setLayout({ ...layout, orphanRule: value });
                        void layoutApi.setOrphanRule(layout.id, value).catch(() => {
                          // Put the control back where the server still has it: a radio that stays
                          // moved after a failed save is a lie about what the chart will do.
                          setLayout((prev) =>
                            prev ? { ...prev, orphanRule: layout.orphanRule } : prev,
                          );
                        });
                      }}
                      className="mt-0.5 accent-burgundy"
                    />
                    <span>
                      <span className="block text-eyebrow font-bold text-beige-kem">{label}</span>
                      <span className="block font-meta text-meta text-beige-kem/70">{hint}</span>
                    </span>
                  </label>
                ))}
                <p className="font-meta text-meta text-beige-kem/70">
                  Áp dụng cho các suất chiếu được tạo sơ đồ sau khi đổi.
                </p>
              </div>
            </RailGroup>
          )}
        </aside>
      </div>
      {previewing && (
        <PreviewOverlay
          seats={visibleSeats}
          // The preview has no index callbacks, so it takes the filtered list directly — its
          // behaviour is unchanged by the identity fix above.
          elements={canvasElements.filter((_, i) => !hiddenElementIndices.has(i))}
          blocks={blocks}
          floorPlan={
            layout.floorPlan.url && layout.floorPlan.visibleToBuyers
              ? { ...layout.floorPlan, url: layout.floorPlan.url }
              : null
          }
          floors={floors}
          colorOfSeat={colorOfSeat}
          onClose={() => setPreviewing(false)}
        />
      )}

      {/* First-open walkthrough (Phase 4) — mounted at the front so it paints above everything, and
          dismissed by setting the once-in-a-browser flag. */}
      {showCoachmarks && (
        <ChartEditorCoachmarks
          onDone={() => {
            setShowCoachmarks(false);
            try {
              window.localStorage.setItem("tixhub:coachmarks:chart-editor", "seen");
            } catch {
              /* storage unavailable — the walkthrough simply shows again next time */
            }
          }}
        />
      )}

      {/* The keyboard reference (§44) — a dialog, not a page, so the organizer never loses their
          canvas position while reading it. It mirrors the handler above; if one changes, change both. */}
      {showKeys && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setShowKeys(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-md overflow-y-auto border-2 border-beige-kem bg-surface-2 p-5 text-beige-kem"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">Phím tắt</h3>
              <button onClick={() => setShowKeys(false)} className={btn}>
                Đóng
              </button>
            </div>
            <dl className="mt-4 space-y-2 text-eyebrow">
              {(
                [
                  ["Ctrl/Cmd + Z", "Hoàn tác"],
                  ["Ctrl/Cmd + Shift + Z hoặc Ctrl/Cmd + Y", "Làm lại"],
                  ["Ctrl/Cmd + A", "Chọn tất cả các khối"],
                  ["Ctrl/Cmd + C", "Sao chép khối đang chọn"],
                  ["Ctrl/Cmd + V", "Dán khối đã sao chép"],
                  ["Ctrl/Cmd + D", "Nhân đôi khối đang chọn"],
                  ["Phím mũi tên", "Di chuyển khối đang chọn theo lưới"],
                  ["Shift + phím mũi tên", "Di chuyển nhanh hơn (bước ×4)"],
                  ["Delete / Backspace", "Xoá khối đang chọn"],
                  ["Escape", "Bỏ chọn / thoát công cụ / thoát khi đang vẽ"],
                  ["Enter (khi đang vẽ)", "Hoàn tất nét vẽ khu vực"],
                  ["Backspace (khi đang vẽ)", "Bỏ điểm vẽ cuối cùng"],
                ] as const
              ).map(([key, what]) => (
                <div key={key} className="flex items-baseline justify-between gap-3">
                  <dt>
                    <kbd className="rounded border border-beige-kem/50 bg-xanh-pho px-1.5 py-0.5 font-mono text-[11px]">
                      {key}
                    </kbd>
                  </dt>
                  <dd className="text-right text-eyebrow text-beige-kem/80">{what}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 font-meta text-meta text-beige-kem/70">
              Phím mũi tên không hoạt động khi con trỏ đang ở trong một ô nhập liệu.
            </p>
          </div>
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          {...confirm}
          onConfirm={() => {
            const run = confirm.onConfirm;
            setConfirm(null);
            run();
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
