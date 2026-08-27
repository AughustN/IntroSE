// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import type { AdPackage, AdPurchase } from "@shared/ads/types.js";
import { adsClient } from "../../services/adsClient";
import { organizerApi, type MyEvent } from "../../services/catalogClient";
import AdPackagesPanel from "./AdPackagesPanel";
import { adTransactionText, downloadAdTransaction } from "./adTransaction";

vi.mock("../../services/adsClient", () => ({
  adsClient: { packages: vi.fn(), purchases: vi.fn(), buy: vi.fn() },
}));
vi.mock("../../services/catalogClient", () => ({ organizerApi: { myEvents: vi.fn() } }));

const pkg: AdPackage = {
  id: 1,
  code: "basic",
  name: "Cơ Bản",
  price: 2000000,
  durationDays: 7,
  placements: ["hot_events"],
  description: null,
  availability: [{ placement: "hot_events", reserved: 2, limit: 20, legacy: false }],
};
const event = {
  id: 10,
  title: "Đêm nhạc kiểm thử",
  status: "on_sale",
  moderation: "approved",
  hasUpcoming: true,
} as MyEvent;
const purchase: AdPurchase = {
  id: 9,
  eventId: 10,
  eventTitle: event.title,
  eventSlug: "dem-nhac",
  packageCode: "basic",
  packageName: pkg.name,
  price: pkg.price,
  placements: pkg.placements,
  status: "active",
  startsAt: "2026-08-28T00:00:00Z",
  endsAt: "2026-09-04T00:00:00Z",
  createdAt: "2026-08-28T00:00:00Z",
  live: true,
  serving: true,
  policy: "fair_v1",
  metrics: [{ placement: "hot_events", impressions: 120, clicks: 8, plays: 0 }],
};
let container: HTMLDivElement;
let root: Root;
const findButton = (text: string) => {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === text,
  );
  if (!button) throw new Error("Missing button: " + text);
  return button;
};
const click = async (text: string) => {
  await act(async () => findButton(text).click());
};
const mount = async () => {
  await act(async () => root.render(h(AdPackagesPanel)));
};
const checkbox = () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
const pay = () =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
    b.textContent?.startsWith("Thanh toán "),
  )!;
const selectEvent = async (title = event.title) => {
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Sự kiện cần quảng bá"]')!.click(),
  );
  await click(title);
};
const prepare = async () => {
  await click("Chọn gói này");
  await selectEvent();
  await act(async () => checkbox().click());
};

