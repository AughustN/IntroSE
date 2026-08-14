import type { Request } from 'express';
import type { Db } from '../../db/pool.js';
import { pool } from '../../db/pool.js';
import { err } from '../../http.js';

/**
 * Who may act on an organizer's charts, and how far.
 *
 * Every refusal in this module used to reduce to one comparison — is the caller `venues.created_by`? —
 * which is why the boundary has been reliable, and also why an organizer could only ever be one person.
 * This widens it by exactly one rule: a caller who is not the owner may act if the owner has granted
 * them a role that reaches the level the action needs.
 *
 * The design is additive on purpose. With no grants, every check resolves precisely as it did before,
 * so this cannot open anything that was previously closed; access is only ever gained by inserting a
 * row. And the level defaults to the STRICTEST, so an action nobody has classified refuses
 * collaborators rather than admitting them — a new endpoint is closed until someone decides otherwise.
 */

/** Ordered: each level contains the ones below it. */
export type ChartRole = 'viewer' | 'designer' | 'manager';

const RANK: Record<ChartRole, number> = { viewer: 1, designer: 2, manager: 3 };

/**
 * What each kind of action needs.
 *
 *  - `read`    look at a chart, its history, its validation
 *  - `design`  draw: save, rename, create, clone, save as template, restore, tables, floor plans
 *  - `manage`  decide: publish, archive, delete, and act on a showtime's live inventory
 *
 * `manage` is the boundary that matters. Everything above it either puts seats on sale or takes them
 * off, which is the difference between a mistake somebody can undo and one that reaches a buyer.
 */
export const NEEDS = {
  read: 'viewer',
  design: 'designer',
  manage: 'manager',
} as const satisfies Record<string, ChartRole>;

export type ChartAction = keyof typeof NEEDS;

/** The role this member holds for this owner, or null when there is no grant. */
export async function roleFor(
  ownerUserId: number,
  memberUserId: number,
  db: Db = pool,
): Promise<ChartRole | null> {
  const { rows } = await db.query<{ role: ChartRole }>(
    `SELECT role FROM chart_collaborators WHERE owner_user_id = $1 AND member_user_id = $2`,
    [ownerUserId, memberUserId],
  );
  return rows[0]?.role ?? null;
}

/**
 * The single ownership gate for the seatmap module.
 *
 * Order matters and is deliberate: a missing resource is a 404 before anything else, so probing ids
 * cannot be used to tell "exists but not yours" from "does not exist"; then the owner and admins; then,
 * only if neither, the cost of a collaborator lookup.
 */
export async function assertChartAccess(
  req: Request,
  ownerUserId: number | null,
  action: ChartAction = 'manage',
  db: Db = pool,
): Promise<void> {
  if (ownerUserId === null) throw err.notFound('not_found', 'Không tìm thấy tài nguyên.');

  const callerId = req.auth!.userId;
  if (ownerUserId === callerId || req.auth!.user.isAdmin) return;

  const role = await roleFor(ownerUserId, callerId, db);
  if (role && RANK[role] >= RANK[NEEDS[action]]) return;

  // Same message whether there is no grant or one that does not reach — telling them apart would leak
  // that an account is a collaborator on something.
  throw err.forbidden('not_owner', 'Bạn không sở hữu tài nguyên này.');
}
