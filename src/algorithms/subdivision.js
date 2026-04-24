/**
 * subdivision.js — Loop Subdivision Surface
 *
 * Implements the Loop subdivision scheme for triangle meshes.
 * Each subdivision iteration:
 *   1. Creates a new "edge vertex" for every edge  (weighted average of neighbours)
 *   2. Updates every original "vertex" position     (weighted average of its ring)
 *   3. Reconnects: each triangle [a,b,c] → 4 triangles
 *
 * Works on raw typed arrays (Float32Array positions, Uint32Array indices)
 * so it can run in the main thread or inside a Web Worker.
 *
 * No Three.js dependency — pure math.
 */

// ─── Edge key helper ────────────────────────────────────────────────────────
// Canonical key for an undirected edge so (a,b) and (b,a) hash the same.
function edgeKey(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

// ─── Single Loop subdivision pass ───────────────────────────────────────────
function subdivideOnce(positions, indices) {
  const vertCount = positions.length / 3;
  const triCount  = indices.length / 3;

  // ── Build adjacency ─────────────────────────────────────────────────────
  // edgeMap: edgeKey → { v0, v1, faces: [faceIdx, …], edgeVertIdx }
  const edgeMap  = new Map();
  // vertEdges: vertIdx → Set of edgeKeys (for neighbour lookup)
  const vertEdges = new Array(vertCount);
  for (let i = 0; i < vertCount; i++) vertEdges[i] = new Set();

  for (let f = 0; f < triCount; f++) {
    const i0 = indices[f * 3];
    const i1 = indices[f * 3 + 1];
    const i2 = indices[f * 3 + 2];

    const edges = [[i0, i1], [i1, i2], [i2, i0]];
    for (const [a, b] of edges) {
      const key = edgeKey(a, b);
      if (!edgeMap.has(key)) {
        edgeMap.set(key, { v0: a, v1: b, faces: [], edgeVertIdx: -1 });
      }
      edgeMap.get(key).faces.push(f);
      vertEdges[a].add(key);
      vertEdges[b].add(key);
    }
  }

  // ── Allocate new positions array ────────────────────────────────────────
  // newPositions = [updated originals (vertCount)] + [edge points (edgeMap.size)]
  const newVertCount = vertCount + edgeMap.size;
  const newPositions = new Float32Array(newVertCount * 3);

  // Assign edge vertex indices
  let nextIdx = vertCount;
  for (const edge of edgeMap.values()) {
    edge.edgeVertIdx = nextIdx++;
  }

  // ── Compute edge points ─────────────────────────────────────────────────
  for (const edge of edgeMap.values()) {
    const { v0, v1, faces, edgeVertIdx } = edge;
    const idx = edgeVertIdx * 3;

    if (faces.length === 2) {
      // Interior edge: 3/8 * (v0 + v1) + 1/8 * (opp0 + opp1)
      // Find the two opposite vertices
      const opps = [];
      for (const fi of faces) {
        const a = indices[fi * 3], b = indices[fi * 3 + 1], c = indices[fi * 3 + 2];
        if (a !== v0 && a !== v1) opps.push(a);
        else if (b !== v0 && b !== v1) opps.push(b);
        else opps.push(c);
      }
      for (let d = 0; d < 3; d++) {
        newPositions[idx + d] =
          (3.0 / 8.0) * (positions[v0 * 3 + d] + positions[v1 * 3 + d]) +
          (1.0 / 8.0) * (positions[opps[0] * 3 + d] + positions[opps[1] * 3 + d]);
      }
    } else {
      // Boundary edge: simple midpoint
      for (let d = 0; d < 3; d++) {
        newPositions[idx + d] = 0.5 * (positions[v0 * 3 + d] + positions[v1 * 3 + d]);
      }
    }
  }

  // ── Update original vertex positions ────────────────────────────────────
  for (let vi = 0; vi < vertCount; vi++) {
    const neighbourKeys = vertEdges[vi];
    const neighbours = new Set();
    let isBoundary = false;

    for (const key of neighbourKeys) {
      const edge = edgeMap.get(key);
      const other = edge.v0 === vi ? edge.v1 : edge.v0;
      neighbours.add(other);
      if (edge.faces.length === 1) isBoundary = true;
    }

    const n = neighbours.size;
    const idx = vi * 3;

    if (isBoundary) {
      // Boundary vertex: 3/4 * self + 1/8 * each boundary neighbour
      // Find boundary neighbours (those sharing a boundary edge)
      const bNeighbours = [];
      for (const key of neighbourKeys) {
        const edge = edgeMap.get(key);
        if (edge.faces.length === 1) {
          bNeighbours.push(edge.v0 === vi ? edge.v1 : edge.v0);
        }
      }
      for (let d = 0; d < 3; d++) {
        let sum = 0;
        for (const bn of bNeighbours) sum += positions[bn * 3 + d];
        newPositions[idx + d] = 0.75 * positions[idx + d] + 0.125 * sum;
      }
    } else {
      // Interior vertex: Loop's beta weighting
      // beta = 1/n * (5/8 - (3/8 + 1/4 * cos(2π/n))²)
      const beta = (n > 3)
        ? (1.0 / n) * (5.0 / 8.0 - Math.pow(3.0 / 8.0 + 0.25 * Math.cos(2.0 * Math.PI / n), 2))
        : 3.0 / 16.0;   // Warren's weight for valence 3

      const weight = 1.0 - n * beta;
      for (let d = 0; d < 3; d++) {
        let neighbourSum = 0;
        for (const ni of neighbours) neighbourSum += positions[ni * 3 + d];
        newPositions[idx + d] = weight * positions[idx + d] + beta * neighbourSum;
      }
    }
  }

  // ── Reconnect triangles ─────────────────────────────────────────────────
  // Each original triangle [a, b, c] becomes 4 triangles:
  //   [a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]
  const newIndices = new Uint32Array(triCount * 4 * 3);
  let ti = 0;

  for (let f = 0; f < triCount; f++) {
    const a = indices[f * 3];
    const b = indices[f * 3 + 1];
    const c = indices[f * 3 + 2];

    const ab = edgeMap.get(edgeKey(a, b)).edgeVertIdx;
    const bc = edgeMap.get(edgeKey(b, c)).edgeVertIdx;
    const ca = edgeMap.get(edgeKey(c, a)).edgeVertIdx;

    // Triangle 1: a, ab, ca
    newIndices[ti++] = a;  newIndices[ti++] = ab; newIndices[ti++] = ca;
    // Triangle 2: b, bc, ab
    newIndices[ti++] = b;  newIndices[ti++] = bc; newIndices[ti++] = ab;
    // Triangle 3: c, ca, bc
    newIndices[ti++] = c;  newIndices[ti++] = ca; newIndices[ti++] = bc;
    // Triangle 4: ab, bc, ca  (centre triangle)
    newIndices[ti++] = ab; newIndices[ti++] = bc; newIndices[ti++] = ca;
  }

  return { positions: newPositions, indices: newIndices };
}

// ─── Public API ─────────────────────────────────────────────────────────────
/**
 * Apply Loop subdivision to a triangle mesh.
 *
 * @param {Float32Array} positions  — flat xyz array (length = vertCount × 3)
 * @param {Uint32Array}  indices    — flat triangle indices (length = triCount × 3)
 * @param {number}       iterations — number of subdivision passes (1–3 recommended)
 * @returns {{ positions: Float32Array, indices: Uint32Array }}
 */
export function loopSubdivide(positions, indices, iterations = 1) {
  let pos = positions;
  let idx = indices;

  for (let i = 0; i < iterations; i++) {
    const result = subdivideOnce(pos, idx);
    pos = result.positions;
    idx = result.indices;
  }

  return { positions: pos, indices: idx };
}
