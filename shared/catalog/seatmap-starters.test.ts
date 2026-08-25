import { describe, expect, it } from "vitest";
import { STARTERS, starterById } from "./seatmap-starters.js";
import { projectDocument } from "./seatmap-project.js";
import { CHART_DOCUMENT_SCHEMA } from "./seatmap-document.js";
import {
  LAYOUT_MAX,
  LAYOUT_MAX_SEATS,
  LAYOUT_MIN,
  blockingIssues,
  validateLayout,
} from "./seatmap-validate.js";

// A starter is shipped code, so its failure mode is "every organizer who picks it gets a chart that
// will not publish". These assert the thing a hand-check cannot: that the DECLARED capacity matches
// what the projection actually produces, and that each one clears the publish gate as drawn.

describe("built-in starter charts", () => {
  it("has unique ids and names", () => {
    expect(new Set(STARTERS.map((s) => s.id)).size).toBe(STARTERS.length);
    expect(new Set(STARTERS.map((s) => s.name)).size).toBe(STARTERS.length);
  });

  it("offers at least two sizes for every starter", () => {
    // One size is a chart, not a template — see `Starter.sizes`.
    for (const s of STARTERS) expect(s.sizes.length).toBeGreaterThanOrEqual(2);
  });

  // Every SIZE of every starter, not just the default: changing the row count changes each block's
  // extent, so a size that was never projected is a size whose blocks may be sitting on top of each
  // other. `overlapping_seats` is a blocking publish issue, and this is what catches it.
  for (const starter of STARTERS) {
    for (const size of starter.sizes) {
      describe(`${starter.name} · ${size.label}`, () => {
        const doc = starter.build(size.id);
        const projected = projectDocument(doc);

        it("declares the capacity it actually produces", () => {
          // The picker shows `seatCount` before anything is created, so a wrong number here is a
          // promise the chart then breaks.
          expect(projected.seats.length).toBe(size.seatCount);
        });

        it("stays inside the seat ceiling and the coordinate wall", () => {
          expect(projected.seats.length).toBeLessThanOrEqual(LAYOUT_MAX_SEATS);
          for (const s of projected.seats) {
            expect(s.x).toBeGreaterThanOrEqual(LAYOUT_MIN);
            expect(s.x).toBeLessThanOrEqual(LAYOUT_MAX);
            expect(s.y).toBeGreaterThanOrEqual(LAYOUT_MIN);
            expect(s.y).toBeLessThanOrEqual(LAYOUT_MAX);
          }
        });

        it("gives every seat a section and a price class", () => {
          // `category_without_tier` and an unsectioned seat are both publish blockers, and a starter
          // that ships with either hands the organizer a chart that cannot go on sale.
          for (const s of projected.seats) {
            expect(s.sectionId).not.toBeNull();
            expect(s.categoryId).not.toBeNull();
          }
        });

        it("labels every seat uniquely within its section", () => {
          const seen = new Set<string>();
          for (const s of projected.seats) {
            const key = `${s.sectionId}|${s.rowLabel}|${s.seatNumber}`;
            expect(seen.has(key), `duplicate ${key}`).toBe(false);
            seen.add(key);
          }
        });

        it("clears the publish gate as drawn", () => {
          // Companion pointers are translated the way `ChartEditor` translates them before validating a
          // live draft. An unsaved seat has no database id, so its `companionSeatId` still holds the
          // document's placeholder — feeding that to the validator raw reports `companion_wrong_target`
          // on every pair that has not been saved yet, which is a fact about ids, not about the chart.
          const docSeatByOrigin = new Map<string, { seatId: number }>();
          for (const b of doc.blocks) {
            (b.seats ?? []).forEach((seat, i) => docSeatByOrigin.set(`${b.key}|${i}`, seat));
          }
          const toValidatorId = new Map<number, number>();
          projected.seatOrigin.forEach((origin, i) => {
            const docSeat = docSeatByOrigin.get(`${origin.blockKey}|${origin.index}`);
            if (docSeat) toValidatorId.set(docSeat.seatId, i + 1);
          });

          const issues = validateLayout({
            seats: projected.seats.map((s, i) => ({
              id: i + 1,
              sectionId: s.sectionId,
              categoryId: s.categoryId,
              rowLabel: s.rowLabel,
              seatNumber: s.seatNumber,
              x: s.x,
              y: s.y,
              isAccessible: s.isAccessible,
              companionSeatId:
                s.companionSeatId === null || s.companionSeatId === undefined
                  ? undefined
                  : (toValidatorId.get(s.companionSeatId) ?? s.companionSeatId),
            })),
            sections: doc.sections.map((x) => ({
              id: x.id,
              name: x.name,
              color: null,
              seatSizeMultiplier: 1,
              // Mirrors both live call sites (`ChartEditor` and `layouts.service`). Without it the
              // overlap rule cannot see levels, and the stacked stadium size — an upper deck sitting
              // directly on the lower one, which is where an upper deck is — reports
              // `overlapping_seats` for a chart that is perfectly legal.
              floorId: x.floorId ?? null,
            })),
            categories: doc.categories.map((c) => ({ id: c.id, name: c.name })),
            elements: projected.elements.map((e) => ({
              kind: e.kind,
              x: e.x,
              y: e.y,
              points: e.points ?? null,
              capacity: e.capacity ?? null,
              categoryId: e.categoryId ?? null,
            })),
            categoriesWithTier: doc.categories.map((c) => c.id),
          });
          expect(blockingIssues(issues)).toEqual([]);
        });

        it("draws every decoration it places", () => {
          /*
           * The check the first six starters shipped without, and the one that would have caught an
           * arena with no pitch.
           *
           * Nothing else here looks at whether an element RENDERS: the capacity, overlap and publish
           * checks all pass happily on a chart whose decoration is invisible. A `boundary` (what a
           * `shape` block projects to) is drawn by `SeatCanvas` as a polyline over `el.points` and
           * ignores `width`/`height` entirely — so a shape with no points is a block that exists,
           * validates, saves, and shows nothing.
           */
          const shapes = projected.elements.filter(
            (e) => e.kind === "boundary" || e.kind === "divider",
          );
          for (const sh of shapes) {
            expect(sh.points, `${sh.kind} with no points renders as nothing`).toBeTruthy();
            expect((sh.points ?? []).length).toBeGreaterThanOrEqual(2);
          }

          // And a shape cannot caption itself — the projection strips its label — so any starter that
          // wants a name over a shape must place a separate text element.
          for (const sh of shapes) expect(sh.label ?? null).toBeNull();
        });

        it("is a current-schema document", () => {
          expect(doc.schemaVersion).toBe(CHART_DOCUMENT_SCHEMA);
        });
      });
    }
  }

  it("looks a starter up by id, and refuses an unknown one", () => {
    expect(starterById(STARTERS[0].id)?.name).toBe(STARTERS[0].name);
    expect(starterById("nope")).toBeUndefined();
  });
});
