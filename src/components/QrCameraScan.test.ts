// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QrCameraScan from "./QrCameraScan";

vi.mock("jsqr", () => ({ default: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
let getUserMedia: ReturnType<typeof vi.fn>;
const stopTrack = vi.fn();
const onError = vi.fn();
const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
const click = async (label: string) => {
  await act(async () =>
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === label)!
      .click(),
  );
};
beforeEach(async () => {
  vi.resetAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  getUserMedia = vi.fn();
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("requestAnimationFrame", vi.fn());
  // The fake stream is sufficient for track cleanup; happy-dom otherwise requires its own class.
  vi.spyOn(HTMLMediaElement.prototype, "srcObject", "set").mockImplementation(() => {});
  await act(async () =>
    root.render(h(QrCameraScan, { onDetect: vi.fn(), onError, onClose: vi.fn() })),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("camera navigation cleanup", () => {
  it("stops a permission-granted stream that arrives after leaving the page", async () => {
    let grant!: (value: MediaStream) => void;
    getUserMedia.mockReturnValue(
      new Promise((resolve) => {
        grant = resolve;
      }),
    );
    await click("Quét bằng camera");
    await act(async () => root.render(null));
    await act(async () => grant(stream));
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
  it.each(["leave", "stop"])(
    "does not restart a scanning loop when video.play resolves after %s",
    async (action) => {
      let play!: () => void;
      getUserMedia.mockResolvedValue(stream);
      vi.spyOn(HTMLMediaElement.prototype, "play").mockReturnValue(
        new Promise<void>((resolve) => {
          play = resolve;
        }),
      );
      await click("Quét bằng camera");
      if (action === "leave") await act(async () => root.render(null));
      else await click("Dừng");
      await act(async () => play());
      expect(stopTrack).toHaveBeenCalledOnce();
      expect(requestAnimationFrame).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    },
  );
});
