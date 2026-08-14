import { describe, expect, it } from 'vitest';
import type { ChartDocument, DocumentBlock } from './seatmap-document.js';
import {
  CHART_DOCUMENT_SCHEMA,
  adoptLayout,
  emptyDocument,
  nextBlockKey,
  remapDocument,
  stripIds,
  upgradeDocument,
} from './seatmap-document.js';
import type { Layout } from './seatmap.js';
import {
  letterAt,
  projectDocument,
  regenerateBlock,
  rowLabelFor,
  seatNumberFor,
  stitchSeatIds,
} from './seatmap-project.js';
import { LAYOUT_MAX_SEATS, validateLayout } from './seatmap-validate.js';

// The document → rows projection, tested where it lives. Every assertion is either a database
// constraint (`pos_x`/`pos_y` 0–10000, `rotation` 0–359, `UNIQUE (section, row, number)`) or the rule
// that keeps a paid ticket attached to its chart: a seat's id survives while its label does.

let counter = 0;
const mint = () => {
  counter -= 1;
  return counter;
};

const block = (over: Partial<DocumentBlock> = {}): DocumentBlock => ({
  key: 'b1',
  kind: 'seating-block',
  title: 'Khu A',
  x: 1000,
  y: 1000,
  rotation: 0,
  width: 500,
  height: 300,
  sectionId: 1,
  categoryId: 1,
  params: { rowsCount: 3, seatsPerRow: 4, seatSpacing: 150, rowSpacing: 150 },
  ...over,
});

const doc = (blocks: DocumentBlock[]): ChartDocument => ({
  schemaVersion: CHART_DOCUMENT_SCHEMA,
  gridSize: 50,
  sections: [{ id: 1, name: 'Khu A' }],
  categories: [{ id: 1, name: 'VIP', color: '#B3453C' }],
  blocks,
});

const labelsOf = (seats: { rowLabel: string; seatNumber: number }[]) =>
  seats.map((s) => `${s.rowLabel}${s.seatNumber}`);

describe('regeneration keeps a seat’s identity while its label is unchanged', () => {
  it('mints ids on first generation', () => {
    const b = regenerateBlock(block(), mint);
    expect(b.seats).toHaveLength(12);
    expect(b.seats!.every((s) => s.seatId < 0)).toBe(true);
    expect(labelsOf(b.seats!).slice(0, 5)).toEqual(['A1', 'A2', 'A3', 'A4', 'B1']);
  });

  it('GROWING a row keeps every existing seat and mints only the new one', () => {
    const first = regenerateBlock(block(), mint);
    // Pretend the server persisted it.
    const persisted = { ...first, seats: first.seats!.map((s, i) => ({ ...s, seatId: 500 + i })) };

    const grown = regenerateBlock(
      { ...persisted, params: { ...persisted.params!, seatsPerRow: 5 } },
      mint,
    );
    expect(grown.seats).toHaveLength(15);

    // Every label that existed before still maps to the SAME database row.
    const before = new Map(persisted.seats!.map((s) => [`${s.rowLabel}|${s.seatNumber}`, s.seatId]));
    let carried = 0;
    for (const s of grown.seats!) {
      const was = before.get(`${s.rowLabel}|${s.seatNumber}`);
      if (was !== undefined) {
        expect(s.seatId).toBe(was);
        carried += 1;
      } else {
        expect(s.seatId).toBeLessThan(0); // the three new "5"s
      }
    }
    expect(carried).toBe(12);
  });

  it('SHRINKING a row drops the tail and keeps the rest', () => {
    const first = regenerateBlock(block(), mint);
    const persisted = { ...first, seats: first.seats!.map((s, i) => ({ ...s, seatId: 500 + i })) };
    const shrunk = regenerateBlock(
      { ...persisted, params: { ...persisted.params!, seatsPerRow: 3 } },
      mint,
    );
    expect(shrunk.seats).toHaveLength(9);
    expect(shrunk.seats!.every((s) => s.seatId > 0)).toBe(true); // nothing re-minted
    expect(labelsOf(shrunk.seats!)).not.toContain('A4');
  });

  it('changing a label scheme relabels every seat — honestly, not silently', () => {
    const first = regenerateBlock(block(), mint);
    const persisted = { ...first, seats: first.seats!.map((s, i) => ({ ...s, seatId: 500 + i })) };
    const renamed = regenerateBlock(
      { ...persisted, params: { ...persisted.params!, rowLabelScheme: 'num-asc' } },
      mint,
    );
    // New labels, so new rows: the re-apply flow will report these as `relabel` and refuse them for
    // sold seats, which is the truthful outcome.
    expect(labelsOf(renamed.seats!).slice(0, 4)).toEqual(['11', '12', '13', '14']);
    expect(renamed.seats!.every((s) => s.seatId < 0)).toBe(true);
  });

  it('leaves a NON-parametric block completely alone', () => {
    const free = block({ params: undefined, seats: [{ seatId: 7, rowLabel: 'Z', seatNumber: 9, dx: 0, dy: 0, rotation: 0 }] });
    expect(regenerateBlock(free, mint)).toBe(free);
  });

  it('clips to the remaining seat budget instead of building a draft that cannot be saved', () => {
    const huge = block({ params: { rowsCount: 100, seatsPerRow: 200, seatSpacing: 110, rowSpacing: 110 } });
    expect(regenerateBlock(huge, mint).seats!.length).toBe(LAYOUT_MAX_SEATS);
    expect(regenerateBlock(huge, mint, 25).seats).toHaveLength(25);
  });
});

