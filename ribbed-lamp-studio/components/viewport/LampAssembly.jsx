'use client';

import { useMemo } from 'react';
import { useGeometryStore } from '../../lib/store';
import { buildTierGeometry } from '../../lib/geometry/meshBuilder';
import { buildLighterHoleForTier } from '../../lib/geometry/lighterHole';

export default function LampAssembly() {
  const tiers = useGeometryStore(state => state.tiers);

  const assembly = useMemo(() => {
    const enabled = tiers.filter(t => t.enabled);
    if (enabled.length === 0) return [];

    let y = 0;
    const sorted = [...tiers]
      .map((t, i) => ({ ...t, origIndex: i }))
      .filter(t => t.enabled)
      .sort((a, b) => b.id - a.id);

    return sorted.map(tier => {
      const yOffset = y;
      y += tier.height;

      const tierGeo = buildTierGeometry(tier, 120);

      // Build lighter cavity if enabled
      let cavityGeo = null;
      if (tier.lighterHole?.enabled) {
        const { cavityGeometry } = buildLighterHoleForTier({
          preset:          tier.lighterHole.preset || 'standard',
          tolerance:       tier.lighterHole.tolerance ?? 0.4,
          tierHeight:      tier.height,
          bottomThickness: tier.lighterHole.bottomThickness ?? 2.5,
          verticalSteps:   32,
        });
        cavityGeo = cavityGeometry;
      }

      return { tierGeo, cavityGeo, yOffset, tier };
    });
  }, [tiers]);

  if (!assembly || assembly.length === 0) return null;

  return (
    <group position={[0, 0, 0]}>
      {assembly.map((part, idx) => (
        <group key={`tier-${part.tier.id}`} position={[0, part.yOffset, 0]}>
          {/* Outer shell */}
          <mesh geometry={part.tierGeo}>
            <meshPhysicalMaterial 
              color={idx === assembly.length - 1 ? "#10b981" : "#ffffff"}
              transmission={idx === assembly.length - 1 ? 0 : 0.9} 
              opacity={1}
              metalness={0}
              roughness={0.2}
              ior={1.5}
              thickness={2.0}
              specularIntensity={1.0}
              clearcoat={0.1}
              side={2}
            />
          </mesh>

          {/* Lighter cavity preview */}
          {part.cavityGeo && (
            <mesh geometry={part.cavityGeo}>
              <meshPhysicalMaterial
                color="#f59e0b"
                transparent
                opacity={0.35}
                metalness={0}
                roughness={0.8}
                side={2}
                depthWrite={false}
              />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}
