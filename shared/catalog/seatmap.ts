// Organizer seat-map authoring contract, shared by server and web (Principle VI).
// Derived from src/specs/005-seatmap-designer/contracts/seatmap.openapi.yaml.
//
// Coordinates are integers in 0–10000 on each axis; every seat has a nominal diameter of 100 units
// and rotation is cosmetic (FR-008). The buyer-facing read contract is `SeatMap` in ./types.ts.

import type { ValidationIssue } from './seatmap-validate.js';

export type LayoutStatus = 'draft' | 'ready' | 'archived';
export type SeatType = 'single' | 'double' | 'standing';
/** `area` predates feature 005 and is kept so existing rows still render (migration 0010). */
export type ElementKind = 'stage' | 'aisle' | 'door' | 'bar' | 'label' | 'area';

export interface LayoutSection {
  /** Absent for a section being created in this save. */
  id?: number;
  name: string;
  description?: string | null;
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
