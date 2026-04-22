import { useRef } from 'react';
import { useStore } from '../../store';

/**
 * Reference grid floor with measurement marks.
 * Adapts appearance for Blueprint Mode.
 */
export default function GridFloor() {
  const blueprintMode = useStore((s) => s.blueprintMode);

  return (
    <group>
      {/* Main grid */}
      <gridHelper
        args={[
          20,                                                   // size
          20,                                                   // divisions
          blueprintMode ? '#1a3050' : '#1a1a2a',               // center color
          blueprintMode ? '#0d1f35' : '#111120',               // grid color
        ]}
        position={[0, -0.01, 0]}
      />

      {/* Fine subdivision grid */}
      <gridHelper
        args={[
          20,
          80,
          'transparent',
          blueprintMode ? '#0f1825' : '#0d0d18',
        ]}
        position={[0, -0.02, 0]}
      />

      {/* Ground plane for shadow catching */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.03, 0]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial
          color={blueprintMode ? '#0a1628' : '#0a0a10'}
          transparent
          opacity={0.8}
        />
      </mesh>
    </group>
  );
}
