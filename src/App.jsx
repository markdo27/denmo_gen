import React, { useRef, useMemo, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows, Center } from '@react-three/drei';
import { Leva, useControls, folder, button } from 'leva';
import * as THREE from 'three';
import { STLExporter } from 'three-stdlib';
import { Download, Lightbulb } from 'lucide-react';
import './index.css';

// Smooth pseudo-3D noise function for organic rocky displacements
function smoothNoise3D(x, y, z) {
    let n = Math.sin(x)*Math.sin(y)*Math.sin(z);
    n += Math.sin(x*2.1 + 1.2)*Math.sin(y*2.2 + 0.5)*Math.sin(z*2.3 + 0.8) * 0.5;
    n += Math.sin(x*4.4 + 2.2)*Math.sin(y*4.5 + 1.5)*Math.sin(z*4.6 + 1.8) * 0.25;
    return n;
}

// Procedural Geometry Generator for Lamp
function generateLampPoints(params, customProfileData = []) {
  const { height, bottomRadius, midRadius, topRadius, thickness, verticalSegments, verticalProfile, closeTop, closeBottom, solidVaseMode } = params;
  
  const outerPoints = [];

  for (let i = 0; i <= verticalSegments; i++) {
    const t = i / verticalSegments;
    const y = t * height;
    
    let evalT = t;
    if (params.mirrorY && t > 0.5) {
       evalT = 1.0 - t;
    }
    
    let r = bottomRadius;
    if (verticalProfile === 'vase') {
      const p0 = bottomRadius;
      const p1 = midRadius;
      const p2 = topRadius;
      r = Math.pow(1 - evalT, 2) * p0 + 2 * (1 - evalT) * evalT * p1 + Math.pow(evalT, 2) * p2;
    } else if (verticalProfile === 'custom') {
      if (!customProfileData || customProfileData.length === 0) {
        r = bottomRadius; // fallback
      } else {
        const dataIndex = Math.min(customProfileData.length - 1, Math.floor(evalT * customProfileData.length));
        r = Math.max(0.01, customProfileData[dataIndex] * bottomRadius);
      }
    } else if (verticalProfile === 'column') {
      r = bottomRadius;
    } else if (verticalProfile === 'cone') {
      r = bottomRadius * (1 - evalT) + topRadius * evalT;
    } else if (verticalProfile === 'sphere') {
      r = bottomRadius * Math.sin(evalT * Math.PI);
      if (r < 0.05) r = 0.05; // Prevent normal clipping at pure zero
    } else if (verticalProfile === 'hourglass') {
      const pinch = 1.0 - Math.min(evalT, 1.0 - evalT) * 1.5;
      r = bottomRadius * Math.max(0.2, pinch);
    } else if (verticalProfile === 'teardrop') {
      r = bottomRadius * Math.sin(evalT * Math.PI) * Math.exp(-evalT * 2);
    } else if (verticalProfile === 'pagoda') {
      const tiers = 4;
      const tierEval = (evalT * tiers) % 1.0;
      r = bottomRadius * (1.0 - evalT) * (1.0 + tierEval * 0.5);
      if (r < 0.05) r = 0.05;
    }
    
    outerPoints.push(new THREE.Vector2(r, y));
  }

  const finalPoints = [];

  // Bottom Cap Outer (or solid base)
  if (solidVaseMode || closeBottom) finalPoints.push(new THREE.Vector2(0.0001, 0));

  // Outer Wall
  for (let i = 0; i < outerPoints.length; i++) finalPoints.push(outerPoints[i].clone());

  // Top Cap Outer (or solid ceiling)
  if (solidVaseMode || closeTop) finalPoints.push(new THREE.Vector2(0.0001, height));
  
  if (!solidVaseMode) {
    // Top Cap Inner (Ceiling)
    if (closeTop) finalPoints.push(new THREE.Vector2(0.0001, height - thickness));

    // Inner Wall
    for (let i = outerPoints.length - 1; i >= 0; i--) {
      let p = outerPoints[i];
      let y = p.y;
      
      if (closeTop && y > height - thickness) y = height - thickness;
      if (closeBottom && y < thickness) y = thickness;
      
      let rInner = Math.max(0.0001, p.x - thickness);
      
      let nextPoint = new THREE.Vector2(rInner, y);
      // filter zero-length segments
      if (finalPoints.length > 0) {
        let lastPoint = finalPoints[finalPoints.length - 1];
        if (Math.abs(nextPoint.x - lastPoint.x) < 0.001 && Math.abs(nextPoint.y - lastPoint.y) < 0.001) {
          continue;
        }
      }
      finalPoints.push(nextPoint);
    }

    // Bottom Cap Inner (Floor)
    if (closeBottom) finalPoints.push(new THREE.Vector2(0.0001, thickness));
  }

  // Close Loop
  if (finalPoints.length > 0) {
      finalPoints.push(finalPoints[0].clone());
  }

  return finalPoints;
}

