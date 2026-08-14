import React, { useState } from 'react';
import { 
  BookOpen, 
  Code, 
  Layers, 
  Server, 
  Copy, 
  Check, 
  ExternalLink, 
  Cpu, 
  Sparkles,
  Terminal,
  ShieldCheck,
  Zap
} from 'lucide-react';

export const TutorialModal: React.FC = () => {
  const [copiedCodeIndex, setCopiedCodeIndex] = useState<number | null>(null);

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedCodeIndex(index);
    setTimeout(() => setCopiedCodeIndex(null), 2000);
  };

  const SNIPPET_DATA_SCHEMA = `// 1. Core Data Models for Concert Seat Map Editor
export interface CategoryTier {
  id: string;
  name: string;        // e.g. "VIP Front Row"
  color: string;       // Hex color code e.g. "#8b5cf6"
  price: number;       // Ticket price in USD
  ticketType: string;  // e.g. "Standard Reserved", "GA"
}

export interface Seat {
  id: string;
  label: string;       // e.g. "101"
  rowLabel: string;    // e.g. "Row A"
  x: number;
  y: number;
  status: 'available' | 'reserved' | 'sold' | 'blocked' | 'accessible';
  categoryId: string;
}

export interface SeatMapElement {
  id: string;
  type: 'seating-block' | 'curved-row' | 'vip-table' | 'ga-zone' | 'stage' | 'exit';
  title: string;       // Section name e.g. "Center Orchestra"
  x: number;
  y: number;
  rotation: number;    // Rotation in degrees (0 - 360)
  width: number;
  height: number;
  categoryId?: string;
  seats?: Seat[];
}`;

  const SNIPPET_BACKEND_API = `// 2. Node.js Express Backend API for Seat Locking & Venue Map Persistence
import express from 'express';
const router = express.Router();

// Save Venue Map JSON Schema from Editor
router.post('/api/venue/save', async (req, res) => {
  const { venueId, venueData } = req.body;
  // Store venueData JSON in database (Firestore, PostgreSQL, MongoDB)
  await db.collection('venues').doc(venueId).set(venueData);
  res.json({ status: 'success', message: 'Venue layout saved' });
});

// Lock Selected Seats during Buyer Checkout
router.post('/api/seats/lock', async (req, res) => {
  const { venueId, seatIds, userId } = req.body;
  // Atomically lock seats for 10 minutes to prevent double booking
  const lockExpiration = new Date(Date.now() + 10 * 60 * 1000);
  
  const result = await db.runTransaction(async (transaction) => {
    // Verify seats are currently 'available'
    // Update seat status to 'reserved' with userId and lockExpiration
  });

  res.json({ success: true, expiresAt: lockExpiration });
});`;

  const SNIPPET_EMBED_REACT = `// 3. React Buyer Checkout Seat Map Component Integration
import React, { useState } from 'react';
import { ConcertSeatMap } from '@seatmap-pro/react';

export function CheckoutPage({ eventId }) {
  const [selectedSeats, setSelectedSeats] = useState([]);

  return (
    <div className="checkout-container">
      <h2>Select Your Seats</h2>
      <ConcertSeatMap
        venueId={eventId}
        maxSeats={6}
        onSeatSelect={(seats) => setSelectedSeats(seats)}
        primaryColor="#8b5cf6"
      />
      <div className="cart-summary">
        <p>Selected Seats: {selectedSeats.length}</p>
        <button disabled={selectedSeats.length === 0}>
          Proceed to Payment ($ {selectedSeats.reduce((a, b) => a + b.price, 0)})
        </button>
      </div>
    </div>
  );
}`;

  return (
    <div className="w-full h-full bg-slate-950 text-slate-100 overflow-y-auto p-6 md:p-10 font-sans select-text">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* Header Title */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-slate-800 p-8 rounded-3xl shadow-2xl relative overflow-hidden">
          <div className="relative z-10 space-y-3">
            <div className="flex items-center gap-2">
              <span className="bg-indigo-600 text-white font-bold text-xs px-3 py-1 rounded-full uppercase tracking-wider">
                Developer Implementation Tutorial
              </span>
              <span className="text-slate-400 text-xs font-mono">• SeatMap.Pro Guide</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white">
              How to Implement a Concert Venue Seat Map Editor
            </h1>
            <p className="text-sm text-slate-300 max-w-3xl leading-relaxed">
              Step-by-step technical guide for integrating vector canvas venue map builders, seat matrix generators, tier pricing engines, and real-time buyer seat pickers into your concert booking platform.
            </p>
          </div>
        </div>

        {/* Section 1: Core Architecture */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-3 text-indigo-400 font-bold text-base border-b border-slate-800 pb-3">
            <Cpu className="w-5 h-5" />
            <span>1. System Architecture & High-Level Design</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="bg-slate-800/60 p-4 rounded-xl border border-slate-700/60 space-y-2">
              <div className="font-bold text-violet-300 flex items-center gap-1.5">
                <Layers className="w-4 h-4" />
                <span>Vector SVG Canvas Editor</span>
              </div>
              <p className="text-slate-300 leading-relaxed">
                Renders interactive section blocks, curved rows, VIP tables, and stages. Handles zoom/pan, snap-to-grid, rotation handles, and blueprint image tracing overlays.
              </p>
            </div>

            <div className="bg-slate-800/60 p-4 rounded-xl border border-slate-700/60 space-y-2">
              <div className="font-bold text-emerald-300 flex items-center gap-1.5">
                <Zap className="w-4 h-4" />
                <span>Parametric Seat Generator</span>
              </div>
              <p className="text-slate-300 leading-relaxed">
                Calculates seat coordinates automatically along rectangular grids or circular arcs. Supports custom row labeling (A-Z, 1-100) and seat numbering (L-R, Even/Odd).
              </p>
            </div>

            <div className="bg-slate-800/60 p-4 rounded-xl border border-slate-700/60 space-y-2">
              <div className="font-bold text-amber-300 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4" />
                <span>Atomic Seat Locking API</span>
              </div>
              <p className="text-slate-300 leading-relaxed">
                Prevents double-booking during checkout by applying temporary 10-minute holds on selected seats via database transactions and WebSockets.
              </p>
            </div>
          </div>
        </div>

        {/* Section 2: Data Model Schema */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-3 text-violet-400 font-bold text-base">
              <Code className="w-5 h-5" />
              <span>2. TypeScript Data Model & Venue JSON Format</span>
            </div>
            <button
              onClick={() => copyToClipboard(SNIPPET_DATA_SCHEMA, 1)}
              className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg border border-slate-700 transition-colors"
            >
              {copiedCodeIndex === 1 ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedCodeIndex === 1 ? 'Copied' : 'Copy Code'}</span>
            </button>
          </div>
          <p className="text-xs text-slate-300">
            Define clean, normalized data structures for venue maps, section blocks, individual seats, and category pricing tiers:
          </p>
          <pre className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-slate-300 font-mono text-xs overflow-x-auto leading-relaxed">
            {SNIPPET_DATA_SCHEMA}
          </pre>
        </div>

        {/* Section 3: Backend API Integration */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-3 text-emerald-400 font-bold text-base">
              <Server className="w-5 h-5" />
              <span>3. Backend Node.js / Express Seat Reservation Endpoints</span>
            </div>
            <button
              onClick={() => copyToClipboard(SNIPPET_BACKEND_API, 2)}
              className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg border border-slate-700 transition-colors"
            >
              {copiedCodeIndex === 2 ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedCodeIndex === 2 ? 'Copied' : 'Copy Code'}</span>
            </button>
          </div>
          <p className="text-xs text-slate-300">
            Implement REST API handlers for saving venue layouts and performing atomic seat locking during checkout:
          </p>
          <pre className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-slate-300 font-mono text-xs overflow-x-auto leading-relaxed">
            {SNIPPET_BACKEND_API}
          </pre>
        </div>

        {/* Section 4: Buyer Component Integration */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-3 text-amber-400 font-bold text-base">
              <Terminal className="w-5 h-5" />
              <span>4. Embedding Buyer Seat Picker Component</span>
            </div>
            <button
              onClick={() => copyToClipboard(SNIPPET_EMBED_REACT, 3)}
              className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg border border-slate-700 transition-colors"
            >
              {copiedCodeIndex === 3 ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedCodeIndex === 3 ? 'Copied' : 'Copy Code'}</span>
            </button>
          </div>
          <p className="text-xs text-slate-300">
            Drop the interactive seat selection map into your concert ticketing buyer checkout page:
          </p>
          <pre className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-slate-300 font-mono text-xs overflow-x-auto leading-relaxed">
            {SNIPPET_EMBED_REACT}
          </pre>
        </div>

      </div>
    </div>
  );
};
