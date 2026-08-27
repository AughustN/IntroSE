import { type NextFunction, type Request, type Response, Router } from "express";
import multer from "multer";
import { z } from "zod";
import {
  FLOORPLAN_MAX_BYTES,
  FLOORPLAN_MAX_PX,
  LAYOUT_MAX_SEATS,
  LAYOUT_MAX,
  LAYOUT_MIN,
  LAYOUT_SPACE,
  POLYGON_MAX_POINTS,
  SEAT_DIAMETER,
  SEAT_SIZE_MAX_PCT,
  SEAT_SIZE_MIN_PCT,
} from "../../config.js";
import { blockingIssues } from "@shared/catalog/seatmap-validate.js";
import { ImageRejected, deleteFloorPlan, processFloorPlan, saveFloorPlan } from "./floorplan.js";
import { uploadRateLimit, withUploadSlot } from "./upload.throttle.js";
import {
  assertTablesInLayout,
  createTable,
  deleteTable,
  deleteTables,
  tableLayoutId,
  updateTable,
  updateTables,
} from "./tables.js";
import { createStandingArea, reshapeStandingArea } from "./standing.js";
import { documentSchema } from "./document.schema.js";
import { err } from "../../http.js";
import { requireOrganizer } from "../../middleware/authz.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validate as validateBody } from "../../middleware/validate.js";
import { pool } from "../../db/pool.js";
import { broadcastSeatUpdate } from "../../realtime/io.js";
import type { SeatStatus } from "@shared/catalog/types.js";
import * as apply from "./apply.js";
import * as repo from "./layouts.repo.js";
import * as service from "./layouts.service.js";

/** Current statuses of the given seats, so a retier broadcast carries a truthful status alongside
 *  the new tier rather than assuming `available`. */
async function currentStatuses(
  showtimeId: number,
  ids: number[],
): Promise<{ showtimeSeatId: number; status: SeatStatus }[]> {
  const { rows } = await pool.query<{ id: number; status: SeatStatus }>(
    `SELECT id, status FROM showtime_seats WHERE showtime_id = $1 AND id = ANY($2::bigint[])`,
    [showtimeId, ids],
  );
  return rows.map((r) => ({ showtimeSeatId: r.id, status: r.status }));
}

// Seat-map authoring — approved organizer + ownership on every route (SEC-04, FR-042).
// Mounted at /api/organizer. Derived from contracts/seatmap.openapi.yaml.
export const seatmapRouter = Router();
seatmapRouter.use(requireAuth, requireOrganizer);

const asyncH =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

// ---- Schemas (SEC-07: strict, validated before use) ----

// The WALL, not the frame — a coordinate the database now accepts must not be refused here first.
const coord = z.number().int().min(LAYOUT_MIN).max(LAYOUT_MAX);
const rotation = z.number().int();

const sectionSchema = z.object({
  id: z.number().int().optional(),
  name: z.string().trim().min(1).max(60),
  description: z.string().max(500).nullable().optional(),
  // Visual style (FR-064). `color` is editor-only and never reaches the buyer map.
  color: z.string().trim().max(32).nullable().optional(),
  seatShape: z.enum(["circle", "square"]).optional(),
  seatSizeMultiplier: z
    .number()
    .min(SEAT_SIZE_MIN_PCT / 100)
    .max(SEAT_SIZE_MAX_PCT / 100)
    .optional(),
});

