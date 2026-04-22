// Acoustic Field Vertex Shader
// Positions instanced spheres in 3D space and passes data to fragment shader

precision highp float;

// Instance attribute: position in the acoustic field
attribute vec3 instancePosition;

// Uniforms
uniform float u_frequency;    // kHz
uniform float u_amplitude;    // 0-1
uniform float u_distance;     // meters between transducer arrays
uniform float u_phase;        // radians
uniform float u_time;         // seconds
uniform float u_speed;        // speed of sound (343 m/s)

// Passed to fragment shader
varying float v_pressure;
varying vec3 v_worldPos;
varying float v_normalizedY;

void main() {
  vec3 pos = position * 0.06 + instancePosition; // Scale down sphere + offset

  // Compute standing wave pressure at this instance position
  float f = u_frequency * 1000.0;
  float k = 6.283185 * f / u_speed;
  float omega = 6.283185 * f;
  float y = instancePosition.y;

  float p1 = u_amplitude * sin(k * y - omega * u_time * 0.001);
  float p2 = u_amplitude * sin(k * (u_distance - y) - omega * u_time * 0.001 + u_phase);
  v_pressure = p1 + p2;

  v_worldPos = instancePosition;
  v_normalizedY = y / max(u_distance, 0.001);

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
