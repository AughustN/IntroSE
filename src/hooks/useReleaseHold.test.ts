// @vitest-environment happy-dom
import { act, createElement as h, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReleaseHold } from "./useReleaseHold";
import { HoldError, holdsClient } from "../services/holdsClient";
import type { HoldSession } from "../types";

vi.mock("../services/holdsClient", async (original) => ({
  ...(await original<typeof import("../services/holdsClient")>()),
  holdsClient: { cancel: vi.fn() },
}));
let root: Root;
let container: HTMLDivElement;
let release: ReturnType<typeof useReleaseHold>;
const onReleased = vi.fn();
const onError = vi.fn();
const onBusyChange = vi.fn();
const session: HoldSession = {
  reservationId: 8,
  showtimeId: 1,
  eventId: "concert",
  eventTitle: "Concert",
  mode: "seated",
  selectedDate: "28/08/2026",
  selectedTime: "19:00",
  seats: [],
  quantities: {},
  expiresAt: Date.now() + 600000,
};
function Harness() {
  const value = useReleaseHold({ onReleased, onError, onBusyChange });
  useEffect(() => {
    release = value;
  }, [value]);
  return null;
}
beforeEach(async () => {
  vi.resetAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root.render(h(Harness)));
});
afterEach(async () => {
  await act(async () => root.unmount());
});

describe("release before changing ticket kind or leaving checkout", () => {
  it("does not clear the current selection or permit switching before cancellation succeeds", async () => {
    let finish!: () => void;
    vi.mocked(holdsClient.cancel).mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const request = release(session);
    expect(onBusyChange).toHaveBeenCalledWith(true);
    expect(onReleased).not.toHaveBeenCalled();
    expect(await release(session)).toBe(false);
    expect(holdsClient.cancel).toHaveBeenCalledOnce();
    finish();
    expect(await request).toBe(true);
    expect(onReleased).toHaveBeenCalledWith(session);
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });
  it.each([new Error("Network failure"), new HoldError("not_owner", "Không có quyền", 403)])(
    "keeps the selection and blocks switching when cancellation fails: %s",
    async (error) => {
      vi.mocked(holdsClient.cancel).mockRejectedValueOnce(error);
      expect(await release(session)).toBe(false);
      expect(onReleased).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledOnce();
      expect(onBusyChange).toHaveBeenLastCalledWith(false);
      // A retry is possible; a failed request must not leave controls permanently disabled.
      vi.mocked(holdsClient.cancel).mockResolvedValueOnce();
      expect(await release(session)).toBe(true);
    },
  );
  it("allows leaving an already expired or cancelled hold", async () => {
    vi.mocked(holdsClient.cancel).mockRejectedValue(
      new HoldError("not_found", "Đơn đã kết thúc", 404),
    );
    expect(await release(session)).toBe(true);
    expect(onReleased).toHaveBeenCalledWith(session);
    expect(onError).not.toHaveBeenCalled();
  });
});
