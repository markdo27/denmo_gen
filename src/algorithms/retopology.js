/**
 * retopology.js — Voxel-based remeshing via Marching Cubes
 * 
 * Takes any BufferGeometry (often messy AI-gen or boolean-result meshes)
 * and produces a clean, uniform-triangle mesh by:
 *   1. Voxelising the mesh into a signed-distance-like occupancy grid
 *   2. Running Marching Cubes to extract an isosurface
 *   3. Returning a clean THREE.BufferGeometry
 *
 * This is a pure JS implementation — no WASM or external deps needed.
 */

import * as THREE from 'three';

// ─── Marching Cubes Edge / Tri Tables ───────────────────────────────────────
// Compressed lookup tables for the 256 cube configurations.
// edgeTable[i] = bitmask of which edges are intersected
// triTable[i]  = list of edge-index triples forming triangles (-1 = end)

const edgeTable = [
  0x0,0x109,0x203,0x30a,0x406,0x50f,0x605,0x70c,0x80c,0x905,0xa0f,0xb06,0xc0a,0xd03,0xe09,0xf00,
  0x190,0x99,0x393,0x29a,0x596,0x49f,0x795,0x69c,0x99c,0x895,0xb9f,0xa96,0xd9a,0xc93,0xf99,0xe90,
  0x230,0x339,0x33,0x13a,0x636,0x73f,0x435,0x53c,0xa3c,0xb35,0x83f,0x936,0xe3a,0xf33,0xc39,0xd30,
  0x3a0,0x2a9,0x1a3,0xaa,0x7a6,0x6af,0x5a5,0x4ac,0xbac,0xaa5,0x9af,0x8a6,0xfaa,0xea3,0xda9,0xca0,
  0x460,0x569,0x663,0x76a,0x66,0x16f,0x265,0x36c,0xc6c,0xd65,0xe6f,0xf66,0x86a,0x963,0xa69,0xb60,
  0x5f0,0x4f9,0x7f3,0x6fa,0x1f6,0xff,0x3f5,0x2fc,0xdfc,0xcf5,0xfff,0xef6,0x9fa,0x8f3,0xbf9,0xaf0,
  0x650,0x759,0x453,0x55a,0x256,0x35f,0x55,0x15c,0xe5c,0xf55,0xc5f,0xd56,0xa5a,0xb53,0x859,0x950,
  0x7c0,0x6c9,0x5c3,0x4ca,0x3c6,0x2cf,0x1c5,0xcc,0xfcc,0xec5,0xdcf,0xcc6,0xbca,0xac3,0x9c9,0x8c0,
  0x8c0,0x9c9,0xac3,0xbca,0xcc6,0xdcf,0xec5,0xfcc,0xcc,0x1c5,0x2cf,0x3c6,0x4ca,0x5c3,0x6c9,0x7c0,
  0x950,0x859,0xb53,0xa5a,0xd56,0xc5f,0xf55,0xe5c,0x15c,0x55,0x35f,0x256,0x55a,0x453,0x759,0x650,
  0xaf0,0xbf9,0x8f3,0x9fa,0xef6,0xfff,0xcf5,0xdfc,0x2fc,0x3f5,0xff,0x1f6,0x6fa,0x7f3,0x4f9,0x5f0,
  0xb60,0xa69,0x963,0x86a,0xf66,0xe6f,0xd65,0xc6c,0x36c,0x265,0x16f,0x66,0x76a,0x663,0x569,0x460,
  0xca0,0xda9,0xea3,0xfaa,0x8a6,0x9af,0xaa5,0xbac,0x4ac,0x5a5,0x6af,0x7a6,0xaa,0x1a3,0x2a9,0x3a0,
  0xd30,0xc39,0xf33,0xe3a,0x936,0x83f,0xb35,0xa3c,0x53c,0x435,0x73f,0x636,0x13a,0x33,0x339,0x230,
  0xe90,0xf99,0xc93,0xd9a,0xa96,0xb9f,0x895,0x99c,0x69c,0x795,0x49f,0x596,0x29a,0x393,0x99,0x190,
  0xf00,0xe09,0xd03,0xc0a,0xb06,0xa0f,0x905,0x80c,0x70c,0x605,0x50f,0x406,0x30a,0x203,0x109,0x0,
];

