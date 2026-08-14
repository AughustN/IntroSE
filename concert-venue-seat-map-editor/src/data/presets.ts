import { VenueMap, CategoryTier, SeatMapElement, Seat } from '../types/seatmap';

export const DEFAULT_CATEGORIES: CategoryTier[] = [
  {
    id: 'cat-vip',
    name: 'VIP Front Row / Pit',
    color: '#f97316', // Vibrant Orange
    price: 250,
    ticketType: 'VIP Experience',
    description: 'Closest view with exclusive lounge access & complimentary drink'
  },
  {
    id: 'cat-cat1',
    name: 'Platinum Reserved',
    color: '#3b82f6', // Blue
    price: 180,
    ticketType: 'Standard Reserved',
    description: 'Prime center view seating'
  },
  {
    id: 'cat-cat2',
    name: 'Gold Reserved',
    color: '#10b981', // Emerald
    price: 120,
    ticketType: 'Standard Reserved',
    description: 'Great sightlines and audio quality'
  },
  {
    id: 'cat-cat3',
    name: 'Silver Tier',
    color: '#f59e0b', // Amber
    price: 75,
    ticketType: 'Standard Reserved',
    description: 'Budget friendly upper level seating'
  },
  {
    id: 'cat-ga',
    name: 'General Admission Pit',
    color: '#ec4899', // Pink
    price: 95,
    ticketType: 'General Admission',
    description: 'Standing room directly in front of stage'
  },
  {
    id: 'cat-accessible',
    name: 'Accessible Wheelchair',
    color: '#06b6d4', // Cyan
    price: 75,
    ticketType: 'Accessible',
    description: 'Barrier-free seating with companion space'
  }
];

// Helper to generate a rectangular block of seats
function generateBlockSeats(
  rows: number, 
  seatsPerRow: number, 
  catId: string, 
  seatSpacing = 26, 
  rowSpacing = 28,
  rowPrefix = '',
  startRowCode = 65 // 'A'
): Seat[] {
  const seats: Seat[] = [];
  for (let r = 0; r < rows; r++) {
    const rowChar = String.fromCharCode(startRowCode + r);
    const rowLabel = `${rowPrefix}${rowChar}`;
    for (let s = 0; s < seatsPerRow; s++) {
      const isAccessible = (r === rows - 1) && (s === 0 || s === seatsPerRow - 1);
      seats.push({
        id: `seat-${r}-${s}-${Math.random().toString(36).substr(2, 5)}`,
        label: `${s + 1}`,
        rowLabel: rowLabel,
        x: s * seatSpacing,
        y: r * rowSpacing,
        status: isAccessible ? 'accessible' : 'available',
        categoryId: isAccessible ? 'cat-accessible' : catId,
        isAccessible: isAccessible
      });
    }
  }
  return seats;
}

// Helper for VIP table seats
function generateTableSeats(seatCount: number, catId: string, radius = 32): Seat[] {
  const seats: Seat[] = [];
  const angleStep = (2 * Math.PI) / seatCount;
  for (let i = 0; i < seatCount; i++) {
    const angle = i * angleStep - Math.PI / 2;
    seats.push({
      id: `table-seat-${i}-${Math.random().toString(36).substr(2, 5)}`,
      label: `${i + 1}`,
      rowLabel: 'T',
      x: radius + Math.cos(angle) * (radius + 8),
      y: radius + Math.sin(angle) * (radius + 8),
      status: 'available',
      categoryId: catId
    });
  }
  return seats;
}

