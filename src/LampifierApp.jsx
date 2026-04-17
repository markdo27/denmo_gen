import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  Suspense,
} from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, ContactShadows, Center } from '@react-three/drei';
import { useDropzone } from 'react-dropzone';
import * as THREE from 'three';
import { STLLoader } from 'three-stdlib';
import { OBJLoader } from 'three-stdlib';
import { STLExporter } from 'three-stdlib';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import './lampifier.css';

// ─── Constants ──────────────────────────────────────────────────────────────
const E27_TOP_DIAMETER_MM    = 40;   // E27 lamp socket hole diameter
const E27_BOTTOM_DIAMETER_MM = 8;    // Power cord channel diameter
const MM_TO_SCENE            = 0.1;  // 1mm = 0.1 three.js units (so 100mm=10 units)
const DEFAULT_WALL_MM        = 3;    // locked default wall thickness

// ─── Utility: load geometry from file ───────────────────────────────────────
function loadGeometryFromFile(file) {
  return new Promise((resolve, reject) => {
    const ext = file.name.split('.').pop().toLowerCase();
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        let geo;
        if (ext === 'stl') {
          const loader = new STLLoader();
          geo = loader.parse(e.target.result);
        } else if (ext === 'obj') {
          const loader = new OBJLoader();
          const group = loader.parse(e.target.result);
          // Extract first mesh geometry
          geo = null;
          group.traverse((child) => {
            if (!geo && child.isMesh) geo = child.geometry;
          });
          if (!geo) throw new Error('No mesh found in OBJ file.');
        } else {
          throw new Error(`Unsupported format: .${ext}`);
        }

        // Normalise geometry
        geo = geo.toNonIndexed();
        geo.computeVertexNormals();
        geo.computeBoundingBox();
        resolve(geo);
      } catch (err) {
        reject(err);
      }
    };

    reader.onerror = () => reject(new Error('File read failed.'));

    if (ext === 'stl') {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  });
}

// ─── Utility: scale geometry so its Y-height equals targetMm ────────────────
function scaleGeometryToHeight(geo, targetMm) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const currentH = bb.max.y - bb.min.y;
  if (currentH <= 0) return geo;
  const scale = (targetMm * MM_TO_SCENE) / currentH;
  geo.scale(scale, scale, scale);
  geo.computeBoundingBox();
  return geo;
}

// ─── Utility: centre geometry at origin (bottom touching Y=0) ───────────────
function centreGeometry(geo) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const cx = (bb.min.x + bb.max.x) / 2;
  const cy = bb.min.y;
  const cz = (bb.min.z + bb.max.z) / 2;
  geo.translate(-cx, -cy, -cz);
  geo.computeBoundingBox();
  return geo;
}

// ─── CSG hollowing: subtract inward-shrunk copy ──────────────────────────────
async function hollowGeometry(geo, wallMm) {
  try {
    const { CSG } = await import('three-csg-ts');

    // Outer mesh
    const outerMesh = new THREE.Mesh(geo);

    // Inner = shrunk copy
    const innerGeo = geo.clone();
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const h = bb.max.y - bb.min.y;
    const w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
    const wallScene = wallMm * MM_TO_SCENE;
    const innerScale = Math.max(0.01, 1 - (wallScene * 2) / Math.max(w, 0.001));
    innerGeo.scale(innerScale, innerScale, innerScale);
    innerGeo.computeBoundingBox();
    // Keep it bottom-aligned
    const innerBB = innerGeo.boundingBox;
    innerGeo.translate(0, wallScene - innerBB.min.y, 0);

    const innerMesh = new THREE.Mesh(innerGeo);
    const result = CSG.subtract(outerMesh, innerMesh);
    return result.geometry;
  } catch (err) {
    console.warn('CSG hollow failed, using original solid:', err);
    return geo; // non-fatal — fall through to hole cuts
  }
}

