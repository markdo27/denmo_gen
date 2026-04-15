import React, { useRef, useMemo, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows, Center, Grid } from '@react-three/drei';
import { Leva, useControls, folder, button } from 'leva';
import * as THREE from 'three';
import { STLExporter } from 'three-stdlib';
import { Download, Lightbulb, Printer, ArrowUpRight } from 'lucide-react';
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
  const { height, bottomRadius, midRadius, topRadius, thickness, verticalProfile, closeTop, closeBottom, solidVaseMode, verticalSegments } = params;
  
  // Calculate segments from physical dimensions (height cm -> mm / layerHeight)
  // Default to 0.2 if undefined to safeguard older states
  const vSegments = verticalSegments || 100;
  
  const outerPoints = [];

  for (let i = 0; i <= vSegments; i++) {
    const t = i / vSegments;
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
        let bambooOffset = params.bambooVerticalFreq > 0 ? Math.sin(evalAngle * params.bambooVerticalFreq) * 1.5 : 0;
        const bamboo = params.bambooDepth > 0 ? Math.pow(Math.abs(Math.cos(evalTwistY * Math.PI * params.bambooSteps + bambooOffset)), 10) * params.bambooDepth : 0;
        
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

function GCodeViewer({ params, customProfileData }) {
  const { geometry } = useMemo(() => {
    const points = [];
    const colors = [];
    
    const segments = Math.round((params.height * 10) / params.layerHeight);
    const rSegments = Math.max(3, params.radialSegments);
    const colorBottom = new THREE.Color(0xd900ff); // Magenta/Purple
    const colorTop = new THREE.Color(0x00ffff); // Cyan
    
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const py = t * params.height;
      let evalT = t;
      if (params.mirrorY && t > 0.5) evalT = 1.0 - t;
      
      let r = params.bottomRadius;
      if (params.verticalProfile === 'vase') {
        const p0 = params.bottomRadius, p1 = params.midRadius, p2 = params.topRadius;
        r = Math.pow(1 - evalT, 2) * p0 + 2 * (1 - evalT) * evalT * p1 + Math.pow(evalT, 2) * p2;
      } else if (params.verticalProfile === 'cone') {
        r = params.bottomRadius * (1 - evalT) + params.topRadius * evalT;
      } else if (params.verticalProfile === 'sphere') {
        r = params.bottomRadius * Math.sin(evalT * Math.PI);
        if (r < 0.05) r = 0.05;
      } else if (params.verticalProfile === 'hourglass') {
        r = params.bottomRadius * Math.max(0.2, 1.0 - Math.min(evalT, 1.0 - evalT) * 1.5);
      } else if (params.verticalProfile === 'teardrop') {
        r = params.bottomRadius * Math.sin(evalT * Math.PI) * Math.exp(-evalT * 2);
      } else if (params.verticalProfile === 'pagoda') {
        const tierEval = (evalT * 4) % 1.0;
        r = params.bottomRadius * (1.0 - evalT) * (1.0 + tierEval * 0.5);
        if (r < 0.05) r = 0.05;
      } else if (params.verticalProfile === 'custom' && customProfileData && customProfileData.length > 0) {
        const dataIndex = Math.min(customProfileData.length - 1, Math.floor(evalT * customProfileData.length));
        r = Math.max(0.01, customProfileData[dataIndex] * params.bottomRadius);
      }

      for (let j = 0; j <= rSegments; j++) {
        const ringT = j / rSegments;
        const spiralY = py + (1.0 / segments) * ringT * params.height;
        
        const twistY = spiralY / params.height;
        let evalTwistY = twistY;
        if (params.mirrorY && twistY > 0.5) evalTwistY = 1.0 - twistY;
        
        let evalAngle = (j / rSegments) * Math.PI * 2;
        let currentR = r;
        
        if (params.crossSection === 'square') currentR *= Math.cos(Math.PI / 4) / Math.max(Math.abs(Math.cos(evalAngle)), Math.abs(Math.sin(evalAngle)));
        else if (params.crossSection === 'hexagon') currentR *= Math.cos(Math.PI/6) / Math.cos(Math.abs((evalAngle % (Math.PI/3) + Math.PI/3) % (Math.PI/3) - Math.PI/6));
        else if (params.crossSection === 'triangle') currentR *= Math.cos(Math.PI/3) / Math.cos(Math.abs((evalAngle % (Math.PI*2/3) + Math.PI*2/3) % (Math.PI*2/3) - Math.PI/3));
        else if (params.crossSection === 'star') currentR *= 1.0 - (Math.sin(evalAngle * 5) * 0.5 + 0.5) * 0.4;
        else if (params.crossSection === 'gear') currentR *= 1.0 + (Math.sign(Math.sin(evalAngle * 12)) * 0.5 + 0.5) * 0.15 - 0.075;
        
        currentR += params.radialRippleDepth > 0 ? Math.sin(evalAngle * params.radialRipples) * params.radialRippleDepth : 0;
        currentR += params.verticalRippleDepth > 0 ? Math.sin(evalTwistY * Math.PI * params.verticalRipples) * params.verticalRippleDepth : 0;
        let bambooOffset = params.bambooVerticalFreq > 0 ? Math.sin(evalAngle * params.bambooVerticalFreq) * 1.5 : 0;
        currentR += params.bambooDepth > 0 ? Math.pow(Math.abs(Math.cos(evalTwistY * Math.PI * params.bambooSteps + bambooOffset)), 10) * params.bambooDepth : 0;
        currentR += params.diamondDepth > 0 ? Math.sin(evalAngle * params.diamondFreq + evalTwistY * Math.PI * params.diamondFreq) * Math.sin(evalAngle * params.diamondFreq - evalTwistY * Math.PI * params.diamondFreq) * params.diamondDepth : 0;
        
        if (params.noiseDepth > 0) currentR += smoothNoise3D(currentR * Math.cos(evalAngle) * params.noiseScale, spiralY * params.noiseScale, currentR * Math.sin(evalAngle) * params.noiseScale) * params.noiseDepth;

        let finalAngle = evalAngle + (evalTwistY * params.twistAngle);
        
        const x = currentR * Math.cos(finalAngle);
        const z = -currentR * Math.sin(finalAngle);
        const y = Math.max(params.layerHeight / 10, spiralY);
        
        points.push(x, y, z);
        
        const lerpColor = colorBottom.clone().lerp(colorTop, spiralY / params.height);
        colors.push(lerpColor.r, lerpColor.g, lerpColor.b);
      }
    }
    
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return { geometry: geo };
  }, [params, customProfileData]);

  return (
    <line geometry={geometry}>
      <lineBasicMaterial vertexColors={true} linewidth={1} />
    </line>
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
    }, { collapsed: true }),
    Resolution: folder({
      verticalSegments: { value: 100, min: 0, max: 800, step: 1, label: 'Vertical Steps' },
      radialSegments: { value: 64, min: 0, max: 200, step: 1, label: 'Radial Steps' },
    }, { collapsed: false }),
    'Print Settings': folder({
      layerHeight: { value: 0.2, min: 0.08, max: 0.8, step: 0.04, label: 'Layer Height (mm)' },
      nozzleSize: { value: 0.4, min: 0.2, max: 1.2, step: 0.1, label: 'Nozzle Size (mm)' },
      bedX: { value: 220, min: 100, max: 500, step: 10, label: 'Bed X Size' },
      bedY: { value: 220, min: 100, max: 500, step: 10, label: 'Bed Y Size' },
    }, { collapsed: true }),
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
      bambooVerticalFreq: { value: 0, min: 0, max: 64, step: 1, label: 'Bamboo Vert' },
      bambooDepth: { value: 0, min: 0, max: 3, step: 0.05, label: 'Bamboo Depth' },
      noiseScale: { value: 2, min: 0.1, max: 10, step: 0.1, label: 'Noise Scale' },
      noiseDepth: { value: 0, min: 0, max: 3, step: 0.05, label: 'Noise Depth' },
    }),
    Shaders: folder({
      innerGlowIntensity: { value: 3.0, min: 0, max: 10, step: 0.1 },
      surfaceNoise: { value: 0.5, min: 0, max: 2, step: 0.05 },
      iridescence: { value: 0.5, min: 0, max: 1, step: 0.05 },
    }, { collapsed: true })
  });

  const styleParams = useControls('Appearance', {
    material: { options: ['matte', 'metallic', 'glass'] },
    color: '#ff6200',
    flatShading: false,
    environment: { options: ['studio', 'city', 'warehouse', 'sunset', 'dawn', 'night'] },
    lightIntensity: { value: 1, min: 0, max: 5, step: 0.1 }
  }, { collapsed: true });

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

  const [viewMode, setViewMode] = useState('3D');

  const generateGCodeString = () => {
    const SCALE = 10; 
    const CX = params.bedX / 2.0;
    const CY = params.bedY / 2.0;

    let gcode = "; FLAVOR:Marlin\n";
    gcode += "; Generated natively by ĐÈNMỜ Generator\n";
    gcode += "; VASE MODE SPIRAL\n";
    gcode += `M104 S200 ; Set Hotend Temp\n`;
    gcode += `M140 S60 ; Set Bed Temp\n`;
    gcode += `M109 S200 ; Wait for Hotend\n`;
    gcode += `M190 S60 ; Wait for Bed\n`;
    gcode += `G28 ; Home\n`;
    gcode += `G90 ; Absolute positioning\n`;
    gcode += `M83 ; Extruder relative\n`;
    gcode += `G1 Z${params.layerHeight.toFixed(3)} F3000\n`;
    
    let lastX = CX, lastY = CY, lastZ = params.layerHeight;
    const segments = Math.round((params.height * 10) / params.layerHeight);
    const rSegments = Math.max(3, params.radialSegments);
    
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const py = t * params.height;
      let evalT = t;
      if (params.mirrorY && t > 0.5) evalT = 1.0 - t;
      
      let r = params.bottomRadius;
      if (params.verticalProfile === 'vase') {
        const p0 = params.bottomRadius, p1 = params.midRadius, p2 = params.topRadius;
        r = Math.pow(1 - evalT, 2) * p0 + 2 * (1 - evalT) * evalT * p1 + Math.pow(evalT, 2) * p2;
      } else if (params.verticalProfile === 'cone') {
        r = params.bottomRadius * (1 - evalT) + params.topRadius * evalT;
      } else if (params.verticalProfile === 'sphere') {
        r = params.bottomRadius * Math.sin(evalT * Math.PI);
        if (r < 0.05) r = 0.05;
      } else if (params.verticalProfile === 'hourglass') {
        r = params.bottomRadius * Math.max(0.2, 1.0 - Math.min(evalT, 1.0 - evalT) * 1.5);
      } else if (params.verticalProfile === 'teardrop') {
        r = params.bottomRadius * Math.sin(evalT * Math.PI) * Math.exp(-evalT * 2);
      } else if (params.verticalProfile === 'pagoda') {
        const tierEval = (evalT * 4) % 1.0;
        r = params.bottomRadius * (1.0 - evalT) * (1.0 + tierEval * 0.5);
        if (r < 0.05) r = 0.05;
      } else if (params.verticalProfile === 'custom' && customProfileData && customProfileData.length > 0) {
        const dataIndex = Math.min(customProfileData.length - 1, Math.floor(evalT * customProfileData.length));
        r = Math.max(0.01, customProfileData[dataIndex] * params.bottomRadius);
      }

      for (let j = 0; j <= rSegments; j++) {
        const ringT = j / rSegments;
        const spiralY = py + (1.0 / segments) * ringT * params.height;
        
        const twistY = spiralY / params.height;
        let evalTwistY = twistY;
        if (params.mirrorY && twistY > 0.5) evalTwistY = 1.0 - twistY;
        
        let evalAngle = (j / rSegments) * Math.PI * 2;
        let currentR = r;
        
        if (params.crossSection === 'square') currentR *= Math.cos(Math.PI / 4) / Math.max(Math.abs(Math.cos(evalAngle)), Math.abs(Math.sin(evalAngle)));
        else if (params.crossSection === 'hexagon') currentR *= Math.cos(Math.PI/6) / Math.cos(Math.abs((evalAngle % (Math.PI/3) + Math.PI/3) % (Math.PI/3) - Math.PI/6));
        else if (params.crossSection === 'triangle') currentR *= Math.cos(Math.PI/3) / Math.cos(Math.abs((evalAngle % (Math.PI*2/3) + Math.PI*2/3) % (Math.PI*2/3) - Math.PI/3));
        else if (params.crossSection === 'star') currentR *= 1.0 - (Math.sin(evalAngle * 5) * 0.5 + 0.5) * 0.4;
        else if (params.crossSection === 'gear') currentR *= 1.0 + (Math.sign(Math.sin(evalAngle * 12)) * 0.5 + 0.5) * 0.15 - 0.075;
        
        currentR += params.radialRippleDepth > 0 ? Math.sin(evalAngle * params.radialRipples) * params.radialRippleDepth : 0;
        currentR += params.verticalRippleDepth > 0 ? Math.sin(evalTwistY * Math.PI * params.verticalRipples) * params.verticalRippleDepth : 0;
        let exportBambooOffset = params.bambooVerticalFreq > 0 ? Math.sin(evalAngle * params.bambooVerticalFreq) * 1.5 : 0;
        currentR += params.bambooDepth > 0 ? Math.pow(Math.abs(Math.cos(evalTwistY * Math.PI * params.bambooSteps + exportBambooOffset)), 10) * params.bambooDepth : 0;
        currentR += params.diamondDepth > 0 ? Math.sin(evalAngle * params.diamondFreq + evalTwistY * Math.PI * params.diamondFreq) * Math.sin(evalAngle * params.diamondFreq - evalTwistY * Math.PI * params.diamondFreq) * params.diamondDepth : 0;
        
        if (params.noiseDepth > 0) currentR += smoothNoise3D(currentR * Math.cos(evalAngle) * params.noiseScale, spiralY * params.noiseScale, currentR * Math.sin(evalAngle) * params.noiseScale) * params.noiseDepth;

        let finalAngle = evalAngle + (evalTwistY * params.twistAngle);
        
        const finalX = CX + currentR * SCALE * Math.cos(finalAngle);
        const finalY = CY + currentR * SCALE * Math.sin(finalAngle);
        const finalZ = Math.max(params.layerHeight, spiralY * SCALE); 
        
        // Volumetric Extrusion Math
        const dist = Math.sqrt(Math.pow(finalX - lastX, 2) + Math.pow(finalY - lastY, 2) + Math.pow(finalZ - lastZ, 2));
        // Extrusion Vol = line_length * layer_height * extrusion_width (nozzle * 1.1)
        const extrudeVol = dist * params.layerHeight * (params.nozzleSize * 1.1);
        // E (length of 1.75mm filament) = Vol / cross-sectional area of filament
        const filamentArea = Math.PI * Math.pow((1.75 / 2.0), 2);
        const extrusion = extrudeVol / filamentArea;

        if (i===0 && j===0) {
          gcode += `G1 X${finalX.toFixed(3)} Y${finalY.toFixed(3)} Z${finalZ.toFixed(3)} F3000\n`;
        } else {
          gcode += `G1 X${finalX.toFixed(3)} Y${finalY.toFixed(3)} Z${finalZ.toFixed(3)} E${extrusion.toFixed(4)} F1500\n`;
        }
        
        lastX = finalX; lastY = finalY; lastZ = finalZ;
      }
    }

    gcode += "G1 Z" + (lastZ + 10.0).toFixed(3) + " F3000 ; lift Z\n";
    gcode += "G28 X Y ; Home X and Y\n";
    gcode += "M104 S0 ; Extruder off\n";
    gcode += "M140 S0 ; Bed off\n";
    gcode += "M84 ; Disable steppers\n";

    return gcode;
  };

  const exportGCode = () => {
    const textCode = generateGCodeString();
    const blob = new Blob([textCode], { type: 'text/plain' });
    const link = document.createElement('a');
    link.style.display = 'none';
    link.href = URL.createObjectURL(blob);
    link.download = `lamp_vase_${Date.now()}.gcode`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
        <div className="app-title">DENMO_PROJECT:</div>
        <div className="app-subtitle">PARAMETRIC 3D LAMP GENERATOR<br/>OR JUST EXPORT TO G-CODE :)</div>
      </div>
      
      <div className="ui-container">
        <button 
          className="export-btn view-toggle-btn"
          onClick={() => setViewMode(viewMode === '3D' ? 'G-CODE' : '3D')}
          aria-label="Toggle View Mode"
        >
          <div className="btn-text">VIEW PORT: [ {viewMode} ]</div>
          <div className="btn-icon-wrapper"><ArrowUpRight size={18} aria-hidden="true" /></div>
        </button>
        <button 
          className="export-btn"
          onClick={() => setIsGlowing(!isGlowing)}
          aria-pressed={isGlowing}
          aria-label="Toggle inner glow simulation"
        >
          <div className="btn-text">SIMULATE GLOW</div>
          <div className="btn-icon-wrapper"><ArrowUpRight size={18} aria-hidden="true" /></div>
        </button>
        <button 
          className="export-btn" 
          onClick={exportSTL}
          aria-label="Export generated lamp shape as STL file"
        >
          <div className="btn-text">STL FILE</div>
          <div className="btn-icon-wrapper"><ArrowUpRight size={18} aria-hidden="true" /></div>
        </button>
        <button 
          className="export-btn" 
          onClick={exportGCode}
          aria-label="Export generated lamp directly as printable G-Code"
        >
          <div className="btn-text">G-CODE</div>
          <div className="btn-icon-wrapper"><ArrowUpRight size={18} aria-hidden="true" /></div>
        </button>
      </div>

      <Leva theme={{
        colors: {
          elevation1: '#000000',
          elevation2: '#111111',
          elevation3: '#222222',
          accent1: '#ffffff',
          accent2: '#d0f0ec',
          accent3: '#d0f0ec',
          highlight1: '#ffffff',
          highlight2: '#a0a0a0',
          highlight3: '#888888',
        },
        radii: { xs: '0', sm: '0', md: '0', lg: '0', xl: '0' },
        fonts: { mono: "'Space Mono', monospace", sans: "'Space Mono', monospace" },
        borderWidths: { folder: '1px', input: '1px', root: '1px', hover: '1px' },
        sizes: { rootWidth: '400px', controlWidth: '200px' }
      }} />

      <div className="footer-container">
        <div className="marquee-wrapper">
          <div className="marquee-content">
            DENMO Project by Line Collective
          </div>
        </div>
        <div className="footer-logo">
           <a href="https://www.facebook.com/mark.do2102/" target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none', marginRight: '16px', display: 'flex', alignItems: 'center', gap: '4px' }}>FACEBOOK <ArrowUpRight size={14}/></a>
           <span>DESIGN & DEV BY US</span> 
           <div style={{width: 12, height: 12, background: 'var(--text-primary)'}}></div>
           <div style={{width: 12, height: 12, background: 'var(--text-secondary)'}}></div>
        </div>
      </div>

      <Canvas 
        shadows 
        camera={{ position: [0, 15, 30], fov: 45 }}
        dpr={[1, 2]}
        aria-label="Interactive 3D Lamp Generator Viewport"
        role="img"
      >
        <color attach="background" args={['#0a0a0a']} />
        
        <Environment preset={isGlowing ? 'park' : 'city'} background={false} />

        <ambientLight intensity={isGlowing ? styleParams.lightIntensity * 0.2 : styleParams.lightIntensity} />
        <directionalLight 
          position={[10, 20, 10]} 
          intensity={isGlowing ? styleParams.lightIntensity * 0.5 : styleParams.lightIntensity * 1.5} 
          castShadow 
          shadow-mapSize={[1024, 1024]}
        />
        
        {viewMode === '3D' ? (
          <>
            <Lamp 
              params={params} 
              customProfileData={customProfileData}
              materialProps={{ color: styleParams.color }} 
              meshRef={meshRef}
              isGlowing={isGlowing}
            />
            <pointLight position={[0, params.height / 2, 0]} intensity={isGlowing ? 4.0 : 2.0} color={isGlowing ? "#fbbf24" : styleParams.color} distance={params.height * 2.5} />
          </>
        ) : (
          <GCodeViewer params={params} customProfileData={customProfileData} />
        )}
        
        <ContactShadows position={[0, -0.01, 0]} opacity={0.8} scale={50} blur={2.5} far={10} color="#000000" />
        
        <Grid 
          infiniteGrid 
          fadeDistance={60} 
          sectionColor="#444444" 
          cellColor="#222222" 
          cellSize={1} 
          sectionSize={5} 
          position={[0, -0.02, 0]} 
        />
        
        <OrbitControls makeDefault minPolarAngle={0} maxPolarAngle={Math.PI / 2 + 0.1} autoRotate={false} target={[0, params.height / 2, 0]} />
      </Canvas>
    </div>
  );
}
