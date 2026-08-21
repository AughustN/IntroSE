/**
 * One spelling per place, in `venues.city`.
 *
 * Run with `npm run db:cities`.
 *
 * The column was filled by several importers that never agreed with each other, so the catalogue
 * had Hồ Chí Minh under three names — "Hồ Chí Minh" (107), "Tp. Hồ Chí Minh" (14) and "TP.HCM" (4)
 * — which a city filter shows as three separate places holding a third of the estate each. Another
 * 297 venues carried the literal string "Chưa xác định" while their own address named the province
 * in the next field along.
 *
 * Two passes, in this order:
 *
 *   1. **Alias** — a known variant spelling becomes the canonical one. Loses nothing: the strings
 *      already meant the same place.
 *   2. **Derive** — a venue with no city gets one from its address, but only on a confident match.
 *      Anything still unidentifiable keeps "Chưa xác định", which is a true statement about a row
 *      whose address is "Online" or "DreamS".
 *
 * The target is the PROVINCE, not the town: `venues.city` feeds a filter, and a reader picking a
 * place expects the administrative unit — the same one Moveek lists. So Biên Hòa files under Đồng
 * Nai and Nha Trang under Khánh Hòa, which is also what the cinema estate already uses.
 */
import { pool } from "./pool.js";

/*
 * The province list and the matcher both live in `shared/catalog/provinces.ts`.
 *
 * They were written out here as well, and the two had already parted company: this file knew 58
 * provinces on the pre-2025 map while the organizer's own city picker offered three. One list means
 * a place an organizer can choose is a place an address can be filed under, which is the only way
 * the filter and the form can agree.
 */
import { provinceOf } from "@shared/catalog/provinces.js";

const UNKNOWN = "Chưa xác định";

async function main(): Promise<void> {
  const before = await pool.query<{ city: string; n: number }>(
    `SELECT city, count(*)::int AS n FROM venues GROUP BY city ORDER BY n DESC`,
  );
  console.log(`before: ${before.rows.length} distinct cities across ${before.rows.reduce((s, r) => s + r.n, 0)} venues`);

  const venues = await pool.query<{ id: number; name: string; city: string; raw_address: string | null }>(
    `SELECT id, name, city, raw_address FROM venues`,
  );

  let aliased = 0;
  let derived = 0;
  let stillUnknown = 0;
  const changes = new Map<string, number>();

  for (const venue of venues.rows) {
    let next: string | null = null;

    if (venue.city && venue.city !== UNKNOWN) {
      // Pass 1: a spelling that already names a place, made canonical.
      const canonical = provinceOf(venue.city);
      if (canonical && canonical !== venue.city) {
        next = canonical;
        aliased++;
      }
    } else {
      // Pass 2: no city, so read the address. The name is a fallback — several venues carry their
      // location in the title and nothing else ("KIM LIVESTAGE, … Bien Hoa City, Dong Nai").
      const found = provinceOf(venue.raw_address ?? "") ?? provinceOf(venue.name);
      if (found) {
        next = found;
        derived++;
      } else {
        stillUnknown++;
      }
    }

    if (next) {
      await pool.query(`UPDATE venues SET city = $2 WHERE id = $1`, [venue.id, next]);
      const key = `${venue.city} → ${next}`;
      changes.set(key, (changes.get(key) ?? 0) + 1);
    }
  }

  console.log(`\naliased ${aliased}, derived ${derived}, left as "${UNKNOWN}" ${stillUnknown}\n`);
  for (const [key, n] of [...changes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${key}`);
  }

  const after = await pool.query<{ city: string; n: number }>(
    `SELECT city, count(*)::int AS n FROM venues GROUP BY city ORDER BY n DESC`,
  );
  console.log(`\nafter: ${after.rows.length} distinct cities`);
  for (const row of after.rows) console.log(`  ${String(row.n).padStart(4)}  ${row.city}`);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
