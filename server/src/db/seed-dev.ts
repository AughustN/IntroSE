// Dev seed: populate the catalog with the original mock events (SAMPLE_MOVIES) — nicer titles +
// Unsplash images — as real, visible catalog events. Run: npx tsx server/src/db/seed-dev.ts
// NOTE: dev-only. Clears existing catalog event data first (keeps users/organizers).

import { SAMPLE_MOVIES } from "../../../src/data.js";
import { generateUniqueSlug } from "../modules/catalog/slug.js";
import { assertNotDemoBranch } from "./guards.js";
import { pool } from "./pool.js";

const CATEGORY: Record<string, string> = {
  movie: "theatre",
  music: "music",
  theatre: "theatre",
  concert: "music",
};
const CITY_OK = new Set(["TP.HCM", "Hà Nội", "Đà Nẵng"]);
const AGE: Record<string, string> = { P: "all", T13: "13+", T16: "16+", T18: "18+" };

async function ensureOrganizer(): Promise<{ orgId: number; userId: number }> {
  const existing = (
    await pool.query(`SELECT id, user_id FROM organizers WHERE status = 'approved' LIMIT 1`)
  ).rows[0];
  if (existing) return { orgId: existing.id, userId: existing.user_id };
  const userId = (
    await pool.query(
      `INSERT INTO users (email, nickname, password_hash, provider) VALUES ($1, 'Demo Organizer', 'x', 'email') RETURNING id`,
      [`demo-org-${Date.now()}@tixhub.fit`],
    )
  ).rows[0].id;
  const orgId = (
    await pool.query(
      `INSERT INTO organizers (user_id, display_name, status) VALUES ($1, 'Demo Organizer', 'approved') RETURNING id`,
      [userId],
    )
  ).rows[0].id;
  return { orgId, userId };
}

/**
 * One seated event, so the seat-map path has something to render. Everything above is
 * general-admission (tier quantities, no seats); this builds the other half: a venue with sections,
 * physical seats, and one bookable `showtime_seats` row per seat per showtime, priced by section.
 *
 * A slice of seats is left `sold`/`held` so the map shows all three states rather than a uniform
 * grid. `held` rows carry an expiry the way the holds feature will — nothing here reads it yet.
 */
