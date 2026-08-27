// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { NavigationGuardProvider } from "../../hooks/NavigationGuard";
import { MediaDropzone } from "../common/MediaDropzone";
import { CancelEventModal } from "./CancelEventModal";
import ShowtimeList from "./ShowtimeList";
import TierPanel from "./TierPanel";
import AdPackagesPanel from "./AdPackagesPanel";
import EventEditor from "./EventEditor";
import { organizerApi, studioApi, type MyEvent } from "../../services/catalogClient";
import { adsClient } from "../../services/adsClient";

vi.mock("../../services/catalogClient", () => ({
  organizerApi: {
    showtimesManage: vi.fn(),
    limits: vi.fn(),
    myEvents: vi.fn(),
    cancel: vi.fn(),
    addShowtime: vi.fn(),
  },
  studioApi: {
    deleteShowtime: vi.fn(),
    updateShowtime: vi.fn(),
    tiers: vi.fn(),
    updateTier: vi.fn(),
    updateEvent: vi.fn(),
  },
}));
vi.mock("../../services/adsClient", () => ({
  adsClient: { packages: vi.fn(), purchases: vi.fn(), buy: vi.fn() },
}));
vi.mock("../../hooks/useEventCategories", () => ({
  useEventCategories: () => [{ code: "music", labelVi: "Âm nhạc" }],
}));
vi.mock("./AiListingPanel", () => ({ default: () => null }));
vi.mock("./CheckInPanel", () => ({ default: () => null }));
vi.mock("./EventMediaEditor", () => ({ default: () => null }));
vi.mock("./OrganizerConcessionsTab", () => ({ default: () => null }));
// DateTimeField's segmented/calendar interactions are separate; exercise the parent's commit boundary.
vi.mock("../DateTimeField", () => ({
  default: ({
    value,
    onChange,
    disabled,
  }: {
    value: string;
    onChange: (v: string) => void;
    disabled: boolean;
  }) =>
    h("input", {
      "aria-label": "Ngày suất",
      value,
      disabled,
      onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    }),
}));

