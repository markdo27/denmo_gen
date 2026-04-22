import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import Scene from '../viewport/Scene';

/**
 * Right panel — high-performance Three.js viewport.
 */
export default function RightPanel() {
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
    </div>
  );
}
