// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShowtimeMap } from "@/shared/catalog/seatmap";
import type { SeatUpdate } from "@/shared/holds/types";
import { layoutApi } from "../../services/catalogClient";
import { watchShowtime } from "../../services/seatSocket";
import { applySeatFrames, useLiveShowtimeMap } from "./useLiveShowtimeMap";

vi.mock("../../services/catalogClient", () => ({ layoutApi: { showtimeMap: vi.fn() } }));
vi.mock("../../services/seatSocket", () => ({ watchShowtime: vi.fn() }));

export function sampleMap(showtimeId = 1): ShowtimeMap {
  return {
    showtimeId,
    space: { width: 10000, height: 10000, seatDiameter: 100 },
    elements: [],
    tables: [],
    tierLegend: [{ tierId: 10, label: "VIP", price: 200000, color: "#AA0000" }],
    seats: [
      {
        id: showtimeId * 100,
        row: "A",
        number: 1,
        section: "A",
        category: "VIP",
        ticketTierId: 10,
        tier: "VIP",
        price: 200000,
        status: "available",
        x: 500,
        y: 500,
        rotation: 0,
      },
    ],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

let root: Root;
let container: HTMLDivElement;
let current: ReturnType<typeof useLiveShowtimeMap>;
let update: (value: SeatUpdate) => void;
let connection: (connected: boolean) => void;
const stop = vi.fn();
function Harness({ id }: { id: number }) {
  const value = useLiveShowtimeMap(id);
  useEffect(() => {
    current = value;
  }, [value]);
  return createElement("p", null, value.map?.showtimeId ?? "loading");
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(layoutApi.showtimeMap).mockImplementation(async (id) => sampleMap(id));
  vi.mocked(watchShowtime).mockImplementation((_id, onUpdate, onConnection) => {
    update = onUpdate;
    connection = onConnection!;
    return stop;
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});
const mount = async (id = 1) => {
  await act(async () => root.render(createElement(Harness, { id })));
};

describe("live owner seat map", () => {
  it("reads the owner snapshot and paints holds, sales and releases without creating reservations", async () => {
    await mount();
    for (const status of ["held", "sold", "available"] as const) {
      await act(async () => update({ showtimeId: 1, seats: [{ showtimeSeatId: 100, status }] }));
      expect(current.map?.seats[0].status).toBe(status);
    }
    expect(layoutApi.showtimeMap).toHaveBeenCalledTimes(1);
    expect(current.updatedAt).toBeInstanceOf(Date);
  });
  it("ignores frames for another showtime", async () => {
    await mount();
    await act(async () =>
      update({ showtimeId: 2, seats: [{ showtimeSeatId: 100, status: "sold" }] }),
    );
    expect(current.map?.seats[0].status).toBe("available");
  });
  it("does not overwrite a new sale with an older in-flight snapshot", async () => {
    const pending = deferred<ShowtimeMap>();
    vi.mocked(layoutApi.showtimeMap).mockReturnValueOnce(pending.promise);
    await mount();
    await act(async () =>
      update({ showtimeId: 1, seats: [{ showtimeSeatId: 100, status: "sold" }] }),
    );
    await act(async () => pending.resolve(sampleMap()));
    expect(current.map?.seats[0].status).toBe("sold");
  });
  it("refreshes on reconnect and retains the last map with a warning on failure", async () => {
    await mount();
    vi.mocked(layoutApi.showtimeMap).mockRejectedValueOnce(new Error("Mất mạng"));
    await act(async () => connection(true));
    expect(current.connected).toBe(true);
    expect(current.error).toBe("Mất mạng");
    expect(current.map).not.toBeNull();
    await act(async () => current.reload());
    expect(current.error).toBeNull();
  });
  it("polls every 30 seconds and reconciles when the window regains focus", async () => {
    await mount();
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(layoutApi.showtimeMap).toHaveBeenCalledTimes(2);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(layoutApi.showtimeMap).toHaveBeenCalledTimes(3);
  });
  it("does not poll while the page is hidden", async () => {
    await mount();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(layoutApi.showtimeMap).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
  });
  it("aborts old reads and discards responses after changing showtimes", async () => {
    const old = deferred<ShowtimeMap>();
    vi.mocked(layoutApi.showtimeMap).mockReturnValueOnce(old.promise);
    await mount();
    const signal = vi.mocked(layoutApi.showtimeMap).mock.calls[0][1]!;
    await mount(2);
    expect(signal.aborted).toBe(true);
    expect(current.map?.showtimeId).toBe(2);
    await act(async () => old.resolve(sampleMap(1)));
    expect(current.map?.showtimeId).toBe(2);
    expect(stop).toHaveBeenCalledOnce();
  });
  it("cleans up the room, timer and listeners on unmount", async () => {
    await mount();
    await act(async () => root.unmount());
    expect(stop).toHaveBeenCalledOnce();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      window.dispatchEvent(new Event("focus"));
    });
    expect(layoutApi.showtimeMap).toHaveBeenCalledTimes(1);
  });
  it("preserves a retier frame when a later status-only frame arrives during loading", async () => {
    const pending = deferred<ShowtimeMap>();
    vi.mocked(layoutApi.showtimeMap).mockReturnValueOnce(pending.promise);
    await mount();
    await act(async () => {
      update({
        showtimeId: 1,
        seats: [{ showtimeSeatId: 100, status: "available", tier: "Thường", price: 0 }],
      });
      update({ showtimeId: 1, seats: [{ showtimeSeatId: 100, status: "held" }] });
      pending.resolve(sampleMap());
    });
    expect(current.map?.seats[0]).toMatchObject({ tier: "Thường", price: 0, status: "held" });
  });
  it("clears the old buyer details when a seat is released", () => {
    const map = sampleMap();
    Object.assign(map.seats[0], { status: "sold", buyerName: "Buyer", checkedInAt: "2026-08-27" });
    expect(
      applySeatFrames(map, new Map([[100, { showtimeSeatId: 100, status: "available" }]])).seats[0],
    ).toMatchObject({ buyerName: null, checkedInAt: null, status: "available" });
    expect(map.seats[0].status).toBe("sold");
  });
});
