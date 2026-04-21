/**
 * overhangAnalyzer.js
 *
 * Pure-math overhang analysis engine for the ĐÈNMỜ lamp generator.
 * Uses the exact same lampMath functions as the mesh & G-code workers so
 * warnings always reflect what will actually be printed.
 *
 * Returns a structured OverhangReport every time analyzeOverhangs() is called.
 * No React, no Three.js — safe to call inside useMemo.
 */

import { getProfileRadius, applyRadiusModifiers } from './lampMath.js';

// ─── Thresholds (degrees) ────────────────────────────────────────────────────
export const OVERHANG_SAFE     = 40;   // ≤ 40° → OK for almost all materials
export const OVERHANG_CAUTION  = 45;   // 40–45° → borderline; material-dependent
// > 45° → CRITICAL

// How many radial angles & height slices to sample in the coarse analysis pass.
// 24 angles × 200 heights ≈ 4 800 evaluations → < 2 ms on a modern CPU.
const SAMPLE_ANGLES  = 24;
const SAMPLE_HEIGHTS = 200;

// SCALE factor: cm → mm (same as gcodeWorker)
const SCALE = 10;

// ─── Main entry point ────────────────────────────────────────────────────────
/**
 * @param {object}      params           - Full Leva controls object
 * @param {number[]}    customProfileData
 * @param {Float32Array|null} rdMap
 * @param {Float32Array|null} voronoiMap
 * @returns {OverhangReport}
 */
export function analyzeOverhangs(params, customProfileData, rdMap, voronoiMap) {
  const {
    height, layerHeight, bottomRadius, midRadius, topRadius,
    bedX, bedY,
  } = params;

  // ── Bed fit check ────────────────────────────────────────────────────────
  const maxRadiusCm  = Math.max(bottomRadius, midRadius, topRadius);
  const diameterMm   = maxRadiusCm * 2 * SCALE;
  const heightMm     = height * SCALE;
  const bedFitsX     = diameterMm <= bedX;
  const bedFitsY     = diameterMm <= bedY;

  // ── Per-layer overhang scan ──────────────────────────────────────────────
  const zStep     = height / SAMPLE_HEIGHTS;
  const angleStep = (Math.PI * 2) / SAMPLE_ANGLES;

  // perLayerAngles[i] = worst overhang angle (deg) at height layer i
  const perLayerAngles = new Float32Array(SAMPLE_HEIGHTS);

  let maxOverhangAngle  = 0;
  let criticalZoneCount = 0;
  let cautionZoneCount  = 0;
  const criticalHeights = [];   // cm values of worst layers

  for (let hi = 0; hi < SAMPLE_HEIGHTS - 1; hi++) {
    const z0 = hi       * zStep;
    const z1 = (hi + 1) * zStep;
    const t0 = z0 / height;
    const t1 = z1 / height;

    const evalT0 = (params.mirrorY && t0 > 0.5) ? 1 - t0 : t0;
    const evalT1 = (params.mirrorY && t1 > 0.5) ? 1 - t1 : t1;

    const baseR0 = getProfileRadius(evalT0, params, customProfileData);
    const baseR1 = getProfileRadius(evalT1, params, customProfileData);

    let worstAngleAtLayer = 0;

    for (let ai = 0; ai < SAMPLE_ANGLES; ai++) {
      const angle = ai * angleStep;

      const r0 = applyRadiusModifiers(angle, t0, z0, baseR0, params, rdMap, voronoiMap);
      const r1 = applyRadiusModifiers(angle, t1, z1, baseR1, params, rdMap, voronoiMap);

      const deltaR = r1 - r0;   // positive = expanding outward (overhang risk)
      const deltaZ = zStep;

      if (deltaR > 0) {
        const angleRad = Math.atan(deltaR / deltaZ);
        const angleDeg = angleRad * (180 / Math.PI);
        if (angleDeg > worstAngleAtLayer) worstAngleAtLayer = angleDeg;
      }
    }

    perLayerAngles[hi] = worstAngleAtLayer;

    if (worstAngleAtLayer > maxOverhangAngle) maxOverhangAngle = worstAngleAtLayer;

    if (worstAngleAtLayer > OVERHANG_CAUTION) {
      criticalZoneCount++;
      // Record representative Z heights (not every single layer)
      if (criticalHeights.length === 0 ||
          z0 - criticalHeights[criticalHeights.length - 1] > height * 0.1) {
        criticalHeights.push(parseFloat(z0.toFixed(2)));
      }
    } else if (worstAngleAtLayer > OVERHANG_SAFE) {
      cautionZoneCount++;
    }
  }

  // ── Status ───────────────────────────────────────────────────────────────
  let status;
  if (!bedFitsX || !bedFitsY) {
    status = 'BED_OVERFLOW';
  } else if (maxOverhangAngle > OVERHANG_CAUTION) {
    status = 'CRITICAL';
  } else if (maxOverhangAngle > OVERHANG_SAFE) {
    status = 'CAUTION';
  } else {
    status = 'OK';
  }

  // ── Suggestions ──────────────────────────────────────────────────────────
  const suggestions = generateSuggestions(params, maxOverhangAngle, criticalHeights);

  return {
    maxOverhangAngle: parseFloat(maxOverhangAngle.toFixed(1)),
    criticalZoneCount,
    cautionZoneCount,
    criticalHeights,
    bedFitsX,
    bedFitsY,
    diameterMm: parseFloat(diameterMm.toFixed(1)),
    heightMm: parseFloat(heightMm.toFixed(1)),
    status,
    suggestions,
    perLayerAngles,   // Float32Array — used by OverhangOverlayMesh
  };
}

