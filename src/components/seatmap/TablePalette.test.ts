import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import TablePalette from "./TablePalette";

describe("table and standing-area tools", () => {
  it.each([false, true])("does not offer a hall outline when busy is %s", (busy) => {
    const html = renderToStaticMarkup(
      createElement(TablePalette, {
        sections: [],
        tables: [],
        busy,
        onAddTable: vi.fn(),
        onAddElement: vi.fn(),
        onAddStandingArea: vi.fn(),
      }),
    );
    expect(html).not.toContain("Đường bao sảnh");
    expect(html).toContain("+ Thêm bàn");
    expect(html).toContain("+ Vách ngăn");
    expect(html).toContain("+ Vùng đứng");
  });
});
