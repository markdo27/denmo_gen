import { degToRad } from '../utils/formatters';

/**
 * Validate tensegrity parameters — catches impossible geometry before rendering.
 * Returns { valid: boolean, errors: string[], warnings: string[], computedHeight: number|null }
 */
export function validateTensegrity({ baseRadius, topRadius, twistAngle, strutCount, strutLength }) {
  const errors = [];
  const warnings = [];

  // Guard: division by zero
  if (strutCount < 3) {
    errors.push('Strut count (N) must be ≥ 3');
    return { valid: false, errors, warnings, computedHeight: null };
  }

  if (baseRadius <= 0 || topRadius <= 0) {
    errors.push('Radii must be > 0');
    return { valid: false, errors, warnings, computedHeight: null };
  }

  if (strutLength <= 0) {
    errors.push('Strut length (L) must be > 0');
    return { valid: false, errors, warnings, computedHeight: null };
  }

  // Compute height from geometric constraint
  const theta = degToRad(twistAngle);
  const sectorAngle = (2 * Math.PI) / strutCount;
  const R1 = baseRadius;
  const R2 = topRadius;
  const L = strutLength;

  // Distance squared between connected bottom and top node
  const dx = R1 - R2 * Math.cos(theta);
  const dz = -R2 * Math.sin(theta);
  const horizontalDistSq = dx * dx + dz * dz;
  const heightSq = L * L - horizontalDistSq;

  if (heightSq < 0) {
    errors.push(`Impossible geometry: strut length (${L.toFixed(2)}) is too short for current radii and twist. H² = ${heightSq.toFixed(3)}`);
    return { valid: false, errors, warnings, computedHeight: null };
  }

  const height = Math.sqrt(heightSq);

  if (height < 0.1) {
    warnings.push('Structure is nearly flat — height < 0.1m');
  }

  if (twistAngle > 150) {
    warnings.push('Extreme twist angle may cause strut intersections');
  }

  return { valid: true, errors, warnings, computedHeight: height };
}

/**
 * Validate acoustic parameters — prevents degenerate wave fields.
 * Returns { valid: boolean, errors: string[] }
 */
export function validateAcoustic({ frequency, amplitude, transducerDistance, fieldResolution }) {
  const errors = [];

  if (frequency <= 0) {
    errors.push('Frequency must be > 0 (division by zero in wavelength)');
  }

  if (transducerDistance <= 0) {
    errors.push('Transducer distance must be > 0');
  }

  if (fieldResolution > 64) {
    errors.push('Field resolution capped at 64 to prevent GPU memory overflow');
  }

  // Total instances = resolution³ — warn if very high
  const totalInstances = Math.pow(fieldResolution, 3);
  if (totalInstances > 200000) {
    errors.push(`Resolution ${fieldResolution}³ = ${totalInstances.toLocaleString()} instances exceeds safe GPU limit`);
  }

  return { valid: errors.length === 0, errors };
}
