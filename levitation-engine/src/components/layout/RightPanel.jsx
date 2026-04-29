import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { useStore } from '../../store';
import { MODULES } from '../../utils/constants';
import Scene from '../viewport/Scene';

/**
 * Right panel — high-performance Three.js viewport with corner badge overlay.
 */
export default function RightPanel() {
  const activeModule  = useStore((s) => s.activeModule);
  const blueprintMode = useStore((s) => s.blueprintMode);

  const badgeLabel = activeModule === MODULES.TENSEGRITY
    ? 'TENSEGRITY STRUCTURE'
    : 'ACOUSTIC FIELD';

  return (
    <div className="right-panel">
      <Canvas
        camera={{ position: [8, 6, 8], fov: 45, near: 0.1, far: 200 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
        performance={{ min: 0.5 }}
      >
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>

      {/* Corner orientation badges — outside the canvas so they never interfere with 3D */}
      <span className="viewport-badge viewport-badge--tl">{badgeLabel}</span>
      {blueprintMode && (
        <span className="viewport-badge viewport-badge--br">BLUEPRINT MODE</span>
      )}
    </div>
  );
}