const triTable = [
  [-1],[-1],[-1],[-1],[-1],[-1],[-1],[-1],[-1],[-1],[-1],[-1],[-1],[-1],[-1],[-1],
  [0,8,3,-1],  [0,1,9,-1],  [1,8,3,9,8,1,-1],  [1,2,10,-1],
  [0,8,3,1,2,10,-1],  [9,2,10,0,2,9,-1],  [2,8,3,2,10,8,10,9,8,-1],  [3,11,2,-1],
  [0,11,2,8,11,0,-1],  [1,9,0,2,3,11,-1],  [1,11,2,1,9,11,9,8,11,-1],  [3,10,1,11,10,3,-1],
  [0,10,1,0,8,10,8,11,10,-1],  [3,9,0,3,11,9,11,10,9,-1],  [9,8,10,10,8,11,-1],  [4,7,8,-1],
  [4,3,0,7,3,4,-1],  [0,1,9,8,4,7,-1],  [4,1,9,4,7,1,7,3,1,-1],  [1,2,10,8,4,7,-1],
  [3,4,7,3,0,4,1,2,10,-1],  [9,2,10,9,0,2,8,4,7,-1],  [2,10,9,2,9,7,2,7,3,7,9,4,-1],
  [8,4,7,3,11,2,-1],  [11,4,7,11,2,4,2,0,4,-1],  [9,0,1,8,4,7,2,3,11,-1],
  [4,7,11,9,4,11,9,11,2,9,2,1,-1],  [3,10,1,3,11,10,7,8,4,-1],
  [1,11,10,1,4,11,1,0,4,7,11,4,-1],  [4,7,8,9,0,11,9,11,10,11,0,3,-1],
  [4,7,11,4,11,9,9,11,10,-1],  [9,5,4,-1],  [9,5,4,0,8,3,-1],  [0,5,4,1,5,0,-1],
  [8,5,4,8,3,5,3,1,5,-1],  [1,2,10,9,5,4,-1],  [3,0,8,1,2,10,4,9,5,-1],
  [5,2,10,5,4,2,4,0,2,-1],  [2,10,5,3,2,5,3,5,4,3,4,8,-1],  [9,5,4,2,3,11,-1],
  [0,11,2,0,8,11,4,9,5,-1],  [0,5,4,0,1,5,2,3,11,-1],
  [2,1,5,2,5,8,2,8,11,4,8,5,-1],  [10,3,11,10,1,3,9,5,4,-1],
  [4,9,5,0,8,1,8,10,1,8,11,10,-1],  [5,4,0,5,0,11,5,11,10,11,0,3,-1],
  [5,4,8,5,8,10,10,8,11,-1],  [9,7,8,5,7,9,-1],  [9,3,0,9,5,3,5,7,3,-1],
  [0,7,8,0,1,7,1,5,7,-1],  [1,5,3,3,5,7,-1],  [9,7,8,9,5,7,10,1,2,-1],
  [10,1,2,9,5,0,5,3,0,5,7,3,-1],  [8,0,2,8,2,5,8,5,7,10,5,2,-1],
  [2,10,5,2,5,3,3,5,7,-1],  [7,9,5,7,8,9,3,11,2,-1],
  [9,5,7,9,7,2,9,2,0,2,7,11,-1],  [2,3,11,0,1,8,1,7,8,1,5,7,-1],
  [11,2,1,11,1,7,7,1,5,-1],  [9,5,8,8,5,7,10,1,3,10,3,11,-1],
  [5,7,0,5,0,9,7,11,0,1,0,10,11,10,0,-1],  [11,10,0,11,0,3,10,5,0,8,0,7,5,7,0,-1],
  [11,10,5,7,11,5,-1],  [10,6,5,-1],  [0,8,3,5,10,6,-1],  [9,0,1,5,10,6,-1],
  [1,8,3,1,9,8,5,10,6,-1],  [1,6,5,2,6,1,-1],  [1,6,5,1,2,6,3,0,8,-1],
  [9,6,5,9,0,6,0,2,6,-1],  [5,9,8,5,8,2,5,2,6,3,2,8,-1],  [2,3,11,10,6,5,-1],
  [11,0,8,11,2,0,10,6,5,-1],  [0,1,9,2,3,11,5,10,6,-1],
  [5,10,6,1,9,2,9,11,2,9,8,11,-1],  [6,3,11,6,5,3,5,1,3,-1],
  [0,8,11,0,11,5,0,5,1,5,11,6,-1],  [3,11,6,0,3,6,0,6,5,0,5,9,-1],
  [6,5,9,6,9,11,11,9,8,-1],  [5,10,6,4,7,8,-1],  [4,3,0,4,7,3,6,5,10,-1],
  [1,9,0,5,10,6,8,4,7,-1],  [10,6,5,1,9,7,1,7,3,7,9,4,-1],
  [6,1,2,6,5,1,4,7,8,-1],  [1,2,5,5,2,6,3,0,4,3,4,7,-1],
  [8,4,7,9,0,5,0,6,5,0,2,6,-1],  [7,3,9,7,9,4,3,2,9,5,9,6,2,6,9,-1],
  [3,11,2,7,8,4,10,6,5,-1],  [5,10,6,4,7,2,4,2,0,2,7,11,-1],
  [0,1,9,4,7,8,2,3,11,5,10,6,-1],  [9,2,1,9,11,2,9,4,11,7,11,4,5,10,6,-1],
  [8,4,7,3,11,5,3,5,1,5,11,6,-1],  [5,1,11,5,11,6,1,0,11,7,11,4,0,4,11,-1],
  [0,5,9,0,6,5,0,3,6,11,6,3,8,4,7,-1],  [6,5,9,6,9,11,4,7,9,7,11,9,-1],
  [10,4,9,6,4,10,-1],  [4,10,6,4,9,10,0,8,3,-1],  [10,0,1,10,6,0,6,4,0,-1],
  [8,3,1,8,1,6,8,6,4,6,1,10,-1],  [1,4,9,1,2,4,2,6,4,-1],
  [3,0,8,1,2,9,2,4,9,2,6,4,-1],  [0,2,4,4,2,6,-1],  [8,3,2,8,2,4,4,2,6,-1],
  [10,4,9,10,6,4,11,2,3,-1],  [0,8,2,2,8,11,4,9,10,4,10,6,-1],
  [3,11,2,0,1,6,0,6,4,6,1,10,-1],  [6,4,1,6,1,10,4,8,1,2,1,11,8,11,1,-1],
  [9,6,4,9,3,6,9,1,3,11,6,3,-1],  [8,11,1,8,1,0,11,6,1,9,1,4,6,4,1,-1],
  [3,11,6,3,6,0,0,6,4,-1],  [6,4,8,11,6,8,-1],
  [7,10,6,7,8,10,8,9,10,-1],  [0,7,3,0,10,7,0,9,10,6,7,10,-1],
  [10,6,7,1,10,7,1,7,8,1,8,0,-1],  [10,6,7,10,7,1,1,7,3,-1],
  [1,2,6,1,6,8,1,8,9,8,6,7,-1],  [2,6,9,2,9,1,6,7,9,0,9,3,7,3,9,-1],
  [7,8,0,7,0,6,6,0,2,-1],  [7,3,2,6,7,2,-1],
  [2,3,11,10,6,8,10,8,9,8,6,7,-1],  [2,0,7,2,7,11,0,9,7,6,7,10,9,10,7,-1],
  [1,8,0,1,7,8,1,10,7,6,7,10,2,3,11,-1],  [11,2,1,11,1,7,10,6,1,6,7,1,-1],
  [8,9,6,8,6,7,9,1,6,11,6,3,1,3,6,-1],  [0,9,1,11,6,7,-1],
  [7,8,0,7,0,6,3,11,0,11,6,0,-1],  [7,11,6,-1],
  [7,6,11,-1],  [3,0,8,11,7,6,-1],  [0,1,9,11,7,6,-1],  [8,1,9,8,3,1,11,7,6,-1],
  [10,1,2,6,11,7,-1],  [1,2,10,3,0,8,6,11,7,-1],  [2,9,0,2,10,9,6,11,7,-1],
  [6,11,7,2,10,3,10,8,3,10,9,8,-1],  [7,2,3,6,2,7,-1],  [7,0,8,7,6,0,6,2,0,-1],
  [2,7,6,2,3,7,0,1,9,-1],  [1,6,2,1,8,6,1,9,8,8,7,6,-1],
  [10,7,6,10,1,7,1,3,7,-1],  [10,7,6,1,7,10,1,8,7,1,0,8,-1],
  [0,3,7,0,7,10,0,10,9,6,10,7,-1],  [7,6,10,7,10,8,8,10,9,-1],
  [6,8,4,11,8,6,-1],  [3,6,11,3,0,6,0,4,6,-1],  [8,6,11,8,4,6,9,0,1,-1],
  [9,4,6,9,6,3,9,3,1,11,3,6,-1],  [6,8,4,6,11,8,2,10,1,-1],
  [1,2,10,3,0,11,0,6,11,0,4,6,-1],  [4,11,8,4,6,11,0,2,9,2,10,9,-1],
  [10,9,3,10,3,2,9,4,3,11,3,6,4,6,3,-1],  [8,2,3,8,4,2,4,6,2,-1],
  [0,4,2,4,6,2,-1],  [1,9,0,2,3,4,2,4,6,4,3,8,-1],  [1,9,4,1,4,2,2,4,6,-1],
  [8,1,3,8,6,1,8,4,6,6,10,1,-1],  [10,1,0,10,0,6,6,0,4,-1],
  [4,6,3,4,3,8,6,10,3,0,3,9,10,9,3,-1],  [10,9,4,6,10,4,-1],
  [4,9,5,7,6,11,-1],  [0,8,3,4,9,5,11,7,6,-1],  [5,0,1,5,4,0,7,6,11,-1],
  [11,7,6,8,3,4,3,5,4,3,1,5,-1],  [9,5,4,10,1,2,7,6,11,-1],
  [6,11,7,1,2,10,0,8,3,4,9,5,-1],  [7,6,11,5,4,10,4,2,10,4,0,2,-1],
  [3,4,8,3,5,4,3,2,5,10,5,2,11,7,6,-1],  [7,2,3,7,6,2,5,4,9,-1],
  [9,5,4,0,8,6,0,6,2,6,8,7,-1],  [3,6,2,3,7,6,1,5,0,5,4,0,-1],
  [6,2,8,6,8,7,2,1,8,4,8,5,1,5,8,-1],  [9,5,4,10,1,6,1,7,6,1,3,7,-1],
  [1,6,10,1,7,6,1,0,7,8,7,0,9,5,4,-1],  [4,0,10,4,10,5,0,3,10,6,10,7,3,7,10,-1],
  [7,6,10,7,10,8,5,4,10,4,8,10,-1],  [6,9,5,6,11,9,11,8,9,-1],
  [3,6,11,0,6,3,0,5,6,0,9,5,-1],  [0,11,8,0,5,11,0,1,5,5,6,11,-1],
  [6,11,3,6,3,5,5,3,1,-1],  [1,2,10,9,5,11,9,11,8,11,5,6,-1],
  [0,11,3,0,6,11,0,9,6,5,6,9,1,2,10,-1],  [11,8,5,11,5,6,8,0,5,10,5,2,0,2,5,-1],
  [6,11,3,6,3,5,2,10,3,10,5,3,-1],  [5,8,9,5,2,8,5,6,2,3,8,2,-1],
  [9,5,6,9,6,0,0,6,2,-1],  [1,5,8,1,8,0,5,6,8,3,8,2,6,2,8,-1],
  [1,5,6,2,1,6,-1],  [1,3,6,1,6,10,3,8,6,5,6,9,8,9,6,-1],
  [10,1,0,10,0,6,9,5,0,5,6,0,-1],  [0,3,8,5,6,10,-1],  [10,5,6,-1],
  [11,5,10,7,5,11,-1],  [11,5,10,11,7,5,8,3,0,-1],  [5,11,7,5,10,11,1,9,0,-1],
  [10,7,5,10,11,7,9,8,1,8,3,1,-1],  [11,1,2,11,7,1,7,5,1,-1],
  [0,8,3,1,2,7,1,7,5,7,2,11,-1],  [9,7,5,9,2,7,9,0,2,2,11,7,-1],
  [7,5,2,7,2,11,5,9,2,3,2,8,9,8,2,-1],  [2,5,10,2,3,5,3,7,5,-1],
  [8,2,0,8,5,2,8,7,5,10,2,5,-1],  [9,0,1,5,10,3,5,3,7,3,10,2,-1],
  [9,8,2,9,2,1,8,7,2,10,2,5,7,5,2,-1],  [1,3,5,3,7,5,-1],
  [0,8,7,0,7,1,1,7,5,-1],  [9,0,3,9,3,5,5,3,7,-1],  [9,8,7,5,9,7,-1],
  [5,8,4,5,10,8,10,11,8,-1],  [5,0,4,5,11,0,5,10,11,11,3,0,-1],
  [0,1,9,8,4,10,8,10,11,10,4,5,-1],  [10,11,4,10,4,5,11,3,4,9,4,1,3,1,4,-1],
  [2,5,1,2,8,5,2,11,8,4,5,8,-1],  [0,4,11,0,11,3,4,5,11,2,11,1,5,1,11,-1],
  [0,2,5,0,5,9,2,11,5,4,5,8,11,8,5,-1],  [9,4,5,2,11,3,-1],
  [2,5,10,3,5,2,3,4,5,3,8,4,-1],  [5,10,2,5,2,4,4,2,0,-1],
  [3,10,2,3,5,10,3,8,5,4,5,8,0,1,9,-1],  [5,10,2,5,2,4,1,9,2,9,4,2,-1],
  [8,4,5,8,5,3,3,5,1,-1],  [0,4,5,1,0,5,-1],  [8,4,5,8,5,3,9,0,5,0,3,5,-1],
  [9,4,5,-1],  [4,11,7,4,9,11,9,10,11,-1],  [0,8,3,4,9,7,9,11,7,9,10,11,-1],
  [1,10,11,1,11,4,1,4,0,7,4,11,-1],  [3,1,4,3,4,8,1,10,4,7,4,11,10,11,4,-1],
  [4,11,7,9,11,4,9,2,11,9,1,2,-1],  [9,7,4,9,11,7,9,1,11,2,11,1,0,8,3,-1],
  [11,7,4,11,4,2,2,4,0,-1],  [11,7,4,11,4,2,8,3,4,3,2,4,-1],
  [2,9,10,2,7,9,2,3,7,7,4,9,-1],  [9,10,7,9,7,4,10,2,7,8,7,0,2,0,7,-1],
  [3,7,10,3,10,2,7,4,10,1,10,0,4,0,10,-1],  [1,10,2,8,7,4,-1],
  [4,9,1,4,1,7,7,1,3,-1],  [4,9,1,4,1,7,0,8,1,8,7,1,-1],
  [4,0,3,7,4,3,-1],  [4,8,7,-1],  [9,10,8,10,11,8,-1],  [3,0,9,3,9,11,11,9,10,-1],
  [0,1,10,0,10,8,8,10,11,-1],  [3,1,10,11,3,10,-1],  [1,2,11,1,11,9,9,11,8,-1],
  [3,0,9,3,9,11,1,2,9,2,11,9,-1],  [0,2,11,8,0,11,-1],  [3,2,11,-1],
  [2,3,8,2,8,10,10,8,9,-1],  [9,10,2,0,9,2,-1],  [2,3,8,2,8,10,0,1,8,1,10,8,-1],
  [1,10,2,-1],  [1,3,8,9,1,8,-1],  [0,9,1,-1],  [0,3,8,-1],  [-1],
];

