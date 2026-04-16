/**
 * Gray-Scott Reaction-Diffusion Solver.
 *
 * Models two chemicals U and V (the "inhibitor" and "activator").
 * Their interaction produces the labyrinthine, coral, and cellular patterns.
 *
 * dU/dt = Du * ∇²U − U·V² + F·(1 − U)
 * dV/dt = Dv * ∇²V + U·V² − (F + k)·V
 *
 * Returns a normalised Float32Array of the V-field at the given resolution.
 */

const RD_RES = 128;

export function solveGrayScott({ feed = 0.055, kill = 0.062, iterations = 1000 } = {}) {
  const N = RD_RES;
  const size = N * N;

  // Diffusion constants (standard Gray-Scott parameters)
  const Du = 0.2097;
  const Dv = 0.105;
  const dt = 1.0;

  // --- Initialise U = 1, V = 0 everywhere ---
  let U  = new Float32Array(size).fill(1.0);
  let V  = new Float32Array(size);
  let U2 = new Float32Array(size);
  let V2 = new Float32Array(size);

  // Seed a noisy rectangular patch in the centre to kick off the reaction
  const cx = N >> 1, cy = N >> 1;
  const patchR = Math.max(6, (N / 12) | 0);
  // Simple seeded pseudo-random for reproducibility
  let rngState = 0x12345678;
  const rand = () => {
    rngState ^= rngState << 13;
    rngState ^= rngState >> 17;
    rngState ^= rngState << 5;
    return ((rngState >>> 0) / 0xffffffff);
  };

  for (let dy = -patchR; dy <= patchR; dy++) {
    for (let dx = -patchR; dx <= patchR; dx++) {
      const xi = ((cx + dx) + N) % N;
      const yi = ((cy + dy) + N) % N;
      const idx = yi * N + xi;
      U[idx] = 0.5 + (rand() - 0.5) * 0.1;
      V[idx] = 0.25 + (rand() - 0.5) * 0.1;
    }
  }

  // --- Main integration loop ---
  for (let iter = 0; iter < iterations; iter++) {
    for (let y = 0; y < N; y++) {
      const yp = ((y + 1) % N) * N;
      const ym = ((y - 1 + N) % N) * N;
      const yc = y * N;

      for (let x = 0; x < N; x++) {
        const i   = yc + x;
        const ip  = yc + (x + 1) % N;
        const im  = yc + (x - 1 + N) % N;
        const jp  = yp + x;
        const jm  = ym + x;

        const lapu = U[ip] + U[im] + U[jp] + U[jm] - 4.0 * U[i];
        const lapv = V[ip] + V[im] + V[jp] + V[jm] - 4.0 * V[i];

        const uvv = U[i] * V[i] * V[i];

        U2[i] = Math.max(0, Math.min(1, U[i] + dt * (Du * lapu - uvv + feed * (1.0 - U[i]))));
        V2[i] = Math.max(0, Math.min(1, V[i] + dt * (Dv * lapv + uvv - (feed + kill) * V[i])));
      }
    }
    // Ping-pong swap (avoids allocations inside the loop)
    const tmpU = U; U = U2; U2 = tmpU;
    const tmpV = V; V = V2; V2 = tmpV;
  }

  // --- Normalise V to [0, 1] ---
  let vMin =  Infinity;
  let vMax = -Infinity;
  for (let i = 0; i < size; i++) {
    if (V[i] < vMin) vMin = V[i];
    if (V[i] > vMax) vMax = V[i];
  }
  const range = (vMax - vMin) || 1;
  const result = new Float32Array(size);
  for (let i = 0; i < size; i++) result[i] = (V[i] - vMin) / range;

  return result;
}

export { RD_RES };
