'use client';

import { useGeometryStore, useExportStore } from '../../lib/store';
import { MOONSIDE_PRESET, CLASSIC_PRESET } from '../../lib/geometry/stackedAssembly';

export default function RightPanel() {
  const loadPreset = useGeometryStore(state => state.loadPreset);
  const { printSettings, updatePrintSettings, setExporting, isExporting } = useExportStore();
  const tiers = useGeometryStore(state => state.tiers);

  const handleExport = () => {
    setExporting(true);
    
    // Create web worker for G-code generation
    const worker = new Worker(new URL('../../lib/gcode/gcodeWorker.js', import.meta.url));
    
    worker.onmessage = (e) => {
      if (e.data.status === 'success') {
        const blob = new Blob([e.data.gcode], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `RibbedLamp_${Date.now()}.gcode`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        alert('Export failed: ' + e.data.error);
      }
      setExporting(false);
      worker.terminate();
    };

    worker.postMessage({
      id: Date.now(),
      tiers,
      printSettings
    });
  };

  return (
    <div className="w-80 bg-neutral-900 border-l border-neutral-800 text-neutral-200 p-4 flex flex-col gap-8 font-mono text-sm overflow-y-auto">
      
      {/* Presets */}
      <div>
        <h2 className="text-xs font-bold text-neutral-500 uppercase mb-3 tracking-wider">Presets</h2>
        <div className="grid grid-cols-2 gap-2">
          <button 
            className="p-3 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded text-center transition-colors"
            onClick={() => loadPreset(CLASSIC_PRESET)}
          >
            <div className="w-full h-12 bg-emerald-500/20 rounded mb-2 border border-emerald-500/50"></div>
            <span className="text-xs">Classic Fluted</span>
          </button>
          <button 
            className="p-3 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded text-center transition-colors"
            onClick={() => loadPreset(MOONSIDE_PRESET)}
          >
            <div className="w-full h-12 bg-indigo-500/20 rounded mb-2 border border-indigo-500/50 flex flex-col justify-end">
              <div className="w-full h-1/3 bg-indigo-500/40 rounded-b"></div>
            </div>
            <span className="text-xs">Moonside</span>
          </button>
        </div>
      </div>

      {/* Print Settings */}
      <div>
        <h2 className="text-xs font-bold text-neutral-500 uppercase mb-3 tracking-wider">Print Settings</h2>
        <div className="flex flex-col gap-4">
          <label className="flex items-center gap-2 text-xs">
            <input 
              type="checkbox" 
              checked={printSettings.vaseMode} 
              onChange={e => updatePrintSettings({ vaseMode: e.target.checked })}
              className="accent-emerald-500"
            />
            Vase Mode (Spiralize)
          </label>
          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs"><span>Layer Height</span><span className="text-emerald-400">{printSettings.layerHeight}mm</span></div>
            <input type="range" min="0.08" max="0.4" step="0.04" value={printSettings.layerHeight} onChange={e => updatePrintSettings({ layerHeight: Number(e.target.value) })} className="w-full accent-emerald-500" />
          </label>
        </div>
      </div>

      {/* Export */}
      <div className="mt-auto">
        <button 
          onClick={handleExport}
          disabled={isExporting}
          className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
        >
          {isExporting ? 'Generating...' : 'Export G-Code'}
        </button>
      </div>
    </div>
  );
}
