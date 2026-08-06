import request from "supertest";
import { pool } from "../../src/db/pool.js";
import { bearer, makeApprovedOrganizer, registerUser } from "../helpers/authFixture.js";
import { seedEvent, seedShowtime, seedTier, seedVenue } from "../helpers/catalogSeed.js";
import { app } from "../helpers/app.js";

/**
 * Fixtures for the organizer studio suite (feature 006).
 *
 * Most cases need the same shape: an approved organizer holding an APPROVED, ON-SALE event — that is
 * the state the UC-24 A6 rule is about, and the state in which every refusal is most consequential.
 */

export interface Studio {
  token: string;
  userId: number;
  organizerId: number;
  venueId: number;
  eventId: number;
  slug: string;
  showtimeId: number;
  tierId: number;
}

export interface StudioOptions {
  eventType?: "general_admission" | "seated";
  moderation?: string;
  status?: string;
  /** Tier inventory to fake, standing in for feature 003/004 state this feature only reads. */
  sold?: number;
  reserved?: number;
  capacity?: number | null;
}

/** An approved organizer with an approved, on-sale GA event, one showtime and one tier. */
export async function makeStudio(opts: StudioOptions = {}): Promise<Studio> {
  const { token, userId } = await registerUser();
  const organizerId = await makeApprovedOrganizer(userId);
  const venueId = await seedVenue(userId);
  const ev = await seedEvent({
    organizerId,
    eventType: opts.eventType ?? "general_admission",
    moderation: opts.moderation ?? "approved",
    status: opts.status ?? "on_sale",
  });
  const showtimeId = await seedShowtime(ev.id, venueId);
  const tierId = await seedTier(showtimeId, {
    total: opts.capacity === undefined ? 100 : opts.capacity,
    sold: opts.sold ?? 0,
    reserved: opts.reserved ?? 0,
  });
  return { token, userId, organizerId, venueId, eventId: ev.id, slug: ev.slug, showtimeId, tierId };
}

/** A second, unrelated approved organizer — the cross-organizer refusal fixture (SC-011). */
export async function makeOtherOrganizer(): Promise<{
  token: string;
  userId: number;
  venueId: number;
}> {
  const { token, userId } = await registerUser();
  await makeApprovedOrganizer(userId);
  const venueId = await seedVenue(userId);
  return { token, userId, venueId };
}

export const auth = (token: string) => bearer(token);

/** Approve an event the way an admin would, INCLUDING the audit row FR-020 reads back (R-1). */
export async function approveAsAdmin(eventId: number, adminUserId: number): Promise<void> {
  await pool.query(`UPDATE events SET moderation_status = 'approved' WHERE id = $1`, [eventId]);
  await pool.query(
    `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, detail)
     VALUES ($1, 'event_approved', 'event', $2, '{}'::jsonb)`,
    [adminUserId, eventId],
  );
}

export async function moderationOf(eventId: number): Promise<string> {
  const { rows } = await pool.query<{ moderation_status: string }>(
    `SELECT moderation_status FROM events WHERE id = $1`,
    [eventId],
  );
  return rows[0].moderation_status;
}

export async function eventStatusOf(eventId: number): Promise<string> {
  const { rows } = await pool.query<{ status: string }>(`SELECT status FROM events WHERE id = $1`, [
    eventId,
  ]);
  return rows[0].status;
}

export async function tierRow(tierId: number) {
  const { rows } = await pool.query(`SELECT * FROM ticket_tiers WHERE id = $1`, [tierId]);
  return rows[0] ?? null;
}

export async function auditRows(eventId: number) {
  const { rows } = await pool.query(
    `SELECT actor_user_id, action, detail, created_at FROM audit_logs
      WHERE target_type = 'event' AND target_id = $1 ORDER BY id`,
    [eventId],
  );
  return rows;
}

let layoutSeq = 0;

/** Give a showtime real bookable seats, so the seated-branch guards can be exercised. */
export async function attachSeatMap(
  showtimeId: number,
  venueId: number,
  tierId: number,
  count = 3,
): Promise<number[]> {
  // Layout names are unique per venue, and a seated showtime may need a second block of seats for a
  // second tier, so the name has to vary.
  const layout = (
    await pool.query(
      `INSERT INTO venue_layouts (venue_id, name, status) VALUES ($1, $2, 'ready') RETURNING id`,
      [venueId, `Sơ đồ ${++layoutSeq}`],
    )
  ).rows[0].id;
  const section = (
    await pool.query(`INSERT INTO sections (layout_id, name) VALUES ($1, 'Khu A') RETURNING id`, [
      layout,
    ])
  ).rows[0].id;
  const ids: number[] = [];
  for (let i = 1; i <= count; i++) {
    const seat = (
      await pool.query(
        `INSERT INTO seats (layout_id, section_id, row_label, seat_number, pos_x, pos_y)
         VALUES ($1, $2, 'A', $3, $4, 1200) RETURNING id`,
        [layout, section, i, 5000 + i * 150],
      )
    ).rows[0].id;
    const ss = (
      await pool.query(
        `INSERT INTO showtime_seats (showtime_id, seat_id, ticket_tier_id, status, pos_x, pos_y, rotation, row_label, seat_number, section_name)
         VALUES ($1, $2, $3, 'available', $4, 1200, 0, 'A', $5, 'Khu A') RETURNING id`,
        [showtimeId, seat, tierId, 5000 + i * 150, i],
      )
    ).rows[0].id;
    ids.push(ss);
  }
  return ids;
}

export async function setSeatStatus(
  showtimeSeatId: number,
  status: "available" | "held" | "sold",
): Promise<void> {
  await pool.query(`UPDATE showtime_seats SET status = $2 WHERE id = $1`, [showtimeSeatId, status]);
}

/** Seated showtimes carry a NULL capacity — the seat map is the capacity (FR-005). */
export async function makeSeatedStudio(): Promise<Studio & { seatIds: number[] }> {
  const s = await makeStudio({ eventType: "seated", capacity: null });
  const seatIds = await attachSeatMap(s.showtimeId, s.venueId, s.tierId);
  return { ...s, seatIds };
}

export const api = () => request(app);
