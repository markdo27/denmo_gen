'use client';

import { useGeometryStore } from '../../lib/store';
import { getTotalHeight } from '../../lib/geometry/stackedAssembly';

export default function LightCore() {
  const tiers = useGeometryStore(state => state.tiers);
  const totalHeight = getTotalHeight(tiers);

  // We simulate the warm internal glow typical of these lamps
  return (
    <group>
      <pointLight 
        position={[0, totalHeight * 0.4, 0]} 
        intensity={20000} 
        color="#ffaa00" 
        distance={totalHeight * 2}
        decay={2}
      />
      <pointLight 
        position={[0, totalHeight * 0.7, 0]} 
        intensity={10000} 
        color="#ff7700" 
        distance={totalHeight}
        decay={2}
      />
    </group>
  );
}
