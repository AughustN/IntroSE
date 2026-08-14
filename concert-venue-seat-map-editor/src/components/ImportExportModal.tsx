import React, { useState } from 'react';
import { VenueMap } from '../types/seatmap';
import { X, Download, Upload, Copy, Check, Code, FileText } from 'lucide-react';

interface ImportExportModalProps {
  venue: VenueMap;
  onImportVenue: (imported: VenueMap) => void;
  onClose: () => void;
}

export const ImportExportModal: React.FC<ImportExportModalProps> = ({
  venue,
  onImportVenue,
  onClose
}) => {
  const [activeTab, setActiveTab] = useState<'export' | 'import' | 'embed'>('export');
  const [jsonInput, setJsonInput] = useState<string>('');
  const [isCopied, setIsCopied] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const formattedJson = JSON.stringify(venue, null, 2);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleDownloadFile = () => {
    const blob = new Blob([formattedJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${venue.name.toLowerCase().replace(/\s+/g, '-')}-seatmap.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportSubmit = () => {
    try {
      setImportError(null);
      const parsed = JSON.parse(jsonInput);
      if (!parsed.elements || !parsed.categories) {
        throw new Error('Invalid venue schema format: missing "elements" or "categories" arrays.');
      }
      onImportVenue(parsed);
      onClose();
    } catch (err: any) {
      setImportError(err.message || 'Failed to parse JSON string.');
    }
  };

  const embedScriptTag = `<div id="concert-seatmap-root" data-venue-id="${venue.id}"></div>
<script src="https://cdn.seatmap.pro/v1/sdk.js" async></script>
<script>
  SeatMapPro.init({
    containerId: 'concert-seatmap-root',
    venueId: '${venue.id}',
    primaryColor: '#8b5cf6',
    onSeatSelect: function(seats) {
      console.log('Selected Seats:', seats);
    }
  });
</script>`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 select-none">
      <div className="bg-slate-900 border border-slate-800 text-slate-100 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-600/20 text-amber-400 rounded-lg">
              <Code className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-base text-white">JSON Export, Import & SDK Embed</h2>
              <p className="text-xs text-slate-400">Save venue schema, load custom JSON, or generate embed code</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1.5 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-800 bg-slate-900/50 px-6 pt-2">
          <button
            onClick={() => setActiveTab('export')}
            className={`px-4 py-2 text-xs font-bold border-b-2 transition-colors ${
              activeTab === 'export'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Export JSON
          </button>
          <button
            onClick={() => setActiveTab('import')}
            className={`px-4 py-2 text-xs font-bold border-b-2 transition-colors ${
              activeTab === 'import'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Import Venue JSON
          </button>
          <button
            onClick={() => setActiveTab('embed')}
            className={`px-4 py-2 text-xs font-bold border-b-2 transition-colors ${
              activeTab === 'embed'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            HTML / JS Embed Code
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          
          {/* TAB 1: EXPORT JSON */}
          {activeTab === 'export' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-medium">Venue Schema Output ({venue.elements.length} elements)</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleCopy(formattedJson)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold border border-slate-700 transition-colors"
                  >
                    {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{isCopied ? 'Copied!' : 'Copy JSON'}</span>
                  </button>
                  <button
                    onClick={handleDownloadFile}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold shadow transition-all"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download .json</span>
                  </button>
                </div>
              </div>

              <textarea
                readOnly
                value={formattedJson}
                className="w-full h-64 bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-xs text-amber-200/90 focus:outline-none select-all"
              />
            </div>
          )}

          {/* TAB 2: IMPORT JSON */}
          {activeTab === 'import' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-300">
                Paste an existing SeatMap.Pro venue layout JSON string below to load it directly into the interactive venue editor:
              </p>

              {importError && (
                <div className="p-3 bg-rose-950/80 border border-rose-800/80 rounded-xl text-rose-200 text-xs font-medium">
                  {importError}
                </div>
              )}

              <textarea
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                placeholder='{ "id": "my-venue", "name": "Concert Hall", "elements": [...] }'
                className="w-full h-56 bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />

              <button
                onClick={handleImportSubmit}
                disabled={!jsonInput.trim()}
                className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold shadow flex items-center justify-center gap-2 transition-all"
              >
                <Upload className="w-4 h-4" />
                <span>Load & Replace Venue Layout</span>
              </button>
            </div>
          )}

          {/* TAB 3: SDK EMBED CODE */}
          {activeTab === 'embed' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-300">
                Copy this HTML <code className="text-amber-400 bg-slate-800 px-1 py-0.5 rounded">&lt;script&gt;</code> tag to embed this venue seat map into any website or ticketing platform:
              </p>

              <div className="flex items-center justify-between bg-slate-950 p-2.5 rounded-t-xl border-t border-x border-slate-800">
                <span className="text-xs font-mono text-slate-400">embed-snippet.html</span>
                <button
                  onClick={() => handleCopy(embedScriptTag)}
                  className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 font-bold"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Embed Code</span>
                </button>
              </div>

              <textarea
                readOnly
                value={embedScriptTag}
                className="w-full h-44 bg-slate-950 border border-slate-800 rounded-b-xl p-3 font-mono text-xs text-emerald-300 select-all"
              />
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
