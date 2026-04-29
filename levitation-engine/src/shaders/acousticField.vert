// Acoustic Field Vertex Shader
// Computes the analytic standing-wave amplitude envelope per instance.
//
// Physics:
//   Two counter-propagating waves:  P₁ = A·sin(ky − ωt),  P₂ = A·sin(k(D−y) − ωt + φ)
//
//   By sum-to-product identity:
//     P(y,t) = 2A · cos(ky − kD/2 − φ/2) · sin(kD/2 − ωt + φ/2)
//
//   Amplitude envelope (levitation trap positions):
//     E(y) = 2A · cos(ky − kD/2 − φ/2)          ← spatial, passed to fragment
//
//   Temporal modulation (global oscillation):
//     T(t) = sin(kD/2 − ωt + φ/2)               ← scalar, modulates alpha/size
//
// The envelope E(y) is computed per-instance on the GPU.
// u_time is in seconds — no scaling factor applied (was erroneously ×0.001).

precision highp float;

// Per-instance attribute: position in the acoustic field
attribute vec3 instancePosition;

// Uniforms
uniform float u_frequency;    // kHz
uniform float u_amplitude;    // 0–1
uniform float u_distance;     // metres between transducer arrays
uniform float u_phase;        // radians
uniform float u_time;         // seconds (no conversion needed)
uniform float u_speed;        // speed of sound [m/s]

// Passed to fragment shader
varying float v_envelope;     // amplitude envelope  E(y) ∈ [−2A, +2A]
varying float v_temporal;     // temporal scalar     T(t) ∈ [−1, +1]
varying vec3  v_worldPos;
varying float v_normalizedY;

void main() {
  vec3 pos = position * 0.06 + instancePosition;

  // ── Wave parameters ──────────────────────────────────────────────────────
  float f     = u_frequency * 1000.0;             // kHz → Hz
  float k     = 6.2831853 * f / u_speed;          // wavenumber  [rad/m]
  float omega = 6.2831853 * f;                    // angular freq [rad/s]
  float y     = instancePosition.y;

  // ── Analytic decomposition ───────────────────────────────────────────────
  float halfKD   = k * u_distance * 0.5;
  float halfPhi  = u_phase * 0.5;

  // Envelope: E(y) = 2A · cos(ky − kD/2 − φ/2)
  v_envelope = 2.0 * u_amplitude * cos(k * y - halfKD - halfPhi);

  // Temporal: T(t) = sin(kD/2 − ωt + φ/2)   — u_time already in seconds
  v_temporal = sin(halfKD - omega * u_time + halfPhi);

  v_worldPos     = instancePosition;
  v_normalizedY  = y / max(u_distance, 0.001);

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position     = projectionMatrix * mvPosition;
}
