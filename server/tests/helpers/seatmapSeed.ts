import request from 'supertest';
import { pool } from '../../src/db/pool.js';
import { app } from './app.js';

/**
 * The bind-and-generate dance, in one call.
 *
 * Generating a seated map takes three things now, and every integration test that wants a live map
 * needs all three: every class that holds a seat must be priced by a tier, the chart must be
 * published, and the call names the chart rather than a list of section→tier pairs. Spelling that
 * out in each test buried what the test was actually about.
 *
 * Returns the layout's categories so a caller can assert against them.
 */
export async function bindAndGenerate(
  h: Record<string, string>,
  opts: { showtime: number; layoutId: number; expect?: number; publish?: boolean },
): Promise<{ categories: { id: number; name: string; color: string }[] }> {
  const layout = (
    await request(app).get(`/api/organizer/layouts/${opts.layoutId}`).set(h).expect(200)
  ).body;
  const categories: { id: number; name: string; color: string }[] = layout.categories;

  // Price every class that holds a seat. Tests seed one or two tiers; the cheapest takes the first
  // class, and any further class reuses the last tier — enough to satisfy the gate without inventing
  // prices the test never asked about.
  const tiers = (
    await pool.query<{ id: number }>(
      `SELECT id FROM ticket_tiers WHERE showtime_id = $1 AND archived_at IS NULL ORDER BY price_amount, id`,
      [opts.showtime],
    )
  ).rows;
  for (const [i, category] of categories.entries()) {
    const tier = tiers[Math.min(i, tiers.length - 1)];
    if (tier) {
      await pool.query(`UPDATE ticket_tiers SET category_id = $2 WHERE id = $1`, [
        tier.id,
        category.id,
      ]);
    }
  }

  // Skippable for a layout that is already published — notably the venue default, which
  // `defaultLayoutId` creates as 'ready' so the venue-level helper paths keep working.
  if (opts.publish !== false) {
    await request(app).post(`/api/organizer/layouts/${opts.layoutId}/publish`).set(h).expect(200);
  }
  await request(app)
    .post(`/api/organizer/showtimes/${opts.showtime}/seat-map`)
    .set(h)
    .send({ layoutId: opts.layoutId })
    .expect(opts.expect ?? 201);

  return { categories };
}

/** The default layout a venue-level helper path resolves to. */
export async function defaultLayoutOf(venueId: number): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM venue_layouts WHERE venue_id = $1 ORDER BY created_at LIMIT 1`,
    [venueId],
  );
  return rows[0].id;
}
