// Organizer seat-map authoring contract, shared by server and web (Principle VI).
// Derived from src/specs/005-seatmap-designer/contracts/seatmap.openapi.yaml.
//
// Coordinates are integers in 0–10000 on each axis; every seat has a nominal diameter of 100 units
// and rotation is cosmetic (FR-008). The buyer-facing read contract is `SeatMap` in ./types.ts.

import type { ChartDocument } from "./seatmap-document.js";
import type { ValidationIssue } from "./seatmap-validate.js";
import type { SeatMapTable, SeatMapTierLegendEntry } from "./types.js";

export type LayoutStatus = "draft" | "ready" | "archived";
export type SeatType = "single" | "double" | "standing";
export type TableBookingMode = "per_seat" | "whole_table";
/** `area` predates feature 005 and is kept so existing rows still render (migration 0010). */
export type ElementKind =
  | "stage"
  | "aisle"
  | "door"
  | "bar"
  | "label"
  | "area"
  // Hall outline and dividers — decorative geometry, never sellable (FR-057).
  | "boundary"
  | "divider"
  // Facility icons (FR-061). Widened additively, so no stored element becomes invalid.
  | "exit"
  | "restroom"
  | "food_drink"
  | "smoking"
  | "first_aid"
  | "lift_stairs"
  | "wheelchair";

/** Kinds whose geometry is a point list rather than a rectangle. */
export const SHAPE_KINDS = ["boundary", "divider"] as const;
/** Kinds drawn as a facility marker with an optional Vietnamese label. */
export const FACILITY_KINDS = [
  "exit",
  "restroom",
  "food_drink",
  "smoking",
  "first_aid",
  "lift_stairs",
  "wheelchair",
] as const;

export const isShapeKind = (k: ElementKind): boolean =>
  (SHAPE_KINDS as readonly string[]).includes(k);
export const isFacilityKind = (k: ElementKind): boolean =>
  (FACILITY_KINDS as readonly string[]).includes(k);

export type SeatShape = "circle" | "square";

/** One vertex of a boundary polygon or a divider (FR-058). */
export interface ShapePoint {
  x: number;
  y: number;
}

/**
 * A level of the venue (0044).
 *
 * A chart with no floors is a chart on one floor — that is what every chart drawn before this is, and
 * it stays that way without saying so. Floors only ever appear once an organizer creates one.
 */
export interface LayoutFloor {
  /** Absent for a floor being created in this save. */
  id?: number;
  name: string;
  displayOrder: number;
}

export interface LayoutSection {
  /** Absent for a section being created in this save. */
  id?: number;
  name: string;
  description?: string | null;
  /**
   * Which level this part of the room is on (0044). Null means the implicit single floor.
   *
   * The floor hangs here rather than on the seat because a section cannot straddle two levels, and
   * because the buyer already learns a seat's section by name through the snapshot — so the floor
   * rides that same key instead of needing a column on `showtime_seats`.
   */
  floorId?: number | null;
  /**
   * Visual style (FR-064). `color` is an EDITOR-ONLY aid and is never sent to the buyer map, where
   * colour carries the PRICE CLASS instead — see `LayoutCategory`. `seatShape` and
   * `seatSizeMultiplier` DO reach buyers, so sections stay distinguishable by form rather than fill.
   */
  color?: string | null;
  seatShape?: SeatShape;
  /** Scales the nominal diameter. 1.0 = today's rendering; bounded 0.5–2.0 (FR-065). */
  seatSizeMultiplier?: number;
}

/**
 * A price CLASS owned by the chart — "SVIP", "VIP", "Thường".
 *
 * The distinction from `LayoutSection` is the point: a section is WHERE a seat is, a category is WHAT
 * KIND of seat it is. A section may hold several categories (VIP front rows inside "Khu A"), and one
 * category may span several sections.
 *
 * A category deliberately carries NO price. Price lives on `ticket_tiers`, per showtime, and a tier
 * names the category it prices — so the same chart sells at different prices on different nights
 * without being redrawn, and re-pricing never touches geometry.
 */
export interface LayoutCategory {
  /** Absent for a category being created in this save. */
  id?: number;
  name: string;
  /** Required, unlike a section's: a category exists to be recognised by colour. */
  color: string;
}

/**
 * A table (FR-047). A DRAWING object that owns seats — never sellable, never in inventory. Its seats
 * inherit its section, and its name becomes their row label so they read as "Bàn 5 - Ghế 3" (FR-053).
 */
