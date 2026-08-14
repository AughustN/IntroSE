// Adds one seated event, "WaitlistTest", whose every seat is already `sold` — the precondition the
// waitlist (UC-17) needs and that no other seed produces. Additive: it inserts, never truncates, so
// it is safe to run against a database that already holds hand-made data.
//
//   npx tsx --tsconfig tsconfig.server.json server/src/db/seed-waitlist-test.ts
//
// Re-running creates a second event with a distinct slug; delete the old one by slug if not wanted.

import { generateUniqueSlug } from "../modules/catalog/slug.js";
import { pool } from "./pool.js";

const TITLE = "WaitlistTest";
const ROWS = ["A", "B"];
const SEATS_PER_ROW = 6;

async function ensureOrganizer(): Promise<{ orgId: number; userId: number }> {
  const existing = (
    await pool.query(`SELECT id, user_id FROM organizers WHERE status = 'approved' LIMIT 1`)
  ).rows[0];
  if (existing) return { orgId: existing.id, userId: existing.user_id };

  const userId = (
    await pool.query(
      `INSERT INTO users (email, nickname, password_hash, provider)
       VALUES ($1, 'Demo Organizer', 'x', 'email') RETURNING id`,
      [`demo-org-${Date.now()}@tixhub.fit`],
    )
  ).rows[0].id;
  const orgId = (
    await pool.query(
      `INSERT INTO organizers (user_id, display_name, status)
       VALUES ($1, 'Demo Organizer', 'approved') RETURNING id`,
      [userId],
    )
  ).rows[0].id;
  return { orgId, userId };
}

async function main(): Promise<void> {
  const { orgId, userId } = await ensureOrganizer();

  const venueId = (
    await pool.query(
      `INSERT INTO venues (created_by, name, city, raw_address, guide)
       VALUES ($1, 'Sân Khấu Thử Nghiệm', 'TP.HCM', '1 Nguyễn Huệ, Quận 1, TP.HCM',
               'Địa điểm dùng cho kiểm thử danh sách chờ.')
       RETURNING id`,
      [userId],
    )
  ).rows[0].id;

  const layoutId = (
    await pool.query(
      `INSERT INTO venue_layouts (venue_id, name, status) VALUES ($1, 'Sơ đồ WaitlistTest', 'ready')
       RETURNING id`,
      [venueId],
    )
  ).rows[0].id;

  const sectionId = (
    await pool.query(`INSERT INTO sections (layout_id, name) VALUES ($1, 'Khu A') RETURNING id`, [
      layoutId,
    ])
  ).rows[0].id;

  await pool.query(
    `INSERT INTO layout_elements (layout_id, kind, pos_x, pos_y, width, height, rotation, label)
     VALUES ($1, 'stage', 5000, 600, 3000, 400, 0, 'Sân khấu')`,
    [layoutId],
  );

  const slug = await generateUniqueSlug(TITLE);
  const eventId = (
    await pool.query(
      `INSERT INTO events (slug, organizer_id, category_id, title, description, event_type, status,
                           moderation_status, image_url, refund_policy, seo_description, age_restriction)
       VALUES ($1, $2, (SELECT id FROM event_categories WHERE code = 'music'), $3, $4,
               'seated', 'on_sale', 'approved', $5,
               'Huỷ vé trước giờ diễn 24 tiếng được hoàn tiền vào ví.', $4, 'all')
       RETURNING id`,
      [
        slug,
        orgId,
        TITLE,
        "Sự kiện kiểm thử: toàn bộ ghế đã bán, dùng để thử luồng danh sách chờ (UC-17).",
        "https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?auto=format&fit=crop&q=80&w=600",
      ],
    )
  ).rows[0].id;

  const showtimeId = (
    await pool.query(
      `INSERT INTO showtimes (event_id, venue_id, layout_id, starts_at, status)
       VALUES ($1, $2, $3, now() + interval '5 days', 'on_sale') RETURNING id`,
      [eventId, venueId, layoutId],
    )
  ).rows[0].id;

  // Uncapped, the way every seated tier is written: a seated showtime's stock is its seat rows, so
  // "sold out" must be answerable from those rows alone (availableForWaitlist, FR-002).
  const tierId = (
    await pool.query(
      `INSERT INTO ticket_tiers (showtime_id, label, price_amount, total_quantity, description)
       VALUES ($1, 'VIP', 500000, NULL, 'Ghế Khu A') RETURNING id`,
      [showtimeId],
    )
  ).rows[0].id;

  let seatCount = 0;
  for (const [rowIndex, row] of ROWS.entries()) {
    const posY = 1200 + rowIndex * 150;
    const startX = Math.round(5000 - ((SEATS_PER_ROW - 1) * 150) / 2);
    for (let n = 1; n <= SEATS_PER_ROW; n++) {
      const posX = Math.min(10000, startX + (n - 1) * 150);
      const seatId = (
        await pool.query(
          `INSERT INTO seats (layout_id, section_id, row_label, seat_number, pos_x, pos_y)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [layoutId, sectionId, row, n, posX, posY],
        )
      ).rows[0].id;

      // Every seat sold — no `available` row exists, which is what the waitlist gate looks for.
      await pool.query(
        `INSERT INTO showtime_seats (showtime_id, seat_id, ticket_tier_id, status,
                                     pos_x, pos_y, rotation, row_label, seat_number, section_name)
         VALUES ($1, $2, $3, 'sold', $4, $5, 0, $6, $7, 'Khu A')`,
        [showtimeId, seatId, tierId, posX, posY, row, n],
      );
      seatCount += 1;
    }
  }

  // The catalog shows a showtime with nothing left as sold out; mark it so the two agree.
  await pool.query(`UPDATE showtimes SET status = 'sold_out' WHERE id = $1`, [showtimeId]);

  console.log(
    `seeded: ${TITLE} — slug=${slug} eventId=${eventId} showtimeId=${showtimeId} tierId=${tierId} seats=${seatCount} (all sold)`,
  );
  await pool.end();
}

main().catch((e) => {
  console.error("seed failed:", e.message);
  process.exit(1);
});
