import React from 'react';
import { 
  VenueMap, 
  SeatMapElement, 
  CategoryTier, 
  ActiveTool 
} from '../types/seatmap';
import { 
  buildBlockSeats, 
  buildCurvedRowSeats, 
  alignElements 
} from '../utils/numbering';
import { 
  Settings, 
  Layers, 
  Copy, 
  Trash2, 
  RotateCcw, 
  AlignLeft, 
  AlignCenter, 
  AlignRight, 
  AlignStartVertical, 
  AlignCenterVertical, 
  AlignEndVertical,
  Sliders,
  Grid,
  Hash,
  Sparkles
} from 'lucide-react';

interface PropertiesPanelProps {
  venue: VenueMap;
  selectedElementIds: string[];
  onUpdateVenue: (updated: VenueMap) => void;
  onUpdateElement: (updated: SeatMapElement) => void;
  onUpdateMultipleElements: (updatedList: SeatMapElement[]) => void;
  onDeleteSelected: () => void;
  onDuplicateSelected: () => void;
  categories: CategoryTier[];
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  venue,
  selectedElementIds,
  onUpdateVenue,
  onUpdateElement,
  onUpdateMultipleElements,
  onDeleteSelected,
  onDuplicateSelected,
  categories
}) => {
  const selectedElements = venue.elements.filter((el) => selectedElementIds.includes(el.id));
  const selectedElement = selectedElements.length === 1 ? selectedElements[0] : null;

  // Align Handler
  const handleAlign = (alignment: 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom') => {
    if (selectedElements.length < 2) return;
    const aligned = alignElements(selectedElements, alignment);
    onUpdateMultipleElements(aligned);
  };

  // Regeneration helper when seating parameters change
  const handleRegenerateBlock = (updated: SeatMapElement) => {
    if (updated.type === 'seating-block' || updated.type === 'single-row') {
      const seats = buildBlockSeats(updated);
      onUpdateElement({ ...updated, seats });
    } else if (updated.type === 'curved-row') {
      const seats = buildCurvedRowSeats(updated);
      onUpdateElement({ ...updated, seats });
    } else {
      onUpdateElement(updated);
    }
  };

  return (
    <aside className="w-80 bg-[#121212] border-l border-white/10 text-[#E0E0E0] flex flex-col h-full overflow-y-auto select-none z-20 shadow-xl font-sans">
      
      {/* 1. NO SELECTION - VENUE LEVEL PROPERTIES */}
      {selectedElements.length === 0 && (
        <div className="p-4 space-y-5">
          <div className="flex items-center gap-2 text-orange-400 font-bold text-sm border-b border-white/10 pb-2">
            <Settings className="w-4 h-4" />
            <span>Venue Configuration</span>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="block text-white/50 mb-1 font-medium">Venue Name</label>
              <input
                type="text"
                value={venue.name}
                onChange={(e) => onUpdateVenue({ ...venue, name: e.target.value })}
                className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-[#E0E0E0] focus:outline-none focus:ring-1 focus:ring-orange-500 font-medium"
              />
            </div>

            <div>
              <label className="block text-white/50 mb-1 font-medium">Description</label>
              <textarea
                rows={2}
                value={venue.description}
                onChange={(e) => onUpdateVenue({ ...venue, description: e.target.value })}
                className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-[#E0E0E0] focus:outline-none focus:ring-1 focus:ring-orange-500 font-normal"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-white/50 mb-1 font-medium">Canvas Width (px)</label>
                <input
                  type="number"
                  step={100}
                  value={venue.canvasWidth}
                  onChange={(e) => onUpdateVenue({ ...venue, canvasWidth: Number(e.target.value) })}
                  className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-white/80 font-mono"
                />
              </div>

              <div>
                <label className="block text-white/50 mb-1 font-medium">Canvas Height (px)</label>
                <input
                  type="number"
                  step={100}
                  value={venue.canvasHeight}
                  onChange={(e) => onUpdateVenue({ ...venue, canvasHeight: Number(e.target.value) })}
                  className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-white/80 font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-white/50 mb-1 font-medium">Grid Snap Size (px)</label>
              <select
                value={venue.gridSize}
                onChange={(e) => onUpdateVenue({ ...venue, gridSize: Number(e.target.value) })}
                className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-[#E0E0E0] font-mono cursor-pointer"
              >
                <option value={10} className="bg-[#121212]">10 px</option>
                <option value={20} className="bg-[#121212]">20 px (Default)</option>
                <option value={30} className="bg-[#121212]">30 px</option>
                <option value={50} className="bg-[#121212]">50 px</option>
              </select>
            </div>
          </div>

          <div className="pt-3 border-t border-white/10">
            <div className="text-xs font-bold text-white/40 mb-2">Category Tiers Summary</div>
            <div className="space-y-1.5">
              {venue.categories.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-xs bg-white/5 px-2.5 py-1.5 rounded-md border border-white/10">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: c.color }} />
                    <span className="font-medium text-[#E0E0E0]">{c.name}</span>
                  </div>
                  <span className="font-mono font-bold text-orange-400">${c.price}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 2. MULTIPLE SELECTION - ALIGNMENT & BULK ACTIONS */}
      {selectedElements.length > 1 && (
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <span className="text-xs font-bold text-orange-400 uppercase tracking-wider">
              {selectedElements.length} Objects Selected
            </span>
            <button
              onClick={onDeleteSelected}
              className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 bg-rose-500/10 px-2 py-1 rounded border border-rose-500/30"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete All</span>
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-white/50">Align Elements</label>
            <div className="grid grid-cols-3 gap-1 bg-black/40 p-1 rounded-md border border-white/10">
              <button onClick={() => handleAlign('left')} title="Align Left" className="p-2 hover:bg-white/10 text-white/70 hover:text-white rounded flex justify-center">
                <AlignLeft className="w-4 h-4" />
              </button>
              <button onClick={() => handleAlign('center-h')} title="Align Horizontal Center" className="p-2 hover:bg-white/10 text-white/70 hover:text-white rounded flex justify-center">
                <AlignCenter className="w-4 h-4" />
              </button>
              <button onClick={() => handleAlign('right')} title="Align Right" className="p-2 hover:bg-white/10 text-white/70 hover:text-white rounded flex justify-center">
                <AlignRight className="w-4 h-4" />
              </button>
              <button onClick={() => handleAlign('top')} title="Align Top" className="p-2 hover:bg-white/10 text-white/70 hover:text-white rounded flex justify-center">
                <AlignStartVertical className="w-4 h-4" />
              </button>
              <button onClick={() => handleAlign('center-v')} title="Align Vertical Center" className="p-2 hover:bg-white/10 text-white/70 hover:text-white rounded flex justify-center">
                <AlignCenterVertical className="w-4 h-4" />
              </button>
              <button onClick={() => handleAlign('bottom')} title="Align Bottom" className="p-2 hover:bg-white/10 text-white/70 hover:text-white rounded flex justify-center">
                <AlignEndVertical className="w-4 h-4" />
              </button>
            </div>
          </div>

          <button
            onClick={onDuplicateSelected}
            className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 text-[#E0E0E0] py-2 rounded-md text-xs font-semibold border border-white/10"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Duplicate Selected ({selectedElements.length})</span>
          </button>
        </div>
      )}

      {/* 3. SINGLE ELEMENT SELECTED - FULL PARAMETRIC INSPECTOR */}
      {selectedElement && (
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <span className="text-xs font-bold text-orange-400 uppercase tracking-wider truncate">
              {selectedElement.type.toUpperCase()} INSPECTOR
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={onDuplicateSelected}
                title="Duplicate Element"
                className="p-1.5 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded border border-white/10"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onDeleteSelected}
                title="Delete Element"
                className="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 rounded border border-rose-500/30"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="space-y-3 text-xs">
            {/* Title / Section Name */}
            <div>
              <label className="block text-white/50 mb-1 font-medium">Section Title / Label</label>
              <input
                type="text"
                value={selectedElement.title}
                onChange={(e) => onUpdateElement({ ...selectedElement, title: e.target.value })}
                className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-[#E0E0E0] font-semibold"
              />
            </div>

            {/* Category / Tier Selector */}
            <div>
              <label className="block text-white/50 mb-1 font-medium">Default Tier Pricing</label>
              <select
                value={selectedElement.categoryId || ''}
                onChange={(e) => handleRegenerateBlock({ ...selectedElement, categoryId: e.target.value })}
                className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-[#E0E0E0] font-medium"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id} className="bg-[#121212]">
                    {c.name} (${c.price})
                  </option>
                ))}
              </select>
            </div>

            {/* Transform Controls (X, Y, Rotation) */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-white/40 mb-1 font-medium">Pos X</label>
                <input
                  type="number"
                  value={selectedElement.x}
                  onChange={(e) => onUpdateElement({ ...selectedElement, x: Number(e.target.value) })}
                  className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-1 text-orange-400 font-mono font-bold"
                />
              </div>

              <div>
                <label className="block text-white/40 mb-1 font-medium">Pos Y</label>
                <input
                  type="number"
                  value={selectedElement.y}
                  onChange={(e) => onUpdateElement({ ...selectedElement, y: Number(e.target.value) })}
                  className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-1 text-orange-400 font-mono font-bold"
                />
              </div>

              <div>
                <label className="block text-white/40 mb-1 font-medium">Rotate (°)</label>
                <input
                  type="number"
                  value={selectedElement.rotation || 0}
                  onChange={(e) => onUpdateElement({ ...selectedElement, rotation: Number(e.target.value) })}
                  className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-1 text-white/80 font-mono"
                />
              </div>
            </div>

            {/* Rotation Slider */}
            <div>
              <div className="flex justify-between text-white/50 mb-1">
                <span>Angle Slider</span>
                <span className="font-mono text-orange-400">{selectedElement.rotation || 0}°</span>
              </div>
              <input
                type="range"
                min="0"
                max="360"
                step="5"
                value={selectedElement.rotation || 0}
                onChange={(e) => onUpdateElement({ ...selectedElement, rotation: Number(e.target.value) })}
                className="w-full accent-orange-500 cursor-pointer"
              />
            </div>

            {/* SEATING BLOCK SPECIFIC CONTROLS */}
            {(selectedElement.type === 'seating-block' || selectedElement.type === 'single-row') && (
              <div className="pt-3 border-t border-white/10 space-y-3">
                <div className="text-xs font-bold text-orange-400 flex items-center gap-1">
                  <Grid className="w-3.5 h-3.5" />
                  <span>Seating Matrix Generator</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-white/40 mb-1">Rows Count</label>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={selectedElement.rowsCount || 4}
                      onChange={(e) => handleRegenerateBlock({ ...selectedElement, rowsCount: Number(e.target.value) })}
                      className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1 text-[#E0E0E0] font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-white/40 mb-1">Seats / Row</label>
                    <input
                      type="number"
                      min={1}
                      max={40}
                      value={selectedElement.seatsPerRow || 10}
                      onChange={(e) => handleRegenerateBlock({ ...selectedElement, seatsPerRow: Number(e.target.value) })}
                      className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1 text-[#E0E0E0] font-mono"
                    />
                  </div>
                </div>

                {/* Row Label Scheme */}
                <div>
                  <label className="block text-white/40 mb-1">Row Naming Pattern</label>
                  <select
                    value={selectedElement.rowLabelType || 'alpha-asc'}
                    onChange={(e) => handleRegenerateBlock({ ...selectedElement, rowLabelType: e.target.value as any })}
                    className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-[#E0E0E0]"
                  >
                    <option value="alpha-asc" className="bg-[#121212]">Letters A, B, C... (Top to Bottom)</option>
                    <option value="alpha-desc" className="bg-[#121212]">Letters Z, Y, X... (Bottom to Top)</option>
                    <option value="num-asc" className="bg-[#121212]">Numbers 1, 2, 3...</option>
                    <option value="num-desc" className="bg-[#121212]">Numbers 10, 9, 8...</option>
                  </select>
                </div>

                {/* Seat Label Scheme */}
                <div>
                  <label className="block text-white/40 mb-1">Seat Numbering Pattern</label>
                  <select
                    value={selectedElement.seatLabelType || 'num-asc'}
                    onChange={(e) => handleRegenerateBlock({ ...selectedElement, seatLabelType: e.target.value as any })}
                    className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-[#E0E0E0]"
                  >
                    <option value="num-asc" className="bg-[#121212]">1, 2, 3... (Left to Right)</option>
                    <option value="num-desc" className="bg-[#121212]">...3, 2, 1 (Right to Left)</option>
                    <option value="even" className="bg-[#121212]">Even Numbers (2, 4, 6...)</option>
                    <option value="odd" className="bg-[#121212]">Odd Numbers (1, 3, 5...)</option>
                  </select>
                </div>

                <button
                  onClick={() => handleRegenerateBlock(selectedElement)}
                  className="w-full bg-orange-500/20 hover:bg-orange-500/30 text-orange-200 border border-orange-500/40 py-1.5 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Regenerate Seat Labels</span>
                </button>
              </div>
            )}

            {/* CURVED ROW SPECIFIC CONTROLS */}
            {selectedElement.type === 'curved-row' && (
              <div className="pt-3 border-t border-white/10 space-y-3">
                <div>
                  <label className="block text-white/40 mb-1">Curve Arc Angle (°)</label>
                  <input
                    type="range"
                    min="30"
                    max="180"
                    step="5"
                    value={selectedElement.arcAngle || 90}
                    onChange={(e) => handleRegenerateBlock({ ...selectedElement, arcAngle: Number(e.target.value) })}
                    className="w-full accent-orange-500 cursor-pointer"
                  />
                  <div className="text-right text-orange-400 font-mono text-[11px]">
                    {selectedElement.arcAngle || 90}°
                  </div>
                </div>

                <div>
                  <label className="block text-white/40 mb-1">Seats in Arc</label>
                  <input
                    type="number"
                    min={3}
                    max={30}
                    value={selectedElement.seatsPerRow || 12}
                    onChange={(e) => handleRegenerateBlock({ ...selectedElement, seatsPerRow: Number(e.target.value) })}
                    className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1 text-[#E0E0E0] font-mono"
                  />
                </div>
              </div>
            )}

            {/* GA ZONE SPECIFIC CONTROLS */}
            {selectedElement.type === 'ga-zone' && (
              <div className="pt-3 border-t border-white/10 space-y-3">
                <div>
                  <label className="block text-white/40 mb-1">Standing Capacity</label>
                  <input
                    type="number"
                    step={50}
                    value={selectedElement.capacity || 200}
                    onChange={(e) => onUpdateElement({ ...selectedElement, capacity: Number(e.target.value) })}
                    className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-orange-400 font-mono font-bold"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};
