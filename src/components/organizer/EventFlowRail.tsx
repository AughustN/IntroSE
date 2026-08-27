/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Check } from "lucide-react";
import { ACTION_LABEL, type FlowStep } from "./flowSteps";

/**
 * The setup chain for one event, as a rail.
 *
 * It reports; it never forbids. Every tool stays reachable in any order — an organizer fixing a typo
 * on their fourth event should not be walked through a wizard — but the order the SERVER requires is
 * now stated instead of discovered through 409s.
 *
 * The marker vocabulary is `OrganizerSection`'s, deliberately: a numeral that becomes a tick, a rule
 * joining one step to the next. A second visual language for "progress" in the same console would be
 * two things to learn for one idea.
 *
 * Vertical beside the editor where there is room, and the same horizontal strip that section already
 * uses below `lg` — a 240px column of seven rows does not survive a phone.
 */

/*
 * Dark ink on a PALE TINT of the state's own hue — the vocabulary `EventList`'s status badges
 * already settled on, and for the same measured reason.
 *
 * These markers were filling with the saturated hue and printing `on-tint` over it. That is the
 * exact pair `EventList` documents as the defect it fixed: `#6b0a1c` on `la-co` measures 2.75:1
 * against WCAG AA's 4.5, and here it failed in BOTH themes because `on-tint` has no dark override.
 * `blocked` was worse in light — bare `cam-dat` on the page is 2.16:1 — and `todo` at 45% alpha
 * was 2.54:1, which is a numeral nobody can read on the step they have not reached yet.
 *
 * Measured on the page beneath, per state, light · dark:
 *     done     la-co-ink on la-co/20       4.67:1 · 5.62:1
 *     blocked  cam-dat-ink on cam-dat/20   4.75:1 · 6.89:1
 *     todo     beige-kem/70, no fill       4.74:1 · 9.31:1
 *
 * Hue still separates them, and the numeral-to-tick change carries the same information without it.
 */
const MARK: Record<FlowStep["state"], string> = {
  done: "border-la-co/55 bg-la-co/20 text-la-co-ink",
  // Attention with something to do about it. Not bubblegum: nothing has failed, it is simply not done.
  blocked: "border-cam-dat/60 bg-cam-dat/20 text-cam-dat-ink",
  todo: "border-beige-kem/30 text-beige-kem/70",
};

export default function EventFlowRail({
  steps,
  onAction,
}: {
  steps: FlowStep[];
  onAction: (action: NonNullable<FlowStep["action"]>) => void;
}) {
  // The step being waited on: the first that is not done. It carries the burgundy edge, the colour
  // this console reserves for the thing that commits.
  const activeIndex = steps.findIndex((s) => s.state !== "done");

  return (
    <nav aria-label="Các bước chuẩn bị sự kiện" className="lg:sticky lg:top-4">
      <h3 className="mb-3 font-meta text-meta uppercase tracking-widest text-beige-kem/70">
        Chuẩn bị sự kiện
      </h3>

      <ol className="flex gap-3 overflow-x-auto pb-2 lg:block lg:overflow-visible lg:pb-0">
        {steps.map((step, i) => {
          const active = i === activeIndex;
          const last = i === steps.length - 1;
          return (
            <li
              key={step.id}
              aria-current={active ? "step" : undefined}
              className={`min-w-[13rem] shrink-0 lg:min-w-0 lg:border-l-2 lg:pl-3 ${
                active ? "lg:border-burgundy" : "lg:border-beige-kem/15"
              } ${last ? "" : "lg:pb-4"}`}
            >
              <div className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 font-meta text-meta font-bold ${MARK[step.state]}`}
                >
                  {step.state === "done" ? <Check className="h-3 w-3" /> : step.n}
                </span>

                <div className="min-w-0 flex-1">
                  <p
                    className={`font-display text-eyebrow font-bold leading-6 ${
                      step.state === "done" ? "text-beige-kem/70" : "text-beige-kem"
                    }`}
                  >
                    {step.label}
                  </p>

                  {/* Only where it helps: a finished step explaining itself is noise. */}
                  {step.state !== "done" && step.reason && (
                    <p className="mt-0.5 font-meta text-meta leading-5 text-beige-kem/70">
                      {step.reason}
                    </p>
                  )}

                  {step.state === "blocked" && step.action && (
                    <button
                      type="button"
                      onClick={() => onAction(step.action!)}
                      className="mt-1 font-meta text-meta font-bold text-burgundy-ink underline underline-offset-2 transition hover:text-burgundy-ink"
                    >
                      {ACTION_LABEL[step.action]} →
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Each label names the tool it opens, in the words that tool uses for itself — imported from
 *  `flowSteps` so the rail and the strip cannot drift apart (Principle VI). */
