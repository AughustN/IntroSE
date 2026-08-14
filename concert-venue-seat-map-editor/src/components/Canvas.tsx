import React, { useState, useRef, useEffect } from 'react';
import { 
  VenueMap, 
  SeatMapElement, 
  ActiveTool, 
  CategoryTier, 
  Seat 
} from '../types/seatmap';
import { buildBlockSeats, buildCurvedRowSeats } from '../utils/numbering';
import { RotateCw, Move, CheckCircle } from 'lucide-react';

interface CanvasProps {
  venue: VenueMap;
  selectedElementIds: string[];
  onSelectElements: (ids: string[], isMultiSelect?: boolean) => void;
  onUpdateElement: (updated: SeatMapElement) => void;
  activeTool: ActiveTool;
  zoom: number;
  selectedCategoryId: string;
  onSeatClickInBrushMode: (elementId: string, seatId: string) => void;
}

export const Canvas: React.FC<CanvasProps> = ({
  venue,
  selectedElementIds,
  onSelectElements,
  onUpdateElement,
  activeTool,
  zoom,
  selectedCategoryId,
  onSeatClickInBrushMode
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Pan & Drag State
  const [pan, setPan] = useState({ x: 50, y: 50 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Object Dragging State
  const [isDraggingObj, setIsDraggingObj] = useState(false);
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 });
  const [initialElementPos, setInitialElementPos] = useState<{ id: string; x: number; y: number }[]>([]);

  // Rotating State
  const [isRotating, setIsRotating] = useState<string | null>(null);
  const [rotateStartAngle, setRotateStartAngle] = useState(0);

  // Marquee Selection Box State
  const [marquee, setMarquee] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);

  // Seat Tooltip State
  const [hoveredSeat, setHoveredSeat] = useState<{ seat: Seat; elementTitle: string; category?: CategoryTier; mouseX: number; mouseY: number } | null>(null);

  // Categories Lookup Map
  const categoryMap = new Map<string, CategoryTier>(
    venue.categories.map((c) => [c.id, c])
  );

  // Handle Mouse Down on Canvas Container
  const handleMouseDown = (e: React.MouseEvent) => {
    // If clicking on background with Pan tool or Middle Mouse Button
    if (activeTool === 'pan' || e.button === 1) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }

    // Marquee Box Selection on background click
    const target = e.target as HTMLElement | SVGElement;
    const isBackground = target.id === 'canvas-svg' || target.id === 'canvas-grid' || target.id === 'canvas-container';

    if (isBackground && activeTool === 'select') {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const mouseCanvasX = (e.clientX - rect.left - pan.x) / zoom;
        const mouseCanvasY = (e.clientY - rect.top - pan.y) / zoom;
        setMarquee({ startX: mouseCanvasX, startY: mouseCanvasY, currentX: mouseCanvasX, currentY: mouseCanvasY });
        if (!e.shiftKey) {
          onSelectElements([]);
        }
      }
    }
  };

  // Handle Mouse Move
  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const currentCanvasX = (e.clientX - rect.left - pan.x) / zoom;
    const currentCanvasY = (e.clientY - rect.top - pan.y) / zoom;

    // Pan canvas
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      return;
    }

    // Marquee Dragging
    if (marquee) {
      setMarquee((prev) => prev ? { ...prev, currentX: currentCanvasX, currentY: currentCanvasY } : null);
      return;
    }

    // Object Dragging
    if (isDraggingObj && initialElementPos.length > 0) {
      const dx = currentCanvasX - dragStartPos.x;
      const dy = currentCanvasY - dragStartPos.y;

      initialElementPos.forEach(({ id, x, y }) => {
        const el = venue.elements.find((item) => item.id === id);
        if (el) {
          let newX = x + dx;
          let newY = y + dy;

          if (venue.snapToGrid) {
            newX = Math.round(newX / venue.gridSize) * venue.gridSize;
            newY = Math.round(newY / venue.gridSize) * venue.gridSize;
          }

          onUpdateElement({ ...el, x: newX, y: newY });
        }
      });
      return;
    }

    // Object Rotating
    if (isRotating) {
      const el = venue.elements.find((item) => item.id === isRotating);
      if (el) {
        const centerX = el.x + el.width / 2;
        const centerY = el.y + el.height / 2;
        const rad = Math.atan2(currentCanvasY - centerY, currentCanvasX - centerX);
        let deg = Math.round((rad * 180) / Math.PI);
        if (deg < 0) deg += 360;

        // Snap rotation to 15-degree increments if holding Shift
        if (e.shiftKey) {
          deg = Math.round(deg / 15) * 15;
        }

        onUpdateElement({ ...el, rotation: deg });
      }
      return;
    }
  };

  // Handle Mouse Up
  const handleMouseUp = () => {
    setIsPanning(false);
    setIsDraggingObj(false);
    setIsRotating(null);

    // Apply Marquee Box Selection
    if (marquee) {
      const minX = Math.min(marquee.startX, marquee.currentX);
      const maxX = Math.max(marquee.startX, marquee.currentX);
      const minY = Math.min(marquee.startY, marquee.currentY);
      const maxY = Math.max(marquee.startY, marquee.currentY);

      // Find all elements that intersect marquee box
      const selectedIds = venue.elements.filter((el) => {
        return (
          el.x >= minX &&
          el.x + el.width <= maxX &&
          el.y >= minY &&
          el.y + el.height <= maxY
        );
      }).map((el) => el.id);

      if (selectedIds.length > 0) {
        onSelectElements(selectedIds);
      }
      setMarquee(null);
    }
  };

  // Start Dragging Element
  const handleElementMouseDown = (e: React.MouseEvent, el: SeatMapElement) => {
    if (activeTool === 'pan') return;

    e.stopPropagation();
    const isMulti = e.shiftKey || e.metaKey;

    let newSelectedIds = selectedElementIds;
    if (!selectedElementIds.includes(el.id)) {
      newSelectedIds = isMulti ? [...selectedElementIds, el.id] : [el.id];
      onSelectElements(newSelectedIds);
    }

    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const currentCanvasX = (e.clientX - rect.left - pan.x) / zoom;
      const currentCanvasY = (e.clientY - rect.top - pan.y) / zoom;

      setIsDraggingObj(true);
      setDragStartPos({ x: currentCanvasX, y: currentCanvasY });
      setInitialElementPos(
        newSelectedIds.map((id) => {
          const item = venue.elements.find((v) => v.id === id);
          return { id, x: item?.x || 0, y: item?.y || 0 };
        })
      );
    }
  };

  // Start Rotating Handle
  const handleRotateMouseDown = (e: React.MouseEvent, elId: string) => {
    e.stopPropagation();
    setIsRotating(elId);
  };

  return (
    <div
      ref={containerRef}
      id="canvas-container"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      className={`relative w-full h-full overflow-hidden bg-[#080808] select-none ${
        activeTool === 'pan' || isPanning ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
      }`}
    >
      {/* Background Radial Dots Effect */}
      <div 
        className="absolute inset-0 opacity-[0.03] pointer-events-none" 
        style={{ backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '20px 20px' }} 
      />

      <svg
        id="canvas-svg"
        width="100%"
        height="100%"
        className="w-full h-full block relative z-10"
      >
        <defs>
          {/* Grid Pattern */}
          <pattern
            id="canvas-grid"
            width={venue.gridSize * zoom}
            height={venue.gridSize * zoom}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${venue.gridSize * zoom} 0 L 0 0 0 ${venue.gridSize * zoom}`}
              fill="none"
              stroke="rgba(255, 255, 255, 0.04)"
              strokeWidth="1"
            />
          </pattern>

          {/* Major Grid Pattern */}
          <pattern
            id="canvas-grid-major"
            width={venue.gridSize * 5 * zoom}
            height={venue.gridSize * 5 * zoom}
            patternUnits="userSpaceOnUse"
          >
            <rect
              width={venue.gridSize * 5 * zoom}
              height={venue.gridSize * 5 * zoom}
              fill="url(#canvas-grid)"
            />
            <path
              d={`M ${venue.gridSize * 5 * zoom} 0 L 0 0 0 ${venue.gridSize * 5 * zoom}`}
              fill="none"
              stroke="rgba(255, 255, 255, 0.08)"
              strokeWidth="1.5"
            />
          </pattern>

          {/* Stage Stripe Effect */}
          <pattern id="stage-stripe" width="20" height="20" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="20" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
          </pattern>
        </defs>

        {/* Background Grid */}
        <rect width="100%" height="100%" fill="#080808" />
        <rect width="100%" height="100%" fill="url(#canvas-grid-major)" />

        {/* Main Canvas Workspace Transform Layer */}
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          
          {/* Canvas Outer Boundary Box */}
          <rect
            x={0}
            y={0}
            width={venue.canvasWidth}
            height={venue.canvasHeight}
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth={2}
            strokeDasharray="6 6"
          />

          {/* Blueprint Image Overlay */}
          {venue.blueprint.visible && venue.blueprint.imageUrl && (
            <image
              href={venue.blueprint.imageUrl}
              x={venue.blueprint.x}
              y={venue.blueprint.y}
              width={venue.canvasWidth * venue.blueprint.scale}
              opacity={venue.blueprint.opacity}
              style={{ pointerEvents: 'none' }}
            />
          )}

          {/* Render All Venue Elements */}
          {venue.elements.map((el) => {
            const isSelected = selectedElementIds.includes(el.id);
            const defaultCat = categoryMap.get(el.categoryId || '') || venue.categories[0];

            return (
              <g
                key={el.id}
                transform={`translate(${el.x}, ${el.y}) rotate(${el.rotation || 0}, ${el.width / 2}, ${el.height / 2})`}
                onMouseDown={(e) => handleElementMouseDown(e, el)}
                className="cursor-pointer group"
              >
                {/* 1. STAGE ELEMENT */}
                {el.type === 'stage' && (
                  <g>
                    <rect
                      x={0}
                      y={0}
                      width={el.width}
                      height={el.height}
                      rx={6}
                      fill={el.backgroundColor || '#1A1A1A'}
                      stroke={isSelected ? '#f97316' : el.borderColor || 'rgba(255, 255, 255, 0.2)'}
                      strokeWidth={isSelected ? 3 : 1.5}
                      className="shadow-2xl"
                    />
                    <rect
                      x={0}
                      y={0}
                      width={el.width}
                      height={el.height}
                      rx={6}
                      fill="url(#stage-stripe)"
                    />
                    <text
                      x={el.width / 2}
                      y={el.height / 2 + 5}
                      textAnchor="middle"
                      fill={el.textColor || '#f8fafc'}
                      fontSize={el.fontSize || 14}
                      fontWeight="bold"
                      letterSpacing={4}
                      className="select-none font-sans uppercase tracking-[4px]"
                    >
                      {el.label || el.title}
                    </text>
                  </g>
                )}

                {/* 2. STANDING GA ZONE */}
                {el.type === 'ga-zone' && (
                  <g>
                    <rect
                      x={0}
                      y={0}
                      width={el.width}
                      height={el.height}
                      rx={10}
                      fill={el.fillColor || 'rgba(249, 115, 22, 0.15)'}
                      stroke={isSelected ? '#f97316' : defaultCat?.color || '#f97316'}
                      strokeWidth={isSelected ? 3 : 1.5}
                      strokeDasharray="4 4"
                    />
                    <text
                      x={el.width / 2}
                      y={el.height / 2 - 8}
                      textAnchor="middle"
                      fill="#fb923c"
                      fontSize={13}
                      fontWeight="bold"
                    >
                      {el.label || el.title}
                    </text>
                    <text
                      x={el.width / 2}
                      y={el.height / 2 + 14}
                      textAnchor="middle"
                      fill="#ffedd5"
                      fontSize={10}
                      className="font-mono"
                    >
                      Capacity: {el.capacity || 200}
                    </text>
                  </g>
                )}

                {/* 3. SEATING BLOCK & CURVED ROW */}
                {(el.type === 'seating-block' || el.type === 'curved-row' || el.type === 'single-row') && (
                  <g>
                    {/* Outer Block Frame Border */}
                    <rect
                      x={-6}
                      y={-6}
                      width={el.width + 12}
                      height={el.height + 12}
                      rx={6}
                      fill="rgba(18, 18, 18, 0.5)"
                      stroke={isSelected ? '#f97316' : 'rgba(255, 255, 255, 0.08)'}
                      strokeWidth={isSelected ? 2 : 1}
                      strokeDasharray={isSelected ? 'none' : '2 2'}
                    />

                    {/* Section Title Header */}
                    <text
                      x={el.width / 2}
                      y={-12}
                      textAnchor="middle"
                      fill="#e0e0e0"
                      fontSize={11}
                      fontWeight="600"
                    >
                      {el.title}
                    </text>

                    {/* Render Rendered Seats */}
                    {(el.seats || (el.type === 'seating-block' ? buildBlockSeats(el) : buildCurvedRowSeats(el))).map((seat) => {
                      const cat = categoryMap.get(seat.categoryId) || defaultCat;
                      const seatRadius = 8;

                      return (
                        <g
                          key={seat.id}
                          transform={`translate(${seat.x + 10}, ${seat.y + 10})`}
                          onClick={(e) => {
                            if (activeTool === 'brush') {
                              e.stopPropagation();
                              onSeatClickInBrushMode(el.id, seat.id);
                            }
                          }}
                          onMouseEnter={(e) => {
                            setHoveredSeat({
                              seat,
                              elementTitle: el.title,
                              category: cat,
                              mouseX: e.clientX,
                              mouseY: e.clientY
                            });
                          }}
                          onMouseLeave={() => setHoveredSeat(null)}
                          className="hover:scale-125 transition-transform origin-center"
                        >
                          <circle
                            r={seatRadius}
                            fill={seat.status === 'blocked' ? '#334155' : cat?.color || '#f97316'}
                            opacity={seat.status === 'blocked' ? 0.3 : 1}
                            stroke={seat.isAccessible ? '#06b6d4' : '#080808'}
                            strokeWidth={seat.isAccessible ? 2 : 1}
                          />
                          <text
                            y={3}
                            textAnchor="middle"
                            fill="#ffffff"
                            fontSize={7}
                            fontWeight="bold"
                            className="pointer-events-none select-none font-mono"
                          >
                            {seat.label}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                )}

                {/* 4. VIP TABLE WITH SEATS */}
                {el.type === 'vip-table' && (
                  <g>
                    {/* Table Center Shape */}
                    <circle
                      cx={el.width / 2}
                      cy={el.height / 2}
                      r={24}
                      fill="#1e1e1e"
                      stroke={isSelected ? '#f97316' : defaultCat?.color || '#f97316'}
                      strokeWidth={isSelected ? 3 : 2}
                    />
                    <text
                      x={el.width / 2}
                      y={el.height / 2 + 4}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize={11}
                      fontWeight="bold"
                    >
                      {el.label || 'T'}
                    </text>

                    {/* Surrounding Chairs */}
                    {(el.seats || []).map((seat) => {
                      const cat = categoryMap.get(seat.categoryId) || defaultCat;
                      return (
                        <circle
                          key={seat.id}
                          cx={seat.x}
                          cy={seat.y}
                          r={7}
                          fill={cat?.color || '#f97316'}
                          stroke="#080808"
                          strokeWidth={1}
                        />
                      );
                    })}
                  </g>
                )}

                {/* 5. INDIVIDUAL SEAT */}
                {el.type === 'individual-seat' && (
                  <g>
                    <circle
                      cx={12}
                      cy={12}
                      r={10}
                      fill={defaultCat?.color || '#10b981'}
                      stroke={isSelected ? '#ffffff' : '#080808'}
                      strokeWidth={isSelected ? 2 : 1}
                    />
                    <text
                      x={12}
                      y={16}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize={9}
                      fontWeight="bold"
                    >
                      {el.label || '1'}
                    </text>
                  </g>
                )}

                {/* 6. EMERGENCY EXIT DOOR */}
                {el.type === 'exit' && (
                  <g>
                    <rect
                      x={0}
                      y={0}
                      width={el.width}
                      height={el.height}
                      rx={4}
                      fill="#059669"
                      stroke="#10b981"
                      strokeWidth={1.5}
                    />
                    <text
                      x={el.width / 2}
                      y={el.height / 2 + 4}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize={11}
                      fontWeight="bold"
                    >
                      {el.label || 'EXIT'}
                    </text>
                  </g>
                )}

                {/* 7. TEXT LABEL */}
                {el.type === 'text' && (
                  <g>
                    {el.backgroundColor && (
                      <rect
                        x={0}
                        y={0}
                        width={el.width}
                        height={el.height}
                        rx={4}
                        fill={el.backgroundColor}
                      />
                    )}
                    <text
                      x={el.width / 2}
                      y={el.height / 2 + 5}
                      textAnchor="middle"
                      fill={el.textColor || '#e0e0e0'}
                      fontSize={el.fontSize || 13}
                      fontWeight="600"
                    >
                      {el.label || el.title}
                    </text>
                  </g>
                )}

                {/* SELECTION BOUNDING BOX & ROTATE HANDLE */}
                {isSelected && activeTool === 'select' && (
                  <g className="pointer-events-auto">
                    <rect
                      x={-8}
                      y={-8}
                      width={el.width + 16}
                      height={el.height + 16}
                      fill="none"
                      stroke="#f97316"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                    />

                    {/* Rotation Handle */}
                    <line
                      x1={el.width / 2}
                      y1={-8}
                      x2={el.width / 2}
                      y2={-28}
                      stroke="#f97316"
                      strokeWidth={2}
                    />
                    <circle
                      cx={el.width / 2}
                      cy={-28}
                      r={7}
                      fill="#f97316"
                      stroke="#ffffff"
                      strokeWidth={1.5}
                      onMouseDown={(e) => handleRotateMouseDown(e, el.id)}
                      className="cursor-grab hover:scale-125 transition-transform"
                    />
                  </g>
                )}
              </g>
            );
          })}

          {/* Marquee Selection Rect */}
          {marquee && (
            <rect
              x={Math.min(marquee.startX, marquee.currentX)}
              y={Math.min(marquee.startY, marquee.currentY)}
              width={Math.abs(marquee.currentX - marquee.startX)}
              height={Math.abs(marquee.currentY - marquee.startY)}
              fill="rgba(249, 115, 22, 0.15)"
              stroke="#f97316"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          )}
        </g>
      </svg>

      {/* Seat Hover Tooltip */}
      {hoveredSeat && (
        <div
          className="fixed z-50 pointer-events-none bg-[#121212]/95 backdrop-blur border border-white/10 text-[#E0E0E0] text-xs px-3 py-2 rounded-md shadow-2xl font-sans space-y-1 transform -translate-x-1/2 -translate-y-full mb-3"
          style={{ left: hoveredSeat.mouseX, top: hoveredSeat.mouseY }}
        >
          <div className="font-semibold text-orange-400 flex items-center justify-between gap-4">
            <span>{hoveredSeat.elementTitle}</span>
            <span 
              className="w-2.5 h-2.5 rounded-full" 
              style={{ backgroundColor: hoveredSeat.category?.color }} 
            />
          </div>
          <div className="flex items-center gap-3 text-white/70 font-mono text-[11px]">
            <span>Row: <strong>{hoveredSeat.seat.rowLabel}</strong></span>
            <span>Seat: <strong>{hoveredSeat.seat.label}</strong></span>
          </div>
          <div className="text-orange-400 font-bold font-mono border-t border-white/10 pt-1 flex items-center justify-between">
            <span>{hoveredSeat.category?.name}</span>
            <span>${hoveredSeat.category?.price}</span>
          </div>
        </div>
      )}
    </div>
  );
};