// Preset 1: Grand Concert Arena
export const PRESET_GRAND_ARENA: VenueMap = {
  id: 'venue-grand-arena',
  name: 'Grand Concert Arena',
  description: 'Pro indoor concert stadium with Main Stage, Catwalk, GA Standing Floor, Center Orchestra, and Side Wings.',
  version: '1.2.0',
  canvasWidth: 1600,
  canvasHeight: 1200,
  gridSize: 20,
  snapToGrid: true,
  categories: DEFAULT_CATEGORIES,
  updatedAt: new Date().toISOString(),
  blueprint: {
    imageUrl: null,
    opacity: 0.4,
    scale: 1,
    x: 0,
    y: 0,
    visible: false
  },
  elements: [
    // Main Stage
    {
      id: 'stage-main',
      type: 'stage',
      title: 'Main Performing Stage',
      x: 550,
      y: 60,
      width: 500,
      height: 120,
      rotation: 0,
      zIndex: 1,
      label: 'MAIN CONCERT STAGE',
      fontSize: 18,
      backgroundColor: '#1e293b',
      textColor: '#f8fafc',
      borderColor: '#3b82f6'
    },
    // Catwalk Stage Extension
    {
      id: 'stage-catwalk',
      type: 'stage',
      title: 'Catwalk Runway',
      x: 750,
      y: 180,
      width: 100,
      height: 100,
      rotation: 0,
      zIndex: 1,
      label: 'RUNWAY',
      fontSize: 12,
      backgroundColor: '#334155',
      textColor: '#cbd5e1',
      borderColor: '#60a5fa'
    },
    // Front GA Standing Pit (Left)
    {
      id: 'ga-pit-left',
      type: 'ga-zone',
      title: 'VIP GA Floor Pit - Left',
      x: 520,
      y: 200,
      width: 210,
      height: 150,
      rotation: 0,
      zIndex: 2,
      capacity: 350,
      categoryId: 'cat-ga',
      fillColor: 'rgba(236, 72, 153, 0.25)',
      label: 'GA PIT LEFT'
    },
    // Front GA Standing Pit (Right)
    {
      id: 'ga-pit-right',
      type: 'ga-zone',
      title: 'VIP GA Floor Pit - Right',
      x: 870,
      y: 200,
      width: 210,
      height: 150,
      rotation: 0,
      zIndex: 2,
      capacity: 350,
      categoryId: 'cat-ga',
      fillColor: 'rgba(236, 72, 153, 0.25)',
      label: 'GA PIT RIGHT'
    },
    // Center Orchestra VIP Seating Block
    {
      id: 'sec-center-orch',
      type: 'seating-block',
      title: 'Center Orchestra (VIP)',
      x: 550,
      y: 380,
      width: 500,
      height: 200,
      rotation: 0,
      zIndex: 3,
      rowsCount: 6,
      seatsPerRow: 18,
      seatSpacing: 26,
      rowSpacing: 28,
      categoryId: 'cat-vip',
      seats: generateBlockSeats(6, 18, 'cat-vip', 26, 28, '', 65)
    },
    // Left Wing Block (Platinum)
    {
      id: 'sec-left-wing',
      type: 'seating-block',
      title: 'Left Wing Block A',
      x: 220,
      y: 360,
      width: 280,
      height: 220,
      rotation: -12,
      zIndex: 3,
      rowsCount: 7,
      seatsPerRow: 10,
      seatSpacing: 26,
      rowSpacing: 28,
      categoryId: 'cat-cat1',
      seats: generateBlockSeats(7, 10, 'cat-cat1', 26, 28, 'L-', 65)
    },
    // Right Wing Block (Platinum)
    {
      id: 'sec-right-wing',
      type: 'seating-block',
      title: 'Right Wing Block B',
      x: 1100,
      y: 360,
      width: 280,
      height: 220,
      rotation: 12,
      zIndex: 3,
      rowsCount: 7,
      seatsPerRow: 10,
      seatSpacing: 26,
      rowSpacing: 28,
      categoryId: 'cat-cat1',
      seats: generateBlockSeats(7, 10, 'cat-cat1', 26, 28, 'R-', 65)
    },
    // Mezzanine Rear Block (Gold Tier)
    {
      id: 'sec-mezzanine',
      type: 'seating-block',
      title: 'Mezzanine Tier - Section 102',
      x: 500,
      y: 630,
      width: 600,
      height: 240,
      rotation: 0,
      zIndex: 3,
      rowsCount: 8,
      seatsPerRow: 22,
      seatSpacing: 26,
      rowSpacing: 28,
      categoryId: 'cat-cat2',
      seats: generateBlockSeats(8, 22, 'cat-cat2', 26, 28, 'M-', 65)
    },
    // Balcony Tier (Silver)
    {
      id: 'sec-balcony',
      type: 'seating-block',
      title: 'Upper Balcony Tier - Section 201',
      x: 450,
      y: 910,
      width: 700,
      height: 180,
      rotation: 0,
      zIndex: 3,
      rowsCount: 6,
      seatsPerRow: 26,
      seatSpacing: 26,
      rowSpacing: 28,
      categoryId: 'cat-cat3',
      seats: generateBlockSeats(6, 26, 'cat-cat3', 26, 28, 'B-', 65)
    },
    // Emergency Exits & Amenities
    {
      id: 'exit-left',
      type: 'exit',
      title: 'Emergency Exit West',
      x: 140,
      y: 400,
      width: 60,
      height: 35,
      rotation: 0,
      zIndex: 4,
      label: 'EXIT'
    },
    {
      id: 'exit-right',
      type: 'exit',
      title: 'Emergency Exit East',
      x: 1400,
      y: 400,
      width: 60,
      height: 35,
      rotation: 0,
      zIndex: 4,
      label: 'EXIT'
    },
    {
      id: 'text-sounddesk',
      type: 'text',
      title: 'Front of House Sound Desk',
      x: 720,
      y: 590,
      width: 160,
      height: 30,
      rotation: 0,
      zIndex: 4,
      label: '[ FOH SOUND DESK ]',
      fontSize: 12,
      textColor: '#94a3b8'
    }
  ]
};

