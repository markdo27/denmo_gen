import { useStore } from '../../store';
import { MODULES } from '../../utils/constants';
import { OrbitControls, Environment } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import GridFloor from './GridFloor';
import TensegrityMesh from './TensegrityMesh';
import AcousticField from './AcousticField';

/**
 * Main 3D scene — orchestrates rendering based on active module and viewport settings.
 */
export default function Scene() {
  const activeModule = useStore((s) => s.activeModule);
  const blueprintMode = useStore((s) => s.blueprintMode);

  return (
    <>
      {/* ── Background ── */}
      <color attach="background" args={[blueprintMode ? '#0a1628' : '#0a0a0f']} />
      <fog attach="fog" args={[blueprintMode ? '#0a1628' : '#0a0a0f', 15, 40]} />

      {/* ── Lighting ── */}
      <ambientLight intensity={blueprintMode ? 0.15 : 0.2} />
      <directionalLight
        position={[5, 10, 5]}
        intensity={blueprintMode ? 0.3 : 0.8}
        color={blueprintMode ? '#4488cc' : '#e8e8f0'}
        castShadow
      />
      <pointLight
        position={[-3, 5, -3]}
        intensity={blueprintMode ? 0.1 : 0.4}
        color={blueprintMode ? '#00aaff' : '#ff00aa'}
      />
      <pointLight
        position={[3, 2, 3]}
        intensity={0.2}
        color="#00f0ff"
      />

      {/* ── Grid ── */}
      <GridFloor />

      {/* ── Active Module ── */}
      {activeModule === MODULES.TENSEGRITY && <TensegrityMesh />}
      {activeModule === MODULES.ACOUSTIC && <AcousticField />}

      {/* ── Camera Controls ── */}
      <OrbitControls
        enableDamping
        dampingFactor={0.05}
        minDistance={3}
        maxDistance={30}
        maxPolarAngle={Math.PI * 0.85}
      />

      {/* ── Post-processing (Blueprint glow) ── */}
      {blueprintMode && (
        <EffectComposer>
          <Bloom
            intensity={0.8}
            luminanceThreshold={0.1}
            luminanceSmoothing={0.9}
            mipmapBlur
          />
        </EffectComposer>
      )}
    </>
  );
}
