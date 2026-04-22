/**
 * gcodeWorker.js
 * Web Worker for generating G-code without blocking the main thread.
 */

import { sliceAssembly } from './layerSlicer.js';
import { generateSpiralPath } from './spiralPath.js';
import { emitGcode } from './gcodeEmitter.js';

self.onmessage = function(e) {
  const { id, tiers, printSettings } = e.data;
  
  try {
    // 1. Slice geometry into layers
    const layers = sliceAssembly(tiers, {
      layerHeight: printSettings.layerHeight,
      profilePtsN: 256, // Higher resolution for export
      gap: 0 // Stack directly
    });

    // 2. Generate toolpath
    let path = [];
    if (printSettings.vaseMode) {
      path = generateSpiralPath(layers);
    } else {
      // Basic layer-by-layer fallback if not vase mode
      path = [];
      layers.forEach(layer => {
        layer.points.forEach(pt => {
           path.push({ x: pt.x, y: pt.y, z: layer.z });
        });
      });
    }

    // 3. Emit G-code
    const gcode = emitGcode(path, printSettings);

    self.postMessage({ id, status: 'success', gcode });
  } catch (error) {
    self.postMessage({ id, status: 'error', error: error.message });
  }
};
