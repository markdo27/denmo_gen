/**
 * lighterHole.js
 * Generates geometry for a Bic lighter cavity (hole) and complete lighter cases.
 *
 * Reference dimensions (approximate):
 *   Bic Standard (Maxi):  80mm H × 25mm W × 14mm D  (rounded-rect cross-section)
 *   Bic Mini:             63mm H × 21mm W × 11mm D
 *
 * The cavity is a rounded-rectangle prism that matches the lighter body.
 * The top portion of the lighter (~15–20mm) protrudes above the case.
 *
 * Coordinate system: Y = up (Three.js convention)
 */

import * as THREE from 'three';

// ─── Bic Lighter Dimension Presets ───────────────────────────────────────────
export const BIC_PRESETS = {
  standard: {
    label:        'Bic Standard (Maxi)',
    bodyWidth:    25.0,   // mm — widest dimension
    bodyDepth:    14.0,   // mm — thinnest dimension
    bodyHeight:   80.0,   // mm — total lighter height
    cornerRadius: 5.0,    // mm — rounded corner radius of the body
    topExposed:   18.0,   // mm — how much protrudes above the case
  },
  mini: {
    label:        'Bic Mini',
    bodyWidth:    21.0,
    bodyDepth:    11.0,
    bodyHeight:   63.0,
    cornerRadius: 4.0,
    topExposed:   15.0,
  },
};

// ─── Rounded-Rectangle 2D Profile ────────────────────────────────────────────
/**
 * Generate a 2D rounded-rectangle polygon in the XZ plane.
 *
 * @param {number} width        - Full width (X axis), mm
 * @param {number} depth        - Full depth (Z axis), mm
 * @param {number} cornerRadius - Fillet radius, mm
 * @param {number} segments     - Arc segments per corner (4–16)
 * @returns {{ x: number, z: number }[]}  Closed polygon (last pt ≈ first pt)
 */
export function roundedRectProfile({ width, depth, cornerRadius, segments = 8 }) {
  const hw = width / 2;
  const hd = depth / 2;
  const r  = Math.min(cornerRadius, hw * 0.95, hd * 0.95);  // clamp to not exceed half-dims
  const pts = [];

  // Corner centres (inset by r from each corner)
  const corners = [
    { cx:  hw - r, cz:  hd - r, startAngle: 0              },   // +X +Z
    { cx: -hw + r, cz:  hd - r, startAngle: Math.PI * 0.5  },   // -X +Z
    { cx: -hw + r, cz: -hd + r, startAngle: Math.PI        },   // -X -Z
    { cx:  hw - r, cz: -hd + r, startAngle: Math.PI * 1.5  },   // +X -Z
  ];

  corners.forEach(({ cx, cz, startAngle }) => {
    for (let s = 0; s <= segments; s++) {
      const angle = startAngle + (s / segments) * (Math.PI / 2);
      pts.push({
        x: cx + r * Math.cos(angle),
        z: cz + r * Math.sin(angle),
      });
    }
  });

  return pts;
}

// ─── Lighter Cavity (Hole) Geometry ──────────────────────────────────────────
/**
 * Build a THREE.BufferGeometry representing the lighter cavity.
 * This is a hollow rounded-rectangle prism open at the top.
 *
 * Usage: Position this geometry inside your case mesh and use it for:
 *   - Visual preview (translucent red)
 *   - CSG subtraction (if you have a CSG library)
 *   - Direct mesh assembly (building the case wall around it)
 *
 * @param {object} opts
 * @param {'standard'|'mini'} opts.preset      - Bic size preset
 * @param {number}            opts.tolerance    - Extra clearance around lighter (mm), default 0.4
 * @param {number}            opts.caseDepth    - How deep the lighter sits (mm from bottom), auto-calculated if omitted
 * @param {number}            opts.verticalSteps- Height resolution
 * @returns {THREE.BufferGeometry}
 */
