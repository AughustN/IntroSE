import { pool } from '../../src/db/pool.js';

// Direct fixture inserts for catalog tests (bypassing the write API, which is a later slice).

let seq = 0;
const uniq = () => `${Date.now()}-${++seq}`;

export async function seedUser(): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, nickname, password_hash, provider) VALUES ($1, 'Org', 'x', 'email') RETURNING id`,
    [`org-${uniq()}@example.com`],
  );
  return rows[0].id;
}

export async function seedOrganizer(userId: number, status = 'approved'): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO organizers (user_id, display_name, status) VALUES ($1, 'Nhà tổ chức', $2) RETURNING id`,
    [userId, status],
  );
  return rows[0].id;
}

export async function seedVenue(createdBy: number, city = 'Hà Nội'): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO venues (created_by, name, city, raw_address, guide) VALUES ($1, $2, $3, 'Địa chỉ', 'Chỉ đường') RETURNING id`,
    [createdBy, `Địa điểm ${uniq()}`, city],
  );
  return rows[0].id;
}

export async function seedEvent(opts: {
  organizerId: number;
  status?: string;
  moderation?: string;
  eventType?: 'general_admission' | 'seated';
  title?: string;
  description?: string;
  category?: string;
  slug?: string;
  lineup?: string[];
}): Promise<{ id: number; slug: string }> {
  const { rows } = await pool.query(
    `INSERT INTO events (slug, organizer_id, category_id, title, description, event_type, status, moderation_status, image_url, lineup)
     VALUES ($1, $2, (SELECT id FROM event_categories WHERE code = $3), $4, $5, $6, $7, $8, 'https://img/x.jpg', $9)
     RETURNING id, slug`,
    [
      opts.slug ?? `su-kien-${uniq()}`,
      opts.organizerId,
      opts.category ?? 'music',
      opts.title ?? 'Sự kiện mẫu',
      opts.description ?? 'Mô tả sự kiện.',
      opts.eventType ?? 'general_admission',
      opts.status ?? 'on_sale',
      opts.moderation ?? 'approved',
      opts.lineup ?? [],
    ],
  );
  return rows[0];
}

export async function seedShowtime(eventId: number, venueId: number, offsetMs = 86_400_000): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO showtimes (event_id, venue_id, starts_at, status)
     VALUES ($1, $2, now() + ($3::bigint * interval '1 millisecond'), 'on_sale') RETURNING id`,
    [eventId, venueId, offsetMs],
  );
  return rows[0].id;
}

export async function seedTier(
  showtimeId: number,
  o: { label?: string; price?: number; total?: number | null; sold?: number; reserved?: number } = {},
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO ticket_tiers (showtime_id, label, price_amount, total_quantity, sold_quantity, reserved_quantity)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [showtimeId, o.label ?? 'Thường', o.price ?? 100000, o.total === undefined ? 100 : o.total, o.sold ?? 0, o.reserved ?? 0],
  );
  return rows[0].id;
}

/** A complete, visible general-admission event with one upcoming showtime + tier. */
export async function seedVisibleGaEvent(
  over: { status?: string; moderation?: string; title?: string; category?: string; slug?: string; lineup?: string[] } = {},
): Promise<{ eventId: number; slug: string; showtimeId: number }> {
  const org = await seedOrganizer(await seedUser());
  const venue = await seedVenue(await seedUser());
  const ev = await seedEvent({ organizerId: org, ...over });
  const st = await seedShowtime(ev.id, venue);
  await seedTier(st);
  return { eventId: ev.id, slug: ev.slug, showtimeId: st };
}

/** A visible seated event with a generated seat map (rows of seats, one tier). */
export async function seedSeatedEventWithMap(): Promise<{ eventId: number; slug: string; showtimeId: number; seatCount: number }> {
  const org = await seedOrganizer(await seedUser());
  const venueOwner = await seedUser();
  const venue = await seedVenue(venueOwner);
  // Sections and seats belong to a LAYOUT, not the venue (feature 005, FR-002).
  const layout = (
    await pool.query(`INSERT INTO venue_layouts (venue_id, name, status) VALUES ($1, 'Sơ đồ mặc định', 'ready') RETURNING id`, [venue])
  ).rows[0].id;
  const sec = (await pool.query(`INSERT INTO sections (layout_id, name) VALUES ($1, 'Khu A') RETURNING id`, [layout])).rows[0].id;
  const ev = await seedEvent({ organizerId: org, eventType: 'seated' });
  const st = await seedShowtime(ev.id, venue);
  const tier = await seedTier(st, { label: 'VIP', price: 500000, total: null });
  const seatCount = 6;
  for (let i = 1; i <= seatCount; i++) {
    const x = 5000 + (i - 1) * 150;
    const seat = (
      await pool.query(
        `INSERT INTO seats (layout_id, section_id, row_label, seat_number, pos_x, pos_y) VALUES ($1, $2, 'A', $3, $4, 1200) RETURNING id`,
        [layout, sec, i, x],
      )
    ).rows[0].id;
    // The showtime snapshots the layout: geometry AND displayed identity (FR-005).
    await pool.query(
      `INSERT INTO showtime_seats (showtime_id, seat_id, ticket_tier_id, status, pos_x, pos_y, rotation, row_label, seat_number, section_name)
       VALUES ($1, $2, $3, 'available', $4, 1200, 0, 'A', $5, 'Khu A')`,
      [st, seat, tier, x, i],
    );
  }
  return { eventId: ev.id, slug: ev.slug, showtimeId: st, seatCount };
}
