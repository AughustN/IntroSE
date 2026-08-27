import { useEffect, useRef } from "react";

/** Keep keyboard interaction inside the active dialog and return focus to its opener. */
export function useDialogFocus(onClose: () => void, busy = false) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => {
    closeRef.current = onClose;
    busyRef.current = busy;
  }, [onClose, busy]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const items = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex="0"]',
        ),
      ).filter((el) => !el.closest("[hidden], [inert]"));
    (dialog.querySelector<HTMLElement>("[data-dialog-autofocus]") ?? items()[0] ?? dialog).focus();
    const onKey = (e: KeyboardEvent) => {
      const modals = document.querySelectorAll('[aria-modal="true"]');
      if (modals[modals.length - 1] !== dialog) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (!busyRef.current) closeRef.current();
      }
      if (e.key !== "Tab") return;
      const focusable = items();
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      if (
        !dialog.contains(document.activeElement) ||
        (e.shiftKey ? document.activeElement === first : document.activeElement === last)
      ) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return dialogRef;
}