function Lamp({ params, customProfileData, materialProps, meshRef, isGlowing }) {
  const points = useMemo(() => generateLampPoints(params, customProfileData), [params, customProfileData]);
  
  const geometry = useMemo(() => {
    const geo = new THREE.LatheGeometry(points, params.radialSegments, 0, Math.PI * 2);
    
    // We include mirrorX and mirrorZ triggers so they execute even if twist is 0
    if (params.twistAngle !== 0 || params.radialRippleDepth > 0 || params.verticalRippleDepth > 0 || params.bambooDepth > 0 || params.diamondDepth > 0 || params.noiseDepth > 0 || params.crossSection !== 'circle' || params.mirrorX || params.mirrorZ) {
      const positionAttribute = geo.attributes.position;
      const vertex = new THREE.Vector3();
      for (let i = 0; i < positionAttribute.count; i++) {
        vertex.fromBufferAttribute(positionAttribute, i);
        
        const originalAngle = Math.atan2(vertex.z, vertex.x);
        
        let evalAngle = originalAngle;
        if (params.mirrorX && vertex.x < 0) evalAngle = Math.PI - originalAngle;
        if (params.mirrorZ && vertex.z < 0) evalAngle = -evalAngle;

        let r = Math.sqrt(vertex.x * vertex.x + vertex.z * vertex.z);
        
        // 1. Calculate Cross-Section profiling using the eval Angle
        if (params.crossSection === 'square') {
           r *= Math.cos(Math.PI / 4) / Math.max(Math.abs(Math.cos(evalAngle)), Math.abs(Math.sin(evalAngle)));
        } else if (params.crossSection === 'hexagon') {
           const hexAng = Math.PI / 3;
           const wrapped = Math.abs((evalAngle % hexAng + hexAng) % hexAng - hexAng/2);
           r *= Math.cos(hexAng/2) / Math.cos(wrapped);
        } else if (params.crossSection === 'star') {
           r *= 1.0 - (Math.sin(evalAngle * 5) * 0.5 + 0.5) * 0.4;
        } else if (params.crossSection === 'triangle') {
           const triAng = Math.PI * 2 / 3;
           const wrapped = Math.abs((evalAngle % triAng + triAng) % triAng - triAng/2);
           r *= Math.cos(triAng/2) / Math.cos(wrapped);
        } else if (params.crossSection === 'gear') {
           const teethFreq = 12;
           const teethDepth = 0.15;
           r *= 1.0 + (Math.sign(Math.sin(evalAngle * teethFreq)) * 0.5 + 0.5) * teethDepth - (teethDepth/2);
        }

        const twistY = vertex.y / params.height;
        let evalTwistY = twistY;
        if (params.mirrorY && twistY > 0.5) evalTwistY = 1.0 - twistY;

        const radialRipple = params.radialRippleDepth > 0 ? Math.sin(evalAngle * params.radialRipples) * params.radialRippleDepth : 0;
        const verticalRipple = params.verticalRippleDepth > 0 ? Math.sin(evalTwistY * Math.PI * params.verticalRipples) * params.verticalRippleDepth : 0;
        
        // Bamboo Stepping
        const bamboo = params.bambooDepth > 0 ? Math.pow(Math.abs(Math.cos(evalTwistY * Math.PI * params.bambooSteps)), 10) * params.bambooDepth : 0;
        
        // Diamond Knurling
        const diamond = params.diamondDepth > 0 ? Math.sin(evalAngle * params.diamondFreq + evalTwistY * Math.PI * params.diamondFreq) * Math.sin(evalAngle * params.diamondFreq - evalTwistY * Math.PI * params.diamondFreq) * params.diamondDepth : 0;
        
        // Organic Perlin Noise
        let noiseOffset = 0;
        if (params.noiseDepth > 0) {
           noiseOffset = smoothNoise3D(vertex.x * params.noiseScale, vertex.y * params.noiseScale, vertex.z * params.noiseScale) * params.noiseDepth;
        }

        r += radialRipple + verticalRipple + bamboo + diamond + noiseOffset;
        
        // 2. NOW we add the twist rotation to physically twist the generated cross-section
        const twistRotation = evalTwistY * params.twistAngle;
        let finalAngle = evalAngle + twistRotation;

        // Inverse mapping to project symmetry back to absolute space
        if (params.mirrorZ && vertex.z < 0) finalAngle = -finalAngle;
        if (params.mirrorX && vertex.x < 0) finalAngle = Math.PI - finalAngle;
        
        const x = r * Math.cos(finalAngle);
        const z = r * Math.sin(finalAngle);
        
        positionAttribute.setXYZ(i, x, vertex.y, z);
      }
      geo.computeVertexNormals();
    }
    
    return geo;
  }, [points, params.radialSegments, params.twistAngle, params.height, params.radialRipples, params.radialRippleDepth, params.verticalRipples, params.verticalRippleDepth, params.bambooSteps, params.bambooDepth, params.diamondFreq, params.diamondDepth, params.noiseScale, params.noiseDepth, params.crossSection, params.mirrorX, params.mirrorY, params.mirrorZ]);

  const shaderRef = useRef(null);

  useFrame((state) => {
    if (shaderRef.current) {
      shaderRef.current.uniforms.isGlowing.value = isGlowing ? 1.0 : 0.0;
      shaderRef.current.uniforms.innerGlowIntensity.value = params.innerGlowIntensity;
      shaderRef.current.uniforms.surfaceNoise.value = params.surfaceNoise;
      shaderRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    }
  });

  const onBeforeCompile = useMemo(() => (shader) => {
    shaderRef.current = shader;
    
    shader.uniforms.isGlowing = { value: 0.0 };
    shader.uniforms.innerGlowIntensity = { value: 2.0 };
    shader.uniforms.surfaceNoise = { value: 0.5 };
    shader.uniforms.uTime = { value: 0.0 };
    
    shader.vertexShader = `
      varying vec3 vObjPos;
      varying vec3 vObjNormal;
      \n${shader.vertexShader}
    `.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      vObjPos = position;
      vObjNormal = normal;
      `
    );

    const noiseLogic = `
      uniform float isGlowing;
      uniform float innerGlowIntensity;
      uniform float surfaceNoise;
      uniform float uTime;
      varying vec3 vObjPos;
      varying vec3 vObjNormal;
      
      float random(vec2 st) {
          return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
      }
      float noise(vec2 st) {
          vec2 i = floor(st);
          vec2 f = fract(st);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix( mix( random( i + vec2(0.0,0.0) ),
                           random( i + vec2(1.0,0.0) ), u.x),
                      mix( random( i + vec2(0.0,1.0) ),
                           random( i + vec2(1.0,1.0) ), u.x), u.y);
      }
    `;

    shader.fragmentShader = noiseLogic + '\n' + shader.fragmentShader;
    
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `
      #include <dithering_fragment>
      
      // Procedural Surface Noise (Frost/Resin bumps)
      if (surfaceNoise > 0.0) {
        float n = noise(vec2(vObjPos.y * 10.0, atan(vObjPos.z, vObjPos.x) * 10.0) + vec2(0.0, uTime * 0.5));
        gl_FragColor.rgb += vec3(n * 0.15 * surfaceNoise);
      }

      // Identify inner surface vs outer surface
      vec3 outwardVector = vec3(vObjPos.x, 0.0, vObjPos.z);
      if (length(outwardVector) > 0.001) outwardVector = normalize(outwardVector);
      
      float isInnerWall = dot(vObjNormal, outwardVector) < 0.0 ? 1.0 : 0.0;
      
      if (isInnerWall > 0.5 && isGlowing > 0.5) {
        // LED interior emission
        vec3 ledColor = vec3(1.0, 0.8, 0.3) * innerGlowIntensity;
        gl_FragColor = vec4(ledColor, 1.0);
      } else if (isGlowing > 0.5) {
        // Outer wall fresnel rim glow
        vec3 glowViewDir = normalize(-vViewPosition);
        float rim = 1.0 - max(0.0, dot(glowViewDir, normal));
        rim = smoothstep(0.4, 1.0, rim);
        
        vec3 rimColor = vec3(1.0, 0.6, 0.1) * innerGlowIntensity; 
        gl_FragColor = vec4(mix(gl_FragColor.rgb, rimColor, rim), gl_FragColor.a);
      }
      `
    );
  }, []);

  return (
    <mesh 
      ref={meshRef} 
      geometry={geometry} 
      castShadow 
      receiveShadow
    >
      <meshPhysicalMaterial 
        {...materialProps}
        roughness={params.material === 'glass' ? 0.1 : params.material === 'metallic' ? 0.2 : 0.8}
        metalness={params.material === 'metallic' ? 0.8 : 0.0}
        transmission={params.material === 'glass' ? 0.9 : 0.0}
        thickness={1}
        flatShading={params.flatShading}
        iridescence={params.iridescence}
        onBeforeCompile={onBeforeCompile}
      />
    </mesh>
  );
}

export default function App() {
  const [isGlowing, setIsGlowing] = useState(false);
  const meshRef = useRef();
  const [customProfileData, setCustomProfileData] = useState([]);
  
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const img = new Image();
    img.onload = () => {
      const targetHeight = 500; 
      const targetWidth = Math.floor(img.width * (targetHeight / img.height));
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
      const data = ctx.getImageData(0, 0, targetWidth, targetHeight).data;
      
      const profile = [];
      const centerX = targetWidth / 2;
      
      // Determine background color by top-left pixel
      const bgR = data[0], bgG = data[1], bgB = data[2], bgA = data[3];

      for (let y = 0; y < targetHeight; y++) {
        let edgeX = centerX;
        for (let x = targetWidth - 1; x >= centerX; x--) {
          const i = (y * targetWidth + x) * 4;
          const diff = Math.abs(data[i] - bgR) + Math.abs(data[i+1] - bgG) + Math.abs(data[i+2] - bgB) + Math.abs(data[i+3] - bgA);
          if (diff > 50) {
            edgeX = x;
            break;
          }
        }
        const radius = (edgeX - centerX) / centerX;
        profile.push(radius);
      }
      
      setCustomProfileData(profile.reverse());
    };
    img.src = URL.createObjectURL(file);
  };

  const params = useControls('Lamp Shape', {
    Profile: folder({
      verticalProfile: { options: ['vase', 'hourglass', 'teardrop', 'pagoda', 'column', 'cone', 'sphere', 'custom'] },
      customUpload: button(() => {
         const el = document.getElementById('hidden-file-input');
         if(el) el.click();
      }),
      crossSection: { options: ['circle', 'square', 'hexagon', 'triangle', 'star', 'gear'] },
      solidVaseMode: false,
      closeTop: false,
      closeBottom: false,
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
      mirrorX: false,
      mirrorY: false,
      mirrorZ: false,
      twistAngle: { value: 0, min: 0, max: Math.PI * 4, step: 0.1, label: 'Twist' },
      diamondFreq: { value: 0, min: 0, max: 32, step: 1, label: 'Diamond Freq' },
      diamondDepth: { value: 0, min: 0, max: 3, step: 0.05, label: 'Diamond Depth' },
      radialRipples: { value: 0, min: 0, max: 32, step: 1, label: 'Rib Freq' },
      radialRippleDepth: { value: 0, min: 0, max: 3, step: 0.05, label: 'Rib Depth' },
      verticalRipples: { value: 0, min: 0, max: 32, step: 1, label: 'Wave Freq' },
      verticalRippleDepth: { value: 0, min: 0, max: 3, step: 0.05, label: 'Wave Depth' },
      bambooSteps: { value: 0, min: 0, max: 20, step: 1, label: 'Bamboo Steps' },
      bambooDepth: { value: 0, min: 0, max: 3, step: 0.05, label: 'Bamboo Depth' },
      noiseScale: { value: 2, min: 0.1, max: 10, step: 0.1, label: 'Noise Scale' },
      noiseDepth: { value: 0, min: 0, max: 3, step: 0.05, label: 'Noise Depth' },
    }),
    Shaders: folder({
      innerGlowIntensity: { value: 3.0, min: 0, max: 10, step: 0.1 },
      surfaceNoise: { value: 0.5, min: 0, max: 2, step: 0.05 },
      iridescence: { value: 0.5, min: 0, max: 1, step: 0.05 },
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
    <div className="app-container">
      <label htmlFor="hidden-file-input" className="sr-only" style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', borderWidth: 0 }}>Upload custom shape profile</label>
      <input 
        type="file" 
        id="hidden-file-input" 
        style={{ display: 'none' }} 
        accept="image/*" 
        onChange={handleImageUpload} 
        aria-hidden="true"
        tabIndex="-1"
      />
      <div className="title-container">
        <h1 className="app-title">ĐÈNMỜ</h1>
        <div className="app-subtitle">Generator</div>
      </div>
      
      <div className="ui-container">
        <button 
          className="export-btn"
          onClick={() => setIsGlowing(!isGlowing)}
          aria-pressed={isGlowing}
          aria-label="Toggle inner glow simulation"
        >
          <Lightbulb size={18} aria-hidden="true" color={isGlowing ? '#ea580c' : 'currentColor'} />
          {isGlowing ? 'Glow Active' : 'Simulate Glow'}
        </button>
        <button 
          className="export-btn" 
          onClick={exportSTL}
          aria-label="Export generated lamp shape as STL file"
        >
          <Download size={18} aria-hidden="true" />
          Export STL
        </button>
      </div>

      <Leva theme={{
        colors: {
          elevation1: '#1a1a1a',
          elevation2: '#2a2a2a',
          elevation3: '#3a3a3a',
          accent1: '#ff6200',
          accent2: '#ff8800',
          accent3: '#ffaa00',
          highlight1: '#ffffff',
          highlight2: '#aaaaaa',
          highlight3: '#888888',
        }
      }} />

      <Canvas 
        shadows 
        camera={{ position: [0, 15, 30], fov: 45 }}
        dpr={[1, 2]}
        aria-label="Interactive 3D Lamp Generator Viewport"
        role="img"
      >
        <color attach="background" args={['#0a0a0a']} />
        
        {/* Dynamic environment map toggle */}
        <Environment preset={isGlowing ? 'park' : 'city'} background={false} />

        <ambientLight intensity={isGlowing ? styleParams.lightIntensity * 0.2 : styleParams.lightIntensity} />
        <directionalLight 
          position={[10, 20, 10]} 
          intensity={isGlowing ? styleParams.lightIntensity * 0.5 : styleParams.lightIntensity * 1.5} 
          castShadow 
          shadow-mapSize={[1024, 1024]}
        />
        
        <Center>
          <Lamp 
            params={params} 
            customProfileData={customProfileData}
            materialProps={{ color: styleParams.color }} 
            meshRef={meshRef}
            isGlowing={isGlowing}
          />
          {/* Add a light source inside the lamp if it's open top/glass */}
          <pointLight position={[0, params.height / 2, 0]} intensity={isGlowing ? 4.0 : 2.0} color={isGlowing ? "#fbbf24" : styleParams.color} distance={params.height * 2.5} />
        </Center>
        
        <ContactShadows position={[0, -0.01, 0]} opacity={0.8} scale={50} blur={2.5} far={10} color="#000000" />
        
        <OrbitControls makeDefault minPolarAngle={0} maxPolarAngle={Math.PI / 2 + 0.1} autoRotate={false} />
      </Canvas>
    </div>
  );
}
