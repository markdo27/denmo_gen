import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useStore } from '../../store';
import { computeTensegrity } from '../../math/tensegrity';
import { validateTensegrity } from '../../math/validation';
import BoundingBox from './BoundingBox';

/**
 * Procedural Tensegrity mesh — generates struts and cables from parametric inputs.
 * All geometry is procedurally computed, no imported models.
 */
export default function TensegrityMesh() {
  const tensegrity = useStore((s) => s.tensegrity);
  const blueprintMode = useStore((s) => s.blueprintMode);

  const validation = useMemo(
    () => validateTensegrity(tensegrity),
    [tensegrity]
  );

  const structure = useMemo(() => {
    if (!validation.valid) return null;
    return computeTensegrity(tensegrity);
  }, [tensegrity, validation.valid]);

  if (!structure) {
    // Render error indicator — pulsing red wireframe sphere
    return (
      <group position={[0, 2, 0]}>
        <mesh>
          <icosahedronGeometry args={[1.5, 1]} />
          <meshBasicMaterial color="#ff3344" wireframe transparent opacity={0.3} />
        </mesh>
      </group>
    );
  }

  const {
    bottomNodes,
    topNodes,
    struts,
    topCables,
    bottomCables,
    crossCables,
    height,
  } = structure;

  return (
    <group>
      {/* ── Struts (compression members) ── */}
      {struts.map((strut, i) => (
        <Strut
          key={`strut-${i}`}
          start={strut.start}
          end={strut.end}
          blueprintMode={blueprintMode}
        />
      ))}

      {/* ── Nodes (bottom) ── */}
      {bottomNodes.map((pos, i) => (
        <mesh key={`bn-${i}`} position={pos}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshStandardMaterial
            color={blueprintMode ? '#00aaff' : '#e8e8f0'}
            emissive={blueprintMode ? '#00aaff' : '#333344'}
            emissiveIntensity={blueprintMode ? 0.5 : 0.1}
            metalness={0.8}
            roughness={0.2}
          />
        </mesh>
      ))}

      {/* ── Nodes (top) ── */}
      {topNodes.map((pos, i) => (
        <mesh key={`tn-${i}`} position={pos}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshStandardMaterial
            color={blueprintMode ? '#00aaff' : '#e8e8f0'}
            emissive={blueprintMode ? '#00aaff' : '#333344'}
            emissiveIntensity={blueprintMode ? 0.5 : 0.1}
            metalness={0.8}
            roughness={0.2}
          />
        </mesh>
      ))}

      {/* ── Top cables (tension ring) ── */}
      {topCables.map((cable, i) => (
        <Cable
          key={`tc-${i}`}
          start={cable.start}
          end={cable.end}
          color={blueprintMode ? '#00aaff' : '#00f0ff'}
        />
      ))}

      {/* ── Bottom cables (tension ring) ── */}
      {bottomCables.map((cable, i) => (
        <Cable
          key={`bc-${i}`}
          start={cable.start}
          end={cable.end}
          color={blueprintMode ? '#00aaff' : '#00f0ff'}
        />
      ))}

      {/* ── Cross cables (diagonal tension) ── */}
      {crossCables.map((cable, i) => (
        <Cable
          key={`cc-${i}`}
          start={cable.start}
          end={cable.end}
          color={blueprintMode ? '#4488cc' : '#ffaa00'}
        />
      ))}

      {/* ── Blueprint bounding box ── */}
      {blueprintMode && (
        <BoundingBox
          size={[
            Math.max(tensegrity.baseRadius, tensegrity.topRadius) * 2 + 0.5,
            height + 0.5,
            Math.max(tensegrity.baseRadius, tensegrity.topRadius) * 2 + 0.5,
          ]}
          center={[0, height / 2, 0]}
        />
      )}
    </group>
  );
}

/**
 * Single strut — cylinder oriented between two 3D points.
 */
function Strut({ start, end, blueprintMode }) {
  const mesh = useRef();

  const { position, quaternion, length } = useMemo(() => {
    const s = new THREE.Vector3(...start);
    const e = new THREE.Vector3(...end);
    const mid = new THREE.Vector3().addVectors(s, e).multiplyScalar(0.5);
    const dir = new THREE.Vector3().subVectors(e, s);
    const len = dir.length();
    dir.normalize();

    const quat = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    quat.setFromUnitVectors(up, dir);

    return { position: mid, quaternion: quat, length: len };
  }, [start, end]);

  return (
    <mesh ref={mesh} position={position} quaternion={quaternion}>
      <cylinderGeometry args={[0.04, 0.04, length, 8]} />
      <meshStandardMaterial
        color={blueprintMode ? '#00aaff' : '#c0c0d0'}
        emissive={blueprintMode ? '#00aaff' : '#1a1a2a'}
        emissiveIntensity={blueprintMode ? 0.3 : 0.05}
        metalness={0.9}
        roughness={0.1}
        wireframe={blueprintMode}
      />
    </mesh>
  );
}

/**
 * Single cable — thin line between two points.
 */
function Cable({ start, end, color }) {
  const points = useMemo(
    () => [new THREE.Vector3(...start), new THREE.Vector3(...end)],
    [start, end]
  );

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    return geo;
  }, [points]);

  return (
    <line geometry={geometry}>
      <lineBasicMaterial color={color} transparent opacity={0.8} linewidth={1} />
    </line>
  );
}
