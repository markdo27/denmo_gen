/**
 * spiralPath.js
 * Implements vase mode (SPIRALIZE) toolpath generation.
 * Converts a stack of constant-Z layers into a single continuous spiraling path.
 */

/**
 * Converts a stack of discrete 2D layers into a continuous 3D spiral.
 *
 * @param {object[]} layers - Array of { z, points: {x,y}[] } from layerSlicer
 * @returns {{ x: number, y: number, z: number }[]} - Continuous spiral toolpath
 */
export function generateSpiralPath(layers) {
  if (!layers || layers.length < 2) return [];

  const spiralPath = [];
  const nLayers = layers.length;

  // We need to continuously increase Z as we traverse the points of each layer.
  // Exception: the very first bottom layer(s) should be printed flat for bed adhesion.
  // Usually vase mode prints 2-3 solid bottom layers, but for a pure hollow lamp,
  // we might start spiraling immediately. Let's start spiraling from layer 0 to 1.

  for (let li = 0; li < nLayers - 1; li++) {
    const currentLayer = layers[li];
    const nextLayer    = layers[li + 1];
    
    const ptsCount = currentLayer.points.length;
    const zStart   = currentLayer.z;
    const zEnd     = nextLayer.z;
    const zDiff    = zEnd - zStart;

    for (let p = 0; p < ptsCount; p++) {
      const pt = currentLayer.points[p];
      const fraction = p / ptsCount;
      const currentZ = zStart + zDiff * fraction;
      
      spiralPath.push({
        x: pt.x,
        y: pt.y,
        z: currentZ,
      });
    }
  }

  // Cap off with the last point of the last layer to complete the shape
  const lastLayer = layers[nLayers - 1];
  if (lastLayer && lastLayer.points.length > 0) {
     const lastPt = lastLayer.points[lastLayer.points.length - 1];
     spiralPath.push({
         x: lastPt.x,
         y: lastPt.y,
         z: lastLayer.z
     });
  }

  return spiralPath;
}
