/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One rule for phone numbers, applied in one direction each way.
 *
 * **Stored canonical, shown local.** The account keeps `+84XXXXXXXXX` because a phone number is a
 * sign-in identifier: `classifyIdentifier` matches on it, `uq_users_phone` is unique on it, and two
 * spellings of one number must never be two accounts. Nobody in Vietnam reads a number that way, so
 * everything a person types into or reads out of a field is the local `0XXXXXXXXX`.
 *
 * The product had both forms on screen at once — the profile card rendered `090 000 0409` while the
 * edit box under it was seeded with `+84900000409`, and signing in silently rewrote what was typed.
 * Same number, three appearances.
 *
 * This is the display direction only. `normalizePhone` (client `account/validation.ts`, server
 * `auth/identifier.ts`) owns the storage direction and stays the sole authority on what is valid —
 * nothing here judges a number, so a value the validator would reject still round-trips unchanged
 * instead of vanishing from the field that holds it.
 */

/** `+84900000409` → `0900000409`, for a field somebody types into. Anything else passes through. */
export function toLocalPhone(stored: string | null | undefined): string {
  if (!stored) return "";
  const match = /^\+84(\d{9})$/.exec(stored.trim());
  return match ? `0${match[1]}` : stored;
}

/** `+84900000409` → `090 000 0409`, for a line somebody reads. */
export function formatPhone(stored: string | null | undefined): string {
  const local = toLocalPhone(stored);
  const match = /^0(\d{2})(\d{3})(\d{4})$/.exec(local);
  return match ? `0${match[1]} ${match[2]} ${match[3]}` : local;
}
