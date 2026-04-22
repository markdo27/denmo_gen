/**
 * layerSlicer.js
 * Slices the ribbed lamp profile into horizontal contours at each layer height.
 * Returns a stack of closed 2D contours (one per layer) for G-code generation.
 *
 * For the ribbed lamp geometry:
 *   - The cross-section at any height Y is the outer ribbed profile + inner wall offset
 *   - Since ribs are purely vertical (no height variation), the contour is constant
 *     unless the tier tapers. We support optional taper (scale → towards top).
 */

import { squareProfile } from '../geometry/squareProfile.js';
import { RIB_ALGORITHMS } from '../geometry/ribbedProfile.js';

/**
 * Compute the contour points at a given normalised height within a tier.
 *
 * @param {object} tier         - Tier config
 * @param {number} t            - Normalised height in tier [0, 1]
 * @param {number} profilePtsN  - Number of profile points (resolution)
 * @returns {{ x: number, z: number }[]} - Outer wall contour
 */
export function getTierContour(tier, t = 0, profilePtsN = 64) {
  const {
    width, depth, cornerRadius = 2, wallThickness = 1.6,
    texture = {},
    taperTop = 0,    // scale reduction at top (0 = no taper)
  } = tier;

  const scale = 1 - taperTop * t;
  const { algorithm = 'fine-fluting', ribCount = 48, ribDepth = 1.5, ribProfile = 'sharp' } = texture;
  const ribFn = RIB_ALGORITHMS[algorithm] ?? RIB_ALGORITHMS['fine-fluting'];

  const base = squareProfile({
    width:  width  * scale,
    depth:  depth  * scale,
    cornerRadius: cornerRadius * scale,
    segments: Math.max(4, Math.round(profilePtsN / 4 / 4)),
  });

  return ribFn(base, { ribCount, ribDepth, ribProfile });
}

/**
 * Slice a single tier into layers.
 *
 * @param {object} tier           - Tier config
 * @param {object} sliceOptions   - { layerHeight, profilePtsN }
 * @param {number} yBase          - Absolute Y offset of this tier's base (mm)
 * @returns {{ z: number, points: {x,y}[] }[]}
 *   z = absolute print height, points = XY contour (Y-up → XY for G-code)
 */
export function sliceTier(tier, { layerHeight = 0.2, profilePtsN = 64 } = {}, yBase = 0) {
  const layers = [];
  const nLayers = Math.floor(tier.height / layerHeight);

  for (let li = 0; li <= nLayers; li++) {
    const z = yBase + li * layerHeight;          // absolute Z
    const t = li / nLayers;                      // normalised height
    const contour = getTierContour(tier, t, profilePtsN);

    // Convert from XZ (3D) to XY (G-code plane)
    const points = contour.map(pt => ({ x: pt.x, y: pt.z }));
    layers.push({ z, points });
  }

  return layers;
}

/**
 * Slice the full multi-tier assembly.
 *
 * @param {object[]} tiers        - All tier configs (from store)
 * @param {object}   sliceOptions - { layerHeight, profilePtsN, gap }
 * @returns {{ z: number, points: {x,y}[] }[]} - All layers sorted by z ascending
 */
export function sliceAssembly(tiers, sliceOptions = {}) {
  const { layerHeight = 0.2, profilePtsN = 64, gap = 0 } = sliceOptions;

  const enabledTiers = [...tiers]
    .filter(t => t.enabled)
    .sort((a, b) => b.id - a.id); // bottom-first

  let yBase = 0;
  const allLayers = [];

  enabledTiers.forEach(tier => {
    const tierLayers = sliceTier(tier, { layerHeight, profilePtsN }, yBase);
    allLayers.push(...tierLayers);
    yBase += tier.height + gap;
  });

  // Sort by z (should already be sorted, but ensure)
  allLayers.sort((a, b) => a.z - b.z);
  return allLayers;
}
