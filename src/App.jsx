import React, { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows, Grid } from '@react-three/drei';
import { Leva, useControls, folder, button } from 'leva';
import * as THREE from 'three';
import { STLExporter } from 'three-stdlib';
import { AlertTriangle, CheckCircle, XCircle, Layers, Grid3x3, Download, Upload } from 'lucide-react';
import { getProfileRadius, getSmoothedProfileRadius, applyRadiusModifiers } from './lampMath.js';
import { buildLighterCavityGeometry, roundedRectProfile, BIC_PRESETS } from '../ribbed-lamp-studio/lib/geometry/lighterHole.js';
import { loopSubdivide } from './algorithms/subdivision.js';
import { computeVoronoi } from './algorithms/voronoi.js';
import { analyzeOverhangs, OVERHANG_SAFE, OVERHANG_CAUTION } from './overhangAnalyzer.js';
import {
  SUPERFORMULA_PRESETS,
  SUPERFORMULA_MODIFIER_PRESETS,
  HARMONIC_PRESETS,
  HARMONIC_MODIFIER_PRESETS,
  SUPER_ELLIPSOID_PRESETS,
} from './algorithms/superShapePresets.js';
import './index.css';

// ============================================================================
// LAMP PROFILE — 2D revolution points for LatheGeometry
// ============================================================================
function generateLampPoints(params, customProfileData) {
  const { height, thickness, closeTop, closeBottom, solidVaseMode, mirrorY, lighterHoleEnabled } = params;
  const vSegments = params.verticalSegments || 100;
  const outerPoints = [];

  for (let i = 0; i <= vSegments; i++) {
    const t     = i / vSegments;
    const evalT = mirrorY && t > 0.5 ? 1.0 - t : t;
    outerPoints.push(new THREE.Vector2(getSmoothedProfileRadius(evalT, params, customProfileData), t * height));
  }

  // When lighter hole is enabled: solid body with OPEN top (lighter goes in from top)
  // The LighterCavityMesh provides the top annular cap with the hole
  const isSolidCup = lighterHoleEnabled;

  const finalPoints = [];
  if (solidVaseMode || closeBottom || isSolidCup) finalPoints.push(new THREE.Vector2(0, 0));
  for (const p of outerPoints) finalPoints.push(p.clone());
  // Skip top cap when lighter hole is enabled — the top must stay open
  if (!isSolidCup && (solidVaseMode || closeTop)) finalPoints.push(new THREE.Vector2(0, height));

  // Skip inner wall when solid vase mode OR lighter case mode
  if (!solidVaseMode && !isSolidCup) {
    if (closeTop) finalPoints.push(new THREE.Vector2(0, height - thickness));
    for (let i = outerPoints.length - 1; i >= 0; i--) {
      const p     = outerPoints[i];
      let   y     = p.y;
      if (closeTop    && y > height - thickness) y = height - thickness;
      if (closeBottom && y < thickness)          y = thickness;
      const rInner = Math.max(0, p.x - thickness);
      const next   = new THREE.Vector2(rInner, y);
      if (finalPoints.length > 0) {
        const last = finalPoints[finalPoints.length - 1];
        if (Math.abs(next.x - last.x) < 0.001 && Math.abs(next.y - last.y) < 0.001) continue;
      }
      finalPoints.push(next);
    }
    if (closeBottom) finalPoints.push(new THREE.Vector2(0, thickness));
  }

  if (finalPoints.length > 0) finalPoints.push(finalPoints[0].clone());
  return finalPoints;
}

