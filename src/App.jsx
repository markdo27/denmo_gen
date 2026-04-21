import React, { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows, Grid } from '@react-three/drei';
import { Leva, useControls, folder, button } from 'leva';
import * as THREE from 'three';
import { STLExporter } from 'three-stdlib';
import { ArrowUpRight, AlertTriangle, CheckCircle, XCircle, Layers, Grid3x3 } from 'lucide-react';
import { getProfileRadius, applyRadiusModifiers } from './lampMath.js';
import { computeVoronoi } from './algorithms/voronoi.js';
import { analyzeOverhangs, OVERHANG_SAFE, OVERHANG_CAUTION } from './overhangAnalyzer.js';
import './index.css';

// ============================================================================
// LAMP PROFILE — 2D revolution points for LatheGeometry
// ============================================================================
function generateLampPoints(params, customProfileData) {
  const { height, thickness, closeTop, closeBottom, solidVaseMode, mirrorY } = params;
  const vSegments = params.verticalSegments || 100;
  const outerPoints = [];

  for (let i = 0; i <= vSegments; i++) {
    const t     = i / vSegments;
    const evalT = mirrorY && t > 0.5 ? 1.0 - t : t;
    outerPoints.push(new THREE.Vector2(getProfileRadius(evalT, params, customProfileData), t * height));
  }

  const finalPoints = [];
  if (solidVaseMode || closeBottom) finalPoints.push(new THREE.Vector2(0.0001, 0));
  for (const p of outerPoints) finalPoints.push(p.clone());
  if (solidVaseMode || closeTop)   finalPoints.push(new THREE.Vector2(0.0001, height));

  if (!solidVaseMode) {
    if (closeTop) finalPoints.push(new THREE.Vector2(0.0001, height - thickness));
    for (let i = outerPoints.length - 1; i >= 0; i--) {
      const p     = outerPoints[i];
      let   y     = p.y;
      if (closeTop    && y > height - thickness) y = height - thickness;
      if (closeBottom && y < thickness)          y = thickness;
      const rInner = Math.max(0.0001, p.x - thickness);
      const next   = new THREE.Vector2(rInner, y);
      if (finalPoints.length > 0) {
        const last = finalPoints[finalPoints.length - 1];
        if (Math.abs(next.x - last.x) < 0.001 && Math.abs(next.y - last.y) < 0.001) continue;
      }
      finalPoints.push(next);
    }
    if (closeBottom) finalPoints.push(new THREE.Vector2(0.0001, thickness));
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
    params.verticalSegments, customProfileData,
  ]);

  // ── Modified geometry (all surface-modifier deps) ────────────────────────
  const geometry = useMemo(() => {
    const geo = new THREE.LatheGeometry(points, params.radialSegments, 0, Math.PI * 2);

    const needsPass =
      params.twistAngle !== 0       ||
      params.radialRippleDepth > 0  || params.verticalRippleDepth > 0 ||
      params.bambooDepth > 0        || params.diamondDepth > 0         ||
      params.noiseDepth > 0         || params.rdDepth > 0              ||
      params.voronoiDepth > 0       || params.crossSection !== 'circle'||
      params.mirrorX || params.mirrorY || params.mirrorZ;

    if (needsPass) {
      const posAttr = geo.attributes.position;
      const vtx     = new THREE.Vector3();

      for (let i = 0; i < posAttr.count; i++) {
        vtx.fromBufferAttribute(posAttr, i);

        // Raw cylindrical angle — applyRadiusModifiers handles all mirror folding
        const rawAngle   = Math.atan2(vtx.z, vtx.x);
        const baseR      = Math.sqrt(vtx.x * vtx.x + vtx.z * vtx.z);
        const twistYNorm = vtx.y / params.height;

        const r = applyRadiusModifiers(rawAngle, twistYNorm, vtx.y, baseR, params, rdMap, voronoiMap);

        // Twist is applied to the original angle (not the folded sample angle)
        const sampleTwistY = (params.mirrorY && twistYNorm > 0.5) ? 1.0 - twistYNorm : twistYNorm;
        const finalAngle   = rawAngle + sampleTwistY * params.twistAngle;

        posAttr.setXYZ(i, r * Math.cos(finalAngle), vtx.y, r * Math.sin(finalAngle));
      }
      geo.computeVertexNormals();
    }

    return geo;
  }, [
    points,
    params.radialSegments, params.twistAngle, params.height,
    params.radialRipples, params.radialRippleDepth,
    params.verticalRipples, params.verticalRippleDepth,
    params.bambooSteps, params.bambooDepth, params.bambooVerticalFreq,
    params.diamondFreq, params.diamondDepth,
    params.noiseScale, params.noiseDepth,
    params.rdDepth, params.voronoiDepth,
    params.crossSection, params.mirrorX, params.mirrorY, params.mirrorZ,
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
        // Wireframe mode: solid ghost + wireframe overlay
        <>
          <meshBasicMaterial color="#0f1a14" transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
          <lineSegments>
            <edgesGeometry attach="geometry" args={[geometry]} />
            <lineBasicMaterial attach="material" color="#00ff88" transparent opacity={0.9} linewidth={1} />
          </lineSegments>
        </>
      ) : (
        <meshPhysicalMaterial
          {...materialProps}
          thickness={1}
          iridescence={params.iridescence}
          onBeforeCompile={onBeforeCompile}
        />
      )}
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
      const baseR  = getProfileRadius(evalT, params, customProfileData);

      // Non-planar slope for preview
      let dR_dT = 0;
      if (params.nonPlanar && params.nonPlanarAmplitude > 0) {
        const dt2    = 0.02;
        const rPlus  = getProfileRadius(Math.min(1, evalT + dt2), params, customProfileData);
        const rMinus = getProfileRadius(Math.max(0, evalT - dt2), params, customProfileData);
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
            <div className="btn-icon-wrapper"><XCircle size={14} /></div>
          </button>
          <button className="export-btn modal-confirm" onClick={onConfirm}>
            <div className="btn-text">EXPORT ANYWAY</div>
            <div className="btn-icon-wrapper"><ArrowUpRight size={14} /></div>
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

  const meshRef       = useRef();
  const rdWorkerRef   = useRef(null);
  const rdDebounceRef = useRef(null);

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
    };
  }, []);

  // ── Controls ───────────────────────────────────────────────────────────
  const params = useControls('Lamp Shape', {
    Profile: folder({
      verticalProfile: { options: ['vase', 'hourglass', 'teardrop', 'pagoda', 'column', 'cone', 'sphere', 'custom'] },
      customUpload: button(() => document.getElementById('hidden-file-input')?.click()),
      crossSection:    { options: ['circle', 'square', 'hexagon', 'triangle', 'star', 'gear'] },
      solidVaseMode:   false,
      closeTop:        false,
      closeBottom:     false,
      height:          { value: 10,  min: 2,   max: 30,  step: 0.1 },
      bottomRadius:    { value: 5,   min: 1,   max: 15,  step: 0.1 },
      midRadius:       { value: 3,   min: 1,   max: 15,  step: 0.1 },
      topRadius:       { value: 4,   min: 1,   max: 15,  step: 0.1 },
      thickness:       { value: 0.5, min: 0.1, max: 2,   step: 0.05 },
    }, { collapsed: true }),

    Resolution: folder({
      verticalSegments: { value: 100, min: 10, max: 800, step: 1,  label: 'Vertical Steps' },
      radialSegments:   { value: 64,  min: 3,  max: 200, step: 1,  label: 'Radial Steps'   },
    }),

    'Print Settings': folder({
      layerHeight: { value: 0.2,  min: 0.08, max: 0.8,  step: 0.04, label: 'Layer Height (mm)' },
      nozzleSize:  { value: 0.4,  min: 0.2,  max: 1.2,  step: 0.1,  label: 'Nozzle Size (mm)'  },
      bedX:        { value: 220,  min: 100,  max: 500,  step: 10,   label: 'Bed X (mm)'         },
      bedY:        { value: 220,  min: 100,  max: 500,  step: 10,   label: 'Bed Y (mm)'         },
    }, { collapsed: true }),

    Modifiers: folder({
      mirrorX:            false,
      mirrorY:            false,
      mirrorZ:            false,
      twistAngle:         { value: 0,   min: 0,   max: Math.PI * 4, step: 0.1,  label: 'Twist'         },
      diamondFreq:        { value: 0,   min: 0,   max: 32,          step: 1,    label: 'Diamond Freq'  },
      diamondDepth:       { value: 0,   min: 0,   max: 3,           step: 0.05, label: 'Diamond Depth' },
      radialRipples:      { value: 0,   min: 0,   max: 32,          step: 1,    label: 'Rib Freq'      },
      radialRippleDepth:  { value: 0,   min: 0,   max: 3,           step: 0.05, label: 'Rib Depth'     },
      verticalRipples:    { value: 0,   min: 0,   max: 32,          step: 1,    label: 'Wave Freq'     },
      verticalRippleDepth:{ value: 0,   min: 0,   max: 3,           step: 0.05, label: 'Wave Depth'    },
      bambooSteps:        { value: 0,   min: 0,   max: 20,          step: 1,    label: 'Bamboo Steps'  },
      bambooVerticalFreq: { value: 0,   min: 0,   max: 64,          step: 1,    label: 'Bamboo Vert'   },
      bambooDepth:        { value: 0,   min: 0,   max: 3,           step: 0.05, label: 'Bamboo Depth'  },
      noiseScale:         { value: 2,   min: 0.1, max: 10,          step: 0.1,  label: 'Perlin Scale'  },
      noiseDepth:         { value: 0,   min: 0,   max: 3,           step: 0.05, label: 'Perlin Depth'  },
    }),

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

    Shaders: folder({
      innerGlowIntensity: { value: 3.0, min: 0, max: 10, step: 0.1  },
      surfaceNoise:       { value: 0.5, min: 0, max: 2,  step: 0.05 },
      iridescence:        { value: 0.5, min: 0, max: 1,  step: 0.05 },
    }, { collapsed: true }),
  });

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
    return analyzeOverhangs(params, customProfileData, rdMap, voronoiMap);
  }, [
    params.height, params.bottomRadius, params.midRadius, params.topRadius,
    params.verticalProfile, params.solidVaseMode, params.mirrorY,
    params.twistAngle, params.radialRipples, params.radialRippleDepth,
    params.verticalRipples, params.verticalRippleDepth,
    params.bambooSteps, params.bambooDepth, params.bambooVerticalFreq,
    params.diamondFreq, params.diamondDepth,
    params.noiseScale, params.noiseDepth,
    params.rdDepth, params.voronoiDepth,
    params.crossSection, params.mirrorX, params.mirrorZ,
    params.layerHeight, params.bedX, params.bedY,
    customProfileData, rdMap, voronoiMap,
  ]);

  // ── Appearance controls ────────────────────────────────────────────────
  const styleParams = useControls('Appearance', {
    material:      { options: ['matte', 'metallic', 'glass'] },
    color:         '#ff6200',
    flatShading:   false,
    environment:   { options: ['studio', 'city', 'warehouse', 'sunset', 'dawn', 'night'] },
    lightIntensity:{ value: 1, min: 0, max: 5, step: 0.1 },
  }, { collapsed: true });

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
  const exportSTL = useCallback(() => {
    if (!meshRef.current) return;

    if (retopoQuality === 'OFF') {
      // Direct export, no retopology
      const stl  = new STLExporter().parse(meshRef.current, { binary: false });
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
  }, [meshRef, retopoQuality]);

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
      params: { ...params },
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
  }, [params, customProfileData, rdMap, voronoiMap]);

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
          <div className="app-title">DENMO_PROJECT:</div>
          <div className="app-subtitle">PARAMETRIC 3D LAMP GENERATOR<br/>OR JUST EXPORT TO G-CODE :)</div>
          {rdComputing && <div className="rd-status">● COMPUTING RD MAP…</div>}
          <button
            className="export-btn"
            style={{ marginTop: 8, fontSize: 10, letterSpacing: '0.18em', opacity: 0.7 }}
            onClick={() => { window.location.hash = '/lampifier'; }}
            aria-label="Open Lamp-ifier — AI model hollowing and E27 hardware prep tool"
          >
            <div className="btn-text">→ LAMP-IFIER</div>
            <div className="btn-icon-wrapper"><ArrowUpRight size={14} aria-hidden="true" /></div>
          </button>
          <button
            className="export-btn"
            style={{ marginTop: 5, fontSize: 10, letterSpacing: '0.18em', opacity: 0.7 }}
            onClick={() => { window.location.hash = '/gcode-editor'; }}
            aria-label="Open G-Code Visual Editor"
          >
            <div className="btn-text">→ G-CODE EDITOR</div>
            <div className="btn-icon-wrapper"><ArrowUpRight size={14} aria-hidden="true" /></div>
          </button>
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
            <div className="btn-icon-wrapper"><ArrowUpRight size={16} aria-hidden="true" /></div>
          </button>
          <button
            className={`export-btn${showOverlay ? ' overlay-active' : ''}`}
            onClick={() => setShowOverlay(v => !v)}
            aria-label="Toggle overhang color overlay"
            aria-pressed={showOverlay}
          >
            <div className="btn-text"><Layers size={12} style={{marginRight:4}} />OVERHANG MAP</div>
            <div className="btn-icon-wrapper"><ArrowUpRight size={16} aria-hidden="true" /></div>
          </button>
          <button
            className={`export-btn${showWireframe ? ' wireframe-active' : ''}`}
            onClick={() => setShowWireframe(v => !v)}
            aria-label="Toggle wireframe polygon mesh view"
            aria-pressed={showWireframe}
          >
            <div className="btn-text"><Grid3x3 size={12} style={{marginRight:4}} />WIREFRAME</div>
            <div className="btn-icon-wrapper"><ArrowUpRight size={16} aria-hidden="true" /></div>
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
                className={`retopo-btn${retopoQuality === q ? ' retopo-active' : ''}`}
                onClick={() => setRetopoQuality(q)}
                aria-pressed={retopoQuality === q}
              >
                {q}
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
              <div className="btn-icon-wrapper"><ArrowUpRight size={16} aria-hidden="true" /></div>
            </button>
            <button
              className={`export-btn${gcodeExporting ? ' btn-computing' : ''}`}
              onClick={exportGCode}
              disabled={gcodeExporting}
              aria-label="Export directly printable G-Code"
            >
              <div className="btn-text">{gcodeExporting ? 'WAIT…' : 'G-CODE'}</div>
              <div className="btn-icon-wrapper"><ArrowUpRight size={16} aria-hidden="true" /></div>
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
            <div className="btn-text">→ LAMP-IFIER</div>
            <div className="btn-icon-wrapper"><ArrowUpRight size={16} aria-hidden="true" /></div>
          </button>
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
          <div className="marquee-content">DENMO Project by Line Collective</div>
        </div>
        <div className="footer-logo">
          <a href="https://www.facebook.com/mark.do2102/" target="_blank" rel="noreferrer"
             style={{ color:'inherit', textDecoration:'none', marginRight:'16px', display:'flex', alignItems:'center', gap:'4px' }}>
            FACEBOOK <ArrowUpRight size={14}/>
          </a>
          <span>DESIGN &amp; DEV BY US</span>
          <div style={{ width:12, height:12, background:'var(--text-primary)' }}/>
          <div style={{ width:12, height:12, background:'var(--text-secondary)' }}/>
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
        <color attach="background" args={['#0a0a0a']} />
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
              params={params}
              customProfileData={customProfileData}
              materialProps={materialProps}
              meshRef={meshRef}
              isGlowing={isGlowing}
              rdMap={rdMap}
              voronoiMap={voronoiMap}
              wireframe={showWireframe}
            />
            {showOverlay && overhangReport && (
              <OverhangOverlayMesh
                params={params}
                customProfileData={customProfileData}
                rdMap={rdMap}
                voronoiMap={voronoiMap}
                perLayerAngles={overhangReport.perLayerAngles}
              />
            )}
            <pointLight
              position={[0, params.height / 2, 0]}
              intensity={isGlowing ? 4.0 : 2.0}
              color={isGlowing ? '#fbbf24' : styleParams.color}
              distance={params.height * 2.5}
            />
          </>
        ) : (
          <GCodeViewer
            params={params}
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
          target={[0, params.height / 2, 0]}
        />
      </Canvas>
    </div>
    </>
  );
}
