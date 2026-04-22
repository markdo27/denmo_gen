import { create } from 'zustand';

export const useExportStore = create((set) => ({
  printSettings: {
    layerHeight: 0.2,
    nozzleSize: 0.4,
    wallCount: 1,
    vaseMode: true,
    bedX: 220,
    bedY: 220,
    extrusionMult: 1.0,
    feedrate: 3000,
    travelFeedrate: 6000,
  },
  
  updatePrintSettings: (updates) => set((state) => ({
    printSettings: { ...state.printSettings, ...updates }
  })),

  isExporting: false,
  setExporting: (isExporting) => set({ isExporting }),
}));