let root: Root;
let container: HTMLDivElement;
const button = (label: string) => {
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (el) => el.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
};
const click = async (label: string) => {
  await act(async () => button(label).click());
};
const change = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  await act(async () => {
    const prototype =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const mount = async (element: ReturnType<typeof h>) => {
  await act(async () => root.render(element));
};
const event: MyEvent = {
  id: 1,
  slug: "test",
  title: "Sự kiện thử",
  description: "Mô tả ban đầu",
  status: "on_sale",
  moderation: "approved",
  reviewNote: null,
  imageUrl: null,
  eventType: "general_admission",
  category: "music",
  venueId: 1,
  totalCapacity: 100,
  soldTickets: 0,
  totalRevenueVnd: 0,
  nextShowtimeAt: "2099-12-12T12:00:00Z",
  venueName: "Nhà hát",
  hasUpcoming: true,
};
const tier = {
  id: 10,
  showtimeId: 2,
  label: "Thường",
  price: 100000,
  capacity: 100,
  sold: 0,
  held: 0,
  remaining: 100,
  archived: false,
  categoryId: null,
};
const showtime = {
  id: 2,
  venueId: 1,
  venueName: "Nhà hát",
  startsAt: "2099-12-12T12:00:00Z",
  status: "on_sale",
  hasSeatMap: false,
  tiers: [tier],
};

beforeEach(() => {
  vi.resetAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(organizerApi.showtimesManage).mockResolvedValue([showtime] as never);
  vi.mocked(organizerApi.limits).mockResolvedValue({ maxTiersPerShowtime: 20 });
  vi.mocked(studioApi.tiers).mockResolvedValue({
    tiers: [tier],
    eventType: "general_admission",
    maxTiersPerShowtime: 20,
  } as never);
  vi.mocked(studioApi.updateShowtime).mockResolvedValue({ returnedToReview: true } as never);
  vi.mocked(studioApi.deleteShowtime).mockResolvedValue({ returnedToReview: true } as never);
  vi.mocked(studioApi.updateTier).mockResolvedValue({ returnedToReview: true } as never);
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("showtime/tier confirmations", () => {
  const list = (isLive = true) =>
    h(ShowtimeList, { eventId: 1, venues: [], isLive, onChanged: vi.fn() });
  it("does not delete before confirmation, keeps the showtime on cancel", async () => {
    await mount(list());
    await click("Xoá suất");
    expect(studioApi.deleteShowtime).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain("chờ duyệt lại");
    await click("Giữ lại suất");
    expect(studioApi.deleteShowtime).not.toHaveBeenCalled();
    await click("Xoá suất");
    await click("Xóa suất chiếu");
    expect(studioApi.deleteShowtime).toHaveBeenCalledTimes(1);
    expect(studioApi.deleteShowtime).toHaveBeenCalledWith(2);
  });
  it("also confirms deletion for a draft, without a review warning", async () => {
    await mount(list(false));
    await click("Xoá suất");
    expect(container.querySelector('[role="alertdialog"]')?.textContent).not.toContain(
      "chờ duyệt lại",
    );
    expect(studioApi.deleteShowtime).not.toHaveBeenCalled();
  });
  it("restores the previous date when review confirmation is declined", async () => {
    await mount(list());
    const date = container.querySelector("input")!;
    const original = date.value;
    await change(date, "2099-12-13T19:00");
    expect(studioApi.updateShowtime).not.toHaveBeenCalled();
    await click("Giữ nguyên");
    expect(date.value).toBe(original);
    expect(studioApi.updateShowtime).not.toHaveBeenCalled();
  });
  it("commits date only after approval", async () => {
    await mount(list());
    await change(container.querySelector("input")!, "2099-12-13T19:00");
    await click("Lưu và gửi duyệt lại");
    expect(studioApi.updateShowtime).toHaveBeenCalledTimes(1);
  });
  it("warns for a price edit and retains the typed price when declined", async () => {
    await mount(h(TierPanel, { showtimeId: 2, isLive: true, onChanged: vi.fn() }));
    await change(container.querySelectorAll("input")[1], "200000");
    await click("Lưu");
    expect(studioApi.updateTier).not.toHaveBeenCalled();
    await click("Giữ nguyên");
    expect(container.querySelectorAll("input")[1].value).toBe("200000");
    await click("Lưu");
    await click("Lưu và gửi duyệt lại");
    expect(studioApi.updateTier).toHaveBeenCalledTimes(1);
  });
  it("saves capacity-only edits without claiming they require review", async () => {
    await mount(h(TierPanel, { showtimeId: 2, isLive: true, onChanged: vi.fn() }));
    await change(container.querySelectorAll("input")[2], "200");
    await click("Lưu");
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(studioApi.updateTier).toHaveBeenCalledTimes(1);
  });
});

describe("event editor exits", () => {
  it("uses the correct back label and does not discard text after failed save", async () => {
    const onBack = vi.fn();
    vi.mocked(studioApi.updateEvent).mockRejectedValue(new Error("Mất kết nối"));
    await mount(
      h(
        MemoryRouter,
        {},
        h(NavigationGuardProvider, {
          children: h(EventEditor, {
            event,
            venues: [],
            onBack,
            onRefresh: vi.fn(),
            onOpenSeatMap: vi.fn(),
          }),
        }),
      ),
    );
    expect(container.textContent).not.toContain("Danh sách sự kiện");
    await change(container.querySelector("textarea")!, "Mô tả mới chưa lưu");
    await click("Quay lại sự kiện");
    expect(onBack).not.toHaveBeenCalled();
    await click("Lưu rồi rời đi");
    expect(onBack).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")?.value).toBe("Mô tả mới chưa lưu");
    expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain("Chưa lưu được");
    await click("Ở lại");
    await click("Quay lại sự kiện");
    await click("Bỏ thay đổi");
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("recoverable cancellation", () => {
  it("keeps the reason after failure and allows a retry", async () => {
    const onConfirm = vi
      .fn()
      .mockRejectedValueOnce(new Error("Mất kết nối"))
      .mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    await mount(h(CancelEventModal, { eventTitle: "Sự kiện thử", onConfirm, onClose }));
    const reason = container.querySelector("textarea")!;
    await change(reason, "Hoãn vì mưa bão");
    await click("Xác Nhận Hủy Sự Kiện");
    expect(onClose).not.toHaveBeenCalled();
    expect(reason.value).toBe("Hoãn vì mưa bão");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Mất kết nối");
    expect(button("Xác Nhận Hủy Sự Kiện").disabled).toBe(false);
    await click("Xác Nhận Hủy Sự Kiện");
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });
  it("prevents closing or double-submitting while cancellation is pending", async () => {
    let finish!: () => void;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const onClose = vi.fn();
    await mount(h(CancelEventModal, { eventTitle: "Sự kiện thử", onConfirm, onClose }));
    await change(container.querySelector("textarea")!, "Lý do thử nghiệm");
    await click("Xác Nhận Hủy Sự Kiện");
    expect(button("Quay Lại").disabled).toBe(true);
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });
});

describe("media and ads accessibility", () => {
  it("offers a native focusable upload button while empty", async () => {
    await mount(
      h(MediaDropzone, {
        label: "Ảnh sự kiện",
        mediaType: "banner",
        onFileSelected: vi.fn(),
        required: true,
      }),
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Chọn ảnh sự kiện"]',
    )!;
    expect(trigger).not.toBeNull();
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const open = vi.spyOn(input, "click");
    await act(async () => trigger.click());
    expect(open).toHaveBeenCalledTimes(1);
    expect(container.querySelector("label")?.htmlFor).toBe(input.id);
  });
  it.each([true, false])(
    "focuses and scrolls to the next step, including empty choices (%s)",
    async (hasEvent) => {
      vi.mocked(adsClient.packages).mockResolvedValue([
        {
          id: 1,
          name: "Gói thử",
          price: 100000,
          durationDays: 7,
          placements: ["hot_events"],
          description: "Quảng cáo",
        },
      ] as never);
      vi.mocked(adsClient.purchases).mockResolvedValue([]);
      vi.mocked(organizerApi.myEvents).mockResolvedValue(hasEvent ? [event] : []);
      await mount(h(AdPackagesPanel));
      const trigger = button("Chọn gói này");
      await click("Chọn gói này");
      const picker = container.querySelector("#ad-event-picker");
      expect(document.activeElement).toBe(picker);
      expect(picker?.scrollIntoView).toHaveBeenCalled();
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      await click(hasEvent ? "Huỷ" : "Quay lại chọn gói");
      expect(document.activeElement).toBe(trigger);
    },
  );
});