const categorySchema = z.object({
  id: z.number().int().optional(),
  name: z.string().trim().min(1).max(40),
  // Required, and a strict hex: a category is RECOGNISED by its colour, and the value ends up in a
  // `fill`, so it is checked at the boundary rather than trusted.
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

const seatSchema = z.object({
  id: z.number().int().optional(),
  sectionId: z.number().int().nullable(),
  categoryId: z.number().int().nullable().optional(),
  rowLabel: z.string().trim().min(1).max(8),
  seatNumber: z.number().int().min(1),
  seatType: z.enum(["single", "double", "standing"]),
  x: coord,
  y: coord,
  rotation,
  isAccessible: z.boolean().optional(),
});

const elementSchema = z.object({
  id: z.number().int().optional(),
  kind: z.enum([
    "stage",
    "aisle",
    "door",
    "bar",
    "label",
    "area",
    // Hall outline and dividers (FR-057), then the facility icons (FR-061).
    "boundary",
    "divider",
    "exit",
    "restroom",
    "food_drink",
    "smoking",
    "first_aid",
    "lift_stairs",
    "wheelchair",
  ]),
  x: coord,
  y: coord,
  width: z.number().int().min(1).max(LAYOUT_SPACE),
  height: z.number().int().min(1).max(LAYOUT_SPACE),
  rotation,
  label: z.string().max(60).nullable(),
  /** Ordered vertices for a boundary or divider; the count rule is a DOMAIN check (FR-059). */
  points: z
    .array(z.object({ x: coord, y: coord }))
    .max(POLYGON_MAX_POINTS)
    .nullable()
    .optional(),
  /** `area` only: how many standing positions were generated inside it. */
  capacity: z.number().int().min(0).max(LAYOUT_MAX_SEATS).nullable().optional(),
});

const tableSchema = z.object({
  sectionId: z.number().int().nullable(),
  categoryId: z.number().int().nullable().optional(),
  name: z.string().trim().min(1).max(40),
  shape: z.enum(["round", "rect"]),
  x: coord,
  y: coord,
  width: z.number().int().min(1).max(LAYOUT_SPACE),
  height: z.number().int().min(1).max(LAYOUT_SPACE),
  rotation,
  // Bounds are a DOMAIN rule so the refusal names the limit rather than a generic 400 — but a
  // non-integer or absurd value is still a schema error.
  seatCount: z.number().int().min(0).max(999),
  sideCounts: z.array(z.number().int().min(0)).length(4).nullable().optional(),
  bookingMode: z.enum(["per_seat", "whole_table"]).optional(),
});
const updateTableSchema = tableSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "empty" });

/**
 * A gesture that lands on SEVERAL tables, sent as one request.
 *
 * One request per table let a refusal on the third leave the first two committed, with the editor
 * holding a document the database no longer matched.
 */
const batchTablesSchema = z.object({
  updates: z
    .array(z.object({ tableId: z.number().int(), patch: updateTableSchema }))
    .min(1)
    .max(200),
});

const deleteTablesSchema = z.object({
  tableIds: z.array(z.number().int()).min(1).max(200),
});

/** The version the caller judged. Optional so an older client still publishes, just unguarded. */
const publishSchema = z.object({ expectedVersion: z.number().int().min(1).optional() });

const createLayoutSchema = z.object({ name: z.string().trim().min(1).max(80) });

const saveLayoutSchema = z
  .object({
    version: z.number().int().min(1),
    name: z.string().trim().min(1).max(80).optional(),
    isTemplate: z.boolean().optional(),
    /**
     * The authoring document. When present the server projects the collections from it and ignores the
     * arrays below, so a client never has to keep the two in step.
     */
    document: documentSchema.optional(),
    /**
     * @deprecated The pre-document shape, accepted until the last caller sends a document.
     *
     * Sending these ALONGSIDE a `document` is refused outright (see the refine below). The server
     * resolves the conflict by ignoring them, which is defensible but silent — a caller that sent both
     * would believe both had been applied, and would find out only when the seats it asked for were not
     * there. An ambiguous request is a mistake, so it is an error rather than a coin toss.
     */
    sections: z.array(sectionSchema).max(200).optional(),
    categories: z.array(categorySchema).max(50).optional(),
    // Deliberately uncapped here: the ceiling is a DOMAIN rule, and the service reports it as
    // `409 seat_limit_reached` / `element_limit_reached` (FR-007, FR-019). A schema `.max()` would
    // shadow it with a generic 400. Payload size is already bounded by the 1 MB JSON limit.
    seats: z.array(seatSchema).optional(),
    elements: z.array(elementSchema).optional(),
  })
  .refine((b) => !(b.document && (b.sections || b.categories || b.seats || b.elements)), {
    message: "document_and_legacy_arrays",
  });

