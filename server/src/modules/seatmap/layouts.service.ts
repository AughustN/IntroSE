import type { Request } from 'express';
import type { LayoutLibraryEntry, LayoutRevision, SaveLayoutRequest } from '@shared/catalog/seatmap.js';
import { projectDocument } from '@shared/catalog/seatmap-project.js';
import { type ChartDocument, reviveDocument } from '@shared/catalog/seatmap-document.js';
import { validateLayout, type ValidationIssue } from '@shared/catalog/seatmap-validate.js';
import { LAYOUT_MAX_ELEMENTS, LAYOUT_MAX_SEATS, VENUE_MAX_LAYOUTS } from '../../config.js';
import { pool } from '../../db/pool.js';
import { err } from '../../http.js';
import * as repo from './layouts.repo.js';
import { type ChartAction, assertChartAccess } from './permissions.js';
import { insertAudit } from '../admin/audit.js';

// Ownership, ceilings, validation and cloning.
//
// SEC-04: every one of these resolves ownership on the SERVER and REFUSES. Acting on another
// organizer's venue or layout is a 403, never a filtered-out empty result (FR-042).

async function assertOwn(
  req: Request,
  ownerUserId: number | null,
  action: ChartAction = 'manage',
): Promise<void> {
  await assertChartAccess(req, ownerUserId, action);
}

export async function venueOwnerUserId(venueId: number): Promise<number | null> {
  const { rows } = await pool.query<{ created_by: number }>(`SELECT created_by FROM venues WHERE id = $1`, [venueId]);
  return rows[0]?.created_by ?? null;
}

export async function assertVenueOwner(
  req: Request,
  venueId: number,
  action: ChartAction = 'manage',
): Promise<void> {
  await assertOwn(req, await venueOwnerUserId(venueId), action);
}

/** Resolve a layout the caller owns, or refuse. Returns the layout id for chaining. */
/**
 * The gate every seatmap route passes through.
 *
 * `action` says how far the caller has to reach, and defaults to the strictest — so a route that has
 * not been classified refuses a collaborator rather than admitting one. The owner and admins are
 * unaffected by it entirely.
 */
export async function assertLayoutOwner(
  req: Request,
  layoutId: number,
  action: ChartAction = 'manage',
): Promise<void> {
  await assertOwn(req, await repo.layoutOwnerUserId(layoutId), action);
}

/** Ownership of a showtime resolves through its event's organizer (SEC-04). */
export async function assertShowtimeOwner(req: Request, showtimeId: number): Promise<void> {
  const { rows } = await pool.query<{ created_by: number }>(
    `SELECT o.user_id AS created_by
       FROM showtimes st JOIN events e ON e.id = st.event_id JOIN organizers o ON o.id = e.organizer_id
      WHERE st.id = $1`,
    [showtimeId],
  );
  // AWAITED, and it matters. `assertOwn` became async when collaborator roles arrived; dropping the
  // `await` leaves a gate that never blocks, and neither TypeScript nor this project's lint config
  // (no type-aware `no-floating-promises`) would say a word. The test that a stranger gets 403 on a
  // showtime route is what actually holds this line in place.
  await assertOwn(req, rows[0]?.created_by ?? null);
}

export async function showtimeLayoutId(showtimeId: number): Promise<number | null> {
  const { rows } = await pool.query<{ layout_id: number | null }>(`SELECT layout_id FROM showtimes WHERE id = $1`, [showtimeId]);
  return rows[0]?.layout_id ?? null;
}

