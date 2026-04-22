import { create } from 'zustand';
import { createTensegritySlice } from './tensegritySlice';
import { createAcousticSlice } from './acousticSlice';
import { createViewportSlice } from './viewportSlice';
import { createHistorySlice } from './historyMiddleware';

/**
 * Combined Zustand store with all parameter slices and history middleware.
 *
 * Architecture:
 *   - tensegrity.*     → Module 1 parameters
 *   - acoustic.*       → Module 2 parameters
 *   - activeModule     → Which module controls are visible
 *   - blueprintMode    → Wireframe rendering toggle
 *   - undo/redo        → Parameter history navigation
 */
export const useStore = create((...args) => ({
  ...createTensegritySlice(...args),
  ...createAcousticSlice(...args),
  ...createViewportSlice(...args),
  ...createHistorySlice(...args),
}));