// ─── Suggestion engine ───────────────────────────────────────────────────────
function generateSuggestions(params, worstAngle, criticalHeights) {
  if (worstAngle <= OVERHANG_SAFE) return [];

  const tips = [];

  // Twist
  if (params.twistAngle > Math.PI && worstAngle > OVERHANG_CAUTION) {
    tips.push({
      param: 'Twist',
      current: params.twistAngle.toFixed(1) + ' rad',
      suggested: (params.twistAngle * 0.5).toFixed(1) + ' rad',
      reason: 'Helical paths create steep lateral overhangs',
    });
  }

  // Radial Ripple Depth
  if (params.radialRippleDepth > 0.5) {
    tips.push({
      param: 'Rib Depth',
      current: params.radialRippleDepth.toFixed(2),
      suggested: Math.max(0.1, params.radialRippleDepth * 0.4).toFixed(2),
      reason: 'Deep ribs create inward-facing overhangs on each rib shoulder',
    });
  }

  // Bamboo
  if (params.bambooDepth > 0.5) {
    tips.push({
      param: 'Bamboo Depth',
      current: params.bambooDepth.toFixed(2),
      suggested: Math.max(0.1, params.bambooDepth * 0.35).toFixed(2),
      reason: 'Bamboo rings create ledge overhangs at each step',
    });
  }

  // Diamond
  if (params.diamondDepth > 0.8) {
    tips.push({
      param: 'Diamond Depth',
      current: params.diamondDepth.toFixed(2),
      suggested: Math.max(0.1, params.diamondDepth * 0.4).toFixed(2),
      reason: 'Deep diamond knurling creates pockets with steep walls',
    });
  }

  // Noise Depth
  if (params.noiseDepth > 1.0) {
    tips.push({
      param: 'Perlin Depth',
      current: params.noiseDepth.toFixed(2),
      suggested: Math.max(0.1, params.noiseDepth * 0.5).toFixed(2),
      reason: 'High noise amplitude creates random unsupported pockets',
    });
  }

  // Voronoi
  if (params.voronoiDepth > 1.0) {
    tips.push({
      param: 'Voronoi Depth',
      current: params.voronoiDepth.toFixed(2),
      suggested: Math.max(0.1, params.voronoiDepth * 0.5).toFixed(2),
      reason: 'Deep Voronoi cells create steep cell-wall overhangs',
    });
  }

  // Profile shape: mid much larger than top+bottom
  const midExcess = params.midRadius - Math.max(params.bottomRadius, params.topRadius);
  if (midExcess > 2) {
    tips.push({
      param: 'Mid Radius',
      current: params.midRadius.toFixed(1) + ' cm',
      suggested: (params.midRadius - midExcess * 0.5).toFixed(1) + ' cm',
      reason: 'Large mid-bulge causes outward overhang at the belly of the profile',
    });
  }

  // Layer height (always a quick win)
  if (params.layerHeight > 0.16 && worstAngle > OVERHANG_CAUTION) {
    tips.push({
      param: 'Layer Height',
      current: params.layerHeight.toFixed(2) + ' mm',
      suggested: '0.12 mm',
      reason: 'Thinner layers reduce the horizontal gap each layer must bridge',
    });
  }

  return tips;
}