const generateSeatsSchema = z.object({
  sectionId: z.number().int(),
  rowLabel: z.string().trim().min(1).max(8),
  count: z.number().int().min(1).max(200),
  replaceExisting: z.boolean().optional(),
});

const standingAreaSchema = z.object({
  sectionId: z.number().int(),
  rowLabel: z.string().trim().min(1).max(8),
  // 200 is the fan-zone size SC-026 names; the layout ceiling still applies on top, reported by the
  // service as `409 seat_limit_reached` rather than shadowed by a generic 400 here.
  count: z.number().int().min(1).max(500),
  points: z
    .array(z.object({ x: z.number().int().min(0), y: z.number().int().min(0) }))
    .max(POLYGON_MAX_POINTS),
});

const cloneSchema = z.object({
  targetVenueId: z.number().int(),
  name: z.string().trim().min(1).max(80),
});

// ---- Layouts (FR-001..FR-007) ----

// The library: every chart this organizer owns, across venues. Registered BEFORE `/layouts/:id` so
// the literal path is not swallowed by the parameterised one.
seatmapRouter.get(
  "/layouts",
  asyncH(async (req, res) => {
    res.json({ layouts: await service.library(req) });
  }),
);

seatmapRouter.patch(
  "/layouts/:id",
  validateBody(z.object({ name: z.string().trim().min(1).max(80) })),
  asyncH(async (req, res) => {
    const { name } = req.body as { name: string };
    res.json(await service.rename(req, Number(req.params.id), name));
  }),
);

seatmapRouter.get(
  "/layouts/:id/revisions",
  asyncH(async (req, res) => {
    res.json({ revisions: await service.revisions(req, Number(req.params.id)) });
  }),
);

seatmapRouter.get(
  "/layouts/:id/revisions/:revisionId",
  asyncH(async (req, res) => {
    res.json({
      document: await service.revisionDocument(
        req,
        Number(req.params.id),
        Number(req.params.revisionId),
      ),
    });
  }),
);

seatmapRouter.post(
  "/layouts/:id/revisions/:revisionId/restore",
  asyncH(async (req, res) => {
    res.json(
      await service.restoreRevision(req, Number(req.params.id), Number(req.params.revisionId)),
    );
  }),
);

seatmapRouter.post(
  "/layouts/:id/save-as-template",
  validateBody(z.object({ name: z.string().trim().min(1).max(80) })),
  asyncH(async (req, res) => {
    const { name } = req.body as { name: string };
    res.status(201).json(await service.saveAsTemplate(req, Number(req.params.id), name));
  }),
);

seatmapRouter.post(
  "/layouts/:id/archive",
  asyncH(async (req, res) => {
    res.json(await service.archive(req, Number(req.params.id), true));
  }),
);

seatmapRouter.post(
  "/layouts/:id/restore",
  asyncH(async (req, res) => {
    res.json(await service.archive(req, Number(req.params.id), false));
  }),
);

seatmapRouter.get(
  "/venues/:venueId/layouts",
  asyncH(async (req, res) => {
    const venueId = Number(req.params.venueId);
    await service.assertVenueOwner(req, venueId, "read");
    res.json({ layouts: await repo.listLayouts(venueId) });
  }),
);

seatmapRouter.post(
  "/venues/:venueId/layouts",
  validateBody(createLayoutSchema),
  asyncH(async (req, res) => {
    const venueId = Number(req.params.venueId);
    const { name } = req.body as z.infer<typeof createLayoutSchema>;
    const id = await service.createLayout(req, venueId, name);
    res.status(201).json(await repo.getLayout(id));
  }),
);

seatmapRouter.get(
  "/layouts/:id",
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await service.assertLayoutOwner(req, id, "read");
    const layout = await repo.getLayout(id);
    if (!layout) throw err.notFound("not_found", "Không tìm thấy sơ đồ.");
    res.json({
      ...layout,
      space: { width: LAYOUT_SPACE, height: LAYOUT_SPACE, seatDiameter: SEAT_DIAMETER },
    });
  }),
);

