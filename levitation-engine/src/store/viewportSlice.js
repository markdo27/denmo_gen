import { MODULES } from '../utils/constants';

export const createViewportSlice = (set) => ({
  // Active module tab
  activeModule: MODULES.TENSEGRITY,
  setActiveModule: (module) => set({ activeModule: module }),

  // Blueprint mode
  blueprintMode: false,
  toggleBlueprintMode: () => set((s) => ({ blueprintMode: !s.blueprintMode })),

  // Collapsed section state
  collapsedSections: {},
  toggleSection: (sectionId) =>
    set((s) => ({
      collapsedSections: {
        ...s.collapsedSections,
        [sectionId]: !s.collapsedSections[sectionId],
      },
    })),

  // FPS display
  showStats: false,
  toggleStats: () => set((s) => ({ showStats: !s.showStats })),
});
