// Pre-publish seat-map validation, shared by server and web (Principle VI, research R-11).
//
// The server decides — a client copy only lets the editor highlight problems live, exactly as
// feature 003 treats its socket updates as advisory against the row lock. One implementation so the
// two can never disagree about what "overlapping" means.

/**
 * The coordinate space and seat size these checks assume. Mirrors server config (FR-008).
 *
 * Widened from 10,000 to 30,000: at the old size an organizer laying a room out left-to-right ran
 * into the wall while most of the square went unused, and `allowedDelta` stops a drag AT that wall
 * by design (letting it through stacks seats on the boundary). Nine times the area removes the
 * squeeze without changing what a unit means — the nominal seat is still 100 units, so spacing,
 * overlap detection and every saved coordinate keep their meaning.
 *
 * Widening is backwards-compatible in the direction that matters: every coordinate already stored
 * is ≤ 10,000 and so is still in range, and the buyer's map never reads this — `SeatCanvas` renders
 * a buyer view with `fitContent`, which frames the seats themselves and ignores the space. Only the
 * editor, which pins its viewBox to the space, sees the difference.
 *
 * Still square, and still bounded. A rectangle would need `clampCoord` split per axis across ~65
 * call sites where nothing but care distinguishes an x from a y, and unbounded would hand the
 * buyer's content-fitting renderer an outlier that shrinks a whole chart to a dot.
 *
 * NOTE what this constant now is and is not. It is the FRAME — the working area the editor pins its
 * viewBox to, the size the buyer's `space` reports, the box a floor plan is scaled into. It is NOT
 * the wall; see `LAYOUT_MIN`/`LAYOUT_MAX` below.
 */
export const LAYOUT_SPACE = 30_000;

/**
 * The wall: how far a coordinate may actually go.
 *
 * Split from `LAYOUT_SPACE` because that one constant was quietly doing two jobs — "the area the
 * editor frames" and "the furthest a block may be dragged" — and they want different answers. Tying
 * them together meant the wall sat exactly at the edge of the view, so the boundary was on screen
 * whenever the organizer zoomed out, and every drag toward an edge ended in a stop they could see
 * coming but could do nothing about.
 *
 * One frame of slack in every direction (3× the span, 9× the area). Chosen against the measured
 * worst case rather than picked round: at the furthest the editor can zoom out the visible rectangle
 * runs about -14,800..44,800, so walls at -30,000 and 60,000 are outside the view at every zoom the
 * editor can reach. The organizer meets the wall only by deliberately panning to it.
 *
 * Negative coordinates are now legal, which is what buys the slack on the top and left. Every
 * coordinate ever stored is 0..30,000 and stays valid — this only widens the range, in both
 * directions, so no row can fail the new check that passed the old one.
 *
 * Still bounded, and deliberately. `contentBounds` frames the buyer's map from the extreme points of
 * its own content, so ONE block dragged far enough shrinks a whole chart to a dot — the wall is what
 * caps that blast radius. Moving it out trades a little of that safety for room; removing it
 * altogether would trade all of it.
 */
export const LAYOUT_MIN = -30_000;
export const LAYOUT_MAX = 60_000;

export const SEAT_DIAMETER = 100;
/**
 * Seats per layout (FR-007). Mirrors server config the same way the two constants above do — the
 * SERVER is authoritative and refuses a save past it with `409 seat_limit_reached`; this copy exists
 * so the editor can stop a single drag from building a draft that could never be saved.
 */
export const LAYOUT_MAX_SEATS = 10_000;

export type ValidationCode =
  | "overlapping_seats"
  | "duplicate_label"
  | "seat_without_section"
  | "zero_capacity"
  // Added by the hall-scheme amendment (FR-072..FR-075). Reported in the SAME single pass — there is
  // one validate/publish gate, not two.
  | "seats_outside_boundary"
  | "icon_without_position"
  // Categories. `category_without_tier` replaces the old `section_without_tier`: the thing an event
  // prices is now the class, not the place. `section_without_color` is gone — colour moved to the
  // category, where the column is NOT NULL, so there is nothing left to check at publish time.
  | "seat_without_category"
  | "category_without_tier"
  // Capacity zones (0027). A zone is an `area` that carries a capacity AND a price class, and is sold
  // by count against that class's tier rather than as seat rows.
  | "zone_without_category"
  | "category_mixed_inventory"
  | "zone_over_seats"
  // Advisory, NOT a publish blocker — see `severity` below.
  | "focal_point_unset"
  // Companion seats (0036). `companion_wrong_target` blocks — a pairing that names nothing or
  // names a non-wheelchair seat is data the apply/generation path cannot honour; the advisory
  // half is `accessible_without_companion` — a wheelchair seat with nothing pointing at it.
  | "companion_wrong_target"
  | "accessible_without_companion";

