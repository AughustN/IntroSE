import { describe, expect, it } from "vitest";
import { editorHint, TOOL_LABELS, type HintState } from "./editorHint";

const idle: HintState = {
  drawingPoints: null,
  tool: null,
  seatCount: 0,
  rowLabel: null,
  blockCount: 0,
};

describe("editorHint", () => {
  it("names the tool in hand, so the line changes when the tool does", () => {
    const seating = editorHint({ ...idle, tool: "seating-block" });
    const stage = editorHint({ ...idle, tool: "stage" });
    expect(seating).toContain("Khối ghế");
    expect(stage).toContain("Sân khấu");
    expect(seating).not.toBe(stage);
  });

  it("covers every tool the tool row offers", () => {
    for (const [kind, label] of Object.entries(TOOL_LABELS)) {
      expect(editorHint({ ...idle, tool: kind as HintState["tool"] })).toContain(label);
    }
  });

  /*
   * The bug this function exists to fix. The old line appended the whole shortcut block to the
   * drawing hint, so mid-polygon the organizer was told about Delete-to-remove-a-block and Ctrl+D
   * while holding a half-finished shape — neither of which does what that reads like during a draw.
   */
  it("says only what applies while drawing, and counts the points placed", () => {
    const drawing = editorHint({ ...idle, drawingPoints: 3 });
    expect(drawing).toContain("(3)");
    expect(drawing).toContain("Esc huỷ");
    expect(drawing).not.toContain("Ctrl+D");
    expect(drawing).not.toContain("Delete");
  });

  it("lets an in-progress draw outrank a held tool", () => {
    expect(editorHint({ ...idle, drawingPoints: 1, tool: "shape" })).toContain("Đang vẽ");
  });

  it("tells a single-block selection what a second block would unlock", () => {
    expect(editorHint({ ...idle, blockCount: 1 })).toContain("canh hàng");
    expect(editorHint({ ...idle, blockCount: 2 })).toContain("dàn đều");
    // Three is enough for both, so there is nothing left to promise.
    const three = editorHint({ ...idle, blockCount: 3 });
    expect(three).not.toContain("canh hàng");
    expect(three).not.toContain("dàn đều");
  });

  it("distinguishes seats, a row and blocks", () => {
    expect(editorHint({ ...idle, seatCount: 4 })).toContain("4 ghế");
    expect(editorHint({ ...idle, rowLabel: "B" })).toContain("Hàng B");
    expect(editorHint({ ...idle, blockCount: 2 })).toContain("2 khối");
  });

  it("falls back to how to select when nothing is in hand", () => {
    expect(editorHint(idle)).toContain("Bấm một khối để chọn");
  });

  it("keeps the view shortcuts on every branch except drawing", () => {
    const states: HintState[] = [
      idle,
      { ...idle, tool: "stage" },
      { ...idle, seatCount: 1 },
      { ...idle, rowLabel: "A" },
      { ...idle, blockCount: 1 },
    ];
    for (const s of states) expect(editorHint(s)).toContain("lăn chuột để phóng to");
  });
});