// ─── Signed-distance voxelisation ────────────────────────────────────────────
// Rasterises the source mesh triangles into a 3-D grid.
// Each voxel gets a value: negative inside, positive outside (approx SDF).
function voxelise(geometry, resolution) {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;

  // Add some padding so the surface doesn't clip at grid edges
  const pad = 0.05;
  const min = new THREE.Vector3(
    bb.min.x - (bb.max.x - bb.min.x) * pad,
    bb.min.y - (bb.max.y - bb.min.y) * pad,
    bb.min.z - (bb.max.z - bb.min.z) * pad,
  );
  const max = new THREE.Vector3(
    bb.max.x + (bb.max.x - bb.min.x) * pad,
    bb.max.y + (bb.max.y - bb.min.y) * pad,
    bb.max.z + (bb.max.z - bb.min.z) * pad,
  );

  const size = new THREE.Vector3().subVectors(max, min);
  const maxDim = Math.max(size.x, size.y, size.z);
  const step = maxDim / resolution;

  const nx = Math.ceil(size.x / step) + 1;
  const ny = Math.ceil(size.y / step) + 1;
  const nz = Math.ceil(size.z / step) + 1;

  // Build triangle list
  const pos = geometry.attributes.position;
  const triCount = Math.floor(pos.count / 3);
  const triangles = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();

  for (let i = 0; i < triCount; i++) {
    a.fromBufferAttribute(pos, i * 3);
    b.fromBufferAttribute(pos, i * 3 + 1);
    c.fromBufferAttribute(pos, i * 3 + 2);
    triangles.push({
      a: a.clone(), b: b.clone(), c: c.clone(),
      normal: new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize(),
    });
  }

  // For each grid point, compute approximate signed distance
  const grid = new Float32Array(nx * ny * nz);
  grid.fill(1.0); // default: outside

  const point = new THREE.Vector3();
  const closest = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        point.set(
          min.x + ix * step,
          min.y + iy * step,
          min.z + iz * step,
        );

        let minDist = Infinity;
        let sign = 1;

        // Simple approach: closest triangle distance + normal-based sign
        for (let t = 0; t < triangles.length; t++) {
          const tri = triangles[t];
          closestPointOnTriangle(point, tri.a, tri.b, tri.c, closest);
          const d = point.distanceTo(closest);

          if (d < minDist) {
            minDist = d;
            // Sign determined by dot of (point - closest) with triangle normal
            tmp.subVectors(point, closest);
            sign = tmp.dot(tri.normal) >= 0 ? 1 : -1;
          }
        }

        grid[iz * ny * nx + iy * nx + ix] = sign * minDist;
      }
    }
  }

  return { grid, nx, ny, nz, min, step };
}

