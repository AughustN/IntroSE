// @vitest-environment happy-dom
import { act, createElement as h, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAdFeed } from "./useAdFeed";
import { adsClient } from "../services/adsClient";
import type { AdFeed } from "@shared/ads/types.js";
vi.mock("../services/adsClient", () => ({ adsClient: { delivery: vi.fn() } }));
let root: Root;
let result: AdFeed;
let hidden: boolean;
const feed = (): AdFeed => ({
  legacy: [],
  deliveries: [
    {
      eventId: 1,
      slug: "one",
      placement: "hero_trailer",
      placements: ["hero_trailer"],
      token: "receipt",
      expiresAt: new Date(Date.now() + 90_000).toISOString(),
    },
  ],
});
function Harness({ enabled = true }) {
  const value = useAdFeed(enabled);
  useEffect(() => {
    result = value;
  }, [value]);
  return null;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-28T00:00:00Z"));
  vi.resetAllMocks();
  hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  root = createRoot(document.createElement("div"));
  vi.mocked(adsClient.delivery).mockImplementation(async () => feed());
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("home advertising lifecycle", () => {
  it("does not allocate outside the home page", async () => {
    await act(async () => root.render(h(Harness, { enabled: false })));
    expect(adsClient.delivery).not.toHaveBeenCalled();
    expect(result.deliveries).toEqual([]);
  });
  it("refreshes while visible but not in a hidden tab", async () => {
    await act(async () => root.render(h(Harness)));
    expect(adsClient.delivery).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(adsClient.delivery).toHaveBeenCalledTimes(2);
    hidden = true;
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(adsClient.delivery).toHaveBeenCalledTimes(2);
    hidden = false;
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(adsClient.delivery).toHaveBeenCalledTimes(3);
  });
  it("expires ads during a network failure instead of displaying them indefinitely", async () => {
    await act(async () => root.render(h(Harness)));
    vi.mocked(adsClient.delivery).mockRejectedValue(new Error("offline"));
    await act(async () => vi.advanceTimersByTimeAsync(90_000));
    expect(result.deliveries).toEqual([]);
  });
  it("aborts requests and does not apply stale responses after navigation", async () => {
    let resolve!: (value: AdFeed) => void;
    vi.mocked(adsClient.delivery).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    await act(async () => root.render(h(Harness)));
    const signal = vi.mocked(adsClient.delivery).mock.calls[0][0];
    await act(async () => root.render(h(Harness, { enabled: false })));
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve(feed()));
    expect(result.deliveries).toEqual([]);
    await act(async () => vi.advanceTimersByTimeAsync(90_000));
    expect(adsClient.delivery).toHaveBeenCalledTimes(1);
  });
  it("never overlaps a slow refresh request", async () => {
    vi.mocked(adsClient.delivery).mockReturnValue(new Promise(() => {}));
    await act(async () => root.render(h(Harness)));
    await act(async () => vi.advanceTimersByTimeAsync(90_000));
    expect(adsClient.delivery).toHaveBeenCalledTimes(1);
  });
});