export function buildLighterCavityGeometry({
  preset      = 'standard',
  tolerance   = 0.4,
  caseDepth   = null,
  verticalSteps = 32,
} = {}) {
  const dims = BIC_PRESETS[preset] ?? BIC_PRESETS.standard;

  // Cavity dimensions = lighter body + tolerance on each side
  const cavW = dims.bodyWidth  + tolerance * 2;
  const cavD = dims.bodyDepth  + tolerance * 2;
  const cavR = dims.cornerRadius + tolerance;
  const cavH = caseDepth ?? (dims.bodyHeight - dims.topExposed);

  const profile = roundedRectProfile({
    width:        cavW,
    depth:        cavD,
    cornerRadius: cavR,
    segments:     8,
  });

  const N = profile.length;
  const positions = [];
  const indices   = [];

  // ── Wall vertices: rings from y=0 (bottom) to y=cavH (top/open) ──────────
  for (let row = 0; row <= verticalSteps; row++) {
    const y = (row / verticalSteps) * cavH;
    for (let p = 0; p < N; p++) {
      positions.push(profile[p].x, y, profile[p].z);
    }
  }

  // ── Wall quads (inward-facing normals — this is a hole) ───────────────────
  for (let row = 0; row < verticalSteps; row++) {
    for (let p = 0; p < N; p++) {
      const next = (p + 1) % N;
      const a = row * N + p;
      const b = row * N + next;
      const c = (row + 1) * N + p;
      const d = (row + 1) * N + next;
      // Reversed winding for inward normals
      indices.push(a, d, b, a, c, d);
    }
  }

  // ── Bottom cap (closed floor of the cavity) ───────────────────────────────
  const capBase = positions.length / 3;
  // Centre point
  positions.push(0, 0, 0);
  const centreIdx = capBase;
  // Ring at y=0
  for (let p = 0; p < N; p++) {
    positions.push(profile[p].x, 0, profile[p].z);
  }
  // Fan triangles (facing downward into cavity)
  for (let p = 0; p < N; p++) {
    const next = (p + 1) % N;
    const ringA = capBase + 1 + p;
    const ringB = capBase + 1 + next;
    indices.push(centreIdx, ringB, ringA);  // winding for upward-facing normal inside cavity
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  return geo;
}

// ─── Complete Lighter Case Geometry ──────────────────────────────────────────
/**
 * Build a complete lighter case mesh with an integrated cavity.
 * The case has an outer decorative shell and an inner lighter-shaped hole.
 *
 * Returns both geometries for flexible rendering:
 *   - outerGeometry: the decorative case shell (rendered as solid)
 *   - cavityGeometry: the lighter hole (can be rendered translucent for preview)
 *   - combinedGeometry: merged geometry with proper winding for STL export
 *
 * @param {object} opts
 * @param {'standard'|'mini'}  opts.lighterPreset    - Bic size preset
 * @param {'cylinder'|'rounded-square'|'circle'} opts.outerShape - Outer case cross-section
 * @param {number}             opts.outerWidth       - Outer case width (mm)
 * @param {number}             opts.outerDepth       - Outer case depth (mm), defaults to outerWidth
 * @param {number}             opts.outerCornerRadius- Corner radius for rounded-square outer shape
 * @param {number}             opts.caseHeight       - Total case height (mm), auto if omitted
 * @param {number}             opts.wallThickness    - Min wall around lighter (mm)
 * @param {number}             opts.bottomThickness  - Floor thickness under lighter (mm)
 * @param {number}             opts.tolerance        - Lighter clearance (mm)
 * @param {number}             opts.verticalSteps    - Height resolution
 * @param {number}             opts.radialSegments   - Circular resolution (for cylinder/circle)
 * @returns {{ outerGeometry, cavityGeometry, caseHeight, cavityHeight, dims }}
 */
export function buildLighterCaseGeometry({
  lighterPreset    = 'standard',
  outerShape       = 'cylinder',
  outerWidth       = null,
  outerDepth       = null,
  outerCornerRadius = 4,
  caseHeight       = null,
  wallThickness    = 3.0,
  bottomThickness  = 2.5,
  tolerance        = 0.4,
  verticalSteps    = 64,
  radialSegments   = 48,
} = {}) {
  const dims = BIC_PRESETS[lighterPreset] ?? BIC_PRESETS.standard;

  // Cavity dimensions
  const cavW = dims.bodyWidth  + tolerance * 2;
  const cavD = dims.bodyDepth  + tolerance * 2;
  const cavR = dims.cornerRadius + tolerance;

  // Auto-size outer shell if not provided
  const oW = outerWidth  ?? (cavW + wallThickness * 2);
  const oD = outerDepth  ?? (cavD + wallThickness * 2);

  // Cavity depth (lighter sits this deep in the case)
  const cavityH = dims.bodyHeight - dims.topExposed;

  // Total case height
  const totalH = caseHeight ?? (cavityH + bottomThickness);

  // ── Build outer shell ──────────────────────────────────────────────────────
  const outerPositions = [];
  const outerIndices   = [];

  let outerProfile;
  if (outerShape === 'cylinder' || outerShape === 'circle') {
    // Circular cross-section
    outerProfile = [];
    const radius = oW / 2;
    for (let i = 0; i < radialSegments; i++) {
      const angle = (i / radialSegments) * Math.PI * 2;
      outerProfile.push({
        x: radius * Math.cos(angle),
        z: radius * Math.sin(angle),
      });
    }
  } else {
    // Rounded square
    outerProfile = roundedRectProfile({
      width:        oW,
      depth:        oD,
      cornerRadius: outerCornerRadius,
      segments:     8,
    });
  }

  const outerN = outerProfile.length;

  // Outer wall vertices
  for (let row = 0; row <= verticalSteps; row++) {
    const y = (row / verticalSteps) * totalH;
    for (let p = 0; p < outerN; p++) {
      outerPositions.push(outerProfile[p].x, y, outerProfile[p].z);
    }
  }

  // Outer wall quads (outward-facing normals)
  for (let row = 0; row < verticalSteps; row++) {
    for (let p = 0; p < outerN; p++) {
      const next = (p + 1) % outerN;
      const a = row * outerN + p;
      const b = row * outerN + next;
      const c = (row + 1) * outerN + p;
      const d = (row + 1) * outerN + next;
      indices_push(outerIndices, a, b, d, a, d, c);
    }
  }

  // Bottom cap (outer, closed)
  const botBase = outerPositions.length / 3;
  outerPositions.push(0, 0, 0);  // centre
  for (let p = 0; p < outerN; p++) {
    outerPositions.push(outerProfile[p].x, 0, outerProfile[p].z);
  }
  for (let p = 0; p < outerN; p++) {
    const next = (p + 1) % outerN;
    outerIndices.push(botBase, botBase + 1 + p, botBase + 1 + next);
  }

  // ── Inner cavity profile ──────────────────────────────────────────────────
  const innerProfile = roundedRectProfile({
    width:        cavW,
    depth:        cavD,
    cornerRadius: cavR,
    segments:     8,
  });
  const innerN = innerProfile.length;

  // Inner wall vertices (from y=bottomThickness to y=totalH)
  const innerBase = outerPositions.length / 3;
  const innerWallH = totalH - bottomThickness;

  for (let row = 0; row <= verticalSteps; row++) {
    const y = bottomThickness + (row / verticalSteps) * innerWallH;
    for (let p = 0; p < innerN; p++) {
      outerPositions.push(innerProfile[p].x, y, innerProfile[p].z);
    }
  }

  // Inner wall quads (inward-facing normals — reversed winding)
  for (let row = 0; row < verticalSteps; row++) {
    for (let p = 0; p < innerN; p++) {
      const next = (p + 1) % innerN;
      const a = innerBase + row * innerN + p;
      const b = innerBase + row * innerN + next;
      const c = innerBase + (row + 1) * innerN + p;
      const d = innerBase + (row + 1) * innerN + next;
      outerIndices.push(a, d, b, a, c, d);  // reversed
    }
  }

  // Inner bottom cap (floor of cavity at y=bottomThickness)
  const innerCapBase = outerPositions.length / 3;
  outerPositions.push(0, bottomThickness, 0);  // centre
  for (let p = 0; p < innerN; p++) {
    outerPositions.push(innerProfile[p].x, bottomThickness, innerProfile[p].z);
  }
  for (let p = 0; p < innerN; p++) {
    const next = (p + 1) % innerN;
    outerIndices.push(innerCapBase, innerCapBase + 1 + next, innerCapBase + 1 + p);
  }

  // ── Top lip (annular ring connecting outer wall to inner wall at y=totalH) ─
  const lipBase = outerPositions.length / 3;
  // Outer ring at top
  for (let p = 0; p < outerN; p++) {
    outerPositions.push(outerProfile[p].x, totalH, outerProfile[p].z);
  }
  // Inner ring at top
  for (let p = 0; p < innerN; p++) {
    outerPositions.push(innerProfile[p].x, totalH, innerProfile[p].z);
  }

  // Connect outer ring to inner ring with triangles (simplified: same segment count)
  // If segment counts differ, we use a zipper approach
  const lipOuterStart = lipBase;
  const lipInnerStart = lipBase + outerN;

  if (outerN === innerN) {
    // Simple 1:1 quad strip
    for (let p = 0; p < outerN; p++) {
      const next = (p + 1) % outerN;
      const oA = lipOuterStart + p;
      const oB = lipOuterStart + next;
      const iA = lipInnerStart + p;
      const iB = lipInnerStart + next;
      outerIndices.push(oA, oB, iB, oA, iB, iA);
    }
  } else {
    // Ratio-based stitching for different segment counts
    for (let i = 0; i < Math.max(outerN, innerN); i++) {
      const oIdx  = Math.floor((i / Math.max(outerN, innerN)) * outerN) % outerN;
      const oNext = (oIdx + 1) % outerN;
      const iIdx  = Math.floor((i / Math.max(outerN, innerN)) * innerN) % innerN;
      const iNext = (iIdx + 1) % innerN;
      outerIndices.push(
        lipOuterStart + oIdx,
        lipOuterStart + oNext,
        lipInnerStart + iIdx,
      );
      outerIndices.push(
        lipOuterStart + oNext,
        lipInnerStart + iNext,
        lipInnerStart + iIdx,
      );
    }
  }

  // ── Assemble ──────────────────────────────────────────────────────────────
  const outerGeo = new THREE.BufferGeometry();
  outerGeo.setAttribute('position', new THREE.Float32BufferAttribute(outerPositions, 3));
  outerGeo.setIndex(outerIndices);
  outerGeo.computeVertexNormals();

  // Also build standalone cavity for preview overlay
  const cavityGeo = buildLighterCavityGeometry({
    preset:    lighterPreset,
    tolerance,
    caseDepth: cavityH,
    verticalSteps,
  });
  // Offset cavity to sit above bottomThickness
  const cavPosAttr = cavityGeo.attributes.position;
  for (let i = 0; i < cavPosAttr.count; i++) {
    cavPosAttr.setY(i, cavPosAttr.getY(i) + bottomThickness);
  }
  cavPosAttr.needsUpdate = true;

  return {
    outerGeometry:  outerGeo,
    cavityGeometry: cavityGeo,
    caseHeight:     totalH,
    cavityHeight:   cavityH,
    dims: {
      ...dims,
      cavityWidth:  cavW,
      cavityDepth:  cavD,
      outerWidth:   oW,
      outerDepth:   oD,
    },
  };
}

// ── Helper ──────────────────────────────────────────────────────────────────
function indices_push(arr, ...vals) {
  for (const v of vals) arr.push(v);
}

// ─── Lighter Hole for Existing Tier Geometry (Mesh Integration) ──────────────
/**
 * Modify an existing tier geometry to include a lighter hole.
 * This works by building the cavity wall and floor inside the tier mesh.
 *
 * For use with the ribbed-lamp-studio's buildTierGeometry:
 *   1. Build the tier geometry normally
 *   2. Call this function to get a cavity geometry
 *   3. Merge both into a single BufferGeometry for export
 *
 * @param {object} opts
 * @param {'standard'|'mini'} opts.preset   - Bic size preset
 * @param {number} opts.tolerance           - Clearance (mm)
 * @param {number} opts.tierHeight          - Height of the tier (mm)
 * @param {number} opts.bottomThickness     - Floor thickness (mm)
 * @param {number} opts.verticalSteps       - Resolution
 * @param {number} opts.offsetX             - Cavity X offset from centre (mm)
 * @param {number} opts.offsetZ             - Cavity Z offset from centre (mm)
 * @returns {{ cavityGeometry: THREE.BufferGeometry, lighterDepth: number }}
 */
export function buildLighterHoleForTier({
  preset          = 'standard',
  tolerance       = 0.4,
  tierHeight      = 60,
  bottomThickness = 2.5,
  verticalSteps   = 32,
  offsetX         = 0,
  offsetZ         = 0,
} = {}) {
  const dims = BIC_PRESETS[preset] ?? BIC_PRESETS.standard;

  const cavW = dims.bodyWidth  + tolerance * 2;
  const cavD = dims.bodyDepth  + tolerance * 2;
  const cavR = dims.cornerRadius + tolerance;

  // Cavity starts at bottomThickness, goes up to tierHeight (open top)
  const cavityH = tierHeight - bottomThickness;

  const profile = roundedRectProfile({
    width:        cavW,
    depth:        cavD,
    cornerRadius: cavR,
    segments:     8,
  });

  const N = profile.length;
  const positions = [];
  const indices   = [];

  // ── Cavity wall (inward-facing) ──────────────────────────────────────────
  for (let row = 0; row <= verticalSteps; row++) {
    const y = bottomThickness + (row / verticalSteps) * cavityH;
    for (let p = 0; p < N; p++) {
      positions.push(profile[p].x + offsetX, y, profile[p].z + offsetZ);
    }
  }

  for (let row = 0; row < verticalSteps; row++) {
    for (let p = 0; p < N; p++) {
      const next = (p + 1) % N;
      const a = row * N + p;
      const b = row * N + next;
      const c = (row + 1) * N + p;
      const d = (row + 1) * N + next;
      // Inward normals (reversed winding)
      indices.push(a, d, b, a, c, d);
    }
  }

  // ── Cavity floor (at y=bottomThickness) ──────────────────────────────────
  const floorBase = positions.length / 3;
  positions.push(offsetX, bottomThickness, offsetZ);  // centre
  for (let p = 0; p < N; p++) {
    positions.push(profile[p].x + offsetX, bottomThickness, profile[p].z + offsetZ);
  }
  for (let p = 0; p < N; p++) {
    const next = (p + 1) % N;
    // Facing upward (inside the cavity)
    indices.push(floorBase, floorBase + 1 + next, floorBase + 1 + p);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  return {
    cavityGeometry: geo,
    lighterDepth:   cavityH,
    cavityWidth:    cavW,
    cavityDepth:    cavD,
  };
}

// ─── Merge Geometries Utility ────────────────────────────────────────────────
/**
 * Merge multiple THREE.BufferGeometry instances into one.
 * Useful for combining outer shell + cavity into a single export mesh.
 *
 * @param {THREE.BufferGeometry[]} geometries
 * @returns {THREE.BufferGeometry}
 */
export function mergeGeometries(geometries) {
  let totalVerts  = 0;
  let totalTris   = 0;

  for (const geo of geometries) {
    totalVerts += geo.attributes.position.count;
    totalTris  += geo.index ? geo.index.count : geo.attributes.position.count;
  }

  const mergedPos = new Float32Array(totalVerts * 3);
  const mergedIdx = [];
  let vertOffset = 0;

  for (const geo of geometries) {
    const pos = geo.attributes.position.array;
    mergedPos.set(pos, vertOffset * 3);

    if (geo.index) {
      const idx = geo.index.array;
      for (let i = 0; i < idx.length; i++) {
        mergedIdx.push(idx[i] + vertOffset);
      }
    } else {
      for (let i = 0; i < pos.length / 3; i++) {
        mergedIdx.push(i + vertOffset);
      }
    }

    vertOffset += geo.attributes.position.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(mergedPos, 3));
  merged.setIndex(mergedIdx);
  merged.computeVertexNormals();

  return merged;
}
