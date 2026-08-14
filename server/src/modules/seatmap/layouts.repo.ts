import type {
  Layout,
  LayoutElement,
  LayoutSeat,
  LayoutSection,
  LayoutLibraryEntry,
  LayoutRevision,
  LayoutSummary,
  SaveLayoutRequest,
  ShowtimeMap,
} from '@shared/catalog/seatmap.js';
import type { SeatMapElement, SeatMapTable } from '@shared/catalog/types.js';
import { adoptLayout, remapDocument, upgradeDocument } from '@shared/catalog/seatmap-document.js';
import { projectDocument, stitchSeatIds } from '@shared/catalog/seatmap-project.js';
import { clampCoord, normaliseRotation } from '@shared/catalog/seatmap-validate.js';
import { buildTierLegend } from '@shared/catalog/tier-palette.js';
import { LAYOUT_SPACE, SEAT_DIAMETER } from '../../config.js';
import { type Db, pool, withTransaction } from '../../db/pool.js';

// Layout reads and the versioned full-document save (research R-5).
//
// This module NEVER consults inventory: a showtime's generated map is a snapshot, so editing a
// layout cannot disturb a show that is on sale (FR-005, FR-027). Everything inventory-aware lives in
// apply.ts.

export async function layoutOwnerUserId(layoutId: number, db: Db = pool): Promise<number | null> {
  const { rows } = await db.query<{ created_by: number }>(
    `SELECT v.created_by FROM venue_layouts l JOIN venues v ON v.id = l.venue_id WHERE l.id = $1`,
    [layoutId],
  );
  return rows[0]?.created_by ?? null;
}

export async function layoutVenueId(layoutId: number, db: Db = pool): Promise<number | null> {
  const { rows } = await db.query<{ venue_id: number }>(`SELECT venue_id FROM venue_layouts WHERE id = $1`, [layoutId]);
  return rows[0]?.venue_id ?? null;
}

export async function countLayouts(venueId: number, db: Db = pool): Promise<number> {
  const { rows } = await db.query<{ n: string }>(`SELECT count(*) AS n FROM venue_layouts WHERE venue_id = $1`, [venueId]);
  return Number(rows[0].n);
}

export async function countSeats(layoutId: number, db: Db = pool): Promise<number> {
  const { rows } = await db.query<{ n: string }>(`SELECT count(*) AS n FROM seats WHERE layout_id = $1`, [layoutId]);
  return Number(rows[0].n);
}

/**
 * Every chart the organizer owns, across venues — the seat map library.
 *
 * Scoped by `venues.created_by` rather than by venue id, because the library exists precisely to stop
 * charts being reachable only by drilling through the venue that happens to hold them.
 *
 * `usage_count` counts showtimes that could still sell from this chart; finished and cancelled ones
 * are excluded, which is what makes an old chart archivable while a live one is not. It is the same
 * predicate `layoutInUse` applies, kept in step deliberately: the library's disabled buttons and the
 * server's refusals must agree, or the UI lies.
 */
export async function listAllLayouts(userId: number, db: Db = pool): Promise<LayoutLibraryEntry[]> {
  const { rows } = await db.query<{
    id: number;
    venue_id: number;
    venue_name: string;
    name: string;
    status: 'draft' | 'ready' | 'archived';
    is_template: boolean;
    seat_count: string;
    usage_count: string;
    updated_at: Date;
  }>(
    `SELECT l.id, l.venue_id, v.name AS venue_name, l.name, l.status, l.is_template, l.updated_at,
            (SELECT count(*) FROM seats s WHERE s.layout_id = l.id) AS seat_count,
            (SELECT count(*) FROM showtimes st
              WHERE st.layout_id = l.id AND st.status NOT IN ('finished', 'cancelled')) AS usage_count
       FROM venue_layouts l
       JOIN venues v ON v.id = l.venue_id
      WHERE v.created_by = $1
      ORDER BY l.updated_at DESC`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    venueId: r.venue_id,
    venueName: r.venue_name,
    name: r.name,
    status: r.status,
    isTemplate: r.is_template,
    seatCount: Number(r.seat_count),
    usageCount: Number(r.usage_count),
    updatedAt: r.updated_at.toISOString(),
  }));
}

export async function listLayouts(venueId: number, db: Db = pool): Promise<LayoutSummary[]> {
  const { rows } = await db.query<{
    id: number;
    venue_id: number;
    name: string;
    status: 'draft' | 'ready' | 'archived';
    is_template: boolean;
    seat_count: string;
  }>(
    `SELECT l.id, l.venue_id, l.name, l.status, l.is_template,
            (SELECT count(*) FROM seats s WHERE s.layout_id = l.id) AS seat_count
       FROM venue_layouts l WHERE l.venue_id = $1 ORDER BY l.created_at`,
    [venueId],
  );
  return rows.map((r) => ({
    id: r.id,
    venueId: r.venue_id,
    name: r.name,
    status: r.status,
    isTemplate: r.is_template,
    seatCount: Number(r.seat_count),
  }));
}

