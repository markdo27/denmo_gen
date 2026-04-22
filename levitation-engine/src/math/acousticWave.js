import { SPEED_OF_SOUND } from '../utils/constants';
import { degToRad } from '../utils/formatters';

/**
 * Compute standing wave pressure at a point in the acoustic field.
 *
 * Two opposing transducer arrays at y=0 and y=D:
 *   Wave 1: P1 = A * sin(k*y - ω*t)
 *   Wave 2: P2 = A * sin(k*(D-y) - ω*t + φ)
 *   Total:  P  = P1 + P2
 *
 * @param {number} y - Position along the axis (0 to D)
 * @param {number} frequency - Frequency in kHz
 * @param {number} amplitude - Amplitude (0-1)
 * @param {number} distance - Distance between transducer arrays
 * @param {number} phaseShift - Phase shift in degrees
 * @param {number} time - Current time in seconds
 * @returns {number} Normalized pressure at position y
 */
export function computePressure(y, frequency, amplitude, distance, phaseShift, time) {
  const f = frequency * 1000; // kHz → Hz
  const k = (2 * Math.PI * f) / SPEED_OF_SOUND; // wavenumber
  const omega = 2 * Math.PI * f; // angular frequency
  const phi = degToRad(phaseShift);

  const p1 = amplitude * Math.sin(k * y - omega * time);
  const p2 = amplitude * Math.sin(k * (distance - y) - omega * time + phi);

  return p1 + p2;
}

/**
 * Find the positions of pressure nodes (levitation points) along the axis.
 * These are where the standing wave amplitude envelope crosses zero.
 *
 * @param {number} frequency - Frequency in kHz
 * @param {number} distance - Distance between transducers
 * @param {number} phaseShift - Phase shift in degrees
 * @returns {number[]} Array of y-positions where nodes occur
 */
export function findPressureNodes(frequency, distance, phaseShift) {
  const f = frequency * 1000;
  const k = (2 * Math.PI * f) / SPEED_OF_SOUND;
  const phi = degToRad(phaseShift);
  const wavelength = SPEED_OF_SOUND / f;
  const nodes = [];

  // Standing wave nodes occur at regular intervals of λ/2
  // shifted by the phase offset
  const nodeSpacing = wavelength / 2;
  const offset = (phi / (2 * k)) % nodeSpacing;

  for (let y = offset; y <= distance; y += nodeSpacing) {
    if (y >= 0 && y <= distance) {
      nodes.push(y);
    }
  }

  return nodes;
}

/**
 * Generate instance positions for the volumetric pressure field.
 * Returns a Float32Array of [x, y, z] positions for instanced rendering.
 *
 * @param {number} resolution - Grid resolution per axis
 * @param {number} distance - Distance between transducers (field height)
 * @param {number} fieldWidth - Width/depth of field visualization
 * @returns {Float32Array} Flat array of positions [x0,y0,z0, x1,y1,z1, ...]
 */
export function generateFieldPositions(resolution, distance, fieldWidth = 4) {
  const total = resolution * resolution * resolution;
  const positions = new Float32Array(total * 3);
  let idx = 0;

  const halfWidth = fieldWidth / 2;
  const stepX = fieldWidth / (resolution - 1);
  const stepY = distance / (resolution - 1);
  const stepZ = fieldWidth / (resolution - 1);

  for (let ix = 0; ix < resolution; ix++) {
    for (let iy = 0; iy < resolution; iy++) {
      for (let iz = 0; iz < resolution; iz++) {
        positions[idx++] = -halfWidth + ix * stepX;
        positions[idx++] = iy * stepY;
        positions[idx++] = -halfWidth + iz * stepZ;
      }
    }
  }

  return positions;
}
