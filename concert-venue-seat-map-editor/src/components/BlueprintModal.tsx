import React, { useState } from 'react';
import { BlueprintConfig } from '../types/seatmap';
import { X, Image as ImageIcon, Check, Eye, EyeOff, Sliders } from 'lucide-react';

interface BlueprintModalProps {
  blueprint: BlueprintConfig;
  onSaveBlueprint: (updated: BlueprintConfig) => void;
  onClose: () => void;
}

const SAMPLE_BLUEPRINTS = [
  {
    name: 'Concert Hall Blueprint Sample',
    url: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1200&q=80'
  },
  {
    name: 'Arena Stadium Outline Sample',
    url: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=1200&q=80'
  }
];

export const BlueprintModal: React.FC<BlueprintModalProps> = ({
  blueprint,
  onSaveBlueprint,
  onClose
}) => {
  const [config, setConfig] = useState<BlueprintConfig>(blueprint);

  const handleSave = () => {
    onSaveBlueprint(config);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 select-none font-sans">
      <div className="bg-[#121212] border border-white/10 text-[#E0E0E0] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-orange-500/20 text-orange-400 rounded-lg">
              <ImageIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-base text-white">Blueprint Background Tracing</h2>
              <p className="text-xs text-white/50">Overlay an architectural layout image to trace seating</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4 text-xs">
          {/* Visible Toggle */}
          <div className="flex items-center justify-between bg-black/40 p-3 rounded-xl border border-white/10">
            <span className="font-semibold text-[#E0E0E0]">Show Blueprint Image</span>
            <button
              onClick={() => setConfig({ ...config, visible: !config.visible })}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                config.visible
                  ? 'bg-orange-500 text-black'
                  : 'bg-white/10 text-white/50'
              }`}
            >
              {config.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              <span>{config.visible ? 'Visible' : 'Hidden'}</span>
            </button>
          </div>

          {/* Image URL Input */}
          <div>
            <label className="block text-white/50 mb-1 font-medium">Blueprint Image URL</label>
            <input
              type="text"
              value={config.imageUrl || ''}
              onChange={(e) => setConfig({ ...config, imageUrl: e.target.value })}
              placeholder="https://example.com/venue-blueprint.png"
              className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-[#E0E0E0] focus:outline-none focus:ring-1 focus:ring-orange-500 font-mono"
            />
          </div>

          {/* Sample Preset Blueprints */}
          <div>
            <label className="block text-white/50 mb-1 font-medium">Or Use Sample Blueprint</label>
            <div className="grid grid-cols-2 gap-2">
              {SAMPLE_BLUEPRINTS.map((b) => (
                <button
                  key={b.name}
                  onClick={() => setConfig({ ...config, imageUrl: b.url, visible: true })}
                  className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-left text-white/80 font-medium truncate cursor-pointer transition-colors"
                >
                  {b.name}
                </button>
              ))}
            </div>
          </div>

          {/* Opacity Slider */}
          <div>
            <div className="flex justify-between text-white/50 mb-1">
              <span>Opacity</span>
              <span className="font-mono text-orange-400">{Math.round(config.opacity * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={config.opacity}
              onChange={(e) => setConfig({ ...config, opacity: Number(e.target.value) })}
              className="w-full accent-orange-500 cursor-pointer"
            />
          </div>

          {/* Scale Factor */}
          <div>
            <div className="flex justify-between text-white/50 mb-1">
              <span>Image Scale Factor</span>
              <span className="font-mono text-orange-400">{config.scale}x</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="2.5"
              step="0.1"
              value={config.scale}
              onChange={(e) => setConfig({ ...config, scale: Number(e.target.value) })}
              className="w-full accent-orange-500 cursor-pointer"
            />
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-white/10 bg-white/[0.02] flex items-center justify-between">
          <button
            onClick={() => setConfig({ ...config, imageUrl: null, visible: false })}
            className="text-xs text-rose-400 hover:text-rose-300 font-medium cursor-pointer"
          >
            Clear Blueprint
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-xl shadow-lg flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>Save Blueprint</span>
          </button>
        </div>
      </div>
    </div>
  );
};
