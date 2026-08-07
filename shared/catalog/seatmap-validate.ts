// Pre-publish seat-map validation, shared by server and web (Principle VI, research R-11).
//
// The server decides — a client copy only lets the editor highlight problems live, exactly as
// feature 003 treats its socket updates as advisory against the row lock. One implementation so the
// two can never disagree about what "overlapping" means.

/** The coordinate space and seat size these checks assume. Mirrors server config (FR-008). */
export const LAYOUT_SPACE = 10_000;
export const SEAT_DIAMETER = 100;

export type ValidationCode =
  | 'overlapping_seats'
  | 'duplicate_label'
  | 'seat_without_section'
  | 'section_without_tier'
  | 'zero_capacity';

export interface ValidationIssue {
  code: ValidationCode;
  /** Vietnamese, user-facing. */
  message: string;
  /** For `overlapping_seats` this is the PAIR (FR-031). */
  seatIds?: number[];
  sectionIds?: number[];
}

export interface ValidatableSeat {
  id: number;
  sectionId: number | null;
  rowLabel: string;
  seatNumber: number;
  x: number;
  y: number;
}

export interface ValidatableSection {
  id: number;
  name: string;
}

export interface ValidatableLayout {
  seats: ValidatableSeat[];
  sections: ValidatableSection[];
  /** Section ids that have a ticket tier for the showtime being bound. Omit when validating a layout
   *  on its own — a layout alone has no tiers, so the check only runs at bind time (FR-030, T050). */
  sectionsWithTier?: number[];
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
function findOverlaps(seats: ValidatableSeat[]): number[][] {
  const cells = new Map<string, ValidatableSeat[]>();
  const key = (cx: number, cy: number) => `${cx}:${cy}`;

  for (const seat of seats) {
    const k = key(Math.floor(seat.x / SEAT_DIAMETER), Math.floor(seat.y / SEAT_DIAMETER));
    const bucket = cells.get(k);
    if (bucket) bucket.push(seat);
    else cells.set(k, [seat]);
  }

  const threshold = SEAT_DIAMETER * SEAT_DIAMETER;
  const pairs: number[][] = [];
  const seen = new Set<string>();

  for (const seat of seats) {
    const cx = Math.floor(seat.x / SEAT_DIAMETER);
    const cy = Math.floor(seat.y / SEAT_DIAMETER);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const other of cells.get(key(cx + dx, cy + dy)) ?? []) {
          if (other.id === seat.id) continue;
          const pairKey = seat.id < other.id ? `${seat.id}-${other.id}` : `${other.id}-${seat.id}`;
          if (seen.has(pairKey)) continue;
          const ddx = seat.x - other.x;
          const ddy = seat.y - other.y;
          if (ddx * ddx + ddy * ddy < threshold) {
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
  const { seats, sections, sectionsWithTier } = layout;

  if (seats.length === 0) {
    issues.push({ code: 'zero_capacity', message: 'Sơ đồ chưa có ghế nào, không thể phát hành.' });
  }

  for (const [a, b] of findOverlaps(seats)) {
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
  for (const ids of byLabel.values()) {
    if (ids.length > 1) {
      issues.push({ code: 'duplicate_label', message: 'Hai ghế trùng nhãn trong cùng một khu vực.', seatIds: ids });
    }
  }

  const sectionless = seats.filter((s) => s.sectionId === null).map((s) => s.id);
  if (sectionless.length > 0) {
    issues.push({
      code: 'seat_without_section',
      message: 'Có ghế chưa thuộc khu vực nào.',
      seatIds: sectionless,
    });
  }

  // Only checkable at bind time: a layout on its own has no tiers (T050).
  if (sectionsWithTier) {
    const tiered = new Set(sectionsWithTier);
    const occupied = new Set(seats.map((s) => s.sectionId).filter((id): id is number => id !== null));
    const untiered = sections.filter((s) => occupied.has(s.id) && !tiered.has(s.id)).map((s) => s.id);
    if (untiered.length > 0) {
      issues.push({
        code: 'section_without_tier',
        message: 'Mỗi khu vực có ghế phải được gán một hạng vé.',
        sectionIds: untiered,
      });
    }
  }

  return issues;
}

/** Clamp a coordinate into the space; a stored position is always in range (FR-014). */
export const clampCoord = (v: number): number => Math.max(0, Math.min(LAYOUT_SPACE, Math.round(v)));

/** Normalise a rotation into 0–359 rather than refusing it (FR-014). */
export const normaliseRotation = (deg: number): number => ((Math.round(deg) % 360) + 360) % 360;
