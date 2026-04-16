/**
 * Euclidean Voronoi distance-field generator.
 *
 * Scatters `numSeeds` points in normalised [0,1)² space using a seeded
 * pseudo-random generator (LCG). For each grid cell the distance to the
 * nearest seed is computed with toroidal wrapping on the U axis (angle),
 * so that the pattern tiles cleanly around the lamp's circumference.
 *
 * Returns a Float32Array of size resolution² normalised to [0, 1].
 * High values = far from any seed (ridge lines); low values = near a seed.
 */

export const VOI_RES = 256;

export function computeVoronoi({ resolution = VOI_RES, numSeeds = 20, seed = 42 } = {}) {
  // Seeded LCG – deterministic from the same integer seed
  let s = (seed | 0) >>> 0;
  const rand = () => {
    s = Math.imul(s, 1664525) + 1013904223 >>> 0;
    return s / 0xffffffff;
  };

  // Generate seed positions in UV space
  const seeds = new Float32Array(numSeeds * 2);
  for (let i = 0; i < numSeeds * 2; i++) seeds[i] = rand();

  const size = resolution * resolution;
  const map  = new Float32Array(size);
  let maxDist = 0;

  for (let v = 0; v < resolution; v++) {
    const pv = v / resolution;
    for (let u = 0; u < resolution; u++) {
      const pu = u / resolution;
      let minDist = Infinity;

      for (let k = 0; k < numSeeds; k++) {
        const su = seeds[k * 2];
        const sv = seeds[k * 2 + 1];

        // Toroidal distance in U (angle wraps), clamped in V (height)
        let du = Math.abs(pu - su);
        if (du > 0.5) du = 1.0 - du;   // wrap
        const dv = pv - sv;

        const dist = Math.sqrt(du * du + dv * dv);
        if (dist < minDist) minDist = dist;
      }

      map[v * resolution + u] = minDist;
      if (minDist > maxDist) maxDist = minDist;
    }
  }

  // Normalise
  if (maxDist > 0) {
    const invMax = 1.0 / maxDist;
    for (let i = 0; i < size; i++) map[i] *= invMax;
  }

  return map;
}