// ─── Closest point on triangle (Barycentric projection) ─────────────────────
function closestPointOnTriangle(p, a, b, c, target) {
  const ab = new THREE.Vector3().subVectors(b, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  const ap = new THREE.Vector3().subVectors(p, a);

  const d1 = ab.dot(ap);
  const d2 = ac.dot(ap);
  if (d1 <= 0 && d2 <= 0) { target.copy(a); return; }

  const bp = new THREE.Vector3().subVectors(p, b);
  const d3 = ab.dot(bp);
  const d4 = ac.dot(bp);
  if (d3 >= 0 && d4 <= d3) { target.copy(b); return; }

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    target.copy(a).addScaledVector(ab, v);
    return;
  }

  const cp = new THREE.Vector3().subVectors(p, c);
  const d5 = ab.dot(cp);
  const d6 = ac.dot(cp);
  if (d6 >= 0 && d5 <= d6) { target.copy(c); return; }

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    target.copy(a).addScaledVector(ac, w);
    return;
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    target.copy(b).addScaledVector(new THREE.Vector3().subVectors(c, b), w);
    return;
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  target.copy(a).addScaledVector(ab, v).addScaledVector(ac, w);
}

// ─── Marching Cubes isosurface extraction ───────────────────────────────────
function marchingCubes(voxelData, isoLevel = 0) {
  const { grid, nx, ny, nz, min, step } = voxelData;
  const vertices = [];

  function val(ix, iy, iz) {
    if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) return 1.0;
    return grid[iz * ny * nx + iy * nx + ix];
  }

  function interp(p1, p2, v1, v2) {
    if (Math.abs(isoLevel - v1) < 1e-10) return p1.clone();
    if (Math.abs(isoLevel - v2) < 1e-10) return p2.clone();
    if (Math.abs(v1 - v2) < 1e-10) return p1.clone();
    const mu = (isoLevel - v1) / (v2 - v1);
    return new THREE.Vector3(
      p1.x + mu * (p2.x - p1.x),
      p1.y + mu * (p2.y - p1.y),
      p1.z + mu * (p2.z - p1.z),
    );
  }

  for (let iz = 0; iz < nz - 1; iz++) {
    for (let iy = 0; iy < ny - 1; iy++) {
      for (let ix = 0; ix < nx - 1; ix++) {
        // 8 corners of the cube
        const cubeVals = [
          val(ix, iy, iz),
          val(ix + 1, iy, iz),
          val(ix + 1, iy + 1, iz),
          val(ix, iy + 1, iz),
          val(ix, iy, iz + 1),
          val(ix + 1, iy, iz + 1),
          val(ix + 1, iy + 1, iz + 1),
          val(ix, iy + 1, iz + 1),
        ];

        let cubeIndex = 0;
        for (let n = 0; n < 8; n++) {
          if (cubeVals[n] < isoLevel) cubeIndex |= (1 << n);
        }

        if (edgeTable[cubeIndex] === 0) continue;

        const cubePos = [
          new THREE.Vector3(min.x + ix * step, min.y + iy * step, min.z + iz * step),
          new THREE.Vector3(min.x + (ix + 1) * step, min.y + iy * step, min.z + iz * step),
          new THREE.Vector3(min.x + (ix + 1) * step, min.y + (iy + 1) * step, min.z + iz * step),
          new THREE.Vector3(min.x + ix * step, min.y + (iy + 1) * step, min.z + iz * step),
          new THREE.Vector3(min.x + ix * step, min.y + iy * step, min.z + (iz + 1) * step),
          new THREE.Vector3(min.x + (ix + 1) * step, min.y + iy * step, min.z + (iz + 1) * step),
          new THREE.Vector3(min.x + (ix + 1) * step, min.y + (iy + 1) * step, min.z + (iz + 1) * step),
          new THREE.Vector3(min.x + ix * step, min.y + (iy + 1) * step, min.z + (iz + 1) * step),
        ];

        // The 12 edges connect these vertex pairs
        const edgePairs = [
          [0,1],[1,2],[2,3],[3,0],
          [4,5],[5,6],[6,7],[7,4],
          [0,4],[1,5],[2,6],[3,7],
        ];

        const edgeVerts = new Array(12);
        for (let e = 0; e < 12; e++) {
          if (edgeTable[cubeIndex] & (1 << e)) {
            const [a, b] = edgePairs[e];
            edgeVerts[e] = interp(cubePos[a], cubePos[b], cubeVals[a], cubeVals[b]);
          }
        }

        const triList = triTable[cubeIndex];
        for (let t = 0; t < triList.length; t += 3) {
          if (triList[t] === -1) break;
          vertices.push(
            edgeVerts[triList[t]],
            edgeVerts[triList[t + 1]],
            edgeVerts[triList[t + 2]],
          );
        }
      }
    }
  }

  return vertices;
}

