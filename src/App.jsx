import React, { useRef, useMemo, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows, Center } from '@react-three/drei';
import { Leva, useControls, folder } from 'leva';
import * as THREE from 'three';
import { STLExporter } from 'three-stdlib';
import { Download } from 'lucide-react';
import './index.css';

// Procedural Geometry Generator for Lamp
function generateLampPoints(params) {
  const { height, bottomRadius, midRadius, topRadius, thickness, verticalSegments } = params;
  
  const outerPoints = [];
  const innerPoints = [];

  // Create a profile using a curve
  // Bottom (y=0) to Top (y=height)
  for (let i = 0; i <= verticalSegments; i++) {
    const t = i / verticalSegments;
    const y = t * height;
    
    // Simple interpolation for radius (Quadratic Bezier-like: midRadius is the control point)
    // t varies from 0 to 1
    const p0 = bottomRadius;
    const p1 = midRadius;
    const p2 = topRadius;
    
    const r = Math.pow(1 - t, 2) * p0 + 2 * (1 - t) * t * p1 + Math.pow(t, 2) * p2;
    
    // Add ripples if we want, but let's keep it simple for Lathe
    outerPoints.push(new THREE.Vector2(r, y));
  }

  // Inner profile (offset by thickness inward)
  // For simplicity, we just subtract thickness from X.
  // In reality, normal-based offset is better, but this works for vertical-ish lamps.
  for (let i = verticalSegments; i >= 0; i--) {
    const p = outerPoints[i];
    const rInner = Math.max(0.1, p.x - thickness);
    innerPoints.push(new THREE.Vector2(rInner, p.y));
  }

  // Combine points to create a closed loop for Lathe (outer going up, inner going down)
  return [...outerPoints, ...innerPoints, outerPoints[0].clone()];
}

function Lamp({ params, materialProps, meshRef }) {
  const points = useMemo(() => generateLampPoints(params), [params]);
  
  // Custom Modifiers (Twist, Ripples)
  const geometry = useMemo(() => {
    const geo = new THREE.LatheGeometry(points, params.radialSegments, 0, Math.PI * 2);
    
    if (params.twistAngle > 0 || params.radialRippleDepth > 0 || params.verticalRippleDepth > 0) {
      const positionAttribute = geo.attributes.position;
      const vertex = new THREE.Vector3();
      for (let i = 0; i < positionAttribute.count; i++) {
        vertex.fromBufferAttribute(positionAttribute, i);
        
        // 1. Twist
        let currentAngle = Math.atan2(vertex.z, vertex.x);
        let r = Math.sqrt(vertex.x * vertex.x + vertex.z * vertex.z);
        
        const twistY = vertex.y / params.height;
        const twistRotation = twistY * params.twistAngle;
        currentAngle += twistRotation;
        
        // 2. Ripples
        const radialRipple = params.radialRippleDepth > 0 ? Math.sin(currentAngle * params.radialRipples) * params.radialRippleDepth : 0;
        const verticalRipple = params.verticalRippleDepth > 0 ? Math.sin(twistY * Math.PI * params.verticalRipples) * params.verticalRippleDepth : 0;
        
        r += radialRipple + verticalRipple;
        
        // Re-apply to X/Z
        const x = r * Math.cos(currentAngle);
        const z = r * Math.sin(currentAngle);
        
        positionAttribute.setXYZ(i, x, vertex.y, z);
      }
      geo.computeVertexNormals();
    }
    
    return geo;
  }, [points, params.radialSegments, params.twistAngle, params.height, params.radialRipples, params.radialRippleDepth, params.verticalRipples, params.verticalRippleDepth]);

  return (
    <mesh ref={meshRef} geometry={geometry} castShadow receiveShadow>
      {params.material === 'glass' ? (
        <meshPhysicalMaterial 
          {...materialProps}
          roughness={0.1}
          transmission={0.9}
          thickness={1}
          flatShading={params.flatShading}
        />
      ) : params.material === 'metallic' ? (
        <meshStandardMaterial 
          {...materialProps}
          metalness={0.8}
          roughness={0.2}
          flatShading={params.flatShading}
        />
      ) : (
        <meshStandardMaterial 
          {...materialProps}
          flatShading={params.flatShading}
        />
      )}
    </mesh>
  );
}

