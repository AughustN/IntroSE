// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CheckInPanel from "./CheckInPanel";
import { organizerApi, type ScanTicket } from "../../services/catalogClient";

vi.mock("../../services/catalogClient", async (original) => ({
  ...(await original<typeof import("../../services/catalogClient")>()),
  organizerApi: { checkIn: vi.fn(), concessionsRedeem: vi.fn() },
}));
vi.mock("../QrCameraScan", () => ({
  default: ({ onDetect }: { onDetect: (code: string) => void }) =>
    h(
      "div",
      {},
      h("button", { onClick: () => onDetect("QR-A") }, "Quét A"),
      h("button", { onClick: () => onDetect("QR-B") }, "Quét B"),
    ),
}));
const ticket: ScanTicket = {
  id: 1,
  code: "QR-A",
  status: "checked_in",
  tierLabel: "VIP",
  seatLabel: "A1",
  customerName: "Khách thử",
  customerEmail: "test@example.com",
  eventId: 1,
  eventTitle: "Đêm nhạc",
  showtimeId: 2,
  startsAt: "2026-08-27T12:00:00Z",
  venueName: "Nhà hát",
  venueAddress: "TP.HCM",
};
let root: Root;
let container: HTMLDivElement;
const onCheckedIn = vi.fn();
const button = (label: string) =>
  Array.from(container.querySelectorAll("button")).find(
    (entry) => entry.textContent?.trim() === label,
  )!;
const click = async (label: string) => {
  await act(async () => button(label).click());
};
const enterCode = async () => {
  await act(async () => {
    const input = container.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "QR-A");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
beforeEach(async () => {
  vi.resetAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(organizerApi.checkIn).mockResolvedValue({ ticket, already: false });
  await act(async () =>
    root.render(h(CheckInPanel, { eventTitle: "Tất cả sự kiện của bạn", onCheckedIn })),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("list check-in", () => {
  it("focuses manual entry, leaves the camera off, and returns focus on close", async () => {
    const trigger = button("Quét QR check-in");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await click("Quét QR check-in");
    expect(document.activeElement).toBe(container.querySelector("input"));
    expect(button("Quét A")).toBeUndefined();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await click("Đóng check-in");
    expect(document.activeElement).toBe(trigger);
    expect(container.querySelector("input")).toBeNull();
  });
  it("refreshes after a new manual check-in and identifies the event", async () => {
    await click("Quét QR check-in");
    await enterCode();
    await click("Check-in");
    expect(organizerApi.checkIn).toHaveBeenCalledOnce();
    expect(organizerApi.checkIn).toHaveBeenCalledWith("QR-A");
    expect(onCheckedIn).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Đêm nhạc");
    expect(container.textContent).toContain("Đã check-in thành công");
  });
  it("does not refresh attendance on a rescan", async () => {
    vi.mocked(organizerApi.checkIn).mockResolvedValue({ ticket, already: true });
    await click("Quét QR check-in");
    await enterCode();
    await click("Check-in");
    expect(onCheckedIn).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Đã soát vé (quét lại)");
  });
  it("serializes repeated Enter presses while the request is pending", async () => {
    let finish!: (value: { ticket: ScanTicket; already: boolean }) => void;
    vi.mocked(organizerApi.checkIn).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await click("Quét QR check-in");
    await enterCode();
    await act(async () => {
      for (let i = 0; i < 2; i++)
        container
          .querySelector("input")!
          .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(organizerApi.checkIn).toHaveBeenCalledOnce();
    await act(async () => finish({ ticket, already: false }));
  });
  it("includes the event in continuous-camera scan results", async () => {
    await click("Quét QR check-in");
    await click("Mở camera");
    await click("Quét A");
    expect(container.querySelector("ul")?.textContent).toContain("Đêm nhạc");
    expect(onCheckedIn).toHaveBeenCalledOnce();
  });
  it.each(["close", "leave"])("drops queued scans and late results on %s", async (action) => {
    let finish!: (value: { ticket: ScanTicket; already: boolean }) => void;
    vi.mocked(organizerApi.checkIn).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await click("Quét QR check-in");
    await click("Mở camera");
    vi.useFakeTimers();
    await click("Quét A");
    await click("Quét B");
    // Complete the cooldown while the first HTTP request is still in flight.
    await act(async () => vi.advanceTimersByTime(3500));
    if (action === "close") await click("Đóng check-in");
    else await act(async () => root.render(null));
    await act(async () => finish({ ticket, already: false }));
    expect(organizerApi.checkIn).toHaveBeenCalledOnce();
    expect(onCheckedIn).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Khách thử");
  });
});
