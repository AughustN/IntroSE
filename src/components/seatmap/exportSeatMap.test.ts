// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { snapshotSvg } from "./exportSeatMap";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
function drawing() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 2000 1000");
  const seat = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  seat.setAttribute("class", "sold");
  seat.style.fill = "rgb(30, 30, 30)";
  svg.append(seat);
  document.body.append(svg);
  return { svg, seat };
}
describe("seat map PNG source", () => {
  it("freezes the visible geometry and resolved colors without mutating the live map", () => {
    const { svg, seat } = drawing();
    const result = snapshotSvg(svg);
    expect(result.getAttribute("viewBox")).toBe("0 0 2000 1000");
    expect(result.querySelector("circle")?.style.fill).toBe("rgb(30, 30, 30)");
    expect(result.querySelector("circle")?.hasAttribute("class")).toBe(false);
    expect(seat.getAttribute("class")).toBe("sold");
    seat.style.fill = "red";
    expect(result.querySelector("circle")?.style.fill).toBe("rgb(30, 30, 30)");
  });
  it("keeps hatch references local to the downloaded image", () => {
    const { svg } = drawing();
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (property: string) =>
        property === "fill" ? 'url("http://localhost:3000/event#seat-hatch")' : "",
    } as CSSStyleDeclaration);
    expect(snapshotSvg(svg).querySelector("circle")?.style.fill).toBe("url(#seat-hatch)");
  });
});