beforeEach(() => {
  vi.resetAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
  vi.mocked(adsClient.packages).mockResolvedValue([pkg]);
  vi.mocked(adsClient.purchases).mockResolvedValue([]);
  vi.mocked(organizerApi.myEvents).mockResolvedValue([event]);
  vi.mocked(adsClient.buy).mockResolvedValue(purchase);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("advertising redesign", () => {
  it("supports a directly linked campaign tab and reports tab changes to the page", async () => {
    const onTabChange = vi.fn();
    await act(async () => root.render(h(AdPackagesPanel, { activeTab: "campaigns", onTabChange })));
    expect(container.querySelector("#ad-tab-campaigns")?.getAttribute("aria-selected")).toBe(
      "true",
    );
    await act(async () => container.querySelector<HTMLButtonElement>("#ad-tab-discover")!.click());
    expect(onTabChange).toHaveBeenCalledWith("discover");
    await act(async () => root.render(h(AdPackagesPanel, { activeTab: "discover", onTabChange })));
    expect(container.querySelector("#ad-tab-discover")?.getAttribute("aria-selected")).toBe("true");
  });
  it("exports actual paid amounts and policy without presenting the file as a signed contract", () => {
    const text = adTransactionText({ ...purchase, price: 123456, policy: "legacy" });
    expect(text).toContain("123.456");
    expect(text).not.toContain("2.000.000");
    expect(text).toContain("Điều khoản cũ");
    expect(text).not.toContain("fair_v1");
    expect(text).toContain("Không thay thế hóa đơn hoặc hợp đồng có chữ ký");
    expect(text).toContain("Asia/Ho_Chi_Minh");
  });
  it("downloads a text file and releases the temporary URL", async () => {
    vi.useFakeTimers();
    try {
      const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-ad");
      const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
      const clickAnchor = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(function (this: HTMLAnchorElement) {
          expect(this.download).toBe("tixhub-quang-cao-9.txt");
          expect(this.href).toBe("blob:test-ad");
        });
      downloadAdTransaction(purchase);
      expect(clickAnchor).toHaveBeenCalledOnce();
      expect(await (create.mock.calls[0][0] as Blob).text()).toContain("THÔNG TIN GIAO DỊCH");
      expect(document.querySelector("a[download]")).toBeNull();
      vi.runAllTimers();
      expect(revoke).toHaveBeenCalledWith("blob:test-ad");
    } finally {
      vi.useRealTimers();
    }
  });
  it("separates discovery and campaigns with keyboard-operable tabs", async () => {
    await mount();
    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector<HTMLElement>("#ad-panel-campaigns")!.hidden).toBe(true);
    await act(async () =>
      tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[1]);
    expect(container.querySelector<HTMLElement>("#ad-panel-discover")!.hidden).toBe(true);
    await act(async () =>
      tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })),
    );
    expect(document.activeElement).toBe(tabs[0]);
  });
  it("places benefits before the CTA and uses dynamic package entitlements", async () => {
    await mount();
    const card = container.querySelector('article[aria-labelledby="ad-package-1"]')!;
    expect(card.textContent).not.toContain("Luân phiên trailer");
    expect(card.textContent!.indexOf("Báo cáo lượt hiển thị")).toBeLessThan(
      card.textContent!.indexOf("Chọn gói này"),
    );
    expect(card.textContent).toContain("còn 18/20");
    expect(container.querySelector("table caption")?.textContent).toContain("So sánh");
    expect(container.textContent).not.toContain("Phổ biến nhất");
  });
  it("moves keyboard focus with the section shortcuts", async () => {
    await mount();
    await click("Xem các gói");
    expect(document.activeElement?.id).toBe("ad-packages");
    await click("Xem vị trí hiển thị");
    expect(document.activeElement?.id).toBe("ad-placements");
  });
  it("requires event and agreement, and resets consent when changing event", async () => {
    vi.mocked(organizerApi.myEvents).mockResolvedValue([
      event,
      { ...event, id: 11, title: "Sự kiện khác" },
    ]);
    await mount();
    await click("Chọn gói này");
    await act(async () => checkbox().click());
    expect(pay().disabled).toBe(true);
    await selectEvent();
    expect(checkbox().checked).toBe(false);
    await act(async () => checkbox().click());
    expect(pay().disabled).toBe(false);
    await selectEvent("Sự kiện khác");
    expect(checkbox().checked).toBe(false);
    expect(pay().disabled).toBe(true);
  });
  it("retains the chosen event and agreement after a failed payment", async () => {
    vi.mocked(adsClient.buy).mockRejectedValueOnce(new Error("Số dư ví không đủ"));
    await mount();
    await prepare();
    await act(async () => pay().click());
    expect(container.querySelector('#ad-event-picker [role="alert"]')?.textContent).toContain(
      "Số dư ví",
    );
    expect(checkbox().checked).toBe(true);
    expect(pay().disabled).toBe(false);
    expect(container.querySelector("#ad-event-picker")?.textContent).toContain(event.title);
  });
  it("does not charge twice while pending and shows the actual transaction after success", async () => {
    let resolve!: (p: AdPurchase) => void;
    vi.mocked(adsClient.buy).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await mount();
    await prepare();
    const paymentButton = pay();
    await act(async () => {
      paymentButton.click();
      paymentButton.click();
    });
    expect(adsClient.buy).toHaveBeenCalledTimes(1);
    expect(adsClient.buy).toHaveBeenCalledWith(event.id, pkg.id);
    expect(findButton("Huỷ").disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("#ad-tab-campaigns")!.disabled).toBe(true);
    vi.mocked(adsClient.purchases).mockResolvedValue([purchase]);
    await act(async () => resolve(purchase));
    expect(container.querySelector("#ad-event-picker")).toBeNull();
    expect(container.querySelector("#ad-tab-campaigns")?.getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(document.activeElement?.id).toBe("ad-tab-campaigns");
    expect(container.querySelector("#ad-panel-campaigns")?.textContent).toContain(
      "Chi tiết giao dịch",
    );
    expect(container.querySelector("#ad-panel-campaigns")?.textContent).toContain("120");
  });
  it("keeps the successful purchase if refreshing afterwards fails", async () => {
    await mount();
    await prepare();
    vi.mocked(adsClient.packages).mockRejectedValueOnce(new Error("Mất kết nối"));
    await act(async () => pay().click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "không cần thanh toán lần nữa",
    );
    expect(container.querySelector("#ad-panel-campaigns")?.textContent).toContain("Chiến dịch #9");
    expect(container.querySelector("#ad-event-picker")).toBeNull();
    expect(adsClient.buy).toHaveBeenCalledTimes(1);
  });
  it.each(["price", "capacity"])("blocks checkout after refreshed %s changes", async (kind) => {
    await mount();
    await prepare();
    vi.mocked(adsClient.packages).mockResolvedValue([
      {
        ...pkg,
        ...(kind === "price"
          ? { price: 3000000 }
          : {
              availability: [{ placement: "hot_events", reserved: 20, limit: 20, legacy: false }],
            }),
      },
    ]);
    await click("Cập nhật dữ liệu");
    expect(pay().disabled).toBe(true);
    expect(container.querySelector('#ad-event-picker [role="alert"]')).not.toBeNull();
    await act(async () => pay().click());
    expect(adsClient.buy).not.toHaveBeenCalled();
  });
  it("keeps a draft selection while switching between tabs", async () => {
    await mount();
    await prepare();
    await click("Chiến dịch của bạn");
    await act(async () => container.querySelector<HTMLButtonElement>("#ad-tab-discover")!.click());
    expect(checkbox().checked).toBe(true);
    expect(pay().disabled).toBe(false);
  });
  it("warns that hidden events still consume the paid window and preserves legacy terms", async () => {
    vi.mocked(adsClient.purchases).mockResolvedValue([
      { ...purchase, serving: false },
      { ...purchase, id: 12, policy: "legacy" },
    ]);
    await mount();
    const campaigns = container.querySelector("#ad-panel-campaigns")!;
    expect(campaigns.textContent).toContain("Thời hạn gói vẫn tiếp tục tính");
    expect(campaigns.textContent).toContain("Điều khoản cũ · không tự chuyển đổi");
  });
  it("distinguishes unavailable data from an empty package catalogue and retries", async () => {
    vi.mocked(adsClient.packages).mockRejectedValueOnce(new Error("Mất kết nối"));
    await mount();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Mất kết nối");
    expect(container.textContent).not.toContain("Hiện chưa có gói");
    await click("Tải lại danh sách");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(findButton("Chọn gói này")).toBeDefined();
  });
});
