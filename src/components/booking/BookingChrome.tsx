/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ArrowLeft, Clock3, type LucideIcon } from "lucide-react";
import type { MovieEvent } from "../../types";
import { formatEventDate } from "../../services/formatDate";
import { formatHoldClock } from "../../services/holdSession";
import { formatVnd } from "../../services/currency";

/**
 * The furniture the three booking screens share.
 *
 * Chọn suất, chọn ghế and thanh toán were three pages that happened to be about the same purchase:
 * three step indicators written out by hand and drifting apart, three different summaries of the
 * same order in three different places on the page, and a hold clock that lived in the top bar on
 * one screen and in a tinted box halfway down the sidebar on another. A buyer stepping between them
 * had to re-find what they were buying, what it cost and how long they had, every time.
 *
 * Everything in this file exists so those three answers sit in the same place on all three screens.
 * The pattern is the one every ticketing site converges on — Ticketbox, the cinema chains, the
 * international sellers — because it is the one that survives a buyer changing their mind twice.
 */

/** A short fact with a glyph, for the row across the top of the panel. */
export interface SummaryHighlight {
  icon: LucideIcon;
  label: string;
}

/** A label/value pair for the tinted block under the highlights. */
export interface SummaryDetail {
  label: string;
  value: string;
}

/** One line of the order: a ticket tier with a quantity, or a single seat. */
export interface SummaryLine {
  key: string;
  label: string;
  /** Under the label, quieter. Seat section, tier blurb — anything that is not the name. */
  detail?: string;
  amount: number;
  /** Present on lines the buyer can drop from here, which is only ever the seat list. */
  onRemove?: () => void;
}

/**
 * How many chapters the purchase has, and what they are called.
 *
 * A seated order has three: pick the showtime, pick the seats, pay. General admission has two —
 * there is no seat map, so the showtime and the quantity are one decision made on one page, and a
 * stepper that split them into "01 Chọn suất" and "02 Chọn số lượng vé" was numbering two halves of
 * a single screen as if the buyer travelled between them.
 */
const stepLabels = (seated: boolean): readonly string[] =>
  seated ? ["Chọn suất", "Chọn ghế", "Thanh toán"] : ["Chọn vé", "Thanh toán"];

export type BookingStep = 1 | 2 | 3;

/**
 * The chapters, with rules between them and the current one filled.
 *
 * Filled rather than tinted: burgundy text on cream measures 4.45:1, under AA for type this small,
 * and the step you are on is the one piece of state on this bar that has to be unmissable.
 *
 * A finished step is a button, and pressing it does exactly what the back link does — which now
 * means cancelling the order. There is no jumping *forward*: every backward move in this flow
 * releases the hold, so there is never a later step still holding state to return to.
 */