export interface LayoutTable {
  id?: number;
  sectionId: number | null;
  name: string;
  shape: "round" | "rect";
  x: number;
  y: number;
  /** Round: width === height === diameter. */
  width: number;
  height: number;
  rotation: number;
  seatCount: number;
  /** Rectangular only: seats per side, clockwise from the top. Null for a round table (FR-048). */
  sideCounts?: number[] | null;
  /** Price class imparted to this table's seats, like its section. */
  categoryId?: number | null;
  /**
   * How this table sells. `whole_table` is a SELECTION rule on the buyer's map — picking one seat
   * picks them all — not a second kind of inventory: the hold still takes N ordinary seat rows.
   */
  bookingMode?: TableBookingMode;
}

export interface LayoutSeat {
  /** Absent for a seat being created in this save. */
  id?: number;
  /** null is allowed while drafting; it blocks publishing (FR-030, FR-032). */
  sectionId: number | null;
  /** The seat's price class. null while drafting; it blocks publishing, like a missing section. */
  categoryId?: number | null;
  rowLabel: string;
  seatNumber: number;
  seatType: SeatType;
  x: number;
  y: number;
  rotation: number;
  /** Set when this seat belongs to a table, so the editor can select the table as one object. */
  tableId?: number | null;
  /**
   * Usable by a wheelchair user. A property of the SEAT — distinct from the `wheelchair` element
   * kind, which marks where a facility is rather than what a seat can do.
   */
  isAccessible?: boolean;
  /** The `layout_rows` row this seat belongs to (0032). See `DocumentSeat.rowId` for why it is not
   *  a substitute for `rowLabel`. */
  rowId?: number | null;
  /** When set, the seat has been retired from the chart but kept for the bookings that point at it
   *  (§18). Archived seats are excluded from the projection, from validation and from generation. */
  archivedAt?: string | null;
  /**
   * The ACCESSIBLE seat this seat accompanies (0036). Set on the ordinary seat, never on the
   * wheelchair seat itself — see `DocumentSeat.companionSeatId` for why the direction matters.
   * The `seats.companion_seat_id` column mirrors this field; the showtime half is copied onto
   * `showtime_seats` at generation time, because after a snapshot the showtime owns its map (FR-005).
   * The pairing is an authoring fact, not a sale rule: holds still take one seat at a time.
   */
  companionSeatId?: number | null;
}

/**
 * A row, as a first-class object (0032).
 *
 * Mirrors `layout_rows`. `displayOrder` is a display position only — never an identity, and never
 * something a booking or a label is derived from (§43, §44, §45).
 */
export interface LayoutRow {
  id: number;
  sectionId: number | null;
  label: string;
  displayOrder: number;
}

export interface LayoutElement {
  id?: number;
  kind: ElementKind;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  label: string | null;
  /**
   * Ordered vertices for `boundary` and `divider` (FR-058). The rectangle fields above stay populated
   * as the shape's BOUNDING BOX, so a reader that does not understand points still positions it.
   */
  points?: ShapePoint[] | null;
  /**
   * `area` only: how many people the zone holds.
   *
   * With `categoryId` set this is a CAPACITY ZONE — the zone is sold by count against that price
   * class's tier, and produces no seat rows at all. Without one it is the older generated-standing
   * shape, where the count records how many positions were drawn inside the polygon.
   */
  capacity?: number | null;
  /**
   * A drawn outline's fill colour, six hex digits. Absent means the theme's own ink, which is how every
   * element rendered before shapes could be coloured.
   */
  color?: string | null;
  /** Which named shape this outline was generated as, if any. Absent means a hand-drawn polygon. */
  geometry?: string | null;
  /**
   * `area` only: the price class this zone's capacity is sold under.
   *
   * The handle that joins a zone to a `ticket_tiers` row, exactly as `seats.category_id` does for a
   * seat. A zone with a capacity and no category is unpublishable rather than free.
   */
  categoryId?: number | null;
  /**
   * Which section this element belongs to, if any (0031).
   *
   * Any kind may carry one, unlike `capacity` and `categoryId` above: a boundary outlines a stand, a
   * door leads into one, a bar serves one. It is decoration either way — nothing prices or sells
   * through this — so an unassigned element is a normal state, not a validation failure.
   */
  sectionId?: number | null;
}

export interface LayoutFloorPlan {
  url: string | null;
  scale: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
  visibleToBuyers: boolean;
}

/**
 * The venue's real floor plan, shown ONLY in the editor so the organizer can trace over it.
 *
 * Deliberately a separate layer from `LayoutFloorPlan`, which is the picture a BUYER may see behind
 * the seats. Conflating them forced a choice between "trace over the CAD export" and "show customers
 * something pretty"; they are different images for different audiences. This one is never
 * snapshotted onto a showtime and so carries no visibility flag — there is nothing to expose.
 */
export interface LayoutReferenceChart {
  url: string | null;
  scale: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
}

/** See `Layout.orphanRule`. Mirrors the CHECK on `venue_layouts.orphan_rule` (0037). */
export type OrphanRule = "balanced" | "strict";

