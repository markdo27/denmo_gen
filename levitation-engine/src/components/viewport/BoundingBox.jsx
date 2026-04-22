import { useMemo } from 'react';
import * as THREE from 'three';

/**
 * Wireframe bounding box around a given size.
 * Used in Blueprint Mode to show structure extents.
 */
export default function BoundingBox({ size = [4, 4, 4], center = [0, 2, 0], color = '#00aaff' }) {
  const geometry = useMemo(() => {
    const box = new THREE.BoxGeometry(size[0], size[1], size[2]);
    const edges = new THREE.EdgesGeometry(box);
    return edges;
  }, [size[0], size[1], size[2]]);

  return (
    <lineSegments geometry={geometry} position={center}>
      <lineBasicMaterial color={color} transparent opacity={0.4} />
    </lineSegments>
  );
}
