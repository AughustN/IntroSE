/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ValidationIssue } from "@/shared/catalog/seatmap-validate";

/**
 * The pre-publish checks, each naming the seats or sections at fault rather than reporting one
 * generic failure (FR-030, FR-031).
 *
 * Fed by the shared validator, so what the organizer sees while drafting is exactly what the publish
 * gate will decide. Advisory here — the server still refuses (R-11). A draft is allowed to sit in a
 * failing state; the gate is at publish, not at every keystroke (FR-032).
 *
 * Every issue is a BUTTON, not a line of text. It used to print the offenders as raw database ids —
 * "(ghế #1284)" — which names a row in a table the organizer has never seen and cannot find on the
 * canvas. An issue is only actionable once it can say *where*, so the panel resolves each id to its
 * human label and, on click, drives the canvas to it.
 */
export default function ValidationPanel({
  issues,
  labelOfSeat,
  onFocusSeat,
}: {
  issues: ValidationIssue[];
  /** Seat id → "Khu A · B12". Falls back to the id when a seat is not in the current projection. */
  labelOfSeat?: (seatId: number) => string | null;
  /** Select the seat's block and zoom the canvas to it. */
  onFocusSeat?: (seatId: number) => void;
}) {
  if (issues.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-la-co bg-surface-2 p-4">
        <h3 className="font-meta text-eyebrow font-bold uppercase tracking-widest text-la-co">
          Hợp lệ
        </h3>
        <p className="mt-1 text-eyebrow text-beige-kem/70">Sơ đồ có thể phát hành.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-bubblegum bg-surface-2 p-4">
      <h3 className="font-meta text-eyebrow font-bold uppercase tracking-widest text-bubblegum">
        {issues.length} vấn đề — chưa thể phát hành
      </h3>
      <ul className="mt-2 space-y-2">
        {issues.map((issue, i) => (
          <li key={`${issue.code}-${i}`} className="text-eyebrow leading-5 text-beige-kem/80">
            {/* Message is plain text from the shared validator — React escapes it (SEC-07). */}
            <span className="font-bold">{issue.message}</span>

            {issue.seatIds && issue.seatIds.length > 0 && (
              <span className="mt-1 flex flex-wrap gap-1">
                {/* Capped: an overlap issue can name hundreds of seats, and a wall of chips buries
                    the message it belongs to. The first few are enough to navigate from. */}
                {issue.seatIds.slice(0, 6).map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onFocusSeat?.(id)}
                    disabled={!onFocusSeat}
                    title="Xem ghế này trên sơ đồ"
                    className="rounded-md border border-bubblegum/60 px-1.5 py-0.5 font-meta text-[10px] text-beige-kem/80 transition hover:border-bubblegum hover:text-beige-kem disabled:cursor-default disabled:opacity-60"
                  >
                    {labelOfSeat?.(id) ?? `#${id}`}
                  </button>
                ))}
                {issue.seatIds.length > 6 && (
                  <span className="self-center font-meta text-[10px] text-beige-kem/50">
                    +{issue.seatIds.length - 6} ghế nữa
                  </span>
                )}
              </span>
            )}

            {issue.sectionIds && issue.sectionIds.length > 0 && (
              <span className="ml-1 font-meta text-eyebrow text-beige-kem/50">
                (khu vực #{issue.sectionIds.join(", #")})
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
