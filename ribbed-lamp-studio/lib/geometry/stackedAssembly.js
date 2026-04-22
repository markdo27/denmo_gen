/**
 * stackedAssembly.js
 * Manages N-tier stacked lamp body definitions (up to 4 tiers).
 * Each tier is an independent body with its own dimensions and texture.
 *
 * Tier 0 = top body (main lamp shade)
 * Tier 1 = first pedestal
 * Tier 2 = second pedestal
 * Tier 3 = base (smallest)
 */

/**
 * Default tier configuration factory.
 * Creates a sensible default for each tier index.
 */
export function defaultTier(index) {
  const configs = [
    // Tier 0: main shade (tallest, widest)
    {
      id:           0,
      enabled:      true,
      label:        'Shade',
      height:       120,
      width:        80,
      depth:        80,
      cornerRadius: 2,
      wallThickness:1.6,
      openTop:      true,
      openBottom:   true,
      texture: {
        algorithm: 'fine-fluting',
        ribCount:  48,
        ribDepth:  1.5,
        ribProfile:'sharp',
      },
    },
    // Tier 1: upper pedestal
    {
      id:           1,
      enabled:      false,
      label:        'Upper Pedestal',
      height:       40,
      width:        64,
      depth:        64,
      cornerRadius: 2,
      wallThickness:2.0,
      openTop:      false,
      openBottom:   true,
      texture: {
        algorithm: 'fine-fluting',
        ribCount:  40,
        ribDepth:  1.5,
        ribProfile:'sharp',
      },
    },
    // Tier 2: lower pedestal
    {
      id:           2,
      enabled:      false,
      label:        'Lower Pedestal',
      height:       30,
      width:        50,
      depth:        50,
      cornerRadius: 2,
      wallThickness:2.0,
      openTop:      false,
      openBottom:   true,
      texture: {
        algorithm: 'coarse-pleating',
        ribCount:  24,
        ribDepth:  2.0,
        ribProfile:'pleat',
      },
    },
    // Tier 3: base (solid, no texture)
    {
      id:           3,
      enabled:      false,
      label:        'Base',
      height:       15,
      width:        40,
      depth:        40,
      cornerRadius: 1,
      wallThickness:3.0, // solid base
      openTop:      false,
      openBottom:   false,
      texture: {
        algorithm: 'fine-fluting',
        ribCount:  20,
        ribDepth:  0.8,
        ribProfile:'sine',
      },
    },
  ];
  return configs[index] ?? configs[0];
}

/**
 * Returns the initial 4-tier assembly state.
 * Only tier 0 is enabled by default.
 */
export function defaultAssembly() {
  return [0, 1, 2, 3].map(defaultTier);
}

/**
 * Calculates the Y (height) offset for each tier.
 * Tiers stack upward from Y=0, with tier 3 at bottom.
 *
 * @param {object[]} tiers  - Tier array from store
 * @param {number}   gap    - Gap between tiers in mm (default 0)
 * @returns {number[]}      - Y offset per tier (index matches tier)
 */
export function getTierOffsets(tiers, gap = 0) {
  const enabled = tiers.filter(t => t.enabled);
  const offsets = new Array(tiers.length).fill(0);

  // Stack enabled tiers from bottom up (highest index = bottom)
  let y = 0;
  // Sort by tier id descending (3 = bottom, 0 = top)
  const sorted = [...tiers]
    .map((t, i) => ({ ...t, origIndex: i }))
    .filter(t => t.enabled)
    .sort((a, b) => b.id - a.id);

  sorted.forEach(tier => {
    offsets[tier.origIndex] = y;
    y += tier.height + gap;
  });

  return offsets;
}

/**
 * Returns the total height of the assembled stack.
 */
export function getTotalHeight(tiers, gap = 0) {
  const enabled = tiers.filter(t => t.enabled);
  return enabled.reduce((sum, t) => sum + t.height, 0)
       + Math.max(0, (enabled.length - 1)) * gap;
}

/**
 * Moonside preset: 2-tier (shade + small pedestal)
 */
export const MOONSIDE_PRESET = [
  {
    ...defaultTier(0),
    enabled: true,
    height: 120, width: 80, depth: 80,
    texture: { algorithm: 'fine-fluting', ribCount: 44, ribDepth: 1.5, ribProfile: 'sharp' },
  },
  {
    ...defaultTier(1),
    enabled: true,
    height: 40, width: 64, depth: 64,
    texture: { algorithm: 'fine-fluting', ribCount: 36, ribDepth: 1.4, ribProfile: 'sharp' },
  },
  { ...defaultTier(2), enabled: false },
  { ...defaultTier(3), enabled: false },
];

/**
 * Classic single-body preset (image_0 / image_1 style)
 */
export const CLASSIC_PRESET = [
  {
    ...defaultTier(0),
    enabled: true,
    height: 110, width: 80, depth: 80,
    texture: { algorithm: 'fine-fluting', ribCount: 48, ribDepth: 1.5, ribProfile: 'sharp' },
  },
  { ...defaultTier(1), enabled: false },
  { ...defaultTier(2), enabled: false },
  { ...defaultTier(3), enabled: false },
];