// ─── CSG boolean: subtract E27 cylinders ─────────────────────────────────────
async function applyE27Cuts(geo) {
  try {
    const { CSG } = await import('three-csg-ts');

    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const topY    = bb.max.y;
    const bottomY = bb.min.y;
    const centerX = (bb.min.x + bb.max.x) / 2;
    const centerZ = (bb.min.z + bb.max.z) / 2;

    // Top cut: 40mm dia, tall enough to pierce from top
    const topR  = (E27_TOP_DIAMETER_MM / 2) * MM_TO_SCENE;
    const topH  = (bb.max.y - bb.min.y) * 0.6 + 0.5; // deep cut
    const topGeo = new THREE.CylinderGeometry(topR, topR, topH, 48);
    topGeo.translate(centerX, topY - topH / 2 + 0.01, centerZ);
    const topMesh = new THREE.Mesh(topGeo);

    // Bottom cut: 8mm dia, wire channel
    const botR  = (E27_BOTTOM_DIAMETER_MM / 2) * MM_TO_SCENE;
    const botH  = (bb.max.y - bb.min.y) * 0.35 + 0.5;
    const botGeo = new THREE.CylinderGeometry(botR, botR, botH, 24);
    botGeo.translate(centerX, bottomY + botH / 2 - 0.01, centerZ);
    const botMesh = new THREE.Mesh(botGeo);

    // Two subtractions
    const outerMesh = new THREE.Mesh(geo);
    const afterTop  = CSG.subtract(outerMesh, topMesh);
    const afterBot  = CSG.subtract(afterTop, botMesh);
    return afterBot.geometry;
  } catch (err) {
    console.warn('CSG E27 cut failed:', err);
    return geo;
  }
}

