import type { Request } from 'express';
import type { SaveLayoutRequest } from '@shared/catalog/seatmap.js';
import { validateLayout, type ValidationIssue } from '@shared/catalog/seatmap-validate.js';
import { LAYOUT_MAX_ELEMENTS, LAYOUT_MAX_SEATS, VENUE_MAX_LAYOUTS } from '../../config.js';
import { pool } from '../../db/pool.js';
import { err } from '../../http.js';
import * as repo from './layouts.repo.js';

// Ownership, ceilings, validation and cloning.
//
// SEC-04: every one of these resolves ownership on the SERVER and REFUSES. Acting on another
// organizer's venue or layout is a 403, never a filtered-out empty result (FR-042).

function assertOwn(req: Request, ownerUserId: number | null): void {
  if (ownerUserId === null) throw err.notFound('not_found', 'Không tìm thấy tài nguyên.');
  if (ownerUserId !== req.auth!.userId && !req.auth!.user.isAdmin) {
    throw err.forbidden('not_owner', 'Bạn không sở hữu tài nguyên này.');
  }
}

export async function venueOwnerUserId(venueId: number): Promise<number | null> {
  const { rows } = await pool.query<{ created_by: number }>(`SELECT created_by FROM venues WHERE id = $1`, [venueId]);
  return rows[0]?.created_by ?? null;
}

export async function assertVenueOwner(req: Request, venueId: number): Promise<void> {
  assertOwn(req, await venueOwnerUserId(venueId));
}

/** Resolve a layout the caller owns, or refuse. Returns the layout id for chaining. */
export async function assertLayoutOwner(req: Request, layoutId: number): Promise<void> {
  assertOwn(req, await repo.layoutOwnerUserId(layoutId));
}

/** Ownership of a showtime resolves through its event's organizer (SEC-04). */
export async function assertShowtimeOwner(req: Request, showtimeId: number): Promise<void> {
  const { rows } = await pool.query<{ created_by: number }>(
    `SELECT o.user_id AS created_by
       FROM showtimes st JOIN events e ON e.id = st.event_id JOIN organizers o ON o.id = e.organizer_id
      WHERE st.id = $1`,
    [showtimeId],
  );
  assertOwn(req, rows[0]?.created_by ?? null);
}

export async function showtimeLayoutId(showtimeId: number): Promise<number | null> {
  const { rows } = await pool.query<{ layout_id: number | null }>(`SELECT layout_id FROM showtimes WHERE id = $1`, [showtimeId]);
  return rows[0]?.layout_id ?? null;
}

export async function createLayout(req: Request, venueId: number, name: string): Promise<number> {
  await assertVenueOwner(req, venueId);
  if ((await repo.countLayouts(venueId)) >= VENUE_MAX_LAYOUTS) {
    throw err.conflict('layout_limit_reached', `Mỗi địa điểm chỉ có tối đa ${VENUE_MAX_LAYOUTS} sơ đồ.`);
  }
  try {
    return await repo.createLayout(venueId, name);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      throw err.conflict('layout_name_taken', 'Địa điểm này đã có một sơ đồ trùng tên.');
    }
    throw e;
  }
}

/** Full-document save. Ceilings first, then the versioned write; a stale version is refused (FR-015). */
export async function saveLayout(req: Request, layoutId: number, body: SaveLayoutRequest) {
  await assertLayoutOwner(req, layoutId);
  if (body.seats.length > LAYOUT_MAX_SEATS) {
    throw err.conflict('seat_limit_reached', `Một sơ đồ chỉ chứa tối đa ${LAYOUT_MAX_SEATS} ghế.`);
  }
  if (body.elements.length > LAYOUT_MAX_ELEMENTS) {
    throw err.conflict('element_limit_reached', `Một sơ đồ chỉ chứa tối đa ${LAYOUT_MAX_ELEMENTS} chi tiết.`);
  }
  const saved = await repo.saveLayout(layoutId, body).catch((e) => {
    if ((e as { code?: string }).code === '23505') {
      throw err.conflict('layout_name_taken', 'Tên bị trùng trong sơ đồ này.');
    }
    throw e;
  });
  if (!saved) {
    throw err.conflict('stale_version', 'Sơ đồ đã được sửa ở nơi khác. Hãy tải lại rồi lưu lại.');
  }
  return saved;
}