seatmapRouter.put(
  "/layouts/:id",
  validateBody(saveLayoutSchema),
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const body = req.body as z.infer<typeof saveLayoutSchema>;
    res.json(await service.saveLayout(req, id, body));
  }),
);

seatmapRouter.delete(
  "/layouts/:id",
  asyncH(async (req, res) => {
    await service.deleteLayout(req, Number(req.params.id));
    res.status(204).end();
  }),
);

seatmapRouter.post(
  "/layouts/:id/generate-seats",
  validateBody(generateSeatsSchema),
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const body = req.body as z.infer<typeof generateSeatsSchema>;
    const created = await service.generateSeatRow(req, id, body);
    res.status(201).json({ created, layout: await repo.getLayout(id) });
  }),
);

// ---- Validation & publishing (FR-030..FR-032) ----

seatmapRouter.post(
  "/layouts/:id/validate",
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await service.assertLayoutOwner(req, id, "read");
    const issues = await service.validate(id);
    // `valid` answers "would publish succeed?", so it turns on the BLOCKING issues only. The warnings
    // still travel in `issues` — the editor shows them, the gate ignores them.
    res.json({ valid: blockingIssues(issues).length === 0, issues });
  }),
);

seatmapRouter.post(
  "/layouts/:id/publish",
  validateBody(publishSchema),
  asyncH(async (req, res) => {
    const b = req.body as z.infer<typeof publishSchema>;
    res.json(await service.publish(req, Number(req.params.id), b.expectedVersion));
  }),
);

// ---- Floor plan (FR-020..FR-026a) ----

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: FLOORPLAN_MAX_BYTES },
});

const planAlignSchema = z.object({
  scale: z.number().int().min(1).max(10000),
  offsetX: z.number().int(),
  offsetY: z.number().int(),
  opacity: z.number().int().min(0).max(100),
  visibleToBuyers: z.boolean(),
});

seatmapRouter.post(
  "/layouts/:id/floorplan",
  uploadRateLimit,
  upload.single("file"),
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await service.assertLayoutOwner(req, id, "design");
    const file = (req as Request & { file?: { buffer: Buffer } }).file;
    if (!file) throw err.badRequest("invalid_image", "Chưa chọn tệp ảnh.");

    const webp = await withUploadSlot(() => processFloorPlan(file.buffer)).catch((e) => {
      if (e instanceof ImageRejected) {
        throw e.reason === "image_too_large"
          ? err.badRequest(
              "image_too_large",
              `Ảnh quá lớn (tối đa ${FLOORPLAN_MAX_PX}px mỗi cạnh).`,
            )
          : err.badRequest("invalid_image", "Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP.");
      }
      throw e;
    });

    const previous = await repo.currentPlanUrl(id);
    const url = await saveFloorPlan(id, webp, "floorplan");
    try {
      await repo.setPlanUrl(id, url);
    } catch (e) {
      // The write failed, so nothing references this file — remove it rather than leave an orphan on
      // disk that is served but reachable by no layout (T062, spec Edge Cases).
      await deleteFloorPlan(url);
      throw e;
    }
    await deleteFloorPlan(previous); // the old file becomes unreachable (FR-025)
    res.json((await repo.getLayout(id))?.floorPlan);
  }),
);

seatmapRouter.patch(
  "/layouts/:id/floorplan",
  validateBody(planAlignSchema),
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await service.assertLayoutOwner(req, id, "design");
    // Alignment only — no seat moves when the background does (FR-024).
    await repo.updatePlanAlignment(id, req.body as z.infer<typeof planAlignSchema>);
    res.json((await repo.getLayout(id))?.floorPlan);
  }),
);

/**
 * How hard "best available" refuses to strand a lone seat on this chart (0037).
 *
 * `design` permission, like the alignment above: it changes how the chart SELLS, not what it holds,
 * and no seat moves.
 */
const orphanRuleSchema = z.object({ orphanRule: z.enum(["balanced", "strict"]) });

