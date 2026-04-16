/**
 * Web Worker — Gray-Scott Reaction-Diffusion map generator.
 *
 * Receives: { feed, kill, iterations }
 * Posts back: Float32Array (128 × 128), transferred for zero-copy.
 */
import { solveGrayScott } from '../algorithms/grayScott.js';

self.onmessage = (e) => {
  const { feed, kill, iterations } = e.data;
  const map = solveGrayScott({ feed, kill, iterations });
  // Transfer the buffer ownership to the main thread (zero allocation copy)
  self.postMessage(map, [map.buffer]);
};
