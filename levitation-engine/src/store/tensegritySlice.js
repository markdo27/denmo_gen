import { TENSEGRITY_DEFAULTS } from '../utils/constants';

export const createTensegritySlice = (set) => ({
  tensegrity: { ...TENSEGRITY_DEFAULTS },

  setTensegrityParam: (key, value) =>
    set((state) => ({
      tensegrity: { ...state.tensegrity, [key]: value },
    })),

  resetTensegrity: () =>
    set({ tensegrity: { ...TENSEGRITY_DEFAULTS } }),
});