export interface ValidationIssue {
  code: ValidationCode;
  /**
   * Whether this issue REFUSES the publish, or merely tells the organizer something they cannot
   * otherwise see.
   *
   * Absent means `'error'`. Every check written before this field was a blocker, and an issue
   * constructed without a thought about severity should keep blocking — the safe direction is to
   * refuse a publish that should have gone through, not to allow one that should not have.
   *
   * `'warning'` exists for a specific shape of problem: the layout is publishable and will sell
   * tickets, but something about it will behave in a way the organizer did not choose and cannot
   * observe. `focal_point_unset` is the first of those.
   */
  severity?: "error" | "warning";
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
  /**
   * 0036 companion checks. Both are read from the SAME normalized row: the ordinary seat names the
   * accessible one it accompanies, and the accessible seat must have at least one seat pointing at
   * it. `isAccessible` is not used elsewhere in this module.
   */
  isAccessible?: boolean;
  companionSeatId?: number | null;
}

export interface ValidatableSection {
  id: number;
  name: string;
  /** The level this section is on (0044). Null or absent is the single implicit floor. */
  floorId?: number | null;
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
  /**
   * The box the element is drawn as, around the CENTRE `x`/`y` — the origin convention every
   * non-seat-bearing element uses. Needed by `zone_over_seats`, which has to know a zone's extent to
   * ask what stands inside it, and a zone drawn as a plain rectangle carries no `points`.
   */
  width?: number | null;
  height?: number | null;
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

/**
 * Is a point inside the shape an element is DRAWN as?
 *
 * Its polygon when it has one, otherwise the box its width and height describe around its centre —
 * the two shapes the renderer draws, so what the organizer sees enclosed is what this reports as
 * enclosed. An element with neither encloses nothing, rather than defaulting to everything.
 */
export function withinElement(
  pt: { x: number; y: number },
  el: Pick<ValidatableElement, "x" | "y" | "points" | "width" | "height">,
): boolean {
  if ((el.points?.length ?? 0) >= 3) return pointInPolygon(pt, el.points!);
  const { x, y, width, height } = el;
  if (x === null || x === undefined || y === null || y === undefined) return false;
  if (!width || !height) return false;
  return Math.abs(pt.x - x) <= width / 2 && Math.abs(pt.y - y) <= height / 2;
}

/** Even-odd ray cast. Used only to report seats a drawn boundary leaves outside (FR-073). */
export function pointInPolygon(
  pt: { x: number; y: number },
  poly: { x: number; y: number }[],
): boolean {
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
  /**
   * The chart's stated focal point (0043), when it has one.
   *
   * Only `focal_point_unset` reads it, and only to stay quiet: that warning exists to say the
   * best-available ranking is being INFERRED, so a chart that states the answer has nothing to be
   * warned about.
   */
  focalPoint?: { x: number; y: number } | null;
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
function findOverlaps(
  seats: ValidatableSeat[],
  sizeOf: (s: ValidatableSeat) => number,
  /**
   * Which LEVEL a seat is on, via its section (0044). Two seats one storey apart share a point on
   * the plan and share nothing in the room — a balcony sits directly above the stalls, which is where
   * a balcony physically is. Without this every seat of a stacked upper tier reported
   * `overlapping_seats` and the chart could never be published.
   *
   * Null (no floor, or no section) is the single implicit floor, so a chart with no levels — every
   * chart drawn before 0044 — buckets exactly as it always did.
   */
  floorOf: (s: ValidatableSeat) => number | null = () => null,
): number[][] {
  const cells = new Map<string, ValidatableSeat[]>();
  // The floor is part of the bucket key rather than a post-check: seats on other levels never enter
  // the 3x3 neighbourhood at all, so a tall venue does not pay for levels it is not comparing.
  const key = (cx: number, cy: number, floor: number | null) => `${floor ?? "-"}:${cx}:${cy}`;

  // Bucket by the LARGEST drawn seat, so the 3×3 neighbourhood still catches every possible pair
  // once sections may scale their seats up (R-16). Bounded at 2.0×, that is at most a 2× sweep.
  const cell = Math.max(SEAT_DIAMETER, ...seats.map(sizeOf));

  for (const seat of seats) {
    const k = key(Math.floor(seat.x / cell), Math.floor(seat.y / cell), floorOf(seat));
    const bucket = cells.get(k);
    if (bucket) bucket.push(seat);
    else cells.set(k, [seat]);
  }

  const pairs: number[][] = [];
  const seen = new Set<string>();

  for (const seat of seats) {
    const cx = Math.floor(seat.x / cell);
    const cy = Math.floor(seat.y / cell);
    const floor = floorOf(seat);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const other of cells.get(key(cx + dx, cy + dy, floor)) ?? []) {
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
  const { seats, sections, categories, categoriesWithTier, elements, focalPoint } = layout;

  // A seat's drawn size comes from its section's multiplier (FR-065).
  const multiplierOf = new Map(sections.map((sec) => [sec.id, sec.seatSizeMultiplier]));
  const sizeOf = (s: ValidatableSeat) =>
    effectiveDiameter(s.sectionId === null ? 1 : multiplierOf.get(s.sectionId));

  // A zone holds people without holding seats, so "empty" now means neither. Counting only seats
  // would make a standing-only venue permanently unpublishable.
  const zones = (elements ?? []).filter((el) => el.kind === "area" && (el.capacity ?? 0) > 0);
  if (seats.length === 0 && zones.length === 0) {
    issues.push({
      code: "zero_capacity",
      message: "Sơ đồ chưa có ghế hay khu sức chứa nào, không thể phát hành.",
    });
  }

  // A seat reaches its level the same way it reaches its drawn size: through its section.
  const floorOfSection = new Map(sections.map((sec) => [sec.id, sec.floorId ?? null]));
  const floorOf = (s: ValidatableSeat) =>
    s.sectionId === null ? null : (floorOfSection.get(s.sectionId) ?? null);

  for (const [a, b] of findOverlaps(seats, sizeOf, floorOf)) {
    issues.push({
      code: "overlapping_seats",
      message: "Hai ghế đang nằm chồng lên nhau.",
      seatIds: [a, b],
    });
  }

  // Duplicate label WITHIN a section — the same label in two different sections is legitimate and is
  // exactly what the per-section uniqueness change enables (FR-003).
  const byLabel = new Map<string, number[]>();
  for (const seat of seats) {
    const k = `${seat.sectionId ?? "none"}|${seat.rowLabel}|${seat.seatNumber}`;
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
    const [section, row, number] = k.split("|");
    const entry = collisionsBySection.get(section) ?? { labels: [], ids: [] };
    entry.labels.push(`${row}${number}`);
    entry.ids.push(...ids);
    collisionsBySection.set(section, entry);
  }
  for (const [section, { labels, ids }] of collisionsBySection) {
    const name =
      section === "none" ? null : sections.find((sec) => String(sec.id) === section)?.name;
    const shown = labels.slice(0, 5).join(", ");
    const more = labels.length > 5 ? ` và ${labels.length - 5} nhãn nữa` : "";
    issues.push({
      code: "duplicate_label",
      message:
        `${name ? `Khu "${name}"` : "Ghế chưa thuộc khu nào"} có ${labels.length} nhãn bị trùng ` +
        `(${shown}${more}). Hai khối đang dùng chung nhãn hàng — đổi nhãn hàng hoặc số ghế bắt đầu của một khối.`,
      seatIds: ids,
    });
  }

  const sectionless = seats.filter((s) => s.sectionId === null).map((s) => s.id);
  if (sectionless.length > 0) {
    issues.push({
      code: "seat_without_section",
      message: "Có ghế chưa thuộc khu vực nào.",
      seatIds: sectionless,
    });
  }

  // A seat with no class cannot be priced, so it cannot be sold. Same shape of rule as the missing
  // section above, and permissive in the same way: a draft may hold unclassified seats while drawing.
  const uncategorised = seats
    .filter((s) => s.categoryId === null || s.categoryId === undefined)
    .map((s) => s.id);
  if (uncategorised.length > 0) {
    issues.push({
      code: "seat_without_category",
      message: "Có ghế chưa thuộc hạng ghế nào.",
      seatIds: uncategorised,
    });
  }

  // A zone with a capacity but no price class cannot be priced, so it cannot be sold — and unlike a
  // sectionless seat it would not even show up as inventory. Caught here rather than at bind time
  // because it is a property of the chart alone.
  const namelessZones = zones.filter((z) => z.categoryId === null || z.categoryId === undefined);
  if (namelessZones.length > 0) {
    issues.push({
      code: "zone_without_category",
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
      code: "category_mixed_inventory",
      message: `Hạng ghế "${names.join('", "')}" vừa có ghế vừa có khu sức chứa — tách thành hai hạng riêng.`,
      categoryIds: mixed,
    });
  }

  /*
   * A capacity zone drawn ON TOP of seats sells the same floor twice.
   *
   * The check above compares price CLASSES, and two classes can describe one physical space: a zone
   * of 300 laid over a block of 20 seats names a different class, so it passes, publishes, and
   * generates 320 sellable tickets for a floor that holds 20 — the zone's capacity becomes its tier's
   * quantity while every seat under it stays its own row. Geometry is what makes them the same place,
   * so geometry is what has to be tested.
   *
   * Blocking, and deliberately so: this is the double-booking a chart validator exists to catch, and
   * it is invisible on the canvas — the zone is drawn over the seats it duplicates.
   */
  const smothered = new Set<number>();
  let smotheringZones = 0;
  for (const zone of zones) {
    const under = seats.filter((s) => withinElement({ x: s.x, y: s.y }, zone));
    if (under.length === 0) continue;
    smotheringZones += 1;
    for (const s of under) smothered.add(s.id);
  }
  if (smothered.size > 0) {
    issues.push({
      code: "zone_over_seats",
      message: `${smotheringZones} khu sức chứa nằm chồng lên ${smothered.size} ghế — cùng một chỗ sẽ bị bán hai lần. Hãy xoá ghế bên dưới, hoặc bỏ sức chứa của khu.`,
      seatIds: [...smothered],
    });
  }

  // ---- Companion seats (0036) ----------------------------------------------------------------
  //
  // The pairing is an authoring intent with a hard structural rule: an ordinary seat may name the
  // ACCESSIBLE seat it accompanies, and that is the whole contract. A pointer into nothing, a
  // pointer into a non-wheelchair seat, or two pointers into one wheelchair seat is a pairing the
  // apply/generation path cannot honour — because at bind time the map is built seat-by-seat from
  // exactly these rows, and a broken pointer would silently sell a "companion" as a solo seat.
  //
  // The advisory half is deliberately NOT blocking: a wheelchair seat with no companion yet is a
  // legitimate work-in-progress state (the organizer has marked the seat but not yet paired it),
  // and the organizer needs to be able to see the chart to fix it.

  const seatById = new Map(seats.map((s) => [s.id, s]));

  // At most one seat may name each accessible seat — two companions on one wheelchair seat is a
  // data contradiction, and letting one win arbitrarily would sell the other as a stranger.
  const claimCount = new Map<number, number>();
  for (const s of seats) {
    const target = s.companionSeatId;
    if (target === null || target === undefined) continue;
    claimCount.set(target, (claimCount.get(target) ?? 0) + 1);
  }

  for (const s of seats) {
    const target = s.companionSeatId;
    if (target === null || target === undefined) continue;
    const via = seatById.get(target);
    if (!via) {
      issues.push({
        code: "companion_wrong_target",
        message: "Ghế đi kèm đang trỏ tới một ghế không có trong sơ đồ.",
        seatIds: [s.id],
      });
      continue;
    }
    if ((claimCount.get(target) ?? 0) > 1) {
      issues.push({
        code: "companion_wrong_target",
        message: `Hai ghế đang cùng nhận đi kèm với ghế xe lăn ${via.rowLabel}${via.seatNumber}.`,
        seatIds: [s.id],
      });
      continue;
    }
    if (!via.isAccessible) {
      issues.push({
        code: "companion_wrong_target",
        message: `Ghế ${s.rowLabel}${s.seatNumber} muốn đi kèm với ghế không phải ghế xe lăn.`,
        seatIds: [s.id, target],
      });
    }
  }

  for (const s of seats) {
    if (s.isAccessible && (claimCount.get(s.id) ?? 0) === 0) {
      issues.push({
        code: "accessible_without_companion",
        severity: "warning",
        message: "Ghế xe lăn chưa có ghế đi kèm.",
        seatIds: [s.id],
      });
    }
  }

  // Only checkable at bind time: a layout on its own has no tiers (T050).
  if (categoriesWithTier) {
    const tiered = new Set(categoriesWithTier);
    // A zone's class needs a price just as much as a seat's does.
    const occupied = new Set([...seatCategories, ...zoneCategories]);
    const untiered = (categories ?? []).filter((c) => occupied.has(c.id) && !tiered.has(c.id));
    if (untiered.length > 0) {
      issues.push({
        code: "category_without_tier",
        message: `Hạng ghế "${untiered.map((c) => c.name).join('", "')}" chưa có giá vé cho suất diễn này.`,
        categoryIds: untiered.map((c) => c.id),
      });
    }
  }

  // ---- hall-scheme amendment: two more checks, same single pass (FR-073, FR-074) ----

  for (const el of elements ?? []) {
    const isShape = el.kind === "boundary" || el.kind === "divider";
    if (isShape) continue;
    if (el.x === null || el.x === undefined || el.y === null || el.y === undefined) {
      issues.push({
        code: "icon_without_position",
        message: `Biểu tượng "${el.kind}" chưa có vị trí.`,
      });
    }
  }

  // A drawn hall outline that leaves seats outside it is a map that misleads the buyer. Only the
  // FIRST boundary is authoritative — two outlines is a drafting artefact, not two halls.
  const boundary = (elements ?? []).find(
    (e) => e.kind === "boundary" && (e.points?.length ?? 0) >= 3,
  );
  if (boundary?.points) {
    const outside = seats
      .filter((s) => !pointInPolygon({ x: s.x, y: s.y }, boundary.points!))
      .map((s) => s.id);
    if (outside.length > 0) {
      issues.push({
        code: "seats_outside_boundary",
        message: `${outside.length} ghế nằm ngoài đường bao của sảnh.`,
        seatIds: outside,
      });
    }
  }

  /**
   * No stage, so nothing says where the event happens.
   *
   * `bestSeats` ranks every candidate by distance to a focal point, and `focalPoint()` takes the
   * stage's centre when there is a stage and THE CENTROID OF ALL SEATS when there is not. That
   * fallback keeps best-available working, which is why this is a warning and not a refusal — but it
   * quietly changes what "best" means. In a hall whose stage is at one end, ranking outward from the
   * middle of the seating offers a buyer the centre of the block over the front rows, and nothing
   * anywhere tells the organizer that is what they published.
   *
   * Not a blocker, because a stage-less chart is a legitimate thing: a standing-only room, a
   * conference hall, a stadium drawn without its pitch. Refusing those to protect a ranking would
   * break publishing for venues that never needed it.
   *
   * Only when there are seats. Best-available ranks seats; a zone-only standing chart has nothing to
   * rank and so nothing to get wrong.
   */
  if (
    seats.length > 0 &&
    // An explicit focal point (0043) answers the question outright, so the warning has nothing left
    // to warn about — it exists to say the ranking is being INFERRED, and here it is not.
    !focalPoint &&
    !(elements ?? []).some((el) => el.kind === "stage")
  ) {
    issues.push({
      code: "focal_point_unset",
      severity: "warning",
      message:
        'Sơ đồ chưa có sân khấu. Gợi ý "ghế tốt nhất" sẽ tính từ giữa khu ghế thay vì từ sân khấu.',
    });
  }

  return issues;
}

/** Issues that REFUSE the publish. `severity` omitted means blocking — see `ValidationIssue`. */
export const blockingIssues = (issues: ValidationIssue[]): ValidationIssue[] =>
  issues.filter((i) => i.severity !== "warning");

/** Clamp a coordinate into the space; a stored position is always in range (FR-014). */
/** Round to a whole unit and hold it inside the wall — the frame is not a limit, `LAYOUT_MAX` is. */
export const clampCoord = (v: number): number =>
  Math.max(LAYOUT_MIN, Math.min(LAYOUT_MAX, Math.round(v)));

/** Normalise a rotation into 0–359 rather than refusing it (FR-014). */
export const normaliseRotation = (deg: number): number => ((Math.round(deg) % 360) + 360) % 360;
