import { ACOUSTIC_DEFAULTS } from '../utils/constants';

export const createAcousticSlice = (set) => ({
  acoustic: { ...ACOUSTIC_DEFAULTS },

  setAcousticParam: (key, value) =>
    set((state) => ({
      acoustic: { ...state.acoustic, [key]: value },
    })),

  resetAcoustic: () =>
    set({ acoustic: { ...ACOUSTIC_DEFAULTS } }),
});
