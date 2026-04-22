import { HISTORY_MAX_DEPTH } from '../utils/constants';

/**
 * Zustand middleware for undo/redo parameter history.
 *
 * Captures snapshots of parameter state (tensegrity + acoustic slices)
 * and maintains past/future stacks for navigation.
 *
 * Usage:
 *   store.getState().pushHistory()   — called on slider mouseup/touchend
 *   store.getState().undo()          — revert to previous snapshot
 *   store.getState().redo()          — replay forward
 */
export const createHistorySlice = (set, get) => ({
  // History stacks
  _past: [],
  _future: [],

  // Snapshot the current parameter state
  pushHistory: () => {
    const state = get();
    const snapshot = {
      tensegrity: { ...state.tensegrity },
      acoustic: { ...state.acoustic },
    };

    set((s) => ({
      _past: [...s._past.slice(-HISTORY_MAX_DEPTH + 1), snapshot],
      _future: [], // Clear redo stack on new action
    }));
  },

  // Undo: pop from past, push current to future
  undo: () => {
    const state = get();
    if (state._past.length === 0) return;

    const currentSnapshot = {
      tensegrity: { ...state.tensegrity },
      acoustic: { ...state.acoustic },
    };

    const previousSnapshot = state._past[state._past.length - 1];

    set({
      _past: state._past.slice(0, -1),
      _future: [currentSnapshot, ...state._future],
      tensegrity: { ...previousSnapshot.tensegrity },
      acoustic: { ...previousSnapshot.acoustic },
    });
  },

  // Redo: pop from future, push current to past
  redo: () => {
    const state = get();
    if (state._future.length === 0) return;

    const currentSnapshot = {
      tensegrity: { ...state.tensegrity },
      acoustic: { ...state.acoustic },
    };

    const nextSnapshot = state._future[0];

    set({
      _past: [...state._past, currentSnapshot],
      _future: state._future.slice(1),
      tensegrity: { ...nextSnapshot.tensegrity },
      acoustic: { ...nextSnapshot.acoustic },
    });
  },

  canUndo: () => get()._past.length > 0,
  canRedo: () => get()._future.length > 0,
});