// ============================================================================
// LAMP 3-D MESH
// ============================================================================
function Lamp({ params, customProfileData, materialProps, meshRef, isGlowing, rdMap, voronoiMap, wireframe }) {
  // ── 2D profile (cheap, only profile-shape deps) ──────────────────────────
  const points = useMemo(() => generateLampPoints(params, customProfileData), [
    params.height, params.bottomRadius, params.midRadius, params.topRadius,
    params.thickness, params.verticalProfile, params.solidVaseMode,
    params.closeTop, params.closeBottom, params.mirrorY,
    params.verticalSegments, params.profileSmoothing, customProfileData,
    params.lighterHoleEnabled,
    // SuperShape profile deps
    params.sfProfile, params.shProfile, params.seN, params.seE,
  ]);

  // ── Modified geometry (all surface-modifier deps) ────────────────────────
  const geometry = useMemo(() => {
    const geo = new THREE.LatheGeometry(points, params.radialSegments, 0, Math.PI * 2);

    const needsPass =
      params.twistAngle !== 0       ||
      params.verticalRippleDepth > 0 ||
      params.ribDepth > 0           || params.pedestalDepth > 0        ||
      params.bambooDepth > 0        || params.diamondDepth > 0         ||
      params.noiseDepth > 0         || params.rdDepth > 0              ||
      params.voronoiDepth > 0       || params.crossSection !== 'circle'||
      params.superFormulaDepth > 0  || params.harmonicDepth > 0        ||
      params.mirrorX || params.mirrorY || params.mirrorZ;

    if (needsPass) {
      const posAttr = geo.attributes.position;
      const vtx     = new THREE.Vector3();
      const CAP_R_THRESH = 0.01;

      for (let i = 0; i < posAttr.count; i++) {
        vtx.fromBufferAttribute(posAttr, i);

        const baseR = Math.sqrt(vtx.x * vtx.x + vtx.z * vtx.z);

        // ── Skip cap-center vertices: keep them on the exact center axis ──
        if (baseR < CAP_R_THRESH) {
          posAttr.setXYZ(i, 0, vtx.y, 0);
          continue;
        }

        // Raw cylindrical angle — applyRadiusModifiers handles all mirror folding
        const rawAngle   = Math.atan2(vtx.z, vtx.x);
        const twistYNorm = vtx.y / params.height;

        const r = applyRadiusModifiers(rawAngle, twistYNorm, vtx.y, baseR, params, rdMap, voronoiMap);

        // Twist is applied to the original angle (not the folded sample angle)
        const sampleTwistY = (params.mirrorY && twistYNorm > 0.5) ? 1.0 - twistYNorm : twistYNorm;
        const finalAngle   = rawAngle + sampleTwistY * params.twistAngle;

        posAttr.setXYZ(i, r * Math.cos(finalAngle), vtx.y, r * Math.sin(finalAngle));
      }
      geo.computeVertexNormals();
    }

    // ── Cap closure pass (runs always, outside needsPass) ────────────────
    // Ensures cap center vertices converge to exact axis and caps are flat.
    if (params.closeBottom || params.closeTop || params.solidVaseMode) {
      const posAttr = geo.attributes.position;
      const rSeg    = params.radialSegments + 1;  // verts per ring in LatheGeometry

      // Force ALL center-axis ring vertices to (0, y, 0).
      // These come from profile points with r=0.
      for (let i = 0; i < posAttr.count; i++) {
        const x = posAttr.getX(i);
        const z = posAttr.getZ(i);
        const r = Math.sqrt(x * x + z * z);
        if (r < 0.01) {
          posAttr.setXYZ(i, 0, posAttr.getY(i), 0);
        }
      }
      posAttr.needsUpdate = true;
      geo.computeVertexNormals();
    }

    // ── Subdivision surface pass ──────────────────────────────────────────
    const subdivLevel = params.subdivisionLevel || 0;
    if (subdivLevel > 0) {
      const hasCaps = params.closeBottom || params.closeTop || params.solidVaseMode;

      // Ensure indexed geometry
      const srcGeo = geo.index ? geo : geo.toNonIndexed();
      const srcPos = new Float32Array(srcGeo.attributes.position.array);
      let srcIdx;
      if (srcGeo.index) {
        srcIdx = new Uint32Array(srcGeo.index.array);
      } else {
        srcIdx = new Uint32Array(srcPos.length / 3);
        for (let k = 0; k < srcIdx.length; k++) srcIdx[k] = k;
      }

      if (!hasCaps) {
        // No caps — subdivide everything
        const subdiv = loopSubdivide(srcPos, srcIdx, subdivLevel);
        geo.dispose();
        const subdivGeo = new THREE.BufferGeometry();
        subdivGeo.setAttribute('position', new THREE.Float32BufferAttribute(subdiv.positions, 3));
        subdivGeo.setIndex(new THREE.Uint32BufferAttribute(subdiv.indices, 1));
        subdivGeo.computeVertexNormals();
        return subdivGeo;
      }

      // ── Separate cap faces from wall faces ──────────────────────────────
      // Cap face = any triangle with at least one vertex at r < threshold
      const CAP_AXIS_R = 0.01;
      const wallFaceIndices = [];
      const capFaceIndices  = [];
      const triCount = srcIdx.length / 3;

      for (let f = 0; f < triCount; f++) {
        const i0 = srcIdx[f * 3], i1 = srcIdx[f * 3 + 1], i2 = srcIdx[f * 3 + 2];
        const r0 = Math.sqrt(srcPos[i0*3]*srcPos[i0*3] + srcPos[i0*3+2]*srcPos[i0*3+2]);
        const r1 = Math.sqrt(srcPos[i1*3]*srcPos[i1*3] + srcPos[i1*3+2]*srcPos[i1*3+2]);
        const r2 = Math.sqrt(srcPos[i2*3]*srcPos[i2*3] + srcPos[i2*3+2]*srcPos[i2*3+2]);

        if (r0 < CAP_AXIS_R || r1 < CAP_AXIS_R || r2 < CAP_AXIS_R) {
          capFaceIndices.push(i0, i1, i2);
        } else {
          wallFaceIndices.push(i0, i1, i2);
        }
      }

      // ── Subdivide only wall faces ───────────────────────────────────────
      // Remap wall vertices to a compact array
      const wallVertMap = new Map(); // old index → new index
      let nextWallIdx = 0;
      for (const vi of wallFaceIndices) {
        if (!wallVertMap.has(vi)) wallVertMap.set(vi, nextWallIdx++);
      }

      const wallPos = new Float32Array(wallVertMap.size * 3);
      for (const [oldIdx, newIdx] of wallVertMap) {
        wallPos[newIdx * 3]     = srcPos[oldIdx * 3];
        wallPos[newIdx * 3 + 1] = srcPos[oldIdx * 3 + 1];
        wallPos[newIdx * 3 + 2] = srcPos[oldIdx * 3 + 2];
      }
      const wallIdx = new Uint32Array(wallFaceIndices.map(vi => wallVertMap.get(vi)));

      const subdiv = loopSubdivide(wallPos, wallIdx, subdivLevel);

      // ── Merge subdivided wall + original caps ───────────────────────────
      const finalVertCount = subdiv.positions.length / 3 + srcPos.length / 3;
      const finalPos = new Float32Array(subdiv.positions.length + srcPos.length);
      finalPos.set(subdiv.positions, 0);
      // Append original positions (for cap faces)
      finalPos.set(srcPos, subdiv.positions.length);

      const capOffset = subdiv.positions.length / 3;  // vertex index offset for cap verts
      const finalIdx = new Uint32Array(subdiv.indices.length + capFaceIndices.length);
      finalIdx.set(subdiv.indices, 0);
      // Remap cap face indices to offset into merged position array
      for (let c = 0; c < capFaceIndices.length; c++) {
        finalIdx[subdiv.indices.length + c] = capFaceIndices[c] + capOffset;
      }

      geo.dispose();
      const finalGeo = new THREE.BufferGeometry();
      finalGeo.setAttribute('position', new THREE.Float32BufferAttribute(finalPos, 3));
      finalGeo.setIndex(new THREE.Uint32BufferAttribute(finalIdx, 1));
      finalGeo.computeVertexNormals();
      return finalGeo;
    }

    return geo;
  }, [
    points,
    params.radialSegments, params.twistAngle, params.height,
    params.ribFreq, params.ribDepth, params.ribProfile, params.ribTension, params.ribPhase,
    params.pedestalRatio, params.pedestalRibs, params.pedestalDepth, params.pedestalProfile,
    params.verticalRipples, params.verticalRippleDepth,
    params.bambooSteps, params.bambooDepth, params.bambooVerticalFreq,
    params.diamondFreq, params.diamondDepth,
    params.noiseScale, params.noiseDepth,
    params.rdDepth, params.voronoiDepth,
    params.superFormulaDepth, params.harmonicDepth,
    params.sfModifier, params.shModifier,
    params.crossSection, params.mirrorX, params.mirrorY, params.mirrorZ,
    params.subdivisionLevel,
    rdMap, voronoiMap,
  ]);

  // ── Shader — inner-glow + surface frost ─────────────────────────────────
  const shaderRef = useRef(null);

  useFrame((state) => {
    if (shaderRef.current) {
      shaderRef.current.uniforms.isGlowing.value        = isGlowing ? 1.0 : 0.0;
      shaderRef.current.uniforms.innerGlowIntensity.value = params.innerGlowIntensity;
      shaderRef.current.uniforms.surfaceNoise.value       = params.surfaceNoise;
      shaderRef.current.uniforms.uTime.value              = state.clock.elapsedTime;
    }
  });

  const onBeforeCompile = useMemo(() => (shader) => {
    shaderRef.current = shader;
    shader.uniforms.isGlowing           = { value: 0.0 };
    shader.uniforms.innerGlowIntensity  = { value: 2.0 };
    shader.uniforms.surfaceNoise        = { value: 0.5 };
    shader.uniforms.uTime               = { value: 0.0 };

    shader.vertexShader = `
      varying vec3 vObjPos;
      varying vec3 vObjNormal;
      \n${shader.vertexShader}
    `.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vObjPos    = position;
      vObjNormal = normal;
    `);

    const noiseGLSL = `
      uniform float isGlowing;
      uniform float innerGlowIntensity;
      uniform float surfaceNoise;
      uniform float uTime;
      varying vec3 vObjPos;
      varying vec3 vObjNormal;

      float random(vec2 st) {
          return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
      }
      float noise(vec2 st) {
          vec2 i = floor(st);
          vec2 f = fract(st);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(random(i + vec2(0.0, 0.0)), random(i + vec2(1.0, 0.0)), u.x),
                     mix(random(i + vec2(0.0, 1.0)), random(i + vec2(1.0, 1.0)), u.x), u.y);
      }
    `;

    shader.fragmentShader = noiseGLSL + '\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `
      #include <dithering_fragment>

      if (surfaceNoise > 0.0) {
        float n = noise(vec2(vObjPos.y * 10.0, atan(vObjPos.z, vObjPos.x) * 10.0) + vec2(0.0, uTime * 0.5));
        gl_FragColor.rgb += vec3(n * 0.15 * surfaceNoise);
      }

      vec3 outward = vec3(vObjPos.x, 0.0, vObjPos.z);
      if (length(outward) > 0.001) outward = normalize(outward);
      float isInner = dot(vObjNormal, outward) < 0.0 ? 1.0 : 0.0;

      if (isInner > 0.5 && isGlowing > 0.5) {
        gl_FragColor = vec4(vec3(1.0, 0.8, 0.3) * innerGlowIntensity, 1.0);
      } else if (isGlowing > 0.5) {
        vec3 gvd = normalize(-vViewPosition);
        float rim = smoothstep(0.4, 1.0, 1.0 - max(0.0, dot(gvd, normal)));
        gl_FragColor = vec4(mix(gl_FragColor.rgb, vec3(1.0, 0.6, 0.1) * innerGlowIntensity, rim), gl_FragColor.a);
      }
      `
    );
  }, []);

  return (
    <mesh ref={meshRef} geometry={geometry} castShadow receiveShadow>
      {wireframe ? (
        // Wireframe mode: ghost base (edges rendered separately outside this component)
        <meshBasicMaterial color="#060d09" transparent opacity={0.10} side={THREE.DoubleSide} depthWrite={false} />
      ) : (
        <meshPhysicalMaterial
          {...materialProps}
          side={THREE.DoubleSide}
          thickness={1}
          iridescence={params.iridescence}
          onBeforeCompile={onBeforeCompile}
        />
      )}
    </mesh>
  );
}

// ============================================================================
// RETOPOLOGY WIREFRAME MESH  (separate canvas component for retopo preview)
// ============================================================================
function RetopologyWireframeMesh({ positions, indices, color = '#00ff88', opacity = 0.9 }) {
  const geo = useMemo(() => {
    if (!positions || !indices) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
    return g;
  }, [positions, indices]);

  if (!geo) return null;
  return (
    <lineSegments>
      <edgesGeometry attach="geometry" args={[geo]} />
      <lineBasicMaterial attach="material" color={color} transparent opacity={opacity} />
    </lineSegments>
  );
}

// ============================================================================
// RAW LAMP WIREFRAME  (fallback / loading state wireframe using live geometry)
// ============================================================================
function RawLampWireframe({ params, customProfileData, color = '#00ff88', opacity = 0.85 }) {
  const geo = useMemo(() => {
    return new THREE.LatheGeometry(
      generateLampPoints(params, customProfileData),
      params.radialSegments, 0, Math.PI * 2
    );
  }, [
    params.height, params.bottomRadius, params.midRadius, params.topRadius,
    params.thickness, params.verticalProfile, params.solidVaseMode,
    params.closeTop, params.closeBottom, params.mirrorY,
    params.verticalSegments, params.radialSegments, customProfileData,
  ]);

  return (
    <lineSegments>
      <edgesGeometry attach="geometry" args={[geo]} />
      <lineBasicMaterial attach="material" color={color} transparent opacity={opacity} />
    </lineSegments>
  );
}

// ============================================================================
// LIGHTER CAVITY MESH  (cavity walls + top annular cap for print-ready case)
// The top cap outer ring uses applyRadiusModifiers so it matches the actual
// lamp cross-section shape (square, hex, circle, star, etc.)
// ============================================================================
function LighterCavityMesh({ params, rdMap, voronoiMap }) {
  const {
    lighterHoleEnabled, lighterHolePreset, lighterHoleTolerance,
    lighterHoleFloor, height, topRadius,
  } = params;

  const geometry = useMemo(() => {
    if (!lighterHoleEnabled) return null;
    const dims = BIC_PRESETS[lighterHolePreset] || BIC_PRESETS.standard;
    const cavityDepth = Math.min(
      dims.bodyHeight - dims.topExposed,
      height * 10 - lighterHoleFloor
    );
    if (cavityDepth <= 0) return null;

    // Cavity dimensions in mm
    const cavW = dims.bodyWidth  + lighterHoleTolerance * 2;
    const cavD = dims.bodyDepth  + lighterHoleTolerance * 2;
    const cavR = dims.cornerRadius + lighterHoleTolerance;

    const scale = 0.1; // mm → cm
    const floorY = lighterHoleFloor * scale;
    const topY   = height; // cm

    // Rounded-rect cavity profile
    const cavProfile = roundedRectProfile({
      width: cavW, depth: cavD, cornerRadius: cavR, segments: 8,
    });
    const N = cavProfile.length;

    const positions = [];
    const indices   = [];
    const vertSteps = 32;

    // ── 1. Cavity inner walls (from floorY up to topY) ──────────────────
    for (let row = 0; row <= vertSteps; row++) {
      const y = floorY + (row / vertSteps) * (topY - floorY);
      for (let p = 0; p < N; p++) {
        positions.push(cavProfile[p].x * scale, y, cavProfile[p].z * scale);
      }
    }
    for (let row = 0; row < vertSteps; row++) {
      for (let p = 0; p < N; p++) {
        const next = (p + 1) % N;
        const a = row * N + p;
        const b = row * N + next;
        const c = (row + 1) * N + p;
        const d = (row + 1) * N + next;
        indices.push(a, d, b, a, c, d);
      }
    }

    // ── 2. Cavity floor (at y = floorY) ─────────────────────────────────
    const floorBase = positions.length / 3;
    positions.push(0, floorY, 0);
    for (let p = 0; p < N; p++) {
      positions.push(cavProfile[p].x * scale, floorY, cavProfile[p].z * scale);
    }
    for (let p = 0; p < N; p++) {
      const next = (p + 1) % N;
      indices.push(floorBase, floorBase + 1 + next, floorBase + 1 + p);
    }

    // ── 3. Top annular cap ──────────────────────────────────────────────
    // Sample the ACTUAL lamp outer edge at y=height using applyRadiusModifiers
    // This ensures the cap matches the cross-section shape (square, hex, etc.)
    const radialSegs = params.radialSegments || 48;
    const lipBase = positions.length / 3;
    const twistYNorm = 1.0; // top of lamp

    // Outer ring: computed from the lamp's modifier pipeline
    for (let i = 0; i < radialSegs; i++) {
      const angle = (i / radialSegs) * Math.PI * 2;
      const baseR = topRadius; // base radius at the top
      const r = applyRadiusModifiers(angle, twistYNorm, height, baseR, params, rdMap, voronoiMap);

      // Apply twist (same logic as in Lamp component)
      const sampleTwistY = (params.mirrorY && twistYNorm > 0.5) ? 1.0 - twistYNorm : twistYNorm;
      const finalAngle = angle + sampleTwistY * (params.twistAngle || 0);

      positions.push(
        r * Math.cos(finalAngle),
        topY,
        r * Math.sin(finalAngle),
      );
    }

    // Inner ring: lighter cavity at top
    for (let p = 0; p < N; p++) {
      positions.push(cavProfile[p].x * scale, topY, cavProfile[p].z * scale);
    }

    const outerStart = lipBase;
    const innerStart = lipBase + radialSegs;

    // Stitch outer ring to inner rect
    for (let i = 0; i < Math.max(radialSegs, N); i++) {
      const oIdx  = Math.floor((i / Math.max(radialSegs, N)) * radialSegs) % radialSegs;
      const oNext = (oIdx + 1) % radialSegs;
      const iIdx  = Math.floor((i / Math.max(radialSegs, N)) * N) % N;
      const iNext = (iIdx + 1) % N;

      indices.push(outerStart + oIdx, outerStart + oNext, innerStart + iIdx);
      indices.push(outerStart + oNext, innerStart + iNext, innerStart + iIdx);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [
    lighterHoleEnabled, lighterHolePreset, lighterHoleTolerance,
    lighterHoleFloor, height, topRadius, params.radialSegments,
    params.crossSection, params.twistAngle, params.mirrorY,
    params.ribFreq, params.ribDepth, params.ribProfile, params.ribPhase,
    params.diamondFreq, params.diamondDepth,
    params.verticalRipples, params.verticalRippleDepth,
    params.bambooSteps, params.bambooDepth, params.bambooVerticalFreq,
    rdMap, voronoiMap,
  ]);

  if (!geometry) return null;

  return (
    <mesh geometry={geometry}>
      <meshPhysicalMaterial
        color="#f59e0b"
        transparent
        opacity={0.4}
        metalness={0}
        roughness={0.8}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

// ============================================================================
// G-CODE SPIRAL VIEWER  (3-D line preview inside the Canvas)
// ============================================================================
function GCodeViewer({ params, customProfileData, rdMap, voronoiMap }) {
  const { geometry } = useMemo(() => {
    const positions = [];
    const colors    = [];

    const segments  = Math.round((params.height * 10) / params.layerHeight);
    const rSegments = Math.max(3, params.radialSegments);
    const colBot    = new THREE.Color(0xd900ff);
    const colTop    = new THREE.Color(0x00ffff);

    for (let i = 0; i <= segments; i++) {
      const t      = i / segments;
      const py     = t * params.height;
      const evalT  = (params.mirrorY && t > 0.5) ? 1.0 - t : t;
      const baseR  = getSmoothedProfileRadius(evalT, params, customProfileData);

      // Non-planar slope for preview
      let dR_dT = 0;
      if (params.nonPlanar && params.nonPlanarAmplitude > 0) {
        const dt2    = 0.02;
        const rPlus  = getSmoothedProfileRadius(Math.min(1, evalT + dt2), params, customProfileData);
        const rMinus = getSmoothedProfileRadius(Math.max(0, evalT - dt2), params, customProfileData);
        dR_dT = (rPlus - rMinus) / (dt2 * 2);
      }

      for (let j = 0; j <= rSegments; j++) {
        const ringT      = j / rSegments;
        const spiralY    = py + (1.0 / segments) * ringT * params.height;
        const twistY     = spiralY / params.height;
        const evalTwistY = (params.mirrorY && twistY > 0.5) ? 1.0 - twistY : twistY;
        const evalAngle  = ringT * Math.PI * 2;

        const currentR   = applyRadiusModifiers(evalAngle, evalTwistY, spiralY, baseR, params, rdMap, voronoiMap);
        const finalAngle = evalAngle + evalTwistY * params.twistAngle;

        // Non-planar Z preview (scale 0.05 = SCALE/10)
        const npOffset = params.nonPlanar
          ? dR_dT * params.nonPlanarAmplitude * Math.sin(finalAngle) * 0.05
          : 0;

        const x = currentR * Math.cos(finalAngle);
        const z = -currentR * Math.sin(finalAngle);
        const y = Math.max(params.layerHeight / 10, spiralY + npOffset);

        positions.push(x, y, z);
        const c = colBot.clone().lerp(colTop, spiralY / params.height);
        colors.push(c.r, c.g, c.b);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color',    new THREE.Float32BufferAttribute(colors,    3));
    return { geometry: geo };
  }, [params, customProfileData, rdMap, voronoiMap]);

  return (
    <line geometry={geometry}>
      <lineBasicMaterial vertexColors={true} linewidth={1} />
    </line>
  );
}

// ============================================================================
// OVERHANG OVERLAY MESH  (vertex-colored, drawn on top of the lamp)
// ============================================================================
function OverhangOverlayMesh({ params, customProfileData, rdMap, voronoiMap, perLayerAngles }) {
  const geometry = useMemo(() => {
    if (!perLayerAngles) return null;
    const geo = new THREE.LatheGeometry(
      generateLampPoints(params, customProfileData),
      params.radialSegments, 0, Math.PI * 2
    );

    const posAttr = geo.attributes.position;
    const colors  = new Float32Array(posAttr.count * 3);
    const vSegments = params.verticalSegments || 100;

    for (let i = 0; i < posAttr.count; i++) {
      const y    = posAttr.getY(i);
      const t    = Math.max(0, Math.min(1, y / params.height));
      const layerIdx = Math.min(perLayerAngles.length - 1, Math.floor(t * perLayerAngles.length));
      const ang  = perLayerAngles[layerIdx];

      let r, g, b;
      if (ang > OVERHANG_CAUTION) {
        // Critical — red
        r = 1.0; g = 0.1; b = 0.1;
      } else if (ang > OVERHANG_SAFE) {
        // Caution — amber
        r = 1.0; g = 0.75; b = 0.0;
      } else {
        // Safe — green
        r = 0.1; g = 0.9; b = 0.45;
      }
      colors[i * 3]     = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geo;
  }, [params, customProfileData, rdMap, voronoiMap, perLayerAngles]);

  if (!geometry) return null;
  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial vertexColors transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

// ============================================================================
// OVERHANG WARNING PANEL  (sidebar component)
// ============================================================================
function OverhangWarningPanel({ report }) {
  const [expanded, setExpanded] = useState(false);
  if (!report) return null;

  const { status, maxOverhangAngle, criticalHeights, suggestions,
          bedFitsX, bedFitsY, diameterMm, heightMm } = report;

  const isCritical = status === 'CRITICAL' || status === 'BED_OVERFLOW';
  const isCaution  = status === 'CAUTION';
  const isOK       = status === 'OK';

  const panelClass = `overhang-panel overhang-${status.toLowerCase().replace('_', '-')}`;

  return (
    <div className={panelClass}>
      {/* Header row */}
      <button
        className="overhang-header"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
      >
        <span className="overhang-icon">
          {isOK      && <CheckCircle  size={13} />}
          {isCaution && <AlertTriangle size={13} />}
          {isCritical && <XCircle     size={13} />}
        </span>
        <span className="overhang-title">
          {isOK       && 'PRINT READY'}
          {isCaution  && 'OVERHANG WARNING'}
          {status === 'CRITICAL'    && 'CRITICAL OVERHANG'}
          {status === 'BED_OVERFLOW' && 'BED OVERFLOW'}
        </span>
        <span className="overhang-angle">{maxOverhangAngle.toFixed(1)}°</span>
      </button>

      {/* Body — always show bed fit; expand for details */}
      <div className="overhang-bed-row">
        <span className={bedFitsX && bedFitsY ? 'bed-ok' : 'bed-err'}>
          {bedFitsX && bedFitsY ? '✓' : '✕'} {diameterMm}mm × {heightMm}mm
        </span>
        {(!bedFitsX || !bedFitsY) && (
          <span className="bed-hint">EXCEEDS BED — reduce radius</span>
        )}
      </div>

      {(expanded || isCritical) && (isCaution || isCritical) && (
        <div className="overhang-body">
          {criticalHeights.length > 0 && (
            <div className="overhang-zones">
              ZONES: {criticalHeights.map(h => `${h}cm`).join(', ')}
            </div>
          )}
          {suggestions.length > 0 && (
            <div className="overhang-suggestions">
              <div className="overhang-suggestions-title">FIX:</div>
              {suggestions.map((s, i) => (
                <div key={i} className="overhang-tip">
                  <span className="tip-param">{s.param}</span>
                  <span className="tip-arrow">→</span>
                  <span className="tip-val">{s.suggested}</span>
                  <span className="tip-reason">{s.reason}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// EXPORT GATE MODAL
// ============================================================================
function ExportGateModal({ onConfirm, onCancel, report }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Overhang warning">
      <div className="modal-box">
        <div className="modal-icon"><XCircle size={28} /></div>
        <div className="modal-title">CRITICAL OVERHANG DETECTED</div>
        <div className="modal-body">
          Max overhang: <strong>{report.maxOverhangAngle}°</strong><br />
          {report.criticalZoneCount} critical zone{report.criticalZoneCount !== 1 ? 's' : ''} found.
          This print will likely fail or require support material.
        </div>
        <div className="modal-actions">
          <button className="export-btn modal-cancel" onClick={onCancel}>
            <div className="btn-text">CANCEL</div>
          </button>
          <button className="export-btn modal-confirm" onClick={onConfirm}>
            <div className="btn-text">EXPORT ANYWAY</div>
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN APP
// ============================================================================
export default function App() {
  const [isGlowing,        setIsGlowing]       = useState(false);
  const [viewMode,         setViewMode]         = useState('3D');
  const [customProfileData, setCustomProfileData] = useState([]);
  const [rdMap,            setRdMap]             = useState(null);
  const [rdComputing,      setRdComputing]       = useState(false);
  const [gcodeExporting,   setGcodeExporting]    = useState(false);
  const [showOverlay,      setShowOverlay]        = useState(true);
  const [showWireframe,    setShowWireframe]      = useState(false);
  const [retopoQuality,    setRetopoQuality]      = useState('BALANCED');
  const [retopoStatus,     setRetopoStatus]       = useState(null);  // null | 'working' | report-obj
  const [showExportGate,   setShowExportGate]     = useState(false);
  const [pendingGcodeExport, setPendingGcodeExport] = useState(false);
  const [retopoPreviewBufs,  setRetopoPreviewBufs]  = useState(null);   // { positions, indices } | null
  const [retopoPreviewLoading, setRetopoPreviewLoading] = useState(false);

  const meshRef                = useRef();
  const rdWorkerRef            = useRef(null);
  const rdDebounceRef          = useRef(null);
  const retopoPreviewWorkerRef = useRef(null);
  const retopoPreviewDebounce  = useRef(null);

  // ── Mount persistent RD worker ─────────────────────────────────────────
  useEffect(() => {
    rdWorkerRef.current = new Worker(
      new URL('./workers/rdWorker.js', import.meta.url),
      { type: 'module' }
    );
    rdWorkerRef.current.onmessage = (e) => {
      setRdMap(e.data);
      setRdComputing(false);
    };
    rdWorkerRef.current.onerror = () => setRdComputing(false);

    return () => {
      rdWorkerRef.current?.terminate();
      clearTimeout(rdDebounceRef.current);
      retopoPreviewWorkerRef.current?.terminate();
      clearTimeout(retopoPreviewDebounce.current);
    };
  }, []);;

  // ── Controls ───────────────────────────────────────────────────────────
  const [params, setParams] = useControls('Lamp Shape', () => ({
    Profile: folder({
      verticalProfile: { options: ['vase', 'hourglass', 'teardrop', 'pagoda', 'column', 'cone', 'sphere', 'superformula', 'spherical-harmonic', 'super-ellipsoid', 'custom'] },
      customUpload: button(() => document.getElementById('hidden-file-input')?.click()),
      crossSection:    { options: ['circle', 'square', 'hexagon', 'triangle', 'star', 'gear'] },
      height:          { value: 10,  min: 2,   max: 30,  step: 0.1 },
      bottomRadius:    { value: 5,   min: 1,   max: 15,  step: 0.1 },
      midRadius:       { value: 3,   min: 1,   max: 15,  step: 0.1 },
      topRadius:       { value: 4,   min: 1,   max: 15,  step: 0.1 },
      thickness:       { value: 0.5, min: 0.1, max: 2,   step: 0.05 },
      profileSmoothing: { value: 0, min: 0, max: 1, step: 0.01, label: 'Profile Smoothing' },
    }, { collapsed: true }),

    'Solid Vase Mode Geometry': folder({
      solidVaseMode:   { value: false, label: 'Export as Solid' },
      closeTop:        { value: false, label: 'Cap Top' },
      closeBottom:     { value: false, label: 'Cap Bottom' },
    }, { collapsed: false }),

    Resolution: folder({
      verticalSegments: { value: 100, min: 10, max: 800, step: 1,  label: 'Vertical Steps' },
      radialSegments:   { value: 64,  min: 3,  max: 200, step: 1,  label: 'Radial Steps'   },
      subdivisionLevel: { value: 0,   min: 0,  max: 2,   step: 1,  label: 'Subdivision'    },
    }),

    'Print Settings': folder({
      layerHeight: { value: 0.2,  min: 0.08, max: 0.8,  step: 0.04, label: 'Layer Height (mm)' },
      nozzleSize:  { value: 0.4,  min: 0.2,  max: 1.2,  step: 0.1,  label: 'Nozzle Size (mm)'  },
      bedX:        { value: 220,  min: 100,  max: 500,  step: 10,   label: 'Bed X (mm)'         },
      bedY:        { value: 220,  min: 100,  max: 500,  step: 10,   label: 'Bed Y (mm)'         },
    }, { collapsed: true }),

    'Advanced Ribbing': folder({
      ribFreq:            { value: 0,   min: 0,   max: 128,         step: 1,    label: 'Rib Count'     },
      ribDepth:           { value: 0,   min: 0,   max: 3,           step: 0.05, label: 'Rib Depth'     },
      ribProfile:         { options: ['sine', 'sharp', 'pleat', 'sawtooth'] },
      ribTension:         { value: 0.4, min: 0.1, max: 3.0,         step: 0.1,  label: 'Tension/Shape' },
      ribPhase:           { value: 0,   min: 0,   max: 1,           step: 0.05, label: 'Phase Shift'   },
    }, { collapsed: false }),

    '2-Tier Pedestal': folder({
      pedestalRatio:      { value: 0,   min: 0,   max: 1.0,         step: 0.01, label: 'Pedestal Height %' },
      pedestalRibs:       { value: 24,  min: 0,   max: 128,         step: 1,    label: 'Pedestal Rib Count'},
      pedestalDepth:      { value: 0,   min: 0,   max: 3,           step: 0.05, label: 'Pedestal Rib Depth'},
      pedestalProfile:    { options: ['pleat', 'sharp', 'sine', 'sawtooth'] },
    }, { collapsed: false }),

    Modifiers: folder({
      mirrorX:            false,
      mirrorY:            false,
      mirrorZ:            false,
      twistAngle:         { value: 0,   min: 0,   max: Math.PI * 4, step: 0.1,  label: 'Twist'         },
      diamondFreq:        { value: 0,   min: 0,   max: 32,          step: 1,    label: 'Diamond Freq'  },
      diamondDepth:       { value: 0,   min: 0,   max: 3,           step: 0.05, label: 'Diamond Depth' },
      verticalRipples:    { value: 0,   min: 0,   max: 32,          step: 1,    label: 'Wave Freq'     },
      verticalRippleDepth:{ value: 0,   min: 0,   max: 3,           step: 0.05, label: 'Wave Depth'    },
      bambooSteps:        { value: 0,   min: 0,   max: 20,          step: 1,    label: 'Bamboo Steps'  },
      bambooVerticalFreq: { value: 0,   min: 0,   max: 64,          step: 1,    label: 'Bamboo Vert'   },
      bambooDepth:        { value: 0,   min: 0,   max: 3,           step: 0.05, label: 'Bamboo Depth'  },
      noiseScale:         { value: 2,   min: 0.1, max: 10,          step: 0.1,  label: 'Perlin Scale'  },
      noiseDepth:         { value: 0,   min: 0,   max: 3,           step: 0.05, label: 'Perlin Depth'  },
    }),

    'SuperShape Modifiers': folder({
      'SuperFormula Mod': folder({
        superFormulaDepth:  { value: 0,   min: 0,   max: 3,    step: 0.05, label: 'SF Depth'     },
        sfModM:             { value: 8,   min: 0,   max: 32,   step: 1,    label: 'SF Symmetry'  },
        sfModN1:            { value: 2,   min: 0.1, max: 100,  step: 0.1,  label: 'SF n1'        },
        sfModN2:            { value: 2,   min: 0.1, max: 100,  step: 0.1,  label: 'SF n2'        },
        sfModN3:            { value: 2,   min: 0.1, max: 100,  step: 0.1,  label: 'SF n3'        },
      }),
      'Harmonics Mod': folder({
        harmonicDepth:      { value: 0,   min: 0,   max: 3,    step: 0.05, label: 'SH Depth'     },
        shModM0:            { value: 2,   min: 0,   max: 7,    step: 1,    label: 'SH m0'        },
        shModM1:            { value: 1,   min: 0,   max: 7,    step: 1,    label: 'SH m1'        },
        shModM2:            { value: 2,   min: 0,   max: 7,    step: 1,    label: 'SH m2'        },
        shModM3:            { value: 1,   min: 0,   max: 7,    step: 1,    label: 'SH m3'        },
        shModM4:            { value: 2,   min: 0,   max: 7,    step: 1,    label: 'SH m4'        },
        shModM5:            { value: 1,   min: 0,   max: 7,    step: 1,    label: 'SH m5'        },
        shModM6:            { value: 2,   min: 0,   max: 7,    step: 1,    label: 'SH m6'        },
        shModM7:            { value: 1,   min: 0,   max: 7,    step: 1,    label: 'SH m7'        },
      }),
    }, { collapsed: true }),

    'SuperShape Profile': folder({
      'SF Profile': folder({
        sfProfM:            { value: 0,   min: 0,   max: 16,   step: 1,    label: 'SF m'         },
        sfProfN1:           { value: 1,   min: 0.1, max: 100,  step: 0.1,  label: 'SF n1'        },
        sfProfN2:           { value: 1,   min: 0.1, max: 100,  step: 0.1,  label: 'SF n2'        },
        sfProfN3:           { value: 1,   min: 0.1, max: 100,  step: 0.1,  label: 'SF n3'        },
      }),
      'SH Profile': folder({
        shProfM0:           { value: 0,   min: 0,   max: 7,    step: 1,    label: 'SH m0'        },
        shProfM1:           { value: 0,   min: 0,   max: 7,    step: 1,    label: 'SH m1'        },
        shProfM2:           { value: 0,   min: 0,   max: 7,    step: 1,    label: 'SH m2'        },
        shProfM3:           { value: 0,   min: 0,   max: 7,    step: 1,    label: 'SH m3'        },
        shProfM4:           { value: 0,   min: 0,   max: 7,    step: 1,    label: 'SH m4'        },
        shProfM5:           { value: 0,   min: 0,   max: 7,    step: 1,    label: 'SH m5'        },
        shProfM6:           { value: 0,   min: 0,   max: 7,    step: 1,    label: 'SH m6'        },
        shProfM7:           { value: 0,   min: 0,   max: 7,    step: 1,    label: 'SH m7'        },
      }),
      'SE Profile': folder({
        seN:                { value: 1.0, min: 0.05, max: 4.0,  step: 0.05, label: 'SE North/South' },
        seE:                { value: 1.0, min: 0.05, max: 4.0,  step: 0.05, label: 'SE East/West'   },
      }),
    }, { collapsed: true }),

    'Organic Algorithms': folder({
      'Reaction-Diffusion': folder({
        rdDepth:      { value: 0,    min: 0,     max: 3,    step: 0.05,  label: 'RD Depth'    },
        rdFeed:       { value: 0.055,min: 0.012, max: 0.1,  step: 0.001, label: 'Feed (F)'    },
        rdKill:       { value: 0.062,min: 0.04,  max: 0.082,step: 0.001, label: 'Kill (k)'    },
        rdIterations: { value: 1000, min: 200,   max: 4000, step: 100,   label: 'Iterations'  },
      }),
      Voronoi: folder({
        voronoiDepth:   { value: 0,  min: 0, max: 3,    step: 0.05, label: 'Voronoi Depth' },
        voronoiSeeds:   { value: 20, min: 3, max: 80,   step: 1,    label: 'Seeds Count'   },
        voronoiSeedInt: { value: 42, min: 0, max: 9999, step: 1,    label: 'Seed #'        },
      }),
    }, { collapsed: true }),

    'G-Code Tuning': folder({
      wallFeedFast:       { value: 1500, min: 800, max: 3000, step: 50,   label: 'Fast Feed (mm/min)'   },
      wallFeedSlow:       { value: 600,  min: 200, max: 1500, step: 50,   label: 'Dense Feed (mm/min)'  },
      denseBandStart:     { value: 0.0,  min: 0,   max: 1,    step: 0.01, label: 'Dense Zone Start ↕'   },
      denseBandEnd:       { value: 0.15, min: 0,   max: 1,    step: 0.01, label: 'Dense Zone End ↕'     },
      extrusionMult:      { value: 1.1,  min: 0.5, max: 2.5,  step: 0.05, label: 'Extrusion Mult'       },
      denseExtrusionMult: { value: 2.0,  min: 1,   max: 4,    step: 0.1,  label: 'Dense Extrusion Mult' },
      nonPlanar:          { value: false,                                  label: 'Non-Planar Z'         },
      nonPlanarAmplitude: { value: 0.5,  min: 0,   max: 3,    step: 0.05, label: 'NP Amplitude'         },
    }, { collapsed: true }),

    'Lighter Hole': folder({
      lighterHoleEnabled:   { value: false,      label: 'Enable Lighter Hole' },
      lighterHolePreset:    { options: { 'Standard (25×14×80mm)': 'standard', 'Mini (21×11×63mm)': 'mini' }, label: 'Lighter Size' },
      lighterHoleTolerance: { value: 0.4, min: 0.1, max: 1.0, step: 0.05, label: 'Tolerance (mm)' },
      lighterHoleFloor:     { value: 2.5, min: 1.0, max: 8.0, step: 0.5,  label: 'Floor Thickness (mm)' },
    }, { collapsed: false }),

    Shaders: folder({
      innerGlowIntensity: { value: 3.0, min: 0, max: 10, step: 0.1  },
      surfaceNoise:       { value: 0.5, min: 0, max: 2,  step: 0.05 },
      iridescence:        { value: 0.5, min: 0, max: 1,  step: 0.05 },
    }, { collapsed: true }),
  }));

  // ── Appearance controls ────────────────────────────────────────────────
  const [styleParams, setStyleParams] = useControls('Appearance', () => ({
    material:      { options: ['matte', 'metallic', 'glass'] },
    color:         '#ff6200',
    flatShading:   false,
    environment:   { options: ['studio', 'city', 'warehouse', 'sunset', 'dawn', 'night'] },
    lightIntensity:{ value: 1, min: 0, max: 5, step: 0.1 },
  }), { collapsed: true });

  // ── Pack flat Leva sliders into composite SuperShape objects ────────────
  //    lampMath.js expects sfProfile, shProfile, sfModifier, shModifier
  //    as nested objects/arrays on the params object.
  const enrichedParams = useMemo(() => ({
    ...params,
    // Profile composites (used by getProfileRadius)
    sfProfile: {
      m: params.sfProfM, n1: params.sfProfN1,
      n2: params.sfProfN2, n3: params.sfProfN3,
      a: 1, b: 1,
    },
    shProfile: [
      params.shProfM0, params.shProfM1, params.shProfM2, params.shProfM3,
      params.shProfM4, params.shProfM5, params.shProfM6, params.shProfM7,
    ],
    // Modifier composites (used by applyRadiusModifiers)
    sfModifier: {
      m: params.sfModM, n1: params.sfModN1,
      n2: params.sfModN2, n3: params.sfModN3,
    },
    shModifier: [
      params.shModM0, params.shModM1, params.shModM2, params.shModM3,
      params.shModM4, params.shModM5, params.shModM6, params.shModM7,
    ],
  }), [params]);

  // ── Auto-set print-ready params when lighter hole is enabled ───────────
  useEffect(() => {
    if (params.lighterHoleEnabled) {
      const dims = BIC_PRESETS[params.lighterHolePreset] || BIC_PRESETS.standard;
      // Case height = lighter body - exposed top + floor thickness, in cm
      const caseHeightCm = ((dims.bodyHeight - dims.topExposed) + params.lighterHoleFloor) / 10;
      setParams({
        height:        Math.round(caseHeightCm * 10) / 10, // round to 0.1cm
        solidVaseMode: false,   // handled by lighterHoleEnabled logic in generateLampPoints
        closeBottom:   false,   // handled by lighterHoleEnabled logic
        closeTop:      false,   // top stays open for lighter
        verticalProfile: 'column', // cylindrical case shape
      });
    }
  }, [params.lighterHoleEnabled, params.lighterHolePreset, params.lighterHoleFloor]);

  // ── Auto-recompute RD map — debounced 800 ms ───────────────────────────
  useEffect(() => {
    if (!rdWorkerRef.current || params.rdDepth === 0) return;
    setRdComputing(true);
    clearTimeout(rdDebounceRef.current);
    rdDebounceRef.current = setTimeout(() => {
      rdWorkerRef.current?.postMessage({
        feed:       params.rdFeed,
        kill:       params.rdKill,
        iterations: params.rdIterations,
      });
    }, 800);
    return () => clearTimeout(rdDebounceRef.current);
  }, [params.rdFeed, params.rdKill, params.rdIterations, params.rdDepth]);

  // ── Voronoi map — computed synchronously (~5 ms) ───────────────────────
  const voronoiMap = useMemo(() => {
    if (params.voronoiDepth === 0) return null;
    return computeVoronoi({ resolution: 256, numSeeds: params.voronoiSeeds, seed: params.voronoiSeedInt });
  }, [params.voronoiDepth, params.voronoiSeeds, params.voronoiSeedInt]);

  // ── Overhang analysis — coarse scan, runs on every param change ─────────
  const overhangReport = useMemo(() => {
    return analyzeOverhangs(enrichedParams, customProfileData, rdMap, voronoiMap);
  }, [
    params.height, params.bottomRadius, params.midRadius, params.topRadius,
    params.verticalProfile, params.solidVaseMode, params.mirrorY,
    params.twistAngle, params.ribFreq, params.ribDepth, params.pedestalDepth, params.pedestalRatio,
    params.verticalRipples, params.verticalRippleDepth,
    params.bambooSteps, params.bambooDepth, params.bambooVerticalFreq,
    params.diamondFreq, params.diamondDepth,
    params.noiseScale, params.noiseDepth,
    params.rdDepth, params.voronoiDepth,
    params.crossSection, params.mirrorX, params.mirrorZ,
    params.layerHeight, params.bedX, params.bedY,
    customProfileData, rdMap, voronoiMap,
  ]);

  // ── Retopo preview worker — live wireframe preview on quality change ──────
  // Fires whenever wireframe is ON + a non-OFF quality is selected,
  // and whenever any geometry-affecting parameter changes.
  useEffect(() => {
    clearTimeout(retopoPreviewDebounce.current);
    retopoPreviewWorkerRef.current?.terminate();

    if (!showWireframe || retopoQuality === 'OFF') {
      setRetopoPreviewBufs(null);
      setRetopoPreviewLoading(false);
      return;
    }

    setRetopoPreviewLoading(true);

    retopoPreviewDebounce.current = setTimeout(() => {
      const geo = meshRef.current?.geometry;
      if (!geo?.attributes?.position) { setRetopoPreviewLoading(false); return; }

      const posAttr   = geo.attributes.position;
      const positions = posAttr.array.slice();   // copy — transferred to worker
      let   indices;
      if (geo.index) {
        indices = geo.index.array.slice();
      } else {
        indices = new Uint32Array(posAttr.count);
        for (let i = 0; i < posAttr.count; i++) indices[i] = i;
      }

      const worker = new Worker(
        new URL('./workers/retopologyWorker.js', import.meta.url),
        { type: 'module' }
      );
      retopoPreviewWorkerRef.current = worker;

      worker.postMessage(
        { positions: new Float32Array(positions), indices: new Uint32Array(indices), quality: retopoQuality },
        [positions.buffer, indices.buffer]
      );

      worker.onmessage = (e) => {
        const { positions: cleanPos, indices: cleanIdx } = e.data;
        setRetopoPreviewBufs({ positions: cleanPos, indices: cleanIdx });
        setRetopoPreviewLoading(false);
        worker.terminate();
      };
      worker.onerror = () => { setRetopoPreviewLoading(false); worker.terminate(); };
    }, 350);  // 350 ms debounce — wait for param slider to settle

    return () => {
      clearTimeout(retopoPreviewDebounce.current);
    };
  }, [
    showWireframe, retopoQuality,
    // All geometry-affecting params:
    params.height, params.bottomRadius, params.midRadius, params.topRadius,
    params.thickness, params.verticalProfile, params.solidVaseMode,
    params.closeTop, params.closeBottom, params.mirrorY,
    params.verticalSegments, params.radialSegments,
    params.twistAngle, params.ribFreq, params.ribDepth, params.pedestalDepth, params.pedestalRatio,
    params.verticalRipples, params.verticalRippleDepth,
    params.bambooSteps, params.bambooDepth, params.bambooVerticalFreq,
    params.diamondFreq, params.diamondDepth,
    params.noiseScale, params.noiseDepth,
    params.rdDepth, params.voronoiDepth,
    params.crossSection, params.mirrorX, params.mirrorZ,
    rdMap, voronoiMap, customProfileData,
  ]);



  // Pre-compute material props so Lamp doesn't need styleParams access
  const materialProps = useMemo(() => ({
    color:        styleParams.color,
    roughness:    styleParams.material === 'glass' ? 0.1 : styleParams.material === 'metallic' ? 0.2 : 0.8,
    metalness:    styleParams.material === 'metallic' ? 0.8 : 0.0,
    transmission: styleParams.material === 'glass'   ? 0.9 : 0.0,
    flatShading:  styleParams.flatShading,
  }), [styleParams.color, styleParams.material, styleParams.flatShading]);

  // ── Custom profile image upload ────────────────────────────────────────
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const H  = 500;
      const W  = Math.floor(img.width * (H / img.height));
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, W, H);
      const data  = ctx.getImageData(0, 0, W, H).data;
      const cx    = W / 2;
      const profile = [];
      const [bgR, bgG, bgB, bgA] = [data[0], data[1], data[2], data[3]];
      for (let y = 0; y < H; y++) {
        let edgeX = cx;
        for (let x = W - 1; x >= cx; x--) {
          const i = (y * W + x) * 4;
          if (Math.abs(data[i]-bgR) + Math.abs(data[i+1]-bgG) + Math.abs(data[i+2]-bgB) + Math.abs(data[i+3]-bgA) > 50) {
            edgeX = x; break;
          }
        }
        profile.push((edgeX - cx) / cx);
      }
      setCustomProfileData(profile.reverse());
    };
    img.src = URL.createObjectURL(file);
  };

  // ── STL export (with optional retopology) ──────────────────────────────
  // Helper: remove degenerate triangles (near-zero area) from geometry
  const cleanGeometryForExport = useCallback((mesh) => {
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const idx = geo.index;

    // Convert to non-indexed for simpler processing
    const nonIndexed = idx ? geo.toNonIndexed() : geo.clone();
    const srcPos = nonIndexed.attributes.position;
    const cleanVerts = [];

    for (let f = 0; f < srcPos.count; f += 3) {
      const ax = srcPos.getX(f),   ay = srcPos.getY(f),   az = srcPos.getZ(f);
      const bx = srcPos.getX(f+1), by = srcPos.getY(f+1), bz = srcPos.getZ(f+1);
      const cx = srcPos.getX(f+2), cy = srcPos.getY(f+2), cz = srcPos.getZ(f+2);

      // Cross product to get face area
      const abx = bx-ax, aby = by-ay, abz = bz-az;
      const acx = cx-ax, acy = cy-ay, acz = cz-az;
      const nx = aby*acz - abz*acy;
      const ny = abz*acx - abx*acz;
      const nz = abx*acy - aby*acx;
      const area = Math.sqrt(nx*nx + ny*ny + nz*nz) * 0.5;

      // Skip degenerate triangles
      if (area < 1e-6) continue;

      cleanVerts.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    }

    const cleanGeo = new THREE.BufferGeometry();
    cleanGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(cleanVerts), 3));
    cleanGeo.computeVertexNormals();

    const cleanMesh = new THREE.Mesh(cleanGeo, mesh.material);
    return cleanMesh;
  }, []);

  const exportSTL = useCallback(() => {
    if (!meshRef.current) return;

    if (retopoQuality === 'OFF') {
      // Direct export — clean degenerate triangles first
      const cleanMesh = cleanGeometryForExport(meshRef.current);
      const stl  = new STLExporter().parse(cleanMesh, { binary: false });
      cleanMesh.geometry.dispose();
      const link = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(new Blob([stl], { type: 'text/plain' })),
        download: `lamp_${Date.now()}.stl`,
        style: 'display:none',
      });
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setRetopoStatus({ skipped: true });
      return;
    }

    // Extract raw buffers from the live Three.js mesh
    const geo = meshRef.current.geometry;
    if (!geo || !geo.attributes.position) return;

    const posAttr = geo.attributes.position;
    const positions = new Float32Array(posAttr.array);

    let indices;
    if (geo.index) {
      indices = new Uint32Array(geo.index.array);
    } else {
      // Non-indexed geometry — build sequential indices
      indices = new Uint32Array(posAttr.count);
      for (let i = 0; i < posAttr.count; i++) indices[i] = i;
    }

    setRetopoStatus('working');

    const worker = new Worker(
      new URL('./workers/retopologyWorker.js', import.meta.url),
      { type: 'module' }
    );

    worker.postMessage(
      { positions, indices, quality: retopoQuality },
      [positions.buffer, indices.buffer]
    );

    worker.onmessage = (e) => {
      const { positions: cleanPos, indices: cleanIdx, report } = e.data;

      // Build ASCII STL from cleaned buffers
      let stl = 'solid lamp\n';
      for (let fi = 0; fi < cleanIdx.length; fi += 3) {
        const ia = cleanIdx[fi], ib = cleanIdx[fi+1], ic = cleanIdx[fi+2];
        const ax = cleanPos[ia*3], ay = cleanPos[ia*3+1], az = cleanPos[ia*3+2];
        const bx = cleanPos[ib*3], by = cleanPos[ib*3+1], bz = cleanPos[ib*3+2];
        const cx = cleanPos[ic*3], cy = cleanPos[ic*3+1], cz = cleanPos[ic*3+2];

        // Face normal
        const nx = (by-ay)*(cz-az)-(bz-az)*(cy-ay);
        const ny = (bz-az)*(cx-ax)-(bx-ax)*(cz-az);
        const nz = (bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
        const nlen = Math.sqrt(nx*nx+ny*ny+nz*nz) || 1;

        // Skip degenerate triangles
        if (nlen < 1e-6) continue;

        stl += `  facet normal ${(nx/nlen).toFixed(6)} ${(ny/nlen).toFixed(6)} ${(nz/nlen).toFixed(6)}\n`;
        stl += `    outer loop\n`;
        stl += `      vertex ${ax.toFixed(6)} ${ay.toFixed(6)} ${az.toFixed(6)}\n`;
        stl += `      vertex ${bx.toFixed(6)} ${by.toFixed(6)} ${bz.toFixed(6)}\n`;
        stl += `      vertex ${cx.toFixed(6)} ${cy.toFixed(6)} ${cz.toFixed(6)}\n`;
        stl += `    endloop\n  endfacet\n`;
      }
      stl += 'endsolid lamp\n';

      const link = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(new Blob([stl], { type: 'text/plain' })),
        download: `lamp_retopo_${Date.now()}.stl`,
        style: 'display:none',
      });
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      worker.terminate();
      setRetopoStatus(report);
      // Auto-clear mini-report after 5 s
      setTimeout(() => setRetopoStatus(null), 5000);
    };

    worker.onerror = (err) => {
      console.error('Retopology worker error:', err);
      worker.terminate();
      setRetopoStatus(null);
    };
  }, [meshRef, retopoQuality, cleanGeometryForExport]);

  // ── G-code export helper (actual send) ────────────────────────────────
  const doExportGCode = useCallback(() => {
    setGcodeExporting(true);
    setShowExportGate(false);
    setPendingGcodeExport(false);

    const worker = new Worker(
      new URL('./workers/gcodeWorker.js', import.meta.url),
      { type: 'module' }
    );

    worker.postMessage({
      params: { ...enrichedParams },
      customProfileData: [...customProfileData],
      rdMap:      rdMap      ? rdMap.slice()      : null,
      voronoiMap: voronoiMap ? voronoiMap.slice() : null,
    });

    worker.onmessage = (e) => {
      const link = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(new Blob([e.data], { type: 'text/plain' })),
        download: `lamp_vase_${Date.now()}.gcode`,
        style: 'display:none',
      });
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      worker.terminate();
      setGcodeExporting(false);
    };

    worker.onerror = (err) => {
      console.error('GCode worker error:', err);
      worker.terminate();
      setGcodeExporting(false);
    };
  }, [enrichedParams, customProfileData, rdMap, voronoiMap]);

  // ── G-code export — with overhang export gate ──────────────────────────
  const exportGCode = useCallback(() => {
    if (gcodeExporting) return;
    if (overhangReport?.status === 'CRITICAL') {
      setShowExportGate(true);   // show modal
      setPendingGcodeExport(true);
    } else {
      doExportGCode();
    }
  }, [gcodeExporting, overhangReport, doExportGCode]);

  // ── Preset Export / Import ──────────────────────────────────────────────
  const exportPreset = useCallback(() => {
    const presetData = {
      version: 1,
      params: params,
      styleParams: styleParams
    };
    const json = JSON.stringify(presetData, null, 2);
    const link = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([json], { type: 'application/json' })),
      download: `lamp_preset_${Date.now()}.json`,
      style: 'display:none',
    });
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [params, styleParams]);

  const handlePresetUpload = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = JSON.parse(evt.target.result);
        if (data.params) setParams(data.params);
        if (data.styleParams) setStyleParams(data.styleParams);
      } catch (err) {
        console.error("Failed to parse preset file:", err);
        alert("Invalid preset file.");
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // reset input
  }, [setParams, setStyleParams]);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <>
    {showExportGate && (
      <ExportGateModal
        report={overhangReport}
        onConfirm={doExportGCode}
        onCancel={() => { setShowExportGate(false); setPendingGcodeExport(false); }}
      />
    )}
    <div className="app-container">
      {/* Hidden file input for custom profile */}
      <label
        htmlFor="hidden-file-input"
        style={{ position:'absolute', width:1, height:1, padding:0, margin:-1,
                 overflow:'hidden', clip:'rect(0,0,0,0)', whiteSpace:'nowrap', borderWidth:0 }}
      >Upload custom shape profile</label>
      <input
        type="file" id="hidden-file-input"
        style={{ display:'none' }} accept="image/*"
        onChange={handleImageUpload} aria-hidden="true" tabIndex="-1"
      />

      {/* Left sidebar panel */}
      <div className="sidebar-panel">
        {/* Header section */}
        <div className="sidebar-header">
          <div className="app-title">DENMO_PROJECT: v2</div>
          <div className="app-subtitle">DENMO BUILDER</div>
          {rdComputing && <div className="rd-status">● COMPUTING RD MAP…</div>}
        </div>

        {/* Overhang warning panel — sits between header and divider */}
        <OverhangWarningPanel report={overhangReport} />

        {/* Divider */}
        <div className="sidebar-divider" />

        {/* 01 — Viewport */}
        <div className="sidebar-section">
          <div className="sidebar-section-label">01_VIEW</div>
          <button
            className="export-btn view-toggle-btn"
            onClick={() => setViewMode(m => m === '3D' ? 'G-CODE' : '3D')}
            aria-label="Toggle view mode"
          >
            <div className="btn-text">VIEWPORT: [ {viewMode} ]</div>
          </button>
          <button
            className={`export-btn${showOverlay ? ' overlay-active' : ''}`}
            onClick={() => setShowOverlay(v => !v)}
            aria-label="Toggle overhang color overlay"
            aria-pressed={showOverlay}
          >
            <div className="btn-text"><Layers size={12} style={{marginRight:4}} />OVERHANG MAP</div>
          </button>
          <button
            className={`export-btn${showWireframe ? ' wireframe-active' : ''}`}
            onClick={() => setShowWireframe(v => !v)}
            aria-label="Toggle wireframe polygon mesh view"
            aria-pressed={showWireframe}
          >
            <div className="btn-text">
              <Grid3x3 size={12} style={{marginRight:4}} />
              WIREFRAME
              {showWireframe && retopoQuality !== 'OFF' && retopoPreviewLoading && (
                <span className="wireframe-computing"> ●</span>
              )}
            </div>
          </button>
        </div>

        {/* 02 — Export */}
        <div className="sidebar-section">
          <div className="sidebar-section-label">02_EXPORT</div>

          {/* Retopology quality selector */}
          <div className="sidebar-section-sublabel">RETOPO QUALITY</div>
          <div className="retopo-quality-row">
            {['DRAFT', 'BALANCED', 'FINE', 'OFF'].map(q => (
              <button
                key={q}
                className={`retopo-btn${retopoQuality === q ? ' retopo-active' : ''}${retopoQuality === q && retopoPreviewLoading && showWireframe ? ' retopo-computing' : ''}`}
                onClick={() => setRetopoQuality(q)}
                aria-pressed={retopoQuality === q}
              >
                {q}
                {retopoQuality === q && retopoPreviewLoading && showWireframe && ' ●'}
              </button>
            ))}
          </div>

          <div className="sidebar-btn-row">
            <button
              className={`export-btn${retopoStatus === 'working' ? ' btn-computing' : ''}`}
              onClick={exportSTL}
              disabled={retopoStatus === 'working'}
              aria-label="Export as STL with retopology"
            >
              <div className="btn-text">{retopoStatus === 'working' ? 'RETOPO…' : 'STL'}</div>
            </button>
            <button
              className={`export-btn${gcodeExporting ? ' btn-computing' : ''}`}
              onClick={exportGCode}
              disabled={gcodeExporting}
              aria-label="Export directly printable G-Code"
            >
              <div className="btn-text">{gcodeExporting ? 'WAIT…' : 'G-CODE'}</div>
            </button>
          </div>

          {/* Retopo mini-report */}
          {retopoStatus && retopoStatus !== 'working' && !retopoStatus.skipped && (
            <div className="retopo-report">
              ✓ {retopoStatus.originalTriangles?.toLocaleString()} → {retopoStatus.finalTriangles?.toLocaleString()} tris
              {retopoStatus.seamFixed && '  |  seam fixed'}
              {retopoStatus.manifoldOK ? '  |  manifold ✓' : '  |  ⚠ non-manifold'}
            </div>
          )}
        </div>

        {/* 03 — Tools */}
        <div className="sidebar-section">
          <div className="sidebar-section-label">03_TOOLS</div>
          <button
            className="export-btn sidebar-tool-btn"
            onClick={() => { window.location.hash = '/lampifier'; }}
            aria-label="Open Lamp-ifier tool"
          >
            <div className="btn-text">LAMP-IFIER<span className="beta-badge">BETA</span></div>
          </button>
          <button
            className="export-btn sidebar-tool-btn"
            onClick={() => { window.location.hash = '/gcode-editor'; }}
            aria-label="Open G-Code Visual Editor"
          >
            <div className="btn-text">G-CODE EDITOR<span className="beta-badge">BETA</span></div>
          </button>
          <div className="sidebar-btn-row" style={{ marginTop: '0.5rem' }}>
            <button className="export-btn" onClick={exportPreset} aria-label="Export Preset">
              <div className="btn-text"><Download size={14} style={{marginRight:6}} /> SAVE</div>
            </button>
            <button className="export-btn" onClick={() => document.getElementById('hidden-preset-input').click()} aria-label="Import Preset">
              <div className="btn-text"><Upload size={14} style={{marginRight:6}} /> LOAD</div>
            </button>
            <input type="file" id="hidden-preset-input" style={{display:'none'}} accept=".json" onChange={handlePresetUpload} />
          </div>
        </div>
      </div>

      {/* Leva panel */}
      <Leva theme={{
        colors: {
          elevation1: '#000000', elevation2: '#111111', elevation3: '#222222',
          accent1: '#ffffff', accent2: '#d0f0ec', accent3: '#d0f0ec',
          highlight1: '#ffffff', highlight2: '#a0a0a0', highlight3: '#888888',
        },
        radii:        { xs:'0', sm:'0', md:'0', lg:'0', xl:'0' },
        fonts:        { mono:"'Space Mono', monospace", sans:"'Space Mono', monospace" },
        borderWidths: { folder:'1px', input:'1px', root:'1px', hover:'1px' },
        sizes:        { rootWidth:'400px', controlWidth:'200px' },
      }} />

      {/* Footer */}
      <div className="footer-container">
        <div className="marquee-wrapper">
          <div className="marquee-content">
            Parametric lamp generation · Real-time overhang analysis · Retopology on export · Vase mode G-Code · Wireframe preview · By Line Collective
          </div>
        </div>
        <div className="footer-logo">
          <a href="https://www.facebook.com/mark.do2102/" target="_blank" rel="noreferrer">
            FACEBOOK
          </a>
          <span style={{ color: 'var(--text-tertiary)' }}>·</span>
          <span>DEV BY US</span>
          <div style={{ width:10, height:10, background:'var(--accent-hot)', flexShrink:0 }}/>
          <div style={{ width:10, height:10, background:'var(--text-tertiary)', flexShrink:0 }}/>
        </div>
      </div>

      {/* 3-D Canvas */}
      <Canvas
        shadows
        camera={{ position:[0, 15, 30], fov:45 }}
        dpr={[1, 2]}
        aria-label="Interactive 3D Lamp Generator Viewport"
        role="img"
      >
        <color attach="background" args={['#050505']} />
        <Environment preset={isGlowing ? 'park' : styleParams.environment} background={false} />

        <ambientLight intensity={isGlowing ? styleParams.lightIntensity * 0.2 : styleParams.lightIntensity} />
        <directionalLight
          position={[10, 20, 10]}
          intensity={isGlowing ? styleParams.lightIntensity * 0.5 : styleParams.lightIntensity * 1.5}
          castShadow shadow-mapSize={[1024, 1024]}
        />

        {viewMode === '3D' ? (
          <>
            <Lamp
              params={enrichedParams}
              customProfileData={customProfileData}
              materialProps={materialProps}
              meshRef={meshRef}
              isGlowing={isGlowing}
              rdMap={rdMap}
              voronoiMap={voronoiMap}
              wireframe={showWireframe}
            />
            {/* Lighter cavity preview */}
            {enrichedParams.lighterHoleEnabled && (
              <LighterCavityMesh params={enrichedParams} rdMap={rdMap} voronoiMap={voronoiMap} />
            )}
            {/* Wireframe edges — shown when wireframe mode is ON */}
            {showWireframe && (
              retopoPreviewBufs && retopoQuality !== 'OFF'
                ? (
                    // Retopo preview: clean post-decimation edges in bright green
                    <RetopologyWireframeMesh
                      positions={retopoPreviewBufs.positions}
                      indices={retopoPreviewBufs.indices}
                      color="#00ff88"
                      opacity={0.9}
                    />
                  )
                : (
                    // Raw edges: dim grey while computing, or full colour when quality is OFF
                    <RawLampWireframe
                      params={enrichedParams}
                      customProfileData={customProfileData}
                      color={retopoPreviewLoading ? '#555555' : '#00ff88'}
                      opacity={retopoPreviewLoading ? 0.4 : 0.85}
                    />
                  )
            )}
            {showOverlay && overhangReport && (
              <OverhangOverlayMesh
                params={enrichedParams}
                customProfileData={customProfileData}
                rdMap={rdMap}
                voronoiMap={voronoiMap}
                perLayerAngles={overhangReport.perLayerAngles}
              />
            )}
            <pointLight
              position={[0, enrichedParams.height / 2, 0]}
              intensity={isGlowing ? 4.0 : 2.0}
              color={isGlowing ? '#fbbf24' : styleParams.color}
              distance={enrichedParams.height * 2.5}
            />
          </>
        ) : (
          <GCodeViewer
            params={enrichedParams}
            customProfileData={customProfileData}
            rdMap={rdMap}
            voronoiMap={voronoiMap}
          />
        )}

        <ContactShadows position={[0, -0.01, 0]} opacity={0.8} scale={50} blur={2.5} far={10} color="#000000" />
        <Grid
          infiniteGrid fadeDistance={60}
          sectionColor="#444444" cellColor="#222222"
          cellSize={1} sectionSize={5}
          position={[0, -0.02, 0]}
        />
        <OrbitControls
          makeDefault
          minPolarAngle={0}
          maxPolarAngle={Math.PI / 2 + 0.1}
          autoRotate={false}
          target={[0, enrichedParams.height / 2, 0]}
        />
      </Canvas>
    </div>
    </>
  );
}
