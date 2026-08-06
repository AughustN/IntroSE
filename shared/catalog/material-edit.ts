/**
 * The single definition of what counts as a MATERIAL edit (feature 006, FR-021).
 *
 * UC-24 A6 exists because the pre-publish moderation gate is otherwise bypassable end to end: get an
 * innocuous empty shell approved, then edit it into whatever you actually wanted to publish, and no
 * moderator ever sees the result. So the rule is written as an EXEMPTION list rather than an
 * enumerated material list — an enumerated list is exactly what leaves the hole, because the day
 * someone adds a new editable field and forgets to add it to the list, the gate silently reopens.
 *
 * This lives in `shared/` because two places need the same answer and they must never disagree:
 *
 *   - the server's `moderation-guard.ts` decides whether an edit returns the event for review;
 *   - the console's `EventEditor.tsx` decides whether to warn the organizer BEFORE they save, since
 *     saving removes a live event from the public catalog until an admin re-approves it (FR-042).
 *
 * If the console re-derived this rule locally it would be a small copy — which is what makes it
 * dangerous: small enough to duplicate and never revisit, so a new exempt field would make the
 * warning and the server disagree, silently, in the direction of an event vanishing without notice.
 * Same reasoning as feature 005's `seatmap-validate.ts`, which both sides import for one answer.
 *
 * The server's response stays authoritative. The client's use of this is advisory — it decides
 * whether to show a dialog, not what actually happens.
 */

/**
 * The only organizer-editable values that cannot misrepresent an event to a buyer. Inventory count
 * is not content, not a price, and not a date, so changing it does not need a moderator's eyes.
 *
 * `seat.blocked` is feature 005's per-seat block/unblock, listed here so 005 has one place to point at.
 */
export const INVENTORY_ONLY_FIELDS = ["tier.capacity", "seat.blocked"] as const;

export type InventoryOnlyField = (typeof INVENTORY_ONLY_FIELDS)[number];

const EXEMPT = new Set<string>(INVENTORY_ONLY_FIELDS);

/**
 * True when this set of changed fields must return an approved event to `pending_review`.
 *
 * An edit is material unless **every** field it touched is inventory-only. A mixed edit — capacity
 * plus a price, say — is material, because the non-exempt half is.
 *
 * An empty change set is NOT material: there is nothing for a moderator to look at. Note this is
 * about a caller reporting no changed fields, not about a caller submitting the same title twice —
 * the spec is explicit that resubmitting an identical value still counts as a change, because
 * deciding "nothing meaningfully changed" is a moderator's judgment, not a diff's.
 */
export function isMaterialEdit(changedFields: readonly string[]): boolean {
  return changedFields.some((field) => !EXEMPT.has(field));
}
