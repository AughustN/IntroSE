// @vitest-environment happy-dom
import { act, createElement as h, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SeatMap } from "@/shared/catalog/types";
import type { SeatUpdate } from "@/shared/holds/types";
import type { Seat } from "../types";
import SeatLayout from "./SeatLayout";
import { catalogClient } from "../services/catalogClient";
import { watchShowtime } from "../services/seatSocket";
import { SAMPLE_MOVIES } from "../data";

vi.mock("../services/catalogClient", () => ({ catalogClient: { getSeatMap: vi.fn() } }));
vi.mock("../services/seatSocket", () => ({ watchShowtime: vi.fn() }));

function standingMap(): SeatMap {
  return {
    eventType: "seated",
    seats: [],
    space: { width: 10000, height: 10000, seatDiameter: 100 },
    elements: [
      {
        kind: "area",
        label: "Khu đứng A",
        x: 1000,
        y: 1000,
        width: 4000,
        height: 3000,
        rotation: 0,
        capacity: 100,
        categoryId: 7,
      },
    ],
    zoneTiers: [
      { id: 7, label: "Đứng A", price: 100000, remaining: 5 },
      { id: 8, label: "Đứng B", price: 200000, remaining: 3 },
    ],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const ticket = (tier: number, number: number): Seat => ({
  id: `Đứng ${tier} ${number}`,
  row: `Đứng ${tier}`,
  number,
  type: "single",
  price: 100000,
  isBooked: false,
  ticketTierId: tier,
});
let root: Root;
let container: HTMLDivElement;
let update: (frame: SeatUpdate) => void;
let connection: (connected: boolean) => void;
const stop = vi.fn();
let props: ComponentProps<typeof SeatLayout>;
const button = (label: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const mount = async (overrides: Partial<typeof props> = {}) => {
  props = { ...props, ...overrides };
  await act(async () => root.render(h(SeatLayout, props)));
};
beforeEach(() => {
  vi.resetAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  props = {
    event: SAMPLE_MOVIES[0],
    showtimeId: 1,
    selectedDate: "28/08/2026",
    selectedTime: "19:00",
    heldSeats: [],
    remainingMs: 600000,
    busy: false,
    zoneQuantities: {},
    onToggleSeat: vi.fn(),
    onHoldBestSeats: vi.fn(),
    onAdjustZoneQuantity: vi.fn(),
    onRemoveZoneTicket: vi.fn(),
    onBack: vi.fn(),
    onProceedToCheckout: vi.fn(),
  };
  vi.mocked(catalogClient.getSeatMap).mockResolvedValue(standingMap());
  vi.mocked(watchShowtime).mockImplementation((_id, onUpdate, onConnection) => {
    update = onUpdate;
    connection = onConnection ?? (() => {});
    return stop;
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("standing tickets on a buyer seat map", () => {
  it("renders a standing-only map and offers quantity controls, not seat-only tools", async () => {
    await mount();
    expect(container.querySelector('svg[aria-label="Sơ đồ chỗ ngồi"]')).not.toBeNull();
    expect(container.textContent).toContain("Khu đứng A");
    expect(button("Tăng số ghế")).toBeNull();
    expect(container.textContent).not.toContain("Chọn giúp tôi");
    await act(async () => button("Thêm vé Đứng A").click());
    expect(props.onAdjustZoneQuantity).toHaveBeenCalledWith({ id: "7", label: "Đứng A" }, 1);
  });
  it("keeps one summary row per held standing ticket after quantities change", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await mount({ heldSeats: [ticket(7, 1), ticket(7, 2), ticket(8, 1)] });
    await mount({ heldSeats: [ticket(8, 1)] });
    const rows = Array.from(container.querySelectorAll("li")).filter((li) =>
      li.textContent?.includes("Vé đứng số"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Đứng 8");
    expect(errors.mock.calls.some((args) => String(args[0]).includes("same key"))).toBe(false);
    await act(async () => rows[0].querySelector("button")!.click());
    expect(props.onRemoveZoneTicket).toHaveBeenCalledWith(8);
  });
  it("disables adding a sold-out tier but still allows releasing the buyer's own ticket", async () => {
    await mount({ heldSeats: [ticket(7, 1)], zoneQuantities: { "7": 1 } });
    await act(async () => update({ showtimeId: 1, tier: { ticketTierId: 7, remaining: 0 } }));
    expect(button("Thêm vé Đứng A").disabled).toBe(true);
    expect(button("Bớt vé Đứng A").disabled).toBe(false);
  });
  it("preserves a sold-out update arriving before the initial snapshot", async () => {
    const pending = deferred<SeatMap>();
    vi.mocked(catalogClient.getSeatMap).mockReturnValueOnce(pending.promise);
    await mount();
    await act(async () => update({ showtimeId: 1, tier: { ticketTierId: 7, remaining: 0 } }));
    await act(async () => pending.resolve(standingMap()));
    expect(button("Thêm vé Đứng A").disabled).toBe(true);
    expect(button("Thêm vé Đứng B").disabled).toBe(false);
  });
  it("reloads stock when the socket reconnects even if the browser stayed online", async () => {
    await mount();
    const latest = standingMap();
    latest.zoneTiers![0].remaining = 0;
    vi.mocked(catalogClient.getSeatMap).mockResolvedValue(latest);
    await act(async () => {
      connection(false);
      connection(true);
    });
    expect(catalogClient.getSeatMap).toHaveBeenCalledTimes(2);
    expect(button("Thêm vé Đứng A").disabled).toBe(true);
  });
  it("coalesces reconnect and online events while a read is pending, then reconciles once", async () => {
    const pending = deferred<SeatMap>();
    vi.mocked(catalogClient.getSeatMap).mockReturnValueOnce(pending.promise);
    await mount();
    await act(async () => {
      connection(true);
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("online"));
    });
    expect(catalogClient.getSeatMap).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(standingMap()));
    expect(catalogClient.getSeatMap).toHaveBeenCalledTimes(2);
  });
  it("does not double-fetch when subscribing to an already connected socket", async () => {
    vi.mocked(watchShowtime).mockImplementation((_id, _update, connected) => {
      connected?.(true);
      return stop;
    });
    await mount();
    expect(catalogClient.getSeatMap).toHaveBeenCalledTimes(1);
  });
  it("discards the previous showtime's delayed response and live frames", async () => {
    const pending = deferred<SeatMap>();
    vi.mocked(catalogClient.getSeatMap).mockReturnValueOnce(pending.promise);
    await mount();
    const oldUpdate = update;
    const fresh = standingMap();
    fresh.zoneTiers![0].remaining = 0;
    vi.mocked(catalogClient.getSeatMap).mockResolvedValue(fresh);
    await mount({ showtimeId: 2 });
    await act(async () => {
      oldUpdate({ showtimeId: 1, tier: { ticketTierId: 7, remaining: 5 } });
      pending.resolve(standingMap());
    });
    expect(button("Thêm vé Đứng A").disabled).toBe(true);
    expect(stop).toHaveBeenCalledOnce();
  });
  it("cleans up reads and subscriptions on leaving the map", async () => {
    const pending = deferred<SeatMap>();
    vi.mocked(catalogClient.getSeatMap).mockReturnValueOnce(pending.promise);
    await mount();
    const signal = vi.mocked(catalogClient.getSeatMap).mock.calls[0][1];
    await act(async () => root.unmount());
    expect(signal?.aborted).toBe(true);
    expect(stop).toHaveBeenCalledOnce();
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      pending.resolve(standingMap());
    });
    expect(catalogClient.getSeatMap).toHaveBeenCalledTimes(1);
  });
  it("does not draw a nonexistent map", async () => {
    vi.mocked(catalogClient.getSeatMap).mockResolvedValue({ eventType: "seated", seats: [] });
    await mount();
    expect(container.textContent).toContain("Suất diễn này chưa có sơ đồ ghế.");
    expect(container.querySelector('svg[aria-label="Sơ đồ chỗ ngồi"]')).toBeNull();
  });
  it("keeps the last map on refresh failure, blocks additions and allows retry and release", async () => {
    await mount({ heldSeats: [ticket(7, 1)], zoneQuantities: { "7": 1 } });
    vi.mocked(catalogClient.getSeatMap).mockRejectedValueOnce(new Error("Mất mạng"));
    await act(async () => connection(true));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Không tải được trạng thái vé mới nhất",
    );
    expect(container.querySelector('svg[aria-label="Sơ đồ chỗ ngồi"]')).not.toBeNull();
    expect(button("Thêm vé Đứng A").disabled).toBe(true);
    expect(button("Bớt vé Đứng A").disabled).toBe(false);
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(),
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(button("Thêm vé Đứng A").disabled).toBe(false);
  });
  it("offers retry on initial failure instead of claiming that the showtime has no map", async () => {
    vi.mocked(catalogClient.getSeatMap).mockRejectedValueOnce(new Error("Mất mạng"));
    await mount();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Suất diễn này chưa có sơ đồ ghế.");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(),
    );
    expect(button("Thêm vé Đứng A")).not.toBeNull();
  });
  it("keeps seated selection working on a mixed chart and reconciles its pending live updates", async () => {
    const map = standingMap();
    map.seats = [
      {
        id: 11,
        row: "A",
        number: 1,
        tier: "VIP",
        tierId: 9,
        price: 300000,
        status: "available",
        x: 3000,
        y: 5000,
        rotation: 0,
        section: null,
      },
    ];
    const pending = deferred<SeatMap>();
    vi.mocked(catalogClient.getSeatMap).mockReturnValueOnce(pending.promise);
    await mount();
    await act(async () => {
      update({ showtimeId: 1, seats: [{ showtimeSeatId: 11, status: "sold" }] });
      pending.resolve(map);
    });
    expect(button("Tăng số ghế")).not.toBeNull();
    const svg = container.querySelector('svg[aria-label="Sơ đồ chỗ ngồi"]')!;
    expect(svg.querySelector('[aria-label*="đã bán"]')).not.toBeNull();
    await act(async () =>
      update({ showtimeId: 1, seats: [{ showtimeSeatId: 11, status: "available" }] }),
    );
    const seat = svg.querySelector('[aria-label*="hàng A, ghế 1"]')!;
    await act(async () =>
      seat.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(props.onToggleSeat).toHaveBeenCalledWith(
      expect.objectContaining({ showtimeSeatId: 11 }),
    );
    expect(button("Thêm vé Đứng A")).not.toBeNull();
  });
});