export interface Layout {
  id: number;
  venueId: number;
  name: string;
  status: LayoutStatus;
  isTemplate: boolean;
  /** Send back on save; a stale value is refused (FR-015). */
  version: number;
  sections: LayoutSection[];
  /** The chart's levels (0044). Empty on a single-floor chart, which is most of them. */
  floors: LayoutFloor[];
  categories: LayoutCategory[];
  /** The chart's rows (0032). Empty on a layout saved before rows existed and not yet re-saved. */
  rows: LayoutRow[];
  seats: LayoutSeat[];
  elements: LayoutElement[];
  tables: LayoutTable[];
  floorPlan: LayoutFloorPlan;
  referenceChart: LayoutReferenceChart;
  /**
   * How hard "best available" refuses to strand a lone seat when this chart is selling (0037).
   *
   * A chart-level setting rather than a platform constant: whether a single seat left beside an
   * aisle is acceptable is a venue's judgement, not one answer for everybody. Reaches buyers through
   * the snapshot at apply time, so changing it never re-tunes a show already on sale.
   */
  orphanRule: OrphanRule;
  /**
   * Where the event happens, when the chart cannot say so with a stage (0043).
   *
   * Best-available ranks by distance to a focal point, and without this the ranking is INFERRED —
   * the stage's centre if there is a stage, otherwise the centroid of every seat. The inference is
   * right often enough to be worth keeping as a fallback and wrong often enough to need overriding:
   * an arena's focal point is its pitch, not the middle of its four stands.
   *
   * Null means "infer it", which is what every chart drawn before this did and still does.
   */
  focalPoint: { x: number; y: number } | null;
  /**
   * The authoring document (./seatmap-document.ts) — how the chart was BUILT, as opposed to the
   * collections above, which are what is for sale.
   *
   * Never null in practice: a layout stored before documents existed has one synthesised from its rows
   * by `adoptLayout` on read, so the editor always receives something to work with. Typed nullable
   * anyway, because a hand-edited or future-schema blob that `upgradeDocument` cannot read falls back
   * to adoption rather than failing the request.
   */
  document: ChartDocument | null;
}

export interface LayoutSummary {
  id: number;
  venueId: number;
  name: string;
  status: LayoutStatus;
  isTemplate: boolean;
  seatCount: number;
}

/**
 * One entry in a chart's history — the document as it stood when a version was published.
 *
 * The document alone, never the projected rows: restoring re-projects through the ordinary save path,
 * so a restore inherits every guard a save has, including the refusal to delete a seat somebody has
 * already bought.
 */
export interface LayoutRevision {
  id: number;
  /** The `venue_layouts.version` this document was, so history reads in the editor's own terms. */
  version: number;
  seatCount: number;
  createdAt: string;
  /** Null once the account that drew it is gone — the history outlives the user. */
  createdBy: number | null;
}

/**
 * One chart as the seat map library lists it — across every venue the organizer owns.
 *
 * Wider than `LayoutSummary` by the three things a library has to answer that a per-venue list never
 * had to: which venue this is, when it last changed, and whether anything is currently selling from
 * it. `usageCount` is what makes "can I archive this?" answerable BEFORE the click rather than as a
 * 409 afterwards.
 */
export interface LayoutLibraryEntry extends LayoutSummary {
  venueName: string;
  updatedAt: string;
  /** Showtimes that are neither finished nor cancelled and still point at this chart. */
  usageCount: number;
  /**
   * Whether this chart has ever been published — which is what separates the two very different
   * things `status: "draft"` was covering.
   *
   * Saving a published chart demotes it to `draft` (`layouts.repo.ts`, the Seats.io lifecycle: what
   * is live and what is being worked on are not the same document). So a plain `draft` badge was
   * telling an organizer the same word about a chart nobody has ever sold from and about one that is
   * selling right now under an older published version. The first is unfinished; the second is live
   * with edits waiting. Conflating them hides the only question that matters — is anything of mine on
   * sale? — behind a word that says no.
   *
   * Derived from `layout_revisions`, which is written on publish and nowhere else.
   */
  hasPublishedVersion: boolean;
  /**
   * A recognition thumbnail: each block's box and kind, nothing else.
   *
   * Deliberately NOT the document. A chart's document runs to tens of kilobytes and a library of
   * thirty would be megabytes on every page load, to draw a picture two centimetres wide. What makes
   * a floor plan recognisable at that size is its silhouette — a wide stage along the top, two wings,
   * a block in the middle — and that survives at box resolution.
   *
   * Empty for a chart drawn before the document existed, or one with nothing in it yet.
   */
  thumbnail: { x: number; y: number; w: number; h: number; kind: string }[];
}

