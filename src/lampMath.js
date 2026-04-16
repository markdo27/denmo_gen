/**
 * Shared lamp mathematics — imported by both App.jsx and gcodeWorker.js.
 *
 * Keeping the radius-computation logic in one place prevents the three
 * separate loops (3D mesh, G-code viewer lines, G-code export string) from
 * drifting out of sync.
 */

import { fbm3 } from './algorithms/perlinNoise.js';

export const RD_RES  = 128;
export const VOI_RES = 256;

// ---------------------------------------------------------------------------
// Profile radius — baseline radius for a given normalised height [0, 1]
// ---------------------------------------------------------------------------
export function getProfileRadius(evalT, params, customProfileData) {
  const { verticalProfile, bottomRadius, midRadius, topRadius } = params;
  let r = bottomRadius;

  if (verticalProfile === 'vase') {
    // Quadratic Bézier
    r = Math.pow(1 - evalT, 2) * bottomRadius
      + 2 * (1 - evalT) * evalT * midRadius
      + Math.pow(evalT, 2) * topRadius;

  } else if (verticalProfile === 'column') {
    r = bottomRadius;

  } else if (verticalProfile === 'cone') {
    r = bottomRadius * (1 - evalT) + topRadius * evalT;

  } else if (verticalProfile === 'sphere') {
    r = bottomRadius * Math.sin(evalT * Math.PI);
    if (r < 0.05) r = 0.05;

  } else if (verticalProfile === 'hourglass') {
    const pinch = 1.0 - Math.min(evalT, 1.0 - evalT) * 1.5;
    r = bottomRadius * Math.max(0.2, pinch);

  } else if (verticalProfile === 'teardrop') {
    r = bottomRadius * Math.sin(evalT * Math.PI) * Math.exp(-evalT * 2);

  } else if (verticalProfile === 'pagoda') {
    const tierEval = (evalT * 4) % 1.0;
    r = bottomRadius * (1.0 - evalT) * (1.0 + tierEval * 0.5);
    if (r < 0.05) r = 0.05;

  } else if (verticalProfile === 'custom' && customProfileData && customProfileData.length > 0) {
    const idx = Math.min(customProfileData.length - 1, Math.floor(evalT * customProfileData.length));
    r = Math.max(0.01, customProfileData[idx] * bottomRadius);
  }

  return r;
}

