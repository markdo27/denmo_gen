/**
 * ffd.js — Free-Form Deformation (FFD) for cylindrical lathe geometry.
 *
 * Theory (Sederberg & Parry, 1986):
 * A rectilinear lattice of L×M×N control points is placed around the object.
 * Each world-space point P is mapped to parametric lattice coordinates (s,t,u)
 * in [0,1]³, then deformed by the trivariate Bernstein polynomial:
 *
 *   FFD(P) = Σᵢ Σⱼ Σₖ  B_i^L(s) · B_j^M(t) · B_k^N(u) · P_ijk
 *
 * where B_i^n(x) = C(n,i) · x^i · (1-x)^(n-i)  (Bernstein basis).
 *
 * Our adaptation for this lamp generator:
 *  - The lattice spans [−R, +R] in X, [−R, +R] in Z, [0, H] in Y.
 *  - The cylindrical lamp already lives in the centre of the lattice.
 *  - ONLY the Y axis has meaningful control (height layers) — we expose
 *    L = 2 (two radial cols, so the user controls per-layer radial scale
 *    with a single scale factor per ring), and N = ffdRows (default 4).
 *  - Each control point stores a DISPLACEMENT [dx, dy, dz] from its rest
 *    position; rest deltas are all zero (identity deformation).
 *
 * The user-facing parameters (from Leva sliders) are:
 *   ffdRows     — number of horizontal rings (2–8)
 *   ffdScales[] — per-ring XZ scale multiplier (1 = no deformation)
 *   ffdTilts[]  — per-ring Y offset (0 = no tilt)
 *
 * This produces the exact effect shown in the 3ds Max FFD tutorial:
 * horizontal rings of control points that pinch / bulge the silhouette.
 */

// ── Bernstein basis polynomial ──────────────────────────────────────────────
// B_i^n(t) = C(n,i) * t^i * (1-t)^(n-i)
function bernstein(n, i, t) {
  return binomial(n, i) * Math.pow(t, i) * Math.pow(1 - t, n - i);
}

// Precompute Pascal's triangle up to n=7
const PASCAL = (() => {
  const rows = 8;
  const C = Array.from({ length: rows }, () => new Float64Array(rows));
  for (let n = 0; n < rows; n++) {
    C[n][0] = 1;
    for (let k = 1; k <= n; k++) C[n][k] = C[n-1][k-1] + C[n-1][k];
  }
  return C;
})();

function binomial(n, k) {
  if (k < 0 || k > n) return 0;
  return PASCAL[n][k];
}

/**
 * Build the rest lattice for a lamp of given height and radius.
 *
 * @param {number} rows   — number of horizontal rings (min 2)
 * @param {number} height — lamp height (cm)
 * @param {number} radius — max profile radius (cm) — lattice half-width
 * @returns {Array<{restY: number, scaleXZ: number, tiltY: number}>}
 *   One entry per ring, from bottom (i=0) to top (i=rows-1).
 *   scaleXZ: current XZ scale multiplier (1 = identity)
 *   tiltY:   current Y translation of the ring (0 = identity)
 */
export function buildFFDLattice(rows, height, radius) {
  const rings = [];
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1);            // 0 at bottom, 1 at top
    rings.push({
      restY:   t * height,               // world-space rest Y of this ring
      scaleXZ: 1.0,                      // default: no deformation
      tiltY:   0.0,                      // default: no Y shift
    });
  }
  return rings;
}

/**
 * Apply the FFD deformation to a single vertex (x, y, z).
 *
 * The algorithm:
 * 1. Map y → t ∈ [0,1] (parametric height in lattice)
 * 2. Compute Bernstein weights for the N rings
 * 3. Interpolate the ring's scaleXZ and tiltY using the weights
 * 4. Apply the blended scale to x,z and add the blended tiltY to y
 *
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {Array}  rings  — from buildFFDLattice / user controls
 * @param {number} height — lamp height (cm)
 * @returns {{x, y, z}} deformed position
 */
export function applyFFD(x, y, z, rings, height) {
  if (!rings || rings.length < 2) return { x, y, z };

  const N = rings.length - 1;           // Bernstein degree
  const t = Math.max(0, Math.min(1, y / height));  // parametric Y ∈ [0,1]

  // Evaluate trivariate Bernstein for the Y axis only (1D in practice):
  // scaleXZ(t) = Σᵢ B_i^N(t) · rings[i].scaleXZ
  // tiltY(t)   = Σᵢ B_i^N(t) · rings[i].tiltY
  let blendedScale = 0;
  let blendedTilt  = 0;

  for (let i = 0; i <= N; i++) {
    const w = bernstein(N, i, t);
    blendedScale += w * rings[i].scaleXZ;
    blendedTilt  += w * rings[i].tiltY;
  }

  return {
    x: x * blendedScale,
    y: y + blendedTilt,
    z: z * blendedScale,
  };
}

/**
 * Compute the XZ scale at a given normalized height t (for the overlap scanner).
 */
export function sampleFFDScale(t, rings) {
  if (!rings || rings.length < 2) return 1;
  const N = rings.length - 1;
  let blendedScale = 0;
  for (let i = 0; i <= N; i++) {
    blendedScale += bernstein(N, i, t) * rings[i].scaleXZ;
  }
  return blendedScale;
}

/**
 * Convert flat Leva slider arrays (ffdScales, ffdTilts) into a rings array.
 * Leva can't render dynamic-length arrays, so we use fixed-length params
 * (ffdScale0..ffdScale7, ffdTilt0..ffdTilt7) and pack them here.
 *
 * @param {object} params — full Leva params object
 * @param {number} height — lamp height
 * @returns {Array} rings array for applyFFD
 */
export function buildFFDRingsFromParams(params, height) {
  const rows = Math.max(2, Math.min(8, params.ffdRows ?? 4));
  const rings = [];
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1);
    rings.push({
      restY:   t * height,
      scaleXZ: params[`ffdScale${i}`] ?? 1.0,
      tiltY:   params[`ffdTilt${i}`]  ?? 0.0,
    });
  }
  return rings;
}
