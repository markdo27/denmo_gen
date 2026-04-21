/**
 * retopologyWorker.js
 *
 * Web Worker — mesh retopology pipeline for ĐÈNMỜ STL export.
 *
 * Receives:
 *   {
 *     positions: Float32Array,   // raw vertex positions (x,y,z interleaved)
 *     indices:   Uint32Array,    // triangle index buffer
 *     quality:   'DRAFT' | 'BALANCED' | 'FINE' | 'OFF'
 *   }
 *
 * Posts back:
 *   {
 *     positions: Float32Array,   // cleaned vertex positions
 *     indices:   Uint32Array,    // cleaned index buffer
 *     report: {
 *       originalTriangles: number,
 *       finalTriangles:    number,
 *       seamFixed:         boolean,
 *       manifoldOK:        boolean,
 *     }
 *   }
 *
 * Pipeline:
 *   1. Vertex Weld    — merge duplicate vertices (fixes LatheGeometry seam)
 *   2. QEM Decimation — Quadric Error Metric simplification
 *   3. Manifold Check — detect & report non-manifold edges
 *   4. Normal Recompute — smooth (area-weighted) per-vertex normals
 */

self.onmessage = (e) => {
  const { positions, indices, quality } = e.data;

  const originalTriangles = indices.length / 3;

  // ── Step 1: Vertex weld ─────────────────────────────────────────────────
  const { positions: weldedPos, indices: weldedIdx, seamFixed } =
    weldVertices(new Float32Array(positions), new Uint32Array(indices));

  // ── Step 2: QEM decimation ──────────────────────────────────────────────
  let finalPos  = weldedPos;
  let finalIdx  = weldedIdx;

  if (quality !== 'OFF') {
    const targetRatio = quality === 'DRAFT'    ? 0.25
                      : quality === 'BALANCED' ? 0.50
                      : /* FINE */               0.80;

    const result = decimateQEM(weldedPos, weldedIdx, targetRatio);
    finalPos = result.positions;
    finalIdx = result.indices;
  }

  // ── Step 3: Manifold check ──────────────────────────────────────────────
  const nonManifold = detectNonManifoldEdges(finalIdx);
  const manifoldOK  = nonManifold.length === 0;

  // ── Step 4: Normal recompute ────────────────────────────────────────────
  const normals = computeSmoothNormals(finalPos, finalIdx);

  const report = {
    originalTriangles,
    finalTriangles: finalIdx.length / 3,
    seamFixed,
    manifoldOK,
  };

  // Transfer large buffers to avoid structured clone overhead
  self.postMessage(
    { positions: finalPos, indices: finalIdx, normals, report },
    [finalPos.buffer, finalIdx.buffer, normals.buffer]
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Vertex Weld
// ─────────────────────────────────────────────────────────────────────────────
function weldVertices(positions, indices, epsilon = 0.0001) {
  const map         = new Map();
  const remapTable  = new Uint32Array(positions.length / 3);
  const cleanPos    = [];
  let seamFixed     = false;

  for (let i = 0; i < positions.length / 3; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];

    const gx = Math.round(x / epsilon);
    const gy = Math.round(y / epsilon);
    const gz = Math.round(z / epsilon);
    const key = `${gx},${gy},${gz}`;

    if (!map.has(key)) {
      map.set(key, cleanPos.length / 3);
      cleanPos.push(x, y, z);
    } else {
      seamFixed = true;   // at least one duplicate found → seam was present
    }
    remapTable[i] = map.get(key);
  }

  // Remap indices and strip degenerate triangles
  const validIdx = [];
  for (let i = 0; i < indices.length; i += 3) {
    const a = remapTable[indices[i]];
    const b = remapTable[indices[i + 1]];
    const c = remapTable[indices[i + 2]];
    if (a !== b && b !== c && a !== c) {
      validIdx.push(a, b, c);
    }
  }

  return {
    positions: new Float32Array(cleanPos),
    indices:   new Uint32Array(validIdx),
    seamFixed,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — QEM (Quadric Error Metric) Decimation
// Based on Garland & Heckbert 1997, browser-optimised lightweight version.
// ─────────────────────────────────────────────────────────────────────────────
function decimateQEM(positions, indices, targetRatio) {
  const vCount = positions.length / 3;
  const fCount = indices.length / 3;
  const targetFaces = Math.max(4, Math.floor(fCount * targetRatio));

  // ── Build per-vertex quadric matrices (symmetric 4×4 as 10 floats) ──────
  // Q = sum of (plane equation outer products) for all faces incident to vertex
  const Q = new Float64Array(vCount * 10);   // 10 unique elements of 4×4 symmetric

  // Helper: compute face plane equation [a,b,c,d] where ax+by+cz+d=0
  function facePlane(ia, ib, ic) {
    const ax = positions[ia*3], ay = positions[ia*3+1], az = positions[ia*3+2];
    const bx = positions[ib*3], by = positions[ib*3+1], bz = positions[ib*3+2];
    const cx = positions[ic*3], cy = positions[ic*3+1], cz = positions[ic*3+2];

    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

    const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
    if (len < 1e-12) return null;
    const inv = 1 / len;
    const a = nx * inv, b = ny * inv, c = nz * inv;
    const d = -(a * ax + b * ay + c * az);
    return [a, b, c, d];
  }

  // Accumulate quadrics per vertex
  for (let fi = 0; fi < fCount; fi++) {
    const ia = indices[fi*3], ib = indices[fi*3+1], ic = indices[fi*3+2];
    const p = facePlane(ia, ib, ic);
    if (!p) continue;
    const [a, b, c, d] = p;

    // Kp = outer product of plane [a,b,c,d]^T, stored as upper triangle
    const kp = [a*a, a*b, a*c, a*d,
                      b*b, b*c, b*d,
                            c*c, c*d,
                                  d*d];

    for (const vi of [ia, ib, ic]) {
      for (let k = 0; k < 10; k++) Q[vi * 10 + k] += kp[k];
    }
  }

  // ── Build edge collapse candidates ────────────────────────────────────────
  // Build unique edge list
  const edgeSet  = new Map();   // "min,max" → true

  for (let fi = 0; fi < fCount; fi++) {
    const verts = [indices[fi*3], indices[fi*3+1], indices[fi*3+2]];
    for (let k = 0; k < 3; k++) {
      const a = verts[k], b = verts[(k+1) % 3];
      const key = `${Math.min(a,b)},${Math.max(a,b)}`;
      edgeSet.set(key, [Math.min(a,b), Math.max(a,b)]);
    }
  }

  // Compute collapse cost for each edge
  // Cost = v̄^T (Qa + Qb) v̄  where v̄ = optimal collapse position (midpoint fallback)
  function collapseError(va, vb) {
    // Merge quadric
    const qm = new Float64Array(10);
    for (let k = 0; k < 10; k++) qm[k] = Q[va * 10 + k] + Q[vb * 10 + k];

    // Optimal position = midpoint (simplified; full QEM uses matrix inversion)
    const mx = (positions[va*3]   + positions[vb*3])   * 0.5;
    const my = (positions[va*3+1] + positions[vb*3+1]) * 0.5;
    const mz = (positions[va*3+2] + positions[vb*3+2]) * 0.5;

    // Error = v^T Q v  (homogeneous)
    const err =
      qm[0]*mx*mx + 2*qm[1]*mx*my + 2*qm[2]*mx*mz + 2*qm[3]*mx
                  +   qm[4]*my*my + 2*qm[5]*my*mz + 2*qm[6]*my
                                  +   qm[7]*mz*mz + 2*qm[8]*mz
                                                  +   qm[9];
    return { err: Math.max(0, err), mx, my, mz };
  }

  // Min-heap: [cost, va, vb, ox, oy, oz]
  const heap  = [];

  for (const [va, vb] of edgeSet.values()) {
    const { err, mx, my, mz } = collapseError(va, vb);
    heap.push([err, va, vb, mx, my, mz]);
  }
  heap.sort((a, b) => a[0] - b[0]);   // sort ascending by cost

  // Vertex validity & merge map
  const valid    = new Uint8Array(vCount).fill(1);
  const mergedTo = new Int32Array(vCount).fill(-1);   // -1 = self

  function canonical(v) {
    let c = v;
    while (mergedTo[c] !== -1) c = mergedTo[c];
    return c;
  }

  // ── Greedy collapse loop ───────────────────────────────────────────────
  let collapsed  = 0;
  const toRemove = fCount - targetFaces;

  // We process cheapest edges first; estimate ~2 faces removed per collapse
  const maxCollapses = Math.ceil(toRemove / 2);
  let hi = 0;

  // Flatten positions into a mutable array for mid-point updates
  const pos = Array.from(positions);

  while (collapsed < maxCollapses && hi < heap.length) {
    const [, va0, vb0, mx, my, mz] = heap[hi++];

    const va = canonical(va0);
    const vb = canonical(vb0);

    if (va === vb) continue;
    if (!valid[va] || !valid[vb]) continue;

    // Collapse vb into va  (move va to optimal position)
    pos[va*3]   = mx;
    pos[va*3+1] = my;
    pos[va*3+2] = mz;

    // Merge quadric
    for (let k = 0; k < 10; k++) Q[va * 10 + k] += Q[vb * 10 + k];

    mergedTo[vb] = va;
    valid[vb]    = 0;
    collapsed++;
  }

  // ── Rebuild index buffer using canonical vertices ─────────────────────
  const finalIdx = [];
  for (let fi = 0; fi < fCount; fi++) {
    const a = canonical(indices[fi*3]);
    const b = canonical(indices[fi*3+1]);
    const c = canonical(indices[fi*3+2]);
    if (a !== b && b !== c && a !== c) {
      finalIdx.push(a, b, c);
    }
  }

  // ── Compact: re-index to remove dead vertices ─────────────────────────
  const newIndex   = new Int32Array(vCount).fill(-1);
  const finalPos   = [];
  let   nextIdx    = 0;

  for (let fi = 0; fi < finalIdx.length; fi++) {
    const v = finalIdx[fi];
    if (newIndex[v] === -1) {
      newIndex[v] = nextIdx++;
      finalPos.push(pos[v*3], pos[v*3+1], pos[v*3+2]);
    }
    finalIdx[fi] = newIndex[v];
  }

  return {
    positions: new Float32Array(finalPos),
    indices:   new Uint32Array(finalIdx),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — Manifold Check
// ─────────────────────────────────────────────────────────────────────────────
function detectNonManifoldEdges(indices) {
  const edgeCount = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    const verts = [indices[i], indices[i+1], indices[i+2]];
    for (let k = 0; k < 3; k++) {
      const a = verts[k], b = verts[(k+1) % 3];
      const key = `${Math.min(a,b)},${Math.max(a,b)}`;
      edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
    }
  }
  // Non-manifold = edges shared by ≠ 2 triangles
  return [...edgeCount.entries()].filter(([, v]) => v !== 2).map(([k]) => k);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — Smooth Normal Recomputation (area-weighted)
// ─────────────────────────────────────────────────────────────────────────────
function computeSmoothNormals(positions, indices) {
  const vCount  = positions.length / 3;
  const normals = new Float32Array(vCount * 3);

  for (let fi = 0; fi < indices.length; fi += 3) {
    const ia = indices[fi], ib = indices[fi+1], ic = indices[fi+2];

    const ax = positions[ia*3],   ay = positions[ia*3+1], az = positions[ia*3+2];
    const bx = positions[ib*3],   by = positions[ib*3+1], bz = positions[ib*3+2];
    const cx = positions[ic*3],   cy = positions[ic*3+1], cz = positions[ic*3+2];

    // Cross product (area-weighted)
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

    for (const vi of [ia, ib, ic]) {
      normals[vi*3]   += nx;
      normals[vi*3+1] += ny;
      normals[vi*3+2] += nz;
    }
  }

  // Normalize
  for (let vi = 0; vi < vCount; vi++) {
    const nx = normals[vi*3], ny = normals[vi*3+1], nz = normals[vi*3+2];
    const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
    if (len > 1e-12) {
      normals[vi*3]   /= len;
      normals[vi*3+1] /= len;
      normals[vi*3+2] /= len;
    }
  }

  return normals;
}
