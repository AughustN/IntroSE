import { describe, expect, it } from 'vitest';
import { blockingIssues, validateLayout, type ValidationIssue } from './seatmap-validate';

/*
 * The focal-point check, and the severity split it needed to exist.
 *
 * Lives here rather than in `server/tests/seatmap/validate.test.ts` because that project's setup file
 * opens Postgres and truncates ~30 tables between cases; this is a pure function and belongs in the
 * no-database project (see the comment at the top of `vitest.web.config.ts`).
 */

const seat = (id: number, x: number, y: number) => ({
  id,
  sectionId: 1,
  categoryId: 1,
  rowLabel: 'A',
  seatNumber: id,
  x,
  y,
});

const sections = [{ id: 1, name: 'Khu A' }];
const stage = { kind: 'stage', x: 4_500, y: 200 };
/** Two seats a full diameter apart, so nothing else in the validator has anything to say. */
const cleanSeats = [seat(1, 5_000, 3_000), seat(2, 5_100, 3_000)];

const codes = (issues: ValidationIssue[]) => issues.map((i) => i.code);

describe('focal_point_unset', () => {
  it('warns when a chart has seats but no stage — best-available will rank from the seat centroid', () => {
    const issues = validateLayout({ seats: cleanSeats, sections });
    const focal = issues.filter((i) => i.code === 'focal_point_unset');
    expect(focal).toHaveLength(1);
    expect(focal[0].severity).toBe('warning');
  });

  it('is silent once a stage exists', () => {
    const issues = validateLayout({ seats: cleanSeats, sections, elements: [stage] });
    expect(codes(issues)).not.toContain('focal_point_unset');
  });

  it('is silent on a chart with no seats — a standing-only room has nothing to rank', () => {
    // A capacity zone keeps this off `zero_capacity`, so the only question left is the focal point.
    const issues = validateLayout({
      seats: [],
      sections,
      categories: [{ id: 2, name: 'Đứng' }],
      elements: [{ kind: 'area', x: 1_000, y: 1_000, capacity: 300, categoryId: 2 }],
    });
    expect(codes(issues)).not.toContain('focal_point_unset');
  });

  /*
   * The point of the whole severity split. Before it, adding this check would have made every
   * stage-less chart permanently unpublishable — a conference hall, a standing room, a stadium drawn
   * without its pitch — which is a worse failure than the silent ranking it was meant to surface.
   */
  it('does NOT block publishing: a chart whose only issue is this one is still publishable', () => {
    const issues = validateLayout({ seats: cleanSeats, sections });
    expect(codes(issues)).toEqual(['focal_point_unset']);
    expect(blockingIssues(issues)).toEqual([]);
  });
});

describe('blockingIssues', () => {
  it('keeps issues that carry no severity — an unmarked issue blocks, so the safe direction is refusing', () => {
    const unmarked: ValidationIssue = { code: 'zero_capacity', message: 'x' };
    expect(blockingIssues([unmarked])).toEqual([unmarked]);
  });

  it('drops only the warnings, keeping the errors alongside them', () => {
    // An empty chart: zero_capacity blocks, and there are no seats so no focal warning is raised.
    const issues = validateLayout({ seats: [], sections });
    expect(codes(issues)).toContain('zero_capacity');
    expect(codes(blockingIssues(issues))).toContain('zero_capacity');
  });

  it('still blocks a real error on a chart that also has the focal warning', () => {
    // Two seats on the same point: overlapping AND duplicate-labelled, plus no stage.
    const issues = validateLayout({ seats: [seat(1, 5_000, 3_000), seat(2, 5_000, 3_000)], sections });
    expect(codes(issues)).toContain('focal_point_unset');
    const blocking = blockingIssues(issues);
    expect(blocking.length).toBeGreaterThan(0);
    expect(codes(blocking)).not.toContain('focal_point_unset');
  });
});
