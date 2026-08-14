/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BlockKind, BlockParams, ChartDocument, DocumentBlock } from "@/shared/catalog/seatmap-document";
import { emptyDocument, nextBlockKey } from "@/shared/catalog/seatmap-document";
import { projectDocument } from "@/shared/catalog/seatmap-project";
import { clampCoord, type ValidationIssue, validateLayout } from "@/shared/catalog/seatmap-validate";
import type { Layout } from "@/shared/catalog/seatmap";
import ConfirmDialog, { type ConfirmRequest } from "../ConfirmDialog";
import { layoutApi } from "../../services/catalogClient";
import BlockInspector from "./BlockInspector";
import BlockPalette from "./BlockPalette";
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
  alignedPosition,
  allowedDelta,
  colorable,
  duplicateBlocks,
  EDITABLE_SEAT_TYPES,
  type EditableSeatType,
  geometryPoints,
  moveBlocks,
  movedPosition,
  nextBlockContext,
  nextShapeName,
  parseBlockDrag,
  NUDGE,
  remainingBudget,
  removeBlocks,
  removeCategory,
  repackRowLabels,
  removeSection,
  rotateBlocks,
  type SeatRef,
  seatCount,
  selectionAfterPress,
  selectionBounds,
  setBlockColor,
  setSeatType,
  setBlockParams,
  setLocked,
  updateBlock,
  updateCategory,
  updateSeats,
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
  "rounded-lg border-2 border-beige-kem px-2.5 py-1.5 text-xs font-bold text-beige-kem/80 transition hover:text-beige-kem disabled:opacity-40";
const primary =
  "rounded-lg bg-burgundy px-3 py-1.5 text-xs font-black text-white transition hover:brightness-95 disabled:opacity-40";

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
 * One collapsible group in the right rail.
 *
 * The rail carried eight panels in a single scrolling column, none of them foldable, with the
 * inspector — the one an organizer touches most — sitting third behind two palettes. Folding the
 * set-up-once tools away puts the working panels within reach without hiding anything.
 */
