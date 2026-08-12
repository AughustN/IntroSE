/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";

/**
 * A heading over a hairline, a `+` that turns into a `−`, and content underneath once it is open.
 *
 * Lifted out of the filter rail, which had it first, because the event page wants the same object
 * for its blurb. Two hand-rolled copies of a disclosure would drift on the two things that are easy
 * to get subtly different — the reveal curve and what a closed row tells you — and those are
 * exactly the two things that make a page feel of a piece.
 *
 * The open state stays inside. Nothing outside a row reacts to whether it is open, and lifting it
 * would put a field on every caller for no reader.
 */
export default function Disclosure({
  label,
  summary,
  defaultOpen = false,
  heading = "eyebrow",
  children,
}: {
  label: string;
  /**
   * What the row says about itself while closed — the filter's current value, a policy in six
   * words. Without it a stack of closed rows is a list of nouns with no indication which of them
   * is worth opening, which is the failure mode of every collapsed list.
   */
  summary?: string;
  defaultOpen?: boolean;
  /**
   * `eyebrow` is the filter rail's small caps. `section` is the event page, where the row is a
   * section heading in its own right and has to hold its own against the type around it.
   */
  heading?: "eyebrow" | "section";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-beige-kem/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 py-3.5 text-left transition hover:text-burgundy-ink"
      >
        <span
          className={
            heading === "section"
              ? "font-display text-title-s font-black uppercase tracking-[0.03em] text-beige-kem"
              : "label-eyebrow text-beige-kem"
          }
        >
          {label}
        </span>
        {summary && (
          <span className="ml-auto truncate font-meta text-meta text-burgundy-ink">{summary}</span>
        )}
        <span
          aria-hidden="true"
          className={`shrink-0 font-meta text-body leading-none text-ink-soft ${
            summary ? "" : "ml-auto"
          }`}
        >
          {open ? "−" : "+"}
        </span>
      </button>

      {/*
        `menu-panel` is the site's own reveal — `grid-template-rows: 0fr → 1fr`, which animates to
        whatever the content measures without anyone hard-coding a height. The same curve and the
        same duration as the nav's ticket panel and the dropdowns, so every panel on the page opens
        the one way.

        Always mounted, because that is what the animation needs: a row cannot grow from something
        that is not in the tree. `inert` keeps the collapsed rows out of the tab order in the
        meantime, which is the part unmounting used to do for free.
      */}
      <div data-open={open} inert={!open} className="menu-panel">
        <div>
          <div className="pb-5">{children}</div>
        </div>
      </div>
    </div>
  );
}
