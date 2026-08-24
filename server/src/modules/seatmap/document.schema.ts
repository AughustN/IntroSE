import { z } from "zod";
import {
  LAYOUT_MAX_SEATS,
  LAYOUT_MAX,
  LAYOUT_MIN,
  LAYOUT_SPACE,
  POLYGON_MAX_POINTS,
  ZONE_MAX_CAPACITY,
} from "../../config.js";

// Boundary validation for the authoring document (shared/catalog/seatmap-document.ts).
//
// The editor this was ported from validated an imported document with two truthiness checks
// (`if (!parsed.elements || !parsed.categories)`), so a blob missing `blueprint` crashed its canvas on
// the first render and a blob with a string where a number belonged corrupted the map silently. A
// document arrives here from a paste box, so it is exactly the input that must not be trusted.
//
// Deliberately NOT capped by seat count: the ceiling is a DOMAIN rule counted from the PROJECTION, and
// the service reports it as `409 seat_limit_reached` naming the limit. A `.max()` here would shadow
// that with a generic 400 (the same reasoning as `saveLayoutSchema`'s uncapped `seats`).

// Deliberately looser than the wall: a document block's anchor is projected and then clamped, so a
// value slightly outside is a position to correct, not a payload to reject. The margin is one frame
// either side of the wall, which is what the pre-wall version meant by `-LAYOUT_SPACE..2×`.
const coord = z
  .number()
  .int()
  .min(LAYOUT_MIN - LAYOUT_SPACE)
  .max(LAYOUT_MAX + LAYOUT_SPACE);
/** Seat offsets are block-relative and may be negative — a round table's seats sit outside its box. */
const offset = z.number().int().min(-LAYOUT_SPACE).max(LAYOUT_SPACE);

const documentSeat = z.object({
  seatId: z.number().int(),
  rowLabel: z.string().trim().min(1).max(8),
  seatNumber: z.number().int().min(1),
  dx: offset,
  dy: offset,
  rotation: z.number().int(),
  categoryId: z.number().int().nullable().optional(),
  sectionId: z.number().int().nullable().optional(),
  isAccessible: z.boolean().optional(),
  seatType: z.enum(["single", "double", "standing"]).optional(),
  /** Which `layout_rows` row this seat is in (0032). Optional: absent on every seat drawn before rows. */
  rowId: z.number().int().nullable().optional(),
  /**
   * The accessible seat this one accompanies (0036). Any int at parse time — a dangling negative
   * placeholder is reported by the validator as `companion_wrong_target`, not refused up front,
   * because the editor legitimately mints both ends before the first save.
   *
   * NOT nullable: `DocumentSeat.companionSeatId` is `number | undefined`, and a zod-`null` here
   * would widen the parsed type past the shared contract and fail `SaveLayoutRequest` downstream.
   */
  companionSeatId: z.number().int().optional(),
});

const blockParams = z.object({
  rowsCount: z.number().int().min(1).max(500).optional(),
  seatsPerRow: z.number().int().min(1).max(500).optional(),
  seatSpacing: z.number().int().min(1).max(LAYOUT_SPACE).optional(),
  rowSpacing: z.number().int().min(1).max(LAYOUT_SPACE).optional(),
  radius: z.number().int().min(1).max(LAYOUT_SPACE).optional(),
  concentric: z.boolean().optional(),
  arcAngle: z.number().min(1).max(360).optional(),
  rowLabelScheme: z.enum(["alpha-asc", "alpha-desc", "num-asc", "num-desc"]).optional(),
  seatLabelScheme: z.enum(["num-asc", "num-desc", "even", "odd"]).optional(),
  rowLabelPrefix: z.string().max(8).optional(),
  seatLabelPrefix: z.string().max(8).optional(),
  startRowIndex: z.number().int().min(0).max(999).optional(),
  startSeatNumber: z.number().int().min(1).max(9999).optional(),
  rowLabelSuffix: z.string().max(8).optional(),
  seatNumberStep: z.number().int().min(1).max(100).optional(),
  seatNumberPadding: z.number().int().min(0).max(6).optional(),
});

