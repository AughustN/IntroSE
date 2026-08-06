// Organizer seat-map authoring contract, shared by server and web (Principle VI).
// Derived from src/specs/005-seatmap-designer/contracts/seatmap.openapi.yaml.
//
// Coordinates are integers in 0–10000 on each axis; every seat has a nominal diameter of 100 units
// and rotation is cosmetic (FR-008). The buyer-facing read contract is `SeatMap` in ./types.ts.

import type { ValidationIssue } from './seatmap-validate.js';

export type LayoutStatus = 'draft' | 'ready' | 'archived';
export type SeatType = 'single' | 'double' | 'standing';
/** `area` predates feature 005 and is kept so existing rows still render (migration 0010). */
export type ElementKind =
  | 'stage'
  | 'aisle'
  | 'door'
  | 'bar'
  | 'label'
  | 'area'
  // Hall outline and dividers — decorative geometry, never sellable (FR-057).
  | 'boundary'
  | 'divider'
  // Facility icons (FR-061). Widened additively, so no stored element becomes invalid.
  | 'exit'
  | 'restroom'
  | 'food_drink'
  | 'smoking'
  | 'first_aid'
  | 'lift_stairs'
  | 'wheelchair';

/** Kinds whose geometry is a point list rather than a rectangle. */
export const SHAPE_KINDS = ['boundary', 'divider'] as const;
/** Kinds drawn as a facility marker with an optional Vietnamese label. */
export const FACILITY_KINDS = [
  'exit',
  'restroom',
  'food_drink',
  'smoking',
  'first_aid',
  'lift_stairs',
  'wheelchair',
] as const;

export const isShapeKind = (k: ElementKind): boolean => (SHAPE_KINDS as readonly string[]).includes(k);
export const isFacilityKind = (k: ElementKind): boolean =>
  (FACILITY_KINDS as readonly string[]).includes(k);

export type SeatShape = 'circle' | 'square';

/** One vertex of a boundary polygon or a divider (FR-058). */
export interface ShapePoint {
  x: number;
  y: number;
}

export interface LayoutSection {
  /** Absent for a section being created in this save. */
  id?: number;
  name: string;
  description?: string | null;
  /**
   * Visual style (FR-064). `color` is an EDITOR-ONLY aid and is never sent to the buyer map, where
   * colour is reserved for price tier. `seatShape` and `seatSizeMultiplier` DO reach buyers, so
   * sections stay distinguishable by form rather than by fill.
   */
  color?: string | null;
  seatShape?: SeatShape;
  /** Scales the nominal diameter. 1.0 = today's rendering; bounded 0.5–2.0 (FR-065). */
  seatSizeMultiplier?: number;
}

/**
 * A table (FR-047). A DRAWING object that owns seats — never sellable, never in inventory. Its seats
 * inherit its section, and its name becomes their row label so they read as "Bàn 5 - Ghế 3" (FR-053).
 */
export interface LayoutTable {
  id?: number;
  sectionId: number | null;
  name: string;
  shape: 'round' | 'rect';
  x: number;
  y: number;
  /** Round: width === height === diameter. */
  width: number;
  height: number;
  rotation: number;
  seatCount: number;
  /** Rectangular only: seats per side, clockwise from the top. Null for a round table (FR-048). */
  sideCounts?: number[] | null;
}

export interface LayoutSeat {
  /** Absent for a seat being created in this save. */
  id?: number;
  /** null is allowed while drafting; it blocks publishing (FR-030, FR-032). */
  sectionId: number | null;
  rowLabel: string;
  seatNumber: number;
  seatType: SeatType;
  x: number;
  y: number;
  rotation: number;
  /** Set when this seat belongs to a table, so the editor can select the table as one object. */
  tableId?: number | null;
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
}

export interface LayoutFloorPlan {
  url: string | null;
  scale: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
  visibleToBuyers: boolean;
}

export interface Layout {
  id: number;
  venueId: number;
  name: string;
  status: LayoutStatus;
  isTemplate: boolean;
  /** Send back on save; a stale value is refused (FR-015). */
  version: number;
  sections: LayoutSection[];
  seats: LayoutSeat[];
  elements: LayoutElement[];
  tables: LayoutTable[];
  floorPlan: LayoutFloorPlan;
}

export interface LayoutSummary {
  id: number;
  venueId: number;
  name: string;
  status: LayoutStatus;
  isTemplate: boolean;
  seatCount: number;
}

export interface SaveLayoutRequest {
  version: number;
  name?: string;
  isTemplate?: boolean;
  sections: LayoutSection[];
  seats: LayoutSeat[];
  elements: LayoutElement[];
}

export interface ValidateResponse {
  valid: boolean;
  issues: ValidationIssue[];
}

// ---- Applying a layout to a showtime (FR-027..FR-029) ----

export type ApplyChangeKind = 'add' | 'move' | 'relabel' | 'retier' | 'remove';
export type RefusalReason = 'seat_sold' | 'seat_held';

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
  | 'layout_name_taken'
  | 'layout_limit_reached'
  | 'seat_limit_reached'
  | 'element_limit_reached'
  | 'stale_version'
  | 'layout_in_use'
  | 'layout_not_published'
  | 'layout_invalid'
  | 'map_edit_refused'
  | 'invalid_image'
  | 'image_too_large'
  | 'file_too_large'
  | 'upload_rate_limited';
