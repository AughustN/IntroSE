import { SeatMapElement, Seat, SeatStatus } from '../types/seatmap';

/**
 * Regenerates seat layout and labels for a seating block element based on its dimensions and configuration
 */
export function buildBlockSeats(element: SeatMapElement): Seat[] {
  const rows = element.rowsCount || 4;
  const cols = element.seatsPerRow || 10;
  const seatSpacing = element.seatSpacing || 26;
  const rowSpacing = element.rowSpacing || 28;
  const defaultCategory = element.categoryId || 'cat-cat1';

  const seats: Seat[] = [];
  const startRowCode = 65; // 'A'

  for (let r = 0; r < rows; r++) {
    // Determine row label
    let rowLabel = '';
    const prefix = element.rowLabelPrefix || '';
    if (element.rowLabelType === 'num-asc') {
      rowLabel = `${prefix}${r + 1}`;
    } else if (element.rowLabelType === 'num-desc') {
      rowLabel = `${prefix}${rows - r}`;
    } else if (element.rowLabelType === 'alpha-desc') {
      rowLabel = `${prefix}${String.fromCharCode(startRowCode + rows - 1 - r)}`;
    } else {
      // default alpha-asc
      rowLabel = `${prefix}${String.fromCharCode(startRowCode + r)}`;
    }

    for (let c = 0; c < cols; c++) {
      let seatNumLabel = '';
      const seatPrefix = element.seatLabelPrefix || '';

      if (element.seatLabelType === 'num-desc') {
        seatNumLabel = `${seatPrefix}${cols - c}`;
      } else if (element.seatLabelType === 'even') {
        seatNumLabel = `${seatPrefix}${(c + 1) * 2}`;
      } else if (element.seatLabelType === 'odd') {
        seatNumLabel = `${seatPrefix}${(c * 2) + 1}`;
      } else {
        // num-asc default
        seatNumLabel = `${seatPrefix}${c + 1}`;
      }

      // Preserve existing seat status/category if matching index exists
      const existingSeat = element.seats?.[r * cols + c];
      const status: SeatStatus = existingSeat ? existingSeat.status : 'available';
      const categoryId = existingSeat ? existingSeat.categoryId : defaultCategory;

      seats.push({
        id: existingSeat ? existingSeat.id : `seat-${element.id}-${r}-${c}-${Math.random().toString(36).substr(2, 4)}`,
        label: seatNumLabel,
        rowLabel: rowLabel,
        x: c * seatSpacing,
        y: r * rowSpacing,
        status: status,
        categoryId: categoryId,
        isAccessible: existingSeat?.isAccessible || false
      });
    }
  }

  return seats;
}

/**
 * Regenerates curved row seats along an arc
 */
export function buildCurvedRowSeats(element: SeatMapElement): Seat[] {
  const rows = element.rowsCount || 3;
  const cols = element.seatsPerRow || 12;
  const radius = element.radius || 200;
  const arcDegrees = element.arcAngle || 90;
  const rowSpacing = element.rowSpacing || 30;
  const defaultCategory = element.categoryId || 'cat-cat1';

  const seats: Seat[] = [];
  const arcRad = (arcDegrees * Math.PI) / 180;
  const startAngle = -Math.PI / 2 - arcRad / 2;
  const angleStep = cols > 1 ? arcRad / (cols - 1) : 0;

  for (let r = 0; r < rows; r++) {
    const currentRadius = radius + r * rowSpacing;
    const rowChar = String.fromCharCode(65 + r); // A, B, C...

    for (let c = 0; c < cols; c++) {
      const angle = startAngle + c * angleStep;
      // Center of arc is at (width/2, currentRadius)
      const centerX = (element.width || 400) / 2;
      const x = centerX + Math.cos(angle) * currentRadius;
      const y = Math.sin(angle) * currentRadius + currentRadius;

      const existingSeat = element.seats?.[r * cols + c];

      seats.push({
        id: existingSeat ? existingSeat.id : `curved-${element.id}-${r}-${c}-${Math.random().toString(36).substr(2, 4)}`,
        label: `${c + 1}`,
        rowLabel: `R-${rowChar}`,
        x: Math.round(x),
        y: Math.round(y),
        status: existingSeat ? existingSeat.status : 'available',
        categoryId: existingSeat ? existingSeat.categoryId : defaultCategory
      });
    }
  }

  return seats;
}

/**
 * Calculates total bounding box of selected elements
 */
export function getSelectionBounds(elements: SeatMapElement[]) {
  if (elements.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  elements.forEach((el) => {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + el.width);
    maxY = Math.max(maxY, el.y + el.height);
  });

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: minX + (maxX - minX) / 2,
    centerY: minY + (maxY - minY) / 2
  };
}

/**
 * Align multiple selected elements
 */
export function alignElements(
  elements: SeatMapElement[],
  alignment: 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom'
): SeatMapElement[] {
  const bounds = getSelectionBounds(elements);
  if (!bounds) return elements;

  return elements.map((el) => {
    const newEl = { ...el };
    switch (alignment) {
      case 'left':
        newEl.x = bounds.x;
        break;
      case 'center-h':
        newEl.x = bounds.centerX - el.width / 2;
        break;
      case 'right':
        newEl.x = bounds.x + bounds.width - el.width;
        break;
      case 'top':
        newEl.y = bounds.y;
        break;
      case 'center-v':
        newEl.y = bounds.centerY - el.height / 2;
        break;
      case 'bottom':
        newEl.y = bounds.y + bounds.height - el.height;
        break;
    }
    return newEl;
  });
}
