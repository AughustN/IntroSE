// Pre-publish seat-map validation, shared by server and web (Principle VI, research R-11).
//
// The server decides — a client copy only lets the editor highlight problems live, exactly as
// feature 003 treats its socket updates as advisory against the row lock. One implementation so the
// two can never disagree about what "overlapping" means.

/** The coordinate space and seat size these checks assume. Mirrors server config (FR-008). */
export const LAYOUT_SPACE = 10_000;
export const SEAT_DIAMETER = 100;
/**
 * Seats per layout (FR-007). Mirrors server config the same way the two constants above do — the
 * SERVER is authoritative and refuses a save past it with `409 seat_limit_reached`; this copy exists
 * so the editor can stop a single drag from building a draft that could never be saved.
 */
export const LAYOUT_MAX_SEATS = 2_000;

export type ValidationCode =
  | 'overlapping_seats'
  | 'duplicate_label'
  | 'seat_without_section'
  | 'zero_capacity'
  // Added by the hall-scheme amendment (FR-072..FR-075). Reported in the SAME single pass — there is
  // one validate/publish gate, not two.
  | 'seats_outside_boundary'
  | 'icon_without_position'
  // Categories. `category_without_tier` replaces the old `section_without_tier`: the thing an event
  // prices is now the class, not the place. `section_without_color` is gone — colour moved to the
  // category, where the column is NOT NULL, so there is nothing left to check at publish time.
  | 'seat_without_category'
  | 'category_without_tier'
  // Capacity zones (0027). A zone is an `area` that carries a capacity AND a price class, and is sold
  // by count against that class's tier rather than as seat rows.
  | 'zone_without_category'
  | 'category_mixed_inventory';

export interface ValidationIssue {
  code: ValidationCode;
  /** Vietnamese, user-facing. */
  message: string;
  /** For `overlapping_seats` this is the PAIR (FR-031). */
  seatIds?: number[];
  sectionIds?: number[];
  categoryIds?: number[];
}

export interface ValidatableSeat {
  id: number;
  sectionId: number | null;
  categoryId?: number | null;
  rowLabel: string;
  seatNumber: number;
  x: number;
  y: number;
}

export interface ValidatableSection {
  id: number;
  name: string;
  /** Editor-only colour, and no longer a publish requirement — see `ValidatableCategory`. */
  color?: string | null;
  /** Scales the nominal diameter; 1.0 = today's rendering (FR-065). */
  seatSizeMultiplier?: number;
}

export interface ValidatableCategory {
  id: number;
  name: string;
}

/** A shape or icon, for the two geometry checks the amendment adds. */
export interface ValidatableElement {
  kind: string;
  x?: number | null;
  y?: number | null;
  points?: { x: number; y: number }[] | null;
  /** `area` only — see `LayoutElement`. A capacity with a category is a zone sold by count. */
  capacity?: number | null;
  categoryId?: number | null;
}

export const SEAT_SIZE_MIN = 0.5;
export const SEAT_SIZE_MAX = 2.0;

/**
 * A seat's drawn diameter (FR-065). The overlap test uses this rather than the constant, so a section
 * that scales its seats up cannot draw them visibly on top of each other while validation calls the
 * layout clean. Default 1.0 reproduces today's rule exactly.
 */
export function effectiveDiameter(multiplier: number | undefined): number {
  const m = Math.min(SEAT_SIZE_MAX, Math.max(SEAT_SIZE_MIN, multiplier ?? 1));
  return SEAT_DIAMETER * m;
}

