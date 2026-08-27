// @vitest-environment happy-dom
import { act, createElement as h, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrowserRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavigationGuardProvider, useGuardedNavigate } from "./NavigationGuard";
import { useUnsavedChanges } from "./useUnsavedChanges";

let root: Root;
let container: HTMLDivElement;
const save = vi.fn<() => Promise<boolean>>();
function Editor() {
  const [dirty, setDirty] = useState(false);
  const navigate = useGuardedNavigate();
  const { dialog } = useUnsavedChanges({ dirty, busy: false, save });
  return h(
    "div",
    {},
    h("button", { onClick: () => setDirty(true) }, "Sửa"),
    h("button", { onClick: () => navigate("/other") }, "Rời đi"),
    h("button", { onClick: () => navigate(-1) }, "Lùi lịch sử"),
    dialog,
  );
}
function Page() {
  const location = useLocation();
  return h(
    "div",
    {},
    h("output", {}, location.pathname),
    location.pathname === "/edit" ? h(Editor) : h("p", {}, "Trang khác"),
  );
}
const findButton = (label: string) => {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent === label,
  );
  if (!button) throw new Error(`Missing ${label}`);
  return button;
};
const click = async (label: string) => {
  await act(async () => findButton(label).click());
};
const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
};

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  save.mockReset().mockResolvedValue(true);
  window.history.replaceState({ idx: 0 }, "", "/list");
  window.history.pushState({ idx: 1 }, "", "/edit");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      h(StrictMode, {}, h(BrowserRouter, {}, h(NavigationGuardProvider, { children: h(Page) }))),
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("unsaved event navigation", () => {
  it("asks once for programmatic Back instead of guarding both navigate and POP", async () => {
    await click("Sửa");
    await click("Lùi lịch sử");
    await settle();
    await click("Bỏ thay đổi");
    await settle();
    expect(window.location.pathname).toBe("/list");
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });
  it("does not interrupt navigation from an untouched form", async () => {
    await click("Rời đi");
    expect(window.location.pathname).toBe("/other");
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });
  it("keeps the form on Stay and discards only after explicit approval", async () => {
    await click("Sửa");
    await click("Rời đi");
    expect(window.location.pathname).toBe("/edit");
    expect(document.activeElement).toBe(findButton("Ở lại"));
    await click("Ở lại");
    expect(window.location.pathname).toBe("/edit");
    await click("Rời đi");
    await click("Bỏ thay đổi");
    expect(window.location.pathname).toBe("/other");
  });
  it("leaves only after a successful save", async () => {
    save.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await click("Sửa");
    await click("Rời đi");
    await click("Lưu rồi rời đi");
    expect(window.location.pathname).toBe("/edit");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await click("Lưu rồi rời đi");
    expect(window.location.pathname).toBe("/other");
    expect(save).toHaveBeenCalledTimes(2);
  });
  it("warns about reload only while there are unsaved changes", async () => {
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    await click("Sửa");
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
    await click("Rời đi");
    await click("Bỏ thay đổi");
    const gone = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(gone);
    expect(gone.defaultPrevented).toBe(false);
  });
  it("restores Browser Back before asking, then continues to the intended entry", async () => {
    await click("Sửa");
    await act(async () => window.history.back());
    await settle();
    expect(window.location.pathname).toBe("/edit");
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
    await click("Ở lại");
    expect(window.location.pathname).toBe("/edit");
    await act(async () => window.history.back());
    await settle();
    await click("Bỏ thay đổi");
    await settle();
    expect(window.location.pathname).toBe("/list");
    expect(container.querySelector("output")?.textContent).toBe("/list");
  });
  it("traps Tab and lets Escape cancel the exit without losing focus", async () => {
    await click("Sửa");
    const opener = findButton("Rời đi");
    opener.focus();
    await click("Rời đi");
    const stay = findButton("Ở lại");
    const last = findButton("Lưu rồi rời đi");
    await act(async () =>
      stay.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(last);
    await act(async () =>
      last.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
      ),
    );
    expect(document.activeElement).toBe(stay);
    await act(async () =>
      stay.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      ),
    );
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
