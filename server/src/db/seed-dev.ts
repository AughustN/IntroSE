// Dev seed: populate the catalog with the original mock events (SAMPLE_MOVIES) — nicer titles +
// Unsplash images — as real, visible catalog events. Run: npx tsx server/src/db/seed-dev.ts
// NOTE: dev-only. Clears existing catalog event data first (keeps users/organizers).

import { SAMPLE_MOVIES } from '../../../src/data.js';
import { generateUniqueSlug } from '../modules/catalog/slug.js';
import { pool } from './pool.js';

const CATEGORY: Record<string, string> = { movie: 'theatre', music: 'music', theatre: 'theatre', concert: 'music' };
const CITY_OK = new Set(['TP.HCM', 'Hà Nội', 'Đà Nẵng']);
const AGE: Record<string, string> = { P: 'all', T13: '13+', T16: '16+', T18: '18+' };

async function ensureOrganizer(): Promise<{ orgId: number; userId: number }> {
  const existing = (await pool.query(`SELECT id, user_id FROM organizers WHERE status = 'approved' LIMIT 1`)).rows[0];
  if (existing) return { orgId: existing.id, userId: existing.user_id };
  const userId = (
    await pool.query(`INSERT INTO users (email, nickname, password_hash, provider) VALUES ($1, 'Demo Organizer', 'x', 'email') RETURNING id`, [
      `demo-org-${Date.now()}@tixhub.fit`,
    ])
  ).rows[0].id;
  const orgId = (await pool.query(`INSERT INTO organizers (user_id, display_name, status) VALUES ($1, 'Demo Organizer', 'approved') RETURNING id`, [userId])).rows[0].id;
  return { orgId, userId };
}

async function main(): Promise<void> {
  const { orgId, userId } = await ensureOrganizer();

  // Clear catalog event data (keep users/organizers/auth).
  await pool.query(`TRUNCATE showtime_seats, ticket_tiers, showtimes, events, seats, sections, venues RESTART IDENTITY CASCADE`);

  for (const m of SAMPLE_MOVIES) {
    const city = CITY_OK.has(m.city) ? m.city : 'TP.HCM';
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
        [slug, orgId, CATEGORY[m.category] ?? 'music', m.title, m.originalTitle ?? null, m.description, m.imageUrl, m.trailerUrl, m.cast, m.genre, m.refundPolicy, AGE[m.ageRating] ?? 'all'],
      )
    ).rows[0].id;

    for (let d = 1; d <= 3; d++) {
      const stId = (
        await pool.query(`INSERT INTO showtimes (event_id, venue_id, starts_at, status) VALUES ($1, $2, now() + ($3::int * interval '1 day'), 'on_sale') RETURNING id`, [eventId, venueId, d * 2])
      ).rows[0].id;
      for (const t of m.ticketTiers) {
        await pool.query(`INSERT INTO ticket_tiers (showtime_id, label, price_amount, total_quantity, description, badge) VALUES ($1, $2, $3, 100, $4, $5)`, [
          stId,
          t.label,
          t.price,
          t.description ?? null,
          t.badge ?? null,
        ]);
      }
    }
    console.log('seeded:', m.title);
  }

  const cnt = (await pool.query(`SELECT count(*)::int AS c FROM events WHERE status = 'on_sale' AND moderation_status = 'approved'`)).rows[0].c;
  console.log(`done — ${cnt} visible events`);
  await pool.end();
}

main().catch((e) => {
  console.error('seed failed:', e.message);
  process.exit(1);
});