describe('label schemes', () => {
  it('letters rows both ways and numbers them both ways', () => {
    expect(rowLabelFor(0, 3, 'alpha-asc')).toBe('A');
    expect(rowLabelFor(0, 3, 'alpha-desc')).toBe('C');
    expect(rowLabelFor(0, 3, 'num-asc')).toBe('1');
    expect(rowLabelFor(0, 3, 'num-desc')).toBe('3');
    expect(rowLabelFor(0, 3, 'alpha-asc', 'L-')).toBe('L-A');
    expect(letterAt(26)).toBe('AA');
  });

  it('numbers seats ascending, descending, odd and even', () => {
    expect([0, 1, 2].map((c) => seatNumberFor(c, 3, 'num-asc'))).toEqual([1, 2, 3]);
    expect([0, 1, 2].map((c) => seatNumberFor(c, 3, 'num-desc'))).toEqual([3, 2, 1]);
    expect([0, 1, 2].map((c) => seatNumberFor(c, 3, 'odd'))).toEqual([1, 3, 5]);
    expect([0, 1, 2].map((c) => seatNumberFor(c, 3, 'even'))).toEqual([2, 4, 6]);
  });

  it('caps a row label at the 8 characters the column allows', () => {
    expect(rowLabelFor(0, 1, 'alpha-asc', 'RẤT-DÀI-QUÁ').length).toBeLessThanOrEqual(8);
  });
});

