/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useRef, useState } from "react";
import type { LayoutElement, LayoutSeat, LayoutSection } from "@/shared/catalog/seatmap";

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
  seats: LayoutSeat[];
  elements: LayoutElement[];
}

export function useLayoutHistory(initial: LayoutDraft) {
  const [present, setPresent] = useState<LayoutDraft>(initial);
  const past = useRef<LayoutDraft[]>([]);
  const future = useRef<LayoutDraft[]>([]);
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);

  /** Commit a new state as ONE undoable step. */
  const commit = useCallback((next: LayoutDraft | ((current: LayoutDraft) => LayoutDraft)) => {
    setPresent((current) => {
      const value = typeof next === "function" ? next(current) : next;
      past.current = [...past.current, current].slice(-UNDO_DEPTH);
      future.current = [];
      return value;
    });
    rerender();
  }, []);

  /** Replace the baseline without creating an undo step — for a load or a save round trip. Undo
   *  history is per editing session and never reaches back past a save into another session's work. */
  const reset = useCallback((next: LayoutDraft) => {
    past.current = [];
    future.current = [];
    setPresent(next);
    rerender();
  }, []);

  const undo = useCallback(() => {
    setPresent((current) => {
      const previous = past.current.at(-1);
      if (!previous) return current;
      past.current = past.current.slice(0, -1);
      future.current = [current, ...future.current].slice(0, UNDO_DEPTH);
      return previous;
    });
    rerender();
  }, []);

  const redo = useCallback(() => {
    setPresent((current) => {
      const next = future.current[0];
      if (!next) return current;
      future.current = future.current.slice(1);
      past.current = [...past.current, current].slice(-UNDO_DEPTH);
      return next;
    });
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
