import { describe, expect, it } from 'vitest';
import { SEAT_DIAMETER, validateLayout } from '@shared/catalog/seatmap-validate.js';

// The five pre-publish checks (US6: FR-030, FR-030a, FR-031, SC-008).
//
// Unit tests against the SHARED validator — the same function the server runs at publish and the
// editor runs for live highlighting, so these pin what both sides mean by "overlapping".

const seat = (id: number, x: number, y: number, extra: Partial<{ sectionId: number | null; rowLabel: string; seatNumber: number }> = {}) => ({
  id,
  sectionId: extra.sectionId === undefined ? 1 : extra.sectionId,
  rowLabel: extra.rowLabel ?? 'A',
  seatNumber: extra.seatNumber ?? id,
  x,
  y,
});

const sections = [{ id: 1, name: 'Khu A' }];

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

  it('flags a section with seats but no ticket tier — only at bind time, when tiers are known', () => {
    const layout = { seats: [seat(1, 1000, 1000)], sections };
    // Without tier information the check cannot run: a layout alone has no tiers.
    expect(validateLayout(layout).filter((i) => i.code === 'section_without_tier')).toHaveLength(0);
    // With it, the untiered section is named.
    const issues = validateLayout({ ...layout, sectionsWithTier: [] });
    expect(issues.find((i) => i.code === 'section_without_tier')?.sectionIds).toEqual([1]);
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
      sectionsWithTier: [],
    });
    const codes = new Set(issues.map((i) => i.code));
    expect(codes).toContain('overlapping_seats');
    expect(codes).toContain('duplicate_label');
    expect(codes).toContain('seat_without_section');
    expect(codes).toContain('section_without_tier');
  });

  it('reports clean for a valid layout', () => {
    const issues = validateLayout({
      seats: [seat(1, 1000, 1000, { seatNumber: 1 }), seat(2, 1200, 1000, { seatNumber: 2 })],
      // A section must now carry a colour to publish (FR-066, hall-scheme amendment). The definition
      // of "valid" genuinely changed, so the fixture does too.
      sections: sections.map((s) => ({ ...s, color: '#4C9A6B' })),
      sectionsWithTier: [1],
    });
    expect(issues).toEqual([]);
  });
});
