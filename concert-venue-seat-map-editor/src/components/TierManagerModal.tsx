import React, { useState } from 'react';
import { CategoryTier } from '../types/seatmap';
import { X, Plus, Trash2, Palette, DollarSign, Tag, Check } from 'lucide-react';

interface TierManagerModalProps {
  categories: CategoryTier[];
  onSaveCategories: (updated: CategoryTier[]) => void;
  onClose: () => void;
}

const COLOR_PRESETS = [
  '#8b5cf6', // Violet
  '#3b82f6', // Blue
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ec4899', // Pink
  '#06b6d4', // Cyan
  '#ef4444', // Red
  '#a855f7', // Purple
  '#84cc16', // Lime
  '#f97316'  // Orange
];

export const TierManagerModal: React.FC<TierManagerModalProps> = ({
  categories,
  onSaveCategories,
  onClose
}) => {
  const [tierList, setTierList] = useState<CategoryTier[]>(categories);

  const handleAddTier = () => {
    const newTier: CategoryTier = {
      id: `cat-${Date.now()}`,
      name: `Tier ${tierList.length + 1}`,
      color: COLOR_PRESETS[tierList.length % COLOR_PRESETS.length],
      price: 100,
      ticketType: 'Standard Reserved',
      description: 'Standard reserved seating'
    };
    setTierList([...tierList, newTier]);
  };

  const handleUpdateTier = (id: string, field: keyof CategoryTier, value: any) => {
    setTierList(
      tierList.map((tier) => (tier.id === id ? { ...tier, [field]: value } : tier))
    );
  };

  const handleDeleteTier = (id: string) => {
    if (tierList.length <= 1) {
      alert('Must keep at least one category tier.');
      return;
    }
    setTierList(tierList.filter((t) => t.id !== id));
  };

  const handleSave = () => {
    onSaveCategories(tierList);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 select-none font-sans">
      <div className="bg-[#121212] border border-white/10 text-[#E0E0E0] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-orange-500/20 text-orange-400 rounded-lg">
              <Palette className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-base text-white">Tier Pricing & Category Manager</h2>
              <p className="text-xs text-white/50">Define seat categories, ticket prices, and color codes</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {tierList.map((tier) => (
            <div
              key={tier.id}
              className="bg-black/40 border border-white/10 rounded-xl p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-3">
                {/* Color Swatch & Name */}
                <div className="flex items-center gap-3 flex-1">
                  <div className="relative group shrink-0">
                    <input
                      type="color"
                      value={tier.color}
                      onChange={(e) => handleUpdateTier(tier.id, 'color', e.target.value)}
                      className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border-0 opacity-0 absolute inset-0 z-10"
                    />
                    <div
                      className="w-8 h-8 rounded-lg shadow border border-white/20 flex items-center justify-center"
                      style={{ backgroundColor: tier.color }}
                    >
                      <Palette className="w-4 h-4 text-white opacity-80" />
                    </div>
                  </div>

                  <input
                    type="text"
                    value={tier.name}
                    onChange={(e) => handleUpdateTier(tier.id, 'name', e.target.value)}
                    placeholder="Category Name"
                    className="bg-black/60 border border-white/10 rounded-lg px-3 py-1.5 text-sm font-semibold text-white focus:outline-none focus:ring-1 focus:ring-orange-500 flex-1"
                  />
                </div>

                {/* Ticket Price */}
                <div className="flex items-center gap-1 bg-black/60 border border-white/10 rounded-lg px-2.5 py-1.5 shrink-0">
                  <DollarSign className="w-4 h-4 text-orange-400 shrink-0" />
                  <input
                    type="number"
                    value={tier.price}
                    onChange={(e) => handleUpdateTier(tier.id, 'price', Number(e.target.value))}
                    className="w-20 bg-transparent text-sm font-bold font-mono text-orange-400 focus:outline-none text-right"
                  />
                </div>

                {/* Delete Tier */}
                <button
                  onClick={() => handleDeleteTier(tier.id)}
                  className="p-2 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-lg transition-colors shrink-0 cursor-pointer"
                  title="Delete Tier"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {/* Description & Type */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="block text-white/50 mb-1 font-medium">Ticket Type</label>
                  <input
                    type="text"
                    value={tier.ticketType || ''}
                    onChange={(e) => handleUpdateTier(tier.id, 'ticketType', e.target.value)}
                    placeholder="e.g. Reserved, VIP, GA"
                    className="w-full bg-black/60 border border-white/10 rounded-lg px-2.5 py-1 text-white/80"
                  />
                </div>
                <div>
                  <label className="block text-white/50 mb-1 font-medium">Perks / Description</label>
                  <input
                    type="text"
                    value={tier.description || ''}
                    onChange={(e) => handleUpdateTier(tier.id, 'description', e.target.value)}
                    placeholder="e.g. Free drink, Center sightline"
                    className="w-full bg-black/60 border border-white/10 rounded-lg px-2.5 py-1 text-white/80"
                  />
                </div>
              </div>
            </div>
          ))}

          <button
            onClick={handleAddTier}
            className="w-full py-2.5 border-2 border-dashed border-white/10 hover:border-orange-500/50 text-white/60 hover:text-orange-400 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Category Tier</span>
          </button>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-white/10 bg-white/[0.02] flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-white/50 hover:text-white transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-xl shadow-lg flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>Apply Tier Changes</span>
          </button>
        </div>
      </div>
    </div>
  );
};
