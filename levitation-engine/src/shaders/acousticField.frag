// Acoustic Field Fragment Shader
// Colors each instance based on computed standing wave pressure

precision highp float;

varying float v_pressure;
varying vec3 v_worldPos;
varying float v_normalizedY;

uniform float u_amplitude;

void main() {
  float maxP = u_amplitude * 2.0;
  float normalizedP = v_pressure / max(maxP, 0.001);

  // Color mapping:
  //   Positive pressure (compression) → magenta/hot
  //   Zero pressure (node/levitation) → cyan
  //   Negative pressure (rarefaction) → deep blue

  vec3 colorPos = vec3(1.0, 0.0, 0.67);   // magenta  #ff00aa
  vec3 colorZero = vec3(0.0, 0.94, 1.0);  // cyan     #00f0ff
  vec3 colorNeg = vec3(0.05, 0.1, 0.4);   // deep blue

  vec3 color;
  if (normalizedP > 0.0) {
    color = mix(colorZero, colorPos, normalizedP);
  } else {
    color = mix(colorZero, colorNeg, -normalizedP);
  }

  // Opacity: nodes (low pressure) are more transparent
  // Anti-nodes (high pressure) are more opaque
  float absP = abs(normalizedP);
  float alpha = 0.05 + 0.6 * absP;

  // Add subtle glow effect near nodes
  float nodeGlow = 1.0 - absP;
  color += vec3(0.0, 0.3, 0.4) * nodeGlow * 0.3;

  // Size modulation: scale point size by pressure
  // (handled in vertex shader via gl_PointSize if using points)

  gl_FragColor = vec4(color, alpha);
}
