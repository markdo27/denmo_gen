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
// Radius modifiers — applies all surface-perturbation algorithms in order
//
// evalAngle   : raw angle in [0, 2π) from the caller
// evalTwistY  : normalised height [0, 1] from the caller
// spiralY     : physical height in cm (used as 3rd noise axis)
// baseR       : profile radius from getProfileRadius (or sqrt of vertex xz²)
// params      : full controls params object (includes mirrorX/Y/Z flags)
// rdMap       : Float32Array (RD_RES × RD_RES) or null
// voronoiMap  : Float32Array (VOI_RES × VOI_RES) or null
// ---------------------------------------------------------------------------
export function applyRadiusModifiers(evalAngle, evalTwistY, spiralY, baseR, params, rdMap, voronoiMap) {
  let r = baseR;

  // ── Mirror folding ────────────────────────────────────────────────────
  // mirrorX — side-by-side bilateral symmetry:
  //   Fold the full 360° circle into two identical 180° halves so that
  //   the left half is an exact reflection of the right half.
  //   Achieved by mapping the angle into [0, π] via |sin| folding:
  //   any angle θ and its mirror (2π − θ) produce the same evalAngle.
  let sampleAngle = evalAngle;
  if (params.mirrorX) {
    // Normalise to [0, 2π)
    const a = ((evalAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    // Fold: right half [0,π] kept as-is; left half [π,2π] reflected back
    sampleAngle = a <= Math.PI ? a : Math.PI * 2 - a;
  }
  // mirrorZ — fold front/back (only pattern, not geometry)
  if (params.mirrorZ) {
    const a = ((sampleAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    sampleAngle = a <= Math.PI * 0.5 || a >= Math.PI * 1.5
      ? sampleAngle
      : Math.PI - sampleAngle;
  }
  // mirrorY — fold top/bottom (vertical direction)
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

  // ── Radial & vertical ripples ──────────────────────────────────────────
  if (params.radialRippleDepth > 0)
    r += Math.sin(sampleAngle * params.radialRipples) * params.radialRippleDepth;

  if (params.verticalRippleDepth > 0)
    r += Math.sin(sampleTwistY * Math.PI * params.verticalRipples) * params.verticalRippleDepth;

  // ── Bamboo stepping ───────────────────────────────────────────────────
  if (params.bambooDepth > 0) {
    const bambooHoriz = Math.pow(Math.abs(Math.cos(sampleTwistY * Math.PI * params.bambooSteps)), 10) * params.bambooDepth;
    const bambooVert  = params.bambooVerticalFreq > 0
      ? Math.pow(Math.abs(Math.cos(sampleAngle * params.bambooVerticalFreq / 2.0)), 10) * params.bambooDepth
      : 0;
    r += bambooHoriz + bambooVert;
  }

  // ── Diamond knurling ──────────────────────────────────────────────────
  if (params.diamondDepth > 0) {
    const A = sampleAngle * params.diamondFreq;
    const B = sampleTwistY * params.height * (params.diamondFreq / (params.bottomRadius || 1));
    r += (1.0 - Math.max(Math.abs(Math.sin(A + B)), Math.abs(Math.sin(A - B)))) * params.diamondDepth;
  }

  // ── Perlin FBM noise ─────────────────────────────────────────────────
  if (params.noiseDepth > 0) {
    const nx = r * Math.cos(sampleAngle) * params.noiseScale;
    const ny = spiralY * params.noiseScale;
    const nz = r * Math.sin(sampleAngle) * params.noiseScale;
    r += fbm3(nx, ny, nz) * params.noiseDepth;
  }

  // ── Reaction-Diffusion map ────────────────────────────────────────────
  if (params.rdDepth > 0 && rdMap) {
    const rdU = (Math.round((sampleAngle / (Math.PI * 2)) * RD_RES) + RD_RES) % RD_RES;
    const rdV = Math.min(RD_RES - 1, Math.round(sampleTwistY * (RD_RES - 1)));
    r += rdMap[rdV * RD_RES + rdU] * params.rdDepth;
  }

  // ── Voronoi distance field ────────────────────────────────────────────
  if (params.voronoiDepth > 0 && voronoiMap) {
    const vU = (Math.round((sampleAngle / (Math.PI * 2)) * VOI_RES) + VOI_RES) % VOI_RES;
    const vV = Math.min(VOI_RES - 1, Math.round(sampleTwistY * (VOI_RES - 1)));
    r += voronoiMap[vV * VOI_RES + vU] * params.voronoiDepth;
  }

  return r;
}

