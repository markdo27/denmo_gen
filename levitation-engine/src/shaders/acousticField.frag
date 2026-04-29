// Acoustic Field Fragment Shader
// Colors each instance based on the standing wave amplitude envelope.
//
// Input varyings:
//   v_envelope  — spatial envelope  E(y) = 2A·cos(ky − kD/2 − φ/2)  ∈ [−2A, +2A]
//   v_temporal  — scalar oscillation T(t) ∈ [−1, +1]
//
// Color mapping:
//   E(y) > 0 → compression antinode  → magenta  (#ff00aa)
//   E(y) = 0 → pressure node/trap   → cyan     (#00f0ff)
//   E(y) < 0 → rarefaction antinode → deep blue
//
// The if/else branch over sign(E) is replaced with branchless step()/clamp()
// to eliminate GPU warp divergence.

precision highp float;

varying float v_envelope;
varying float v_temporal;
varying vec3  v_worldPos;
varying float v_normalizedY;

uniform float u_amplitude;

void main() {
  // Normalize envelope to [−1, +1]
  float maxE        = max(2.0 * u_amplitude, 0.001);
  float normalizedE = clamp(v_envelope / maxE, -1.0, 1.0);

  // ── Branchless color selection ────────────────────────────────────────────
  // isPos ∈ {0.0, 1.0}: 1 when envelope is positive, 0 otherwise
  float isPos = step(0.0, normalizedE);
  float absE  = abs(normalizedE);

  vec3 colorPos  = vec3(1.0, 0.0,  0.67);   // magenta  #ff00aa
  vec3 colorZero = vec3(0.0, 0.94, 1.0);    // cyan     #00f0ff
  vec3 colorNeg  = vec3(0.05, 0.1, 0.4);    // deep blue

  // mix(colorZero→colorPos) for positive; mix(colorZero→colorNeg) for negative
  vec3 colorA = mix(colorZero, colorPos, absE);  // positive branch result
  vec3 colorB = mix(colorZero, colorNeg, absE);  // negative branch result
  vec3 color  = mix(colorB, colorA, isPos);      // select without branching

  // ── Node glow: brighten near E(y)=0 (levitation traps) ──────────────────
  float nodeProximity = 1.0 - absE;
  color += vec3(0.0, 0.3, 0.4) * nodeProximity * 0.3;

  // ── Opacity: antinodes opaque, nodes semi-transparent ────────────────────
  // Modulate by |T(t)| so the field visibly oscillates in time.
  float temporalMod = abs(v_temporal);
  float alpha = 0.05 + 0.6 * absE * temporalMod;

  gl_FragColor = vec4(color, alpha);
}
