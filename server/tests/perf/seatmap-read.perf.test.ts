import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { LAYOUT_MAX_SEATS } from '../../src/config.js';
import { pool } from '../../src/db/pool.js';
import { app } from '../helpers/app.js';
import * as seed from '../helpers/catalogSeed.js';

/**
 * T063 / SC-010 — the buyer seat-map read at the 2,000-seat ceiling.
 *
 * SCOPE, stated plainly: this measures single-client latency against the real database. PERF-02 is
 * defined at the 25-VU normal load profile, which needs k6 — so a pass here is NECESSARY but not
 * SUFFICIENT for PERF-02. What it does prove is that nothing in the geometry rewrite is accidentally
 * quadratic, and that a full-ceiling layout is not an order of magnitude off the bound.
 *
 * Kept out of the default `npm run test` timing budget by living under tests/perf/ with its own
 * generous timeout; it is a measurement, not a gate on every commit.
 */

const ITERATIONS = 12;
const BOUND_MS = 500; // PERF-02

/** A valid, full-ceiling layout: 50 columns × 40 rows on a 150-unit pitch, so no pair overlaps. */
async function seedMaxLayout(): Promise<{ showtimeId: number; seatCount: number }> {
  const org = await seed.seedOrganizer(await seed.seedUser());
  const venueOwner = await seed.seedUser();
  const venue = await seed.seedVenue(venueOwner);

  const layout = (
    await pool.query(
      `INSERT INTO venue_layouts (venue_id, name, status) VALUES ($1, 'Ceiling', 'ready') RETURNING id`,
      [venue],
    )
  ).rows[0].id;
  const section = (
    await pool.query(`INSERT INTO sections (layout_id, name) VALUES ($1, 'Khu A') RETURNING id`, [layout])
  ).rows[0].id;

  const cols = 50;
  const rows = Math.ceil(LAYOUT_MAX_SEATS / cols);

  // Bulk insert — 2,000 round trips would dominate the measurement and prove nothing.
  await pool.query(
    `INSERT INTO seats (layout_id, section_id, row_label, seat_number, seat_type, pos_x, pos_y, rotation)
     SELECT $1, $2, 'R' || r, c, 'single', 500 + (c - 1) * 150, 500 + (r - 1) * 150, 0
       FROM generate_series(1, $3) AS r, generate_series(1, $4) AS c`,
    [layout, section, rows, cols],
  );

  const ev = await seed.seedEvent({ organizerId: org, eventType: 'seated' });
  const showtimeId = await seed.seedShowtime(ev.id, venue);
  const tier = await seed.seedTier(showtimeId, { label: 'VIP', price: 500_000, total: null });

  // The showtime's snapshot: geometry AND displayed identity, exactly as generation writes it.
  await pool.query(
    `INSERT INTO showtime_seats (showtime_id, seat_id, ticket_tier_id, status,
                                 pos_x, pos_y, rotation, row_label, seat_number, section_name)
     SELECT $1, s.id, $2, 'available', s.pos_x, s.pos_y, s.rotation, s.row_label, s.seat_number, 'Khu A'
       FROM seats s WHERE s.layout_id = $3`,
    [showtimeId, tier, layout],
  );

  const n = await pool.query<{ c: string }>(`SELECT count(*) c FROM showtime_seats WHERE showtime_id = $1`, [showtimeId]);
  return { showtimeId, seatCount: Number(n.rows[0].c) };
}

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};

describe('seat-map read at the seat ceiling (T063, SC-010)', () => {
  it(
    `serves ${LAYOUT_MAX_SEATS} seats within the PERF-02 bound, single client`,
    { timeout: 300_000 },
    async () => {
      const { showtimeId, seatCount } = await seedMaxLayout();
      expect(seatCount).toBe(LAYOUT_MAX_SEATS);

      // One warm-up: the first call pays for connection setup and plan caching, which is not what
      // PERF-02 is about.
      await request(app).get(`/api/showtimes/${showtimeId}/seat-map`).expect(200);

      const samples: number[] = [];
      for (let i = 0; i < ITERATIONS; i += 1) {
        const started = performance.now();
        const res = await request(app).get(`/api/showtimes/${showtimeId}/seat-map`).expect(200);
        samples.push(performance.now() - started);
        expect(res.body.seats).toHaveLength(LAYOUT_MAX_SEATS);
      }

      const p95 = percentile(samples, 95);
      const median = percentile(samples, 50);
      console.log(
        `seat-map read @ ${LAYOUT_MAX_SEATS} seats — median ${median.toFixed(0)} ms, p95 ${p95.toFixed(0)} ms ` +
          `(bound ${BOUND_MS} ms, ${ITERATIONS} samples, single client)`,
      );

      expect(p95).toBeLessThan(BOUND_MS);
    },
  );

  it('scales roughly linearly with seat count — nothing quadratic crept into the geometry read', { timeout: 300_000 }, async () => {
    const small = await seed.seedSeatedEventWithMap(); // 6 seats
    const big = await seedMaxLayout(); // 2,000 seats

    const time = async (id: number): Promise<number> => {
      await request(app).get(`/api/showtimes/${id}/seat-map`).expect(200);
      const started = performance.now();
      for (let i = 0; i < 5; i += 1) await request(app).get(`/api/showtimes/${id}/seat-map`).expect(200);
      return (performance.now() - started) / 5;
    };

    const smallMs = await time(small.showtimeId);
    const bigMs = await time(big.showtimeId);
    console.log(`6 seats: ${smallMs.toFixed(0)} ms · ${LAYOUT_MAX_SEATS} seats: ${bigMs.toFixed(0)} ms`);

    // 333× the rows. Linear-ish work plus fixed overhead should stay far under a quadratic blow-up;
    // 20× is a loose ceiling that still catches an accidental O(n²).
    expect(bigMs).toBeLessThan(smallMs * 20 + 400);
  });
});
