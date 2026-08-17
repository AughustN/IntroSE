/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The buyer's details on the checkout form, kept across a detour off the site.
 *
 * Topping up sends the browser to VNPay and back (UC-13 A6). The whole document is replaced, so
 * `CheckoutForm` unmounts and its `name`/`email`/`phone` state — plain `useState`, never persisted —
 * came back empty. The hold itself survived, because `holdSession` writes to `sessionStorage`, so
 * the buyer returned to a checkout screen holding their seats with a submit button that silently
 * did nothing: `handleSubmit` refuses to run while any of the three is blank. The one path that
 * *forces* a buyer to leave the site was the one path that wiped what they had typed.
 *
 * `sessionStorage`, matching `holdSession`: this belongs to the tab doing the buying, and it is a
 * convenience copy, never the truth — the order is created from what is posted, and the server
 * validates it.
 *
 * Scoped to a reservation id. Details typed for one hold must not reappear under the next one: the
 * two purchases can be for different people, and silently prefilling someone else's name on a
 * ticket is worse than an empty field.
 */

const KEY = "tixhub_checkout_details_v1";

export interface CheckoutDetails {
  reservationId: number;
  name: string;
  email: string;
  phone: string;
  agreeTerms: boolean;
}

/** What was typed for THIS reservation, or null when there is nothing to restore. */
export function loadCheckoutDetails(reservationId: number | null): CheckoutDetails | null {
  if (reservationId === null) return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CheckoutDetails;
    // A different hold's details are not this hold's details.
    if (parsed?.reservationId !== reservationId) return null;
    return {
      reservationId,
      name: String(parsed.name ?? ""),
      email: String(parsed.email ?? ""),
      phone: String(parsed.phone ?? ""),
      agreeTerms: parsed.agreeTerms !== false,
    };
  } catch (err) {
    console.error("Failed to read the stored checkout details:", err);
    return null;
  }
}

export function saveCheckoutDetails(details: CheckoutDetails | null): void {
  try {
    if (details) sessionStorage.setItem(KEY, JSON.stringify(details));
    else sessionStorage.removeItem(KEY);
  } catch (err) {
    // A full or unavailable store is not a reason to break the form — the fields still work, they
    // just will not survive a trip to the payment gateway.
    console.error("Failed to save the checkout details:", err);
  }
}

/** Dropped once the order exists, or when the hold it belonged to is released. */
export function clearCheckoutDetails(): void {
  saveCheckoutDetails(null);
}