// ---------------------------------------------------------------------------
// Radius modifiers — applies all surface-perturbation algorithms in order.
//
// Mirror symmetry is implemented using TWO parallel strategies:
//
//   1. ABSOLUTE COORDINATE SAMPLING (Cartesian / noise):
//      Evaluate the 3-D noise field at (Math.abs(x), y, z).
//      Because |x| == |-x|, both the positive and negative X hemispheres
//      receive the exact same noise value → perfect bilateral symmetry
//      without any seam, no duplicated geometry.
//
//   2. POLAR BILATERAL FOLD (angle-domain modifiers):
//      The lateral mirror of angle θ is π − θ (across the YZ plane).
//      We enforce f(θ) === f(π − θ) by mapping every angle to its
//      canonical representative:
//         front (θ ∈ [0, π])  → fold to [0, π/2]  via  min(θ, π − θ)
//         back  (θ ∈ [π, 2π]) → fold to [π, 3π/2] via  min(θ, 3π − θ)
//      This is mathematically equivalent to "apply the function at both
//      θ and its mirror angle, then take the canonical sample" —
//      it avoids the destructive cancellation that would occur for
//      odd-frequency sin/cos sums when evaluating at θ and θ + π.
//
//   3. SINGLE CONTINUOUS TOOLPATH:
//      No geometry is duplicated and no object is split. The output is
//      the same single-loop array of spiral points as always; only the
//      scalar radius perturbation is made bilaterally symmetric.
//
// evalAngle   : raw angle in [0, 2π) from the caller (atan2 or ring loop)
// evalTwistY  : raw normalised height [0, 1] from the caller
// spiralY     : physical height in cm (3rd axis for noise)
// baseR       : baseline profile radius
// params      : full controls object (mirrorX/Y/Z flags live here)
// rdMap       : Float32Array [RD_RES × RD_RES] or null
// voronoiMap  : Float32Array [VOI_RES × VOI_RES] or null
// ---------------------------------------------------------------------------
export function applyRadiusModifiers(evalAngle, evalTwistY, spiralY, baseR, params, rdMap, voronoiMap) {
  let r = baseR;

  // ── Strategy 2: Polar bilateral fold ──────────────────────────────────
  //
  // mirrorX — lateral bilateral (left = right across the YZ plane)
  //   The mirror of θ is π − θ.  Fold both halves to their canonical half.
  let sampleAngle = evalAngle;
  if (params.mirrorX) {
    const TWO_PI = Math.PI * 2;
    const a = ((evalAngle % TWO_PI) + TWO_PI) % TWO_PI;  // normalise to [0, 2π)
    if (a <= Math.PI) {
      // Front hemisphere [0, π] → fold to [0, π/2]
      sampleAngle = a <= Math.PI * 0.5 ? a : Math.PI - a;
    } else {
      // Back hemisphere (π, 2π) → shift to [0, π), fold, shift back
      const b = a - Math.PI;
      sampleAngle = (b <= Math.PI * 0.5 ? b : Math.PI - b) + Math.PI;
    }
  }

  // mirrorZ — fore/aft bilateral (front = back across the XY plane)
  //   The mirror of θ is 2π − θ.  Fold to [0, π].
  if (params.mirrorZ) {
    const TWO_PI = Math.PI * 2;
    const a = ((sampleAngle % TWO_PI) + TWO_PI) % TWO_PI;
    sampleAngle = a <= Math.PI ? a : TWO_PI - a;
  }

  // mirrorY — vertical bilateral (top = bottom)
  const sampleTwistY = (params.mirrorY && evalTwistY > 0.5) ? 1.0 - evalTwistY : evalTwistY;

  // ── Cross-section shaping ──────────────────────────────────────────────
  if (params.crossSection === 'square') {
    r *= Math.cos(Math.PI / 4) / Math.max(Math.abs(Math.cos(sampleAngle)), Math.abs(Math.sin(sampleAngle)));

  } else if (params.crossSection === 'hexagon') {
    const hexAng = Math.PI / 3;
    const wrapped = Math.abs((sampleAngle % hexAng + hexAng) % hexAng - hexAng / 2);
    r *= Math.cos(hexAng / 2) / Math.cos(wrapped);

  } else if (params.crossSection === 'triangle') {
    const triAng = Math.PI * 2 / 3;
    const wrapped = Math.abs((sampleAngle % triAng + triAng) % triAng - triAng / 2);
    r *= Math.cos(triAng / 2) / Math.cos(wrapped);

  } else if (params.crossSection === 'star') {
    r *= 1.0 - (Math.sin(sampleAngle * 5) * 0.5 + 0.5) * 0.4;

  } else if (params.crossSection === 'gear') {
    r *= 1.0 + (Math.sign(Math.sin(sampleAngle * 12)) * 0.5 + 0.5) * 0.15 - 0.075;
  }

  // ── Radial ripples (polar fold) ────────────────────────────────────────
  if (params.radialRippleDepth > 0)
    r += Math.sin(sampleAngle * params.radialRipples) * params.radialRippleDepth;

  // ── Vertical ripples (height fold) ────────────────────────────────────
  if (params.verticalRippleDepth > 0)
    r += Math.sin(sampleTwistY * Math.PI * params.verticalRipples) * params.verticalRippleDepth;

  // ── Bamboo stepping (polar + height fold) ─────────────────────────────
  if (params.bambooDepth > 0) {
    const bambooHoriz = Math.pow(Math.abs(Math.cos(sampleTwistY * Math.PI * params.bambooSteps)), 10) * params.bambooDepth;
    const bambooVert  = params.bambooVerticalFreq > 0
      ? Math.pow(Math.abs(Math.cos(sampleAngle * params.bambooVerticalFreq / 2.0)), 10) * params.bambooDepth
      : 0;
    r += bambooHoriz + bambooVert;
  }

  // ── Diamond knurling (polar + height fold) ────────────────────────────
  if (params.diamondDepth > 0) {
    const A = sampleAngle * params.diamondFreq;
    const B = sampleTwistY * params.height * (params.diamondFreq / (params.bottomRadius || 1));
    r += (1.0 - Math.max(Math.abs(Math.sin(A + B)), Math.abs(Math.sin(A - B)))) * params.diamondDepth;
  }

  // ── Strategy 1: Absolute-coordinate Cartesian sampling for Perlin FBM ─
  //
  // Evaluate the noise field at (|x|, y, z) instead of (x, y, z).
  // Since fbm3(|x|, y, z) == fbm3(|-x|, y, z) by definition of abs,
  // both hemispheres receive identical noise — no seam, no fold artefact.
  if (params.noiseDepth > 0) {
    // Compute the actual 3-D position of this point on the spiral
    let   nx = r * Math.cos(evalAngle) * params.noiseScale;   // raw X coord
    const ny =     spiralY             * params.noiseScale;   // height axis
    const nz = r * Math.sin(evalAngle) * params.noiseScale;   // raw Z coord

    if (params.mirrorX) nx = Math.abs(nx);   // ← absolute-X sampling

    r += fbm3(nx, ny, nz) * params.noiseDepth;
  }

  // ── Reaction-Diffusion map (polar fold UV) ────────────────────────────
  if (params.rdDepth > 0 && rdMap) {
    const rdU = (Math.round((sampleAngle / (Math.PI * 2)) * RD_RES) + RD_RES) % RD_RES;
    const rdV = Math.min(RD_RES - 1, Math.round(sampleTwistY * (RD_RES - 1)));
    r += rdMap[rdV * RD_RES + rdU] * params.rdDepth;
  }

  // ── Voronoi distance field (polar fold UV) ────────────────────────────
  if (params.voronoiDepth > 0 && voronoiMap) {
    const vU = (Math.round((sampleAngle / (Math.PI * 2)) * VOI_RES) + VOI_RES) % VOI_RES;
    const vV = Math.min(VOI_RES - 1, Math.round(sampleTwistY * (VOI_RES - 1)));
    r += voronoiMap[vV * VOI_RES + vU] * params.voronoiDepth;
  }

  return r;
}
