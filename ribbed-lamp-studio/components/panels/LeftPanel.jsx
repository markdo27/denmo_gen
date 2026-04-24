'use client';

import { useState } from 'react';
import { useGeometryStore, useExportStore } from '../../lib/store';
import { BIC_PRESETS } from '../../lib/geometry/lighterHole';

export default function LeftPanel() {
  const tiers = useGeometryStore(state => state.tiers);
  const updateTier = useGeometryStore(state => state.updateTier);
  const updateTexture = useGeometryStore(state => state.updateTexture);
  const updateLighterHole = useGeometryStore(state => state.updateLighterHole);
  const toggleTier = useGeometryStore(state => state.toggleTier);
  
  const [activeTierId, setActiveTierId] = useState(0);
  const activeTier = tiers.find(t => t.id === activeTierId) || tiers[0];

  const handleSlider = (field, val) => {
    updateTier(activeTierId, { [field]: Number(val) });
  };

  const handleTextureSlider = (field, val) => {
    updateTexture(activeTierId, { [field]: Number(val) });
  };

  const lighterHole = activeTier.lighterHole || { enabled: false, preset: 'standard', tolerance: 0.4, bottomThickness: 2.5 };
  const lighterDims = BIC_PRESETS[lighterHole.preset] || BIC_PRESETS.standard;

  return (
    <div className="w-80 bg-neutral-900 border-r border-neutral-800 text-neutral-200 p-4 overflow-y-auto flex flex-col gap-6 font-mono text-sm">
      
      {/* Tier Selector */}
      <div>
        <h2 className="text-xs font-bold text-neutral-500 uppercase mb-3 tracking-wider">Assembly Tiers</h2>
        <div className="flex flex-col gap-2">
          {tiers.map(t => (
            <div key={t.id} className={`flex items-center gap-2 p-2 rounded cursor-pointer border ${activeTierId === t.id ? 'border-emerald-500 bg-emerald-500/10' : 'border-neutral-800 hover:bg-neutral-800'}`} onClick={() => setActiveTierId(t.id)}>
              <input type="checkbox" checked={t.enabled} onChange={(e) => toggleTier(t.id, e.target.checked)} className="accent-emerald-500" />
              <span>Tier {t.id}: {t.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Geometry Controls */}
      <div className={!activeTier.enabled ? 'opacity-50 pointer-events-none' : ''}>
        <h2 className="text-xs font-bold text-neutral-500 uppercase mb-3 tracking-wider">Geometry ({activeTier.label})</h2>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs"><span>Width</span><span className="text-emerald-400">{activeTier.width}mm</span></div>
            <input type="range" min="20" max="200" step="1" value={activeTier.width} onChange={e => handleSlider('width', e.target.value)} className="w-full accent-emerald-500" />
          </label>
          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs"><span>Depth</span><span className="text-emerald-400">{activeTier.depth}mm</span></div>
            <input type="range" min="20" max="200" step="1" value={activeTier.depth} onChange={e => handleSlider('depth', e.target.value)} className="w-full accent-emerald-500" />
          </label>
          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs"><span>Height</span><span className="text-emerald-400">{activeTier.height}mm</span></div>
            <input type="range" min="10" max="300" step="1" value={activeTier.height} onChange={e => handleSlider('height', e.target.value)} className="w-full accent-emerald-500" />
          </label>
          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs"><span>Corner Radius</span><span className="text-emerald-400">{activeTier.cornerRadius}mm</span></div>
            <input type="range" min="0.1" max="40" step="0.1" value={activeTier.cornerRadius} onChange={e => handleSlider('cornerRadius', e.target.value)} className="w-full accent-emerald-500" />
          </label>
        </div>
      </div>

      {/* Texture Controls */}
      <div className={!activeTier.enabled ? 'opacity-50 pointer-events-none' : ''}>
        <h2 className="text-xs font-bold text-neutral-500 uppercase mb-3 tracking-wider">Rib Texture ({activeTier.label})</h2>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs">Algorithm</span>
            <select value={activeTier.texture.algorithm} onChange={e => updateTexture(activeTierId, { algorithm: e.target.value })} className="bg-neutral-800 border border-neutral-700 rounded p-1 text-xs">
              <option value="fine-fluting">Fine Fluting</option>
              <option value="coarse-pleating">Coarse Pleating</option>
              <option value="nested-columns">Nested Columns</option>
            </select>
          </label>
          
          <label className="flex flex-col gap-1">
            <span className="text-xs">Profile Type</span>
            <select value={activeTier.texture.ribProfile} onChange={e => updateTexture(activeTierId, { ribProfile: e.target.value })} className="bg-neutral-800 border border-neutral-700 rounded p-1 text-xs">
              <option value="sharp">Sharp (Reference)</option>
              <option value="sine">Smooth Sine</option>
              <option value="triangle">Triangle</option>
              <option value="pleat">Flat Valley Pleat</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs"><span>Rib Count</span><span className="text-emerald-400">{activeTier.texture.ribCount}</span></div>
            <input type="range" min="4" max="120" step="4" value={activeTier.texture.ribCount} onChange={e => handleTextureSlider('ribCount', e.target.value)} className="w-full accent-emerald-500" />
          </label>
          <label className="flex flex-col gap-1">
            <div className="flex justify-between text-xs"><span>Rib Depth</span><span className="text-emerald-400">{activeTier.texture.ribDepth}mm</span></div>
            <input type="range" min="0" max="10" step="0.1" value={activeTier.texture.ribDepth} onChange={e => handleTextureSlider('ribDepth', e.target.value)} className="w-full accent-emerald-500" />
          </label>
        </div>
      </div>

      {/* Lighter Hole */}
      <div className={!activeTier.enabled ? 'opacity-50 pointer-events-none' : ''}>
        <h2 className="text-xs font-bold text-neutral-500 uppercase mb-3 tracking-wider">Lighter Hole</h2>
        <div className="flex flex-col gap-4">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={lighterHole.enabled}
              onChange={e => updateLighterHole(activeTierId, { enabled: e.target.checked })}
              className="accent-amber-500"
            />
            Enable Bic Lighter Cavity
          </label>

          <div className={!lighterHole.enabled ? 'opacity-40 pointer-events-none' : ''}>
            <label className="flex flex-col gap-1 mb-3">
              <span className="text-xs">Lighter Size</span>
              <select
                value={lighterHole.preset}
                onChange={e => updateLighterHole(activeTierId, { preset: e.target.value })}
                className="bg-neutral-800 border border-neutral-700 rounded p-1 text-xs"
              >
                <option value="standard">Standard (25×14×80mm)</option>
                <option value="mini">Mini (21×11×63mm)</option>
              </select>
            </label>

            <div className="text-[10px] text-neutral-500 mb-3 leading-relaxed border border-neutral-800 rounded p-2 bg-neutral-800/50">
              Cavity: {(lighterDims.bodyWidth + lighterHole.tolerance * 2).toFixed(1)} × {(lighterDims.bodyDepth + lighterHole.tolerance * 2).toFixed(1)}mm
              <br />
              Depth: {(lighterDims.bodyHeight - lighterDims.topExposed).toFixed(0)}mm — Top exposed: {lighterDims.topExposed}mm
            </div>

            <label className="flex flex-col gap-1 mb-3">
              <div className="flex justify-between text-xs">
                <span>Tolerance</span>
                <span className="text-amber-400">{lighterHole.tolerance}mm</span>
              </div>
              <input
                type="range" min="0.1" max="1.0" step="0.05"
                value={lighterHole.tolerance}
                onChange={e => updateLighterHole(activeTierId, { tolerance: Number(e.target.value) })}
                className="w-full accent-amber-500"
              />
            </label>

            <label className="flex flex-col gap-1">
              <div className="flex justify-between text-xs">
                <span>Floor Thickness</span>
                <span className="text-amber-400">{lighterHole.bottomThickness}mm</span>
              </div>
              <input
                type="range" min="1.0" max="8.0" step="0.5"
                value={lighterHole.bottomThickness}
                onChange={e => updateLighterHole(activeTierId, { bottomThickness: Number(e.target.value) })}
                className="w-full accent-amber-500"
              />
            </label>
          </div>
        </div>
      </div>

    </div>
  );
}

