import { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useStore } from '../../store';
import { generateFieldPositions } from '../../math/acousticWave';
import { validateAcoustic } from '../../math/validation';
// degToRad no longer needed here — the shader receives u_phase in radians
// which is still computed via the uniform (kept below for explicit contract).
import { SPEED_OF_SOUND } from '../../utils/constants';
import BoundingBox from './BoundingBox';

// Import shader sources as strings
import vertexShader from '../../shaders/acousticField.vert?raw';
import fragmentShader from '../../shaders/acousticField.frag?raw';

/**
 * GPU-driven acoustic levitation field visualizer.
 *
 * Uses instanced mesh with custom GLSL shaders for computing
 * standing wave pressure on the GPU — maintains 60FPS during slider drag.
 */
export default function AcousticField() {
  const acoustic = useStore((s) => s.acoustic);
  const blueprintMode = useStore((s) => s.blueprintMode);
  const meshRef = useRef();
  const materialRef = useRef();

  const validation = useMemo(
    () => validateAcoustic(acoustic),
    [acoustic]
  );

  // Generate instance positions when resolution or distance changes
  const { positions, instanceCount } = useMemo(() => {
    if (!validation.valid) {
      return { positions: new Float32Array(0), instanceCount: 0 };
    }
    const res = acoustic.fieldResolution;
    const pos = generateFieldPositions(res, acoustic.transducerDistance);
    return { positions: pos, instanceCount: res * res * res };
  }, [acoustic.fieldResolution, acoustic.transducerDistance, validation.valid]);

  // Create instanced buffer geometry
  const geometry = useMemo(() => {
    const geo = new THREE.SphereGeometry(1, 6, 6);
    return geo;
  }, []);

  // Set instance positions as attribute
  useEffect(() => {
    if (!meshRef.current || instanceCount === 0) return;

    const instancePositionAttr = new THREE.InstancedBufferAttribute(positions, 3);
    meshRef.current.geometry.setAttribute('instancePosition', instancePositionAttr);
    meshRef.current.count = instanceCount;
  }, [positions, instanceCount]);

  // Shader uniforms — created once, mutated every frame in useFrame.
  // All six uniforms are refreshed in useFrame so the object stays in sync
  // even if constants change (e.g. temperature-adjusted speed of sound).
  const uniforms = useMemo(
    () => ({
      u_frequency: { value: acoustic.frequency },
      u_amplitude: { value: acoustic.amplitude },
      u_distance:  { value: acoustic.transducerDistance },
      u_phase:     { value: (acoustic.phaseShift * Math.PI) / 180 },
      u_time:      { value: 0 },
      u_speed:     { value: SPEED_OF_SOUND },
    }),
    [] // Only create once — we update values in useFrame
  );

  // Update uniforms every frame — GPU-side, no geometry recreation.
  // u_speed is included so a future temperature-adjusted value is auto-synced.
  useFrame((state) => {
    if (!materialRef.current) return;
    const mat = materialRef.current;
    mat.uniforms.u_frequency.value = acoustic.frequency;
    mat.uniforms.u_amplitude.value = acoustic.amplitude;
    mat.uniforms.u_distance.value  = acoustic.transducerDistance;
    mat.uniforms.u_phase.value     = (acoustic.phaseShift * Math.PI) / 180;
    mat.uniforms.u_time.value      = state.clock.elapsedTime;  // seconds, no scaling
    mat.uniforms.u_speed.value     = SPEED_OF_SOUND;
  });

  if (!validation.valid || instanceCount === 0) {
    return null;
  }

  return (
    <group>
      {/* ── Instanced pressure field ── */}
      <instancedMesh
        ref={meshRef}
        args={[geometry, null, instanceCount]}
        frustumCulled={false}
      >
        <shaderMaterial
          ref={materialRef}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </instancedMesh>

      {/* ── Transducer plates ── */}
      <TransducerPlate
        position={[0, 0, 0]}
        blueprintMode={blueprintMode}
        label="EMITTER"
      />
      <TransducerPlate
        position={[0, acoustic.transducerDistance, 0]}
        blueprintMode={blueprintMode}
        label="REFLECTOR"
      />

      {/* ── Blueprint bounding box ── */}
      {blueprintMode && (
        <BoundingBox
          size={[5, acoustic.transducerDistance + 0.5, 5]}
          center={[0, acoustic.transducerDistance / 2, 0]}
        />
      )}
    </group>
  );
}

/**
 * Transducer plate — flat disc at top or bottom of the acoustic field.
 */
function TransducerPlate({ position, blueprintMode }) {
  return (
    <mesh position={position} rotation-x={-Math.PI / 2}>
      <circleGeometry args={[2.5, 32]} />
      <meshStandardMaterial
        color={blueprintMode ? '#00aaff' : '#1a1a24'}
        emissive={blueprintMode ? '#00aaff' : '#ff00aa'}
        emissiveIntensity={blueprintMode ? 0.2 : 0.15}
        metalness={0.95}
        roughness={0.05}
        wireframe={blueprintMode}
        transparent
        opacity={blueprintMode ? 0.3 : 0.7}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
