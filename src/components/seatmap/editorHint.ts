/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BlockKind } from "@/shared/catalog/seatmap-document";

/**
 * The one line of help under the chart editor's status bar.
 *
 * It used to print every shortcut the editor has, always — nine clauses covering dragging, panning,
 * zooming, multi-select, nudging, duplicating, deleting and undo, whether or not any of them applied.
 * A hint that never changes is read once and then stops being read at all, which is the same as not
 * having one; and the clauses that DO apply are buried among the ones that do not. Worse, the
 * drawing case only ever prepended its line to that block, so mid-polygon the organizer was told
 * about Delete-to-remove-a-block while holding a half-finished shape.
 *
 * So the line answers one question — *what can I do with what I am holding right now?* — and the
 * order of the branches below is the order of specificity: an in-progress gesture beats a held tool,
 * a held tool beats a selection, and the idle text is what is left.
 *
 * Pure, and separate from `ChartEditor.tsx`, so the wording is pinned by tests rather than by
 * reading a 2,800-line component.
 */

/** The placement tools, exactly as the tool row labels them (`ChartEditor.tsx`). */
export const TOOL_LABELS: Partial<Record<BlockKind, string>> = {
  "seating-block": "Khối ghế",
  "single-row": "Hàng ghế",
  "ga-zone": "Khu đứng",
  stage: "Sân khấu",
  text: "Ghi chú",
  shape: "Hình khối",
};

export interface HintState {
  /** Number of points placed so far in a free-draw gesture, or null when not drawing. */
  drawingPoints: number | null;
  /** The placement tool in hand, or null for the select tool. */
  tool: BlockKind | null;
  /** How many individual seats are selected. */
  seatCount: number;
  /** The label of the selected row, or null. */
  rowLabel: string | null;
  /** How many blocks are selected. */
  blockCount: number;
}

/** Shared by every branch: these work whatever is in hand, so they earn their place on all of them. */
const VIEW = "giữ Ctrl (hoặc ⌘) và kéo để di chuyển khung nhìn · lăn chuột để phóng to";

export function editorHint(s: HintState): string {
  if (s.drawingPoints !== null) {
    return (
      `Đang vẽ: bấm để đặt điểm (${s.drawingPoints}) · bấm lại điểm đầu hoặc Enter để khép hình · ` +
      `Backspace lùi một điểm · Esc huỷ`
    );
  }

  if (s.tool) {
    const label = TOOL_LABELS[s.tool] ?? "Khối";
    return `${label}: bấm lên sơ đồ để đặt · Esc để huỷ · ${VIEW}`;
  }

  if (s.seatCount > 0) {
    return (
      `${s.seatCount} ghế: đổi hạng ghế hoặc loại ghế trên thanh công cụ · ` +
      `Shift+bấm chọn thêm · Esc bỏ chọn · ${VIEW}`
    );
  }

  if (s.rowLabel) {
    return (
      `Hàng ${s.rowLabel}: đổi nhãn và số ghế ở bảng thuộc tính · ` +
      `giữ Alt để chọn từng ghế · Esc bỏ chọn · ${VIEW}`
    );
  }

  if (s.blockCount > 0) {
    // Align and distribute are the two the toolbar greys out until enough is selected, so the hint
    // says what "enough" is rather than leaving the organizer to guess from a disabled button.
    const more =
      s.blockCount === 1
        ? " · Shift+bấm chọn thêm để canh hàng"
        : s.blockCount === 2
          ? " · chọn thêm một khối nữa để dàn đều"
          : "";
    return (
      `${s.blockCount} khối: kéo để dời · mũi tên nhích, Shift+mũi tên nhích xa · ` +
      `Ctrl+D nhân đôi · Delete xoá · Ctrl+Z hoàn tác${more} · ${VIEW}`
    );
  }

  return `Bấm một khối để chọn · kéo nền để quét chọn · giữ Alt để chọn từng ghế · ${VIEW}`;
}