export async function getLayout(layoutId: number, db: Db = pool): Promise<Layout | null> {
  const head = await db.query<{
    id: number;
    venue_id: number;
    name: string;
    status: 'draft' | 'ready' | 'archived';
    is_template: boolean;
    version: number;
    background_url: string | null;
    // NUMERIC comes back from pg as a string. The DB stores a multiplier (1.000) and a 0–1 fraction;
    // the API contract publishes per-mille and 0–100 integers, so convert at this boundary and
    // nowhere else (Principle VI: one shape crosses the wire).
    background_scale: string;
    background_offset_x: number;
    background_offset_y: number;
    background_opacity: string;
    background_public: boolean;
    reference_url: string | null;
    reference_scale: string;
    reference_offset_x: number;
    reference_offset_y: number;
    reference_opacity: string;
    document: unknown;
  }>(`SELECT * FROM venue_layouts WHERE id = $1`, [layoutId]);
  const l = head.rows[0];
  if (!l) return null;

  const [sections, categories, seats, elements, tables] = await Promise.all([
    db.query<{
      id: number;
      name: string;
      description: string | null;
      color: string | null;
      seat_shape: 'circle' | 'square';
      seat_size_multiplier: string;
    }>(
      `SELECT id, name, description, color, seat_shape, seat_size_multiplier
         FROM sections WHERE layout_id = $1 ORDER BY name`,
      [layoutId],
    ),
    db.query<{ id: number; name: string; color: string }>(
      `SELECT id, name, color FROM layout_categories WHERE layout_id = $1 ORDER BY name`,
      [layoutId],
    ),
    db.query<{
      id: number;
      section_id: number | null;
      category_id: number | null;
      row_label: string;
      seat_number: number;
      seat_type: 'single' | 'double' | 'standing';
      pos_x: number;
      pos_y: number;
      rotation: number;
      table_id: number | null;
      is_accessible: boolean;
    }>(
      `SELECT id, section_id, category_id, row_label, seat_number, seat_type, pos_x, pos_y, rotation,
              table_id, is_accessible
         FROM seats WHERE layout_id = $1 ORDER BY section_id, row_label, seat_number`,
      [layoutId],
    ),
    db.query<{
      id: number;
      kind: LayoutElement['kind'];
      pos_x: number;
      pos_y: number;
      width: number;
      height: number;
      rotation: number;
      label: string | null;
      points: { x: number; y: number }[] | null;
      capacity: number | null;
      category_id: number | null;
    }>(
      `SELECT id, kind, pos_x, pos_y, width, height, rotation, label, points, capacity, category_id
         FROM layout_elements WHERE layout_id = $1 ORDER BY id`,
      [layoutId],
    ),
    db.query<{
      id: number;
      section_id: number | null;
      category_id: number | null;
      name: string;
      shape: 'round' | 'rect';
      pos_x: number;
      pos_y: number;
      width: number;
      height: number;
      rotation: number;
      seat_count: number;
      side_counts: number[] | null;
      booking_mode: 'per_seat' | 'whole_table';
    }>(
      `SELECT id, section_id, category_id, name, shape, pos_x, pos_y, width, height, rotation,
              seat_count, side_counts, booking_mode
         FROM layout_tables WHERE layout_id = $1 ORDER BY id`,
      [layoutId],
    ),
  ]);

  const layout: Layout = {
    id: l.id,
    venueId: l.venue_id,
    name: l.name,
    status: l.status,
    isTemplate: l.is_template,
    version: l.version,
    sections: sections.rows.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      color: s.color,
      seatShape: s.seat_shape,
      seatSizeMultiplier: Number(s.seat_size_multiplier),
    })),
    categories: categories.rows.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    tables: tables.rows.map((t) => ({
      id: t.id,
      sectionId: t.section_id,
      categoryId: t.category_id,
      name: t.name,
      shape: t.shape,
      x: t.pos_x,
      y: t.pos_y,
      width: t.width,
      height: t.height,
      rotation: t.rotation,
      seatCount: t.seat_count,
      sideCounts: t.side_counts,
      bookingMode: t.booking_mode,
    })),
    seats: seats.rows.map((s) => ({
      id: s.id,
      sectionId: s.section_id,
      categoryId: s.category_id,
      rowLabel: s.row_label,
      seatNumber: s.seat_number,
      seatType: s.seat_type,
      x: s.pos_x,
      y: s.pos_y,
      rotation: s.rotation,
      tableId: s.table_id,
      isAccessible: s.is_accessible,
    })),
    elements: elements.rows.map((e) => ({
      id: e.id,
      kind: e.kind,
      x: e.pos_x,
      y: e.pos_y,
      width: e.width,
      height: e.height,
      rotation: e.rotation,
      label: e.label,
      // A boundary/divider/area keeps its vertices here. Omitting them used to erase the polygon on
      // the next save, because `saveLayout` re-inserts elements wholesale from what the editor holds.
      points: e.points,
      capacity: e.capacity,
      categoryId: e.category_id,
    })),
    floorPlan: {
      url: l.background_url,
      scale: Math.round(Number(l.background_scale) * 1000),
      offsetX: l.background_offset_x,
      offsetY: l.background_offset_y,
      opacity: Math.round(Number(l.background_opacity) * 100),
      visibleToBuyers: l.background_public,
    },
    referenceChart: {
      url: l.reference_url,
      scale: Math.round(Number(l.reference_scale) * 1000),
      offsetX: l.reference_offset_x,
      offsetY: l.reference_offset_y,
      opacity: Math.round(Number(l.reference_opacity) * 100),
    },
    document: null,
  };

  // Adoption, on read. A layout stored before documents existed — every layout in the database until
  // 0026 — gets one synthesised from the rows above, so the editor always has something to work with
  // and no stored chart has to be migrated. The same fallback catches a hand-edited or future-schema
  // blob that `upgradeDocument` refuses to read, which is why it returns null rather than throwing.
  layout.document = upgradeDocument(l.document) ?? adoptLayout(layout);
  return layout;
}

/**
 * Record what a chart looked like at the moment it was published.
 *
 * `ON CONFLICT DO NOTHING` because publishing twice without an edit in between is the same version and
 * therefore the same revision — the history should record changes, not clicks.
 */
