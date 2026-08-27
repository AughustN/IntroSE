// @vitest-environment happy-dom
import { act, createElement as h, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAdExposure, trackAd } from "./useAdExposure";
import { adsClient } from "../services/adsClient";
import type { AdDelivery } from "@shared/ads/types.js";
vi.mock("../services/adsClient", () => ({ adsClient: { metric: vi.fn() } }));
let root: Root;
let hidden: boolean;
let entry: IntersectionObserverCallback;
let sequence = 0;
let delivery: AdDelivery;
const disconnect = vi.fn();
function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  useAdExposure(ref, delivery);
  // createElement only passes the ref to React; it does not read ref.current during render.
  // eslint-disable-next-line react-hooks/refs
  return h("div", { ref });
}
const intersect = (ratio: number) =>
  entry(
    [{ intersectionRatio: ratio, isIntersecting: ratio > 0 } as IntersectionObserverEntry],
    {} as IntersectionObserver,
  );
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        entry = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  root = createRoot(document.createElement("div"));
  delivery = {
    token: `receipt-${++sequence}`,
    eventId: 1,
    slug: "one",
    placement: "hot_events",
    placements: ["hot_events"],
    expiresAt: new Date(Date.now() + 90_000).toISOString(),
  };
  vi.mocked(adsClient.metric).mockResolvedValue();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("visible advertising measurements", () => {
  it("does not count merely rendering or less than half visibility", async () => {
    await act(async () => root.render(h(Harness)));
    intersect(0.49);
    await vi.advanceTimersByTimeAsync(2000);
    expect(adsClient.metric).not.toHaveBeenCalled();
  });
  it("requires one continuous visible second and counts only once per receipt", async () => {
    await act(async () => root.render(h(Harness)));
    intersect(0.5);
    await vi.advanceTimersByTimeAsync(500);
    intersect(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(adsClient.metric).not.toHaveBeenCalled();
    intersect(1);
    await vi.advanceTimersByTimeAsync(4000);
    expect(adsClient.metric).toHaveBeenCalledOnce();
    expect(adsClient.metric).toHaveBeenCalledWith(delivery.token, "impression");
  });
  it("resets the visible interval while the document is hidden", async () => {
    await act(async () => root.render(h(Harness)));
    intersect(1);
    await vi.advanceTimersByTimeAsync(500);
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(adsClient.metric).not.toHaveBeenCalled();
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(999);
    expect(adsClient.metric).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(adsClient.metric).toHaveBeenCalledOnce();
  });
  it("deduplicates clones and clicks, and ignores expired receipts", async () => {
    trackAd(delivery, "click");
    trackAd(delivery, "click");
    expect(adsClient.metric).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(90_001);
    trackAd(delivery, "impression");
    expect(adsClient.metric).toHaveBeenCalledOnce();
  });
  it("does not flood a failed measurement endpoint", async () => {
    vi.mocked(adsClient.metric).mockRejectedValue(new Error("offline"));
    await act(async () => root.render(h(Harness)));
    intersect(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(adsClient.metric).toHaveBeenCalledOnce();
  });
  it("disconnects observers on unmount", async () => {
    await act(async () => root.render(h(Harness)));
    await act(async () => root.render(null));
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