describe('projection produces storable, uniquely-labelled seats', () => {
  const storable = (seats: { x: number; y: number; rotation: number }[]) => {
    for (const s of seats) {
      expect(Number.isInteger(s.x) && s.x >= 0 && s.x <= 10000).toBe(true);
      expect(Number.isInteger(s.y) && s.y >= 0 && s.y <= 10000).toBe(true);
      expect(Number.isInteger(s.rotation) && s.rotation >= 0 && s.rotation <= 359).toBe(true);
    }
  };

  it('places a grid at block origin + offset', () => {
    const p = projectDocument(doc([regenerateBlock(block(), mint)]));
    expect(p.seats).toHaveLength(12);
    storable(p.seats);
    expect({ x: p.seats[0].x, y: p.seats[0].y }).toEqual({ x: 1000, y: 1000 });
    expect({ x: p.seats[1].x, y: p.seats[1].y }).toEqual({ x: 1150, y: 1000 });
    expect({ x: p.seats[4].x, y: p.seats[4].y }).toEqual({ x: 1000, y: 1150 });
    // Section and category are inherited from the block.
    expect(p.seats.every((s) => s.sectionId === 1 && s.categoryId === 1)).toBe(true);
  });

  it('rotates a block about its origin, and composes rotation onto each seat', () => {
    const rotated = regenerateBlock(block({ rotation: 90 }), mint);
    const p = projectDocument(doc([rotated]));
    // (dx=150, dy=0) rotated 90° about the origin lands at (x, y+150).
    expect({ x: p.seats[1].x, y: p.seats[1].y }).toEqual({ x: 1000, y: 1150 });
    expect(p.seats[1].rotation).toBe(90);
    storable(p.seats);
  });

  it('clamps a block dragged past the edge rather than emitting an unstorable row', () => {
    const p = projectDocument(doc([regenerateBlock(block({ x: 9950, y: 9950 }), mint)]));
    storable(p.seats);
    expect(p.seats.some((s) => s.x === 10000)).toBe(true);
  });

  it('bends a curved row without leaving the space, and keeps labels unique', () => {
    const arc = regenerateBlock(
      block({ kind: 'curved-row', x: 5000, y: 2000, params: { rowsCount: 2, seatsPerRow: 9, rowSpacing: 200, radius: 1500, arcAngle: 120 } }),
      mint,
    );
    const p = projectDocument(doc([arc]));
    expect(p.seats).toHaveLength(18);
    storable(p.seats);
    expect(new Set(labelsOf(p.seats)).size).toBe(18);
  });

  it('reports no validation issues for a well-formed document', () => {
    const p = projectDocument(doc([regenerateBlock(block(), mint)]));
    const issues = validateLayout({
      seats: p.seats.map((s, i) => ({
        id: s.id ?? -(i + 1),
        sectionId: s.sectionId,
        categoryId: s.categoryId,
        rowLabel: s.rowLabel,
        seatNumber: s.seatNumber,
        x: s.x,
        y: s.y,
      })),
      sections: p.sections.map((s) => ({ id: s.id as number, name: s.name })),
      categories: p.categories.map((c) => ({ id: c.id as number, name: c.name })),
      elements: p.elements.map((e) => ({ kind: e.kind, x: e.x, y: e.y, points: e.points })),
    });
    expect(issues).toEqual([]);
  });

  it('turns decoration into elements and never into seats', () => {
    const p = projectDocument(
      doc([
        block({ key: 'b2', kind: 'stage', title: 'Sân khấu', params: undefined, label: 'SÂN KHẤU' }),
        block({ key: 'b3', kind: 'text', params: undefined, label: 'Ghi chú' }),
        block({ key: 'b4', kind: 'exit', params: undefined, label: 'EXIT' }),
        block({ key: 'b5', kind: 'ga-zone', params: undefined, capacity: 250, label: 'Khu đứng' }),
      ]),
    );
    expect(p.seats).toHaveLength(0);
    expect(p.elements.map((e) => e.kind)).toEqual(['stage', 'label', 'exit', 'area']);
    // A GA zone carries its headcount; its standing positions come from the standing-area endpoint.
    expect(p.elements.find((e) => e.kind === 'area')?.capacity).toBe(250);
  });

  it('keeps seatOrigin parallel to seats so ids can be stitched back', () => {
    const p = projectDocument(doc([regenerateBlock(block(), mint)]));
    expect(p.seatOrigin).toHaveLength(p.seats.length);
    expect(p.seatOrigin[0]).toEqual({ blockKey: 'b1', index: 0 });

    const saved = p.seats.map((_, i) => 900 + i);
    const stitched = stitchSeatIds(doc([regenerateBlock(block(), mint)]), p.seatOrigin, saved);
    expect(stitched.blocks[0].seats!.map((s) => s.seatId)).toEqual(saved);
  });
});