/** Even-odd ray cast. Used only to report seats a drawn boundary leaves outside (FR-073). */
export function pointInPolygon(pt: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const intersects =
      poly[i].y > pt.y !== poly[j].y > pt.y &&
      pt.x < ((poly[j].x - poly[i].x) * (pt.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export interface ValidatableLayout {
  seats: ValidatableSeat[];
  sections: ValidatableSection[];
  categories?: ValidatableCategory[];
  /** Category ids that have a ticket tier for the showtime being bound. Omit when validating a layout
   *  on its own — a layout alone has no tiers, so the check only runs at bind time (FR-030, T050). */
  categoriesWithTier?: number[];
  /** Shapes and facility icons, for the two geometry checks the amendment adds (FR-073, FR-074). */
  elements?: ValidatableElement[];
}

/**
 * Two seats overlap when the distance between their centres is LESS THAN one nominal seat diameter.
 * Touching is not overlapping, so a tight but legitimate theatre row stays publishable.
 *
 * Compared as squared distances so there is no `sqrt` and no floating-point drift — with integer
 * coordinates the same layout validates identically on every machine. Rotation never enters this:
 * it turns how a seat is drawn, not its footprint (FR-030a).
 *
 * Seats are bucketed into diameter-sized grid cells and each is compared only against its 3×3
 * neighbourhood, so this stays O(n) at the 2,000-seat ceiling instead of the 2M pairs a naive scan
 * would walk (research R-3).
 */
function findOverlaps(seats: ValidatableSeat[], sizeOf: (s: ValidatableSeat) => number): number[][] {
  const cells = new Map<string, ValidatableSeat[]>();
  const key = (cx: number, cy: number) => `${cx}:${cy}`;

  // Bucket by the LARGEST drawn seat, so the 3×3 neighbourhood still catches every possible pair
  // once sections may scale their seats up (R-16). Bounded at 2.0×, that is at most a 2× sweep.
  const cell = Math.max(SEAT_DIAMETER, ...seats.map(sizeOf));

  for (const seat of seats) {
    const k = key(Math.floor(seat.x / cell), Math.floor(seat.y / cell));
    const bucket = cells.get(k);
    if (bucket) bucket.push(seat);
    else cells.set(k, [seat]);
  }

  const pairs: number[][] = [];
  const seen = new Set<string>();

  for (const seat of seats) {
    const cx = Math.floor(seat.x / cell);
    const cy = Math.floor(seat.y / cell);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const other of cells.get(key(cx + dx, cy + dy)) ?? []) {
          if (other.id === seat.id) continue;
          const pairKey = seat.id < other.id ? `${seat.id}-${other.id}` : `${other.id}-${seat.id}`;
          if (seen.has(pairKey)) continue;
          const ddx = seat.x - other.x;
          const ddy = seat.y - other.y;
          // Two seats overlap when their centres are closer than the LARGER of the two drawn sizes.
          const reach = Math.max(sizeOf(seat), sizeOf(other));
          if (ddx * ddx + ddy * ddy < reach * reach) {
            seen.add(pairKey);
            pairs.push([seat.id, other.id]);
          }
        }
      }
    }
  }
  return pairs;
}

