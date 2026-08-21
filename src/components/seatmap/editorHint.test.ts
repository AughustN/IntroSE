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

  /*
   * The hint trimmed to its decision: one sentence, the verbs for the thing in hand, and nothing
   * shared-but-dimmed. The old line pasted the full shortcut card on every state, and a hint that
   * prints nine clauses on every state stops being read at all.
   */
  it("names what a second and third block unlock, and keeps each kind distinct", () => {
    const one = editorHint({ ...idle, blockCount: 1 });
    expect(one).toContain("kéo để dời");
    expect(one).toContain("Delete xoá");
    const two = editorHint({ ...idle, blockCount: 2 });
    expect(two).toContain("dàn đều");
    const three = editorHint({ ...idle, blockCount: 3 });
    expect(three).toContain("3 khối");
    expect(three).not.toContain("Delete xoá"); // past two, the decision-time verbs give way
    expect(three).not.toContain("dàn đều");
  });

  it("drops the shared view shortcuts from a selection, where they only dilute the one line", () => {
    const selected: HintState[] = [
      { ...idle, seatCount: 4 },
      { ...idle, rowLabel: "B" },
      { ...idle, blockCount: 1 },
    ];
    for (const s of selected) expect(editorHint(s)).not.toContain("lăn chuột để phóng to");
    // A held tool still carries them, because typing is exactly when pan-and-zoom are needed.
    expect(editorHint({ ...idle, tool: "stage" })).toContain("lăn chuột để phóng to");
  });

  it("distinguishes seats, a row and blocks", () => {
    expect(editorHint({ ...idle, seatCount: 4 })).toContain("4 ghế");
    expect(editorHint({ ...idle, rowLabel: "B" })).toContain("Hàng B");
    expect(editorHint({ ...idle, blockCount: 2 })).toContain("2 khối");
  });

  it("falls back to how to select when nothing is in hand", () => {
    expect(editorHint(idle)).toContain("Bấm một khối để chọn");
  });

  it("prints no more than four clauses in any state", () => {
    const states: HintState[] = [
      idle,
      { ...idle, tool: "stage" },
      { ...idle, seatCount: 1 },
      { ...idle, rowLabel: "A" },
      { ...idle, blockCount: 1 },
      { ...idle, blockCount: 2 },
      { ...idle, blockCount: 5 },
    ];
    for (const s of states) expect(editorHint(s).split(" · ").length).toBeLessThanOrEqual(4);
  });
});