async function seedSeatedEvent(orgId: number, userId: number): Promise<void> {
  const SECTIONS = [
    { name: "Khu VIP", rows: ["A", "B", "C"], perRow: 12, tier: "VIP", price: 800_000 },
    {
      name: "Khu Thường",
      rows: ["D", "E", "F", "G", "H"],
      perRow: 14,
      tier: "Thường",
      price: 350_000,
    },
  ];

  const venueId = (
    await pool.query(
      `INSERT INTO venues (created_by, name, city, raw_address, guide)
       VALUES ($1, 'Nhà hát Hòa Bình', 'TP.HCM', '240 Đường 3 Tháng 2, Quận 10, TP.HCM',
               'Cổng chính trên đường 3 Tháng 2. Có bãi giữ xe máy trong khuôn viên, ô tô gửi ở toà nhà đối diện.')
       RETURNING id`,
      [userId],
    )
  ).rows[0].id;

  // Physical layout: sections, then seats unique within the venue by (row, number).
  const seatIdsBySection = new Map<string, number[]>();
  for (const section of SECTIONS) {
    const sectionId = (
      await pool.query(`INSERT INTO sections (venue_id, name) VALUES ($1, $2) RETURNING id`, [
        venueId,
        section.name,
      ])
    ).rows[0].id;

    const ids: number[] = [];
    for (const row of section.rows) {
      for (let n = 1; n <= section.perRow; n++) {
        const seatId = (
          await pool.query(
            `INSERT INTO seats (venue_id, section_id, row_label, seat_number) VALUES ($1, $2, $3, $4) RETURNING id`,
            [venueId, sectionId, row, n],
          )
        ).rows[0].id;
        ids.push(seatId);
      }
    }
    seatIdsBySection.set(section.name, ids);
  }

  const slug = await generateUniqueSlug("Đêm Nhạc Trịnh Công Sơn");
  const eventId = (
    await pool.query(
      `INSERT INTO events (slug, organizer_id, category_id, title, description, event_type, status, moderation_status,
                           image_url, lineup, genre, refund_policy, seo_description, age_restriction)
       VALUES ($1, $2, (SELECT id FROM event_categories WHERE code = 'music'), 'Đêm Nhạc Trịnh Công Sơn', $3,
               'seated', 'on_sale', 'approved', $4, $5, $6,
               'Huỷ vé trước giờ diễn 24 tiếng được hoàn tiền vào ví, trừ phí dịch vụ.', $3, 'all')
       RETURNING id`,
      [
        slug,
        orgId,
        "Một đêm nhạc thính phòng với những ca khúc quen thuộc của Trịnh Công Sơn, dàn dựng cho sân khấu ngồi. Khán giả chọn ghế trực tiếp trên sơ đồ.",
        "https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?auto=format&fit=crop&q=80&w=600",
        ["Hồng Nhung", "Quang Dũng", "Dàn dây Sài Gòn"],
        ["Nhạc Trịnh", "Thính phòng"],
      ],
    )
  ).rows[0].id;

  for (let d = 1; d <= 2; d++) {
    const showtimeId = (
      await pool.query(
        `INSERT INTO showtimes (event_id, venue_id, starts_at, status)
         VALUES ($1, $2, now() + ($3::int * interval '1 day'), 'on_sale') RETURNING id`,
        [eventId, venueId, d * 3],
      )
    ).rows[0].id;

    let taken = 0;
    for (const section of SECTIONS) {
      // Seated tiers carry no quantity — capacity is the seat count (D1 note in the schema).
      const tierId = (
        await pool.query(
          `INSERT INTO ticket_tiers (showtime_id, label, price_amount, total_quantity, description)
           VALUES ($1, $2, $3, NULL, $4) RETURNING id`,
          [showtimeId, section.tier, section.price, `Ghế ${section.name}`],
        )
      ).rows[0].id;

      for (const seatId of seatIdsBySection.get(section.name) ?? []) {
        taken += 1;
        const status = taken % 7 === 0 ? "sold" : taken % 11 === 0 ? "held" : "available";
        await pool.query(
          `INSERT INTO showtime_seats (showtime_id, seat_id, ticket_tier_id, status, hold_owner_id, hold_expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            showtimeId,
            seatId,
            tierId,
            status,
            status === "held" ? userId : null,
            status === "held" ? new Date(Date.now() + 7 * 60_000) : null,
          ],
        );
      }
    }
  }

  console.log("seeded (seated): Đêm Nhạc Trịnh Công Sơn");
}

async function main(): Promise<void> {
  // The TRUNCATE below is why: seeding rebuilds the catalog from SAMPLE_MOVIES, which would
  // overwrite the demo branch's hand-uploaded events with mock ones.
  assertNotDemoBranch("Seeding");

  const { orgId, userId } = await ensureOrganizer();

  // Clear catalog event data (keep users/organizers/auth).
  await pool.query(
    `TRUNCATE showtime_seats, ticket_tiers, showtimes, events, seats, sections, venues RESTART IDENTITY CASCADE`,
  );

  for (const m of SAMPLE_MOVIES) {
    const city = CITY_OK.has(m.city) ? m.city : "TP.HCM";
    const venueId = (
      await pool.query(
        `INSERT INTO venues (created_by, name, city, raw_address, map_url, guide) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [userId, m.venueName, city, m.location, m.venueMapUrl, m.venueGuide],
      )
    ).rows[0].id;

    const slug = await generateUniqueSlug(m.title);
    const eventId = (
      await pool.query(
        `INSERT INTO events (slug, organizer_id, category_id, title, original_title, description, event_type, status,
                             moderation_status, image_url, trailer_url, lineup, genre, refund_policy, seo_description, age_restriction)
         VALUES ($1, $2, (SELECT id FROM event_categories WHERE code = $3), $4, $5, $6, 'general_admission', 'on_sale',
                 'approved', $7, $8, $9, $10, $11, $6, $12) RETURNING id`,
        [
          slug,
          orgId,
          CATEGORY[m.category] ?? "music",
          m.title,
          m.originalTitle ?? null,
          m.description,
          m.imageUrl,
          m.trailerUrl,
          m.cast,
          m.genre,
          m.refundPolicy,
          AGE[m.ageRating] ?? "all",
        ],
      )
    ).rows[0].id;

    for (let d = 1; d <= 3; d++) {
      const stId = (
        await pool.query(
          `INSERT INTO showtimes (event_id, venue_id, starts_at, status) VALUES ($1, $2, now() + ($3::int * interval '1 day'), 'on_sale') RETURNING id`,
          [eventId, venueId, d * 2],
        )
      ).rows[0].id;
      for (const t of m.ticketTiers) {
        await pool.query(
          `INSERT INTO ticket_tiers (showtime_id, label, price_amount, total_quantity, description, badge) VALUES ($1, $2, $3, 100, $4, $5)`,
          [stId, t.label, t.price, t.description ?? null, t.badge ?? null],
        );
      }
    }
    console.log("seeded:", m.title);
  }

  await seedSeatedEvent(orgId, userId);

  const cnt = (
    await pool.query(
      `SELECT count(*)::int AS c FROM events WHERE status = 'on_sale' AND moderation_status = 'approved'`,
    )
  ).rows[0].c;
  console.log(`done — ${cnt} visible events`);
  await pool.end();
}

main().catch((e) => {
  console.error("seed failed:", e.message);
  process.exit(1);
});
