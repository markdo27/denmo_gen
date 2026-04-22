// ── Parameter Ranges & Defaults ──────────────────────────────────────────────

export const TENSEGRITY_DEFAULTS = {
  baseRadius: 2.0,
  topRadius: 1.5,
  twistAngle: 30,
  strutCount: 3,
  strutLength: 4.0,
};

export const TENSEGRITY_RANGES = {
  baseRadius:  { min: 0.5, max: 5.0, step: 0.05, symbol: 'R₁', unit: 'm', label: 'Base Radius' },
  topRadius:   { min: 0.5, max: 5.0, step: 0.05, symbol: 'R₂', unit: 'm', label: 'Top Radius' },
  twistAngle:  { min: 0,   max: 180, step: 1,    symbol: 'θ',  unit: '°', label: 'Twist Angle' },
  strutCount:  { min: 3,   max: 12,  step: 1,    symbol: 'N',  unit: '',  label: 'Number of Struts' },
  strutLength: { min: 1.0, max: 10.0, step: 0.05, symbol: 'L',  unit: 'm', label: 'Strut Length' },
};

export const ACOUSTIC_DEFAULTS = {
  frequency: 40,
  amplitude: 0.7,
  transducerDistance: 10.0,
  phaseShift: 0,
  fieldResolution: 32,
};

export const ACOUSTIC_RANGES = {
  frequency:          { min: 20,  max: 100,  step: 0.5,  symbol: 'f',  unit: 'kHz', label: 'Frequency' },
  amplitude:          { min: 0.0, max: 1.0,  step: 0.01, symbol: 'A',  unit: '',    label: 'Amplitude' },
  transducerDistance: { min: 1.0, max: 20.0, step: 0.1,  symbol: 'D',  unit: 'm',   label: 'Transducer Distance' },
  phaseShift:         { min: 0,   max: 360,  step: 1,    symbol: 'φ',  unit: '°',   label: 'Phase Shift' },
  fieldResolution:    { min: 16,  max: 64,   step: 1,    symbol: 'n',  unit: '',    label: 'Field Resolution' },
};

export const SPEED_OF_SOUND = 343; // m/s

export const HISTORY_MAX_DEPTH = 50;

export const MODULES = {
  TENSEGRITY: 'tensegrity',
  ACOUSTIC: 'acoustic',
};
