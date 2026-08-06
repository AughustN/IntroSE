import type pg from "pg";
import { isMaterialEdit } from "@shared/catalog/material-edit.js";

/**
 * The UC-24 A6 choke point (FR-021..FR-026).
 *
 * Feature 002 built a pre-publish moderation gate. Without this module that gate is bypassable end
 * to end: submit an innocuous empty shell, wait for approval, then edit it into whatever you wanted
 * to publish, with no moderator ever seeing the result. A gate that can be walked around is not a
 * gate — which is why this is a security control, not a convenience.
 *
 * Every organizer write that touches an event calls ONE of the two functions below. The default
 * re-moderates; skipping it requires calling a differently-named function, so a reviewer sees the
 * exemption at the call site rather than having to notice its absence. A handler that forgets to
 * call either writes no audit row, which the FR-026 test catches.
 *
 * Both run INSIDE the caller's transaction. That is what satisfies FR-023: the content change and
 * the visibility change commit together, so there is no observable moment in which edited content is
 * public under the old approval.
 */

const REVIEW_NOTE = "Sự kiện đã được chỉnh sửa nên cần duyệt lại trước khi hiển thị công khai.";

/** Written by an organizer, not an admin — new for this table (SEC-09 shape, FR-026). */
const ACTION_MATERIAL = "event_edited_pending_review";
const ACTION_INVENTORY = "event_inventory_edited";

/**
 * Record what happened. Field NAMES only, never values: names are what turn a re-review from
 * re-reading the whole listing into checking one diff, while values would duplicate content the
 * event already holds and grow the table without adding review value.
 */
async function writeEditAudit(
  client: pg.PoolClient,
  actorUserId: number,
  eventId: number,
  action: string,
  changedFields: readonly string[],
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, detail)
     VALUES ($1, $2, 'event', $3, $4)`,
    [actorUserId, action, eventId, JSON.stringify({ fields: [...changedFields] })],
  );
}

/**
 * Apply an organizer edit's moderation consequence.
 *
 * Returns the event to `pending_review` **only** when it is currently `approved` — an event that is
 * already queued stays queued, and `flagged` / `removed` are the admin's to move, so an organizer
 * cannot use an edit to escape a takedown or to re-enter the queue behind an admin's back (FR-025).
 *
 * `events.status` is never written here: a return to review removes the listing from discovery, it
 * does not cancel anything. No hold is released, no ticket voided (FR-024).
 *
 * Whether the change is material is decided by the shared predicate, never by a rule written here,
 * so the console's advance warning (FR-042) and this decision cannot drift apart (R-9).
 */
export async function applyOrganizerEdit(
  client: pg.PoolClient,
  eventId: number,
  actorUserId: number,
  changedFields: readonly string[],
): Promise<{ returnedToReview: boolean }> {
  if (!isMaterialEdit(changedFields)) {
    await applyInventoryEdit(client, eventId, actorUserId, changedFields);
    return { returnedToReview: false };
  }

  const { rows } = await client.query<{ id: number }>(
    `UPDATE events
        SET moderation_status = 'pending_review', review_note = $2, updated_at = now()
      WHERE id = $1 AND moderation_status = 'approved'
      RETURNING id`,
    [eventId, REVIEW_NOTE],
  );
  const returnedToReview = rows.length > 0;

  await writeEditAudit(client, actorUserId, eventId, ACTION_MATERIAL, changedFields);
  return { returnedToReview };
}

/**
 * The FR-021 exemption: a pure-inventory change. Capacity is the only organizer-editable value that
 * cannot misrepresent the event to a buyer, so it is the only thing that does not need a moderator's
 * eyes. Still audited — the trail should show what happened, not only what needed reviewing.
 */
export async function applyInventoryEdit(
  client: pg.PoolClient,
  eventId: number,
  actorUserId: number,
  changedFields: readonly string[],
): Promise<void> {
  await writeEditAudit(client, actorUserId, eventId, ACTION_INVENTORY, changedFields);
}

/**
 * Has this event ever been approved? Derived from the audit trail rather than a column, so moderation
 * history has a single source of truth (R-1, FR-020).
 *
 * `moderation_status` alone cannot answer it: an event approved on Monday and edited on Tuesday reads
 * `pending_review`, indistinguishable from one that was never reviewed. That is precisely the case
 * FR-020 exists to block — approve, edit, delete, resubmit clean.
 */
export async function wasEverApproved(client: pg.PoolClient, eventId: number): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM audit_logs
      WHERE target_type = 'event' AND target_id = $1 AND action = 'event_approved' LIMIT 1`,
    [eventId],
  );
  return rows.length > 0;
}
