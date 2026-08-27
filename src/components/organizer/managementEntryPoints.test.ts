// @vitest-environment happy-dom
import { act, createElement as h, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OrganizerConsole from "./OrganizerConsole";
import { organizerApi, type MyEvent } from "../../services/catalogClient";

vi.mock("../../services/catalogClient", () => ({
  organizerApi: {
    myEvents: vi.fn(),
    myVenues: vi.fn(),
    preview: vi.fn(),
    showtimesManage: vi.fn(),
  },
}));
vi.mock("./EventEditor", () => ({ default: () => h("div", {}, "Trình chỉnh sửa") }));
vi.mock("./EventSalesMap", () => ({
  default: ({ eventTitle }: { eventTitle: string }) =>
    h("section", { "aria-label": "Sơ đồ vé" }, eventTitle),
}));

const event: MyEvent = {
  id: 1,
  slug: "dem-nhac",
  title: "Đêm nhạc thử",
  description: "Nội dung sự kiện",
  status: "on_sale",
  moderation: "approved",
  reviewNote: null,
  imageUrl: null,
  eventType: "seated",
  category: "music",
  venueId: 1,
  venueName: "Nhà hát",
  totalCapacity: 100,
  soldTickets: 5,
  totalRevenueVnd: 500000,
  nextShowtimeAt: "2099-12-12T12:00:00Z",
  hasUpcoming: true,
};
let root: Root;
let container: HTMLDivElement;
const button = (label: string) =>
  Array.from(container.querySelectorAll("button")).find(
    (entry) => entry.textContent?.trim() === label,
  )!;
const click = async (label: string) => {
  await act(async () => button(label).click());
};
function Console({ initialId = null }: { initialId?: number | null }) {
  const [id, setId] = useState(initialId);
  return h(OrganizerConsole, {
    selectedEventId: id,
    onSelectEvent: setId,
    onCreateRequested: vi.fn(),
    onOpenSeatMap: vi.fn(),
    reloadKey: 0,
  });
}
const mount = async (initialId: number | null = null) => {
  await act(async () => root.render(h(Console, { initialId })));
};
beforeEach(() => {
  vi.resetAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(organizerApi.myEvents).mockResolvedValue([event]);
  vi.mocked(organizerApi.myVenues).mockResolvedValue([]);
  vi.mocked(organizerApi.showtimesManage).mockResolvedValue([]);
  vi.mocked(organizerApi.preview).mockResolvedValue({
    description: "Nội dung sự kiện",
    tiers: [],
    lineup: [],
    genre: [],
    ageRestriction: "all",
    rating: null,
  } as never);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("management shortcuts", () => {
  it("opens check-in directly on the list without fetching maps or opening an editor", async () => {
    await mount();
    expect(button("Quét QR check-in")).toBeDefined();
    expect(container.querySelector('[aria-label="Mã vé hoặc mã nhận bắp nước"]')).toBeNull();
    await click("Quét QR check-in");
    expect(container.textContent).toContain("Tất cả sự kiện của bạn");
    expect(container.querySelector('[aria-label="Mã vé hoặc mã nhận bắp nước"]')).not.toBeNull();
    expect(organizerApi.showtimesManage).not.toHaveBeenCalled();
    expect(organizerApi.preview).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Trình chỉnh sửa");
  });
  it.each(["on_sale", "finished", "cancelled"] as const)(
    "shows the seated map before the description even when event is %s",
    async (status) => {
      vi.mocked(organizerApi.myEvents).mockResolvedValue([{ ...event, status }]);
      await mount(1);
      const map = container.querySelector('[aria-label="Sơ đồ vé"]')!;
      expect(map).not.toBeNull();
      expect(organizerApi.showtimesManage).toHaveBeenCalledOnce();
      expect(organizerApi.showtimesManage).toHaveBeenCalledWith(1);
      const description = Array.from(container.querySelectorAll("h3")).find(
        (heading) => heading.textContent === "Mô tả & thông tin sự kiện",
      )!;
      expect(
        map.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(button("Quét QR check-in")).toBeUndefined();
      await click("Danh sách sự kiện");
      expect(container.querySelector('[aria-label="Sơ đồ vé"]')).toBeNull();
      expect(button("Quét QR check-in")).toBeDefined();
    },
  );
  it("does not load a seat map for general admission", async () => {
    vi.mocked(organizerApi.myEvents).mockResolvedValue([
      { ...event, eventType: "general_admission" },
    ]);
    await mount(1);
    expect(organizerApi.showtimesManage).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-label="Sơ đồ vé"]')).toBeNull();
    expect(container.textContent).toContain("Nội dung sự kiện");
  });
  it("lets map loading fail and retry without hiding the event description", async () => {
    vi.mocked(organizerApi.showtimesManage).mockRejectedValueOnce(new Error("Mất mạng"));
    await mount(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Mất mạng");
    expect(container.textContent).toContain("Nội dung sự kiện");
    await click("Thử lại");
    expect(container.querySelector('[aria-label="Sơ đồ vé"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("does not offer a scanner for an empty portfolio", async () => {
    vi.mocked(organizerApi.myEvents).mockResolvedValue([]);
    await mount();
    expect(button("Quét QR check-in")).toBeUndefined();
  });
});
