import { create } from 'zustand';
import { defaultAssembly } from '../geometry/stackedAssembly.js';

export const useGeometryStore = create((set, get) => ({
  tiers: defaultAssembly(),
  
  updateTier: (id, updates) => set((state) => ({
    tiers: state.tiers.map(t => t.id === id ? { ...t, ...updates } : t)
  })),

  updateTexture: (id, textureUpdates) => set((state) => ({
    tiers: state.tiers.map(t => 
      t.id === id 
        ? { ...t, texture: { ...t.texture, ...textureUpdates } } 
        : t
    )
  })),

  updateLighterHole: (id, holeUpdates) => set((state) => ({
    tiers: state.tiers.map(t =>
      t.id === id
        ? { ...t, lighterHole: { ...t.lighterHole, ...holeUpdates } }
        : t
    )
  })),

  toggleTier: (id, enabled) => set((state) => ({
    tiers: state.tiers.map(t => t.id === id ? { ...t, enabled } : t)
  })),

  loadPreset: (presetTiers) => set({ tiers: presetTiers }),
}));
