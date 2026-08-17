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
 *
 * **Type sizes are the site's, not the console's own.** Everything here used to sit a step or two
 * above the rest of the product — 17px uppercase controls where `/events` sets the same role at
 * 14–15px, and 17px table rows where the wallet statement uses 14px. Same tokens, wrong rungs, so
 * the console read as a bigger, blunter application. The rungs now match: uppercase controls at
 * `text-meta`, the row-scale pair at `text-eyebrow`, tables at `text-meta` over `text-eyebrow`.
 */

/** The one filled action in a group: save, confirm, apply. */
export const ACTION_PRIMARY =
  "label-eyebrow inline-flex h-11 items-center gap-1.5 bg-burgundy px-5 text-meta text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";

/** Everything else: outlined, quiet, as many per group as needed. */
export const ACTION_GHOST =
  "label-eyebrow inline-flex h-11 items-center gap-1.5 border border-beige-kem/40 px-4 text-meta text-beige-kem transition hover:border-beige-kem hover:bg-bubblegum/20 disabled:cursor-not-allowed disabled:opacity-40";

/*
 * The same two actions at table-row scale.
 *
 * `h-11` is sized for a screen's own controls — "Tìm", "Tải lại", a confirmation — which stand alone
 * with space around them. Inside a cell it is wrong twice over: a 44px button in a row whose text is
 * 17px makes the decision look heavier than the thing being decided, and two or three of them per
 * row (Duyệt · Từ chối · Đình chỉ) set the height of every row in the table.
 *
 * `h-9` with the meta type keeps the same shapes, colours and border weights — only the scale drops,
 * to just above the status pill beside it.
 */
export const ACTION_ROW_PRIMARY =
  "label-eyebrow inline-flex h-9 items-center gap-1.5 bg-burgundy px-3.5 text-eyebrow text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";

export const ACTION_ROW_GHOST =
  "label-eyebrow inline-flex h-9 items-center gap-1.5 border border-beige-kem/40 px-3 text-eyebrow text-beige-kem transition hover:border-beige-kem hover:bg-bubblegum/20 disabled:cursor-not-allowed disabled:opacity-40";

/**
 * A name in a table that opens the thing it names.
 *
 * Not a button and not a link-blue anchor: the cell has to keep reading as the row's title, or the
 * table turns into a wall of controls. So it inherits its type and only answers to the pointer —
 * underline on hover, and a focus ring for anyone arriving by keyboard, who otherwise has no way to
 * tell that a run of plain text is the way in.
 */
export const ROW_LINK =
  "block cursor-pointer text-left underline-offset-4 transition hover:text-beige-kem hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-beige-kem";

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
        {meta && <p className="font-meta text-meta text-ink-soft">{meta}</p>}
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
    <div className="border border-dashed border-beige-kem/30 px-4 py-12 text-center font-meta text-meta text-ink-soft">
      {text}
    </div>
  );
}

/**
 * State, encoded twice.
 *
 * Colour alone is not a state a reader can be assumed to see, so every pill carries its word as
 * well as its fill. The four tones map to the palette's tints, not to invented colours.
 *
 * Sized to sit level with `ACTION_ROW_*` rather than to be as small as possible: on the moderation
 * tables the status IS the column a reader scans, and a pill dwarfed by the buttons next to it reads
 * as a footnote to them instead of the fact they are acting on.
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
    <span className={`label-eyebrow inline-flex h-7 shrink-0 items-center px-3 text-meta ${fill}`}>
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
 * What a figure is ABOUT, said in colour — the organizer dashboard's scheme, brought across.
 *
 * There, money is burgundy, volume is `la-co` and utilisation is `cam-dat`, so a reader scanning
 * four tiles can tell what kind of quantity each one is before reading a word of it. The admin
 * console painted every figure the same red, which made a strip of four numbers a wall.
 *
 * The `-ink` variants, not the raw tints: those exist precisely because `cam-dat` at #f19502 is a
 * fill colour and turns to mud as type on cream. Each `-ink` token is tuned per theme, so this stays
 * legible in dark mode without a second table.
 */
