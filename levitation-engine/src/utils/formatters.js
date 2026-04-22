/**
 * Format a number for display in parameter readouts.
 * Uses tabular figures and fixed decimal places based on step size.
 */
export function formatValue(value, step = 1) {
  if (step >= 1) return Math.round(value).toString();
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return value.toFixed(decimals);
}

/**
 * Degrees → Radians
 */
export function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Radians → Degrees
 */
export function radToDeg(rad) {
  return (rad * 180) / Math.PI;
}

/**
 * Clamp value to [min, max]
 */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
