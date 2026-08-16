/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReactNode } from "react";

/**
 * The console's vocabulary, written down once.
 *
 * The admin screens used to be built with a different rulebook from the rest of the app — rounded
 * panels, tinted pill buttons, their own hairline opacities — so an admin moving between `/events`
 * and `/admin` crossed into what looked like a second product. Worse, the two admin routes had
 * drifted apart from *each other*: 2px borders and rounded corners on `/moderation`, hairlines and
 * squares on `/admin`, for the same queue.
 *
 * The site's language is flat and ruled: square corners, one hairline weight, small-caps controls,
 * and exactly one filled button (burgundy) per group of actions. These strings are that language,
 * so a control added later cannot quietly invent a fifth style.
 */

/** The one filled action in a group: save, confirm, apply. */
export const ACTION_PRIMARY =
  "label-eyebrow inline-flex h-11 items-center gap-1.5 bg-burgundy px-5 text-body text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";

/** Everything else: outlined, quiet, as many per group as needed. */
export const ACTION_GHOST =
  "label-eyebrow inline-flex h-11 items-center gap-1.5 border border-beige-kem/40 px-4 text-body text-beige-kem transition hover:border-beige-kem hover:bg-bubblegum/20 disabled:cursor-not-allowed disabled:opacity-40";

/** A text field. Square, hairline, burgundy on focus — the same treatment the filter rail uses. */
export const FIELD =
  "h-11 border border-beige-kem/25 bg-xanh-pho px-3 font-meta text-body text-beige-kem outline-none transition placeholder:text-ink-soft/60 focus:border-burgundy";

/** A panel inside the console: ruled, unfilled, square. */
export const PANEL = "border border-beige-kem/25 p-4";

/** The heading of a screen — over a rule, so each screen opens the way a section does. */
export function ScreenHead({
  title,
  meta,
  actions,
}: {
  title: string;
  meta?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-beige-kem/25 pb-4">
      <div className="space-y-1">
        <h2 className="font-display text-title-m font-black uppercase tracking-[0.04em] text-beige-kem">
          {title}
        </h2>
        {meta && <p className="font-meta text-body text-ink-soft">{meta}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * A message about what just happened, or failed to.
 *
 * A stroke and a wash, never a filled block: filled blocks in this palette read as buttons, and an
 * error that looks pressable is an error somebody presses.
 */
export function Notice({ tone, children }: { tone: "ok" | "error"; children: ReactNode }) {
  const stroke = tone === "error" ? "border-burgundy bg-bubblegum/25" : "border-la-co bg-la-co/10";
  return (
    <div className={`border-l-2 ${stroke} px-4 py-3 font-meta text-body text-beige-kem`}>
      {children}
    </div>
  );
}

/** Nothing here — said in a way that distinguishes "empty" from "still loading" or "broken". */
export function EmptyState({ text }: { text: string }) {
  return (
    <div className="border border-dashed border-beige-kem/30 px-4 py-12 text-center font-meta text-body text-ink-soft">
      {text}
    </div>
  );
}

/**
 * State, encoded twice.
 *
 * Colour alone is not a state a reader can be assumed to see, so every pill carries its word as
 * well as its fill. The four tones map to the palette's tints, not to invented colours.
 */
export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "good" | "warn" | "bad";
  children: ReactNode;
}) {
  const fill = {
    neutral: "border border-beige-kem/30 text-ink-soft",
    good: "border border-la-co bg-la-co/25 text-beige-kem",
    warn: "bg-cam-dat text-on-tint",
    bad: "bg-burgundy text-white",
  }[tone];
  return (
    <span className={`label-eyebrow inline-flex shrink-0 items-center px-2.5 py-1 ${fill}`}>
      {children}
    </span>
  );
}

/**
 * One figure per cell, and the cells share their rules.
 *
 * `gap-px` over a tinted parent, so the metrics read as one ruled strip rather than as separate
 * boxes — the same construction the card grids use.
 */
export function KpiStrip({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-px border border-beige-kem/25 bg-beige-kem/25 sm:grid-cols-2 lg:grid-cols-4">
      {children}
    </div>
  );
}

/**
 * One headline figure.
 *
 * `onClick` turns the tile into a button rather than adding a link beside it: a KPI that counts work
 * waiting is a thing the reader wants to open, and the whole tile is the target they aim at.
 */
export function Kpi({
  label,
  value,
  note,
  onClick,
}: {
  label: string;
  value: string;
  note?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <p className="label-eyebrow text-ink-soft">{label}</p>
      <p className="mt-2 font-display text-title-m font-black tabular-nums text-beige-kem">
        {value}
      </p>
      {note && <p className="mt-1 font-meta text-body text-ink-soft">{note}</p>}
    </>
  );

  if (!onClick) return <div className="bg-surface-2 p-5">{body}</div>;

  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-surface-2 p-5 text-left transition hover:bg-bubblegum/20"
    >
      {body}
    </button>
  );
}

/**
 * A table that can be wider than its column without taking the page with it.
 *
 * Every data screen here has at least one table that does not fit a laptop, and a page that scrolls
 * sideways as a whole is a page whose navigation walks off the screen.
 */
export function TableScroll({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

export function Th({ children }: { children: ReactNode }) {
  return <th className="py-3 pr-4 text-eyebrow font-bold">{children}</th>;
}

export function Td({ children, nowrap }: { children: ReactNode; nowrap?: boolean }) {
  return <td className={`py-3 pr-4 align-top ${nowrap ? "whitespace-nowrap" : ""}`}>{children}</td>;
}
