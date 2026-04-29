import { computeTensegrityHeight } from './tensegrity';

/**
 * Validate tensegrity parameters — catches impossible geometry before rendering.
 *
 * The geometric feasibility condition is:
 *   H² = L² − d²_XZ > 0
 * where d²_XZ = R₁² − 2R₁R₂cos(θ) + R₂²  (law of cosines)
 *
 * The strut-intersection condition for N struts is:
 *   θ_max = π/N
 * Beyond this angle, adjacent struts cross — the structure is not a true tensegrity.
 *
 * Returns { valid: boolean, errors: string[], warnings: string[], computedHeight: number|null }
 */
export function validateTensegrity({ baseRadius, topRadius, twistAngle, strutCount, strutLength }) {
  const errors   = [];
  const warnings = [];

  // ── Primitive guards ──────────────────────────────────────────────────────
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

  // ── Geometric feasibility (single computation, shared with tensegrity.js) ─
  const { heightSq, height } = computeTensegrityHeight({
    baseRadius, topRadius, twistAngle, strutLength,
  });

  if (heightSq < 0) {
    // Report the minimum strut length required for clarity
    const { horizontalDistSq } = computeTensegrityHeight({
      baseRadius, topRadius, twistAngle, strutLength,
    });
    const minLength = Math.sqrt(horizontalDistSq);
    errors.push(
      `Impossible geometry: strut too short. ` +
      `L = ${strutLength.toFixed(2)} m,  minimum required: ${minLength.toFixed(2)} m. ` +
      `(H² = ${heightSq.toFixed(3)})`
    );
    return { valid: false, errors, warnings, computedHeight: null };
  }

  // ── Structural warnings ───────────────────────────────────────────────────
  if (height < 0.1) {
    warnings.push('Structure is nearly flat — height < 0.1 m');
  }

  // Correct strut-intersection threshold: θ_max = π/N
  // (at exactly π/N adjacent struts are coplanar; beyond this they cross)
  const intersectionThresholdDeg = (180 / Math.PI) * (Math.PI / strutCount);
  if (twistAngle > intersectionThresholdDeg) {
    warnings.push(
      `Twist angle ${twistAngle}° exceeds the strut-intersection threshold ` +
      `θ_max = π/N = ${intersectionThresholdDeg.toFixed(1)}° for N=${strutCount} struts. ` +
      `Adjacent struts will intersect.`
    );
  }

  return { valid: true, errors, warnings, computedHeight: height };
}

/**
 * Validate acoustic parameters — prevents degenerate wave fields.
 *
 * The GPU instance count is resolution³. The safe upper bound is ~200 000
 * instances before frame-rate collapses on mid-range hardware.
 *
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

  // Total instances = n³ — reject before the GPU is asked to render them
  const totalInstances = fieldResolution * fieldResolution * fieldResolution;
  if (totalInstances > 200_000) {
    errors.push(
      `Resolution ${fieldResolution}³ = ${totalInstances.toLocaleString()} instances exceeds safe GPU limit`
    );
  }

  return { valid: errors.length === 0, errors };
}