export async function recordRevision(
  layoutId: number,
  input: { version: number; document: unknown; seatCount: number; actorUserId: number },
  db: Db = pool,
): Promise<void> {
  // The document is passed in rather than read from the column, because the column is NULL for any
  // chart last edited outside the document path — `tables`, `standing` and `generate-seats` all null
  // it, and the next read synthesises one with `adoptLayout`. Reading the column here recorded nothing
  // for exactly those charts, which are the ones most likely to predate the editor.
  await db.query(
    `INSERT INTO layout_revisions (layout_id, version, document, seat_count, created_by)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     ON CONFLICT (layout_id, version) DO NOTHING`,
    [layoutId, input.version, JSON.stringify(input.document), input.seatCount, input.actorUserId],
  );
}

export async function listRevisions(layoutId: number, db: Db = pool): Promise<LayoutRevision[]> {
  const { rows } = await db.query<{
    id: number;
    version: number;
    seat_count: number;
    created_at: Date;
    created_by: number | null;
  }>(
    `SELECT id, version, seat_count, created_at, created_by
       FROM layout_revisions WHERE layout_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50`,
    [layoutId],
  );
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    seatCount: r.seat_count,
    createdAt: r.created_at.toISOString(),
    createdBy: r.created_by,
  }));
}

/** The stored document of one revision, for restoring it. Scoped by layout so an id from another
 *  chart cannot be restored into this one. */
export async function getRevisionDocument(
  layoutId: number,
  revisionId: number,
  db: Db = pool,
): Promise<unknown | null> {
  const { rows } = await db.query<{ document: unknown }>(
    `SELECT document FROM layout_revisions WHERE id = $1 AND layout_id = $2`,
    [revisionId, layoutId],
  );
  return rows[0]?.document ?? null;
}

export async function createLayout(venueId: number, name: string, db: Db = pool): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO venue_layouts (venue_id, name) VALUES ($1, $2) RETURNING id`,
    [venueId, name],
  );
  return rows[0].id;
}

export async function renameLayout(layoutId: number, name: string, db: Db = pool): Promise<void> {
  await db.query(`UPDATE venue_layouts SET name = $2, updated_at = now() WHERE id = $1`, [layoutId, name]);
}

/** Mark (or unmark) a chart as a template. Not part of `saveLayout`: it changes no geometry, so it
 *  has no business taking a version. */
/** The seat ids this layout currently has — what an old revision has to be reconciled against. */
export async function liveSeatIds(layoutId: number, db: Db = pool): Promise<Set<number>> {
  const { rows } = await db.query<{ id: number }>(`SELECT id FROM seats WHERE layout_id = $1`, [layoutId]);
  return new Set(rows.map((r) => r.id));
}

export async function setTemplate(layoutId: number, isTemplate: boolean, db: Db = pool): Promise<void> {
  await db.query(`UPDATE venue_layouts SET is_template = $2, updated_at = now() WHERE id = $1`, [
    layoutId,
    isTemplate,
  ]);
}

export async function deleteLayout(layoutId: number, db: Db = pool): Promise<void> {
  await db.query(`DELETE FROM venue_layouts WHERE id = $1`, [layoutId]);
}

/** A layout any non-finished, non-cancelled showtime generated a map from may not be deleted, so a
 *  live map's source stays inspectable and re-appliable (FR-006). */
export async function layoutInUse(layoutId: number, db: Db = pool): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM showtimes WHERE layout_id = $1 AND status NOT IN ('finished', 'cancelled') LIMIT 1`,
    [layoutId],
  );
  return rows.length > 0;
}

export async function setLayoutStatus(layoutId: number, status: 'draft' | 'ready' | 'archived', db: Db = pool): Promise<void> {
  await db.query(`UPDATE venue_layouts SET status = $2, updated_at = now() WHERE id = $1`, [layoutId, status]);
}

/**
 * Full-document save with optimistic concurrency. Returns null when `version` is stale, so two
 * organizer sessions can never silently overwrite each other (FR-015).
 *
 * Positions are clamped into the space and rotations normalised before write, so a stored value is
 * always in range regardless of what the client sent (FR-014).
 */
