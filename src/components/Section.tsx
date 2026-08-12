/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The page grid, in one place.
 *
 * What makes doronsupply.com hold together is not any single section — it is that every section
 * sits on the same measure, the same gutter and the same vertical rhythm, so the eye stops noticing
 * the container and reads the content. This app had drifted the other way: nine hand-written
 * `mx-auto max-w-7xl` wrappers and four different section paddings (`py-8`, `py-10`, `py-16`,
 * `py-20`) chosen ad hoc.
 *
 * Route every full-width band through `Section` and the rhythm stops being a per-component
 * decision.
 */

/** One measure, one gutter. Changing these two lines re-grids the whole site. */
const MEASURE = "mx-auto w-full max-w-7xl";
const GUTTER = "px-4 sm:px-6 lg:px-8";

type Density = "normal" | "tight";

interface SectionProps {
  children: React.ReactNode;
  /** `tight` is for control strips — filter bars, toolbars — not for content. */
  density?: Density;
  /** Draw the hairline that separates this band from the one above. */
  divided?: boolean;
  /**
   * Let the children run past the measure to the viewport edge. For horizontal scrollers, which
   * must be able to bleed off-screen or they look clipped rather than continued.
   */
  bleed?: boolean;
  /**
   * Draw the measure's own left and right edges as hairlines.
   *
   * Doron does this on every band — the outer section carries the horizontal rules and an inner
   * wrapper carries the vertical pair — which is what makes the column visible as a column rather
   * than as whitespace that happens to be the same width each time.
   */
  ruled?: boolean;
  className?: string;
}

export default function Section({
  children,
  density = "normal",
  divided = true,
  bleed = false,
  ruled = false,
  className = "",
}: SectionProps) {
  const pad = density === "tight" ? "py-8" : "py-20";

  return (
    <section
      className={`bg-xanh-pho ${pad} ${divided ? "border-t border-beige-kem/25" : ""} ${
        bleed ? "" : GUTTER
      } ${className}`}
    >
      {bleed ? (
        children
      ) : (
        <div className={`${MEASURE} ${ruled ? "border-x border-beige-kem/25" : ""}`}>
          {children}
        </div>
      )}
    </section>
  );
}

/** The measure on its own, for bleeding sections that still want a contained header. */
export function SectionMeasure({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`${MEASURE} ${GUTTER} ${className}`}>{children}</div>;
}

/**
 * The masthead every section opens with: stacked rules, then an eyebrow and heading on the left
 * with a count and at most one link pushed to the far right of the same baseline.
 */
export function SectionHead({
  eyebrow,
  title,
  meta,
  actionLabel,
  onAction,
}: {
  eyebrow: string;
  title: string;
  meta?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div>
      <div className="hud-rule-stack" />
      <div className="mt-5 flex flex-col gap-3 border-b border-beige-kem/25 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="label-eyebrow text-ink-soft">{eyebrow}</p>
          <h2 className="mt-2 font-display text-title-l font-black leading-none text-beige-kem sm:text-title-l">
            {title}
          </h2>
        </div>
        <div className="flex items-center gap-5">
          {meta && <span className="font-meta text-eyebrow text-ink-soft">{meta}</span>}
          {actionLabel && onAction && (
            <button
              type="button"
              onClick={onAction}
              className="label-eyebrow inline-flex items-center gap-2 text-beige-kem transition hover:text-burgundy-ink"
            >
              {actionLabel}
              <span aria-hidden="true">&gt;</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