export function BookingSteps({
  current,
  seated,
  onGoToStep,
}: {
  current: BookingStep;
  seated: boolean;
  /** Called with a step strictly before `current`. Omit to make every step inert. */
  onGoToStep?: (step: BookingStep) => void;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-2 font-meta text-meta">
      {stepLabels(seated).map((label, index) => {
        const step = (index + 1) as BookingStep;
        const active = step === current;
        const reachable = step < current;
        const number = String(step).padStart(2, "0");

        return (
          <li key={label} className="flex items-center gap-3">
            {index > 0 && <span aria-hidden="true" className="h-px w-6 bg-beige-kem/40" />}
            {reachable && onGoToStep ? (
              <button
                type="button"
                onClick={() => onGoToStep(step)}
                className="px-2 py-1 text-ink-soft underline-offset-4 transition hover:text-beige-kem hover:underline"
              >
                {number} {label}
              </button>
            ) : (
              <span
                aria-current={active ? "step" : undefined}
                className={`px-2 py-1 ${
                  active ? "bg-burgundy font-bold text-white" : "text-ink-soft"
                }`}
              >
                {number} {label}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The bar every booking screen opens with: where you came from, and where you are.
 */
export function BookingHeader({
  backLabel,
  onBack,
  current,
  seated,
  onGoToStep,
}: {
  backLabel: string;
  onBack: () => void;
  current: BookingStep;
  seated: boolean;
  onGoToStep?: (step: BookingStep) => void;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-beige-kem/30 pb-4 lg:flex-row lg:items-center lg:justify-between">
      <button
        onClick={onBack}
        className="flex items-center gap-2 self-start font-meta text-meta text-ink-soft transition hover:text-beige-kem"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {backLabel}
      </button>
      <BookingSteps current={current} seated={seated} onGoToStep={onGoToStep} />
    </div>
  );
}

/**
 * The event, as a torn-off stub across the top of the flow.
 *
 * Ticketbox opens its event page with the same object and the shape is already in this codebase as
 * `ticket-corners` — it was drawn for the nav's ticket panel and never used anywhere a ticket is
 * actually being bought. Poster, title, when and where: what a buyer checks to know the purchase is
 * still the right one.
 *
 * Sized to be the masthead of the page rather than a badge above it. The first pass ran it at a
 * 64px poster and an 18px title, which put it below the step indicator in weight — the event you
 * are buying reading as smaller than the navigation over it. `truncate` on all three lines keeps
 * the block exactly three lines tall whatever the title does, so the step underneath never moves.
 */
export function TicketStub({
  event,
  date,
  time,
}: {
  event: MovieEvent;
  date?: string;
  time?: string;
}) {
  return (
    <div className="ticket-corners flex items-center gap-5 bg-surface-2 p-4 sm:gap-8 sm:p-6">
      <img
        src={event.imageUrl}
        alt=""
        aria-hidden="true"
        referrerPolicy="no-referrer"
        className="h-24 w-36 shrink-0 object-cover sm:h-32 sm:w-48"
      />
      <div className="min-w-0 flex-1">
        <h2 className="truncate font-display text-title-m font-black uppercase leading-tight tracking-[0.03em] text-beige-kem sm:text-title-l">
          {event.title}
        </h2>
        <p className="mt-2 truncate font-meta text-body text-beige-kem/85 sm:text-body">
          {date ? `${time ? `${time} · ` : ""}${formatEventDate(date, true)}` : "Chưa chọn suất"}
        </p>
        <p className="mt-0.5 truncate font-meta text-body text-ink-soft sm:text-body">
          {[event.venueName, event.city].filter(Boolean).join(" · ")}
        </p>
      </div>
    </div>
  );
}

/**
 * The order, in the same place on every screen.
 *
 * Sticky, because the thing a buyer checks most often while picking seats is what they have picked
 * so far. `h-fit` keeps the box its own height — stretched to the row it would have nothing to
 * scroll inside and would never stick.
 *
 * The hold clock lives here rather than in the step bar. It used to sit at the top of the page,
 * which is the first thing to leave the screen on a long seat map — a countdown you have to scroll
 * up to read is a countdown you will miss the end of.
 */
export function OrderSummary({
  event,
  date,
  time,
  venue,
  highlights,
  details,
  lines,
  total,
  holdMs,
  emptyLabel,
  ctaLabel,
  onCta,
  ctaDisabled = false,
  ctaReplacement,
  note,
  reassurance,
  children,
}: {
  event: MovieEvent;
  date?: string;
  time?: string;
  venue?: string;
  /**
   * Four short facts with glyphs, across the top.
   *
   * The event's particulars used to live in a two-column definition list at the very bottom of the
   * page — under the booking step, under the blurb, under the policies. A buyer deciding whether to
   * press the button had to scroll past the button to find out how long the thing runs or who it is
   * for. They belong beside the price, which is where the reference puts them and where every other
   * decision on this page already is.
   */
  highlights?: SummaryHighlight[];
  /** The longer facts, in a tinted block: venue, city, the chosen showtime. */
  details?: SummaryDetail[];
  lines: SummaryLine[];
  total: number;
  /** Omit where no hold exists yet. Zero renders the dashes, not 00:00. */
  holdMs?: number;
  emptyLabel: string;
  ctaLabel: string;
  onCta: () => void;
  ctaDisabled?: boolean;
  /**
   * Something to put where the button goes, when the panel's action is no longer "buy this".
   *
   * A sold-out showtime is the case: its button would be a disabled label saying "Hết vé", and the
   * thing the reader can actually do — take a place in the queue — has nowhere else to live.
   */
  ctaReplacement?: React.ReactNode;
  /** Under the button — the sign-in warning, the tax note. */
  note?: string;
  /** Quieter still, under the note. The refund promise, which is reassurance rather than warning. */
  reassurance?: string;
  /** Extra rows between the lines and the total. The wallet balance, on checkout. */
  children?: React.ReactNode;
}) {
  const holding = holdMs !== undefined && holdMs > 0;

  return (
    <aside className="lg:sticky lg:top-24 lg:h-fit">
      {/*
        Blocks on the page, not compartments inside a box.

        This was one bordered card with hairlines ruling it into four. The reference stacks tinted
        blocks with page showing between them and draws no outline at all — which reads quieter and,
        on this palette, actually works: `surface-2` measures 1.03:1 against the page in the light
        theme, so a card fill here was invisible anyway and the border was doing all the work alone.
        A 5% wash of the page's own ink is visible where that fill was not.
      */}
      <div className="space-y-2">
        <div className="flex items-start gap-3">
          <img
            src={event.imageUrl}
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            className="h-20 w-14 shrink-0 object-cover"
          />
          <div className="min-w-0">
            <h3 className="line-clamp-2 font-display text-body font-bold uppercase leading-[1.3] tracking-[0.04em] text-beige-kem">
              {event.title}
            </h3>
            <p className="mt-1 truncate font-meta text-meta text-beige-kem/80">
              {date
                ? `${time ? `${time} · ` : ""}${formatEventDate(date, true)}`
                : "Chưa chọn suất"}
            </p>
            {venue && <p className="truncate font-meta text-meta text-ink-soft">{venue}</p>}
          </div>
        </div>

        {highlights && highlights.length > 1 && (
          <ul className="grid grid-cols-2 gap-y-4 border-y border-beige-kem/25 py-4 sm:grid-cols-4 lg:grid-cols-2">
            {highlights.map(({ icon: Icon, label }) => (
              <li key={label} className="flex flex-col items-center gap-1.5 px-1 text-center">
                <Icon aria-hidden="true" className="h-4 w-4 text-ink-soft" />
                <span className="label-eyebrow leading-tight text-ink-soft">{label}</span>
              </li>
            ))}
          </ul>
        )}

        {details && details.length > 0 && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4 bg-beige-kem/[0.05] p-4">
            {details.map(({ label, value }) => (
              <div key={label} className="min-w-0">
                <dt className="label-eyebrow text-ink-soft">{label}</dt>
                {/*
                  Light rather than bold. The reference sets these values at weight 300 against a
                  small uppercase label, and the contrast between the two is what makes the pair
                  read as one fact instead of as two competing lines.
                */}
                <dd className="mt-1 truncate font-meta text-body font-light text-beige-kem">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {/*
          Capped and scrollable: twelve seats would otherwise push the total and the button off the
          bottom of a sticky box, which is the one thing a sticky box exists to prevent.
        */}
        <div className="max-h-64 overflow-y-auto bg-beige-kem/[0.05] p-4">
          {lines.length === 0 ? (
            <p className="py-4 text-center font-meta text-meta text-ink-soft">{emptyLabel}</p>
          ) : (
            <ul className="space-y-2.5">
              {lines.map((line) => (
                <li key={line.key} className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-meta text-body text-beige-kem">{line.label}</p>
                    {line.detail && (
                      <p className="truncate font-meta text-eyebrow text-ink-soft">{line.detail}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-baseline gap-2">
                    <span className="font-meta text-body text-beige-kem">
                      {formatVnd(line.amount)}
                    </span>
                    {line.onRemove && (
                      <button
                        type="button"
                        onClick={line.onRemove}
                        title="Bỏ chọn"
                        className="font-meta text-eyebrow uppercase text-ink-soft transition hover:text-burgundy-ink"
                      >
                        Xóa
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {children && <div className="bg-beige-kem/[0.05] p-4">{children}</div>}

        <div className="bg-beige-kem/[0.05] p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="label-eyebrow text-ink-soft">Tổng cộng</span>
            <span className="font-display text-title-m font-black leading-none text-burgundy-ink">
              {formatVnd(total)}
            </span>
          </div>

          {holdMs !== undefined && (
            <div
              className={`mt-3 flex items-center justify-between gap-3 border px-3 py-2 font-meta text-meta ${
                holding ? "border-burgundy/50 text-beige-kem" : "border-beige-kem/25 text-ink-soft"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Clock3 className="h-3.5 w-3.5" />
                Giữ chỗ
              </span>
              <b className={holding ? "text-burgundy-ink" : ""}>
                {holding ? formatHoldClock(holdMs) : "--:--"}
              </b>
            </div>
          )}
        </div>

        <div>
          {ctaReplacement ?? (
            <button
              type="button"
              onClick={onCta}
              disabled={ctaDisabled}
              className="w-full bg-burgundy px-4 py-3.5 font-display text-body font-black uppercase tracking-[0.05em] text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-beige-kem/20 disabled:text-ink-soft"
            >
              {ctaLabel}
            </button>
          )}

          {note && <p className="mt-2 font-meta text-eyebrow leading-5 text-ink-soft">{note}</p>}

          {/*
            Centred and underlined, under everything. The reference closes its booking panel the
            same way, with the cancellation promise rather than another warning — the last thing a
            buyer reads before pressing should be the thing that makes pressing feel safe.
          */}
          {reassurance && (
            <p className="mt-3 text-center font-meta text-eyebrow leading-5 text-ink-soft underline underline-offset-4">
              {reassurance}
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}

/** The two-column shell: work on the left, order on the right, on all three screens. */
export function BookingLayout({
  children,
  aside,
}: {
  children: React.ReactNode;
  aside: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12">
      <div className="min-w-0 space-y-10">{children}</div>
      {aside}
    </div>
  );
}

/** A numbered band. `01 ─ CHỌN SUẤT` over a rule, the way the catalog page sets its sections. */
export function BookingSection({
  step,
  title,
  hint,
  children,
}: {
  step: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline gap-3 border-b border-beige-kem/30 pb-3">
        <span className="label-eyebrow text-burgundy-ink">{step}</span>
        <h3 className="font-display text-title-s font-black uppercase tracking-[0.03em] text-beige-kem">
          {title}
        </h3>
      </div>
      {hint && <p className="mt-3 font-meta text-meta text-ink-soft">{hint}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}