export async function createLayout(req: Request, venueId: number, name: string): Promise<number> {
  await assertVenueOwner(req, venueId, 'design');
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
  await assertLayoutOwner(req, layoutId, 'design');

  // A document wins outright when one is sent: the collections are DERIVED from it, so counting the
  // client's own arrays would police a shape the server is about to discard. The ceilings are still
  // domain rules rather than schema ones, so they surface as 409s naming the limit (FR-007, FR-019).
  const projected = body.document ? projectDocument(body.document) : null;
  const seats = projected ? projected.seats : (body.seats ?? []);
  const elements = projected ? projected.elements : (body.elements ?? []);

  if (seats.length > LAYOUT_MAX_SEATS) {
    throw err.conflict('seat_limit_reached', `Một sơ đồ chỉ chứa tối đa ${LAYOUT_MAX_SEATS} ghế.`);
  }
  if (elements.length > LAYOUT_MAX_ELEMENTS) {
    throw err.conflict('element_limit_reached', `Một sơ đồ chỉ chứa tối đa ${LAYOUT_MAX_ELEMENTS} chi tiết.`);
  }
  /*
   * A seat a showtime has generated from is no longer refused here — it is ARCHIVED by the save
   * itself (§18, §42 Rule 7; see the UPDATE beside the seats DELETE in layouts.repo.ts).
   *
   * The refusal that used to live here protected the booking and nothing else: the organizer was told
   * "cancel or edit that showtime first", which for a show already selling is not something they can
   * reasonably do. Archiving keeps every guarantee that mattered — the seat's id, its bookings and its
   * history survive, and the showtime carries on selling from its own snapshot — while letting the
   * chart move on.
   *
   * `boundSeatsMissingFrom` stays in the repo: it is what the UI asks to WARN before the click, and it
   * is still the honest source for "how many of these are sold".
   */

  const saved = await repo.saveLayout(layoutId, body).catch((e) => {
    const code = (e as { code?: string }).code;
    const constraint = (e as { constraint?: string }).constraint;
    if (code === '23505') {
      /*
       * Scoped by constraint. This used to answer every 23505 with "a name is duplicated", which is
       * the wrong sentence for the commonest cause by far: two seats sharing a row label and number.
       * The organizer was told to fix a name clash that did not exist, on a chart with no name
       * conflict in it, and had no way to find the real problem.
       */
      if (constraint === 'seats_section_row_number_key' || constraint === 'uq_seat_label') {
        throw err.conflict(
          'duplicate_seat_label',
          'Hai ghế trong cùng một khu có cùng hàng và số. Hãy đổi nhãn hàng hoặc số ghế bắt đầu của khối mới.',
        );
      }
      if (constraint === 'sections_layout_name_key' || constraint === 'uq_section_name') {
        throw err.conflict('section_name_taken', 'Sơ đồ này đã có một khu vực trùng tên.');
      }
      if (constraint === 'layout_categories_layout_name_key') {
        throw err.conflict('category_name_taken', 'Sơ đồ này đã có một hạng ghế trùng tên.');
      }
      // Two rows in one section sharing a label (0032). Reported as its own thing rather than as a
      // name clash on the CHART, which is what the fallback below would have said — the same class of
      // wrong sentence that `duplicate_seat_label` exists to replace.
      if (constraint === 'layout_rows_label_idx') {
        throw err.conflict(
          'duplicate_row_label',
          'Hai hàng trong cùng một khu có cùng tên. Hãy đổi tên hàng hoặc đánh lại số cho khu này.',
        );
      }
      throw err.conflict('layout_name_taken', 'Tên bị trùng trong sơ đồ này.');
    }
    // Belt-and-braces behind the pre-check above: that check and the DELETE are two statements, and
    // only the transaction makes them one.
    //
    // Scoped to the constraint on purpose. `seats` also has foreign keys to `sections`, `layout_
    // categories` and `layout_tables`, and a 23503 on one of those is a BUG in the write path — not a
    // bound seat — so it must surface as a 500 and be fixed rather than be reported to the organizer
    // as "this seat is sold". An earlier version of this catch mapped every 23503 and turned exactly
    // such a bug into a plausible-looking refusal.
    if (code === '23503' && (e as { constraint?: string }).constraint === 'showtime_seats_seat_id_fkey') {
      throw err.conflict(
        'seat_in_use',
        'Không thể xoá ghế đã có suất diễn tạo vé từ đó. Hãy huỷ hoặc sửa suất diễn đó trước.',
      );
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
  await assertLayoutOwner(req, layoutId, 'design');
  if ((await repo.countSeats(layoutId)) + input.count > LAYOUT_MAX_SEATS) {
    throw err.conflict('seat_limit_reached', `Một sơ đồ chỉ chứa tối đa ${LAYOUT_MAX_SEATS} ghế.`);
  }
  return repo.generateSeatRow(layoutId, input.sectionId, input.rowLabel, input.count, input.replaceExisting ?? false);
}

/**
 * Every chart the signed-in organizer owns. No ownership assertion needed: the query is scoped by
 * `created_by`, so it cannot return someone else's chart in the first place.
 */
export async function library(req: Request): Promise<LayoutLibraryEntry[]> {
  return repo.listAllLayouts(req.auth!.userId);
}

/**
 * Archive a chart, or bring it back.
 *
 * Archiving is refused while a live showtime still points at the chart — the same predicate
 * `deleteLayout` uses. The reason is not inventory (a bound showtime owns its own snapshot and is
 * unaffected) but honesty: binding requires a published chart, so an archived one that a showtime
 * still names cannot be re-applied, and the organizer would discover that only at the worst moment.
 * Restoring returns it to `draft`, never straight to `ready`, so it goes back through the publish
 * gate rather than reappearing as sellable without being re-checked.
 */
/**
 * Rename a chart.
 *
 * Deliberately not part of `saveLayout`, which requires a `version`: optimistic concurrency exists to
 * stop two people overwriting each other's GEOMETRY, and a rename touches none of it. Making the
 * library carry a version just to relabel a row would refuse a perfectly safe edit for a conflict
 * that cannot happen.
 */
export async function rename(req: Request, layoutId: number, name: string) {
  await assertLayoutOwner(req, layoutId, 'design');
  try {
    await repo.renameLayout(layoutId, name);
  } catch (e) {
    // UNIQUE (venue_id, name) — the same refusal `createLayout` gives, in the same words.
    if ((e as { code?: string }).code === '23505') {
      throw err.conflict('layout_name_taken', 'Địa điểm này đã có sơ đồ trùng tên.');
    }
    throw e;
  }
  return repo.getLayout(layoutId);
}

export async function archive(req: Request, layoutId: number, archived: boolean) {
  await assertLayoutOwner(req, layoutId);
  if (archived && (await repo.layoutInUse(layoutId))) {
    throw err.conflict('layout_in_use', 'Một suất chiếu đang dùng sơ đồ này, không thể lưu trữ.');
  }
  await repo.setLayoutStatus(layoutId, archived ? 'archived' : 'draft');
  await insertAudit(pool, {
    actorUserId: req.auth!.userId,
    action: archived ? 'layout_archive' : 'layout_unarchive',
    targetType: 'venue_layout',
    targetId: layoutId,
    outcome: 'applied',
  });
  return repo.getLayout(layoutId);
}

export async function deleteLayout(req: Request, layoutId: number): Promise<void> {
  await assertLayoutOwner(req, layoutId);
  // A live map's source stays inspectable and re-appliable (FR-006).
  if (await repo.layoutInUse(layoutId)) {
    throw err.conflict('layout_in_use', 'Một suất chiếu đang dùng sơ đồ này, không thể xoá.');
  }
  // Recorded BEFORE the delete: afterwards there is no row to name, and this is the single action
  // whose evidence cannot be recovered from the data itself.
  await insertAudit(pool, {
    actorUserId: req.auth!.userId,
    action: 'layout_delete',
    targetType: 'venue_layout',
    targetId: layoutId,
    outcome: 'applied',
  });
  await repo.deleteLayout(layoutId);
}

/** The pre-publish checks, in one pass (FR-030). `categoriesWithTier` is only known at bind time. */
export async function validate(layoutId: number, categoriesWithTier?: number[]): Promise<ValidationIssue[]> {
  const layout = await repo.getLayout(layoutId);
  if (!layout) throw err.notFound('not_found', 'Không tìm thấy sơ đồ.');
  return validateLayout({
    seats: layout.seats.map((s) => ({
      id: s.id ?? 0,
      sectionId: s.sectionId,
      categoryId: s.categoryId,
      rowLabel: s.rowLabel,
      seatNumber: s.seatNumber,
      x: s.x,
      y: s.y,
    })),
    // The size multiplier feeds the overlap test (FR-065), so the style fields have to come through.
    // Colour is no longer among them: it moved to the category, where the column is NOT NULL.
    sections: layout.sections.map((s) => ({
      id: s.id ?? 0,
      name: s.name,
      color: s.color,
      seatSizeMultiplier: s.seatSizeMultiplier,
    })),
    categories: layout.categories.map((c) => ({ id: c.id ?? 0, name: c.name })),
    // `capacity` and `categoryId` come too, or a capacity zone is invisible to the validator and a
    // standing-only chart reports `zero_capacity` forever.
    elements: layout.elements.map((e) => ({
      kind: e.kind,
      x: e.x,
      y: e.y,
      points: e.points,
      capacity: e.capacity,
      categoryId: e.categoryId,
    })),
    categoriesWithTier,
  });
}

/**
 * Validation at BIND time (T050). The category-without-tier check cannot run against a layout alone —
 * a layout has no tiers — so it needs the showtime whose tiers are being assigned (FR-030).
 */
export async function validateForShowtime(layoutId: number, showtimeId: number): Promise<ValidationIssue[]> {
  const { rows } = await pool.query<{ category_id: number }>(
    `SELECT DISTINCT se.category_id
       FROM seats se
       JOIN showtime_seats ss ON ss.seat_id = se.id AND ss.showtime_id = $2
      WHERE se.layout_id = $1 AND se.category_id IS NOT NULL`,
    [layoutId, showtimeId],
  );
  return validate(layoutId, rows.map((r) => r.category_id));
}

export async function publish(req: Request, layoutId: number) {
  await assertLayoutOwner(req, layoutId);
  const issues = await validate(layoutId);
  if (issues.length > 0) {
    // Carries the issue list so the organizer sees what to fix, not a generic failure (FR-031).
    // Audited as a refusal too: a chart that repeatedly fails the gate is a support question, and
    // without this the only record of it is the organizer's memory.
    await insertAudit(pool, {
      actorUserId: req.auth!.userId,
      action: 'layout_publish',
      targetType: 'venue_layout',
      targetId: layoutId,
      outcome: 'rejected',
      detail: { issues: issues.map((i) => i.code) },
    });
    throw err.refused(422, 'layout_invalid', 'Sơ đồ chưa hợp lệ, không thể phát hành.', { issues });
  }
  await repo.setLayoutStatus(layoutId, 'ready');
  const layout = await repo.getLayout(layoutId);
  // Publishing is the moment the organizer declares the chart finished, so it is the checkpoint worth
  // being able to come back to. Recorded AFTER the gate, so history holds only publishable charts, and
  // from the READ — which adopts a document for charts whose column is null.
  if (layout?.document) {
    await repo.recordRevision(layoutId, {
      version: layout.version,
      document: layout.document,
      seatCount: layout.seats.length,
      actorUserId: req.auth!.userId,
    });
  }
  await insertAudit(pool, {
    actorUserId: req.auth!.userId,
    action: 'layout_publish',
    targetType: 'venue_layout',
    targetId: layoutId,
    outcome: 'applied',
  });
  return layout;
}

export async function revisions(req: Request, layoutId: number): Promise<LayoutRevision[]> {
  await assertLayoutOwner(req, layoutId, 'read');
  return repo.listRevisions(layoutId);
}

/** One revision's document, so the editor can show what a restore would actually change (§31). */
export async function revisionDocument(
  req: Request,
  layoutId: number,
  revisionId: number,
): Promise<ChartDocument> {
  await assertLayoutOwner(req, layoutId, 'read');
  const doc = await repo.revisionDocument(layoutId, revisionId);
  if (!doc) throw err.notFound('revision_not_found', 'Không tìm thấy phiên bản này.');
  return doc;
}

/**
 * Put a chart back to how it looked at an earlier publish.
 *
 * Deliberately routed through `saveLayout` rather than writing the document straight back. A restore
 * can delete seats — the older chart may simply have had fewer — and every guard that makes deleting a
 * seat safe lives on the save path: the `seat_in_use` pre-check, the ceilings, the version bump, the
 * `ready → draft` demotion. Bypassing it would make "restore" the one door with no lock on it.
 *
 * The CURRENT version is sent, not the revision's: this is a new edit that happens to reinstate old
 * content, not a rewind of the concurrency counter.
 */
export async function restoreRevision(req: Request, layoutId: number, revisionId: number) {
  await assertLayoutOwner(req, layoutId, 'design');
  const document = await repo.getRevisionDocument(layoutId, revisionId);
  if (!document) throw err.notFound('not_found', 'Không tìm thấy phiên bản này.');

  const current = await repo.getLayout(layoutId);
  if (!current) throw err.notFound('not_found', 'Không tìm thấy sơ đồ.');

  // A revision names the rows that existed when it was taken, and some are gone — usually the very
  // reason for going back. `reviveDocument` keeps the ids that are still live (preserving identity,
  // and any ticket sold against them) and re-mints the rest, which come back as new rows. Without it
  // `saveLayout`'s "positive id means UPDATE" matched nothing for the deleted ones and the restore
  // silently returned the CURRENT chart with no error at all.
  let placeholder = 0;
  const revived = reviveDocument(
    document as ChartDocument,
    await repo.liveSeatIds(layoutId),
    () => --placeholder,
  );

  const saved = await saveLayout(req, layoutId, {
    version: current.version,
    document: revived,
  });
  await insertAudit(pool, {
    actorUserId: req.auth!.userId,
    action: 'layout_restore',
    targetType: 'venue_layout',
    targetId: layoutId,
    outcome: 'applied',
    detail: { revisionId },
  });
  return saved;
}

export async function clone(req: Request, sourceId: number, targetVenueId: number, name: string): Promise<number> {
  await assertLayoutOwner(req, sourceId, 'read'); // refuses another organizer's layout (FR-037)
  await assertVenueOwner(req, targetVenueId, 'design');
  if ((await repo.countLayouts(targetVenueId)) >= VENUE_MAX_LAYOUTS) {
    throw err.conflict('layout_limit_reached', `Mỗi địa điểm chỉ có tối đa ${VENUE_MAX_LAYOUTS} sơ đồ.`);
  }
  try {
    const id = await repo.cloneLayout(sourceId, targetVenueId, name);
    await insertAudit(pool, {
      actorUserId: req.auth!.userId,
      action: 'layout_clone',
      targetType: 'venue_layout',
      targetId: id,
      outcome: 'applied',
      detail: { sourceId, targetVenueId },
    });
    return id;
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      throw err.conflict('layout_name_taken', 'Địa điểm đích đã có một sơ đồ trùng tên.');
    }
    throw e;
  }
}

/**
 * Save a chart as a reusable template.
 *
 * A COPY is marked, never the chart itself. Marking the working chart would make every later edit to it
 * an edit to the template, which is exactly the hidden dependency templates are supposed to avoid — and
 * it would take the chart out of the organizer's active list the moment they reused it.
 *
 * The copy lands in the same venue, because a chart's coordinates and sections only mean anything
 * against the venue it was drawn for. Applying a template elsewhere is `clone`, which already remaps.
 */
export async function saveAsTemplate(req: Request, sourceId: number, name: string) {
  const source = await repo.getLayout(sourceId);
  if (!source) throw err.notFound('not_found', 'Không tìm thấy sơ đồ.');
  const id = await clone(req, sourceId, source.venueId, name);
  await repo.setTemplate(id, true);
  await insertAudit(pool, {
    actorUserId: req.auth!.userId,
    action: 'layout_save_as_template',
    targetType: 'venue_layout',
    targetId: id,
    outcome: 'applied',
    detail: { sourceId },
  });
  return repo.getLayout(id);
}