export interface SaveLayoutRequest {
  version: number;
  name?: string;
  isTemplate?: boolean;
  /**
   * The authoring document. When present it is AUTHORITATIVE: the server projects the collections
   * below from it and ignores whatever the client sent for them.
   *
   * That "ignores" is deliberate and is not two sources of truth — a document and a seat list that
   * disagreed would be exactly the drift this feature exists to remove, so one of them has to lose,
   * and it is never the document.
   */
  document?: ChartDocument;
  /**
   * The pre-document shape.
   *
   * @deprecated Transitional. It exists so the editor keeps working while it is being ported to send a
   * document, and is removed once it does. New callers send `document`.
   */
  sections?: LayoutSection[];
  categories?: LayoutCategory[];
  seats?: LayoutSeat[];
  elements?: LayoutElement[];
}

export interface ValidateResponse {
  valid: boolean;
  issues: ValidationIssue[];
}

// ---- Reading a showtime's own map, as its organizer (FR-033..FR-035) ----

/**
 * One bookable seat of a showtime, seen by the organizer who owns it.
 *
 * Deliberately NOT the buyer's `SeatMap`. That read is gated on public visibility — on sale, admin
 * approved, organizer approved — so an organizer arranging a draft event would get nothing back from
 * it, which is exactly when they need to see the map. This one is gated on ownership instead, and
 * carries the tier's ID as well as its name because blocking and re-pricing act on ids.
 */
export interface ShowtimeMapSeat {
  /** `showtime_seats.id` — the handle every inventory-aware action takes. */
  id: number;
  row: string;
  number: number;
  section: string | null;
  /** The class this seat was generated as, frozen at generation — never re-read from the layout. */
  category: string | null;
  ticketTierId: number;
  tier: string;
  price: number;
  status: "available" | "held" | "sold" | "blocked";
  x: number;
  y: number;
  rotation: number;
  /** From the snapshot's per-section style, so the organizer's map is drawn like the buyer's. */
  shape?: "circle" | "square";
  sizeMultiplier?: number;
  /**
   * Who this seat was sold under, and when they walked in — the organizer's question the status
   * colour alone cannot answer: "whose, and are they here yet?"
   *
   * The name is `orders.customer_name`, which checkout snapshots from the account's **Nickname**
   * (falling back to the email, same rule the checkout itself uses) — deliberately the SAME column
   * the attendees export already prints, so the chart and the CSV never show two names for one
   * buyer. `users.nickname` is not re-read: re-reading it would let a later profile edit rewrite
   * what the ticket was sold under, breaking the purchase's own snapshot contract.
   *
   * Both stay `null` unless the seat's current ticket is live: held seats belong to an anonymous
   * reservation on purpose (holds expire — naming one would publish data about a purchase that has
   * not happened), and a voided ticket — a refund — un-names the seat. The check-in time exists on
   * the TICKET, not the seat row, so finding it needs the same ticket join the attendees export
   * proves out.
   */
  buyerName?: string | null;
  checkedInAt?: string | null;
}

export interface ShowtimeMap {
  showtimeId: number;
  seats: ShowtimeMapSeat[];
  elements: LayoutElement[];
  tables: SeatMapTable[];
  /** Same cheapest-first colours the buyer sees, so the two never disagree about a price class. */
  tierLegend: SeatMapTierLegendEntry[];
  space: { width: number; height: number; seatDiameter: number };
}

// ---- Applying a layout to a showtime (FR-027..FR-029) ----

export type ApplyChangeKind = "add" | "move" | "relabel" | "retier" | "remove";
export type RefusalReason = "seat_sold" | "seat_held";

export interface ApplyChange {
  kind: ApplyChangeKind;
  showtimeSeatId: number | null;
  seatLabel: string;
}

export interface ApplyRefusal {
  reason: RefusalReason;
  showtimeSeatId: number;
  seatLabel: string;
  /** Vietnamese; names the sale or the live hold (FR-028). */
  message: string;
}

export interface ApplyPreview {
  changes: ApplyChange[];
  refusals: ApplyRefusal[];
  wouldSucceed: boolean;
}

/** Error codes this feature adds. */
export type SeatMapErrorCode =
  | "layout_name_taken"
  /**
   * Two seats in one section share a row label and number.
   *
   * Split out from `layout_name_taken`, which used to answer every unique violation on the save path.
   * That told the organizer to fix a name clash on a chart that had none, and gave them nothing to
   * look for — while the actual cause, two blocks both lettered from A, was the commonest one.
   */
  | "duplicate_seat_label"
  | "duplicate_row_label"
  | "section_name_taken"
  | "category_name_taken"
  | "layout_limit_reached"
  | "seat_limit_reached"
  | "element_limit_reached"
  | "stale_version"
  | "layout_in_use"
  /** A save tried to drop a seat that a showtime has already generated inventory from. */
  | "seat_in_use"
  | "layout_not_published"
  | "layout_invalid"
  | "map_edit_refused"
  | "invalid_image"
  | "image_too_large"
  | "file_too_large"
  | "upload_rate_limited";