/** Every problem present, in one pass, each naming the seats or sections at fault (FR-030, FR-031). */
export function validateLayout(layout: ValidatableLayout): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { seats, sections, categories, categoriesWithTier, elements } = layout;

  // A seat's drawn size comes from its section's multiplier (FR-065).
  const multiplierOf = new Map(sections.map((sec) => [sec.id, sec.seatSizeMultiplier]));
  const sizeOf = (s: ValidatableSeat) =>
    effectiveDiameter(s.sectionId === null ? 1 : multiplierOf.get(s.sectionId));

  // A zone holds people without holding seats, so "empty" now means neither. Counting only seats
  // would make a standing-only venue permanently unpublishable.
  const zones = (elements ?? []).filter((el) => el.kind === 'area' && (el.capacity ?? 0) > 0);
  if (seats.length === 0 && zones.length === 0) {
    issues.push({
      code: 'zero_capacity',
      message: 'Sơ đồ chưa có ghế hay khu sức chứa nào, không thể phát hành.',
    });
  }

  for (const [a, b] of findOverlaps(seats, sizeOf)) {
    issues.push({
      code: 'overlapping_seats',
      message: 'Hai ghế đang nằm chồng lên nhau.',
      seatIds: [a, b],
    });
  }

  // Duplicate label WITHIN a section — the same label in two different sections is legitimate and is
  // exactly what the per-section uniqueness change enables (FR-003).
  const byLabel = new Map<string, number[]>();
  for (const seat of seats) {
    const k = `${seat.sectionId ?? 'none'}|${seat.rowLabel}|${seat.seatNumber}`;
    const ids = byLabel.get(k);
    if (ids) ids.push(seat.id);
    else byLabel.set(k, [seat.id]);
  }
  // Reported ONCE per section rather than once per colliding pair, and naming the labels. Two blocks
  // overlapping by five rows of ten produced fifty identical messages saying only "two seats share a
  // label", which told the organizer neither which seats nor what to change.
  const collisionsBySection = new Map<string, { labels: string[]; ids: number[] }>();
  for (const [k, ids] of byLabel) {
    if (ids.length < 2) continue;
    const [section, row, number] = k.split('|');
    const entry = collisionsBySection.get(section) ?? { labels: [], ids: [] };
    entry.labels.push(`${row}${number}`);
    entry.ids.push(...ids);
    collisionsBySection.set(section, entry);
  }
  for (const [section, { labels, ids }] of collisionsBySection) {
    const name = section === 'none' ? null : sections.find((sec) => String(sec.id) === section)?.name;
    const shown = labels.slice(0, 5).join(', ');
    const more = labels.length > 5 ? ` và ${labels.length - 5} nhãn nữa` : '';
    issues.push({
      code: 'duplicate_label',
      message:
        `${name ? `Khu "${name}"` : 'Ghế chưa thuộc khu nào'} có ${labels.length} nhãn bị trùng ` +
        `(${shown}${more}). Hai khối đang dùng chung nhãn hàng — đổi nhãn hàng hoặc số ghế bắt đầu của một khối.`,
      seatIds: ids,
    });
  }

  const sectionless = seats.filter((s) => s.sectionId === null).map((s) => s.id);
  if (sectionless.length > 0) {
    issues.push({
      code: 'seat_without_section',
      message: 'Có ghế chưa thuộc khu vực nào.',
      seatIds: sectionless,
    });
  }

  // A seat with no class cannot be priced, so it cannot be sold. Same shape of rule as the missing
  // section above, and permissive in the same way: a draft may hold unclassified seats while drawing.
  const uncategorised = seats.filter((s) => s.categoryId === null || s.categoryId === undefined).map((s) => s.id);
  if (uncategorised.length > 0) {
    issues.push({
      code: 'seat_without_category',
      message: 'Có ghế chưa thuộc hạng ghế nào.',
      seatIds: uncategorised,
    });
  }

  // A zone with a capacity but no price class cannot be priced, so it cannot be sold — and unlike a
  // sectionless seat it would not even show up as inventory. Caught here rather than at bind time
  // because it is a property of the chart alone.
  const namelessZones = zones.filter((z) => z.categoryId === null || z.categoryId === undefined);
  if (namelessZones.length > 0) {
    issues.push({
      code: 'zone_without_category',
      message: `${namelessZones.length} khu sức chứa chưa có hạng ghế — chọn hạng ghế hoặc xoá khu.`,
    });
  }

  // A price class is sold EITHER as seats or as capacity, never both: generation would have to make
  // the class's tier both seat-gated (quantity NULL) and count-gated at once, and whichever won, the
  // other half of the class would silently stop being sellable.
  const seatCategories = new Set(
    seats.map((s) => s.categoryId).filter((id): id is number => id !== null && id !== undefined),
  );
  const zoneCategories = new Set(
    zones.map((z) => z.categoryId).filter((id): id is number => id !== null && id !== undefined),
  );
  const mixed = [...zoneCategories].filter((id) => seatCategories.has(id));
  if (mixed.length > 0) {
    const names = (categories ?? []).filter((c) => mixed.includes(c.id)).map((c) => c.name);
    issues.push({
      code: 'category_mixed_inventory',
      message: `Hạng ghế "${names.join('", "')}" vừa có ghế vừa có khu sức chứa — tách thành hai hạng riêng.`,
      categoryIds: mixed,
    });
  }

  // Only checkable at bind time: a layout on its own has no tiers (T050).
  if (categoriesWithTier) {
    const tiered = new Set(categoriesWithTier);
    // A zone's class needs a price just as much as a seat's does.
    const occupied = new Set([...seatCategories, ...zoneCategories]);
    const untiered = (categories ?? []).filter((c) => occupied.has(c.id) && !tiered.has(c.id));
    if (untiered.length > 0) {
      issues.push({
        code: 'category_without_tier',
        message: `Hạng ghế "${untiered.map((c) => c.name).join('", "')}" chưa có giá vé cho suất diễn này.`,
        categoryIds: untiered.map((c) => c.id),
      });
    }
  }

  // ---- hall-scheme amendment: two more checks, same single pass (FR-073, FR-074) ----

  for (const el of elements ?? []) {
    const isShape = el.kind === 'boundary' || el.kind === 'divider';
    if (isShape) continue;
    if (el.x === null || el.x === undefined || el.y === null || el.y === undefined) {
      issues.push({ code: 'icon_without_position', message: `Biểu tượng "${el.kind}" chưa có vị trí.` });
    }
  }

  // A drawn hall outline that leaves seats outside it is a map that misleads the buyer. Only the
  // FIRST boundary is authoritative — two outlines is a drafting artefact, not two halls.
  const boundary = (elements ?? []).find((e) => e.kind === 'boundary' && (e.points?.length ?? 0) >= 3);
  if (boundary?.points) {
    const outside = seats.filter((s) => !pointInPolygon({ x: s.x, y: s.y }, boundary.points!)).map((s) => s.id);
    if (outside.length > 0) {
      issues.push({
        code: 'seats_outside_boundary',
        message: `${outside.length} ghế nằm ngoài đường bao của sảnh.`,
        seatIds: outside,
      });
    }
  }

  return issues;
}

/** Clamp a coordinate into the space; a stored position is always in range (FR-014). */
export const clampCoord = (v: number): number => Math.max(0, Math.min(LAYOUT_SPACE, Math.round(v)));

/** Normalise a rotation into 0–359 rather than refusing it (FR-014). */
export const normaliseRotation = (deg: number): number => ((Math.round(deg) % 360) + 360) % 360;