seatmapRouter.patch(
  "/layouts/:id/orphan-rule",
  validateBody(orphanRuleSchema),
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await service.assertLayoutOwner(req, id, "design");
    const { orphanRule } = req.body as z.infer<typeof orphanRuleSchema>;
    await repo.updateOrphanRule(id, orphanRule);
    res.json({ orphanRule });
  }),
);

/**
 * The chart's focal point (0043) — what best-available ranks outward from.
 *
 * `null` means "infer it", the behaviour of every chart drawn before this. Bounded by the WALL rather
 * than the frame, like every other coordinate: a focal point outside the seating is legitimate (an
 * arena's pitch, a thrust stage) and the frame is only what the editor happens to look at.
 */
const focalPointSchema = z.object({
  focalPoint: z.object({ x: coord, y: coord }).nullable(),
});

seatmapRouter.patch(
  "/layouts/:id/focal-point",
  validateBody(focalPointSchema),
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await service.assertLayoutOwner(req, id, "design");
    const { focalPoint } = req.body as z.infer<typeof focalPointSchema>;
    await repo.updateFocalPoint(id, focalPoint);
    res.json({ focalPoint });
  }),
);

// ---- Reference chart: the tracing layer, editor-only (never snapshotted, never sent to buyers) ----

const referenceAlignSchema = z.object({
  scale: z.number().int().min(1).max(10000),
  offsetX: z.number().int(),
  offsetY: z.number().int(),
  opacity: z.number().int().min(0).max(100),
});

const areaSchema = z.object({
  points: z.array(z.object({ x: coord, y: coord })).max(POLYGON_MAX_POINTS),
  capacity: z.number().int().min(1).max(LAYOUT_MAX_SEATS),
});

seatmapRouter.patch(
  "/layouts/:id/areas/:elementId",
  validateBody(areaSchema),
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await service.assertLayoutOwner(req, id, "design");
    const body = req.body as z.infer<typeof areaSchema>;
    const created = await reshapeStandingArea(id, Number(req.params.elementId), body);
    res.json({ created, layout: await repo.getLayout(id) });
  }),
);

seatmapRouter.post(
  "/layouts/:id/reference",
  uploadRateLimit,
  upload.single("file"),
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await service.assertLayoutOwner(req, id, "design");
    const file = (req as Request & { file?: { buffer: Buffer } }).file;
    if (!file) throw err.badRequest("invalid_image", "Chưa chọn tệp ảnh.");

    // The SAME pipeline the buyer-facing plan uses: magic-bytes sniffing, SVG refused outright, and a
    // re-encode to WebP under an unguessable name. A picture only the organizer sees is still a file
    // this server will serve, so it gets no weaker treatment (ADR-0004).
    const webp = await withUploadSlot(() => processFloorPlan(file.buffer)).catch((e) => {
      if (e instanceof ImageRejected) {
        throw e.reason === "image_too_large"
          ? err.badRequest(
              "image_too_large",
              `Ảnh quá lớn (tối đa ${FLOORPLAN_MAX_PX}px mỗi cạnh).`,
            )
          : err.badRequest("invalid_image", "Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP.");
      }
      throw e;
    });

    const previous = await repo.currentReferenceUrl(id);
    const url = await saveFloorPlan(id, webp, "reference");
    try {
      await repo.setReferenceUrl(id, url);
    } catch (e) {
      await deleteFloorPlan(url);
      throw e;
    }
    await deleteFloorPlan(previous);
    res.json((await repo.getLayout(id))?.referenceChart);
  }),
);

seatmapRouter.patch(
  "/layouts/:id/reference",
  validateBody(referenceAlignSchema),
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await service.assertLayoutOwner(req, id, "design");
    await repo.updateReferenceAlignment(id, req.body as z.infer<typeof referenceAlignSchema>);
    res.json((await repo.getLayout(id))?.referenceChart);
  }),
);

seatmapRouter.delete(
  "/layouts/:id/reference",
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await service.assertLayoutOwner(req, id, "design");
    const previous = await repo.currentReferenceUrl(id);
    await repo.setReferenceUrl(id, null);
    await deleteFloorPlan(previous);
    res.status(204).end();
  }),
);

