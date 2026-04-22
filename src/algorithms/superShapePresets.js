/**
 * SuperShape presets — curated parameter sets extracted from
 * Andrew Marsh's SuperShapes Generator and Paul Bourke's gallery.
 *
 * Each preset is designed to produce visually compelling lamp forms
 * when used as either profile shapes or surface modifiers.
 *
 * Structure:
 *   name     — Display label
 *   type     — 'superformula' | 'spherical-harmonic' | 'super-ellipsoid'
 *   params   — Algorithm-specific parameter object
 *   color    — Accent colour for the preset button
 */

// ═══════════════════════════════════════════════════════════════════════════════
// SUPERFORMULA PROFILE PRESETS
// ═══════════════════════════════════════════════════════════════════════════════
export const SUPERFORMULA_PRESETS = [
  {
    name: 'Circle',
    params: { m: 0, n1: 1, n2: 1, n3: 1, a: 1, b: 1 },
    color: '#888888',
  },
  {
    name: 'Star Vase',
    params: { m: 5, n1: 2, n2: 7, n3: 7, a: 1, b: 1 },
    color: '#ff6200',
  },
  {
    name: 'Modern Vase',
    params: { m: 3, n1: 1, n2: 1, n3: 1, a: 1, b: 1 },
    color: '#00f0ff',
  },
  {
    name: 'Petal Vessel',
    params: { m: 6, n1: 1, n2: 1, n3: 6, a: 1, b: 1 },
    color: '#ff00aa',
  },
  {
    name: 'Soft Square',
    params: { m: 4, n1: 12, n2: 15, n3: 15, a: 1, b: 1 },
    color: '#ffaa00',
  },
  {
    name: 'Gear Form',
    params: { m: 12, n1: 15, n2: 20, n3: 3, a: 1, b: 1 },
    color: '#00ff88',
  },
  {
    name: 'Trefoil',
    params: { m: 3, n1: 5, n2: 18, n3: 18, a: 1, b: 1 },
    color: '#7700ff',
  },
  {
    name: 'Rounded Triangle',
    params: { m: 3, n1: 4.5, n2: 10, n3: 10, a: 1, b: 1 },
    color: '#ff3366',
  },
  {
    name: 'Butterfly Wings',
    params: { m: 2, n1: 1, n2: 4, n3: 8, a: 1, b: 1 },
    color: '#33ccff',
  },
  {
    name: 'Pinch Star',
    params: { m: 7, n1: 0.5, n2: 0.5, n3: 0.5, a: 1, b: 1 },
    color: '#ff9900',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// SUPERFORMULA MODIFIER PRESETS  (for the surface modulation layer)
// ═══════════════════════════════════════════════════════════════════════════════
export const SUPERFORMULA_MODIFIER_PRESETS = [
  {
    name: 'Subtle Ribs',
    params: { m: 8, n1: 2, n2: 2, n3: 2 },
    color: '#aaaaaa',
  },
  {
    name: 'Deep Flutes',
    params: { m: 6, n1: 1, n2: 1, n3: 1 },
    color: '#ff6200',
  },
  {
    name: 'Gear Teeth',
    params: { m: 16, n1: 100, n2: 100, n3: 100 },
    color: '#00ff88',
  },
  {
    name: 'Soft Waves',
    params: { m: 4, n1: 0.5, n2: 0.5, n3: 0.5 },
    color: '#00f0ff',
  },
  {
    name: 'Sharp Petals',
    params: { m: 5, n1: 0.3, n2: 0.3, n3: 0.3 },
    color: '#ff00aa',
  },
  {
    name: 'Angular Fins',
    params: { m: 8, n1: 60, n2: 100, n3: 30 },
    color: '#ffaa00',
  },
  {
    name: 'Organic Lobes',
    params: { m: 3, n1: 0.2, n2: 1, n3: 1 },
    color: '#7700ff',
  },
  {
    name: 'Micro Texture',
    params: { m: 24, n1: 3, n2: 3, n3: 3 },
    color: '#33ccff',
  },
  {
    name: 'Scallop Shell',
    params: { m: 10, n1: 1, n2: 4, n3: 8 },
    color: '#ff3366',
  },
  {
    name: 'Crystal Facets',
    params: { m: 6, n1: 80, n2: 100, n3: 100 },
    color: '#88ff00',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// SPHERICAL HARMONICS PRESETS  (m0–m7, integers 0–7)
// ═══════════════════════════════════════════════════════════════════════════════
export const HARMONIC_PRESETS = [
  {
    name: 'Sphere',
    params: [0, 0, 0, 0, 0, 0, 0, 0],
    color: '#888888',
  },
  {
    name: 'Dumbbell',
    params: [2, 2, 0, 0, 0, 0, 0, 0],
    color: '#ff6200',
  },
  {
    name: 'DoughBoy',
    params: [6, 2, 4, 4, 6, 2, 4, 4],
    color: '#ff00aa',
  },
  {
    name: 'Giant Boots',
    params: [4, 4, 3, 1, 2, 3, 4, 5],
    color: '#00ff88',
  },
  {
    name: 'Goblet',
    params: [1, 2, 6, 3, 3, 4, 1, 2],
    color: '#ffaa00',
  },
  {
    name: 'Butterfly',
    params: [3, 2, 5, 5, 2, 2, 2, 2],
    color: '#7700ff',
  },
  {
    name: 'Cockel Shell',
    params: [4, 2, 3, 3, 6, 6, 2, 2],
    color: '#00f0ff',
  },
  {
    name: 'Snail Shell',
    params: [5, 3, 4, 2, 7, 7, 5, 4],
    color: '#ff3366',
  },
  {
    name: 'Rams Horn',
    params: [3, 3, 6, 6, 3, 3, 4, 2],
    color: '#33ccff',
  },
  {
    name: 'Flower Bloom',
    params: [3, 1, 3, 1, 3, 1, 3, 1],
    color: '#ff9900',
  },
  {
    name: 'Rounded Cube',
    params: [0, 0, 0, 0, 4, 2, 4, 2],
    color: '#aaaaaa',
  },
  {
    name: 'Coral Form',
    params: [7, 2, 5, 3, 3, 2, 7, 4],
    color: '#88ff00',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// HARMONIC MODIFIER PRESETS (for the surface modulation layer)
// ═══════════════════════════════════════════════════════════════════════════════
export const HARMONIC_MODIFIER_PRESETS = [
  {
    name: 'Gentle Wave',
    params: [2, 1, 2, 1, 2, 1, 2, 1],
    color: '#888888',
  },
  {
    name: 'Coral Texture',
    params: [5, 2, 3, 2, 5, 2, 3, 2],
    color: '#ff6200',
  },
  {
    name: 'Organic Bumps',
    params: [3, 3, 4, 4, 3, 3, 4, 4],
    color: '#ff00aa',
  },
  {
    name: 'Faceted',
    params: [4, 6, 4, 6, 4, 6, 4, 6],
    color: '#00f0ff',
  },
  {
    name: 'Alien Skin',
    params: [7, 2, 7, 2, 7, 2, 7, 2],
    color: '#00ff88',
  },
  {
    name: 'Barnacle',
    params: [6, 3, 5, 3, 6, 3, 5, 3],
    color: '#ffaa00',
  },
  {
    name: 'Lava Flow',
    params: [2, 4, 3, 5, 2, 4, 3, 5],
    color: '#7700ff',
  },
  {
    name: 'Sea Urchin',
    params: [7, 1, 7, 1, 7, 1, 7, 1],
    color: '#ff3366',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// SUPER ELLIPSOID PRESETS
// ═══════════════════════════════════════════════════════════════════════════════
export const SUPER_ELLIPSOID_PRESETS = [
  {
    name: 'Sphere',
    params: { n: 1.0, e: 1.0 },
    color: '#888888',
  },
  {
    name: 'Rounded Cube',
    params: { n: 0.3, e: 0.3 },
    color: '#ff6200',
  },
  {
    name: 'Pillow',
    params: { n: 0.5, e: 0.5 },
    color: '#00f0ff',
  },
  {
    name: 'Diamond',
    params: { n: 2.0, e: 2.0 },
    color: '#ff00aa',
  },
  {
    name: 'Cylinder',
    params: { n: 0.1, e: 1.0 },
    color: '#ffaa00',
  },
  {
    name: 'Lens',
    params: { n: 2.0, e: 0.3 },
    color: '#00ff88',
  },
  {
    name: 'Barrel',
    params: { n: 0.6, e: 1.5 },
    color: '#7700ff',
  },
  {
    name: 'Pinched Cube',
    params: { n: 0.2, e: 2.5 },
    color: '#ff3366',
  },
  {
    name: 'Mushroom Cap',
    params: { n: 1.5, e: 0.6 },
    color: '#33ccff',
  },
  {
    name: 'Astroid',
    params: { n: 0.4, e: 0.4 },
    color: '#ff9900',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// ALL PRESETS — unified lookup
// ═══════════════════════════════════════════════════════════════════════════════
export const ALL_PROFILE_PRESETS = {
  superformula: SUPERFORMULA_PRESETS,
  'spherical-harmonic': HARMONIC_PRESETS,
  'super-ellipsoid': SUPER_ELLIPSOID_PRESETS,
};

export const ALL_MODIFIER_PRESETS = {
  superformula: SUPERFORMULA_MODIFIER_PRESETS,
  'spherical-harmonic': HARMONIC_MODIFIER_PRESETS,
};
