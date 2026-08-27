// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManageShowtime } from "../../services/catalogClient";
import type { ShowtimeMap } from "@/shared/catalog/seatmap";
import EventSalesMap from "./EventSalesMap";
import { useLiveShowtimeMap } from "../seatmap/useLiveShowtimeMap";
import { downloadSeatMapPng } from "../seatmap/exportSeatMap";

vi.mock("../seatmap/useLiveShowtimeMap", () => ({ useLiveShowtimeMap: vi.fn() }));
vi.mock("../seatmap/exportSeatMap", () => ({ downloadSeatMapPng: vi.fn() }));
vi.mock("../Select", () => ({
  default: ({
    value,
    options,
    onChange,
  }: {
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
  }) =>
    h(
      "select",
      {
        "aria-label": "Suất diễn",
        value,
        onChange: (e: { target: { value: string } }) => onChange(e.target.value),
      },
      options.map((option) =>
        h("option", { key: option.value, value: option.value }, option.label),
      ),
    ),
}));
vi.mock("../seatmap/SeatCanvas", () => ({
  default: ({
    seats,
    onSeatActivate,
  }: {
    seats: ShowtimeMap["seats"];
    onSeatActivate: (seat: ShowtimeMap["seats"][number]) => void;
  }) =>
    h(
      "svg",
      { "aria-label": "Sơ đồ chỗ ngồi" },
      seats.map((seat) =>
        h(
          "g",
          { key: seat.id, role: "button", onClick: () => onSeatActivate(seat) },
          `${seat.row}${seat.number}`,
        ),
      ),
    ),
}));

const row = (id = 1, hasSeatMap = true): ManageShowtime => ({
  id,
  hasSeatMap,
  startsAt: "2099-12-12T12:00:00Z",
  venueName: "Nhà hát",
  venueId: 1,
  bookableSeats: 1,
  zoneCapacity: 0,
  tiers: [],
  sections: [],
  layoutId: null,
  assignableLayouts: [],
  layoutStatus: null,
  categories: [],
});
const map: ShowtimeMap = {
  showtimeId: 1,
  space: { width: 10000, height: 10000, seatDiameter: 100 },
  elements: [],
  tables: [],
  tierLegend: [],
  seats: [
    {
      id: 100,
      row: "A",
      number: 1,
      section: null,
      category: null,
      ticketTierId: 1,
      tier: "VIP",
      price: 100000,
      status: "sold",
      x: 500,
      y: 500,
      rotation: 0,
    },
  ],
};
let root: Root;
let container: HTMLDivElement;
const reload = vi.fn();
const retry = vi.fn();
let live: ReturnType<typeof useLiveShowtimeMap>;
const mount = async (rows: ManageShowtime[] | null = [row()]) => {
  await act(async () =>
    root.render(h(EventSalesMap, { eventTitle: "Đêm nhạc", showtimes: rows, onRetry: retry })),
  );
};
const button = (text: string) =>
  Array.from(container.querySelectorAll("button")).find(
    (entry) => entry.textContent?.trim() === text,
  )!;
beforeEach(() => {
  vi.resetAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  live = {
    showtimeId: 1,
    map,
    connected: true,
    updatedAt: new Date("2026-08-27T12:00:00Z"),
    refreshing: false,
    error: null,
    reload,
  };
  vi.mocked(useLiveShowtimeMap).mockImplementation(() => live);
  vi.mocked(downloadSeatMapPng).mockResolvedValue();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("event sales map", () => {
  it("renders real counts and seat inspection without a booking action", async () => {
    await mount();
    const sold = Array.from(container.querySelectorAll("dt")).find(
      (entry) => entry.textContent === "Đã bán",
    )!;
    expect(sold.nextElementSibling?.textContent).toBe("1");
    await act(async () =>
      container
        .querySelector('[role="button"]')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(container.textContent).toContain("Ghế A1 · VIP · 100.000đ · Đã bán");
  });
  it("switches the live subscription to the chosen showtime", async () => {
    await mount([row(1), row(2)]);
    await act(async () => {
      const select = container.querySelector("select")!;
      select.value = "2";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(useLiveShowtimeMap).toHaveBeenLastCalledWith(2);
  });
  it("does not open a subscription for a showtime without an applied map", async () => {
    await mount([row(1, false)]);
    expect(useLiveShowtimeMap).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Suất này chưa được áp dụng sơ đồ");
  });
  it("offers a retry while showtimes have not loaded", async () => {
    await mount(null);
    await act(async () => button("Tải lại danh sách suất").click());
    expect(retry).toHaveBeenCalledOnce();
  });
  it("keeps stale data visibly labelled and disables export after a refresh failure", async () => {
    live.error = "Mất mạng";
    await mount();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "dữ liệu đã nhận trước đó",
    );
    expect(button("Lưu ảnh PNG").disabled).toBe(true);
    await act(async () => button("Tải lại").click());
    expect(reload).toHaveBeenCalledOnce();
  });
  it("exports the visible canvas with showtime, timestamp and counts", async () => {
    await mount();
    await act(async () => button("Lưu ảnh PNG").click());
    expect(downloadSeatMapPng).toHaveBeenCalledOnce();
    const options = vi.mocked(downloadSeatMapPng).mock.calls[0][1];
    expect(options.fileName).toContain("so-do-ve-suat-1-");
    expect(options.title).toBe("Đêm nhạc");
    expect(options.notes.join(" ")).toContain("Đã bán 1");
    expect(options.notes.join(" ")).toContain("giờ Việt Nam");
    expect(container.textContent).toContain("Đã lưu ảnh PNG");
  });
  it("shows export failure and allows retry", async () => {
    vi.mocked(downloadSeatMapPng).mockRejectedValueOnce(new Error("Không tải được ảnh nền"));
    await mount();
    await act(async () => button("Lưu ảnh PNG").click());
    expect(container.textContent).toContain("Không tải được ảnh nền");
    expect(button("Lưu ảnh PNG").disabled).toBe(false);
  });
});