seatmapRouter.delete(
  "/layouts/:id/floorplan",
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await service.assertLayoutOwner(req, id, "design");
    const previous = await repo.currentPlanUrl(id);
    await repo.setPlanUrl(id, null);
    await deleteFloorPlan(previous);
    res.status(204).end(); // every seat keeps its exact position (FR-025, SC-007)
  }),
);

// ---- Reuse (FR-036, FR-037) ----

// ---- Showtime map: edit, re-apply, block, tier (FR-027..FR-029, FR-033..FR-035) ----

const showtimeSeatEditSchema = z.object({
  showtimeSeatId: z.number().int().nullable(),
  seatId: z.number().int(),
  rowLabel: z.string().trim().min(1).max(8),
  seatNumber: z.number().int().min(1),
  sectionName: z.string().max(60).nullable(),
  ticketTierId: z.number().int(),
  x: coord,
  y: coord,
  rotation,
});

/*
 * Two lines may not name one seat (0035 finding 7).
 *
 * `classify` treats the second line as an addition, whose INSERT then no-ops on the unique
 * (showtime_id, seat_id) constraint — but the WRITE loop resolves it to the same existing row and
 * pushes that row into the batch UPDATE twice, where Postgres picks a winner arbitrarily. Preview
 * and write disagreed, so the only honest answer is to refuse the request.
 */
const noDuplicateSeats = (
  seats: z.infer<typeof showtimeSeatEditSchema>[],
  ctx: z.RefinementCtx,
): void => {
  const seen = { seat: new Set<number>(), row: new Set<number>() };
  for (const s of seats) {
    if (seen.seat.has(s.seatId) || (s.showtimeSeatId !== null && seen.row.has(s.showtimeSeatId))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Một ghế chỉ được xuất hiện một lần trong cùng một yêu cầu.",
      });
      return;
    }
    seen.seat.add(s.seatId);
    if (s.showtimeSeatId !== null) seen.row.add(s.showtimeSeatId);
  }
};

const editMapSchema = z.object({
  seats: z.array(showtimeSeatEditSchema).max(LAYOUT_MAX_SEATS).superRefine(noDuplicateSeats),
});
const reapplySchema = z.object({
  dryRun: z.boolean(),
  /**
   * The preview being confirmed (0035 finding 5). Required on a confirm: without it the server would
   * be applying a state the organizer never saw, which is exactly the divergence this closes.
   */
  source: z
    .object({
      layoutId: z.number().int(),
      layoutVersion: z.number().int(),
      digest: z.string().min(1).max(64),
    })
    .optional(),
});
const blockSchema = z.object({
  showtimeSeatIds: z.array(z.number().int()).min(1).max(LAYOUT_MAX_SEATS),
  blocked: z.boolean(),
});
const tierSchema = z.object({
  showtimeSeatIds: z.array(z.number().int()).min(1).max(LAYOUT_MAX_SEATS),
  ticketTierId: z.number().int(),
});

/** A refused edit rejects the WHOLE thing and leaves the map exactly as it was (FR-029). */
function refuse(outcome: { refusals: unknown[] }): never {
  throw err.refused(
    409,
    "map_edit_refused",
    "Một số ghế không thể thay đổi. Sơ đồ được giữ nguyên.",
    {
      refusals: outcome.refusals,
    },
  );
}

/**
 * The organizer's own view of a showtime's map.
 *
 * The buyer's `GET /showtimes/:id/seat-map` cannot serve this: it is gated on public visibility, so
 * it returns nothing for a draft or pending-review event — the state an organizer is most likely to
 * be arranging seats in. Same data, ownership gate instead of a visibility gate.
 */
seatmapRouter.get(
  "/showtimes/:id/seat-map",
  asyncH(async (req, res) => {
    const showtimeId = Number(req.params.id);
    await service.assertShowtimeOwner(req, showtimeId);
    res.json(await repo.getShowtimeMap(showtimeId));
  }),
);

