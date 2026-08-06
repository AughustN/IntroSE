import { type NextFunction, type Request, type Response, Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  FLOORPLAN_MAX_BYTES,
  FLOORPLAN_MAX_PX,
  LAYOUT_MAX_ELEMENTS,
  LAYOUT_MAX_SEATS,
  LAYOUT_SPACE,
  POLYGON_MAX_POINTS,
  SEAT_DIAMETER,
  SEAT_SIZE_MAX_PCT,
  SEAT_SIZE_MIN_PCT,
} from '../../config.js';
import { ImageRejected, deleteFloorPlan, processFloorPlan, saveFloorPlan } from './floorplan.js';
import { uploadRateLimit, withUploadSlot } from './upload.throttle.js';
import { createTable, deleteTable, tableLayoutId, updateTable } from './tables.js';
import { createStandingArea } from './standing.js';
import { err } from '../../http.js';
import { requireOrganizer } from '../../middleware/authz.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validate as validateBody } from '../../middleware/validate.js';
import { pool } from '../../db/pool.js';
import { broadcastSeatUpdate } from '../../realtime/io.js';
import type { SeatStatus } from '@shared/catalog/types.js';
import * as apply from './apply.js';
import * as repo from './layouts.repo.js';
import * as service from './layouts.service.js';

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
  (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

// ---- Schemas (SEC-07: strict, validated before use) ----

const coord = z.number().int().min(0).max(LAYOUT_SPACE);
const rotation = z.number().int();

const sectionSchema = z.object({
  id: z.number().int().optional(),
  name: z.string().trim().min(1).max(60),
  description: z.string().max(500).nullable().optional(),
  // Visual style (FR-064). `color` is editor-only and never reaches the buyer map.
  color: z.string().trim().max(32).nullable().optional(),
  seatShape: z.enum(['circle', 'square']).optional(),
  seatSizeMultiplier: z.number().min(SEAT_SIZE_MIN_PCT / 100).max(SEAT_SIZE_MAX_PCT / 100).optional(),
});

const seatSchema = z.object({
  id: z.number().int().optional(),
  sectionId: z.number().int().nullable(),
  rowLabel: z.string().trim().min(1).max(8),
  seatNumber: z.number().int().min(1),
  seatType: z.enum(['single', 'double', 'standing']),
  x: coord,
  y: coord,
  rotation,
});

const elementSchema = z.object({
  id: z.number().int().optional(),
  kind: z.enum([
    'stage', 'aisle', 'door', 'bar', 'label', 'area',
    // Hall outline and dividers (FR-057), then the facility icons (FR-061).
    'boundary', 'divider',
    'exit', 'restroom', 'food_drink', 'smoking', 'first_aid', 'lift_stairs', 'wheelchair',
  ]),
  x: coord,
  y: coord,
  width: z.number().int().min(1).max(LAYOUT_SPACE),
  height: z.number().int().min(1).max(LAYOUT_SPACE),
  rotation,
  label: z.string().max(60).nullable(),
  /** Ordered vertices for a boundary or divider; the count rule is a DOMAIN check (FR-059). */
  points: z.array(z.object({ x: coord, y: coord })).max(POLYGON_MAX_POINTS).nullable().optional(),
});

const tableSchema = z.object({
  sectionId: z.number().int().nullable(),
  name: z.string().trim().min(1).max(40),
  shape: z.enum(['round', 'rect']),
  x: coord,
  y: coord,
  width: z.number().int().min(1).max(LAYOUT_SPACE),
  height: z.number().int().min(1).max(LAYOUT_SPACE),
  rotation,
  // Bounds are a DOMAIN rule so the refusal names the limit rather than a generic 400 — but a
  // non-integer or absurd value is still a schema error.
  seatCount: z.number().int().min(0).max(999),
  sideCounts: z.array(z.number().int().min(0)).length(4).nullable().optional(),
});
const updateTableSchema = tableSchema.partial().refine((v) => Object.keys(v).length > 0, { message: 'empty' });

const createLayoutSchema = z.object({ name: z.string().trim().min(1).max(80) });

const saveLayoutSchema = z.object({
  version: z.number().int().min(1),
  name: z.string().trim().min(1).max(80).optional(),
  isTemplate: z.boolean().optional(),
  sections: z.array(sectionSchema).max(200),
  // Deliberately uncapped here: the ceiling is a DOMAIN rule, and the service reports it as
  // `409 seat_limit_reached` / `element_limit_reached` (FR-007, FR-019). A schema `.max()` would
  // shadow it with a generic 400. Payload size is already bounded by the 1 MB JSON limit.
  seats: z.array(seatSchema),
  elements: z.array(elementSchema),
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

seatmapRouter.get(
  '/venues/:venueId/layouts',
  asyncH(async (req, res) => {
    const venueId = Number(req.params.venueId);
    await service.assertVenueOwner(req, venueId);
    res.json({ layouts: await repo.listLayouts(venueId) });
  }),
);

seatmapRouter.post(
  '/venues/:venueId/layouts',
  validateBody(createLayoutSchema),
  asyncH(async (req, res) => {
    const venueId = Number(req.params.venueId);
    const { name } = req.body as z.infer<typeof createLayoutSchema>;
    const id = await service.createLayout(req, venueId, name);
    res.status(201).json(await repo.getLayout(id));
  }),
);

seatmapRouter.get(
  '/layouts/:id',
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await service.assertLayoutOwner(req, id);
    const layout = await repo.getLayout(id);
    if (!layout) throw err.notFound('not_found', 'Không tìm thấy sơ đồ.');
    res.json({ ...layout, space: { width: LAYOUT_SPACE, height: LAYOUT_SPACE, seatDiameter: SEAT_DIAMETER } });
  }),
);

seatmapRouter.put(
  '/layouts/:id',
  validateBody(saveLayoutSchema),
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const body = req.body as z.infer<typeof saveLayoutSchema>;
    res.json(await service.saveLayout(req, id, body));
  }),
);

