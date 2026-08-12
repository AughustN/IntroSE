/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AlertTriangle, Camera, Check, Pencil } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { DEFAULT_AVATAR_FG, avatarColor } from "../../services/defaultAvatar";

/**
 * Shared building blocks for the account screen.
 *
 * Layout follows a dashboard-profile pattern: each topic is one elevated card that **shows** its
 * values as text and only becomes a form once the user asks to edit. That keeps the resting screen
 * to a handful of things to read rather than a dozen live inputs (human factors: limited short-term
 * memory), and it gives the buttons back a hierarchy.
 *
 * Two rules hold this file together:
 *
 * 1. **Button hierarchy.** Three tiers, so weight carries meaning: `btnPrimary` commits (at most one
 *    per card), `btnSecondary` is neutral, `btnDanger` ends a session.
 * 2. **Text opacity floor is /70.** Below that, beige on `--color-xanh-pho` drops under the 4.5:1
 *    contrast ratio in one of the two themes (the light theme inverts both tokens), so `/50` and
 *    `/60` are never used for text.
 */

export const inputClass =
  "h-11 w-full rounded-xl border-2 border-beige-kem bg-surface-2 px-4 text-body text-beige-kem outline-none transition focus:border-burgundy";
export const inputErrorClass =
  "h-11 w-full rounded-xl border-2 border-burgundy bg-bubblegum px-4 text-body text-on-tint outline-none transition focus:border-burgundy";
export const textareaClass =
  "w-full rounded-xl border-2 border-beige-kem bg-surface-2 px-4 py-2.5 text-body leading-6 text-beige-kem outline-none transition focus:border-burgundy";

export const btnPrimary =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-burgundy px-5 text-body font-black text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60";
export const btnSecondary =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl border-2 border-beige-kem px-5 text-body font-bold text-beige-kem/80 transition hover:text-beige-kem disabled:cursor-not-allowed disabled:opacity-60";
/*
 * Danger carries its warning in the outline, not the label: tomato as *text* misses 4.5:1 on cream,
 * so the tomato border does the signalling and the fill only arrives on hover, where white text
 * clears AA against it.
 */
export const btnDanger =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl border-2 border-burgundy px-5 text-body font-bold text-beige-kem transition hover:bg-burgundy hover:text-white disabled:cursor-not-allowed disabled:opacity-60";

/** Card-header action. Shorter than the body buttons so it reads as secondary to the card's content. */
export const btnHeader =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border-2 border-beige-kem px-3.5 text-eyebrow font-bold text-beige-kem/80 transition hover:text-beige-kem disabled:cursor-not-allowed disabled:opacity-60";
export const btnHeaderPrimary =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-burgundy px-3.5 text-eyebrow font-black text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60";

