import { degToRad } from '../utils/formatters';

/**
 * Compute all node positions, strut connections, and cable connections
 * for a tensegrity structure given the parametric inputs.
 *
 * Returns:
 *   { bottomNodes, topNodes, struts, topCables, bottomCables, crossCables, height }
 *
 * Each node is a [x, y, z] array.
 * Each strut/cable is { start: [x,y,z], end: [x,y,z] }.
 */
export function computeTensegrity({ baseRadius, topRadius, twistAngle, strutCount, strutLength }) {
  const N = strutCount;
  const R1 = baseRadius;
  const R2 = topRadius;
  const theta = degToRad(twistAngle);
  const sectorAngle = (2 * Math.PI) / N;

  // ── Bottom nodes on XZ plane at y=0 ──
  const bottomNodes = [];
  for (let i = 0; i < N; i++) {
    const angle = sectorAngle * i;
    bottomNodes.push([
      R1 * Math.cos(angle),
      0,
      R1 * Math.sin(angle),
    ]);
  }

  // ── Compute height from strut length constraint ──
  const dx = R1 - R2 * Math.cos(theta);
  const dz = -R2 * Math.sin(theta);
  const horizontalDistSq = dx * dx + dz * dz;
  const heightSq = strutLength * strutLength - horizontalDistSq;

  // Clamp to avoid NaN — validation should catch this before we get here
  const height = heightSq > 0 ? Math.sqrt(heightSq) : 0.01;

  // ── Top nodes at y=height, rotated by twist angle ──
  const topNodes = [];
  for (let i = 0; i < N; i++) {
    const angle = sectorAngle * i + theta;
    topNodes.push([
      R2 * Math.cos(angle),
      height,
      R2 * Math.sin(angle),
    ]);
  }

  // ── Struts: connect bottom[i] → top[i] (compression members) ──
  const struts = [];
  for (let i = 0; i < N; i++) {
    struts.push({ start: bottomNodes[i], end: topNodes[i] });
  }

  // ── Top cables: connect top[i] → top[(i+1) % N] ──
  const topCables = [];
  for (let i = 0; i < N; i++) {
    topCables.push({ start: topNodes[i], end: topNodes[(i + 1) % N] });
  }

  // ── Bottom cables: connect bottom[i] → bottom[(i+1) % N] ──
  const bottomCables = [];
  for (let i = 0; i < N; i++) {
    bottomCables.push({ start: bottomNodes[i], end: bottomNodes[(i + 1) % N] });
  }

  // ── Cross cables: connect bottom[i] → top[(i+1) % N] (tension members) ──
  const crossCables = [];
  for (let i = 0; i < N; i++) {
    crossCables.push({ start: bottomNodes[i], end: topNodes[(i + 1) % N] });
  }

  return {
    bottomNodes,
    topNodes,
    struts,
    topCables,
    bottomCables,
    crossCables,
    height,
  };
}