const KPI_TONE = {
  default: "text-beige-kem",
  money: "text-burgundy-ink",
  volume: "text-la-co-ink",
  rate: "text-cam-dat-ink",
} as const;

export type KpiTone = keyof typeof KPI_TONE;

/**
 * How a figure moved against the window before it, as the organizer console draws it: a tinted chip,
 * `la-co` for up and `cam-dat` for down.
 *
 * Direction is read as colour and shape before it is read as a number, which is the whole point of
 * putting it beside the figure. The admin console had the same sentence in `text-ink-soft`, where a
 * fall looked exactly like a rise.
 */
export function Delta({ now, before }: { now: number; before: number }) {
  if (before === 0) {
    return (
      <span className="font-meta text-meta text-ink-soft">
        {now === 0 ? "không đổi" : "kỳ trước chưa có"}
      </span>
    );
  }
  const change = Math.round(((now - before) / before) * 100);
  if (change === 0) return <span className="font-meta text-meta text-ink-soft">không đổi</span>;

  const up = change > 0;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 font-meta text-meta">
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 font-bold ${
          up ? "bg-la-co/20 text-la-co-ink" : "bg-cam-dat/20 text-cam-dat-ink"
        }`}
      >
        {up ? "▲" : "▼"} {Math.abs(change)}%
      </span>
      <span className="text-ink-soft">so với 30 ngày trước</span>
    </span>
  );
}

/**
 * One headline figure.
 *
 * `onClick` turns the tile into a button rather than adding a link beside it: a KPI that counts work
 * waiting is a thing the reader wants to open, and the whole tile is the target they aim at.
 *
 * `note` takes a node, not just a string, so a tile can hand it a `<Delta>` instead of a sentence.
 */
export function Kpi({
  label,
  value,
  note,
  tone = "default",
  onClick,
}: {
  label: string;
  value: string;
  note?: ReactNode;
  tone?: KpiTone;
  onClick?: () => void;
}) {
  const body = (
    <>
      <p className="label-eyebrow text-ink-soft">{label}</p>
      <p className={`mt-2 font-display text-title-m font-black tabular-nums ${KPI_TONE[tone]}`}>
        {value}
      </p>
      {note && <div className="mt-1 font-meta text-meta text-ink-soft">{note}</div>}
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

/**
 * Where you are in a list, and one step either way.
 *
 * Extracted from the report queue when the three moderation tables needed the same control: five
 * hand-written copies of "Trang n / m" is five chances for one of them to disable its buttons at a
 * different boundary. The caller keeps the page number, because only the caller knows whether the
 * pages come from the server (an offset) or from a slice of a list already in hand.
 */
export function Pager({
  page,
  lastPage,
  disabled,
  onChange,
}: {
  page: number;
  lastPage: number;
  disabled?: boolean;
  onChange: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="font-meta text-meta text-ink-soft">
        Trang {page + 1} / {lastPage + 1}
      </span>
      <div className="flex gap-2">
        <button
          className={ACTION_GHOST}
          disabled={page === 0 || disabled}
          onClick={() => onChange(Math.max(0, page - 1))}
        >
          Trước
        </button>
        <button
          className={ACTION_GHOST}
          disabled={page >= lastPage || disabled}
          onClick={() => onChange(page + 1)}
        >
          Sau
        </button>
      </div>
    </div>
  );
}

export function Th({ children }: { children: ReactNode }) {
  return <th className="py-3 pr-4 text-eyebrow font-bold">{children}</th>;
}

export function Td({ children, nowrap }: { children: ReactNode; nowrap?: boolean }) {
  return <td className={`py-3 pr-4 align-top ${nowrap ? "whitespace-nowrap" : ""}`}>{children}</td>;
}
