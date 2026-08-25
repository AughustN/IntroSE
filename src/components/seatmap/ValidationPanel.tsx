/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { blockingIssues, type ValidationIssue } from "@/shared/catalog/seatmap-validate";

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
  onRenumberSection,
  onAddStage,
}: {
  issues: ValidationIssue[];
  /** Seat id → "Khu A · B12". Falls back to the id when a seat is not in the current projection. */
  labelOfSeat?: (seatId: number) => string | null;
  /** Select the seat's block and zoom the canvas to it. */
  onFocusSeat?: (seatId: number) => void;
  /**
   * Renumber one section, for the issues a renumber actually fixes (§41 "Fix Automatically").
   *
   * Offered only on `duplicate_label`, which is the numbering conflict: two seats in one section
   * sharing a row and number. Overlapping seats, a missing class or an empty zone are not numbering
   * problems and no renumber would touch them — a "fix" button on those would be a button that does
   * nothing.
   */
  onRenumberSection?: (sectionId: number) => void;
  /**
   * Drop a stage on the chart, for `focal_point_unset` — the same "fix it from here" affordance
   * `onRenumberSection` gives the numbering conflict.
   *
   * A warning that only names the problem makes the organizer go and find the tool; and this one is
   * easy to read as pedantry rather than as the thing that decides which seats get offered first.
   * The button is what turns it into a decision they can act on without leaving the panel.
   */
  onAddStage?: () => void;
}) {
  /*
   * Split by severity, because the panel's heading is a VERDICT and a warning does not change it.
   * Counting warnings into "N vấn đề — chưa thể phát hành" would tell an organizer with a perfectly
   * publishable chart that they cannot publish, which the server would then contradict.
   */
  const blocking = blockingIssues(issues);
  const warnings = issues.filter((i) => i.severity === "warning");

  if (blocking.length === 0) {
    return (
      <div className="border-2 border-la-co-ink bg-surface-2 p-4">
        <h3 className="font-meta text-eyebrow font-bold uppercase tracking-widest text-la-co-ink">
          Hợp lệ
        </h3>
        <p className="mt-1 text-eyebrow text-beige-kem/70">Sơ đồ có thể phát hành.</p>
        {warnings.map((issue, i) => (
          <Warning key={`${issue.code}-${i}`} issue={issue} onAddStage={onAddStage} />
        ))}
      </div>
    );
  }

  return (
    <div className="border-2 border-burgundy-ink bg-surface-2 p-4">
      <h3 className="font-meta text-eyebrow font-bold uppercase tracking-widest text-burgundy-ink">
        {blocking.length} vấn đề — chưa thể phát hành
      </h3>
      <ul className="mt-2 space-y-2">
        {blocking.map((issue, i) => (
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
                    className="border border-bubblegum/60 px-1.5 py-0.5 font-meta text-[10px] text-beige-kem/80 transition hover:border-bubblegum hover:text-beige-kem disabled:cursor-default disabled:opacity-60"
                  >
                    {labelOfSeat?.(id) ?? `#${id}`}
                  </button>
                ))}
                {issue.seatIds.length > 6 && (
                  <span className="self-center font-meta text-[10px] text-beige-kem/70">
                    +{issue.seatIds.length - 6} ghế nữa
                  </span>
                )}
              </span>
            )}

            {issue.code === "duplicate_label" &&
              onRenumberSection &&
              issue.sectionIds?.length === 1 && (
                <button
                  type="button"
                  onClick={() => onRenumberSection(issue.sectionIds![0])}
                  title="Đánh lại số cho khu này để hết trùng nhãn"
                  className="ml-1 border border-la-co-ink px-1.5 py-0.5 font-meta text-[10px] text-la-co-ink transition hover:bg-la-co/10"
                >
                  Sửa tự động
                </button>
              )}

            {issue.sectionIds && issue.sectionIds.length > 0 && (
              <span className="ml-1 font-meta text-eyebrow text-beige-kem/70">
                (khu vực #{issue.sectionIds.join(", #")})
              </span>
            )}
          </li>
        ))}
      </ul>
      {warnings.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-beige-kem/20 pt-2">
          {warnings.map((issue, i) => (
            <Warning key={`${issue.code}-${i}`} issue={issue} onAddStage={onAddStage} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One advisory, in the same shape whether the chart is otherwise clean or not.
 *
 * Extracted because the panel returns early for a publishable chart and so renders warnings twice;
 * before this, the fix button would have had to be written into both branches, which is how the two
 * copies drift.
 */
function Warning({ issue, onAddStage }: { issue: ValidationIssue; onAddStage?: () => void }) {
  return (
    <p className="mt-2 border-l-2 border-cam-dat pl-2 text-eyebrow leading-5 text-beige-kem/70">
      {/* Message is plain text from the shared validator — React escapes it (SEC-07). */}
      <span className="font-bold text-cam-dat-ink">Lưu ý</span> · {issue.message}
      {issue.code === "focal_point_unset" && onAddStage && (
        <button
          type="button"
          onClick={onAddStage}
          title="Đặt một sân khấu vào giữa khung nhìn — kéo tới đúng chỗ sau"
          className="ml-1 border border-cam-dat-ink px-1.5 py-0.5 font-meta text-[10px] text-cam-dat-ink transition hover:bg-cam-dat/10"
        >
          Thêm sân khấu
        </button>
      )}
    </p>
  );
}
