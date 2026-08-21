/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * How every price in the app is written.
 *
 * Not `style: "currency"`. That formatter emits `₫` (U+20AB), the one character CDA Mê Ly Display
 * does not carry, so a price set in a heading would render its digits in Mê Ly and its currency
 * mark in the fallback serif. `đ` (U+0111) is in the font, is the more common form in Vietnamese
 * commerce anyway, and keeps the whole string in one typeface.
 */
const VND = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });

export function formatVnd(amount: number): string {
  return `${VND.format(amount)}đ`;
}

/**
 * Compact display for narrow cards (~390px): a full-length figure wraps mid-way through the digits,
 * nothing gets shorter, nothing reads — so below triệu the number collapses to the unit (486tr).
 * Values under 1tr stay exact; that is where the distinction still matters.
 */
export function formatVndShort(amount: number): string {
  const r = Math.round(amount / 1_000_000);
  return r >= 1 ? `${r}tr` : `${VND.format(amount)}đ`;
}