export async function saveLayout(layoutId: number, body: SaveLayoutRequest): Promise<Layout | null> {
  return withTransaction(async (client) => {
    const locked = await client.query<{ version: number }>(
      `SELECT version FROM venue_layouts WHERE id = $1 FOR UPDATE`,
      [layoutId],
    );
    const current = locked.rows[0];
    if (!current || current.version !== body.version) return null;

    // One projection, used for every collection below. When the client sends a document it is the only
    // source; the legacy arrays are read only when it does not.
    const projected = body.document ? projectDocument(body.document) : null;
    const inSections = projected ? projected.sections : (body.sections ?? []);
    const inCategories = projected ? projected.categories : (body.categories ?? []);
    const inSeats = projected ? projected.seats : (body.seats ?? []);
    const inElements = projected ? projected.elements : (body.elements ?? []);

    if (body.name !== undefined || body.isTemplate !== undefined) {
      await client.query(
        `UPDATE venue_layouts SET name = COALESCE($2, name), is_template = COALESCE($3, is_template) WHERE id = $1`,
        [layoutId, body.name ?? null, body.isTemplate ?? null],
      );
    }

    // --- sections: upsert by id, delete the rest. Seats keep their section by id, so a section that
    // survives keeps its seats; deleting one leaves its seats sectionless, which validation catches.
    const keptSections: number[] = [];
    const sectionIdMap = new Map<number, number>(); // client-side id → real id
    for (const s of inSections) {
      // `s.id > 0` and not merely `s.id`: a negative id is a placeholder the editor minted this
      // session, and treating it as existing ran an UPDATE that matched nothing, never inserted the
      // section, and left every seat pointing at a section id that does not exist — a foreign-key
      // error on the seat INSERT. The categories loop below has always tested the sign; this one did
      // not, and nothing exercised it because the tests only ever sent sections that already existed.
      if (s.id && s.id > 0) {
        await client.query(
          `UPDATE sections SET name = $2, description = $3,
                               color = $5, seat_shape = COALESCE($6, seat_shape),
                               seat_size_multiplier = COALESCE($7, seat_size_multiplier)
             WHERE id = $1 AND layout_id = $4`,
          [
            s.id,
            s.name,
            s.description ?? null,
            layoutId,
            s.color ?? null,
            s.seatShape ?? null,
            s.seatSizeMultiplier ?? null,
          ],
        );
        keptSections.push(s.id);
        sectionIdMap.set(s.id, s.id);
      } else {
        const { rows } = await client.query<{ id: number }>(
          // A new section gets a palette colour by position unless the organizer chose one. FR-066
          // makes a colourless section block publishing, so defaulting here is what stops the gate
          // from blocking work the organizer was never asked to do — it still catches a colour that
          // was explicitly cleared.
          `INSERT INTO sections (layout_id, name, description, color, seat_shape, seat_size_multiplier)
           VALUES ($1, $2, $3,
                   COALESCE($4, (ARRAY['#4C9A6B','#3E7CB1','#C9762F','#9B4D8E','#B3453C'])[(SELECT count(*) FROM sections WHERE layout_id = $1)::int % 5 + 1]),
                   COALESCE($5, 'circle'), COALESCE($6, 1.0)) RETURNING id`,
          [
            layoutId,
            s.name,
            s.description ?? null,
            s.color ?? null,
            s.seatShape ?? null,
            s.seatSizeMultiplier ?? null,
          ],
        );
        keptSections.push(rows[0].id);
        // Record placeholder → real, exactly as the categories loop does. Without it `resolveRef`
        // cannot find the new section, so every seat drawn into a brand-new section was saved
        // SECTIONLESS — which validation then reports as `seat_without_section` and which blocks
        // publishing, for a section the organizer had just created.
        if (s.id) sectionIdMap.set(s.id, rows[0].id);
      }
    }
    await client.query(
      `DELETE FROM sections WHERE layout_id = $1 AND NOT (id = ANY($2::bigint[]))`,
      [layoutId, keptSections],
    );

    // --- categories: same upsert-by-id/delete-the-rest shape as sections, and BEFORE seats so a seat
    // created in this save can reference a category created in the same save by placeholder id.
    // Deleting one leaves its seats unclassified rather than deleting them (ON DELETE SET NULL).
    const keptCategories: number[] = [];
    const categoryIdMap = new Map<number, number>();
    for (const c of inCategories) {
      if (c.id && c.id > 0) {
        await client.query(`UPDATE layout_categories SET name = $2, color = $3 WHERE id = $1 AND layout_id = $4`, [
          c.id,
          c.name,
          c.color,
          layoutId,
        ]);
        keptCategories.push(c.id);
        categoryIdMap.set(c.id, c.id);
      } else {
        const { rows } = await client.query<{ id: number }>(
          `INSERT INTO layout_categories (layout_id, name, color) VALUES ($1, $2, $3) RETURNING id`,
          [layoutId, c.name, c.color],
        );
        keptCategories.push(rows[0].id);
        // A negative placeholder is how the editor references a category it minted this session.
        if (c.id) categoryIdMap.set(c.id, rows[0].id);
      }
    }
    await client.query(`DELETE FROM layout_categories WHERE layout_id = $1 AND NOT (id = ANY($2::bigint[]))`, [
      layoutId,
      keptCategories,
    ]);

    // --- seats
    const keptSeats: number[] = [];
    for (const seat of inSeats) {
      const x = clampCoord(seat.x);
      const y = clampCoord(seat.y);
      const rot = normaliseRotation(seat.rotation);
      const sectionId = resolveRef(seat.sectionId, sectionIdMap, keptSections);
      const categoryId = resolveRef(seat.categoryId ?? null, categoryIdMap, keptCategories);
      if (seat.id) {
        await client.query(
          `UPDATE seats SET section_id = $2, row_label = $3, seat_number = $4, seat_type = $5,
                            pos_x = $6, pos_y = $7, rotation = $8, category_id = $10,
                            is_accessible = $11
             WHERE id = $1 AND layout_id = $9`,
          [seat.id, sectionId, seat.rowLabel, seat.seatNumber, seat.seatType, x, y, rot, layoutId, categoryId,
           seat.isAccessible ?? false],
        );
        keptSeats.push(seat.id);
      } else {
        const { rows } = await client.query<{ id: number }>(
          `INSERT INTO seats (layout_id, section_id, row_label, seat_number, seat_type, pos_x, pos_y, rotation,
                              category_id, is_accessible)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [layoutId, sectionId, seat.rowLabel, seat.seatNumber, seat.seatType, x, y, rot, categoryId,
           seat.isAccessible ?? false],
        );
        keptSeats.push(rows[0].id);
      }
    }
    // A seat a showtime has generated from CANNOT be deleted here. `showtime_seats.seat_id` is a
    // plain `REFERENCES seats(id)` with no ON DELETE clause (0002_catalog.sql:129), so this statement
    // raises 23503 for such a seat. The comment that used to sit here claimed the opposite; it was
    // wrong, and only survived because no caller had yet saved a layout omitting a bound seat.
    //
    // The service refuses that save up front with `seat_in_use` so the organizer is told which seats
    // are sold rather than shown a 500. This catch is the belt-and-braces behind it, because the
    // pre-check and this DELETE are two statements and only the transaction makes them one.
    //
    // The 23503 is mapped to that refusal by the SERVICE, which is where PG codes are already turned
    // into refusals (it does the same for 23505) — this layer stays free of HTTP.
    //
    // NOTE for future readers: `ON DELETE CASCADE` here would "fix" the error by deleting paid
    // inventory. It is never the right answer.
    await client.query(`DELETE FROM seats WHERE layout_id = $1 AND NOT (id = ANY($2::bigint[]))`, [layoutId, keptSeats]);

    // --- elements: replaced wholesale, they carry no identity anything else points at.
    await client.query(`DELETE FROM layout_elements WHERE layout_id = $1`, [layoutId]);
    for (const e of inElements) {
      await client.query(
        `INSERT INTO layout_elements (layout_id, kind, pos_x, pos_y, width, height, rotation, label, points, capacity, category_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          layoutId,
          e.kind,
          clampCoord(e.x),
          clampCoord(e.y),
          e.width,
          e.height,
          normaliseRotation(e.rotation),
          e.label,
          // Shapes carry an ordered point list; every other kind stores null (FR-058).
          e.points ? JSON.stringify(e.points.map((pt) => ({ x: clampCoord(pt.x), y: clampCoord(pt.y) }))) : null,
          e.capacity ?? null,
          // A zone's price class survives the save; anything that is not an area carries neither,
          // which the 0027 CHECK enforces independently of this writer.
          e.kind === 'area' ? (categoryIdMap.get(e.categoryId ?? 0) ?? e.categoryId ?? null) : null,
        ],
      );
    }

    // Store the document with the database's own ids in it, so the blob never holds a placeholder.
    // That is what makes "negative means never persisted" true server-side, and it means a reload
    // hands the editor a document that projects to exactly the rows just written.
    //
    // A save that sent no document leaves the column alone rather than writing a synthesised one: the
    // read path adopts from the rows anyway, and writing an inferred document would claim an authoring
    // intent the organizer never expressed.
    if (body.document && projected) {
      // Seats by position (which document seat produced which row), then sections/categories/tables by
      // the placeholder maps the loops above already built. Both halves are needed: leaving a
      // placeholder section id in the stored document meant the NEXT save treated it as new again,
      // inserted a second section with the same name, and tripped `UNIQUE (layout_id, name)`.
      let temp = 0;
      const stitched = remapDocument(
        stitchSeatIds(body.document, projected.seatOrigin, keptSeats),
        {
          sections: sectionIdMap,
          categories: categoryIdMap,
          // Identity for tables: they are written through their own endpoints, so any id already in
          // the document is real and must be preserved rather than re-minted.
          tables: new Map(
            body.document.blocks
              .map((b) => b.tableId)
              .filter((id): id is number => typeof id === 'number' && id > 0)
              .map((id) => [id, id]),
          ),
          // Seat ids are already real after `stitchSeatIds`, so map each to itself.
          seats: new Map(keptSeats.map((id) => [id, id])),
        },
        () => (temp -= 1),
      );
      await client.query(`UPDATE venue_layouts SET document = $2::jsonb WHERE id = $1`, [
        layoutId,
        JSON.stringify(stitched),
      ]);
    }

    // Editing a PUBLISHED chart returns it to draft (the Seats.io lifecycle): what is live and what is
    // being worked on are not the same document, and re-publishing is the deliberate act that makes
    // the edit bindable. Showtimes already generated are untouched — they own a snapshot (FR-005).
    await client.query(
      `UPDATE venue_layouts
          SET version = version + 1, updated_at = now(),
              status = CASE WHEN status = 'ready' THEN 'draft' ELSE status END
        WHERE id = $1`,
      [layoutId],
    );
    return getLayout(layoutId, client);
  });
}

/** A client may reference a section or category it just created by a negative placeholder id; anything
 *  unknown becomes null, which validation reports rather than silently dropping the seat. */
function resolveRef(id: number | null, map: Map<number, number>, kept: number[]): number | null {
  if (id === null) return null;
  const mapped = map.get(id);
  if (mapped) return mapped;
  return kept.includes(id) ? id : null;
}

/**
 * The layout's first category, created if it has none.
 *
 * Every path that mints a seat outside the full-document save goes through this, for the same reason
 * `createSection` defaults a colour: a seat with no class blocks publishing, so a generator that left
 * one behind would produce a layout that cannot be published by any route the organizer can see.
 */
export async function defaultCategoryId(layoutId: number, db: Db = pool): Promise<number> {
  const found = await db.query<{ id: number }>(
    `SELECT id FROM layout_categories WHERE layout_id = $1 ORDER BY id LIMIT 1`,
    [layoutId],
  );
  if (found.rows[0]) return found.rows[0].id;
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO layout_categories (layout_id, name, color) VALUES ($1, 'Hạng thường', '#4C9A6B')
     ON CONFLICT (layout_id, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [layoutId],
  );
  return rows[0].id;
}

/**
 * The Section / Row / Count generator, kept as the fast first step (FR-010). Seeds seats on a grid
 * with editable positions; it never overwrites existing seats unless asked.
 */
export async function generateSeatRow(
  layoutId: number,
  sectionId: number,
  rowLabel: string,
  count: number,
  replaceExisting: boolean,
): Promise<number> {
  return withTransaction(async (client) => {
    if (replaceExisting) {
      await client.query(`DELETE FROM seats WHERE layout_id = $1 AND section_id = $2 AND row_label = $3`, [
        layoutId,
        sectionId,
        rowLabel,
      ]);
    }
    // Stack each generated row below the ones already there, centred horizontally — the same grid the
    // migration seeds legacy seats onto, so generated and migrated layouts look alike.
    const { rows: existing } = await client.query<{ max_y: number | null; rows_used: string }>(
      `SELECT max(pos_y) AS max_y, count(DISTINCT row_label) AS rows_used FROM seats WHERE layout_id = $1`,
      [layoutId],
    );
    const spacing = Math.round(SEAT_DIAMETER * 1.5);
    const y = clampCoord((existing[0].max_y ?? 1200 - spacing) + spacing);
    const startX = clampCoord(5000 - ((count - 1) * spacing) / 2);

    const res = await client.query(
      `INSERT INTO seats (layout_id, section_id, category_id, row_label, seat_number, seat_type, pos_x, pos_y, rotation)
       SELECT $1, $2, $8, $3, gs, 'single',
              LEAST(10000, $4::int + (gs - 1) * $5::int), $6, 0
         FROM generate_series(1, $7) AS gs
       ON CONFLICT (section_id, row_label, seat_number) DO NOTHING`,
      [layoutId, sectionId, rowLabel, startX, spacing, y, count, await defaultCategoryId(layoutId, client)],
    );
    return res.rowCount ?? 0;
  });
}

// ---- Floor plan (background layer only — it never owns geometry, FR-020) ----

export async function setPlanUrl(layoutId: number, url: string | null, db: Db = pool): Promise<string | null> {
  const { rows } = await db.query<{ background_url: string | null }>(
    `UPDATE venue_layouts SET background_url = $2, updated_at = now() WHERE id = $1 RETURNING (SELECT background_url FROM venue_layouts WHERE id = $1) AS background_url`,
    [layoutId, url],
  );
  return rows[0]?.background_url ?? null;
}

export async function currentPlanUrl(layoutId: number, db: Db = pool): Promise<string | null> {
  const { rows } = await db.query<{ background_url: string | null }>(`SELECT background_url FROM venue_layouts WHERE id = $1`, [layoutId]);
  return rows[0]?.background_url ?? null;
}

export async function updatePlanAlignment(
  layoutId: number,
  p: { scale: number; offsetX: number; offsetY: number; opacity: number; visibleToBuyers: boolean },
  db: Db = pool,
): Promise<void> {
  await db.query(
    `UPDATE venue_layouts
        SET background_scale = $2, background_offset_x = $3, background_offset_y = $4, background_opacity = $5,
            background_public = $6, updated_at = now()
      WHERE id = $1`,
    [layoutId, p.scale / 1000, p.offsetX, p.offsetY, p.opacity / 100, p.visibleToBuyers],
  );
}

/** The reference chart's current file, so a replacement can unlink the old one. */
export async function currentReferenceUrl(layoutId: number, db: Db = pool): Promise<string | null> {
  const { rows } = await db.query<{ reference_url: string | null }>(
    `SELECT reference_url FROM venue_layouts WHERE id = $1`,
    [layoutId],
  );
  return rows[0]?.reference_url ?? null;
}

export async function setReferenceUrl(layoutId: number, url: string | null, db: Db = pool): Promise<void> {
  await db.query(`UPDATE venue_layouts SET reference_url = $2, updated_at = now() WHERE id = $1`, [layoutId, url]);
}

/** Alignment only. Like the buyer-facing plan, the reference never owns a seat's position (FR-024). */
export async function updateReferenceAlignment(
  layoutId: number,
  p: { scale: number; offsetX: number; offsetY: number; opacity: number },
  db: Db = pool,
): Promise<void> {
  await db.query(
    `UPDATE venue_layouts
        SET reference_scale = $2, reference_offset_x = $3, reference_offset_y = $4,
            reference_opacity = $5, updated_at = now()
      WHERE id = $1`,
    [layoutId, p.scale / 1000, p.offsetX, p.offsetY, p.opacity / 100],
  );
}

/** Deep-copy into another venue the caller owns. Independent: carries no sales, holds or blocks,
 *  and starts as a draft (FR-036). */
export async function cloneLayout(sourceId: number, targetVenueId: number, name: string): Promise<number> {
  return withTransaction(async (client) => {
    const { rows: created } = await client.query<{ id: number }>(
      `INSERT INTO venue_layouts (venue_id, name, status, background_url, background_scale, background_offset_x, background_offset_y,
                                  background_opacity, background_public)
       SELECT $2, $3, 'draft', background_url, background_scale, background_offset_x, background_offset_y, background_opacity, background_public
         FROM venue_layouts WHERE id = $1
       RETURNING id`,
      [sourceId, targetVenueId, name],
    );
    const newId = created[0].id;

    const { rows: sections } = await client.query<{ old_id: number; new_id: number }>(
      `WITH ins AS (
         INSERT INTO sections (layout_id, name, description, color, seat_shape, seat_size_multiplier)
         -- A clone is an independent copy, so it carries the source's visual style too.
         SELECT $2, name, description, color, seat_shape, seat_size_multiplier
           FROM sections WHERE layout_id = $1 ORDER BY id
         RETURNING id, name
       )
       SELECT s.id AS old_id, ins.id AS new_id
         FROM sections s JOIN ins ON ins.name = s.name
        WHERE s.layout_id = $1`,
      [sourceId, newId],
    );
    const map = new Map(sections.map((r) => [r.old_id, r.new_id]));

    const { rows: cats } = await client.query<{ old_id: number; new_id: number }>(
      `WITH ins AS (
         INSERT INTO layout_categories (layout_id, name, color)
         SELECT $2, name, color FROM layout_categories WHERE layout_id = $1 ORDER BY id
         RETURNING id, name
       )
       SELECT c.id AS old_id, ins.id AS new_id
         FROM layout_categories c JOIN ins ON ins.name = c.name
        WHERE c.layout_id = $1`,
      [sourceId, newId],
    );
    const catMap = new Map(cats.map((r) => [r.old_id, r.new_id]));

    // Tables before seats: a seat carries `table_id`, so the new table ids must exist first. Inserted
    // one at a time rather than joined on name, because a name is only unique WITHIN a section.
    const { rows: tables } = await client.query<{
      id: number;
      section_id: number | null;
      category_id: number | null;
      name: string;
      shape: string;
      pos_x: number;
      pos_y: number;
      width: number;
      height: number;
      rotation: number;
      seat_count: number;
      side_counts: number[] | null;
    }>(
      `SELECT id, section_id, category_id, name, shape, pos_x, pos_y, width, height, rotation, seat_count, side_counts
         FROM layout_tables WHERE layout_id = $1 ORDER BY id`,
      [sourceId],
    );
    const tableMap = new Map<number, number>();
    for (const t of tables) {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO layout_tables (layout_id, section_id, category_id, name, shape, pos_x, pos_y, width, height,
                                    rotation, seat_count, side_counts)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [
          newId,
          t.section_id === null ? null : (map.get(t.section_id) ?? null),
          t.category_id === null ? null : (catMap.get(t.category_id) ?? null),
          t.name,
          t.shape,
          t.pos_x,
          t.pos_y,
          t.width,
          t.height,
          t.rotation,
          t.seat_count,
          t.side_counts === null ? null : JSON.stringify(t.side_counts),
        ],
      );
      tableMap.set(t.id, rows[0].id);
    }

    const { rows: seats } = await client.query<{
      id: number;
      section_id: number | null;
      row_label: string;
      seat_number: number;
      seat_type: string;
      pos_x: number;
      pos_y: number;
      rotation: number;
      table_id: number | null;
      category_id: number | null;
    }>(
      `SELECT id, section_id, row_label, seat_number, seat_type, pos_x, pos_y, rotation, table_id, category_id
         FROM seats WHERE layout_id = $1 ORDER BY id`,
      [sourceId],
    );
    // `RETURNING id` so the caller gets an old→new seat map. Without it a document copied alongside the
    // clone would still name the SOURCE's seat ids, which project into no-op UPDATEs and then a DELETE
    // of every real seat of the clone — silently, leaving a layout that looks right in the list.
    const seatMap = new Map<number, number>();
    for (const s of seats) {
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO seats (layout_id, section_id, row_label, seat_number, seat_type, pos_x, pos_y, rotation,
                            table_id, category_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [
          newId,
          s.section_id === null ? null : (map.get(s.section_id) ?? null),
          s.row_label,
          s.seat_number,
          s.seat_type,
          s.pos_x,
          s.pos_y,
          s.rotation,
          s.table_id === null ? null : (tableMap.get(s.table_id) ?? null),
          s.category_id === null ? null : (catMap.get(s.category_id) ?? null),
        ],
      );
      seatMap.set(s.id, inserted.rows[0].id);
    }

    await client.query(
      // `capacity` used to be dropped here, so cloning a chart silently emptied every zone; and the
      // category has to be REMAPPED, or the copy would price its zones off the source's classes.
      `INSERT INTO layout_elements (layout_id, kind, pos_x, pos_y, width, height, rotation, label, points, capacity, category_id)
       SELECT $2, kind, pos_x, pos_y, width, height, rotation, label, points, capacity,
              (SELECT c2.id FROM layout_categories c1
                 JOIN layout_categories c2 ON c2.layout_id = $2 AND c2.name = c1.name
                WHERE c1.id = layout_elements.category_id)
         FROM layout_elements WHERE layout_id = $1`,
      [sourceId, newId],
    );

    // Carry the authoring document across, re-pointed at the CLONE's own rows.
    //
    // Copying it verbatim would be the worst outcome available: the clone would open holding the
    // source's seat ids, and its first save would issue `UPDATE seats ... WHERE id = <source seat>
    // AND layout_id = <clone>` — matching nothing — and then delete every seat the clone actually has.
    // Silently, leaving a layout that looks correct in the list with nothing in it.
    const { rows: srcDoc } = await client.query<{ document: unknown }>(
      `SELECT document FROM venue_layouts WHERE id = $1`,
      [sourceId],
    );
    const parsed = upgradeDocument(srcDoc[0]?.document);
    if (parsed) {
      let temp = 0;
      const remapped = remapDocument(
        parsed,
        { sections: map, categories: catMap, seats: seatMap, tables: tableMap },
        () => (temp -= 1),
      );
      await client.query(`UPDATE venue_layouts SET document = $2::jsonb WHERE id = $1`, [
        newId,
        JSON.stringify(remapped),
      ]);
    }

    return newId;
  });
}