function RailGroup({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="rounded-2xl border-2 border-beige-kem/40 bg-surface-2/40">
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
  const [confirm, setConfirm] = useState<(ConfirmRequest & { onConfirm: () => void }) | null>(null);
  const [dragDelta, setDragDelta] = useState<{ dx: number; dy: number } | null>(null);

  const { draft, commit, reset, undo, redo, canUndo, canRedo } = useLayoutHistory<ChartDocument>(
    emptyDocument(),
  );

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
      } catch {
        /* best-effort: a full or disabled store must not break editing */
      }
    }, RECOVERY_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [draft, dirty, layout]);

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
      draft.sections.map((s) => ({
        id: s.id,
        name: s.name,
        // Stable per section id, so a hull keeps its colour as sections are added and removed. It is an
        // IDENTITY colour, never a price: a section may hold several classes, and the seats carry those.
        color: CATEGORY_COLORS[Math.abs(s.id) % CATEGORY_COLORS.length],
      })),
    [draft.sections],
  );

  /**
   * Seats for the canvas, with a live drag applied HERE rather than committed — so dragging a block of
   * 200 seats is one undo step at the end, not one per animation frame.
   */
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

  /** Decoration, with the dragged block offset live — same one-commit-at-the-end rule as seats. */
  const canvasElements = useMemo(
    () =>
      projected.elements.map((el, i) =>
        dragDelta && selected.has(blockOfElement[i] ?? "")
          ? { ...el, x: el.x + dragDelta.dx, y: el.y + dragDelta.dy }
          : el,
      ),
    [projected.elements, dragDelta, selected, blockOfElement],
  );

  const selectedBlock = useMemo(
    () => (selected.size === 1 ? (draft.blocks.find((b) => selected.has(b.key)) ?? null) : null),
    [selected, draft.blocks],
  );

  const budget = remainingBudget(draft);

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
  const persist = async (doc: ChartDocument): Promise<boolean> => {
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
      reset(back);
      setSelected(new Set());
      setStatus("Đã lưu bản nháp.");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = () => void persist(draft);

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
            : " Ghế đã bán ở suất chiếu đang bán sẽ khiến thao tác bị từ chối khi lưu."),
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
    const next = others.size > 0 ? repackRowLabels(removeBlocks(draft, others)) : draft;
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
      () => Promise.all(tables.map((t) => layoutApi.updateTable(t.tableId, alignedPosition(box, t, edge)))),
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
    () => [...seatSel].map((id) => originOfSeat.get(id)).filter((r): r is SeatRef => r !== undefined),
    [seatSel, originOfSeat],
  );

  /** The seats the toolbar is speaking for: the selected seats, else every seat of the selected blocks. */
  const subjectSeats = useMemo(() => {
    if (seatSel.size > 0) {
      return projected.seats.filter((s, i) => seatSel.has(s.id ?? -(i + 1)));
    }
    return projected.seats.filter((s, i) => selected.has(blockOfSeat.get(s.id ?? -(i + 1)) ?? ""));
  }, [projected.seats, seatSel, selected, blockOfSeat]);

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
    op((d) => repackRowLabels(d));
  };

  const assignCategoryTo = (id: number | null) => {
    setLastUsed((cur) => ({ ...cur, categoryId: id }));
    assignTo({ categoryId: id });
  };

  /** Mark or unmark the selected seats as accessible — a per-seat property by nature. */
  const setSeatsAccessible = (accessible: boolean) =>
    op((d) => updateSeats(d, selectedSeatRefs, { isAccessible: accessible }));

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
  const sharedValue = (pick: (s: (typeof subjectSeats)[number]) => number | null): number | null | "mixed" => {
    if (subjectSeats.length === 0) return null;
    const first = pick(subjectSeats[0]);
    return subjectSeats.every((s) => pick(s) === first) ? first : "mixed";
  };

  /** Shared by seats and decoration, so the two cannot drift apart. The rule itself is pure and lives
   *  in `documentOps`, where it can be tested — this canvas has no harness. */
  const selectOnPress = (key: string, additive: boolean) =>
    setSelected((cur) => selectionAfterPress(cur, key, additive));

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

  const onSeatDrag = (dx: number, dy: number, phase: "move" | "end") => {
    if (!dragging.current || selected.size === 0) return;
    if (phase === "move") {
      // Previewed through the SAME limit the commit applies, or the block appears to slide past the
      // edge of the map and then jumps back when the pointer is released.
      setDragDelta(allowedDelta(draft, selected, dx, dy));
      return;
    }
    setDragDelta(null);
    dragging.current = false;
    applyMove(dx, dy);
  };

  /** Dragging decoration moves its block, exactly as dragging a seat moves the block it belongs to. */
  const onElementDrag = (dx: number, dy: number, phase: "move" | "end") => {
    if (!draggingElement.current || selected.size === 0) return;
    if (phase === "move") {
      setDragDelta(allowedDelta(draft, selected, dx, dy));
      return;
    }
    setDragDelta(null);
    draggingElement.current = false;
    applyMove(dx, dy);
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
    const at =
      (dropAt
        ? canvas.current?.toLayout(dropAt.clientX, dropAt.clientY)
        : canvas.current?.toLayout(window.innerWidth / 2, window.innerHeight / 2)) ?? { x: 5000, y: 5000 };
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
  }, [draft.blocks, selected, grid, layout, drawing, op, commit, undo, redo]);


  if (error && !layout) return <p className="p-6 text-sm text-on-tint">{error}</p>;
  if (!layout) return <p className="p-6 font-mono text-xs text-beige-kem/60">Đang tải sơ đồ…</p>;

  const seats = seatCount(draft);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-xanh-pho text-beige-kem">
      <header className="flex h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b-2 border-beige-kem px-4">
        <h2 className="font-display text-lg font-black">{layout.name}</h2>
        <span className="font-mono text-[11px] text-beige-kem/50">
          {seats} ghế · {draft.blocks.length} khối · {draft.sections.length} khu ·{" "}
          {draft.categories.length} hạng ghế
        </span>
        {layout.status === "ready" ? (
          <span className="rounded-lg border border-la-co px-2 py-0.5 font-mono text-[10px] text-la-co">
            Đã phát hành
          </span>
        ) : (
          <span className="rounded-lg border border-beige-kem/40 px-2 py-0.5 font-mono text-[10px] text-beige-kem/60">
            Bản nháp
          </span>
        )}
        {dirty && (
          <span
            className="rounded-lg border border-cam-dat px-2 py-0.5 font-mono text-[10px] text-cam-dat"
            title="Thay đổi chưa lưu — bản nháp được giữ trên máy này"
          >
            Chưa lưu
          </span>
        )}
        {issues.length > 0 ? (
          <span className="rounded-lg border border-bubblegum px-2 py-0.5 font-mono text-[10px] text-bubblegum">
            {issues.length} vấn đề
          </span>
        ) : (
          <span className="rounded-lg border border-la-co px-2 py-0.5 font-mono text-[10px] text-la-co">
            Hợp lệ
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
            onClick={() => setGrid((g) => !g)}
            className={btn}
            title="Bám lưới khi kéo — chỉ hỗ trợ nhập, không ảnh hưởng dữ liệu đã lưu"
          >
            {grid ? "Lưới ✓" : "Lưới"}
          </button>
          <button onClick={() => canvas.current?.zoomToVenue()} className={btn}>
            Vừa khung
          </button>
          <button onClick={() => void save()} disabled={busy} className={btn}>
            Lưu
          </button>
          <button
            onClick={() => void publish()}
            disabled={busy || issues.length > 0}
            className={primary}
            title={issues.length > 0 ? "Sửa hết vấn đề trước khi phát hành" : "Phát hành sơ đồ"}
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
            <div className="rounded-lg border-2 border-beige-kem bg-la-co px-3 py-1.5 text-xs text-on-tint">
              {status}
            </div>
          )}
          {error && (
            <div className="rounded-lg border-2 border-beige-kem bg-bubblegum px-3 py-1.5 text-xs text-on-tint">
              {error}
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
                    onChange={(e) => assignSectionTo(e.target.value === "" ? null : Number(e.target.value))}
                    className="rounded-lg border-2 border-beige-kem/50 bg-transparent px-1.5 py-0.5 text-beige-kem"
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
                    onChange={(e) => assignCategoryTo(e.target.value === "" ? null : Number(e.target.value))}
                    className="rounded-lg border-2 border-beige-kem/50 bg-transparent px-1.5 py-0.5 text-beige-kem"
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

                {seatSel.size > 0 && (
                  <label className="flex items-center gap-1 font-mono text-[11px] text-beige-kem/55">
                    Loại ghế
                    <select
                      value={(() => {
                        const types = new Set(subjectSeats.map((s) => s.seatType ?? "single"));
                        return types.size === 1 ? [...types][0] : "mixed";
                      })()}
                      onChange={(e) => setSeatsType(e.target.value as EditableSeatType)}
                      className="rounded-lg border-2 border-beige-kem/50 bg-transparent px-1.5 py-0.5 text-beige-kem"
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
                )}

                {seatSel.size > 0 && (
                  <button
                    onClick={() => setSeatsAccessible(!subjectSeats.every((s) => s.isAccessible))}
                    className={btn}
                    title="Đánh dấu ghế dành cho xe lăn"
                  >
                    ♿ {subjectSeats.every((s) => s.isAccessible) ? "✓" : ""}
                  </button>
                )}

                <button
                  onClick={() => {
                    const anyOpen = draft.blocks.some((b) => selected.has(b.key) && b.locked !== true);
                    op((d) => setLocked(d, selected, anyOpen));
                  }}
                  className={btn}
                  disabled={selected.size === 0}
                  title="Khoá khối đã chọn để không kéo nhầm"
                >
                  {draft.blocks.some((b) => selected.has(b.key) && b.locked !== true) ? "🔓" : "🔒"}
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
                  ✕
                </button>

                {selected.size > 1 &&
                  (["left", "centerX", "right", "top", "centerY", "bottom"] as const).map((edge) => (
                    <button key={edge} className={btn} onClick={() => applyAlign(edge)}>
                      {{ left: "⇤", centerX: "↔", right: "⇥", top: "⇧", centerY: "↕", bottom: "⇩" }[edge]}
                    </button>
                  ))}
              </>
            )}
          </div>

          {/*
            Drop target for the palette. Deliberately HTML5 drag-and-drop rather than the canvas's own
            pointer gestures: those already carry pan, marquee and block dragging, and threading a
            fourth meaning through them is how the seat tap got swallowed. Drag events are a separate
            channel, so nothing existing has to change to make room for this.
          */}
          <div
            className={`min-h-0 flex-1 ${dropping ? "ring-2 ring-inset ring-burgundy" : ""}`}
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
            <SeatCanvas<CanvasSeat>
              ref={canvas}
              // Authoring wants a CONSTANT ratio: with the viewBox tracking the content, adding a stage
              // near an edge rescaled the whole chart, and a gap judged by eye changed size between edits.
              fitContent={false}
              className="h-full"
              heightClass="h-full"
              editable
              interactive
              seats={canvasSeats}
              elements={canvasElements}
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
                overlapping.has(s.id) || selected.has(blockOfSeat.get(s.id) ?? "") || seatSel.has(s.id)
                  ? undefined
                  : colorOfSeat.get(s.id)
              }
              seatLabel={(s) =>
                `${s.section ? `${s.section}, ` : ""}hàng ${s.row}, ghế ${s.number}`
              }
              selectedIds={new Set(canvasSeats.filter((s) => selected.has(blockOfSeat.get(s.id) ?? "")).map((s) => s.id))}
              onSeatPointerDown={onSeatPointerDown}
              onSeatDrag={onSeatDrag}
              onSeatActivate={(s) => onSeatPointerDown(s, true)}
              onMarquee={onMarquee}
              onBackgroundClick={(p, additive) => {
                if (drawing) {
                  addDrawingPoint(p);
                  return;
                }
                if (!additive) {
                  setSelected(new Set());
                  setSeatSel(new Set());
                }
              }}
              // While drawing, the drag rectangle would be a marquee nobody asked for.
              marqueeStyle={drawing ? "none" : "rect"}
              overlay={
                drawing && drawing.length > 0 ? (
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

          <p className="shrink-0 px-3 pb-2 font-mono text-[11px] leading-4 text-beige-kem/45">
            {drawing
              ? `Đang vẽ: bấm để đặt điểm (${drawing.length}) · bấm lại điểm đầu hoặc Enter để khép hình · Backspace lùi một điểm · Esc huỷ`
              : null}
            {drawing ? null : "Kéo khối để dời"} · giữ Ctrl (hoặc ⌘) và kéo để di chuyển khung nhìn · lăn chuột để phóng to
            · Shift+bấm chọn thêm · mũi tên nhích, Shift+mũi tên nhích xa · Ctrl+D nhân đôi · Delete
            xoá khối · Ctrl+Z hoàn tác.
          </p>
        </main>

        <aside className="w-80 shrink-0 space-y-2 overflow-y-auto border-l-2 border-beige-kem p-3">
          {/* Ordered by how often it is reached for, not by the order the features were built. The
              inspector leads whenever something is selected, because that is the moment the organizer
              is asking "what is this and how do I change it". */}
          {selectedBlock && (
            <RailGroup title="Thuộc tính khối" defaultOpen>
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
              op((d) => repackRowLabels(setBlockParams(d, selectedBlock.key, patch)))
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
          <RailGroup title="Thêm vào sơ đồ" defaultOpen>
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
                () => layoutApi.addStandingArea(layout.id, a as unknown as Record<string, unknown>),
                `Đã tạo ${a.count} chỗ đứng.`,
              )
            }
            // Hall outlines and dividers are blocks now, so this routes to the document rather than to
            // a separate element list.
            onAddElement={() => addAt("shape")}
          />
          </RailGroup>

          <RailGroup title="Khu vực & hạng ghế" defaultOpen={!!selectedBlock}>
          <SectionPanel
            sections={draft.sections.map((s) => ({ id: s.id, name: s.name }))}
            seats={projected.seats}
            selectedCount={selected.size}
            activeSectionId={selectedBlock?.sectionId ?? null}
            onActivate={(id) =>
              assignSectionTo(id)
            }
            onAdd={(name) => commit((d) => addSection(d, name).doc)}
            onRename={(id, name) => op((d) => ({ ...d, sections: d.sections.map((s) => (s.id === id ? { ...s, name } : s)) }))}
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
            onAssign={(id) =>
              assignSectionTo(id)
            }
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
            onActivate={(id) =>
              assignCategoryTo(id)
            }
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
            onAssign={(id) =>
              assignCategoryTo(id)
            }
          />
          </RailGroup>

          {/* Never folded: an unresolved problem must not be something the organizer has to go and
              look for before pressing publish. */}
          <ValidationPanel
            issues={issues}
            labelOfSeat={(id) => seatLabels.get(id) ?? null}
            onFocusSeat={focusSeat}
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
        </aside>
      </div>
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
