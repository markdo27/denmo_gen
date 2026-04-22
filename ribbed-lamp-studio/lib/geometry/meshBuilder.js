/**
 * meshBuilder.js
 * Converts a 2D ribbed square profile + height into a THREE.BufferGeometry.
 *
 * Strategy:
 *   - Sample the ribbed 2D profile at each vertical level
 *   - Build quad strips between consecutive levels
 *   - Handle open top, open bottom, and wall thickness (inner shell)
 *
 * Coordinate system: Y = up (Three.js convention)
 */

import * as THREE from 'three';
import { squareProfile } from './squareProfile.js';
import { RIB_ALGORITHMS } from './ribbedProfile.js';

/**
 * Build a THREE.BufferGeometry for a single lamp tier.
 *
 * @param {object} tier           - Tier config from stackedAssembly
 * @param {number} verticalSteps  - Number of height samples (resolution)
 * @returns {THREE.BufferGeometry}
 */
export function buildTierGeometry(tier, verticalSteps = 120) {
  const {
    height, width, depth, cornerRadius = 2,
    wallThickness = 1.6,
    openTop = true, openBottom = true,
    texture = {},
  } = tier;

  const { algorithm = 'fine-fluting', ribCount = 48, ribDepth = 1.5, ribProfile = 'sharp' } = texture;
  const ribFn = RIB_ALGORITHMS[algorithm] ?? RIB_ALGORITHMS['fine-fluting'];

  // Base square profile (unribbed outer contour)
  const basePts    = squareProfile({ width, depth, cornerRadius, segments: 12 });
  // Ribbed outer profile
  const outerPts   = ribFn(basePts, { ribCount, ribDepth, ribProfile });
  // Inner profile (offset inward by wallThickness — simplified as uniform scale)
  const innerScale = 1 - (wallThickness * 2 / Math.min(width, depth));
  const innerPts   = squareProfile({
    width:         width  * innerScale,
    depth:         depth  * innerScale,
    cornerRadius:  Math.max(0.5, cornerRadius - wallThickness),
    segments: 12,
  });

  const N = outerPts.length; // profile point count
  if (N !== innerPts.length) {
    // Match inner length to outer
    console.warn('[meshBuilder] Inner/outer point count mismatch');
  }

  const positions  = [];
  const normals    = [];
  const indices    = [];

  // Helper: push a 3D point
  const push = (x, y, z) => { positions.push(x, y, z); normals.push(0, 0, 0); };

  // ── Build outer wall quad strip ──────────────────────────────────────────
  // Rows:   verticalSteps+1 rings of N points each
  // offset: 0  (outer points start at vertex 0)
  const outerBase = 0;
  for (let row = 0; row <= verticalSteps; row++) {
    const y = (row / verticalSteps) * height;
    for (let p = 0; p < N; p++) {
      push(outerPts[p].x, y, outerPts[p].z);
    }
  }

  // Quads for outer wall
  for (let row = 0; row < verticalSteps; row++) {
    for (let p = 0; p < N; p++) {
      const next = (p + 1) % N;
      const a = outerBase + row * N + p;
      const b = outerBase + row * N + next;
      const c = outerBase + (row + 1) * N + p;
      const d = outerBase + (row + 1) * N + next;
      indices.push(a, b, d,  a, d, c);
    }
  }

  // ── Build inner wall quad strip ──────────────────────────────────────────
  const innerBase = positions.length / 3;
  for (let row = 0; row <= verticalSteps; row++) {
    const y = (row / verticalSteps) * height;
    for (let p = 0; p < N; p++) {
      push(innerPts[p].x, y, innerPts[p].z);
    }
  }

  // Quads for inner wall (reversed winding for inward normals)
  for (let row = 0; row < verticalSteps; row++) {
    for (let p = 0; p < N; p++) {
      const next = (p + 1) % N;
      const a = innerBase + row * N + p;
      const b = innerBase + row * N + next;
      const c = innerBase + (row + 1) * N + p;
      const d = innerBase + (row + 1) * N + next;
      indices.push(a, d, b,  a, c, d); // reversed
    }
  }

  // ── Bottom cap (if closed) ────────────────────────────────────────────────
  if (!openBottom) {
    const capBase = positions.length / 3;
    // Outer ring at y=0
    outerPts.forEach(pt => push(pt.x, 0, pt.z));
    // Inner ring at y=0
    innerPts.forEach(pt => push(pt.x, 0, pt.z));
    // Triangle fan from outer → inner
    for (let p = 0; p < N; p++) {
      const next = (p + 1) % N;
      const outerA = capBase + p;
      const outerB = capBase + next;
      const innerA = capBase + N + p;
      const innerB = capBase + N + next;
      indices.push(outerA, innerA, innerB,  outerA, innerB, outerB);
    }
  }

  // ── Top cap (if closed) ───────────────────────────────────────────────────
  if (!openTop) {
    const capBase = positions.length / 3;
    outerPts.forEach(pt => push(pt.x, height, pt.z));
    innerPts.forEach(pt => push(pt.x, height, pt.z));
    for (let p = 0; p < N; p++) {
      const next = (p + 1) % N;
      const outerA = capBase + p;
      const outerB = capBase + next;
      const innerA = capBase + N + p;
      const innerB = capBase + N + next;
      indices.push(outerA, innerB, innerA,  outerA, outerB, innerB); // reversed
    }
  }

  // ── Top ring (open top: horizontal annular lip) ───────────────────────────
  // Thin ring connecting inner and outer walls at top
  {
    const lipBase = positions.length / 3;
    outerPts.forEach(pt => push(pt.x, height, pt.z));
    innerPts.forEach(pt => push(pt.x, height, pt.z));
    for (let p = 0; p < N; p++) {
      const next = (p + 1) % N;
      const outerA = lipBase + p;
      const outerB = lipBase + next;
      const innerA = lipBase + N + p;
      const innerB = lipBase + N + next;
      // Face upward
      indices.push(outerA, outerB, innerB,  outerA, innerB, innerA);
    }
  }

  // ── Assemble BufferGeometry ───────────────────────────────────────────────
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  return geo;
}

/**
 * Build all geometries for a full assembly.
 * Returns array of { geometry, yOffset, tier } per enabled tier.
 */
export function buildAssemblyGeometries(tiers, { gap = 0, verticalSteps = 120 } = {}) {
  const { getTierOffsets } = require('./stackedAssembly.js');

  const enabled = tiers.filter(t => t.enabled);
  if (enabled.length === 0) return [];

  // Stack from bottom (highest tier id) to top (tier id 0)
  let y = 0;
  const sorted = [...tiers]
    .map((t, i) => ({ ...t, origIndex: i }))
    .filter(t => t.enabled)
    .sort((a, b) => b.id - a.id);

  return sorted.map(tier => {
    const yOffset = y;
    y += tier.height + gap;
    return {
      geometry: buildTierGeometry(tier, verticalSteps),
      yOffset,
      tier,
    };
  });
}
