import React from 'react';
import { 
  MousePointer, 
  Hand, 
  Paintbrush, 
  Grid3x3, 
  CircleDot, 
  Rows3, 
  Armchair, 
  Disc, 
  Users, 
  Tv, 
  DoorOpen, 
  Type, 
  Plus, 
  Layers
} from 'lucide-react';
import { ActiveTool, CategoryTier } from '../types/seatmap';

interface ToolbarProps {
  activeTool: ActiveTool;
  setActiveTool: (tool: ActiveTool) => void;
  categories: CategoryTier[];
  selectedCategoryId: string;
  setSelectedCategoryId: (id: string) => void;
  onAddElement: (type: ActiveTool) => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  activeTool,
  setActiveTool,
  categories,
  selectedCategoryId,
  setSelectedCategoryId,
  onAddElement
}) => {
  return (
    <aside className="w-16 md:w-60 bg-[#121212] border-r border-white/10 text-[#E0E0E0] flex flex-col justify-between select-none z-20 shadow-lg font-sans">
      <div className="p-3 space-y-5 overflow-y-auto">
        {/* Navigation & Interaction Tools */}
        <div>
          <div className="text-[10px] uppercase tracking-widest text-orange-500 font-bold px-1 mb-2 hidden md:block">
            Canvas Tools
          </div>
          <div className="space-y-1.5">
            <button
              onClick={() => setActiveTool('select')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-all ${
                activeTool === 'select'
                  ? 'bg-orange-600 text-white shadow-sm'
                  : 'bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white'
              }`}
              title="Selection Pointer Tool (S)"
            >
              <MousePointer className="w-4 h-4 shrink-0" />
              <span className="hidden md:inline">Select & Move</span>
            </button>

            <button
              onClick={() => setActiveTool('pan')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-all ${
                activeTool === 'pan'
                  ? 'bg-orange-600 text-white shadow-sm'
                  : 'bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white'
              }`}
              title="Hand Pan Canvas Tool (H)"
            >
              <Hand className="w-4 h-4 shrink-0" />
              <span className="hidden md:inline">Hand Pan</span>
            </button>

            <button
              onClick={() => setActiveTool('brush')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-all ${
                activeTool === 'brush'
                  ? 'bg-orange-600 text-white shadow-sm'
                  : 'bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white'
              }`}
              title="Tier Paint Brush (B) - Click seats to apply active tier"
            >
              <Paintbrush className="w-4 h-4 shrink-0 text-orange-400" />
              <span className="hidden md:inline">Tier Painter</span>
            </button>
          </div>
        </div>

        <div className="h-px bg-white/10" />

        {/* Add Elements Section */}
        <div>
          <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold px-1 mb-2 hidden md:block">
            Add Elements
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
            <button
              onClick={() => onAddElement('add-block')}
              className="flex items-center gap-2 px-2.5 py-2 rounded-md text-xs font-medium bg-white/5 border border-white/10 hover:bg-white/10 text-white/80 transition-colors"
              title="Add Seating Block (Rows x Seats)"
            >
              <Grid3x3 className="w-4 h-4 text-orange-400 shrink-0" />
              <span className="hidden md:inline">Block</span>
            </button>

            <button
              onClick={() => onAddElement('add-curved')}
              className="flex items-center gap-2 px-2.5 py-2 rounded-md text-xs font-medium bg-white/5 border border-white/10 hover:bg-white/10 text-white/80 transition-colors"
              title="Add Curved Arc Seating Row"
            >
              <CircleDot className="w-4 h-4 text-orange-400 shrink-0" />
              <span className="hidden md:inline">Arc Row</span>
            </button>

            <button
              onClick={() => onAddElement('add-row')}
              className="flex items-center gap-2 px-2.5 py-2 rounded-md text-xs font-medium bg-white/5 border border-white/10 hover:bg-white/10 text-white/80 transition-colors"
              title="Add Single Row"
            >
              <Rows3 className="w-4 h-4 text-blue-400 shrink-0" />
              <span className="hidden md:inline">Row</span>
            </button>

            <button
              onClick={() => onAddElement('add-table')}
              className="flex items-center gap-2 px-2.5 py-2 rounded-md text-xs font-medium bg-white/5 border border-white/10 hover:bg-white/10 text-white/80 transition-colors"
              title="Add VIP Table with Chairs"
            >
              <Disc className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="hidden md:inline">Table</span>
            </button>

            <button
              onClick={() => onAddElement('add-ga')}
              className="flex items-center gap-2 px-2.5 py-2 rounded-md text-xs font-medium bg-white/5 border border-white/10 hover:bg-white/10 text-white/80 transition-colors"
              title="Add Standing General Admission (GA) Zone"
            >
              <Users className="w-4 h-4 text-pink-400 shrink-0" />
              <span className="hidden md:inline">GA Zone</span>
            </button>

            <button
              onClick={() => onAddElement('add-seat')}
              className="flex items-center gap-2 px-2.5 py-2 rounded-md text-xs font-medium bg-white/5 border border-white/10 hover:bg-white/10 text-white/80 transition-colors"
              title="Add Single Seat / Accessible Chair"
            >
              <Armchair className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="hidden md:inline">Seat</span>
            </button>

            <button
              onClick={() => onAddElement('add-stage')}
              className="flex items-center gap-2 px-2.5 py-2 rounded-md text-xs font-medium bg-white/5 border border-white/10 hover:bg-white/10 text-white/80 transition-colors"
              title="Add Performing Stage"
            >
              <Tv className="w-4 h-4 text-[#E0E0E0] shrink-0" />
              <span className="hidden md:inline">Stage</span>
            </button>

            <button
              onClick={() => onAddElement('add-exit')}
              className="flex items-center gap-2 px-2.5 py-2 rounded-md text-xs font-medium bg-white/5 border border-white/10 hover:bg-white/10 text-white/80 transition-colors"
              title="Add Emergency Exit / Door"
            >
              <DoorOpen className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="hidden md:inline">Exit</span>
            </button>

            <button
              onClick={() => onAddElement('add-text')}
              className="col-span-1 md:col-span-2 flex items-center gap-2 px-2.5 py-2 rounded-md text-xs font-medium bg-white/5 border border-white/10 hover:bg-white/10 text-white/80 transition-colors"
              title="Add Text Annotation Label"
            >
              <Type className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="hidden md:inline">Text Annotation</span>
            </button>
          </div>
        </div>

        <div className="h-px bg-white/10" />

        {/* Tier Swatch Selector */}
        <div>
          <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold px-1 mb-2 hidden md:block">
            Active Palette Tier
          </div>
          <div className="space-y-1">
            {categories.map((cat) => {
              const isSelected = selectedCategoryId === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategoryId(cat.id)}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs text-left transition-all ${
                    isSelected
                      ? 'bg-orange-500/10 border border-orange-500/40 text-orange-400 font-semibold'
                      : 'bg-white/5 border border-white/5 hover:border-white/10 text-white/70'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span 
                      className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm border border-white/20"
                      style={{ backgroundColor: cat.color }}
                    />
                    <span className="truncate hidden md:inline">{cat.name}</span>
                  </div>
                  <span className="text-[11px] font-mono font-bold text-white/50 hidden md:inline">
                    ${cat.price}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer Info */}
      <div className="p-3 border-t border-white/10 text-[10px] text-white/30 text-center hidden md:block">
        Click canvas objects to inspect properties or drag to position.
      </div>
    </aside>
  );
};