// ─── Public API ──────────────────────────────────────────────────────────────
/**
 * Retopologise a BufferGeometry using voxel remeshing.
 * @param {THREE.BufferGeometry} geometry  — input mesh
 * @param {number}               resolution — grid divisions (32–128 recommended)
 * @returns {THREE.BufferGeometry} — clean, uniform-triangle mesh
 */
export function retopologise(geometry, resolution = 64) {
  // Ensure non-indexed for consistent triangle winding
  let geo = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  geo.computeBoundingBox();

  // Voxelise
  const voxelData = voxelise(geo, resolution);

  // Extract isosurface
  const verts = marchingCubes(voxelData, 0);

  if (verts.length === 0) {
    console.warn('Retopology produced 0 vertices — returning original geometry.');
    return geometry.clone();
  }

  // Build BufferGeometry
  const positions = new Float32Array(verts.length * 3);
  for (let i = 0; i < verts.length; i++) {
    positions[i * 3]     = verts[i].x;
    positions[i * 3 + 1] = verts[i].y;
    positions[i * 3 + 2] = verts[i].z;
  }

  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  result.computeVertexNormals();
  result.computeBoundingBox();

  return result;
}

/**
 * Get stats about a geometry (face/vertex count).
 */
export function getGeoStats(geometry) {
  const pos = geometry.attributes.position;
  return {
    vertices: pos.count,
    faces: Math.floor(pos.count / 3),
  };
}
