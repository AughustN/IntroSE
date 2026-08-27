import { describe, expect, it } from "vitest";
import { freeLayoutName } from "./freeLayoutName";

describe("freeLayoutName", () => {
  it("keeps the plain name when nothing holds it", () => {
    expect(freeLayoutName("Khán phòng (bản sao)", ["Khán phòng"])).toBe("Khán phòng (bản sao)");
  });

  it("numbers the second copy instead of colliding", () => {
    // The bug: this returned the taken name and the server refused `layout_name_taken`, from a form
    // with no name field.
    expect(freeLayoutName("A (bản sao)", ["A", "A (bản sao)"])).toBe("A (bản sao) 2");
  });

  it("keeps counting past an existing numbered copy", () => {
    expect(freeLayoutName("A (bản sao)", ["A (bản sao)", "A (bản sao) 2"])).toBe("A (bản sao) 3");
  });

  it("ignores case and surrounding space, as the uniqueness rule is felt", () => {
    expect(freeLayoutName("A (bản sao)", ["  a (BẢN SAO) "])).toBe("A (bản sao) 2");
  });

  it("only looks at the venue's own names it was given", () => {
    expect(freeLayoutName("A (bản sao)", [])).toBe("A (bản sao)");
  });

  it("stays inside the server's 80-character ceiling, with room to number", () => {
    const long = "x".repeat(200);
    const out = freeLayoutName(long, []);
    expect(out.length).toBeLessThanOrEqual(76);
    expect(freeLayoutName(long, [out]).length).toBeLessThanOrEqual(80);
  });
});