export async function generateSeatRow(
  req: Request,
  layoutId: number,
  input: { sectionId: number; rowLabel: string; count: number; replaceExisting?: boolean },
): Promise<number> {
  await assertLayoutOwner(req, layoutId);
  if ((await repo.countSeats(layoutId)) + input.count > LAYOUT_MAX_SEATS) {
    throw err.conflict('seat_limit_reached', `Một sơ đồ chỉ chứa tối đa ${LAYOUT_MAX_SEATS} ghế.`);
  }
  return repo.generateSeatRow(layoutId, input.sectionId, input.rowLabel, input.count, input.replaceExisting ?? false);
}

export async function deleteLayout(req: Request, layoutId: number): Promise<void> {
  await assertLayoutOwner(req, layoutId);
  // A live map's source stays inspectable and re-appliable (FR-006).
  if (await repo.layoutInUse(layoutId)) {
    throw err.conflict('layout_in_use', 'Một suất chiếu đang dùng sơ đồ này, không thể xoá.');
  }
  await repo.deleteLayout(layoutId);
}

/** The five pre-publish checks, in one pass (FR-030). `sectionsWithTier` is only known at bind time. */
export async function validate(layoutId: number, sectionsWithTier?: number[]): Promise<ValidationIssue[]> {
  const layout = await repo.getLayout(layoutId);
  if (!layout) throw err.notFound('not_found', 'Không tìm thấy sơ đồ.');
  return validateLayout({
    seats: layout.seats.map((s) => ({
      id: s.id ?? 0,
      sectionId: s.sectionId,
      rowLabel: s.rowLabel,
      seatNumber: s.seatNumber,
      x: s.x,
      y: s.y,
    })),
    // The style fields matter to validation now: `color` is required to publish (FR-066) and the size
    // multiplier feeds the overlap test (FR-065). Dropping them here made every layout look colourless.
    sections: layout.sections.map((s) => ({
      id: s.id ?? 0,
      name: s.name,
      color: s.color,
      seatSizeMultiplier: s.seatSizeMultiplier,
    })),
    elements: layout.elements.map((e) => ({ kind: e.kind, x: e.x, y: e.y, points: e.points })),
    sectionsWithTier,
  });
}

/**
 * Validation at BIND time (T050). The section-without-tier check cannot run against a layout alone —
 * a layout has no tiers — so it needs the showtime whose tiers are being assigned (FR-030).
 */
export async function validateForShowtime(layoutId: number, showtimeId: number): Promise<ValidationIssue[]> {
  const { rows } = await pool.query<{ section_id: number }>(
    `SELECT DISTINCT se.section_id
       FROM seats se
       JOIN showtime_seats ss ON ss.seat_id = se.id AND ss.showtime_id = $2
      WHERE se.layout_id = $1 AND se.section_id IS NOT NULL`,
    [layoutId, showtimeId],
  );
  return validate(layoutId, rows.map((r) => r.section_id));
}

export async function publish(req: Request, layoutId: number) {
  await assertLayoutOwner(req, layoutId);
  const issues = await validate(layoutId);
  if (issues.length > 0) {
    // Carries the issue list so the organizer sees what to fix, not a generic failure (FR-031).
    throw err.refused(422, 'layout_invalid', 'Sơ đồ chưa hợp lệ, không thể phát hành.', { issues });
  }
  await repo.setLayoutStatus(layoutId, 'ready');
  return repo.getLayout(layoutId);
}

export async function clone(req: Request, sourceId: number, targetVenueId: number, name: string): Promise<number> {
  await assertLayoutOwner(req, sourceId); // refuses another organizer's layout (FR-037)
  await assertVenueOwner(req, targetVenueId);
  if ((await repo.countLayouts(targetVenueId)) >= VENUE_MAX_LAYOUTS) {
    throw err.conflict('layout_limit_reached', `Mỗi địa điểm chỉ có tối đa ${VENUE_MAX_LAYOUTS} sơ đồ.`);
  }
  try {
    return await repo.cloneLayout(sourceId, targetVenueId, name);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      throw err.conflict('layout_name_taken', 'Địa điểm đích đã có một sơ đồ trùng tên.');
    }
    throw e;
  }
}