const documentBlock = z.object({
  key: z.string().trim().min(1).max(32),
  kind: z.enum([
    "seating-block",
    "curved-row",
    "single-row",
    "individual-seat",
    "table",
    "ga-zone",
    "stage",
    "aisle",
    "door",
    "bar",
    "text",
    "shape",
    "exit",
    "restroom",
    "food_drink",
    "smoking",
    "first_aid",
    "lift_stairs",
    "wheelchair",
  ]),
  title: z.string().trim().min(1).max(80),
  x: coord,
  y: coord,
  rotation: z.number().int(),
  width: z.number().int().min(1).max(LAYOUT_SPACE),
  height: z.number().int().min(1).max(LAYOUT_SPACE),
  sectionId: z.number().int().nullable(),
  categoryId: z.number().int().nullable(),
  params: blockParams.optional(),
  // A zone is one row whatever it holds, so its ceiling is its own, not the seat budget.
  capacity: z.number().int().min(0).max(ZONE_MAX_CAPACITY).optional(),
  tableId: z.number().int().nullable().optional(),
  tableShape: z.enum(["round", "rect"]).optional(),
  tableSeatCount: z.number().int().min(0).max(999).optional(),
  sideCounts: z.array(z.number().int().min(0)).length(4).nullable().optional(),
  bookingMode: z.enum(["per_seat", "whole_table"]).optional(),
  label: z.string().max(120).nullable().optional(),
  points: z
    .array(z.object({ x: coord, y: coord }))
    .max(POLYGON_MAX_POINTS)
    .nullable()
    .optional(),
  seats: z.array(documentSeat).optional(),
  // Authoring-only: the projection never reads it, so a locked block sells like any other.
  locked: z.boolean().optional(),
  hidden: z.boolean().optional(),
  groupId: z.string().trim().min(1).max(24).optional(),
  // A drawn outline's fill. Same strict hex as a category: the value ends up in an SVG `fill`, so
  // anything looser would let `url(...)` name a paint server of the caller's choosing.
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  geometry: z
    .enum(["rect", "square", "circle", "oval", "triangle", "hexagon"])
    .nullable()
    .optional(),
});

export const documentSchema = z.object({
  schemaVersion: z.number().int().min(1),
  gridSize: z.number().int().min(1).max(LAYOUT_SPACE),
  sections: z
    .array(
      z.object({
        id: z.number().int(),
        name: z.string().trim().min(1).max(60),
        seatShape: z.enum(["circle", "square"]).optional(),
        seatSizeMultiplier: z.number().min(0.5).max(2).optional(),
        // The level this section is on (0044). Any int at parse time, including a negative
        // placeholder the editor minted this session — `saveLayout` resolves it, and an id no floor
        // answers to lands the section on the implicit single floor rather than failing the save.
        floorId: z.number().int().nullable().optional(),
      }),
    )
    .max(200),
  /*
   * Floors (0044). Optional, because a chart with none is a chart on one floor — which is every
   * chart written before this and most charts after it.
   *
   * Capped low on purpose. A venue with more than a few dozen levels is not a venue, and the picker
   * is a strip the buyer reads at a glance: the bound is a product statement, not just a guard
   * against an unbounded array.
   */
  floors: z
    .array(
      z.object({
        id: z.number().int(),
        name: z.string().trim().min(1).max(40),
        displayOrder: z.number().int().min(0).max(1000),
      }),
    )
    .max(40)
    .optional(),
  /*
   * Rows (0032). Optional, because every document stored before rows existed has none and must still
   * parse — the projection derives them from seat labels in that case.
   *
   * Capped well above the seat ceiling's worst case: LAYOUT_MAX_SEATS seats could in principle be
   * LAYOUT_MAX_SEATS rows of one, so the bound is there to stop an unbounded array rather than to
   * express a product rule.
   */
  rows: z
    .array(
      z.object({
        id: z.number().int(),
        label: z.string().trim().min(1).max(8),
        sectionId: z.number().int().nullable(),
        displayOrder: z.number().int().min(0).max(100_000),
      }),
    )
    .max(LAYOUT_MAX_SEATS)
    .optional(),
  categories: z
    .array(
      z.object({
        id: z.number().int(),
        name: z.string().trim().min(1).max(40),
        // Same strict hex as `categorySchema`: the value ends up in an SVG `fill`.
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      }),
    )
    .max(50),
  blocks: z.array(documentBlock).max(1000),
});