seatmapRouter.delete(
  '/layouts/:id',
  asyncH(async (req, res) => {
    await service.deleteLayout(req, Number(req.params.id));
    res.status(204).end();
  }),
);

seatmapRouter.post(
  '/layouts/:id/generate-seats',
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
  '/layouts/:id/validate',
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await service.assertLayoutOwner(req, id);
    const issues = await service.validate(id);
    res.json({ valid: issues.length === 0, issues });
  }),
);

seatmapRouter.post(
  '/layouts/:id/publish',
  asyncH(async (req, res) => {
    res.json(await service.publish(req, Number(req.params.id)));
  }),
);

// ---- Floor plan (FR-020..FR-026a) ----

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: FLOORPLAN_MAX_BYTES } });

const planAlignSchema = z.object({
  scale: z.number().int().min(1).max(10000),
  offsetX: z.number().int(),
  offsetY: z.number().int(),
  opacity: z.number().int().min(0).max(100),
  visibleToBuyers: z.boolean(),
});

seatmapRouter.post(
  '/layouts/:id/floorplan',
  uploadRateLimit,
  upload.single('file'),
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await service.assertLayoutOwner(req, id);
    const file = (req as Request & { file?: { buffer: Buffer } }).file;
    if (!file) throw err.badRequest('invalid_image', 'Chưa chọn tệp ảnh.');

    const webp = await withUploadSlot(() => processFloorPlan(file.buffer)).catch((e) => {
      if (e instanceof ImageRejected) {
        throw e.reason === 'image_too_large'
          ? err.badRequest('image_too_large', `Ảnh quá lớn (tối đa ${FLOORPLAN_MAX_PX}px mỗi cạnh).`)
          : err.badRequest('invalid_image', 'Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP.');
      }
      throw e;
    });

    const previous = await repo.currentPlanUrl(id);
    const url = await saveFloorPlan(webp);
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
  '/layouts/:id/floorplan',
  validateBody(planAlignSchema),
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await service.assertLayoutOwner(req, id);
    // Alignment only — no seat moves when the background does (FR-024).
    await repo.updatePlanAlignment(id, req.body as z.infer<typeof planAlignSchema>);
    res.json((await repo.getLayout(id))?.floorPlan);
  }),
);

