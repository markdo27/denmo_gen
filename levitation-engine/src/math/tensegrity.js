import { degToRad } from '../utils/formatters';

/**
 * Compute the shared geometric constraint for a tensegrity structure.
 *
 * By the law of cosines, the squared horizontal distance between a bottom
 * node at angle 0 and the connected top node at angle θ is:
 *
 *   d²_XZ = R₁² − 2·R₁·R₂·cos(θ) + R₂²
 *
 * The strut height follows from the Pythagorean theorem:
 *
 *   H² = L² − d²_XZ
 *   H  = √(L² − R₁² + 2·R₁·R₂·cos(θ) − R₂²)   [valid iff H² > 0]
 *
 * This function is the single source of truth for this computation —
 * both validation and geometry generation call it, eliminating duplication.
 *
 * @param {number} baseRadius  - R₁ [m]
 * @param {number} topRadius   - R₂ [m]
 * @param {number} twistAngle  - θ  [degrees]
 * @param {number} strutLength - L  [m]
 * @returns {{ horizontalDistSq: number, heightSq: number, height: number|null }}
 */
export function computeTensegrityHeight({ baseRadius, topRadius, twistAngle, strutLength }) {
  const theta          = degToRad(twistAngle);
  const R1             = baseRadius;
  const R2             = topRadius;
  const L              = strutLength;

  // Law of cosines — avoids separate dx, dz variables
  const horizontalDistSq = R1 * R1 - 2 * R1 * R2 * Math.cos(theta) + R2 * R2;
  const heightSq         = L * L - horizontalDistSq;

  return {
    horizontalDistSq,
    heightSq,
    height: heightSq > 0 ? Math.sqrt(heightSq) : null,
  };
}

/**
 * Compute all node positions, strut connections, and cable connections
 * for a tensegrity structure given the parametric inputs.
 *
 * Geometry:
 *   Bottom ring: N nodes at radius R₁, y = 0, angles iΔφ,  i ∈ {0,…,N−1}
 *   Top ring:    N nodes at radius R₂, y = H, angles iΔφ+θ
 *   where Δφ = 2π/N  and  H = √(L² − d²_XZ)
 *
 * Connections:
 *   Struts:       bottom[i]  → top[i]            (compression)
 *   Top cables:   top[i]     → top[(i+1) mod N]  (tension ring)
 *   Bottom cables:bottom[i]  → bottom[(i+1)mod N](tension ring)
 *   Cross cables: bottom[i]  → top[(i+1) mod N]  (diagonal tension)
 *
 * @param {{ baseRadius, topRadius, twistAngle, strutCount, strutLength }} params
 * @returns {{ bottomNodes, topNodes, struts, topCables, bottomCables, crossCables, height }}
 */
export function computeTensegrity({ baseRadius, topRadius, twistAngle, strutCount, strutLength }) {
  const N           = strutCount;
  const R1          = baseRadius;
  const R2          = topRadius;
  const theta       = degToRad(twistAngle);
  const sectorAngle = (2 * Math.PI) / N;

  // Reuse the single height computation — validation already called this;
  // clamp to ε to avoid NaN propagation into the renderer.
  const { height: computedHeight } = computeTensegrityHeight({ baseRadius, topRadius, twistAngle, strutLength });
  const height = computedHeight ?? 0.01;

  // ── Bottom nodes on XZ plane at y=0 ──────────────────────────────────────
  const bottomNodes = Array.from({ length: N }, (_, i) => {
    const angle = sectorAngle * i;
    return [R1 * Math.cos(angle), 0, R1 * Math.sin(angle)];
  });

  // ── Top nodes at y=height, rotated by twist angle ─────────────────────────
  const topNodes = Array.from({ length: N }, (_, i) => {
    const angle = sectorAngle * i + theta;
    return [R2 * Math.cos(angle), height, R2 * Math.sin(angle)];
  });

  // ── Connections (all O(N), no redundant iteration) ────────────────────────
  const struts       = Array.from({ length: N }, (_, i) => ({ start: bottomNodes[i], end: topNodes[i] }));
  const topCables    = Array.from({ length: N }, (_, i) => ({ start: topNodes[i],    end: topNodes[(i + 1) % N] }));
  const bottomCables = Array.from({ length: N }, (_, i) => ({ start: bottomNodes[i], end: bottomNodes[(i + 1) % N] }));
  const crossCables  = Array.from({ length: N }, (_, i) => ({ start: bottomNodes[i], end: topNodes[(i + 1) % N] }));

  return { bottomNodes, topNodes, struts, topCables, bottomCables, crossCables, height };
}
