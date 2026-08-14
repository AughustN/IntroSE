import React from 'react';
import { 
  Layout, 
  Eye, 
  BookOpen, 
  Download, 
  Upload, 
  Plus, 
  RotateCcw, 
  RotateCw, 
  ZoomIn, 
  ZoomOut, 
  Grid, 
  Sparkles, 
  Save, 
  Palette,
  Image as ImageIcon,
  HelpCircle
} from 'lucide-react';
import { VenueMap } from '../types/seatmap';
import { PRESETS_LIST } from '../data/presets';

interface NavbarProps {
  venue: VenueMap;
  onSelectPreset: (preset: VenueMap) => void;
  activeTab: 'editor' | 'buyer' | 'tutorial' | 'export';
  setActiveTab: (tab: 'editor' | 'buyer' | 'tutorial' | 'export') => void;
  zoom: number;
  setZoom: (z: number | ((prev: number) => number)) => void;
  snapToGrid: boolean;
  setSnapToGrid: (snap: boolean) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onOpenTierManager: () => void;
  onOpenBlueprintModal: () => void;
  onResetCanvas: () => void;
  totalSeatsCount: number;
  totalCapacity: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  venue,
  onSelectPreset,
  activeTab,
  setActiveTab,
  zoom,
  setZoom,
  snapToGrid,
  setSnapToGrid,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onOpenTierManager,
  onOpenBlueprintModal,
  onResetCanvas,
  totalSeatsCount,
  totalCapacity
}) => {
  return (
    <header className="bg-[#121212] border-b border-white/10 text-[#E0E0E0] px-6 py-2.5 flex items-center justify-between shadow-md z-30 select-none">
      {/* Brand & Preset Dropdown */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-orange-500 rounded flex items-center justify-center font-bold text-black text-base shadow-sm">
            V
          </div>
          <span className="font-semibold text-lg tracking-tight text-white">
            SeatMap.Pro <span className="text-white/40 font-normal ml-2 hidden sm:inline">/ {venue.name}</span>
          </span>
        </div>

        <div className="h-5 w-px bg-white/10 hidden sm:block" />

        {/* Preset Selector */}
        <div className="relative group hidden md:block">
          <select 
            onChange={(e) => {
              const preset = PRESETS_LIST.find(p => p.id === e.target.value);
              if (preset) onSelectPreset(preset);
            }}
            value={venue.id}
            className="bg-black/40 border border-white/10 hover:border-white/20 text-[#E0E0E0] text-xs rounded-md px-3 py-1.5 focus:ring-1 focus:ring-orange-500 focus:outline-none cursor-pointer pr-8 font-medium"
          >
            <optgroup label="Load Venue Template">
              {PRESETS_LIST.map((p) => (
                <option key={p.id} value={p.id} className="bg-[#121212] text-white">
                  {p.name}
                </option>
              ))}
            </optgroup>
          </select>
        </div>

        <div className="text-xs text-white/50 hidden xl:flex items-center gap-3 bg-white/5 px-3 py-1.5 rounded-md border border-white/10">
          <span>Seats: <strong className="text-orange-400 font-mono">{totalSeatsCount}</strong></span>
          <span className="text-white/20">•</span>
          <span>Max Capacity: <strong className="text-blue-400 font-mono">{totalCapacity}</strong></span>
        </div>
      </div>

      {/* Main View Mode Switcher */}
      <div className="flex items-center bg-white/5 rounded-md p-1 border border-white/10">
        <button
          onClick={() => setActiveTab('editor')}
          className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition-all ${
            activeTab === 'editor'
              ? 'bg-orange-600 text-white shadow-sm'
              : 'text-white/50 hover:text-white hover:bg-white/5'
          }`}
        >
          <Layout className="w-3.5 h-3.5" />
          <span>Venue Editor</span>
        </button>

        <button
          onClick={() => setActiveTab('buyer')}
          className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition-all ${
            activeTab === 'buyer'
              ? 'bg-orange-600 text-white shadow-sm'
              : 'text-white/50 hover:text-white hover:bg-white/5'
          }`}
        >
          <Eye className="w-3.5 h-3.5" />
          <span>Buyer Seat Picker</span>
          <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse ml-0.5" />
        </button>

        <button
          onClick={() => setActiveTab('tutorial')}
          className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition-all ${
            activeTab === 'tutorial'
              ? 'bg-orange-600 text-white shadow-sm'
              : 'text-white/50 hover:text-white hover:bg-white/5'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Integration Guide</span>
        </button>

        <button
          onClick={() => setActiveTab('export')}
          className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition-all ${
            activeTab === 'export'
              ? 'bg-orange-600 text-white shadow-sm'
              : 'text-white/50 hover:text-white hover:bg-white/5'
          }`}
        >
          <Download className="w-3.5 h-3.5" />
          <span>JSON / Embed</span>
        </button>
      </div>

      {/* Quick Action Controls */}
      <div className="flex items-center gap-2">
        {/* Undo / Redo */}
        {activeTab === 'editor' && (
          <>
            <div className="flex items-center bg-white/5 rounded-md p-0.5 border border-white/10">
              <button
                disabled={!canUndo}
                onClick={onUndo}
                title="Undo (Ctrl+Z)"
                className="p-1.5 text-white/50 hover:text-white disabled:opacity-20 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                disabled={!canRedo}
                onClick={onRedo}
                title="Redo (Ctrl+Y)"
                className="p-1.5 text-white/50 hover:text-white disabled:opacity-20 transition-colors"
              >
                <RotateCw className="w-4 h-4" />
              </button>
            </div>

            {/* Zoom Controls */}
            <div className="flex items-center bg-white/5 rounded-md p-0.5 border border-white/10 hidden sm:flex">
              <button
                onClick={() => setZoom(z => Math.max(0.3, z - 0.1))}
                title="Zoom Out"
                className="p-1.5 text-white/50 hover:text-white transition-colors"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-[11px] font-mono px-1 text-white/70 w-10 text-center">
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() => setZoom(z => Math.min(2.5, z + 0.1))}
                title="Zoom In"
                className="p-1.5 text-white/50 hover:text-white transition-colors"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>

            {/* Snap to Grid */}
            <button
              onClick={() => setSnapToGrid(!snapToGrid)}
              title="Toggle Snap to Grid"
              className={`p-1.5 rounded-md border text-xs font-medium transition-all ${
                snapToGrid
                  ? 'bg-orange-500/10 text-orange-400 border-orange-500/40'
                  : 'bg-white/5 text-white/50 border-white/10 hover:text-white'
              }`}
            >
              <Grid className="w-4 h-4" />
            </button>

            {/* Tier Manager */}
            <button
              onClick={onOpenTierManager}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-[#E0E0E0] rounded-md text-xs font-medium transition-colors"
              title="Manage Category Tiers & Pricing"
            >
              <Palette className="w-3.5 h-3.5 text-orange-400" />
              <span className="hidden md:inline">Tier Pricing</span>
            </button>

            {/* Blueprint Background */}
            <button
              onClick={onOpenBlueprintModal}
              className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-md text-xs font-medium transition-colors ${
                venue.blueprint.imageUrl
                  ? 'bg-orange-500/20 border-orange-500/40 text-orange-300'
                  : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
              }`}
              title="Import or adjust venue blueprint layout background image"
            >
              <ImageIcon className="w-3.5 h-3.5 text-orange-400" />
              <span className="hidden md:inline">Blueprint</span>
            </button>
          </>
        )}

        {/* Export / Guide Quick Button */}
        <button
          onClick={() => setActiveTab('tutorial')}
          className="bg-orange-600 hover:bg-orange-500 text-white px-4 py-1.5 rounded-md text-sm font-medium shadow flex items-center gap-1.5 transition-all"
        >
          <HelpCircle className="w-4 h-4" />
          <span className="hidden lg:inline">How To Implement</span>
        </button>
      </div>
    </header>
  );
};
