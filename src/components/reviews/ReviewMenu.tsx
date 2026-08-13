import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";

export interface ReviewMenuItem {
  label: string;
  onSelect: () => void;
  /** Draws the item in the removal colour. For anything that throws the comment away. */
  danger?: boolean;
}

/**
 * The per-comment menu: the small button at the top right of a comment and what it opens.
 *
 * Every action that belongs to one comment lives here — editing and deleting your own, reporting
 * somebody else's — rather than as buttons standing in the comment itself. On a wall of comments a
 * row of controls per comment competes with the text they belong to, and the two sets are never
 * shown to the same reader anyway, so a single position that means "this comment" reads the same
 * whichever set is behind it.
 *
 * Renders nothing when there is nothing to offer, so a signed-out reader sees plain comments.
 */
export default function ReviewMenu({ items }: { items: ReviewMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // `pointerdown` rather than `click`: a click that lands on another comment's menu button would
    // otherwise close this one and open that one in the same gesture, or not close it at all.
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Tuỳ chọn bình luận"
        className="grid h-8 w-8 place-items-center rounded-full text-ink-soft transition hover:bg-beige-kem/10 hover:text-beige-kem"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-9 z-20 min-w-[9rem] border border-beige-kem/30 bg-xanh-pho py-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={`block w-full px-4 py-2 text-left font-meta text-meta transition hover:bg-surface-2 ${
                item.danger ? "text-burgundy-ink" : "text-beige-kem"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