// Preset 2: Starlight Jazz & Concert Lounge (Table seating layout)
export const PRESET_JAZZ_LOUNGE: VenueMap = {
  id: 'venue-jazz-lounge',
  name: 'Starlight Jazz & Supper Club',
  description: 'Intimate concert venue layout with Front Stage VIP round tables, booth lounges, bar area, and stage.',
  version: '1.0.0',
  canvasWidth: 1200,
  canvasHeight: 900,
  gridSize: 20,
  snapToGrid: true,
  categories: DEFAULT_CATEGORIES,
  updatedAt: new Date().toISOString(),
  blueprint: {
    imageUrl: null,
    opacity: 0.4,
    scale: 1,
    x: 0,
    y: 0,
    visible: false
  },
  elements: [
    // Jazz Stage
    {
      id: 'jazz-stage',
      type: 'stage',
      title: 'Acoustic Stage',
      x: 400,
      y: 50,
      width: 400,
      height: 100,
      rotation: 0,
      zIndex: 1,
      label: 'JAZZ & ACOUSTIC STAGE',
      fontSize: 16,
      backgroundColor: '#312e81',
      textColor: '#e0e7ff',
      borderColor: '#a855f7'
    },
    // Table 1 (Front Center VIP)
    {
      id: 'table-1',
      type: 'vip-table',
      title: 'Table 1 - Stage Front VIP',
      x: 430,
      y: 190,
      width: 80,
      height: 80,
      rotation: 0,
      zIndex: 2,
      tableShape: 'circle',
      tableSeatCount: 4,
      categoryId: 'cat-vip',
      label: 'T1',
      seats: generateTableSeats(4, 'cat-vip', 32)
    },
    // Table 2 (Front Center VIP)
    {
      id: 'table-2',
      type: 'vip-table',
      title: 'Table 2 - Stage Front VIP',
      x: 560,
      y: 190,
      width: 80,
      height: 80,
      rotation: 0,
      zIndex: 2,
      tableShape: 'circle',
      tableSeatCount: 4,
      categoryId: 'cat-vip',
      label: 'T2',
      seats: generateTableSeats(4, 'cat-vip', 32)
    },
    // Table 3 (Front Center VIP)
    {
      id: 'table-3',
      type: 'vip-table',
      title: 'Table 3 - Stage Front VIP',
      x: 690,
      y: 190,
      width: 80,
      height: 80,
      rotation: 0,
      zIndex: 2,
      tableShape: 'circle',
      tableSeatCount: 4,
      categoryId: 'cat-vip',
      label: 'T3',
      seats: generateTableSeats(4, 'cat-vip', 32)
    },
    // Table 4
    {
      id: 'table-4',
      type: 'vip-table',
      title: 'Table 4 - Platinum Center',
      x: 430,
      y: 310,
      width: 80,
      height: 80,
      rotation: 0,
      zIndex: 2,
      tableShape: 'circle',
      tableSeatCount: 6,
      categoryId: 'cat-cat1',
      label: 'T4',
      seats: generateTableSeats(6, 'cat-cat1', 32)
    },
    // Table 5
    {
      id: 'table-5',
      type: 'vip-table',
      title: 'Table 5 - Platinum Center',
      x: 560,
      y: 310,
      width: 80,
      height: 80,
      rotation: 0,
      zIndex: 2,
      tableShape: 'circle',
      tableSeatCount: 6,
      categoryId: 'cat-cat1',
      label: 'T5',
      seats: generateTableSeats(6, 'cat-cat1', 32)
    },
    // Table 6
    {
      id: 'table-6',
      type: 'vip-table',
      title: 'Table 6 - Platinum Center',
      x: 690,
      y: 310,
      width: 80,
      height: 80,
      rotation: 0,
      zIndex: 2,
      tableShape: 'circle',
      tableSeatCount: 6,
      categoryId: 'cat-cat1',
      label: 'T6',
      seats: generateTableSeats(6, 'cat-cat1', 32)
    },
    // Rear Tier Seating Block
    {
      id: 'sec-rear-lounge',
      type: 'seating-block',
      title: 'Rear Mezzanine Lounge',
      x: 350,
      y: 440,
      width: 500,
      height: 150,
      rotation: 0,
      zIndex: 3,
      rowsCount: 4,
      seatsPerRow: 16,
      seatSpacing: 28,
      rowSpacing: 30,
      categoryId: 'cat-cat2',
      seats: generateBlockSeats(4, 16, 'cat-cat2', 28, 30, 'R-', 65)
    },
    // Bar Area
    {
      id: 'bar-zone',
      type: 'text',
      title: 'Cocktail Bar & Lounge',
      x: 400,
      y: 640,
      width: 400,
      height: 50,
      rotation: 0,
      zIndex: 1,
      label: '🍸 COCKTAIL BAR & BEVERAGE SERVICE',
      fontSize: 14,
      textColor: '#f59e0b',
      backgroundColor: '#1f2937'
    }
  ]
};

export const PRESETS_LIST: VenueMap[] = [
  PRESET_GRAND_ARENA,
  PRESET_JAZZ_LOUNGE
];
