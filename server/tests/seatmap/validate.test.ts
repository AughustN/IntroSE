import { describe, expect, it } from 'vitest';
import { SEAT_DIAMETER, validateLayout } from '@shared/catalog/seatmap-validate.js';

// The five pre-publish checks (US6: FR-030, FR-030a, FR-031, SC-008).
//
// Unit tests against the SHARED validator — the same function the server runs at publish and the
// editor runs for live highlighting, so these pin what both sides mean by "overlapping".

const seat = (
  id: number,
  x: number,
  y: number,
  extra: Partial<{ sectionId: number | null; categoryId: number | null; rowLabel: string; seatNumber: number }> = {},
) => ({
  id,
  sectionId: extra.sectionId === undefined ? 1 : extra.sectionId,
  // Classified by default, so a case about overlap or labels is not also a case about categories.
  categoryId: extra.categoryId === undefined ? 1 : extra.categoryId,
  rowLabel: extra.rowLabel ?? 'A',
  seatNumber: extra.seatNumber ?? id,
  x,
  y,
});

const sections = [{ id: 1, name: 'Khu A' }];
const categories = [{ id: 1, name: 'VIP' }];

describe('overlap (FR-030a)', () => {
  it('flags a pair whose centres are closer than one seat diameter, naming BOTH seats', () => {
    const issues = validateLayout({ seats: [seat(1, 1000, 1000), seat(2, 1050, 1000)], sections });
    const overlap = issues.filter((i) => i.code === 'overlapping_seats');
    expect(overlap).toHaveLength(1);
    expect(overlap[0].seatIds).toHaveLength(2);
    expect(overlap[0].seatIds).toEqual(expect.arrayContaining([1, 2]));
  });

  it('treats seats exactly one diameter apart as TOUCHING, not overlapping — a tight row stays publishable', () => {
    const issues = validateLayout({ seats: [seat(1, 1000, 1000), seat(2, 1000 + SEAT_DIAMETER, 1000)], sections });
    expect(issues.filter((i) => i.code === 'overlapping_seats')).toHaveLength(0);
  });

  it('reports each overlapping pair once, not twice', () => {
    const issues = validateLayout({ seats: [seat(1, 1000, 1000), seat(2, 1010, 1000)], sections });
    expect(issues.filter((i) => i.code === 'overlapping_seats')).toHaveLength(1);
  });

  it('publishes a round table cleanly — rotation never enters the overlap test', () => {
    // Eight seats on a circle of radius 200: neighbours are ~153 apart, comfortably over a diameter.
    const ring = Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2;
      return seat(i + 1, Math.round(5000 + 200 * Math.cos(a)), Math.round(5000 + 200 * Math.sin(a)), { seatNumber: i + 1 });
    });
    expect(validateLayout({ seats: ring, sections }).filter((i) => i.code === 'overlapping_seats')).toHaveLength(0);
  });

  it('stays correct across grid-cell boundaries — the bucketing must not miss a neighbouring cell', () => {
    // Two seats either side of a 100-unit cell edge, 20 apart.
    const issues = validateLayout({ seats: [seat(1, 999, 1000), seat(2, 1019, 1000)], sections });
    expect(issues.filter((i) => i.code === 'overlapping_seats')).toHaveLength(1);
  });
});

describe('the other four checks (FR-030)', () => {
  it('flags a duplicate label WITHIN a section', () => {
    const issues = validateLayout({
      seats: [seat(1, 1000, 1000, { rowLabel: 'A', seatNumber: 1 }), seat(2, 3000, 3000, { rowLabel: 'A', seatNumber: 1 })],
      sections,
    });
    expect(issues.filter((i) => i.code === 'duplicate_label')).toHaveLength(1);
  });

  it('does NOT flag the same label in two different sections — that is what FR-003 enables', () => {
    const issues = validateLayout({
      seats: [
        seat(1, 1000, 1000, { sectionId: 1, rowLabel: 'A', seatNumber: 1 }),
        seat(2, 3000, 3000, { sectionId: 2, rowLabel: 'A', seatNumber: 1 }),
      ],
      sections: [...sections, { id: 2, name: 'Khu B' }],
    });
    expect(issues.filter((i) => i.code === 'duplicate_label')).toHaveLength(0);
  });

  it('flags a seat belonging to no section', () => {
    const issues = validateLayout({ seats: [seat(1, 1000, 1000, { sectionId: null })], sections });
    const issue = issues.find((i) => i.code === 'seat_without_section');
    expect(issue?.seatIds).toEqual([1]);
  });

  it('flags a seat belonging to no category — it could never be priced, so never sold', () => {
    const issues = validateLayout({
      seats: [seat(1, 1000, 1000, { categoryId: null })],
      sections,
      categories,
    });
    expect(issues.find((i) => i.code === 'seat_without_category')?.seatIds).toEqual([1]);
  });

  it('flags a category with seats but no price — only at bind time, when tiers are known', () => {
    const layout = { seats: [seat(1, 1000, 1000)], sections, categories };
    // Without tier information the check cannot run: a layout alone has no tiers.
    expect(validateLayout(layout).filter((i) => i.code === 'category_without_tier')).toHaveLength(0);
    // With it, the unpriced category is named.
    const issues = validateLayout({ ...layout, categoriesWithTier: [] });
    expect(issues.find((i) => i.code === 'category_without_tier')?.categoryIds).toEqual([1]);
  });

  it('flags zero capacity', () => {
    expect(validateLayout({ seats: [], sections }).some((i) => i.code === 'zero_capacity')).toBe(true);
  });

  it('reports EVERY problem in one pass, not one at a time (FR-031)', () => {
    const issues = validateLayout({
      seats: [
        seat(1, 1000, 1000, { rowLabel: 'A', seatNumber: 1 }),
        seat(2, 1020, 1000, { rowLabel: 'A', seatNumber: 1 }), // overlapping AND duplicate
        seat(3, 5000, 5000, { sectionId: null }), // sectionless
      ],
      sections,
      categories,
      categoriesWithTier: [],
    });
    const codes = new Set(issues.map((i) => i.code));
    expect(codes).toContain('overlapping_seats');
    expect(codes).toContain('duplicate_label');
    expect(codes).toContain('seat_without_section');
    expect(codes).toContain('category_without_tier');
  });

  it('reports clean for a valid layout', () => {
    const issues = validateLayout({
      seats: [seat(1, 1000, 1000, { seatNumber: 1 }), seat(2, 1200, 1000, { seatNumber: 2 })],
      // Colour is no longer a publish requirement on the SECTION — it moved to the category, where the
      // column is NOT NULL. What "valid" now also requires is that every seat has a class and every
      // class with seats has a price.
      sections,
      categories,
      categoriesWithTier: [1],
      // A stage, or the layout is clean-but-warned: without one, `focal_point_unset` fires because
      // best-available would rank from the centroid of the seats instead. That warning does not block
      // a publish (see `shared/catalog/seatmap-validate.test.ts`), but "no issues at all" is a
      // stronger claim and this case is the one making it.
      elements: [{ kind: 'stage', x: 1000, y: 200 }],
    });
    expect(issues).toEqual([]);
  });
});
