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
} from "@/shared/catalog/seatmap-document";
import { emptyDocument, nextBlockKey } from "@/shared/catalog/seatmap-document";
import { projectDocument } from "@/shared/catalog/seatmap-project";
import {
  LAYOUT_SPACE,
  clampCoord,
  type ValidationIssue,
  blockingIssues,
  validateLayout,
} from "@/shared/catalog/seatmap-validate";
import type { Layout } from "@/shared/catalog/seatmap";
import ConfirmDialog, { type ConfirmRequest } from "../ConfirmDialog";
import { layoutApi } from "../../services/catalogClient";
import BlockInspector from "./BlockInspector";
import BlockPalette from "./BlockPalette";
import { editorHint } from "./editorHint";
import ChartEditorCoachmarks from "./ChartEditorCoachmarks";
import LayersPanel from "./LayersPanel";
import PreviewOverlay from "./PreviewOverlay";
import { renumberSection, renumberSelection } from "./numbering";
import RowInspector from "./RowInspector";
import { deleteRow, duplicateRow, renameRow, reverseRow } from "./rowOps";
import CategoryPanel from "./CategoryPanel";
import FloorPlanPanel from "./FloorPlanPanel";
import ReferenceChartPanel from "./ReferenceChartPanel";
import SeatCanvas, { type CanvasBlock, type CanvasSeat, type SeatCanvasHandle } from "./SeatCanvas";
import TablePalette from "./TablePalette";
import ValidationPanel from "./ValidationPanel";
import {
  addBlock,
  addCategory,
  BLOCK_DRAG_TYPE,
  addSection,
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
  pasteBlocks,
  nextShapeName,
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
  type SnapGuide,
  snapToObjects,
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
import { CATEGORY_COLORS, snap } from "./layoutOps";

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

/**
 * The contextual toolbar's controls stay PUT: one that does not apply to the current selection is
 * disabled, never unmounted.
 *
 * Unmounting reflows the row, and the row is a target the organizer is aiming at mid-gesture.
 * Shift-clicking a second block used to grow it by nine buttons — six align, two distribute, one
 * group — which slid Xoá sideways under a cursor already on its way there. Disabled also teaches:
 * "Dàn đều" greyed until a third block is selected says what it wants, where an absent button says
 * nothing. Khoá/⧉/Xoá already worked this way; this is the rest of the row agreeing with them.
 *
 * `dim` is the same treatment for a <label> wrapping a disabled <select>, which cannot inherit
 * :disabled from its child.
 */
const dim = (enabled: boolean) => (enabled ? "" : "cursor-not-allowed opacity-40");
const primary =
  " bg-burgundy px-3 py-1.5 text-xs font-black text-white transition hover:brightness-95 disabled:opacity-40";

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
    <details open={openWhen} className="border-2 border-beige-kem/40 bg-surface-2/40">
      <summary className="cursor-pointer select-none px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-widest text-beige-kem/70 marker:text-beige-kem/50">
        {title}
      </summary>
      <div className="space-y-3 p-2">{children}</div>
    </details>
  );
}

