'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import LampAssembly from './LampAssembly';
import LightCore from './LightCore';

export default function Scene() {
  return (
    <div className="w-full h-full bg-neutral-950">
      <Canvas camera={{ position: [200, 200, 200], fov: 45 }}>
        <color attach="background" args={['#0a0a0a']} />
        
        <ambientLight intensity={0.5} />
        <spotLight position={[100, 200, 100]} intensity={1} penumbra={1} castShadow />
        
        <LightCore />
        <LampAssembly />

        <ContactShadows 
          position={[0, 0, 0]} 
          opacity={0.4} 
          scale={300} 
          blur={2} 
          far={50} 
        />
        
        <Environment preset="studio" />
        <OrbitControls makeDefault minDistance={50} maxDistance={500} target={[0, 50, 0]} />

        <EffectComposer disableNormalPass>
          <Bloom luminanceThreshold={1} mipmapBlur intensity={1.5} />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