describe('adopting a layout that has no document', () => {
  const layout: Layout = {
    id: 1,
    venueId: 1,
    name: 'Sơ đồ mặc định',
    status: 'draft',
    isTemplate: false,
    version: 3,
    sections: [{ id: 1, name: 'Khu A', seatShape: 'circle', seatSizeMultiplier: 1 }],
    categories: [{ id: 1, name: 'VIP', color: '#B3453C' }],
    seats: [
      { id: 11, sectionId: 1, categoryId: 1, rowLabel: 'A', seatNumber: 1, seatType: 'single', x: 2000, y: 3000, rotation: 0 },
      { id: 12, sectionId: 1, categoryId: 1, rowLabel: 'A', seatNumber: 2, seatType: 'single', x: 2150, y: 3000, rotation: 15 },
      { id: 13, sectionId: null, categoryId: null, rowLabel: 'B', seatNumber: 1, seatType: 'standing', x: 500, y: 500, rotation: 0 },
    ],
    elements: [{ id: 5, kind: 'stage', x: 5000, y: 600, width: 3000, height: 400, rotation: 0, label: 'Sân khấu' }],
    tables: [],
    floorPlan: { url: null, scale: 1000, offsetX: 0, offsetY: 0, opacity: 50, visibleToBuyers: false },
    referenceChart: { url: null, scale: 1000, offsetX: 0, offsetY: 0, opacity: 50 },
    document: null, // the case adoption exists for
  };

  it('round-trips every seat exactly — id, label and position', () => {
    const projected = projectDocument(adoptLayout(layout));
    const norm = (s: { id?: number; rowLabel: string; seatNumber: number; x: number; y: number; rotation: number }) =>
      `${s.id}|${s.rowLabel}${s.seatNumber}|${s.x},${s.y}|${s.rotation}`;
    expect(projected.seats.map(norm).sort()).toEqual(layout.seats.map(norm).sort());
  });

  it('round-trips a ROTATED table\u2019s seats without walking them around the table', () => {
    // A table block carries the table's own rotation, and the projection re-applies it to every seat
    // offset. Adoption must therefore store the offset UN-rotated. Storing the world-space delta
    // rotated each seat a second time per save — at 0\u00b0 the two are identical, which is exactly why
    // this survived: every fixture in this file used an unrotated table.
    const rotated: Layout = {
      ...layout,
      seats: [
        { id: 21, sectionId: 1, categoryId: 1, rowLabel: 'B\u00e0n 1', seatNumber: 1, seatType: 'single', x: 5400, y: 5000, rotation: 0, tableId: 9 },
        { id: 22, sectionId: 1, categoryId: 1, rowLabel: 'B\u00e0n 1', seatNumber: 2, seatType: 'single', x: 5000, y: 5400, rotation: 0, tableId: 9 },
      ],
      tables: [
        { id: 9, sectionId: 1, name: 'B\u00e0n 1', shape: 'round', x: 5000, y: 5000, width: 600, height: 600, rotation: 37, seatCount: 2 },
      ],
    };

    const projected = projectDocument(adoptLayout(rotated));
    for (const original of rotated.seats) {
      const back = projected.seats.find((s) => s.id === original.id);
      expect(back).toBeDefined();
      // Within a unit: offsets are stored as integers, so the trip costs rounding and nothing else.
      expect(Math.abs(back!.x - original.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(back!.y - original.y)).toBeLessThanOrEqual(1);
    }
  });

  it('marks adopted blocks NON-parametric, so nothing can silently relabel them', () => {
    const adopted = adoptLayout(layout);
    for (const b of adopted.blocks) expect(b.params).toBeUndefined();
  });

  it('keeps the sectionless seat separate rather than folding it into a section', () => {
    const adopted = adoptLayout(layout);
    const seatBearing = adopted.blocks.filter((b) => b.seats && b.seats.length > 0);
    expect(seatBearing).toHaveLength(2);
    expect(seatBearing.some((b) => b.sectionId === null)).toBe(true);
  });

  it('carries decoration across', () => {
    const projected = projectDocument(adoptLayout(layout));
    expect(projected.elements.map((e) => e.kind)).toEqual(['stage']);
  });
});

describe('document helpers', () => {
  it('nextBlockKey is deterministic and monotonic', () => {
    expect(nextBlockKey(emptyDocument())).toBe('b1');
    expect(nextBlockKey(doc([block({ key: 'b1' }), block({ key: 'b7' })]))).toBe('b8');
  });

  it('stripIds leaves no positive id behind — an export is a template', () => {
    const persisted = doc([{ ...regenerateBlock(block(), mint), seats: [{ seatId: 42, rowLabel: 'A', seatNumber: 1, dx: 0, dy: 0, rotation: 0 }], tableId: 9 }]);
    const stripped = stripIds(persisted, mint);
    expect(stripped.sections.every((s) => s.id < 0)).toBe(true);
    expect(stripped.categories.every((c) => c.id < 0)).toBe(true);
    for (const b of stripped.blocks) {
      expect(b.sectionId).toBeLessThan(0);
      expect(b.tableId).toBeLessThan(0);
      for (const s of b.seats ?? []) expect(s.seatId).toBeLessThan(0);
    }
  });

  it('remapDocument points a clone at its OWN rows, never the source’s', () => {
    const source = doc([{ ...block(), seats: [{ seatId: 42, rowLabel: 'A', seatNumber: 1, dx: 0, dy: 0, rotation: 0 }] }]);
    const remapped = remapDocument(
      source,
      { sections: new Map([[1, 71]]), categories: new Map([[1, 72]]), seats: new Map([[42, 73]]), tables: new Map() },
      mint,
    );
    expect(remapped.sections[0].id).toBe(71);
    expect(remapped.categories[0].id).toBe(72);
    expect(remapped.blocks[0].seats![0].seatId).toBe(73);
    // Anything the map does not cover becomes a placeholder rather than addressing another layout.
    expect(remapped.blocks[0].sectionId).toBe(71);
  });

  it('upgradeDocument accepts a document and rejects anything else', () => {
    expect(upgradeDocument(emptyDocument())?.schemaVersion).toBe(CHART_DOCUMENT_SCHEMA);
    expect(upgradeDocument({ blocks: [], categories: [], sections: [] })?.gridSize).toBe(50);
    for (const junk of [null, undefined, 5, 'x', [], {}, { blocks: [] }]) {
      expect(upgradeDocument(junk)).toBeNull();
    }
  });
});

describe('capacity zones, at the publish gate', () => {
  // A zone is an `area` carrying a capacity AND a price class. The gate has to treat it as capacity
  // without treating it as seats, which is three separate rules.
  const zone = (over: Partial<{ capacity: number; categoryId: number | null }> = {}) => ({
    kind: 'area',
    x: 5000,
    y: 5000,
    capacity: 500,
    categoryId: 1,
    ...over,
  });
  const base = {
    sections: [{ id: 1, name: 'Khu A', seatSizeMultiplier: 1 }],
    categories: [{ id: 1, name: 'Đứng' }],
  };

  it('lets a chart with NO seats publish when it has a zone', () => {
    const issues = validateLayout({ ...base, seats: [], elements: [zone()] });
    expect(issues.find((i) => i.code === 'zero_capacity')).toBeUndefined();
  });

  it('still refuses a chart with neither seats nor zones', () => {
    const issues = validateLayout({ ...base, seats: [], elements: [] });
    expect(issues.find((i) => i.code === 'zero_capacity')).toBeDefined();
  });

  it('refuses a zone that names no price class — it could never be priced', () => {
    const issues = validateLayout({ ...base, seats: [], elements: [zone({ categoryId: null })] });
    expect(issues.find((i) => i.code === 'zone_without_category')).toBeDefined();
  });

  it('refuses one class sold BOTH as seats and as capacity', () => {
    // Generation would have to make the class's tier seat-gated and count-gated at once.
    const issues = validateLayout({
      ...base,
      seats: [{ id: 1, sectionId: 1, categoryId: 1, rowLabel: 'A', seatNumber: 1, x: 100, y: 100 }],
      elements: [zone()],
    });
    expect(issues.find((i) => i.code === 'category_mixed_inventory')).toBeDefined();
  });

  it('requires a zone’s class to be priced at bind time, exactly as a seat’s is', () => {
    const unpriced = validateLayout({ ...base, seats: [], elements: [zone()], categoriesWithTier: [] });
    expect(unpriced.find((i) => i.code === 'category_without_tier')).toBeDefined();

    const priced = validateLayout({ ...base, seats: [], elements: [zone()], categoriesWithTier: [1] });
    expect(priced.find((i) => i.code === 'category_without_tier')).toBeUndefined();
  });

  it('treats a zero-capacity area as a drawing, not a zone', () => {
    const issues = validateLayout({ ...base, seats: [], elements: [zone({ capacity: 0 })] });
    // No capacity means it is not inventory, so the chart is empty — and it is not asked for a class.
    expect(issues.find((i) => i.code === 'zero_capacity')).toBeDefined();
    expect(issues.find((i) => i.code === 'zone_without_category')).toBeUndefined();
  });
});