seatmapRouter.delete(
  '/layouts/:id/floorplan',
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await service.assertLayoutOwner(req, id);
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

const editMapSchema = z.object({ seats: z.array(showtimeSeatEditSchema).max(LAYOUT_MAX_SEATS) });
const reapplySchema = z.object({ dryRun: z.boolean() });
const blockSchema = z.object({ showtimeSeatIds: z.array(z.number().int()).min(1).max(LAYOUT_MAX_SEATS), blocked: z.boolean() });
const tierSchema = z.object({ showtimeSeatIds: z.array(z.number().int()).min(1).max(LAYOUT_MAX_SEATS), ticketTierId: z.number().int() });

/** A refused edit rejects the WHOLE thing and leaves the map exactly as it was (FR-029). */
function refuse(outcome: { refusals: unknown[] }): never {
  throw err.refused(409, 'map_edit_refused', 'Một số ghế không thể thay đổi. Sơ đồ được giữ nguyên.', {
    refusals: outcome.refusals,
  });
}

seatmapRouter.put(
  '/showtimes/:id/seat-map',
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
  '/showtimes/:id/seat-map/reapply',
  validateBody(reapplySchema),
  asyncH(async (req, res) => {
    const showtimeId = Number(req.params.id);
    await service.assertShowtimeOwner(req, showtimeId);
    const desired = await apply.desiredFromLayout(showtimeId);
    if (!desired) throw err.badRequest('validation_failed', 'Suất chiếu này chưa gắn với sơ đồ nào.');

    // The source layout must still be valid before it can reshape a live map. Checked against THIS
    // showtime, because the section-without-tier rule needs its tiers (T050, FR-030).
    const layoutId = await service.showtimeLayoutId(showtimeId);
    if (layoutId) {
      const issues = await service.validateForShowtime(layoutId, showtimeId);
      if (issues.length > 0) {
        throw err.refused(422, 'layout_invalid', 'Sơ đồ nguồn chưa hợp lệ, không thể áp dụng lại.', { issues });
      }
    }

    const { dryRun } = req.body as z.infer<typeof reapplySchema>;
    if (dryRun) {
      // Advisory: re-classified inside the transaction on confirm, so a sale or hold landing in
      // between refuses the apply rather than being overwritten (research R-6).
      res.json(await apply.preview(showtimeId, desired));
      return;
    }
    const outcome = await apply.apply(showtimeId, desired);
    if (!outcome.wouldSucceed) refuse(outcome);
    // Decoration and background come across too — the snapshot is the whole layout (FR-005, T046).
    if (layoutId) await apply.refreshSnapshot(showtimeId, layoutId);
    res.json(outcome);
  }),
);

seatmapRouter.post(
  '/showtimes/:id/seats/block',
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
  '/showtimes/:id/seats/tier',
  validateBody(tierSchema),
  asyncH(async (req, res) => {
    const showtimeId = Number(req.params.id);
    await service.assertShowtimeOwner(req, showtimeId);
    const { showtimeSeatIds, ticketTierId } = req.body as z.infer<typeof tierSchema>;
    const outcome = await apply.setTier(showtimeId, showtimeSeatIds, ticketTierId);
    if (outcome.refusals.length > 0) refuse(outcome);
    if (!outcome.tier) throw err.badRequest('validation_failed', 'Hạng vé không thuộc suất chiếu này.');

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
  '/layouts/:id/clone',
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
  '/layouts/:id/standing-area',
  validateBody(standingAreaSchema),
  asyncH(async (req, res) => {
    const layoutId = Number(req.params.id);
    await service.assertLayoutOwner(req, layoutId);
    const created = await createStandingArea(layoutId, req.body as z.infer<typeof standingAreaSchema>);
    res.status(201).json({ created, layout: await repo.getLayout(layoutId) });
  }),
);

// ---- tables (FR-047..FR-056) ----------------------------------------------
// Ownership resolves through the layout, exactly as every other route here does (SEC-04, FR-079).

seatmapRouter.post(
  '/layouts/:id/tables',
  validateBody(tableSchema),
  asyncH(async (req, res) => {
    const layoutId = Number(req.params.id);
    await service.assertLayoutOwner(req, layoutId);
    res.status(201).json(await createTable(layoutId, req.body as z.infer<typeof tableSchema>));
  }),
);

seatmapRouter.patch(
  '/tables/:id',
  validateBody(updateTableSchema),
  asyncH(async (req, res) => {
    const tableId = Number(req.params.id);
    const layoutId = await tableLayoutId(tableId);
    if (layoutId === null) throw err.notFound('not_found', 'Không tìm thấy bàn.');
    await service.assertLayoutOwner(req, layoutId);
    res.json(await updateTable(tableId, req.body as z.infer<typeof updateTableSchema>));
  }),
);

seatmapRouter.delete(
  '/tables/:id',
  asyncH(async (req, res) => {
    const tableId = Number(req.params.id);
    const layoutId = await tableLayoutId(tableId);
    if (layoutId === null) throw err.notFound('not_found', 'Không tìm thấy bàn.');
    await service.assertLayoutOwner(req, layoutId);
    await deleteTable(tableId);
    res.json({ ok: true });
  }),
);
