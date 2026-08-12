import { Star } from "lucide-react";

interface StarRatingProps {
  /** 1–5, or 0 for "nothing chosen yet" in the interactive mode. */
  value: number;
  /** Omit for a read-only display; supply it and the stars become a control. */
  onChange?: (value: number) => void;
  size?: number;
  /** Names the group for assistive technology. Required when interactive. */
  label?: string;
}

const STARS = [1, 2, 3, 4, 5];

/**
 * Stars, in one component and two modes.
 *
 * Read-only it is a picture of a number; interactive it is a real radio group — five inputs with one
 * name, so arrow keys move between them, Tab enters and leaves the group as one stop, and a screen
 * reader announces "3 of 5" rather than five unrelated buttons. Drawing it out of `<div>`s with
 * click handlers is what makes a rating control unreachable without a mouse, and it is the most
 * commonly skipped part of exactly this widget.
 */
export default function StarRating({ value, onChange, size = 20, label }: StarRatingProps) {
  const interactive = Boolean(onChange);

  if (!interactive) {
    return (
      <span
        className="inline-flex items-center gap-0.5"
        role="img"
        aria-label={`${value} trên 5 sao`}
      >
        {STARS.map((star) => (
          <Star
            key={star}
            aria-hidden="true"
            style={{ width: size, height: size }}
            className={
              star <= Math.round(value)
                ? "fill-burgundy text-burgundy"
                : "fill-transparent text-beige-kem/30"
            }
          />
        ))}
      </span>
    );
  }

  return (
    <span role="radiogroup" aria-label={label ?? "Chấm điểm"} className="inline-flex items-center gap-1">
      {STARS.map((star) => (
        <label
          key={star}
          className="cursor-pointer p-0.5 transition hover:scale-110 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-burgundy"
        >
          {/* The real input, visually hidden but focusable — not `display:none`, which would take it
              out of the tab order and out of the accessibility tree along with it. */}
          <input
            type="radio"
            name={label ?? "rating"}
            value={star}
            checked={value === star}
            onChange={() => onChange?.(star)}
            className="sr-only"
          />
          <Star
            aria-hidden="true"
            style={{ width: size, height: size }}
            className={
              star <= value ? "fill-burgundy text-burgundy" : "fill-transparent text-beige-kem/35"
            }
          />
          <span className="sr-only">{star} sao</span>
        </label>
      ))}
    </span>
  );
}
