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

/**
 * The wider measure the card bands share — the landing stack and the `/events` grid.
 *
 * Four landscape cards on `MEASURE` leave each about 300px, narrower than the 16/9 still it has to
 * hold, so those bands run wider. Exported as one string because it was written out by hand in
 * `EventGrid` and `CategoryRow` and left out of `EventTicker` entirely: the ticker's heading sat on
 * `MEASURE` while the headings under it sat on this one, so on any screen past 1600px the first
 * title in the stack was indented 160px further in than the four below it.
 */
export const BAND = `mx-auto w-full max-w-[1600px] ${GUTTER}`;

type Density = "normal" | "tight" | "row";

interface SectionProps {
  children: React.ReactNode;
  /**
   * `tight` is for control strips — filter bars, toolbars — not for content.
   *
   * `row` is for a band in a stack of bands. The landing page runs five of them one after another,
   * and at `normal` the 80px each contributes puts 160px of empty page between two headings: the
   * reader scrolls past a screenful of nothing to reach the next row of cards. At `row` the gap
   * between neighbours is ~32px, close enough that the stack reads as one page.
   */
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
  const pad = density === "row" ? "py-4" : density === "tight" ? "py-8" : "py-20";

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
 * The masthead a section opens with: an eyebrow and heading on the left, with a count and at most
 * one link pushed to the far right of the same baseline.
 *
 * Two ways of announcing itself, because the page now has two jobs for a heading:
 *
 *  - `ruled` is the original — stacked rules above, a hairline below. It suits a section that owns
 *    the screen it is on (`/events`, the ticker), where the rules are the only thing marking where
 *    one band ends.
 *  - `bar` carries a short burgundy stroke down its left edge and draws no rules at all. It is for a
 *    *stack* of bands, where a ruled head repeated five times down one page turns the page into a
 *    ledger: three lines above every title and one below, at 32px intervals, is more rule than
 *    content. The stroke marks a new band in one glyph's worth of ink.
 */
/**
 * A strip of film, drawn as a rule with sprocket holes.
 *
 * Two hairlines with a run of perforations between them — the top and bottom edge of the cinema
 * band, so that section is framed as a reel rather than merely titled. The holes are a repeating
 * gradient rather than elements: there is no count to get right at any width, and nothing for a
 * screen reader to read out.
 *
 * `currentColor` so the caller sets the ink with a text class, and the strip follows the theme
 * instead of hard-coding a colour that only works on one ground.
 */
export function FilmRail({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`h-[18px] border-y border-beige-kem/45 text-beige-kem/30 ${className}`}
      style={{
        backgroundImage:
          "repeating-linear-gradient(to right, currentColor 0 14px, transparent 14px 34px)",
        backgroundSize: "100% 8px",
        backgroundPosition: "center",
        backgroundRepeat: "repeat-x",
      }}
    />
  );
}

export function SectionHead({
  eyebrow,
  title,
  meta,
  actionLabel,
  onAction,
  variant = "ruled",
  /**
   * The band's own mark, set on the eyebrow line rather than beside the title — e.g. the flame on
   * "Sự kiện xu hướng". Up there it sits next to the words it qualifies at eyebrow size; beside a
   * `text-title-l` heading it has to be drawn at 28px to keep up, which makes the glyph, not the
   * heading, the loudest thing in the band.
   */
  icon,
}: {
  eyebrow: string;
  title: string;
  meta?: string;
  actionLabel?: string;
  onAction?: () => void;
  variant?: "ruled" | "bar" | "reel";
  icon?: React.ReactNode;
}) {
  const bar = variant === "bar";

  const right = (
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
  );

  /*
   * Centred, for a band that is framed rather than ruled.
   *
   * The stroke in `bar` is a divider: it marks where one band starts by putting ink down the left
   * of the title. A band already held between two perforated rails does not need that mark — it is
   * bounded on all four sides — and a left-anchored title inside a symmetrical frame reads as
   * having slipped. So the head centres, and the "Xem thêm" sits under it rather than opposite it.
   */
  if (variant === "reel") {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="label-eyebrow flex items-center gap-2 text-ink-soft">
          {icon}
          {eyebrow}
        </p>
        <h2 className="font-display text-title-l font-black leading-none text-beige-kem">
          {title}
        </h2>
        {/*
          `right` still prints here when a caller passes one, but the reel band does not: a way out
          of the band belongs after the band, not between its title and its first card. `CategoryRow`
          puts it at the foot instead, where a reader who has read the row is looking.
        */}
        {right}
      </div>
    );
  }

  if (bar) {
    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-stretch gap-4">
          {/*
            The stroke is the divider, moved into the heading. `self-stretch` rather than a fixed
            height so it always spans exactly the eyebrow and the title, at whatever size the type
            scale renders them.
          */}
          <span aria-hidden="true" className="w-1 shrink-0 self-stretch bg-burgundy" />
          <div>
            <p className="label-eyebrow flex items-center gap-2 text-ink-soft">
              {icon}
              {eyebrow}
            </p>
            <h2 className="mt-2 font-display text-title-l font-black leading-none text-beige-kem">
              {title}
            </h2>
          </div>
        </div>
        {right}
      </div>
    );
  }

  return (
    <div>
      <div className="hud-rule-stack" />
      <div className="mt-5 flex flex-col gap-3 border-b border-beige-kem/25 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="label-eyebrow flex items-center gap-2 text-ink-soft">
            {icon}
            {eyebrow}
          </p>
          <h2 className="mt-2 font-display text-title-l font-black leading-none text-beige-kem sm:text-title-l">
            {title}
          </h2>
        </div>
        {right}
      </div>
    </div>
  );
}