export default function ChartEditor({
  layoutId,
  onClose,
}: {
  layoutId: number;
  onClose: () => void;
}) {
  const [layout, setLayout] = useState<Layout | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /**
   * Individual seats, for the case a block is a default rather than a uniform group: a wheelchair place
   * in the middle of a row, two VIP seats at the front of an otherwise standard block.
   *
   * Mutually exclusive with the block selection, so the toolbar always has one unambiguous subject.
   * Held as canvas seat ids and resolved to document positions through `originOfSeat`, because a seat
   * that has never been saved has no database id to hold on to.
   */
  const [seatSel, setSeatSel] = useState<Set<number>>(new Set());
  const [grid, setGrid] = useState(true);
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
   * area. But on a dense chart they become visual noise that fights the seat grid for attention, so they
   * are a toggle the organizer can quieten rather than an always-on layer they cannot remove. Default
   * on: a brand-new chart has nothing to separate yet, and first impressions matter more than noise on
   * day one.
   */
  const [showHulls, setShowHulls] = useState(true);
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
  const repack = useCallback(
    (d: ChartDocument) => (autoRenumber ? repackRowLabels(d) : d),
    [autoRenumber],
  );
  const [confirm, setConfirm] = useState<(ConfirmRequest & { onConfirm: () => void }) | null>(null);
  const [dragDelta, setDragDelta] = useState<{ dx: number; dy: number } | null>(null);
  /** The lines a snapped drag is currently locked to, drawn while the pointer is down (§25). */
  const [guides, setGuides] = useState<SnapGuide[]>([]);
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

  const { draft, commit, reset, undo, redo, canUndo, canRedo } =
    useLayoutHistory<ChartDocument>(emptyDocument());

  useEffect(() => {
    layoutApi
      .get(layoutId)
      .then((l) => {
        setLayout(l);
        // The server always supplies a document — synthesised from the rows for a chart drawn before
        // documents existed — so there is no "no document yet" state to handle here.
        const doc = l.document ?? emptyDocument();
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

  const issues = useMemo<ValidationIssue[]>(
    () =>
      validateLayout({
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
        })),
        sections: projected.sections.map((s) => ({
          id: s.id as number,
          name: s.name,
          seatSizeMultiplier: s.seatSizeMultiplier,
        })),
        categories: projected.categories.map((c) => ({ id: c.id as number, name: c.name })),
        elements: projected.elements.map((e) => ({
          kind: e.kind,
          x: e.x,
          y: e.y,
          points: e.points,
          capacity: e.capacity,
          categoryId: e.categoryId,
        })),
      }),
    [projected],
  );

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

  const sectionName = useMemo(
    () => new Map(draft.sections.map((s) => [s.id, s.name])),
    [draft.sections],
  );

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

  /** Section hulls, drawn behind the seats — the canvas already knows how to title a group. */
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
  /** Keys the organizer has hidden. A VIEW filter — `projected` is untouched, so nothing stops selling. */
  const hiddenKeys = useMemo(
    () => new Set(draft.blocks.filter((b) => b.hidden).map((b) => b.key)),
    [draft.blocks],
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
      };
    });
  }, [projected.seats, dragDelta, selected, blockOfSeat, sectionName]);

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
            ? { ...el, x: el.x + dragDelta.dx, y: el.y + dragDelta.dy }
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
        .map((el, i) =>
          rotatePreview && blockOfElement[i] === rotatePreview.key
            ? { ...el, rotation: rotatePreview.angle }
            : el,
        ),
    [projected.elements, dragDelta, selected, blockOfElement, resizing, rotatePreview],
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

  const selectedBlock = useMemo(
    () => (selected.size === 1 ? (draft.blocks.find((b) => selected.has(b.key)) ?? null) : null),
    [selected, draft.blocks],
  );

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
        draft.sections.find((x) => x.id === (seats[0].sectionId ?? b.sectionId))?.name ?? null;
      if (name !== sectionName) continue;
      return {
        label,
        blockKey: b.key,
        sectionName: name,
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
            // Named like one placed from the palette — a drawn shape is a place on the map, and an
            // anonymous outline cannot be referred to in the validation list or told from its neighbour.
            label: nextShapeName(d),
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

  /** The seats the toolbar is speaking for: the selected seats, else every seat of the selected blocks. */
  const subjectSeats = useMemo(() => {
    if (seatSel.size > 0) {
      return projected.seats.filter((s, i) => seatSel.has(s.id ?? -(i + 1)));
    }
    return projected.seats.filter((s, i) => selected.has(blockOfSeat.get(s.id ?? -(i + 1)) ?? ""));
  }, [projected.seats, seatSel, selected, blockOfSeat]);

  const hasGroupedSelection = useMemo(
    () => [...selected].some((k) => draft.blocks.find((b) => b.key === k)?.groupId),
    [selected, draft.blocks],
  );

  /**
   * Assign to whatever is selected: the seats if seats are selected, else the blocks.
   *
   * Setting it on the block clears any per-seat override in that block as well, so the control means
   * what it says — otherwise assigning "VIP" to a block would leave individually-classed seats behind
   * and the toolbar would go on reporting a mix the organizer thought they had just resolved.
   */
  const assignTo = (patch: { sectionId?: number | null; categoryId?: number | null }) => {
    if (seatSel.size > 0) {
      op((d) => updateSeats(d, selectedSeatRefs, patch));
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
    assignTo({ sectionId: id });
    // Moving a block OUT of a section leaves the same hole in its lettering that deleting it would.
    op((d) => repack(d));
  };

  const assignCategoryTo = (id: number | null) => {
    setLastUsed((cur) => ({ ...cur, categoryId: id }));
    assignTo({ categoryId: id });
  };

  /** Mark or unmark the selected seats as accessible — a per-seat property by nature. */
  const setSeatsAccessible = (accessible: boolean) =>
    op((d) => updateSeats(d, selectedSeatRefs, { isAccessible: accessible }));

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

    const to = (ev: PointerEvent, phase: "move" | "end") => {
      const at = canvas.current?.toLayout(ev.clientX, ev.clientY);
      if (!at) return;
      // Shift snaps to 15°, so a deliberate right angle does not need a steady hand.
      const angle = angleFromPointer(block, at, ev.shiftKey ? 15 : 0);
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

  /**
   * One value if the subject agrees, "mixed" if it does not.
   *
   * Read off the SEATS rather than the block. A block is only a default — the projection resolves
   * `seat.categoryId ?? block.categoryId` — so reading the block would report "VIP" for a block whose
   * seats had been individually re-classed, and the control would then quietly not apply to them.
   */
  const sharedValue = (
    pick: (s: (typeof subjectSeats)[number]) => number | null,
  ): number | null | "mixed" => {
    if (subjectSeats.length === 0) return null;
    const first = pick(subjectSeats[0]);
    return subjectSeats.every((s) => pick(s) === first) ? first : "mixed";
  };

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
      return limit;
    }
    const landed = { x: anchor.x + limit.dx, y: anchor.y + limit.dy };
    const snapped = snapToObjects(draft, selected, landed, SNAP_DISTANCE);
    setGuides(snapped.guides);
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
    const inside = projected.seats
      .map((s, i) => ({ id: s.id ?? -(i + 1), x: s.x, y: s.y }))
      .filter((s) => s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY);

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
      const ctx = nextBlockContext(d, selected, lastUsed);
      // A shape is born coloured so it is visible the moment it lands; every other kind keeps the
      // theme's own ink until it is painted.
      const color = shapeColor ?? (kind === "shape" ? SHAPE_DEFAULT_COLOR : null);
      const made = addBlock(d, kind, at, { ...ctx, grid, geometry, color });
      // Only fills in what has NOT been pinned: overwriting a pin with the resolved value would turn
      // "tự động" into a fixed choice the moment one block was placed.
      setLastUsed((cur) => ({
        sectionId: cur.sectionId === undefined ? undefined : ctx.sectionId,
        categoryId: cur.categoryId === undefined ? undefined : ctx.categoryId,
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
  if (!layout) return <p className="p-6 font-mono text-xs text-beige-kem/60">Đang tải sơ đồ…</p>;

  const seats = seatCount(draft);

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
        <span className="font-mono text-[11px] text-beige-kem/50">
          {seats} ghế · {draft.blocks.length} khối · {draft.sections.length} khu ·{" "}
          {draft.categories.length} hạng ghế
        </span>
        {layout.status === "ready" ? (
          <span className="border border-la-co px-2 py-0.5 font-mono text-[10px] text-la-co">
            Đã phát hành
          </span>
        ) : (
          <span className="border border-beige-kem/40 px-2 py-0.5 font-mono text-[10px] text-beige-kem/60">
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
          className={`border px-2 py-0.5 font-mono text-[10px] ${
            busy
              ? "border-beige-kem/50 text-beige-kem/70"
              : !online
                ? "border-cam-dat text-cam-dat"
                : dirty
                  ? "border-cam-dat text-cam-dat"
                  : "border-la-co text-la-co"
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
          <span className="border border-bubblegum px-2 py-0.5 font-mono text-[10px] text-bubblegum">
            {blocking.length} vấn đề
          </span>
        ) : (
          <span className="border border-la-co px-2 py-0.5 font-mono text-[10px] text-la-co">
            Hợp lệ
          </span>
        )}
        {warningCount > 0 && (
          <span className="border border-cam-dat px-2 py-0.5 font-mono text-[10px] text-cam-dat">
            {warningCount} lưu ý
          </span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button onClick={undo} disabled={!canUndo} className={btn} title="Ctrl+Z">
            ↶
          </button>
          <button onClick={redo} disabled={!canRedo} className={btn} title="Ctrl+Shift+Z">
            ↷
          </button>
          <button
            onClick={() =>
              op((d) =>
                selected.size > 0
                  ? renumberSelection(d, selected)
                  : renumberSection(d, nextBlockContext(d, selected, lastUsed).sectionId),
              )
            }
            className={btn}
            title="Dồn lại chữ hàng cho khu đang chọn — thao tác rõ ràng, hoàn tác được"
          >
            Đánh lại số
          </button>
          <button onClick={() => canvas.current?.zoomToVenue()} className={btn}>
            Vừa khung
          </button>
          <button
            onClick={() => setShowHulls((h) => !h)}
            className={btn}
            title="Bật/tắt viền màu quanh các khu vực — lớp trợ giúp nhìn, không ảnh hưởng dữ liệu"
          >
            {showHulls ? "Ẩn viền khu" : "Hiện viền khu"}
          </button>
          <button
            onClick={() => setShowKeys(true)}
            className={btn}
            title="Bảng phím tắt của trình thiết kế"
          >
            Phím tắt
          </button>
          <button
            onClick={() => setPreviewing(true)}
            disabled={draft.blocks.length === 0}
            className={btn}
            title="Xem sơ đồ đúng như khách hàng sẽ thấy"
          >
            Xem trước
          </button>
          <button onClick={() => void save()} disabled={busy} className={btn}>
            Lưu
          </button>
          <button
            onClick={() => void publish()}
            disabled={busy || blocking.length > 0}
            className={primary}
            title={blocking.length > 0 ? "Sửa hết vấn đề trước khi phát hành" : "Phát hành sơ đồ"}
          >
            Phát hành
          </button>
          <button onClick={closeGuarded} className={btn}>
            Đóng
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
            <div className="border-2 border-beige-kem bg-la-co px-3 py-1.5 text-xs text-on-tint">
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
          <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-beige-kem/25 px-3 py-2">
            <span className="font-mono text-[11px] text-beige-kem/55">
              {seatSel.size > 0
                ? `${seatSel.size} ghế đang chọn`
                : selected.size === 0
                  ? "Bấm một khối để chọn · kéo nền để quét chọn · giữ Alt để chọn từng ghế"
                  : `${selected.size} khối đang chọn`}
            </span>
            {/*
              The contextual toolbar. Pinned above the canvas rather than floating beside the selection:
              a floating one has to be repositioned on every pan frame, which means re-rendering the
              editor at pointer speed — the opposite of the responsiveness this was meant to buy. Pinned
              costs nothing and still puts the two things an organizer reaches for most, the section and
              the price class, where they are already looking.
            */}
            {(selected.size > 0 || seatSel.size > 0) && (
              <>
                <span className="h-4 w-px bg-beige-kem/25" aria-hidden="true" />

                <label className="flex items-center gap-1 font-mono text-[11px] text-beige-kem/55">
                  Khu
                  <select
                    value={(() => {
                      const v = sharedValue((s) => s.sectionId ?? null);
                      return v === "mixed" ? "mixed" : v === null ? "" : String(v);
                    })()}
                    onChange={(e) =>
                      assignSectionTo(e.target.value === "" ? null : Number(e.target.value))
                    }
                    className="border-2 border-beige-kem/50 bg-transparent px-1.5 py-0.5 text-beige-kem"
                  >
                    {sharedValue((s) => s.sectionId ?? null) === "mixed" && (
                      <option value="mixed">— nhiều khu —</option>
                    )}
                    <option value="">Chưa thuộc khu</option>
                    {draft.sections.map((sec) => (
                      <option key={sec.id} value={sec.id}>
                        {sec.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex items-center gap-1 font-mono text-[11px] text-beige-kem/55">
                  Hạng ghế
                  <select
                    value={(() => {
                      const v = sharedValue((s) => s.categoryId ?? null);
                      return v === "mixed" ? "mixed" : v === null ? "" : String(v);
                    })()}
                    onChange={(e) =>
                      assignCategoryTo(e.target.value === "" ? null : Number(e.target.value))
                    }
                    className="border-2 border-beige-kem/50 bg-transparent px-1.5 py-0.5 text-beige-kem"
                  >
                    {sharedValue((s) => s.categoryId ?? null) === "mixed" && (
                      <option value="mixed">— nhiều hạng ghế —</option>
                    )}
                    <option value="">Chưa có hạng ghế</option>
                    {draft.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label
                  className={`flex items-center gap-1 font-mono text-[11px] text-beige-kem/55 ${dim(
                    seatSel.size > 0,
                  )}`}
                  title="Chọn từng ghế (giữ Alt) để đổi loại ghế"
                >
                  Loại ghế
                  <select
                    disabled={seatSel.size === 0}
                    value={(() => {
                      const types = new Set(subjectSeats.map((s) => s.seatType ?? "single"));
                      return types.size === 1 ? [...types][0] : "mixed";
                    })()}
                    onChange={(e) => setSeatsType(e.target.value as EditableSeatType)}
                    className="border-2 border-beige-kem/50 bg-transparent px-1.5 py-0.5 text-beige-kem disabled:cursor-not-allowed"
                  >
                    {new Set(subjectSeats.map((s) => s.seatType ?? "single")).size > 1 && (
                      <option value="mixed">— nhiều loại —</option>
                    )}
                    {EDITABLE_SEAT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t === "single" ? "Ghế đơn" : "Ghế đôi"}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  onClick={() => setSeatsAccessible(!subjectSeats.every((s) => s.isAccessible))}
                  className={btn}
                  disabled={seatSel.size === 0}
                  title="Chọn từng ghế (giữ Alt) để đánh dấu ghế dành cho xe lăn"
                >
                  Xe lăn
                  {seatSel.size > 0 && subjectSeats.every((s) => s.isAccessible) ? " · bật" : ""}
                </button>

                <button
                  onClick={() => {
                    const anyOpen = draft.blocks.some(
                      (b) => selected.has(b.key) && b.locked !== true,
                    );
                    op((d) => setLocked(d, selected, anyOpen));
                  }}
                  className={btn}
                  disabled={selected.size === 0}
                  title="Khoá khối đã chọn để không kéo nhầm"
                >
                  {draft.blocks.some((b) => selected.has(b.key) && b.locked !== true)
                    ? "Khoá"
                    : "Mở khoá"}
                </button>

                <button
                  onClick={() =>
                    op((d) => {
                      const dup = duplicateBlocks(d, selected, 300, 300);
                      setSelected(dup.keys);
                      return dup.doc;
                    })
                  }
                  className={btn}
                  disabled={selected.size === 0}
                  title="Nhân đôi (Ctrl+D)"
                >
                  ⧉
                </button>

                <button
                  onClick={applyDelete}
                  className={btn}
                  disabled={selected.size === 0}
                  title="Xoá (Delete)"
                >
                  Xoá
                </button>

                {(["left", "centerX", "right", "top", "centerY", "bottom"] as const).map(
                  (edge) => (
                    <button
                      key={edge}
                      className={btn}
                      disabled={selected.size < 2}
                      onClick={() => applyAlign(edge)}
                      title={
                        {
                          left: "Canh trái",
                          centerX: "Canh giữa ngang",
                          right: "Canh phải",
                          top: "Canh trên",
                          centerY: "Canh giữa dọc",
                          bottom: "Canh dưới",
                        }[edge] + " — cần từ 2 khối"
                      }
                    >
                      {
                        {
                          left: "⇤",
                          centerX: "↔",
                          right: "⇥",
                          top: "⇧",
                          centerY: "↕",
                          bottom: "⇩",
                        }[edge]
                      }
                    </button>
                  ),
                )}

                {/* Distribute (§26). Needs three: two blocks have no gap between them to even out. */}
                {(["horizontal", "vertical"] as const).map((axis) => (
                  <button
                    key={axis}
                    className={btn}
                    disabled={selected.size < 3}
                    onClick={() => op((d) => distributeBlocks(d, selected, axis))}
                    title={
                      axis === "horizontal"
                        ? "Dàn đều theo chiều ngang — cần từ 3 khối"
                        : "Dàn đều theo chiều dọc — cần từ 3 khối"
                    }
                  >
                    {axis === "horizontal" ? "⇹" : "⇳"}
                  </button>
                ))}

                <button
                  className={btn}
                  disabled={selected.size < 2}
                  onClick={() => op((d) => groupBlocks(d, selected))}
                  title="Nhóm các khối đang chọn — chọn một khối sẽ chọn cả nhóm. Cần từ 2 khối"
                >
                  Nhóm
                </button>
                <button
                  className={btn}
                  disabled={!hasGroupedSelection}
                  onClick={() => op((d) => ungroupBlocks(d, selected))}
                  title="Bỏ nhóm — cần chọn một khối đang thuộc nhóm"
                >
                  Bỏ nhóm
                </button>

                {/* Flip (§7). A mirror of the geometry — labels are untouched, by design. */}
                {(["horizontal", "vertical"] as const).map((axis) => (
                  <button
                    key={`flip-${axis}`}
                    className={btn}
                    disabled={selected.size === 0}
                    onClick={() => op((d) => flipBlocks(d, selected, axis))}
                    title={
                      axis === "horizontal"
                        ? "Lật ngang — ghế đổi chỗ, nhãn giữ nguyên"
                        : "Lật dọc — ghế đổi chỗ, nhãn giữ nguyên"
                    }
                  >
                    {axis === "horizontal" ? "⇋" : "⇅"}
                  </button>
                ))}
              </>
            )}
          </div>

          {/*
            The tool row (§4). Select first, then the kinds an organizer reaches for by name, then the
            two drawing modes. Deliberately NOT every block kind — the palette holds all nineteen, and
            a toolbar that lists them is a palette in the wrong place.
          */}
          <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-beige-kem/25 px-3 py-1">
            <button
              onClick={() => {
                setTool(null);
                setDrawing(null);
              }}
              aria-pressed={tool === null && !drawing}
              className={tool === null && !drawing ? primary : btn}
              title="Chọn và di chuyển (Esc)"
            >
              ⌖ Chọn
            </button>
            {(
              [
                ["seating-block", "▦", "Khối ghế"],
                ["single-row", "▭", "Hàng ghế"],
                ["ga-zone", "▩", "Khu đứng"],
                ["stage", "▬", "Sân khấu"],
                ["text", "T", "Ghi chú"],
                ["shape", "⬡", "Hình khối"],
              ] as const
            ).map(([kind, glyph, label]) => (
              <button
                key={kind}
                onClick={() => {
                  setTool(kind);
                  setDrawing(null);
                }}
                aria-pressed={tool === kind}
                className={tool === kind ? primary : btn}
                title={`${label} — bấm lên sơ đồ để đặt`}
              >
                {glyph} {label}
              </button>
            ))}
            <button
              onClick={() => {
                setTool(null);
                setDrawing((cur) => (cur ? null : []));
                setSelected(new Set());
                setSeatSel(new Set());
              }}
              aria-pressed={drawing !== null}
              className={drawing ? primary : btn}
              title="Vẽ hình tự do: bấm từng điểm, bấm lại điểm đầu để khép hình"
            >
              Vẽ tự do
            </button>
            {/* No inline hint here: the status line at the bottom of the canvas now names the tool
                in hand and says the same thing, and printing it twice made the tool row's width
                change as soon as a tool was picked. */}
          </div>

          {/*
            Drop target for the palette. Deliberately HTML5 drag-and-drop rather than the canvas's own
            pointer gestures: those already carry pan, marquee and block dragging, and threading a
            fourth meaning through them is how the seat tap got swallowed. Drag events are a separate
            channel, so nothing existing has to change to make room for this.
          */}
          <div
            className={`relative min-h-0 flex-1 `}
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
                  <p className="mt-2 text-[11px] leading-5 text-beige-kem/60">
                    Tạo khối ghế đầu tiên, hoặc bắt đầu từ một mẫu có sẵn trong thư viện sơ đồ.
                  </p>
                  <div className="mt-3 flex justify-center gap-2">
                    <button onClick={() => addAt("seating-block")} className={primary}>
                      Tạo khối ghế
                    </button>
                    <button onClick={closeGuarded} className={btn}>
                      Xem mẫu
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
              // Drawn under the seats: a guide is a hint about where a block is going, and it must
              // never sit over the thing it is guiding.
              underlay={
                guides.length > 0 ? (
                  <g pointerEvents="none">
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
              onVertexDrag={(elementIndex, vertex, x, y) => {
                const key = blockOfElement[elementIndex];
                if (!key) return;
                op((d) => {
                  const block = d.blocks.find((b) => b.key === key);
                  if (!block?.points) return d;
                  const points = block.points.map((p, i) =>
                    i === vertex ? { x: clampCoord(x), y: clampCoord(y) } : p,
                  );
                  return updateBlock(d, key, { points, geometry: null });
                });
              }}
              floorPlan={
                layout.referenceChart.url
                  ? { ...layout.referenceChart, url: layout.referenceChart.url }
                  : layout.floorPlan.url
                    ? { ...layout.floorPlan, url: layout.floorPlan.url }
                    : null
              }
              blocks={blocks}
              seatBlockId={(s) => {
                const key = blockOfSeat.get(s.id);
                const block = key ? draft.blocks.find((b) => b.key === key) : undefined;
                return block?.sectionId ?? null;
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
                `${s.section ? `${s.section}, ` : ""}hàng ${s.row}, ghế ${s.number}`
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
                    const reach = selectedBlock.height / 2 + 400;
                    const a = ((selectedBlock.rotation - 90) * Math.PI) / 180;
                    const hx = selectedBlock.x + Math.cos(a) * reach;
                    const hy = selectedBlock.y + Math.sin(a) * reach;
                    return (
                      <g>
                        <line
                          x1={selectedBlock.x}
                          y1={selectedBlock.y}
                          x2={hx}
                          y2={hy}
                          className="stroke-burgundy"
                          strokeWidth={8}
                          pointerEvents="none"
                        />
                        <circle
                          cx={hx}
                          cy={hy}
                          r={110}
                          className="fill-burgundy stroke-beige-kem"
                          strokeWidth={8}
                          style={{ cursor: "grab" }}
                          role="button"
                          aria-label={`Xoay ${selectedBlock.title}`}
                          onPointerDown={(e) => beginRotate(selectedBlock, e)}
                        />
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

          {/* §3's bottom bar: what the view is doing, and what is selected. Reads left-to-right from
              the map's own state to the organizer's — zoom and pointer first, then the selection. */}
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-beige-kem/20 px-3 py-1 font-mono text-[10px] text-beige-kem/55">
            <span title="Mức phóng to">{Math.round(viewReport.zoom * 100)}%</span>
            <span className="tabular-nums" title="Toạ độ con trỏ trên sơ đồ">
              {viewReport.x === null ? "—, —" : `${viewReport.x}, ${viewReport.y}`}
            </span>
            {/*
              The view toggles live HERE, not in the header (§3).

              They are state the map is IN, not actions performed on it — and keeping them in the
              header was what pushed that wrapping row onto a second line and over the canvas. Each
              one reads as its state and toggles on click, so the bar says what is true and is also
              where it is changed.
            */}
            <button
              onClick={() => setGrid((g) => !g)}
              aria-pressed={grid}
              className={`transition hover:text-beige-kem ${grid ? "text-beige-kem" : ""}`}
              title="Bám lưới khi kéo — chỉ hỗ trợ nhập, không ảnh hưởng dữ liệu đã lưu"
            >
              Lưới {grid ? "bật" : "tắt"}
            </button>
            <button
              onClick={() => setSnapObjects((v) => !v)}
              aria-pressed={snapObjects}
              className={`transition hover:text-beige-kem ${snapObjects ? "text-beige-kem" : ""}`}
              title="Bám theo tâm của khối khác khi kéo — canh thẳng hàng mà không cần phóng to"
            >
              Bám khối {snapObjects ? "bật" : "tắt"}
            </button>
            <button
              onClick={() =>
                setAutoRenumber((cur) => {
                  const next = !cur;
                  try {
                    window.localStorage.setItem("tixhub.autoRenumber", next ? "on" : "off");
                  } catch {
                    // Storage refused; the choice still applies for this session.
                  }
                  return next;
                })
              }
              aria-pressed={autoRenumber}
              className={`transition hover:text-beige-kem ${autoRenumber ? "text-beige-kem" : ""}`}
              title={
                autoRenumber
                  ? "Xoá hoặc thu nhỏ khối sẽ đánh lại chữ hàng cho liền mạch. Tắt để giữ nguyên nhãn."
                  : "Nhãn hàng giữ nguyên khi xoá. Dùng nút “Đánh lại số” khi muốn dồn lại."
              }
            >
              Tự đánh số {autoRenumber ? "bật" : "tắt"}
            </button>
            <span className="ml-auto">
              {seatSel.size > 0
                ? `${seatSel.size} ghế`
                : rowSel
                  ? `hàng ${rowSel.split("|")[1]}`
                  : selected.size > 0
                    ? `${selected.size} khối`
                    : "chưa chọn gì"}
            </span>
            <span title="Tổng số ghế của sơ đồ">{seatCount(draft)} ghế</span>
          </div>

          <p className="shrink-0 px-3 pb-2 font-mono text-[11px] leading-4 text-beige-kem/45">
            {editorHint({
              drawingPoints: drawing ? drawing.length : null,
              tool,
              seatCount: seatSel.size,
              rowLabel: rowSel ? (rowSel.split("|")[1] ?? null) : null,
              blockCount: selected.size,
            })}
          </p>
        </main>

        <aside className="w-80 shrink-0 space-y-2 overflow-y-auto border-l-2 border-beige-kem p-3">
          {/* Ordered by how often it is reached for, not by the order the features were built. The
              inspector leads whenever something is selected, because that is the moment the organizer
              is asking "what is this and how do I change it". */}
          <RailGroup title="Cấu trúc & tìm kiếm" openWhen={!selectedBlock && !selectedRow}>
            <LayersPanel
              doc={draft}
              selected={selected}
              selectedRowKey={rowSel}
              onSelectBlock={(key, additive) => {
                setSelected((cur) => selectionAfterPress(cur, key, additive));
                setRowSel(null);
                setSeatSel(new Set());
                canvas.current?.zoomToBlock(key);
              }}
              onSelectRow={(sectionName, label) => {
                setRowSel(`${sectionName ?? ""}|${label}`);
                setSelected(new Set());
                setSeatSel(new Set());
              }}
              onToggleLock={(key, locked) => op((d) => setLocked(d, new Set([key]), locked))}
              onToggleHidden={(key, hidden) => op((d) => setHidden(d, new Set([key]), hidden))}
            />
          </RailGroup>

          {selectedRow && (
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

          {selectedBlock && (
            <RailGroup title="Thuộc tính khối" openWhen>
              <BlockInspector
                block={selectedBlock}
                sections={draft.sections}
                categories={draft.categories}
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
                onDuplicate={() =>
                  commit((d) => {
                    const dup = duplicateBlocks(d, selected, 300, 300);
                    setSelected(dup.keys);
                    return dup.doc;
                  })
                }
                // Through the same path as the keyboard, so the inspector button cannot be the one route
                // that skips the confirmation and the table endpoint.
                onDelete={applyDelete}
              />
            </RailGroup>
          )}

          {/* Always open, unlike the groups around it. It used to collapse the moment a block was
              selected — reasonable when it only made blocks, wrong now that it also paints them, which
              is something you do TO a selection. */}
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

          <RailGroup title="Khu vực & hạng ghế" openWhen={!!selectedBlock}>
            <SectionPanel
              sections={draft.sections.map((s) => ({ id: s.id, name: s.name }))}
              seats={projected.seats}
              selectedCount={selected.size}
              activeSectionId={selectedBlock?.sectionId ?? null}
              onActivate={(id) => assignSectionTo(id)}
              onAdd={(name) => commit((d) => addSection(d, name).doc)}
              onRename={(id, name) =>
                op((d) => ({
                  ...d,
                  sections: d.sections.map((s) => (s.id === id ? { ...s, name } : s)),
                }))
              }
              onRemove={(id) => {
                const affected = draft.blocks.filter((b) => b.sectionId === id);
                const seats = affected.reduce((n, b) => n + (b.seats?.length ?? 0), 0);
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
              onAssign={(id) => assignSectionTo(id)}
              onZoom={(id) => {
                const box = selectionBounds(
                  draft,
                  new Set(draft.blocks.filter((b) => b.sectionId === id).map((b) => b.key)),
                );
                if (box) canvas.current?.zoomToBlock(id);
              }}
            />

            <CategoryPanel
              categories={draft.categories}
              seats={projected.seats}
              selectedCount={selected.size}
              activeCategoryId={selectedBlock?.categoryId ?? null}
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

          {/* Never folded: an unresolved problem must not be something the organizer has to go and
              look for before pressing publish. */}
          <ValidationPanel
            issues={issues}
            labelOfSeat={(id) => seatLabels.get(id) ?? null}
            onFocusSeat={focusSeat}
            // One undoable commit, through the same explicit command the toolbar offers — so the
            // automatic path and this one can never produce different lettering.
            onRenumberSection={(sectionId) => op((d) => renumberSection(d, sectionId))}
            // Through the same `addAt` the tool row and the palette use, so it lands in the middle of
            // what the organizer is looking at and is one Ctrl+Z away from being undone.
            onAddStage={() => addAt("stage")}
          />

          {/* Set up once per venue, then never touched again — folded by default. */}
          <RailGroup title="Ảnh nền & bản vẽ tham chiếu">
            <FloorPlanPanel
              layoutId={layout.id}
              plan={layout.floorPlan}
              onChange={(fp) => setLayout({ ...layout, floorPlan: fp })}
            />

            <ReferenceChartPanel
              layoutId={layout.id}
              reference={layout.referenceChart}
              onChange={(rc) => setLayout({ ...layout, referenceChart: rc })}
            />
          </RailGroup>

          {/*
            How the chart SELLS, as opposed to what it holds. Grouped apart from the drawing tools
            for that reason, and saved on change rather than with the chart: it moves no seat, so it
            has no business making the layout a new draft.
          */}
          <RailGroup title="Quy tắc bán vé">
            <div className="space-y-2 p-3">
              <p className="font-meta text-meta text-beige-kem/70">
                Khi khách bấm “chọn giúp tôi”, có được để lại một ghế trống lẻ không?
              </p>
              {(
                [
                  ["balanced", "Cân bằng", "Không để ghế lẻ kẹt giữa hàng. Ghế lẻ sát lối đi hoặc cuối hàng thì được."],
                  ["strict", "Nghiêm ngặt", "Không để ghế lẻ ở bất kỳ đâu. Lấp đầy tốt hơn, nhưng từ chối nhiều lựa chọn hợp lý."],
                ] as const
              ).map(([value, label, hint]) => (
                <label key={value} className="flex cursor-pointer gap-2 border border-beige-kem/25 p-2">
                  <input
                    type="radio"
                    name="orphan-rule"
                    checked={layout.orphanRule === value}
                    onChange={() => {
                      setLayout({ ...layout, orphanRule: value });
                      void layoutApi.setOrphanRule(layout.id, value).catch(() => {
                        // Put the control back where the server still has it: a radio that stays
                        // moved after a failed save is a lie about what the chart will do.
                        setLayout((prev) => (prev ? { ...prev, orphanRule: layout.orphanRule } : prev));
                      });
                    }}
                    className="mt-0.5 accent-burgundy"
                  />
                  <span>
                    <span className="block text-eyebrow font-bold text-beige-kem">{label}</span>
                    <span className="block font-meta text-meta text-beige-kem/60">{hint}</span>
                  </span>
                </label>
              ))}
              <p className="font-meta text-meta text-beige-kem/45">
                Áp dụng cho các suất chiếu được tạo sơ đồ sau khi đổi.
              </p>
            </div>
          </RailGroup>
        </aside>
      </div>
      {previewing && (
        <PreviewOverlay
          seats={visibleSeats}
          // The preview has no index callbacks, so it takes the filtered list directly — its
          // behaviour is unchanged by the identity fix above.
          elements={canvasElements.filter((_, i) => !hiddenElementIndices.has(i))}
          blocks={blocks}
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
            <p className="mt-4 font-meta text-meta text-beige-kem/55">
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