seatmapRouter.put(
  "/showtimes/:id/seat-map",
  validateBody(editMapSchema),
  asyncH(async (req, res) => {
    const showtimeId = Number(req.params.id);
    await service.assertShowtimeOwner(req, showtimeId);
    const { seats } = req.body as z.infer<typeof editMapSchema>;
    const outcome = await apply.apply(showtimeId, seats);
    if (!outcome.wouldSucceed) refuse(outcome);
    res.json(outcome);
  }),
);

seatmapRouter.post(
  "/showtimes/:id/seat-map/reapply",
  validateBody(reapplySchema),
  asyncH(async (req, res) => {
    const showtimeId = Number(req.params.id);
    await service.assertShowtimeOwner(req, showtimeId);
    const desired = await apply.desiredFromLayout(showtimeId);
    if (!desired)
      throw err.badRequest("validation_failed", "Suất chiếu này chưa gắn với sơ đồ nào.");

    // The source layout must still be valid before it can reshape a live map. Checked against THIS
    // showtime, because the section-without-tier rule needs its tiers (T050, FR-030).
    const layoutId = await service.showtimeLayoutId(showtimeId);
    if (layoutId) {
      const blocking = blockingIssues(await service.validateForShowtime(layoutId, showtimeId));
      if (blocking.length > 0) {
        throw err.refused(
          422,
          "layout_invalid",
          "Sơ đồ nguồn chưa hợp lệ, không thể áp dụng lại.",
          {
            issues: blocking,
          },
        );
      }
    }

    const { dryRun, source } = req.body as z.infer<typeof reapplySchema>;
    if (dryRun) {
      // Advisory about the SEATS: re-classified inside the transaction on confirm, so a sale or hold
      // landing in between refuses the apply rather than being overwritten (research R-6). The
      // `source` it returns is not advisory — the confirm must echo it back.
      res.json(await apply.preview(showtimeId, desired, layoutId));
      return;
    }
    if (!source)
      throw err.badRequest(
        "validation_failed",
        "Hãy xem trước thay đổi trước khi áp dụng lại.",
      );
    if (source.layoutId !== layoutId)
      throw err.refused(
        409,
        "stale_preview",
        "Suất chiếu đã đổi sang sơ đồ khác kể từ lúc bạn xem trước. Hãy xem trước lại rồi áp dụng.",
        { refusals: [] },
      );
    const outcome = await apply.apply(showtimeId, desired, {
      refreshLayoutId: layoutId,
      expectSource: source,
    });
    if (!outcome.wouldSucceed) refuse(outcome);
    // Decoration and background came across inside apply's transaction — the snapshot is the whole
    // layout (FR-005, T046), refreshed atomically with the seat writes it describes.
    res.json(outcome);
  }),
);

seatmapRouter.post(
  "/showtimes/:id/seats/block",
  validateBody(blockSchema),
  asyncH(async (req, res) => {
    const showtimeId = Number(req.params.id);
    await service.assertShowtimeOwner(req, showtimeId);
    const { showtimeSeatIds, blocked } = req.body as z.infer<typeof blockSchema>;
    const outcome = await apply.setBlocked(showtimeId, showtimeSeatIds, blocked);
    if (outcome.refusals.length > 0) refuse(outcome);
    // Reaches viewers through the EXISTING seat channel — no new socket event (FR-035).
    broadcastSeatUpdate({ showtimeId, seats: outcome.changed });
    res.json({ changed: outcome.changed });
  }),
);

seatmapRouter.post(
  "/showtimes/:id/seats/tier",
  validateBody(tierSchema),
  asyncH(async (req, res) => {
    const showtimeId = Number(req.params.id);
    await service.assertShowtimeOwner(req, showtimeId);
    const { showtimeSeatIds, ticketTierId } = req.body as z.infer<typeof tierSchema>;
    const outcome = await apply.setTier(showtimeId, showtimeSeatIds, ticketTierId);
    if (outcome.refusals.length > 0) refuse(outcome);
    if (!outcome.tier)
      throw err.badRequest("validation_failed", "Hạng vé không thuộc suất chiếu này.");

    // The one additive field on the 003 payload: a retier changes the price a buyer sees, which
    // `status` alone cannot express (FR-035). Geometry is still never broadcast (FR-041).
    const seats = await currentStatuses(showtimeId, showtimeSeatIds);
    broadcastSeatUpdate({
      showtimeId,
      seats: seats.map((s) => ({ ...s, tier: outcome.tier!.label, price: outcome.tier!.price })),
    });
    res.json({ updated: showtimeSeatIds.length, tier: outcome.tier });
  }),
);

