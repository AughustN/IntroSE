/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useRef, useState } from "react";
import type {
  LayoutCategory,
  LayoutElement,
  LayoutSeat,
  LayoutSection,
} from "@/shared/catalog/seatmap";

/**
 * Undo/redo for the layout editor (FR-012).
 *
 * Immutable snapshots rather than an operation log: at the 2,000-seat ceiling a snapshot is a few
 * tens of kilobytes, so 50 of them is a handful of megabytes — cheap enough that inverting every
 * operation is complexity we do not need to buy (Principle V).
 *
 * A multi-seat operation — aligning a marquee selection, curving a row — is ONE commit and therefore
 * one undo step, which is what an organizer expects when they press Ctrl+Z after nudging 40 seats.
 */

export const UNDO_DEPTH = 50;

export interface LayoutDraft {
  sections: LayoutSection[];
  categories: LayoutCategory[];
  seats: LayoutSeat[];
  elements: LayoutElement[];
}

/**
 * Generic over what is being edited, so the same 50-snapshot history serves the seat draft and the
 * authoring document (`ChartDocument`). A document snapshot is the SMALLER of the two — it stores each
 * seat once per block as a relative offset rather than as an absolute row — so widening this costs
 * nothing.
 */
export function useLayoutHistory<T>(initial: T) {
  const [present, setPresent] = useState<T>(initial);
  /** The committed value, readable outside an updater — see `commit`. */
  const presentRef = useRef<T>(initial);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);

  /**
   * Commit a new state as ONE undoable step.
   *
   * The stacks are pushed OUTSIDE the updater. React may call an updater more than once for a single
   * update — it does so deliberately under `<StrictMode>`, which this app runs (`src/main.tsx`) — and
   * an updater that mutates refs is not a pure function of its argument. Pushing from inside meant a
   * single edit could record two undo steps, so the first Ctrl+Z appeared to do nothing.
   *
   * `presentRef` is what makes moving it out possible: the updater's `current` is not available here,
   * so the ref carries the value the stack needs to remember.
   */
  const commit = useCallback((next: T | ((current: T) => T)) => {
    const current = presentRef.current;
    const value = typeof next === "function" ? (next as (c: T) => T)(current) : next;
    past.current = [...past.current, current].slice(-UNDO_DEPTH);
    future.current = [];
    presentRef.current = value;
    setPresent(value);
    rerender();
  }, []);

  /** Replace the baseline without creating an undo step — for a load or a save round trip. Undo
   *  history is per editing session and never reaches back past a save into another session's work. */
  const reset = useCallback((next: T) => {
    past.current = [];
    future.current = [];
    presentRef.current = next;
    setPresent(next);
    rerender();
  }, []);

  const undo = useCallback(() => {
    const previous = past.current.at(-1);
    if (!previous) return;
    past.current = past.current.slice(0, -1);
    future.current = [presentRef.current, ...future.current].slice(0, UNDO_DEPTH);
    presentRef.current = previous;
    setPresent(previous);
    rerender();
  }, []);

  const redo = useCallback(() => {
    const next = future.current[0];
    if (!next) return;
    future.current = future.current.slice(1);
    past.current = [...past.current, presentRef.current].slice(-UNDO_DEPTH);
    presentRef.current = next;
    setPresent(next);
    rerender();
  }, []);

  return {
    draft: present,
    commit,
    reset,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}
