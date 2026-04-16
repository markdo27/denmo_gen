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
// evalAngle   : angle in [0, 2π) (may be pre-mirrored by caller)
// evalTwistY  : normalised height [0, 1] (may be pre-mirrored by caller)
// spiralY     : physical height in cm (used as 3rd noise axis)
// baseR       : profile radius from getProfileRadius (or sqrt of vertex xz²)
// params      : full Leva params object
// rdMap       : Float32Array (RD_RES × RD_RES) or null
// voronoiMap  : Float32Array (VOI_RES × VOI_RES) or null
// ---------------------------------------------------------------------------
export function applyRadiusModifiers(evalAngle, evalTwistY, spiralY, baseR, params, rdMap, voronoiMap) {
  let r = baseR;

  // ── Cross-section shaping ──────────────────────────────────────────────
  if (params.crossSection === 'square') {
    r *= Math.cos(Math.PI / 4) / Math.max(Math.abs(Math.cos(evalAngle)), Math.abs(Math.sin(evalAngle)));

  } else if (params.crossSection === 'hexagon') {
    const hexAng = Math.PI / 3;
    const wrapped = Math.abs((evalAngle % hexAng + hexAng) % hexAng - hexAng / 2);
    r *= Math.cos(hexAng / 2) / Math.cos(wrapped);

  } else if (params.crossSection === 'triangle') {
    const triAng = Math.PI * 2 / 3;
    const wrapped = Math.abs((evalAngle % triAng + triAng) % triAng - triAng / 2);
    r *= Math.cos(triAng / 2) / Math.cos(wrapped);

  } else if (params.crossSection === 'star') {
    r *= 1.0 - (Math.sin(evalAngle * 5) * 0.5 + 0.5) * 0.4;

  } else if (params.crossSection === 'gear') {
    r *= 1.0 + (Math.sign(Math.sin(evalAngle * 12)) * 0.5 + 0.5) * 0.15 - 0.075;
  }

  // ── Radial & vertical ripples ──────────────────────────────────────────
  if (params.radialRippleDepth > 0)
    r += Math.sin(evalAngle * params.radialRipples) * params.radialRippleDepth;

  if (params.verticalRippleDepth > 0)
    r += Math.sin(evalTwistY * Math.PI * params.verticalRipples) * params.verticalRippleDepth;

  // ── Bamboo stepping ───────────────────────────────────────────────────
  if (params.bambooDepth > 0) {
    const bambooHoriz = Math.pow(Math.abs(Math.cos(evalTwistY * Math.PI * params.bambooSteps)), 10) * params.bambooDepth;
    const bambooVert  = params.bambooVerticalFreq > 0
      ? Math.pow(Math.abs(Math.cos(evalAngle * params.bambooVerticalFreq / 2.0)), 10) * params.bambooDepth
      : 0;
    r += bambooHoriz + bambooVert;
  }

  // ── Diamond knurling ──────────────────────────────────────────────────
  if (params.diamondDepth > 0) {
    const A = evalAngle * params.diamondFreq;
    const B = evalTwistY * params.height * (params.diamondFreq / (params.bottomRadius || 1));
    r += (1.0 - Math.max(Math.abs(Math.sin(A + B)), Math.abs(Math.sin(A - B)))) * params.diamondDepth;
  }

  // ── Perlin FBM noise ─────────────────────────────────────────────────
  if (params.noiseDepth > 0) {
    const nx = r * Math.cos(evalAngle) * params.noiseScale;
    const ny = spiralY * params.noiseScale;
    const nz = r * Math.sin(evalAngle) * params.noiseScale;
    r += fbm3(nx, ny, nz) * params.noiseDepth;
  }

  // ── Reaction-Diffusion map ────────────────────────────────────────────
  if (params.rdDepth > 0 && rdMap) {
    const rdU = (Math.round((evalAngle / (Math.PI * 2)) * RD_RES) + RD_RES) % RD_RES;
    const rdV = Math.min(RD_RES - 1, Math.round(evalTwistY * (RD_RES - 1)));
    r += rdMap[rdV * RD_RES + rdU] * params.rdDepth;
  }

  // ── Voronoi distance field ────────────────────────────────────────────
  if (params.voronoiDepth > 0 && voronoiMap) {
    const vU = (Math.round((evalAngle / (Math.PI * 2)) * VOI_RES) + VOI_RES) % VOI_RES;
    const vV = Math.min(VOI_RES - 1, Math.round(evalTwistY * (VOI_RES - 1)));
    r += voronoiMap[vV * VOI_RES + vU] * params.voronoiDepth;
  }

  return r;
}