export default function App() {
  const meshRef = useRef();

  const params = useControls('Lamp Shape', {
    Profile: folder({
      height: { value: 10, min: 2, max: 30, step: 0.1 },
      bottomRadius: { value: 5, min: 1, max: 15, step: 0.1 },
      midRadius: { value: 3, min: 1, max: 15, step: 0.1 },
      topRadius: { value: 4, min: 1, max: 15, step: 0.1 },
      thickness: { value: 0.5, min: 0.1, max: 2, step: 0.05 },
    }),
    Resolution: folder({
      verticalSegments: { value: 100, min: 5, max: 200, step: 1 },
      radialSegments: { value: 64, min: 3, max: 200, step: 1 },
    }),
    Modifiers: folder({
      twistAngle: { value: 0, min: 0, max: Math.PI * 4, step: 0.1, label: 'Twist' },
      radialRipples: { value: 0, min: 0, max: 32, step: 1, label: 'Rib Freq' },
      radialRippleDepth: { value: 0, min: 0, max: 3, step: 0.05, label: 'Rib Depth' },
      verticalRipples: { value: 0, min: 0, max: 32, step: 1, label: 'Wave Freq' },
      verticalRippleDepth: { value: 0, min: 0, max: 3, step: 0.05, label: 'Wave Depth' },
    })
  });

  const styleParams = useControls('Appearance', {
    material: { options: ['matte', 'metallic', 'glass'] },
    color: '#ff6200',
    flatShading: false,
    environment: { options: ['studio', 'city', 'warehouse', 'sunset', 'dawn', 'night'] },
    lightIntensity: { value: 1, min: 0, max: 5, step: 0.1 }
  });

  const exportSTL = () => {
    if (meshRef.current) {
      const exporter = new STLExporter();
      const stlString = exporter.parse(meshRef.current);
      const blob = new Blob([stlString], { type: 'text/plain' });
      const link = document.createElement('a');
      link.style.display = 'none';
      link.href = URL.createObjectURL(blob);
      link.download = `lamp_${Date.now()}.stl`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <>
      <div className="background-grid" />
      
      <div className="title-container">
        <h1 className="app-title">ĐÈNMỜ</h1>
        <div className="app-subtitle">Generator</div>
      </div>
      
      <div className="ui-container">
        <button className="export-btn" onClick={exportSTL}>
          <Download size={16} />
          Export STL
        </button>
      </div>

      <Leva theme={{
        colors: {
          elevation1: 'rgba(20, 25, 35, 0.7)', 
          elevation2: 'rgba(255, 255, 255, 0.05)', 
          elevation3: 'rgba(255, 255, 255, 0.1)', 
          accent1: '#f59e0b',    
          accent2: '#fbbf24',    
          accent3: '#d97706',    
          highlight1: '#f8fafc', 
          highlight2: '#94a3b8', 
          highlight3: '#ffffff', 
          vivid1: '#10b981',     
        },
        space: {
          rowGap: '4px',
        },
        radii: {
          xs: '4px',
          sm: '6px',
          lg: '10px',
        },
        borderWidths: {
          hover: '1px',
          active: '1px',
        },
        fontWeights: {
          label: '500',
          folder: '600',
        }
      }} />

      <Canvas camera={{ position: [0, 15, 25], fov: 45 }} shadows gl={{ alpha: true }}>
        <ambientLight intensity={styleParams.lightIntensity * 0.5} />
        <spotLight position={[10, 20, 10]} intensity={styleParams.lightIntensity * 2} penumbra={0.5} castShadow shadow-bias={-0.0001} />
        <pointLight position={[-10, -10, -10]} intensity={styleParams.lightIntensity * 0.5} color="#f59e0b" />
        
        <Environment preset={styleParams.environment} />
        
        <Center y={0}>
          <Lamp params={params} materialProps={{ color: styleParams.color }} meshRef={meshRef} />
          {/* Add a light source inside the lamp if it's open top/glass */}
          <pointLight position={[0, params.height / 2, 0]} intensity={2.0} color={styleParams.color} distance={params.height * 2.5} />
        </Center>
        
        <ContactShadows position={[0, -0.01, 0]} opacity={0.8} scale={50} blur={2.5} far={10} color="#000000" />
        
        <OrbitControls makeDefault minPolarAngle={0} maxPolarAngle={Math.PI / 2 + 0.1} autoRotate={false} />
      </Canvas>
    </>
  );
}