/** An elevated surface with a brand-tinted heading over a hairline rule. */
export function InfoCard({
  title,
  action,
  tone = "normal",
  children,
}: {
  title: string;
  action?: ReactNode;
  tone?: "normal" | "danger";
  children: ReactNode;
}) {
  return (
    <section
      className={`rounded-2xl border-2 bg-surface-2 p-5 sm:p-6 ${
        tone === "danger" ? "border-burgundy" : "border-beige-kem"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-beige-kem/25 pb-4">
        <h3 className="font-display text-title-s font-bold text-ink-soft">{title}</h3>
        {action}
      </div>
      <div className="pt-5">{children}</div>
    </section>
  );
}

/** 1 column at 360px, 2 from 768px, 3 from 1024px (PLAT-01 breakpoints). */
export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

/** A read-only value. An empty one shows an em dash rather than collapsing the cell. */
export function Field({
  label,
  value,
  full = false,
}: {
  label: string;
  value: ReactNode;
  full?: boolean;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className={full ? "sm:col-span-2 lg:col-span-3" : undefined}>
      <p className="font-meta text-meta uppercase tracking-wide text-beige-kem/70">{label}</p>
      <div
        className={`mt-1.5 break-words text-body font-medium ${empty ? "text-beige-kem/70" : "text-beige-kem"}`}
      >
        {empty ? "—" : value}
      </div>
    </div>
  );
}

/** The editable counterpart of `Field`: same cell, label above the control, error underneath. */
export function FormField({
  label,
  htmlFor,
  hint,
  error,
  full = false,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  full?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={full ? "sm:col-span-2 lg:col-span-3" : undefined}>
      <label
        htmlFor={htmlFor}
        className="block font-meta text-meta uppercase tracking-wide text-beige-kem/70"
      >
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {hint && !error && (
        <p className="mt-1.5 font-meta text-meta leading-5 text-beige-kem/70">{hint}</p>
      )}
      {error && (
        <p
          id={htmlFor ? `${htmlFor}-error` : undefined}
          role="alert"
          className="mt-1.5 flex items-start gap-1.5 text-eyebrow leading-5 text-beige-kem"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-burgundy-ink" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Avatar with the file picker attached to the image itself, so changing the picture is where the
 * picture is instead of a button beside it. The badge keeps a 44px hit area at every size.
 */
export function AvatarWithBadge({
  url,
  initial,
  email,
  onPick,
  busyLabel,
}: {
  url: string | null;
  initial: string;
  /** Seeds the fallback colour, so the circle matches the one in the header. */
  email?: string | null;
  onPick: (file: File) => void;
  busyLabel?: string;
}) {
  // A stored avatar can outlive its file. Falling back to the initial beats a broken-image icon.
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);

  return (
    <div className="relative shrink-0">
      {url && !broken ? (
        <img
          src={url}
          alt=""
          onError={() => setBroken(true)}
          className="h-20 w-20 rounded-full object-cover"
        />
      ) : (
        <div
          className="grid h-20 w-20 place-items-center rounded-full font-display text-title-m font-black"
          style={{ backgroundColor: avatarColor(email), color: DEFAULT_AVATAR_FG }}
          aria-hidden
        >
          {initial}
        </div>
      )}
      <label
        className="absolute -bottom-1 -right-1 grid h-11 w-11 cursor-pointer place-items-center rounded-full text-beige-kem transition hover:text-ink-soft"
        title={busyLabel ?? "Đổi ảnh đại diện"}
      >
        <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-beige-kem bg-xanh-pho">
          <Camera className="h-4 w-4" aria-hidden />
        </span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          aria-label="Đổi ảnh đại diện"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ""; // allow re-picking the same file after a rejection
            if (file) onPick(file);
          }}
        />
      </label>
    </div>
  );
}

/** Status pill. Always icon + text, never colour alone (principle: user diversity). */
export function Badge({
  tone,
  icon,
  children,
}: {
  tone: "good" | "warn" | "neutral";
  icon?: ReactNode;
  children: ReactNode;
}) {
  const toneClass =
    tone === "good"
      ? "border-beige-kem bg-la-co text-on-tint"
      : tone === "warn"
        ? "border-beige-kem bg-bubblegum text-on-tint"
        : "border-beige-kem/25 bg-surface-2 text-beige-kem/80";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-meta text-meta font-bold uppercase ${toneClass}`}
    >
      {icon}
      {children}
    </span>
  );
}

/** Live checklist used by the password rules. */
export function RuleItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li
      className={`flex items-center gap-2 text-eyebrow ${ok ? "text-ink-soft" : "text-beige-kem/70"}`}
    >
      <span
        className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
          ok ? "border-la-co bg-la-co" : "border-beige-kem/30"
        }`}
      >
        {ok && <Check className="h-2.5 w-2.5" aria-hidden />}
      </span>
      {label}
      <span className="sr-only">{ok ? " — đạt" : " — chưa đạt"}</span>
    </li>
  );
}

/** The standard card-header trigger for entering edit mode. */
export function EditButton({
  label = "Chỉnh sửa",
  onClick,
}: {
  label?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={btnHeader}>
      <Pencil className="h-3.5 w-3.5" aria-hidden />
      {label}
    </button>
  );
}