// ─── Sub-component: Imported mesh display ────────────────────────────────────
function ImportedMesh({ geometry, color = '#b0b0b0' }) {
  const meshRef = useRef();
  return (
    <mesh ref={meshRef} geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        color={color}
        roughness={0.55}
        metalness={0.1}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// ─── Sub-component: E27 cut preview cylinders ────────────────────────────────
function E27PreviewCylinders({ boundingBox }) {
  if (!boundingBox) return null;

  const bb = boundingBox;
  const topY    = bb.max.y;
  const bottomY = bb.min.y;
  const height  = topY - bottomY;
  const cx = (bb.min.x + bb.max.x) / 2;
  const cz = (bb.min.z + bb.max.z) / 2;

  const topR  = (E27_TOP_DIAMETER_MM / 2) * MM_TO_SCENE;
  const topH  = height * 0.6;
  const botR  = (E27_BOTTOM_DIAMETER_MM / 2) * MM_TO_SCENE;
  const botH  = height * 0.35;

  return (
    <group>
      {/* Top cut — neon green */}
      <mesh position={[cx, topY - topH / 2 + 0.01, cz]}>
        <cylinderGeometry args={[topR, topR, topH, 48]} />
        <meshStandardMaterial
          color="#00ff9d"
          transparent
          opacity={0.35}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Bottom cut — orange */}
      <mesh position={[cx, bottomY + botH / 2 - 0.01, cz]}>
        <cylinderGeometry args={[botR, botR, botH, 24]} />
        <meshStandardMaterial
          color="#ff6800"
          transparent
          opacity={0.4}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

// ─── Sub-component: 3D Viewport scene ────────────────────────────────────────
function ViewportScene({ geometry, showPreview }) {
  const bb = useMemo(() => {
    if (!geometry) return null;
    geometry.computeBoundingBox();
    return geometry.boundingBox.clone();
  }, [geometry]);

  const camTarget = useMemo(() => {
    if (!bb) return [0, 5, 0];
    return [(bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2];
  }, [bb]);

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.6} />
      <directionalLight
        position={[8, 16, 8]}
        intensity={1.4}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <directionalLight position={[-6, 8, -8]} intensity={0.5} color="#8888ff" />
      <pointLight position={[0, 6, 0]} intensity={0.8} color="#ffffff" distance={30} />

      {/* Model */}
      {geometry && (
        <group>
          <ImportedMesh geometry={geometry} />
          {showPreview && <E27PreviewCylinders boundingBox={bb} />}
        </group>
      )}

      {/* Floor */}
      <ContactShadows
        position={[0, -0.01, 0]}
        opacity={0.6}
        scale={40}
        blur={2}
        far={10}
        color="#000000"
      />
      <Grid
        infiniteGrid
        fadeDistance={50}
        sectionColor="#333333"
        cellColor="#1a1a1a"
        cellSize={1}
        sectionSize={5}
        position={[0, -0.02, 0]}
      />

      <OrbitControls
        makeDefault
        minPolarAngle={0}
        maxPolarAngle={Math.PI / 2 + 0.15}
        target={camTarget}
      />
    </>
  );
}

// ─── Main Lamp-ifier App Component ───────────────────────────────────────────
export default function LampifierApp() {
  const [loadedGeo, setLoadedGeo]       = useState(null);
  const [fileName, setFileName]         = useState('');
  const [heightMm, setHeightMm]         = useState(150);
  const [wallMm]                        = useState(DEFAULT_WALL_MM); // locked
  const [showPreview, setShowPreview]   = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMsg, setProcessingMsg] = useState('');
  const [error, setError]               = useState('');
  const [statusState, setStatusState]   = useState('idle'); // idle | ready | processing | error

  // Clear error toast after 5s
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 5000);
    return () => clearTimeout(t);
  }, [error]);

  // ── File drop ──────────────────────────────────────────────────────────────
  const onDrop = useCallback(async (acceptedFiles) => {
    const file = acceptedFiles[0];
    if (!file) return;

    setIsProcessing(true);
    setProcessingMsg('LOADING GEOMETRY…');
    setStatusState('processing');
    setError('');

    try {
      let geo = await loadGeometryFromFile(file);
      geo = centreGeometry(geo);
      geo = scaleGeometryToHeight(geo, heightMm);
      setLoadedGeo(geo);
      setFileName(file.name);
      setStatusState('ready');
    } catch (err) {
      setError(`Load failed: ${err.message}`);
      setStatusState('error');
    } finally {
      setIsProcessing(false);
    }
  }, [heightMm]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'model/stl': ['.stl'], 'text/plain': ['.obj'] },
    multiple: false,
  });

  // ── Height change — rescale live ──────────────────────────────────────────
  const handleHeightChange = useCallback((newH) => {
    setHeightMm(newH);
    if (!loadedGeo) return;
    const clone = loadedGeo.clone();
    centreGeometry(clone);
    scaleGeometryToHeight(clone, newH);
    setLoadedGeo(clone);
  }, [loadedGeo]);

  // ── Export ────────────────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (!loadedGeo) return;

    setIsProcessing(true);
    setProcessingMsg('HOLLOWING MESH…');
    setStatusState('processing');

    try {
      let geo = loadedGeo.clone();

      // Step 1: Shell
      setProcessingMsg('SHELLING — WALL ' + wallMm + 'MM…');
      geo = await hollowGeometry(geo, wallMm);
      geo.computeBoundingBox();
      centreGeometry(geo);

      // Step 2: E27 cuts
      setProcessingMsg('CUTTING E27 HOLES…');
      geo = await applyE27Cuts(geo);

      // Step 3: Export
      setProcessingMsg('EXPORTING STL…');
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
      mesh.updateMatrixWorld(true);

      const exporter = new STLExporter();
      const stlString = exporter.parse(mesh, { binary: false });
      const blob = new Blob([stlString], { type: 'text/plain' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `lampified_${Date.now()}.stl`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setStatusState('ready');
    } catch (err) {
      setError(`Export failed: ${err.message}`);
      setStatusState('error');
    } finally {
      setIsProcessing(false);
      setProcessingMsg('');
    }
  }, [loadedGeo, wallMm]);

  // ─── Bounding-box info for display ───────────────────────────────────────
  const bbInfo = useMemo(() => {
    if (!loadedGeo) return null;
    loadedGeo.computeBoundingBox();
    const bb = loadedGeo.boundingBox;
    const toMm = (v) => (v / MM_TO_SCENE).toFixed(1);
    return {
      w: toMm(bb.max.x - bb.min.x),
      h: toMm(bb.max.y - bb.min.y),
      d: toMm(bb.max.z - bb.min.z),
    };
  }, [loadedGeo]);

  // ─── Status label ─────────────────────────────────────────────────────────
  const statusLabel = {
    idle:       'Awaiting file…',
    ready:      'Model ready',
    processing: processingMsg || 'Processing…',
    error:      'Error — see below',
  }[statusState];

  return (
    <div className="lf-root">
      {/* Navigation */}
      <nav className="lf-nav" role="navigation" aria-label="App navigation">
        <a
          href="#/"
          className="lf-nav-logo"
          aria-label="Go to parametric lamp generator"
        >
          DENMO_PROJECT
        </a>
        <div className="lf-nav-divider" aria-hidden="true" />
        <button
          className="lf-nav-link"
          onClick={() => { window.location.hash = '/'; }}
          aria-label="Parametric Generator"
        >
          GENERATOR
        </button>
        <button
          className="lf-nav-link active"
          aria-current="page"
        >
          LAMP-IFIER
        </button>
        <span className="lf-nav-badge" aria-hidden="true">BETA v0.1</span>
      </nav>

      <div className="lf-layout">
        {/* ── Left Control Panel ── */}
        <aside className="lf-panel" aria-label="Lamp-ifier controls">

          {/* 1. Import */}
          <div className="lf-section">
            <div className="lf-section-header">01 — Import Model</div>
            <div
              {...getRootProps()}
              className={`lf-dropzone${isDragActive ? ' active' : ''}`}
              role="button"
              aria-label="Drop STL or OBJ file here, or click to browse"
              tabIndex={0}
            >
              <input {...getInputProps()} />
              <svg className="lf-dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M12 16V4m0 0L8 8m4-4l4 4" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round"/>
              </svg>
              {fileName ? (
                <div className="lf-file-name" aria-live="polite">{fileName}</div>
              ) : (
                <>
                  <div className="lf-dropzone-label">Drop .STL or .OBJ here</div>
                  <div className="lf-dropzone-sub">or click to browse</div>
                </>
              )}
            </div>

            {/* Status */}
            <div className="lf-status" aria-live="polite">
              <div className={`lf-status-dot ${statusState === 'ready' ? 'ready' : statusState === 'processing' ? 'processing' : statusState === 'error' ? 'error' : ''}`} aria-hidden="true" />
              <span>{statusLabel}</span>
            </div>

            {/* Dimensions readout */}
            {bbInfo && (
              <div className="lf-field">
                <div className="lf-label" style={{ color: 'var(--lf-text-3)', marginTop: 4 }}>
                  <span>Dimensions (mm)</span>
                  <span style={{ color: 'var(--lf-text-2)', fontSize: 10 }}>
                    {bbInfo.w} × {bbInfo.h} × {bbInfo.d}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 2. Scale */}
          <div className="lf-section">
            <div className="lf-section-header">02 — Physical Scale</div>
            <div className="lf-field">
              <div className="lf-label">
                <span>Physical Height</span>
                <span className="lf-label-value">{heightMm} mm</span>
              </div>
              <input
                type="range"
                className="lf-range"
                min={50}
                max={500}
                step={5}
                value={heightMm}
                onChange={(e) => handleHeightChange(Number(e.target.value))}
                aria-label={`Physical height in millimetres: ${heightMm}`}
              />
              <div className="lf-label" style={{ marginTop: 6, marginBottom: 0 }}>
                <span style={{ color: 'var(--lf-text-3)' }}>50mm</span>
                <span style={{ color: 'var(--lf-text-3)' }}>500mm</span>
              </div>
            </div>
          </div>

          {/* 3. Shell */}
          <div className="lf-section">
            <div className="lf-section-header">03 — Shell (Hollow)</div>
            <div className="lf-field">
              <div className="lf-label">
                <span>Wall Thickness</span>
                <span className="lf-label-value">{wallMm} mm</span>
              </div>
              <div className="lf-locked-row">
                <input
                  type="number"
                  className="lf-input"
                  value={wallMm}
                  disabled
                  aria-label="Wall thickness locked at 3mm for optimal 3D printing"
                />
                <span className="lf-lock-badge">LOCKED</span>
              </div>
              <div className="lf-label" style={{ marginTop: 8, marginBottom: 0, color: 'var(--lf-text-3)', fontSize: 9 }}>
                3mm optimal for FDM PLA structural integrity
              </div>
            </div>
          </div>

          {/* 4. E27 Hardware Booleans */}
          <div className="lf-section">
            <div className="lf-section-header">04 — E27 Hardware Cuts</div>
            <div className="lf-toggle-row">
              <span className="lf-toggle-label">Preview Cuts</span>
              <label className="lf-toggle" aria-label="Toggle cut preview cylinders">
                <input
                  type="checkbox"
                  checked={showPreview}
                  onChange={(e) => setShowPreview(e.target.checked)}
                />
                <div className="lf-toggle-track" />
                <div className="lf-toggle-knob" />
              </label>
            </div>
            <div className="lf-cut-card">
              <div className="lf-cut-dot top" aria-hidden="true" />
              <div className="lf-cut-info">
                <div className="lf-cut-name">Top Socket Cut</div>
                <div className="lf-cut-spec">∅40mm · E27 pendant socket · Top-center</div>
              </div>
            </div>
            <div className="lf-cut-card">
              <div className="lf-cut-dot bottom" aria-hidden="true" />
              <div className="lf-cut-info">
                <div className="lf-cut-name">Bottom Cord Channel</div>
                <div className="lf-cut-spec">∅8mm · Power cord feed · Bottom-center</div>
              </div>
            </div>
          </div>

          {/* 5. Export */}
          <div className="lf-section">
            <div className="lf-section-header">05 — Export</div>
            <button
              className="lf-btn primary"
              onClick={handleExport}
              disabled={!loadedGeo || isProcessing}
              aria-label="Execute Boolean operations and export print-ready STL"
            >
              <span>Export Print-Ready STL</span>
              <span className="lf-btn-arrow" aria-hidden="true">↗</span>
            </button>
            <div className="lf-label" style={{ marginTop: 8, color: 'var(--lf-text-3)', fontSize: 9, textTransform: 'none', letterSpacing: '0.05em' }}>
              Executes: hollow → top cut → bottom cut → STL download
            </div>
          </div>

          {/* Safety Warning — always visible */}
          <div className="lf-section" style={{ marginTop: 'auto' }}>
            <div className="lf-warning" role="alert" aria-label="Safety warning">
              <div className="lf-warning-icon" aria-hidden="true">⚠</div>
              <div className="lf-warning-body">
                <div className="lf-warning-title">Safety Mandate</div>
                <div className="lf-warning-text">
                  WARNING: 3D Printed enclosures are for <strong>LED BULBS ONLY</strong>.
                  Incandescent bulbs will melt the PLA and pose a severe
                  <strong> fire hazard</strong>. Never use with bulbs exceeding 10W.
                </div>
              </div>
            </div>
          </div>

        </aside>

        {/* ── Right Viewport ── */}
        <main className="lf-viewport" role="main" aria-label="3D model viewport">
          {/* Corner labels */}
          <div className="lf-corner-label top-left" aria-hidden="true">LAMP-IFIER · VIEWPORT</div>
          <div className="lf-corner-label top-right" aria-hidden="true">
            {loadedGeo ? `${heightMm}MM TARGET HEIGHT` : 'NO MODEL LOADED'}
          </div>
          <div className="lf-corner-label bot-left" aria-hidden="true">ORBIT: DRAG · ZOOM: SCROLL · PAN: RMB</div>
          <div className="lf-corner-label bot-right" aria-hidden="true">
            {showPreview ? '⬤ E27 PREVIEW ON' : '○ E27 PREVIEW OFF'}
          </div>

          {/* Empty state overlay */}
          {!loadedGeo && !isProcessing && (
            <div className="lf-viewport-overlay">
              <div className="lf-empty-state">
                <svg className="lf-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
                  <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                  <path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>
                </svg>
                <div className="lf-empty-title">No Model Loaded</div>
                <div className="lf-empty-sub">Drop an STL or OBJ file in the left panel</div>
              </div>
            </div>
          )}

          {/* Processing overlay */}
          {isProcessing && (
            <div className="lf-processing-overlay" role="status" aria-label={processingMsg || 'Processing'}>
              <div className="lf-processing-spinner" aria-hidden="true" />
              <div className="lf-processing-text">{processingMsg || 'PROCESSING…'}</div>
            </div>
          )}

          {/* 3D Canvas */}
          <Canvas
            shadows
            camera={{ position: [0, 10, 25], fov: 45 }}
            dpr={[1, 2]}
            aria-label="3D lamp model viewport"
            style={{ background: '#080808' }}
          >
            <color attach="background" args={['#080808']} />
            <Suspense fallback={null}>
              <ViewportScene geometry={loadedGeo} showPreview={showPreview} />
            </Suspense>
          </Canvas>
        </main>
      </div>

      {/* Error Toast */}
      {error && (
        <div className="lf-toast" role="alert" aria-live="assertive">
          ⚠ {error}
        </div>
      )}
    </div>
  );
}
