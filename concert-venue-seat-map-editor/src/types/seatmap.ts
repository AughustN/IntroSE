export type ElementType = 
  | 'seating-block'
  | 'curved-row'
  | 'single-row'
  | 'individual-seat'
  | 'vip-table'
  | 'ga-zone'
  | 'stage'
  | 'screen'
  | 'exit'
  | 'text'
  | 'shape';

export type SeatStatus = 'available' | 'reserved' | 'sold' | 'blocked' | 'accessible';

export interface CategoryTier {
  id: string;
  name: string;
  color: string;
  price: number;
  description?: string;
  ticketType?: string;
}

export interface Seat {
  id: string;
  label: string; // e.g. "1", "101"
  rowLabel: string; // e.g. "A", "1"
  x: number; // relative to parent or canvas
  y: number;
  status: SeatStatus;
  categoryId: string;
  isAccessible?: boolean;
  viewPhotoUrl?: string;
}

export interface SeatMapElement {
  id: string;
  type: ElementType;
  title: string;
  x: number;
  y: number;
  rotation: number; // in degrees
  width: number;
  height: number;
  zIndex: number;
  categoryId?: string; // default category for the element
  
  // Seating block properties
  rowsCount?: number;
  seatsPerRow?: number;
  seatSpacing?: number;
  rowSpacing?: number;
  rowLabelType?: 'alpha-asc' | 'alpha-desc' | 'num-asc' | 'num-desc';
  seatLabelType?: 'num-asc' | 'num-desc' | 'even' | 'odd';
  rowLabelPrefix?: string;
  seatLabelPrefix?: string;

  // Curved row properties
  radius?: number;
  arcAngle?: number; // degrees e.g. 60 or 120

  // VIP Table properties
  tableShape?: 'circle' | 'square' | 'rectangle';
  tableSeatCount?: number;

  // GA Zone properties
  capacity?: number;
  fillColor?: string;

  // Stage / Text / Shape properties
  label?: string;
  fontSize?: number;
  textColor?: string;
  backgroundColor?: string;
  borderColor?: string;

  // Child seats (for seating-block, curved-row, single-row, vip-table)
  seats?: Seat[];
}

export interface BlueprintConfig {
  imageUrl: string | null;
  opacity: number; // 0 to 1
  scale: number;
  x: number;
  y: number;
  visible: boolean;
}

export interface VenueMap {
  id: string;
  name: string;
  description: string;
  version: string;
  canvasWidth: number;
  canvasHeight: number;
  gridSize: number;
  snapToGrid: boolean;
  categories: CategoryTier[];
  elements: SeatMapElement[];
  blueprint: BlueprintConfig;
  updatedAt: string;
}

export type ActiveTool = 
  | 'select'
  | 'pan'
  | 'brush'
  | 'add-block'
  | 'add-curved'
  | 'add-row'
  | 'add-seat'
  | 'add-table'
  | 'add-ga'
  | 'add-stage'
  | 'add-text'
  | 'add-exit';

export interface CartItem {
  elementId: string;
  seatId?: string; // undefined if GA zone ticket
  seatLabel?: string;
  rowLabel?: string;
  sectionName: string;
  category: CategoryTier;
  price: number;
}