seatmapRouter.post(
  "/layouts/:id/clone",
  validateBody(cloneSchema),
  asyncH(async (req, res) => {
    const sourceId = Number(req.params.id);
    const { targetVenueId, name } = req.body as z.infer<typeof cloneSchema>;
    const newId = await service.clone(req, sourceId, targetVenueId, name);
    res.status(201).json(await repo.getLayout(newId));
  }),
);

// ---- standing areas (FR-080) ----------------------------------------------
// The fan-zone substitute: ordinary seats of type `standing` inside a drawn shape, sold one at a time
// by the unchanged 003/004 path. No mixed seated + GA showtime is created here, and none can be.

seatmapRouter.post(
  "/layouts/:id/standing-area",
  validateBody(standingAreaSchema),
  asyncH(async (req, res) => {
    const layoutId = Number(req.params.id);
    await service.assertLayoutOwner(req, layoutId, "design");
    const created = await createStandingArea(
      layoutId,
      req.body as z.infer<typeof standingAreaSchema>,
    );
    res.status(201).json({ created, layout: await repo.getLayout(layoutId) });
  }),
);

// ---- tables (FR-047..FR-056) ----------------------------------------------
// Ownership resolves through the layout, exactly as every other route here does (SEC-04, FR-079).

seatmapRouter.post(
  "/layouts/:id/tables",
  validateBody(tableSchema),
  asyncH(async (req, res) => {
    const layoutId = Number(req.params.id);
    await service.assertLayoutOwner(req, layoutId, "design");
    res.status(201).json(await createTable(layoutId, req.body as z.infer<typeof tableSchema>));
  }),
);

seatmapRouter.patch(
  "/tables/:id",
  validateBody(updateTableSchema),
  asyncH(async (req, res) => {
    const tableId = Number(req.params.id);
    const layoutId = await tableLayoutId(tableId);
    if (layoutId === null) throw err.notFound("not_found", "Không tìm thấy bàn.");
    await service.assertLayoutOwner(req, layoutId, "design");
    res.json(await updateTable(tableId, req.body as z.infer<typeof updateTableSchema>));
  }),
);

seatmapRouter.patch(
  "/layouts/:id/tables",
  validateBody(batchTablesSchema),
  asyncH(async (req, res) => {
    const layoutId = Number(req.params.id);
    await service.assertLayoutOwner(req, layoutId, "design");
    const b = req.body as z.infer<typeof batchTablesSchema>;
    await assertTablesInLayout(
      b.updates.map((u) => u.tableId),
      layoutId,
    );
    const tables = await updateTables(b.updates);
    res.json({ tables, layout: await repo.getLayout(layoutId) });
  }),
);

seatmapRouter.delete(
  "/layouts/:id/tables",
  validateBody(deleteTablesSchema),
  asyncH(async (req, res) => {
    const layoutId = Number(req.params.id);
    await service.assertLayoutOwner(req, layoutId, "design");
    const b = req.body as z.infer<typeof deleteTablesSchema>;
    await assertTablesInLayout(b.tableIds, layoutId);
    await deleteTables(b.tableIds);
    res.json({ ok: true, layout: await repo.getLayout(layoutId) });
  }),
);

seatmapRouter.delete(
  "/tables/:id",
  asyncH(async (req, res) => {
    const tableId = Number(req.params.id);
    const layoutId = await tableLayoutId(tableId);
    if (layoutId === null) throw err.notFound("not_found", "Không tìm thấy bàn.");
    await service.assertLayoutOwner(req, layoutId, "design");
    await deleteTable(tableId);
    res.json({ ok: true });
  }),
);