/**
 * A showtime's generated map, read as its OWNER rather than as the public.
 *
 * Everything comes off `showtime_seats` — the showtime's own SNAPSHOT of the layout — so what the
 * organizer sees here is the inventory itself and not the layout it was generated from. The two
 * genuinely differ once a map has been edited in place (FR-027a), and blocking or re-pricing a seat
 * that exists only in the layout would be meaningless.
 *
 * The buyer's `getSeatMap` cannot serve this: it is gated on public visibility, so it returns nothing
 * for a draft or pending-review event — the state an organizer is most likely to be arranging seats
 * in. Same data, ownership gate instead of a visibility gate.
 *
 * Ordered section → row → number, the ordering the buyer read also promises, so the tab order is the
 * same on both screens (FR-039a).
 */
export async function getShowtimeMap(showtimeId: number, db: Db = pool): Promise<ShowtimeMap> {
  const seats = await db.query<{
    id: number;
    row_label: string | null;
    seat_number: number | null;
    section_name: string | null;
    category_name: string | null;
    ticket_tier_id: number;
    label: string;
    price: string;
    status: 'available' | 'held' | 'sold' | 'blocked';
    pos_x: number | null;
    pos_y: number | null;
    rotation: number;
  }>(
    `SELECT ss.id, ss.row_label, ss.seat_number, ss.section_name, ss.category_name, ss.ticket_tier_id,
            tt.label, tt.price_amount::text AS price, ss.status, ss.pos_x, ss.pos_y, ss.rotation
       FROM showtime_seats ss
       JOIN ticket_tiers tt ON tt.id = ss.ticket_tier_id
      WHERE ss.showtime_id = $1
      ORDER BY ss.section_name NULLS FIRST, ss.row_label, ss.seat_number`,
    [showtimeId],
  );

  const snap = await db.query<{
    layout_snapshot: {
      elements?: SeatMapElement[];
      tables?: SeatMapTable[];
      sectionStyles?: { name: string; seatShape: 'circle' | 'square'; seatSizeMultiplier: number }[];
    } | null;
  }>(`SELECT layout_snapshot FROM showtimes WHERE id = $1`, [showtimeId]);
  const snapshot = snap.rows[0]?.layout_snapshot ?? null;

  // Style is looked up by section NAME: that is the only section identity a seat row carries, and the
  // snapshot is what makes the lookup safe — both sides came from the same apply.
  const styleOf = new Map((snapshot?.sectionStyles ?? []).map((st) => [st.name, st]));

  // The tier colours the BUYER sees, built by the same function, so an organizer checking which block
  // is the expensive one reads the same picture their customer will (FR-067).
  const tiers = await db.query<{ id: number; label: string; price: string; color: string | null }>(
    `SELECT tt.id, tt.label, tt.price_amount::text AS price, c.color
       FROM ticket_tiers tt
       LEFT JOIN layout_categories c ON c.id = tt.category_id
      WHERE tt.showtime_id = $1 AND tt.archived_at IS NULL`,
    [showtimeId],
  );

  return {
    showtimeId,
    space: { width: LAYOUT_SPACE, height: LAYOUT_SPACE, seatDiameter: SEAT_DIAMETER },
    elements: (snapshot?.elements ?? []) as unknown as ShowtimeMap['elements'],
    tables: snapshot?.tables ?? [],
    tierLegend: buildTierLegend(
      tiers.rows.map((t) => ({ id: t.id, label: t.label, price: Number(t.price), color: t.color })),
    ),
    seats: seats.rows.map((r) => ({
      id: r.id,
      row: r.row_label ?? '',
      number: r.seat_number ?? 0,
      section: r.section_name,
      category: r.category_name,
      ticketTierId: r.ticket_tier_id,
      tier: r.label,
      price: Number(r.price),
      status: r.status,
      x: r.pos_x ?? 0,
      y: r.pos_y ?? 0,
      rotation: r.rotation,
      shape: r.section_name ? styleOf.get(r.section_name)?.seatShape : undefined,
      sizeMultiplier: r.section_name ? styleOf.get(r.section_name)?.seatSizeMultiplier : undefined,
    })),
  };
}

