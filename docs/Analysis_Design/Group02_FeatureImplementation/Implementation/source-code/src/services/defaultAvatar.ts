/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The fallback avatar for an account that has not uploaded a picture: the first letter on a colour
 * derived from the account's email.
 *
 * Why the email and not the nickname: the colour has to be stable. A nickname can be edited at any
 * time, and an avatar that changes colour when someone renames themselves is worse than no colour
 * at all. The email is the account's fixed handle.
 *
 * The palette is a fixed list rather than a computed hue because every entry has to stay legible.
 * All eight backgrounds have a relative luminance under 0.127, which keeps `#E0E2CA` text above the
 * 4.5:1 contrast ratio on each of them (the lightest, `#1D5B4C`, lands at 6.0:1). The colours are
 * written as literal hex, not theme tokens, so the circle looks the same in light and dark mode —
 * it is a piece of identity, not a piece of chrome.
 */

const PALETTE = [
  "#93032E", // burgundy — the brand colour, kept in the rotation
  "#6E1548", // plum
  "#3B2A6B", // indigo
  "#14495B", // deep teal
  "#1D5B4C", // deep green
  "#5C4B14", // deep olive
  "#7A3B12", // rust
  "#4A2C2A", // cocoa
] as const;

/** Readable on every entry of `PALETTE`; matches the beige the rest of the UI uses for text. */
export const DEFAULT_AVATAR_FG = "#E0E2CA";

/**
 * FNV-1a. Chosen for being tiny and well-spread across short strings — near-identical addresses
 * (`an.nguyen@…` / `anh.nguyen@…`) should not land on the same colour.
 */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Background colour for an account. Same email in, same colour out, on every device. */
export function avatarColor(email: string | null | undefined): string {
  if (!email) return PALETTE[0];
  return PALETTE[hash(email.trim().toLowerCase()) % PALETTE.length];
}

/**
 * The letter to draw. Prefers the nickname — it is what the person is called — and falls back to
 * the email, so the circle is never blank.
 */
export function avatarInitial(nickname?: string | null, email?: string | null): string {
  const source = (nickname?.trim() || email?.trim() || "?").charAt(0);
  return source.toUpperCase();
}
