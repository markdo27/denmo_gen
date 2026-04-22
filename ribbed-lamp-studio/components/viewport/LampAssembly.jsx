'use client';

import { useMemo } from 'react';
import { useGeometryStore } from '../../lib/store';
import { buildAssemblyGeometries } from '../../lib/geometry/meshBuilder';
import { getTierOffsets } from '../../lib/geometry/stackedAssembly';

export default function LampAssembly() {
  const tiers = useGeometryStore(state => state.tiers);

  const assembly = useMemo(() => {
    return buildAssemblyGeometries(tiers, { verticalSteps: 120 });
  }, [tiers]);

  if (!assembly || assembly.length === 0) return null;

  return (
    <group position={[0, 0, 0]}>
      {assembly.map((part, idx) => (
        <mesh key={`tier-${part.tier.id}`} geometry={part.geometry} position={[0, part.yOffset, 0]}>
          <meshPhysicalMaterial 
            color={idx === assembly.length - 1 ? "#10b981" : "#ffffff"} // Base gets a different color for Moonside effect
            transmission={idx === assembly.length - 1 ? 0 : 0.9} 
            opacity={1}
            metalness={0}
            roughness={0.2}
            ior={1.5}
            thickness={2.0}
            specularIntensity={1.0}
            clearcoat={0.1}
            side={2} // Double side
          />
        </mesh>
      ))}
    </group>
  );
}
