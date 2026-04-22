/**
 * ribbedProfile.js
 * Three procedural rib/texture algorithms extracted from reference lamp images.
 *
 * All algorithms take a 2D profile point array (from squareProfile) and
 * displace points radially outward by the rib offset at each point.
 *
 * Reference analysis:
 *   Fine Fluting   — image_0, image_1: ~48 ribs, sine, 1.5mm depth, sharp tips
 *   Coarse Pleating— image_2 Moonside: lower-tier solid ribs, flat-top troughs
 *   Nested Columns — stacked horizontal band ribbing variation
 */

const TWO_PI = Math.PI * 2;

// ─── Rib profile shapes ──────────────────────────────────────────────────────
const RIB_PROFILES = {
  sine:     (t) => Math.sin(t * Math.PI) ** 1.0,          // smooth sine wave
  triangle: (t) => 1 - Math.abs(t * 2 - 1),               // triangular tip
  sharp:    (t) => Math.sin(t * Math.PI) ** 0.4,           // sharper tip (reference images)
  pleat:    (t) => Math.abs(Math.sin(t * Math.PI)) ** 0.3, // flat valley, sharp ridge
  square:   (t) => t < 0.1 || t > 0.9 ? 0 : 1,           // slot-cut style
  cosine:   (t) => (1 - Math.cos(t * Math.PI)) / 2,        // smooth cosine
};

/**
 * Apply rib displacement to each point of a square profile.
 * This is the core algorithm — used by all three texture types.
 *
 * @param {object[]} profilePts  - From squareProfile()
 * @param {object}   ribParams   - Rib configuration
 * @returns {object[]}           - Same array with x,z displaced
 */
export function applyRibs(profilePts, ribParams) {
  const {
    ribCount    = 48,     // total ribs around perimeter
    ribDepth    = 1.5,    // mm peak-to-valley amplitude
    ribProfile  = 'sharp',
    wallBonus   = 0,      // extra outward offset at arc/corner points
  } = ribParams;

  const profileFn = RIB_PROFILES[ribProfile] ?? RIB_PROFILES.sharp;
  const totalPts  = profilePts.length;

  return profilePts.map((pt, i) => {
    if (pt.isArc) {
      // Corners: no rib displacement (structural integrity)
      return { ...pt };
    }

    // Position along this face [0, 1]
    const faceT = pt.faceT;

    // Rib phase within one rib period [0, 1]
    // ribsPerFace distributes the total rib count across 4 faces
    const ribsPerFace = ribCount / 4;
    const phase       = (faceT * ribsPerFace) % 1.0;
    const ribOffset   = profileFn(phase) * ribDepth;

    // Inward normal for a square profile = outward from face centre
    // Face 0 (top,  z+): normal is (0, 0, +1) → displace in +z
    // Face 1 (left, x-): normal is (-1, 0, 0) → displace in -x
    // Face 2 (bot,  z-): normal is (0, 0, -1) → displace in -z
    // Face 3 (right,x+): normal is (+1, 0, 0) → displace in +x
    const normals = [
      {  nx: 0,  nz: 1 },
      {  nx:-1,  nz: 0 },
      {  nx: 0,  nz:-1 },
      {  nx: 1,  nz: 0 },
    ];
    const { nx, nz } = normals[pt.faceIndex] ?? { nx: 0, nz: 1 };

    return {
      ...pt,
      x: pt.x + nx * ribOffset,
      z: pt.z + nz * ribOffset,
    };
  });
}

// ─── Algorithm 1: Fine Vertical Fluting ─────────────────────────────────────
// Matches image_0 (white/blue), image_1 (mint/green)
// ~48 sharp sine ribs per perimeter, uniform along full height
export function fineFluting(profilePts, {
  ribCount = 48,
  ribDepth = 1.5,
  ribProfile = 'sharp',
} = {}) {
  return applyRibs(profilePts, { ribCount, ribDepth, ribProfile });
}

// ─── Algorithm 2: Coarse Pleating ───────────────────────────────────────────
// Matches image_2 Moonside pedestal: wider ribs, flat troughs, prominent ridges
export function coarsePleating(profilePts, {
  ribCount = 24,
  ribDepth = 2.5,
  ribProfile = 'pleat',
} = {}) {
  return applyRibs(profilePts, { ribCount, ribDepth, ribProfile });
}

// ─── Algorithm 3: Nested Column Ribbing ─────────────────────────────────────
// Stacked column bands: rib phase shifts by π every columnHeight mm
// Creates the visual effect of nested/alternating column sections
export function nestedColumns(profilePts, {
  ribCount      = 36,
  ribDepth      = 2.0,
  ribProfile    = 'sine',
  columnHeight  = 20,   // mm per column band (not used here — applied via height param)
  phaseShift    = Math.PI, // phase shift between bands
  currentBand   = 0,       // which band (0, 1, 2…)
} = {}) {
  const bandPhase = (currentBand % 2) * phaseShift;
  const totalPts  = profilePts.length;
  const profileFn = RIB_PROFILES[ribProfile] ?? RIB_PROFILES.sine;

  return profilePts.map((pt) => {
    if (pt.isArc) return { ...pt };

    const ribsPerFace = ribCount / 4;
    const raw = pt.faceT * ribsPerFace + bandPhase / TWO_PI;
    const phase = ((raw % 1.0) + 1.0) % 1.0;
    const ribOffset = profileFn(phase) * ribDepth;

    const normals = [
      {  nx: 0,  nz: 1 },
      {  nx:-1,  nz: 0 },
      {  nx: 0,  nz:-1 },
      {  nx: 1,  nz: 0 },
    ];
    const { nx, nz } = normals[pt.faceIndex] ?? { nx: 0, nz: 1 };

    return {
      ...pt,
      x: pt.x + nx * ribOffset,
      z: pt.z + nz * ribOffset,
    };
  });
}

// ─── Custom multi-frequency ─────────────────────────────────────────────────
// Combines two rib frequencies (primary + secondary harmonics)
export function multiFrequency(profilePts, {
  primaryCount  = 40,
  primaryDepth  = 1.5,
  secondaryCount= 80,
  secondaryDepth= 0.4,
  ribProfile    = 'sharp',
} = {}) {
  const profileFn = RIB_PROFILES[ribProfile] ?? RIB_PROFILES.sharp;

  return profilePts.map((pt) => {
    if (pt.isArc) return { ...pt };

    const ribsPerFace1 = primaryCount / 4;
    const ribsPerFace2 = secondaryCount / 4;
    const phase1 = (pt.faceT * ribsPerFace1) % 1.0;
    const phase2 = (pt.faceT * ribsPerFace2) % 1.0;

    const offset = profileFn(phase1) * primaryDepth + profileFn(phase2) * secondaryDepth;

    const normals = [
      {  nx: 0,  nz: 1 },
      {  nx:-1,  nz: 0 },
      {  nx: 0,  nz:-1 },
      {  nx: 1,  nz: 0 },
    ];
    const { nx, nz } = normals[pt.faceIndex] ?? { nx: 0, nz: 1 };

    return {
      ...pt,
      x: pt.x + nx * offset,
      z: pt.z + nz * offset,
    };
  });
}

// ─── Registry: algorithm name → function ────────────────────────────────────
export const RIB_ALGORITHMS = {
  'fine-fluting':    fineFluting,
  'coarse-pleating': coarsePleating,
  'nested-columns':  nestedColumns,
  'multi-frequency': multiFrequency,
};

export const RIB_PROFILE_NAMES = Object.keys(RIB_PROFILES);
export const RIB_ALGORITHM_NAMES = Object.keys(RIB_ALGORITHMS);