/**
 * Forget the authoring document for this layout.
 *
 * Called by the write paths that change seat geometry WITHOUT going through the document — placing or
 * moving a table (tables.ts), creating or re-shaping a standing area (standing.ts). Those own their
 * seat geometry for good reasons: a table's seats must sit outside its edge, and a standing area's must
 * fall inside a polygon.
 *
 * Blunt on purpose. The alternative — patching the document from inside each of those writers — means
 * five more places that must speak the document's vocabulary and stay in step with it, which is the
 * drift the document was introduced to remove. Nulling it cannot produce a blob that disagrees with the
 * rows: the next read adopts a fresh one from the rows themselves.
 *
 * The cost is real and worth stating: the parametric intent for that layout is lost, so a block that
 * knew it was "6 × 18, rows lettered A-ascending" becomes a plain group of seats. That is the correct
 * trade — the alternative is keeping an arc radius that no longer describes where the seats are.
 */
export async function forgetDocument(layoutId: number, db: Db = pool): Promise<void> {
  await db.query(`UPDATE venue_layouts SET document = NULL WHERE id = $1`, [layoutId]);
}

/**
 * Seats of this layout that a showtime has generated inventory from and that `keep` omits.
 *
 * `showtime_seats.seat_id` has no ON DELETE clause, so dropping such a seat is a foreign-key error,
 * not a silent success. Asked BEFORE the write so the refusal can name the seats (FR-031) instead of
 * surfacing as a bare 500.
 */
export async function boundSeatsMissingFrom(
  layoutId: number,
  keep: number[],
  db: Db = pool,
): Promise<{ id: number; label: string }[]> {
  const { rows } = await db.query<{ id: number; label: string }>(
    `SELECT DISTINCT s.id, s.row_label || s.seat_number::text AS label
       FROM seats s
       JOIN showtime_seats ss ON ss.seat_id = s.id
      WHERE s.layout_id = $1 AND NOT (s.id = ANY($2::bigint[]))
      ORDER BY label
      LIMIT 20`,
    [layoutId, keep],
  );
  return rows;
}

/** Section ids of this layout that have at least one seat — used by the bind-time tier check. */
export async function sectionsWithSeatsInLayout(layoutId: number, db: Db = pool): Promise<number[]> {
  const { rows } = await db.query<{ section_id: number }>(
    `SELECT DISTINCT section_id FROM seats WHERE layout_id = $1 AND section_id IS NOT NULL`,
    [layoutId],
  );
  return rows.map((r) => r.section_id);
}

export type { Layout, LayoutSeat, LayoutSection, LayoutElement };
