import { describe, expect, it } from "vitest";
import { isOverlayPath, pathToRoute, screenToPath } from "./routes";

// The URL vocabulary. Every screen that carries a parameter has to survive the round trip
// path → route → path, because that trip is what a deep link, a Back and a share all take.

describe("the seat map library and editor", () => {
  it("addresses a chart in its own right, not through an event", () => {
    expect(pathToRoute("/organizer/seatmaps")).toEqual({ screen: "seatmaps" });
    expect(pathToRoute("/organizer/seatmaps/42")).toEqual({
      screen: "seatmaps",
      organizerLayoutId: 42,
    });
  });

  it("round-trips", () => {
    expect(screenToPath("seatmaps")).toBe("/organizer/seatmaps");
    expect(screenToPath("seatmaps", { organizerLayoutId: 42 })).toBe("/organizer/seatmaps/42");
    // Without an id there is no honest chart URL, so it falls back to the library rather than
    // inventing `/organizer/seatmaps/undefined`.
    expect(screenToPath("seatmaps", { organizerLayoutId: null })).toBe("/organizer/seatmaps");
  });

  it("refuses a non-numeric or absent id rather than opening a nonsense chart", () => {
    expect(pathToRoute("/organizer/seatmaps/abc")).toBeNull();
    expect(pathToRoute("/organizer/seatmaps/0")).toBeNull();
    expect(pathToRoute("/organizer/seatmaps/-3")).toBeNull();
    expect(pathToRoute("/organizer/seatmaps/1/extra")).toBeNull();
  });

  it("does not collide with the organizer console beneath the same prefix", () => {
    expect(pathToRoute("/organizer")).toEqual({ screen: "organizer" });
    expect(pathToRoute("/organizer/events/7")).toEqual({
      screen: "organizer",
      organizerEventId: 7,
    });
  });

  it("treats a trailing slash as the same page", () => {
    expect(pathToRoute("/organizer/seatmaps/")).toEqual({ screen: "seatmaps" });
  });

  it("is not an overlay — it owns the screen, unlike /account", () => {
    expect(isOverlayPath("/organizer/seatmaps")).toBe(false);
    expect(isOverlayPath("/account")).toBe(true);
  });
});
