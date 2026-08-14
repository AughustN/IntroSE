/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BlockKind, BlockParams, ChartDocument, DocumentBlock } from "@/shared/catalog/seatmap-document";
import { emptyDocument } from "@/shared/catalog/seatmap-document";
import { projectDocument } from "@/shared/catalog/seatmap-project";
import { type ValidationIssue, validateLayout } from "@/shared/catalog/seatmap-validate";
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
  addSection,
  type BlockAlignEdge,
  alignBlocks,
  alignedPosition,
  duplicateBlocks,
  moveBlocks,
  movedPosition,
  NUDGE,
  remainingBudget,
  removeBlocks,
  removeCategory,
  removeSection,
  rotateBlocks,
  seatCount,
  selectionBounds,
  setBlockParams,
  setLocked,
  updateBlock,
  updateCategory,
} from "./documentOps";
import SectionPanel from "./SectionPanel";
import { useLayoutHistory } from "./useLayoutHistory";

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

export default function ChartEditor({
  layoutId,
  onClose,
}: {
  layoutId: number;
  onClose: () => void;
}) {
  const [layout, setLayout] = useState<Layout | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
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

  /** Section hulls, drawn behind the seats — the canvas already knows how to title a group. */
  const blocks = useMemo<CanvasBlock[]>(
    () =>
      draft.sections.map((s, i) => ({
        id: s.id,
        name: s.name,
        color: draft.categories[i % Math.max(1, draft.categories.length)]?.color ?? "#8a8a8a",
      })),
    [draft.sections, draft.categories],
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
    const next = others.size > 0 ? removeBlocks(draft, others) : draft;
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
  const onSeatPointerDown = (seat: CanvasSeat, additive: boolean) => {
    const key = blockOfSeat.get(seat.id);
    if (!key) return;
    dragging.current = true;
    setSelected((cur) => {
      if (!additive) return new Set([key]);
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const onSeatDrag = (dx: number, dy: number, phase: "move" | "end") => {
    if (!dragging.current || selected.size === 0) return;
    if (phase === "move") {
      setDragDelta({ dx, dy });
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
      setDragDelta({ dx, dy });
      return;
    }
    setDragDelta(null);
    draggingElement.current = false;
    applyMove(dx, dy);
  };

  /** A marquee selects every block with a seat inside the rectangle. */
  const onMarquee = (rect: { x1: number; y1: number; x2: number; y2: number }, additive: boolean) => {
    const minX = Math.min(rect.x1, rect.x2);
    const maxX = Math.max(rect.x1, rect.x2);
    const minY = Math.min(rect.y1, rect.y2);
    const maxY = Math.max(rect.y1, rect.y2);
    const hit = new Set<string>();
    projected.seats.forEach((s, i) => {
      if (s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY) {
        const key = blockOfSeat.get(s.id ?? -(i + 1));
        if (key) hit.add(key);
      }
    });
    setSelected((cur) => (additive ? new Set([...cur, ...hit]) : hit));
  };

  const addAt = (kind: BlockKind) => {
    // At the centre of what the organizer is looking at, not the centre of the coordinate space —
    // dropping a block off-screen is how the reference editor ended up with everything stacked.
    const at = canvas.current?.toLayout(window.innerWidth / 2, window.innerHeight / 2) ?? {
      x: 5000,
      y: 5000,
    };
    commit((d) => {
      const made = addBlock(d, kind, at, {
        sectionId: d.sections[0]?.id ?? null,
        categoryId: d.categories[0]?.id ?? null,
        grid,
      });
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
      if (e.key === "Escape") {
        setSelected(new Set());
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
  }, [draft.blocks, selected, grid, layout, op, commit, undo, redo]);


  if (error && !layout) return <p className="p-6 text-sm text-on-tint">{error}</p>;
  if (!layout) return <p className="p-6 font-mono text-xs text-beige-kem/60">Đang tải sơ đồ…</p>;

  const seats = seatCount(draft);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-xanh-pho text-beige-kem">
      <header className="flex h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b-2 border-beige-kem px-4">
        <h2 className="font-display text-lg font-black">{layout.name}</h2>
        <span className="font-mono text-[11px] text-beige-kem/50">
          {seats} ghế · {draft.blocks.length} khối · {draft.sections.length} khu ·{" "}
          {draft.categories.length} hạng
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
          {selected.size > 0 && (
            <button
              onClick={() => {
                // Mixed selection locks rather than unlocks: the safe direction when it is ambiguous.
                const anyOpen = draft.blocks.some((b) => selected.has(b.key) && b.locked !== true);
                op((d) => setLocked(d, selected, anyOpen));
              }}
              className={btn}
              title="Khoá khối đã chọn để không kéo nhầm"
            >
              {draft.blocks.some((b) => selected.has(b.key) && b.locked !== true) ? "Khoá" : "Mở khoá"}
            </button>
          )}
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
              {selected.size === 0
                ? "Bấm một khối để chọn · kéo nền để quét chọn"
                : `${selected.size} khối đang chọn`}
            </span>
            {selected.size > 1 && (
              <>
                {(["left", "centerX", "right", "top", "centerY", "bottom"] as const).map((edge) => (
                  <button
                    key={edge}
                    className={btn}
                    onClick={() => applyAlign(edge)}
                  >
                    {{ left: "⇤", centerX: "↔", right: "⇥", top: "⇧", centerY: "↕", bottom: "⇩" }[edge]}
                  </button>
                ))}
              </>
            )}
          </div>

          <div className="min-h-0 flex-1">
            <SeatCanvas<CanvasSeat>
              ref={canvas}
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
                setSelected((cur) => {
                  if (!additive) return new Set([key]);
                  const next = new Set(cur);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                });
              }}
              onElementDrag={onElementDrag}
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
                  : selected.has(blockOfSeat.get(s.id) ?? "")
                    ? "fill-burgundy/40 stroke-burgundy"
                    : "fill-transparent stroke-beige-kem/50"
              }
              seatLabel={(s) =>
                `${s.section ? `${s.section}, ` : ""}hàng ${s.row}, ghế ${s.number}`
              }
              selectedIds={new Set(canvasSeats.filter((s) => selected.has(blockOfSeat.get(s.id) ?? "")).map((s) => s.id))}
              onSeatPointerDown={onSeatPointerDown}
              onSeatDrag={onSeatDrag}
              onSeatActivate={(s) => onSeatPointerDown(s, true)}
              onMarquee={onMarquee}
              onBackgroundClick={(_p, additive) => {
                if (!additive) setSelected(new Set());
              }}
            />
          </div>

          <p className="shrink-0 px-3 pb-2 font-mono text-[11px] leading-4 text-beige-kem/45">
            Kéo khối để dời · giữ Ctrl (hoặc ⌘) và kéo để di chuyển khung nhìn · lăn chuột để phóng to
            · Shift+bấm chọn thêm · mũi tên nhích, Shift+mũi tên nhích xa · Ctrl+D nhân đôi · Delete
            xoá khối · Ctrl+Z hoàn tác.
          </p>
        </main>

        <aside className="w-80 shrink-0 space-y-3 overflow-y-auto border-l-2 border-beige-kem p-3">
          <BlockPalette onAdd={addAt} disabled={busy} remaining={budget} />

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

          <BlockInspector
            block={selectedBlock}
            sections={draft.sections}
            categories={draft.categories}
            seatBudget={budget}
            onChange={(patch: Partial<DocumentBlock>) =>
              selectedBlock && op((d) => updateBlock(d, selectedBlock.key, patch))
            }
            onParams={(patch: Partial<BlockParams>) =>
              selectedBlock && op((d) => setBlockParams(d, selectedBlock.key, patch))
            }
            onRotate={(deg) => applyRotate(deg)}
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

          <SectionPanel
            sections={draft.sections.map((s) => ({ id: s.id, name: s.name }))}
            seats={projected.seats}
            selectedCount={selected.size}
            activeSectionId={selectedBlock?.sectionId ?? null}
            onActivate={(id) =>
              selectedBlock && op((d) => updateBlock(d, selectedBlock.key, { sectionId: id }))
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
              selectedBlock && op((d) => updateBlock(d, selectedBlock.key, { sectionId: id }))
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
              selectedBlock && op((d) => updateBlock(d, selectedBlock.key, { categoryId: id }))
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
                  title: "Xoá hạng giá?",
                  message: `${seats} ghế sẽ mất hạng giá. Suất chiếu nào đang dùng hạng này sẽ phải chọn lại mức giá trước khi bán.`,
                  confirmLabel: "Xoá hạng giá",
                  cancelLabel: "Huỷ",
                  tone: "danger",
                },
                () => op((d) => removeCategory(d, id)),
              );
            }}
            onAssign={(id) =>
              selectedBlock && op((d) => updateBlock(d, selectedBlock.key, { categoryId: id }))
            }
          />

          <ValidationPanel
            issues={issues}
            labelOfSeat={(id) => seatLabels.get(id) ?? null}
            onFocusSeat={focusSeat}
          />

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
