import type {
  Layout,
  LayoutElement,
  LayoutSeat,
  LayoutSection,
  LayoutSummary,
  SaveLayoutRequest,
} from '@shared/catalog/seatmap.js';
import { clampCoord, normaliseRotation } from '@shared/catalog/seatmap-validate.js';
import { SEAT_DIAMETER } from '../../config.js';
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
  }>(`SELECT * FROM venue_layouts WHERE id = $1`, [layoutId]);
  const l = head.rows[0];
  if (!l) return null;

  const [sections, seats, elements] = await Promise.all([
    db.query<{ id: number; name: string; description: string | null }>(
      `SELECT id, name, description FROM sections WHERE layout_id = $1 ORDER BY name`,
      [layoutId],
    ),
    db.query<{
      id: number;
      section_id: number | null;
      row_label: string;
      seat_number: number;
      seat_type: 'single' | 'double' | 'standing';
      pos_x: number;
      pos_y: number;
      rotation: number;
    }>(
      `SELECT id, section_id, row_label, seat_number, seat_type, pos_x, pos_y, rotation
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
    }>(`SELECT id, kind, pos_x, pos_y, width, height, rotation, label FROM layout_elements WHERE layout_id = $1 ORDER BY id`, [
      layoutId,
    ]),
  ]);

  return {
    id: l.id,
    venueId: l.venue_id,
    name: l.name,
    status: l.status,
    isTemplate: l.is_template,
    version: l.version,
    sections: sections.rows.map((s) => ({ id: s.id, name: s.name, description: s.description })),
    seats: seats.rows.map((s) => ({
      id: s.id,
      sectionId: s.section_id,
      rowLabel: s.row_label,
      seatNumber: s.seat_number,
      seatType: s.seat_type,
      x: s.pos_x,
      y: s.pos_y,
      rotation: s.rotation,
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
    })),
    floorPlan: {
      url: l.background_url,
      scale: Math.round(Number(l.background_scale) * 1000),
      offsetX: l.background_offset_x,
      offsetY: l.background_offset_y,
      opacity: Math.round(Number(l.background_opacity) * 100),
      visibleToBuyers: l.background_public,
    },
  };
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
    for (const s of body.sections) {
      if (s.id) {
        await client.query(`UPDATE sections SET name = $2, description = $3 WHERE id = $1 AND layout_id = $4`, [
          s.id,
          s.name,
          s.description ?? null,
          layoutId,
        ]);
        keptSections.push(s.id);
        sectionIdMap.set(s.id, s.id);
      } else {
        const { rows } = await client.query<{ id: number }>(
          `INSERT INTO sections (layout_id, name, description) VALUES ($1, $2, $3) RETURNING id`,
          [layoutId, s.name, s.description ?? null],
        );
        keptSections.push(rows[0].id);
      }
    }
    await client.query(
      `DELETE FROM sections WHERE layout_id = $1 AND NOT (id = ANY($2::bigint[]))`,
      [layoutId, keptSections],
    );

    // --- seats
    const keptSeats: number[] = [];
    for (const seat of body.seats) {
      const x = clampCoord(seat.x);
      const y = clampCoord(seat.y);
      const rot = normaliseRotation(seat.rotation);
      const sectionId = resolveSection(seat.sectionId, sectionIdMap, keptSections);
      if (seat.id) {
        await client.query(
          `UPDATE seats SET section_id = $2, row_label = $3, seat_number = $4, seat_type = $5,
                            pos_x = $6, pos_y = $7, rotation = $8
             WHERE id = $1 AND layout_id = $9`,
          [seat.id, sectionId, seat.rowLabel, seat.seatNumber, seat.seatType, x, y, rot, layoutId],
        );
        keptSeats.push(seat.id);
      } else {
        const { rows } = await client.query<{ id: number }>(
          `INSERT INTO seats (layout_id, section_id, row_label, seat_number, seat_type, pos_x, pos_y, rotation)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [layoutId, sectionId, seat.rowLabel, seat.seatNumber, seat.seatType, x, y, rot],
        );
        keptSeats.push(rows[0].id);
      }
    }
    // A seat that a showtime already generated from is NOT deleted here — the showtime owns a
    // snapshot, so removing the layout seat is safe and never touches inventory (FR-005).
    await client.query(`DELETE FROM seats WHERE layout_id = $1 AND NOT (id = ANY($2::bigint[]))`, [layoutId, keptSeats]);

    // --- elements: replaced wholesale, they carry no identity anything else points at.
    await client.query(`DELETE FROM layout_elements WHERE layout_id = $1`, [layoutId]);
    for (const e of body.elements) {
      await client.query(
        `INSERT INTO layout_elements (layout_id, kind, pos_x, pos_y, width, height, rotation, label)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [layoutId, e.kind, clampCoord(e.x), clampCoord(e.y), e.width, e.height, normaliseRotation(e.rotation), e.label],
      );
    }

    await client.query(`UPDATE venue_layouts SET version = version + 1, updated_at = now() WHERE id = $1`, [layoutId]);
    return getLayout(layoutId, client);
  });
}

/** A client may reference a section it just created by a negative placeholder id; anything unknown
 *  becomes null (sectionless), which validation reports rather than silently dropping the seat. */
function resolveSection(
  sectionId: number | null,
  map: Map<number, number>,
  kept: number[],
): number | null {
  if (sectionId === null) return null;
  const mapped = map.get(sectionId);
  if (mapped) return mapped;
  return kept.includes(sectionId) ? sectionId : null;
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
      `INSERT INTO seats (layout_id, section_id, row_label, seat_number, seat_type, pos_x, pos_y, rotation)
       SELECT $1, $2, $3, gs, 'single',
              LEAST(10000, $4::int + (gs - 1) * $5::int), $6, 0
         FROM generate_series(1, $7) AS gs
       ON CONFLICT (section_id, row_label, seat_number) DO NOTHING`,
      [layoutId, sectionId, rowLabel, startX, spacing, y, count],
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
         INSERT INTO sections (layout_id, name, description)
         SELECT $2, name, description FROM sections WHERE layout_id = $1 ORDER BY id
         RETURNING id, name
       )
       SELECT s.id AS old_id, ins.id AS new_id
         FROM sections s JOIN ins ON ins.name = s.name
        WHERE s.layout_id = $1`,
      [sourceId, newId],
    );
    const map = new Map(sections.map((r) => [r.old_id, r.new_id]));

    const { rows: seats } = await client.query<{
      section_id: number | null;
      row_label: string;
      seat_number: number;
      seat_type: string;
      pos_x: number;
      pos_y: number;
      rotation: number;
    }>(`SELECT section_id, row_label, seat_number, seat_type, pos_x, pos_y, rotation FROM seats WHERE layout_id = $1`, [
      sourceId,
    ]);
    for (const s of seats) {
      await client.query(
        `INSERT INTO seats (layout_id, section_id, row_label, seat_number, seat_type, pos_x, pos_y, rotation)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [newId, s.section_id === null ? null : (map.get(s.section_id) ?? null), s.row_label, s.seat_number, s.seat_type, s.pos_x, s.pos_y, s.rotation],
      );
    }

    await client.query(
      `INSERT INTO layout_elements (layout_id, kind, pos_x, pos_y, width, height, rotation, label)
       SELECT $2, kind, pos_x, pos_y, width, height, rotation, label FROM layout_elements WHERE layout_id = $1`,
      [sourceId, newId],
    );

    return newId;
  });
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
