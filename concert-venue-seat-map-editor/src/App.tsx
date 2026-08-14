import React, { useState, useEffect } from 'react';
import { 
  VenueMap, 
  SeatMapElement, 
  ActiveTool, 
  CategoryTier 
} from './types/seatmap';
import { PRESET_GRAND_ARENA, PRESETS_LIST } from './data/presets';
import { buildBlockSeats, buildCurvedRowSeats } from './utils/numbering';
import { Navbar } from './components/Navbar';
import { Toolbar } from './components/Toolbar';
import { Canvas } from './components/Canvas';
import { PropertiesPanel } from './components/PropertiesPanel';
import { TierManagerModal } from './components/TierManagerModal';
import { BlueprintModal } from './components/BlueprintModal';
import { BuyerPreview } from './components/BuyerPreview';
import { TutorialModal } from './components/TutorialModal';
import { ImportExportModal } from './components/ImportExportModal';

export default function App() {
  // Venue State
  const [venue, setVenue] = useState<VenueMap>(PRESET_GRAND_ARENA);

  // History State for Undo / Redo
  const [history, setHistory] = useState<VenueMap[]>([PRESET_GRAND_ARENA]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Editor Interaction State
  const [activeTab, setActiveTab] = useState<'editor' | 'buyer' | 'tutorial' | 'export'>('editor');
  const [activeTool, setActiveTool] = useState<ActiveTool>('select');
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(
    PRESET_GRAND_ARENA.categories[0].id
  );
  const [zoom, setZoom] = useState<number>(1);
  const [snapToGrid, setSnapToGrid] = useState<boolean>(true);

  // Modals
  const [isTierModalOpen, setIsTierModalOpen] = useState(false);
  const [isBlueprintModalOpen, setIsBlueprintModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  // Update Venue with Undo History Record
  const updateVenueState = (newVenue: VenueMap, recordHistory = true) => {
    setVenue(newVenue);
    if (recordHistory) {
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(newVenue);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    }
  };

  // Undo / Redo
  const handleUndo = () => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      setVenue(history[historyIndex - 1]);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      setVenue(history[historyIndex + 1]);
    }
  };

  // Select Preset Venue
  const handleSelectPreset = (preset: VenueMap) => {
    setVenue(preset);
    setHistory([preset]);
    setHistoryIndex(0);
    setSelectedElementIds([]);
    setSelectedCategoryId(preset.categories[0].id);
  };

  // Single Element Update
  const handleUpdateElement = (updated: SeatMapElement) => {
    const updatedElements = venue.elements.map((el) => (el.id === updated.id ? updated : el));
    updateVenueState({ ...venue, elements: updatedElements, updatedAt: new Date().toISOString() });
  };

  // Multiple Elements Update
  const handleUpdateMultipleElements = (updatedList: SeatMapElement[]) => {
    const updateMap = new Map(updatedList.map((item) => [item.id, item]));
    const updatedElements = venue.elements.map((el) => updateMap.get(el.id) || el);
    updateVenueState({ ...venue, elements: updatedElements, updatedAt: new Date().toISOString() });
  };

  // Add New Element Generator
  const handleAddElement = (toolType: ActiveTool) => {
    const defaultCatId = selectedCategoryId || venue.categories[0].id;
    const newId = `el-${Date.now()}`;
    let newElement: SeatMapElement | null = null;

    // Center offset based on current view
    const spawnX = 500;
    const spawnY = 300;

    switch (toolType) {
      case 'add-block': {
        const baseBlock: SeatMapElement = {
          id: newId,
          type: 'seating-block',
          title: 'Section Block',
          x: spawnX,
          y: spawnY,
          rotation: 0,
          width: 300,
          height: 140,
          zIndex: 2,
          rowsCount: 4,
          seatsPerRow: 10,
          seatSpacing: 26,
          rowSpacing: 28,
          categoryId: defaultCatId
        };
        newElement = { ...baseBlock, seats: buildBlockSeats(baseBlock) };
        break;
      }

      case 'add-curved': {
        const baseCurved: SeatMapElement = {
          id: newId,
          type: 'curved-row',
          title: 'Curved Arc Tier',
          x: spawnX,
          y: spawnY,
          rotation: 0,
          width: 400,
          height: 180,
          zIndex: 2,
          rowsCount: 3,
          seatsPerRow: 12,
          radius: 180,
          arcAngle: 90,
          rowSpacing: 30,
          categoryId: defaultCatId
        };
        newElement = { ...baseCurved, seats: buildCurvedRowSeats(baseCurved) };
        break;
      }

      case 'add-row': {
        const baseRow: SeatMapElement = {
          id: newId,
          type: 'single-row',
          title: 'Single Row A',
          x: spawnX,
          y: spawnY,
          rotation: 0,
          width: 280,
          height: 40,
          zIndex: 2,
          rowsCount: 1,
          seatsPerRow: 10,
          seatSpacing: 26,
          rowSpacing: 28,
          categoryId: defaultCatId
        };
        newElement = { ...baseRow, seats: buildBlockSeats(baseRow) };
        break;
      }

      case 'add-table': {
        newElement = {
          id: newId,
          type: 'vip-table',
          title: 'VIP Round Table',
          x: spawnX,
          y: spawnY,
          rotation: 0,
          width: 80,
          height: 80,
          zIndex: 2,
          tableShape: 'circle',
          tableSeatCount: 4,
          label: 'T-1',
          categoryId: defaultCatId,
          seats: [
            { id: `ts-0-${newId}`, label: '1', rowLabel: 'T', x: 32 + Math.cos(-Math.PI/2) * 40, y: 32 + Math.sin(-Math.PI/2) * 40, status: 'available', categoryId: defaultCatId },
            { id: `ts-1-${newId}`, label: '2', rowLabel: 'T', x: 32 + Math.cos(0) * 40, y: 32 + Math.sin(0) * 40, status: 'available', categoryId: defaultCatId },
            { id: `ts-2-${newId}`, label: '3', rowLabel: 'T', x: 32 + Math.cos(Math.PI/2) * 40, y: 32 + Math.sin(Math.PI/2) * 40, status: 'available', categoryId: defaultCatId },
            { id: `ts-3-${newId}`, label: '4', rowLabel: 'T', x: 32 + Math.cos(Math.PI) * 40, y: 32 + Math.sin(Math.PI) * 40, status: 'available', categoryId: defaultCatId }
          ]
        };
        break;
      }

      case 'add-ga': {
        newElement = {
          id: newId,
          type: 'ga-zone',
          title: 'GA Standing Floor',
          x: spawnX,
          y: spawnY,
          rotation: 0,
          width: 240,
          height: 160,
          zIndex: 2,
          capacity: 250,
          categoryId: defaultCatId,
          fillColor: 'rgba(236, 72, 153, 0.25)',
          label: 'STANDING GA PIT'
        };
        break;
      }

      case 'add-seat': {
        newElement = {
          id: newId,
          type: 'individual-seat',
          title: 'Accessible Chair',
          x: spawnX,
          y: spawnY,
          rotation: 0,
          width: 24,
          height: 24,
          zIndex: 2,
          label: '1',
          categoryId: defaultCatId
        };
        break;
      }

      case 'add-stage': {
        newElement = {
          id: newId,
          type: 'stage',
          title: 'Performance Stage',
          x: spawnX,
          y: spawnY,
          rotation: 0,
          width: 400,
          height: 100,
          zIndex: 1,
          label: 'MAIN CONCERT STAGE',
          fontSize: 16,
          backgroundColor: '#1e293b',
          textColor: '#f8fafc',
          borderColor: '#3b82f6'
        };
        break;
      }

      case 'add-exit': {
        newElement = {
          id: newId,
          type: 'exit',
          title: 'Emergency Exit',
          x: spawnX,
          y: spawnY,
          rotation: 0,
          width: 60,
          height: 35,
          zIndex: 3,
          label: 'EXIT'
        };
        break;
      }

      case 'add-text': {
        newElement = {
          id: newId,
          type: 'text',
          title: 'Text Annotation',
          x: spawnX,
          y: spawnY,
          rotation: 0,
          width: 160,
          height: 30,
          zIndex: 3,
          label: 'LOGE LEVEL 1',
          fontSize: 14,
          textColor: '#e2e8f0'
        };
        break;
      }
    }

    if (newElement) {
      updateVenueState({ ...venue, elements: [...venue.elements, newElement] });
      setSelectedElementIds([newElement.id]);
      setActiveTool('select');
    }
  };

  // Delete Selected
  const handleDeleteSelected = () => {
    if (selectedElementIds.length === 0) return;
    const remaining = venue.elements.filter((el) => !selectedElementIds.includes(el.id));
    updateVenueState({ ...venue, elements: remaining });
    setSelectedElementIds([]);
  };

  // Duplicate Selected
  const handleDuplicateSelected = () => {
    if (selectedElementIds.length === 0) return;
    const duplicated: SeatMapElement[] = [];

    selectedElementIds.forEach((id) => {
      const orig = venue.elements.find((el) => el.id === id);
      if (orig) {
        const copyId = `el-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
        duplicated.push({
          ...orig,
          id: copyId,
          title: `${orig.title} (Copy)`,
          x: orig.x + 30,
          y: orig.y + 30,
          seats: orig.seats?.map((s) => ({ ...s, id: `s-${Math.random().toString(36).substr(2, 5)}` }))
        });
      }
    });

    updateVenueState({ ...venue, elements: [...venue.elements, ...duplicated] });
    setSelectedElementIds(duplicated.map((item) => item.id));
  };

  // Paintbrush Mode Seat Click Override
  const handleSeatClickInBrushMode = (elementId: string, seatId: string) => {
    const element = venue.elements.find((e) => e.id === elementId);
    if (!element || !element.seats) return;

    const updatedSeats = element.seats.map((seat) =>
      seat.id === seatId ? { ...seat, categoryId: selectedCategoryId } : seat
    );

    handleUpdateElement({ ...element, seats: updatedSeats });
  };

  // Keyboard Shortcuts (Delete, Undo, Redo)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input field
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        handleDeleteSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        handleRedo();
      } else if (e.key.toLowerCase() === 's') {
        setActiveTool('select');
      } else if (e.key.toLowerCase() === 'h') {
        setActiveTool('pan');
      } else if (e.key.toLowerCase() === 'b') {
        setActiveTool('brush');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedElementIds, historyIndex, history]);

  // Calculate Total Seats & Max Capacity
  const totalSeatsCount = venue.elements.reduce((acc, el) => {
    if (el.seats) return acc + el.seats.length;
    if (el.type === 'individual-seat') return acc + 1;
    return acc;
  }, 0);

  const totalCapacity = venue.elements.reduce((acc, el) => {
    if (el.type === 'ga-zone') return acc + (el.capacity || 0);
    if (el.seats) return acc + el.seats.length;
    if (el.type === 'individual-seat') return acc + 1;
    return acc;
  }, 0);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 font-sans">
      
      {/* Top Navigation Bar */}
      <Navbar
        venue={venue}
        onSelectPreset={handleSelectPreset}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        zoom={zoom}
        setZoom={setZoom}
        snapToGrid={snapToGrid}
        setSnapToGrid={setSnapToGrid}
        canUndo={historyIndex > 0}
        canRedo={historyIndex < history.length - 1}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onOpenTierManager={() => setIsTierModalOpen(true)}
        onOpenBlueprintModal={() => setIsBlueprintModalOpen(true)}
        onResetCanvas={() => updateVenueState({ ...venue, elements: [] })}
        totalSeatsCount={totalSeatsCount}
        totalCapacity={totalCapacity}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* TAB 1: VENUE EDITOR */}
        {activeTab === 'editor' && (
          <>
            {/* Left Toolbar */}
            <Toolbar
              activeTool={activeTool}
              setActiveTool={setActiveTool}
              categories={venue.categories}
              selectedCategoryId={selectedCategoryId}
              setSelectedCategoryId={setSelectedCategoryId}
              onAddElement={handleAddElement}
            />

            {/* Central Interactive SVG Canvas */}
            <div className="flex-1 h-full relative">
              <Canvas
                venue={venue}
                selectedElementIds={selectedElementIds}
                onSelectElements={(ids) => setSelectedElementIds(ids)}
                onUpdateElement={handleUpdateElement}
                activeTool={activeTool}
                zoom={zoom}
                selectedCategoryId={selectedCategoryId}
                onSeatClickInBrushMode={handleSeatClickInBrushMode}
              />
            </div>

            {/* Right Parametric Inspector Panel */}
            <PropertiesPanel
              venue={venue}
              selectedElementIds={selectedElementIds}
              onUpdateVenue={(v) => updateVenueState(v)}
              onUpdateElement={handleUpdateElement}
              onUpdateMultipleElements={handleUpdateMultipleElements}
              onDeleteSelected={handleDeleteSelected}
              onDuplicateSelected={handleDuplicateSelected}
              categories={venue.categories}
            />
          </>
        )}

        {/* TAB 2: BUYER SEAT PICKER PREVIEW */}
        {activeTab === 'buyer' && (
          <BuyerPreview venue={venue} />
        )}

        {/* TAB 3: INTEGRATION GUIDE & TUTORIAL */}
        {activeTab === 'tutorial' && (
          <TutorialModal />
        )}

        {/* TAB 4: JSON EXPORT & EMBED */}
        {activeTab === 'export' && (
          <div className="w-full h-full p-8 bg-slate-950 flex items-center justify-center">
            <ImportExportModal
              venue={venue}
              onImportVenue={(v) => {
                updateVenueState(v);
                setActiveTab('editor');
              }}
              onClose={() => setActiveTab('editor')}
            />
          </div>
        )}
      </div>

      {/* MODALS */}
      {isTierModalOpen && (
        <TierManagerModal
          categories={venue.categories}
          onSaveCategories={(updated) => updateVenueState({ ...venue, categories: updated })}
          onClose={() => setIsTierModalOpen(false)}
        />
      )}

      {isBlueprintModalOpen && (
        <BlueprintModal
          blueprint={venue.blueprint}
          onSaveBlueprint={(updated) => updateVenueState({ ...venue, blueprint: updated })}
          onClose={() => setIsBlueprintModalOpen(false)}
        />
      )}

      {isExportModalOpen && (
        <ImportExportModal
          venue={venue}
          onImportVenue={(v) => updateVenueState(v)}
          onClose={() => setIsExportModalOpen(false)}
        />
      )}
    </div>
  );
}
