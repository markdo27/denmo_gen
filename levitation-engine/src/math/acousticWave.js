import { SPEED_OF_SOUND } from '../utils/constants';
import { degToRad } from '../utils/formatters';

/**
 * Compute standing wave pressure at a point in the acoustic field.
 *
 * Two opposing transducer arrays at y=0 and y=D produce counter-propagating waves:
 *   Wave 1: P₁ = A · sin(ky − ωt)
 *   Wave 2: P₂ = A · sin(k(D−y) − ωt + φ)
 *
 * By the sum-to-product identity  sin α + sin β = 2 sin((α+β)/2) cos((α−β)/2):
 *
 *   P(y,t) = 2A · cos(ky − kD/2 − φ/2) · sin(kD/2 − ωt + φ/2)
 *
 * The cosine factor is the *amplitude envelope* — time-independent, governs levitation.
 * The sine factor is the temporal oscillation — spatially uniform at every y.
 *
 * @param {number} y           - Position along the axis (0 to D), metres
 * @param {number} frequency   - Frequency in kHz
 * @param {number} amplitude   - Amplitude (0–1)
 * @param {number} distance    - Distance between transducer arrays, metres
 * @param {number} phaseShift  - Phase shift in degrees
 * @param {number} time        - Current time in seconds
 * @returns {number} Pressure at position y and time t
 */
export function computePressure(y, frequency, amplitude, distance, phaseShift, time) {
  const f     = frequency * 1000;                    // kHz → Hz
  const k     = (2 * Math.PI * f) / SPEED_OF_SOUND; // wavenumber  [rad/m]
  const omega = 2 * Math.PI * f;                     // angular frequency [rad/s]
  const phi   = degToRad(phaseShift);

  // Analytic superposition (sum-to-product):
  const envelope  = 2 * amplitude * Math.cos(k * y - k * distance / 2 - phi / 2);
  const temporal  = Math.sin(k * distance / 2 - omega * time + phi / 2);

  return envelope * temporal;
}

/**
 * Compute the time-independent amplitude envelope of the standing wave.
 *
 * P_env(y) = 2A · cos(ky − kD/2 − φ/2)
 *
 * This is the physically correct quantity for determining levitation traps —
 * the envelope is what the GPU shader should animate, not the raw superposition.
 *
 * @param {number} y          - Axial position [m]
 * @param {number} frequency  - Frequency [kHz]
 * @param {number} amplitude  - Amplitude [0–1]
 * @param {number} distance   - Transducer separation [m]
 * @param {number} phaseShift - Phase shift [degrees]
 * @returns {number} Envelope amplitude at y ∈ [−2A, +2A]
 */
export function computeEnvelope(y, frequency, amplitude, distance, phaseShift) {
  const f   = frequency * 1000;
  const k   = (2 * Math.PI * f) / SPEED_OF_SOUND;
  const phi = degToRad(phaseShift);
  return 2 * amplitude * Math.cos(k * y - k * distance / 2 - phi / 2);
}

/**
 * Find the positions of pressure nodes (levitation traps) along the axis.
 *
 * Nodes occur where the amplitude envelope P_env(y) = 0:
 *   cos(ky − kD/2 − φ/2) = 0
 *   ky − kD/2 − φ/2 = π/2 + nπ,  n ∈ ℤ
 *   y_n = D/2 + φ/(2k) + (2n+1)·λ/4
 *
 * The spacing between consecutive nodes is λ/2.
 * The first node is centred at D/2, shifted by the phase offset φ/(2k).
 *
 * @param {number} frequency   - Frequency [kHz]
 * @param {number} distance    - Transducer separation [m]
 * @param {number} phaseShift  - Phase shift [degrees]
 * @returns {number[]} Sorted array of y-positions where levitation traps occur
 */
export function findPressureNodes(frequency, distance, phaseShift) {
  const f           = frequency * 1000;
  const k           = (2 * Math.PI * f) / SPEED_OF_SOUND;
  const phi         = degToRad(phaseShift);
  const lambda      = SPEED_OF_SOUND / f;          // wavelength [m]
  const nodeSpacing = lambda / 2;                  // inter-node spacing [m]

  // Centre of the node pattern, shifted by phase:  y₀ = D/2 + φ/(2k) + λ/4
  // (n=0 term of y_n = D/2 + φ/(2k) + (2n+1)·λ/4)
  const centreOffset = distance / 2 + phi / (2 * k);

  // First node closest to y=0 that still satisfies y_n = centreOffset + n·(λ/2)
  // Walk backwards from centreOffset to find the smallest non-negative y.
  const firstNode = ((centreOffset + lambda / 4) % nodeSpacing + nodeSpacing) % nodeSpacing;

  const nodes = [];
  for (let y = firstNode; y <= distance; y += nodeSpacing) {
    nodes.push(y);
  }

  return nodes;
}

/**
 * Generate instance positions for the volumetric pressure field.
 * Returns a Float32Array of [x, y, z] positions for instanced rendering.
 *
 * Grid spans x ∈ [−W/2, W/2], y ∈ [0, D], z ∈ [−W/2, W/2]
 * with uniform spacing in each axis.
 *
 * @param {number} resolution  - Grid resolution per axis (≥ 2)
 * @param {number} distance    - Distance between transducers (field height)
 * @param {number} fieldWidth  - Width/depth of field visualisation
 * @returns {Float32Array} Flat array of positions [x₀,y₀,z₀, x₁,y₁,z₁, …]
 */
export function generateFieldPositions(resolution, distance, fieldWidth = 4) {
  const total    = resolution * resolution * resolution;
  const positions = new Float32Array(total * 3);
  let idx = 0;

  const halfWidth = fieldWidth / 2;
  // Guard against resolution=1 (division by zero) — clamp denominator to ≥ 1
  const divX = Math.max(1, resolution - 1);
  const divY = Math.max(1, resolution - 1);
  const divZ = Math.max(1, resolution - 1);
  const stepX = fieldWidth / divX;
  const stepY = distance   / divY;
  const stepZ = fieldWidth / divZ;

  for (let ix = 0; ix < resolution; ix++) {
    const x = -halfWidth + ix * stepX;
    for (let iy = 0; iy < resolution; iy++) {
      const y = iy * stepY;
      for (let iz = 0; iz < resolution; iz++) {
        positions[idx++] = x;
        positions[idx++] = y;
        positions[idx++] = -halfWidth + iz * stepZ;
      }
    }
  }

  return positions;
}
