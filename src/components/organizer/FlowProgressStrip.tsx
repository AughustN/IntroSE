/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ACTION_LABEL, stepProgress, type FlowStep } from "./flowSteps";

/**
 * The readiness strip — one line above the work, always visible, never sticky.
 *
 * The rail beside the editor is the detailed reading; this is the glance. It exists because the
 * side rail disappears on scroll at `lg` only as a column, and below `lg` it is a horizontal scroll
 * strip the organizer has to seek out. A strip that sits between the header and the content answers
 * the one question every organizer returns to the editor asking: "what is STILL in my way?"
 *
 * Deliberately NOT sticky: the console has no fixed app header, so a pinned strip would float under
 * the browser chrome the moment the organizer scrolls — a decoration more than a control. The rail
 * already owns stickiness where there is room for it.
 *
 * It reads the same `flowSteps` the rail reads, through the same `onAction` hand-off — two surfaces,
 * one chain of server predicates, no second source of truth (Principle VI).
 */
export default function FlowProgressStrip({
  steps,
  onAction,
}: {
  steps: FlowStep[];
  onAction: (action: NonNullable<FlowStep["action"]>) => void;
}) {
  const { doneCount, active } = stepProgress(steps);
  const allDone = steps.every((s) => s.state === "done");

  return (
    <div
      aria-label="Tiến độ chuẩn bị sự kiện"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-2 border-beige-kem/40 bg-surface-2 px-4 py-2.5"
    >
      <span className="font-mono text-[11px] font-bold text-beige-kem/70">
        Chuẩn bị {doneCount}/{steps.length}
      </span>

      {active && (
        <span className="min-w-0 flex-1 font-meta text-meta text-beige-kem/80">
          {allDone ? (
            <span className="text-la-co">{active.label}</span>
          ) : (
            <>
              <span className="font-bold text-beige-kem">{active.label}</span>
              {active.reason && <span className="text-beige-kem/60"> — {active.reason}</span>}
            </>
          )}
        </span>
      )}

      {active?.action && !allDone && (
        <button
          type="button"
          onClick={() => onAction(active.action!)}
          className="shrink-0 font-meta text-meta font-bold text-burgundy-ink underline underline-offset-2 transition hover:text-burgundy"
        >
          {ACTION_LABEL[active.action]} →
        </button>
      )}
    </div>
  );
}
