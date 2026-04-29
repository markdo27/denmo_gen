import React, {
  useState, useEffect, useRef, useMemo, useCallback, Suspense,
} from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { useDropzone } from 'react-dropzone';
import * as THREE from 'three';
import './gcode-editor.css';

// ─── Constants ───────────────────────────────────────────────────────────────
const SCALE     = 0.1;   // 1mm → 0.1 scene units
const MAX_UNDO  = 50;

const FEATURE_COLORS = {
  'outer_wall':       '#00d4ff',
  'outer wall':       '#00d4ff',
  'wall-outer':       '#00d4ff',
  'perimeter':        '#00d4ff',
  'inner_wall':       '#4477ee',
  'inner wall':       '#4477ee',
  'wall-inner':       '#4477ee',
  'infill':           '#1e3a55',
  'fill':             '#1e3a55',
  'top_solid_infill': '#6688cc',
  'top solid infill': '#6688cc',
  'solid infill':     '#6688cc',
  'skin':             '#6688cc',
  'support':          '#663333',
  'support_material': '#663333',
  'bridge':           '#aa8800',
  'bridge infill':    '#aa8800',
  'skirt':            '#444444',
  'brim':             '#444444',
  'raft':             '#444444',
  'travel':           '#1a1a1a',
  'unknown':          '#335577',
};

const FEATURE_LABELS = {
  'outer_wall':       'Outer Wall',
  'wall-outer':       'Outer Wall',
  'inner_wall':       'Inner Wall',
  'wall-inner':       'Inner Wall',
  'infill':           'Infill',
  'fill':             'Infill',
  'top_solid_infill': 'Top Skin',
  'solid infill':     'Top Skin',
  'skin':             'Top Skin',
  'support':          'Support',
  'support_material': 'Support',
  'bridge':           'Bridge',
  'bridge infill':    'Bridge',
  'skirt':            'Skirt/Brim',
  'brim':             'Skirt/Brim',
};

// ─── G-code Parser ───────────────────────────────────────────────────────────
function parseGcode(text) {
  const lines     = text.split('\n');
  const moves     = [];
  const layers    = [];
  let x = 0, y = 0, z = 0, e = 0;
  let isAbsXY = true, isAbsE = true;
  let feature     = 'unknown';
  let layerIdx    = -1;
  let pendingLayer = false;

  const stats = {
    minX: Infinity, maxX: -Infinity,
    minY: Infinity, maxY: -Infinity,
    maxZ: 0, features: new Set(), totalMoves: 0, extrudedMoves: 0,
  };

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    let raw = lines[lineIdx];
    const ci  = raw.indexOf(';');
    const comment = ci >= 0 ? raw.slice(ci + 1).trim() : '';
    const line = (ci >= 0 ? raw.slice(0, ci) : raw).trim();

    // ── Feature / layer comments ──────────────────────────────────────────
    if (comment) {
      const lc = comment.toLowerCase();
      if (lc.startsWith('type:')) {
        feature = lc.slice(5).trim().replace(/\s+/g, '_');
        stats.features.add(feature);
      }
      if (lc.startsWith('layer_change') || lc.startsWith('layer:')) {
        pendingLayer = true;
      }
    }

    if (!line) continue;

    const parts = line.split(/\s+/);
    const cmd   = parts[0].toUpperCase();

    if (cmd === 'G90') { isAbsXY = true;  continue; }
    if (cmd === 'G91') { isAbsXY = false; continue; }
    if (cmd === 'M82') { isAbsE  = true;  continue; }
    if (cmd === 'M83') { isAbsE  = false; continue; }

    if (cmd === 'G1' || cmd === 'G0') {
      const p = {};
      for (let i = 1; i < parts.length; i++) {
        const key = parts[i][0].toUpperCase();
        const val = parseFloat(parts[i].slice(1));
        if (!isNaN(val)) p[key] = val;
      }
      const prevX = x, prevY = y, prevZ = z, prevE = e;

      if ('X' in p) x = isAbsXY ? p.X : x + p.X;
      if ('Y' in p) y = isAbsXY ? p.Y : y + p.Y;

      if ('Z' in p) {
        const nz = isAbsXY ? p.Z : z + p.Z;
        if (nz !== z) {
          z = nz;
          if (pendingLayer || nz > prevZ) {
            layerIdx++;
            layers.push({ z: nz, startMoveIdx: moves.length });
            if (layerIdx > 0) layers[layerIdx - 1].endMoveIdx = moves.length;
          }
          pendingLayer = false;
        }
      }

      if ('E' in p) e = isAbsE ? p.E : e + p.E;

      const isExtrusion = 'E' in p && (isAbsE ? p.E > prevE : p.E > 0);
      const isTravel    = cmd === 'G0' || !isExtrusion;

      if (x !== prevX || y !== prevY || z !== prevZ) {
        const move = {
          x, y, z, prevX, prevY, prevZ,
          isTravel, feature: isTravel ? 'travel' : feature,
          layerIdx: Math.max(0, layerIdx),
          lineIdx,
          globalIdx: moves.length,
        };
        moves.push(move);
        stats.totalMoves++;
        if (!isTravel) {
          stats.extrudedMoves++;
          stats.minX = Math.min(stats.minX, x, prevX);
          stats.maxX = Math.max(stats.maxX, x, prevX);
          stats.minY = Math.min(stats.minY, y, prevY);
          stats.maxY = Math.max(stats.maxY, y, prevY);
          stats.maxZ = Math.max(stats.maxZ, z);
        }
      }
    }
  }

  if (layers.length > 0) layers[layers.length - 1].endMoveIdx = moves.length;
  if (layerIdx < 0) { layerIdx = 0; layers.push({ z: 0, startMoveIdx: 0, endMoveIdx: moves.length }); }

  stats.totalLayers = layers.length;
  if (!isFinite(stats.minX)) { stats.minX = 0; stats.maxX = 220; }
  if (!isFinite(stats.minY)) { stats.minY = 0; stats.maxY = 220; }

  // Center offsets
  const cx = (stats.minX + stats.maxX) / 2;
  const cy = (stats.minY + stats.maxY) / 2;

  // Precompute per-layer segment end counts (for drawRange)
  const filteredMoves    = moves.filter(m => !m.isTravel);
  const layerSegmentEnds = new Array(layers.length).fill(0);
  let seg = 0;
  let li  = 0;
  for (let mi = 0; mi < filteredMoves.length; mi++) {
    const m = filteredMoves[mi];
    while (li < layers.length - 1 && m.globalIdx >= layers[li + 1].startMoveIdx) {
      layerSegmentEnds[li] = seg; li++;
    }
    seg++;
  }
  for (; li < layers.length; li++) layerSegmentEnds[li] = seg;

  return { moves, layers, stats, cx, cy, layerSegmentEnds };
}

// ─── Geometry Builder ────────────────────────────────────────────────────────
function buildSegmentGeometry(moves, cx, cy, showTravel) {
  const visible = showTravel ? moves : moves.filter(m => !m.isTravel);
  const count   = visible.length;
  const pos     = new Float32Array(count * 6);
  const col     = new Float32Array(count * 6);
  const c       = new THREE.Color();

  visible.forEach((m, i) => {
    const k = i * 6;
    pos[k]   = (m.prevX - cx) * SCALE; pos[k+1] = m.prevZ * SCALE; pos[k+2] = (m.prevY - cy) * SCALE;
    pos[k+3] = (m.x    - cx) * SCALE; pos[k+4] = m.z    * SCALE; pos[k+5] = (m.y    - cy) * SCALE;
    c.set(FEATURE_COLORS[m.feature] || FEATURE_COLORS.unknown);
    col[k]=c.r; col[k+1]=c.g; col[k+2]=c.b; col[k+3]=c.r; col[k+4]=c.g; col[k+5]=c.b;
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(col, 3));
  return geo;
}

// ─── GcodeLines ──────────────────────────────────────────────────────────────
function GcodeLines({ moves, cx, cy, showTravel, currentLayer, layerSegmentEnds }) {
  const geoRef = useRef(null);
  const matRef = useRef(null);
  const lineRef = useRef(null);

  // Build or rebuild geometry when moves / travel / centering change
  useEffect(() => {
    if (!moves || moves.length === 0) return;
    const newGeo = buildSegmentGeometry(moves, cx, cy, showTravel);
    if (geoRef.current) geoRef.current.dispose();
    geoRef.current = newGeo;
    if (lineRef.current) lineRef.current.geometry = newGeo;
  }, [moves, cx, cy, showTravel]);

  // Update drawRange on layer scrub (cheap, no geometry rebuild)
  useEffect(() => {
    if (!geoRef.current || !layerSegmentEnds || layerSegmentEnds.length === 0) return;
    const endSeg = layerSegmentEnds[Math.min(currentLayer, layerSegmentEnds.length - 1)] ?? 0;
    geoRef.current.setDrawRange(0, endSeg * 2);
  }, [currentLayer, layerSegmentEnds]);

  // Cleanup
  useEffect(() => () => { geoRef.current?.dispose(); matRef.current?.dispose(); }, []);

  // Build initial objects imperatively to avoid R3F re-create issues
  const { group } = useMemo(() => {
    const mat  = new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 1 });
    const geo  = new THREE.BufferGeometry();
    const line = new THREE.LineSegments(geo, mat);
    matRef.current = mat;
    lineRef.current = line;
    const grp = new THREE.Group();
    grp.add(line);
    return { group: grp };
  }, []);

  return <primitive object={group} />;
}

// ─── SelectedPoints (InstancedMesh) ─────────────────────────────────────────
function SelectedPoints({ moves, selection, cx, cy }) {
  const count = selection.size;
  if (count === 0) return null;
  return <SelectedPointsInner moves={moves} selection={selection} cx={cx} cy={cy} key={count} />;
}

function SelectedPointsInner({ moves, selection, cx, cy, count }) {
  const ref = useRef();
  useEffect(() => {
    if (!ref.current) return;
    const mat = new THREE.Matrix4();
    let i = 0;
    for (const idx of selection) {
      const m = moves[idx];
      if (!m) continue;
      mat.setPosition((m.x - cx) * SCALE, m.z * SCALE, (m.y - cy) * SCALE);
      ref.current.setMatrixAt(i++, mat);
    }
    ref.current.count = i;
    ref.current.instanceMatrix.needsUpdate = true;
  }, [moves, selection, cx, cy]);

  return (
    <instancedMesh ref={ref} args={[null, null, selection.size]}>
      <sphereGeometry args={[0.28, 6, 4]} />
      <meshBasicMaterial color="#f5a623" />
    </instancedMesh>
  );
}

// ─── Selection Volume (invisible clickable mesh for brush tool) ──────────────
function SelectionVolume({ stats, cx, cy, gcData, brushRadius, onBrushClick }) {
  const sizeX = (stats.maxX - stats.minX) * SCALE + 40;
  const sizeY = stats.maxZ * SCALE + 20;
  const sizeZ = (stats.maxY - stats.minY) * SCALE + 40;

  const handleClick = useCallback((e) => {
    e.stopPropagation();
    const hit = e.point;
    const r   = brushRadius * SCALE;
    const r2  = r * r;
    const hits = new Set();
    for (const m of gcData.moves) {
      if (m.isTravel) continue;
      const dx = (m.x - cx) * SCALE - hit.x;
      const dy = m.z * SCALE         - hit.y;
      const dz = (m.y - cy) * SCALE - hit.z;
      if (dx*dx + dy*dy + dz*dz <= r2) hits.add(m.globalIdx);
    }
    onBrushClick(hits, e.shiftKey);
  }, [brushRadius, cx, cy, gcData, onBrushClick]);

  return (
    <mesh onPointerDown={handleClick}>
      <boxGeometry args={[sizeX, sizeY, sizeZ]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

// ─── PrintBed ────────────────────────────────────────────────────────────────
function PrintBed({ stats }) {
  const w = Math.max((stats.maxX - stats.minX) * SCALE + 4, 20);
  const d = Math.max((stats.maxY - stats.minY) * SCALE + 4, 20);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.015, 0]}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#0c0c0c" />
      </mesh>
      <lineLoop>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array([
              -w/2, -0.01, -d/2,  w/2, -0.01, -d/2,
               w/2, -0.01,  d/2, -w/2, -0.01,  d/2,
            ]), 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#2a2a2a" />
      </lineLoop>
    </group>
  );
}

// ─── Editor Scene ────────────────────────────────────────────────────────────
function EditorScene({
  gcData, currentLayer, showTravel, activeTool,
  brushRadius, selection, onBrushClick,
}) {
  const orbitRef = useRef();

  useEffect(() => {
    if (orbitRef.current) {
      orbitRef.current.enabled = activeTool === 'orbit' || activeTool === 'transform' || activeTool === 'pattern';
    }
  }, [activeTool]);

  const camTarget = useMemo(() => {
    if (!gcData) return new THREE.Vector3(0, 0, 0);
    const { stats, cx, cy } = gcData;
    return new THREE.Vector3(0, stats.maxZ * SCALE / 2, 0);
  }, [gcData]);

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 18, 10]} intensity={1} />
      <directionalLight position={[-8, 10, -10]} intensity={0.3} color="#6688aa" />

      {gcData && (
        <>
          <GcodeLines
            moves={gcData.moves}
            cx={gcData.cx} cy={gcData.cy}
            showTravel={showTravel}
            currentLayer={currentLayer}
            layerSegmentEnds={gcData.layerSegmentEnds}
          />
          <SelectedPoints moves={gcData.moves} selection={selection} cx={gcData.cx} cy={gcData.cy} />
          {activeTool === 'brush' && (
            <SelectionVolume
              stats={gcData.stats} cx={gcData.cx} cy={gcData.cy}
              gcData={gcData} brushRadius={brushRadius}
              onBrushClick={onBrushClick}
            />
          )}
          <PrintBed stats={gcData.stats} />
        </>
      )}

      <Grid
        infiniteGrid
        fadeDistance={50}
        sectionColor="#1e1e1e"
        cellColor="#141414"
        cellSize={1}
        sectionSize={5}
        position={[0, -0.02, 0]}
      />
      <OrbitControls ref={orbitRef} makeDefault target={camTarget} />
    </>
  );
}

// ─── Utility: export modified G-code ────────────────────────────────────────
function exportGcode(rawText, originalMoves, currentMoves) {
  const lines = rawText.split('\n');
  for (let i = 0; i < currentMoves.length; i++) {
    const orig = originalMoves[i];
    const curr = currentMoves[i];
    if (Math.abs(orig.x - curr.x) < 0.0001 && Math.abs(orig.y - curr.y) < 0.0001 && Math.abs(orig.z - curr.z) < 0.0001) continue;
    let line = lines[curr.lineIdx] || '';
    if (Math.abs(orig.x - curr.x) > 0.0001) line = line.replace(/X-?[\d.]+/, `X${curr.x.toFixed(3)}`);
    if (Math.abs(orig.y - curr.y) > 0.0001) line = line.replace(/Y-?[\d.]+/, `Y${curr.y.toFixed(3)}`);
    if (Math.abs(orig.z - curr.z) > 0.0001) line = line.replace(/Z-?[\d.]+/, `Z${curr.z.toFixed(3)}`);
    lines[curr.lineIdx] = line;
  }
  return lines.join('\n');
}

// ─── Main App ────────────────────────────────────────────────────────────────
export default function GcodeEditorApp() {
  // ── State ────────────────────────────────────────────────────────────────
  const [fileName,     setFileName]     = useState('');
  const [gcData,       setGcData]       = useState(null);   // parsed gcode
  const [currentLayer, setCurrentLayer] = useState(0);
  const [showTravel,   setShowTravel]   = useState(false);
  const [colorMode,    setColorMode]    = useState('feature');

  // Tools
  const [activeTool,  setActiveTool]  = useState('orbit');
  const [brushRadius, setBrushRadius] = useState(10);
  const [patternCfg, setPatternCfg]   = useState({ mode: 'nth', n: 10, zMin: 0, zMax: 20, feature: 'outer_wall' });
  const [transformStep, setTransformStep] = useState(1);

  // Selection
  const [selection, setSelection] = useState(new Set());

  // UI
  const [isLoading,    setIsLoading]    = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [showRight,    setShowRight]    = useState(false);
  const [error,        setError]        = useState('');

  // Refs
  const rawTextRef       = useRef('');
  const originalMovesRef = useRef([]);  // snapshot of moves at load time (for export diff)
  const historyRef       = useRef([]);  // [{changedIndices, oldPositions}]

  // Error auto-dismiss
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 5000);
    return () => clearTimeout(t);
  }, [error]);

  // ── File Loading ─────────────────────────────────────────────────────────
  const onDrop = useCallback(async (files) => {
    const file = files[0];
    if (!file) return;
    setIsLoading(true);
    setLoadProgress(10);
    setError('');
    try {
      const ext = file.name.split('.').pop().toLowerCase();
      if (!['gcode', 'gc', 'g', '3mf', 'ufp', 'zip'].includes(ext)) {
        throw new Error(`Unsupported file type: .${ext}. Use .gcode, .3mf, or .ufp`);
      }
      let text = '';

      if (ext === 'gcode' || ext === 'gc' || ext === 'g') {
        text = await file.text();
      } else {
        // Unpack zip with fflate
        const { unzip } = await import('fflate');
        const buf = await file.arrayBuffer();
        const zip = await new Promise((res, rej) =>
          unzip(new Uint8Array(buf), (err, data) => err ? rej(err) : res(data))
        );
        // Find first .gcode inside the zip
        const gcKey = Object.keys(zip).find(k => k.endsWith('.gcode'));
        if (!gcKey) throw new Error('No .gcode file found inside the archive.');
        text = new TextDecoder().decode(zip[gcKey]);
      }

      setLoadProgress(40);
      rawTextRef.current = text;

      // Parse in a timeout to keep the loading spinner visible
      await new Promise(r => setTimeout(r, 30));
      setLoadProgress(60);
      const parsed = parseGcode(text);
      setLoadProgress(90);

      await new Promise(r => setTimeout(r, 20));
      originalMovesRef.current = parsed.moves.map(m => ({ ...m }));
      historyRef.current = [];
      setGcData(parsed);
      setCurrentLayer(Math.max(0, parsed.layers.length - 1));
      setSelection(new Set());
      setFileName(file.name);
      setLoadProgress(100);
    } catch (err) {
      setError(`Load failed: ${err.message}`);
    } finally {
      setIsLoading(false);
      setLoadProgress(0);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, multiple: false,
  });

  // ── History / Undo ───────────────────────────────────────────────────────
  const pushHistory = useCallback((changedIndices, oldPositions) => {
    const entry = { changedIndices: new Set(changedIndices), oldPositions };
    historyRef.current.push(entry);
    if (historyRef.current.length > MAX_UNDO) historyRef.current.shift();
  }, []);

  const handleUndo = useCallback(() => {
    if (!gcData || historyRef.current.length === 0) return;
    const entry = historyRef.current.pop();
    setGcData(prev => {
      const newMoves = [...prev.moves];
      for (const idx of entry.changedIndices) {
        newMoves[idx] = { ...newMoves[idx], ...entry.oldPositions[idx] };
      }
      return { ...prev, moves: newMoves };
    });
  }, [gcData]);

  // ── Selection ────────────────────────────────────────────────────────────
  const handleBrushClick = useCallback((hits, additive) => {
    if (hits.size === 0) return;
    setSelection(prev => {
      if (additive) {
        const next = new Set(prev);
        hits.forEach(i => next.add(i));
        return next;
      }
      return new Set(hits);
    });
  }, []);

  const applyPatternSelect = useCallback(() => {
    if (!gcData) return;
    const extruded = gcData.moves.filter(m => !m.isTravel);
    const next = new Set();
    const { mode, n, zMin, zMax, feature } = patternCfg;
    if (mode === 'nth') {
      extruded.forEach((m, i) => { if (i % n === 0) next.add(m.globalIdx); });
    } else if (mode === 'height') {
      extruded.forEach(m => { if (m.z >= zMin && m.z <= zMax) next.add(m.globalIdx); });
    } else if (mode === 'feature') {
      const target = feature.toLowerCase().replace(/\s+/g, '_');
      gcData.moves.forEach(m => {
        const mf = m.feature.toLowerCase().replace(/\s+/g, '_');
        if (mf === target || mf.includes(target.split('_')[0])) next.add(m.globalIdx);
      });
    }
    setSelection(next);
  }, [gcData, patternCfg]);

  // ── Transform ────────────────────────────────────────────────────────────
  const applyTransform = useCallback((axis, amount) => {
    if (!gcData || selection.size === 0) return;
    const oldPositions = {};
    const indices = [...selection];
    indices.forEach(idx => {
      const m = gcData.moves[idx];
      if (m) oldPositions[idx] = { x: m.x, y: m.y, z: m.z };
    });
    pushHistory(indices, oldPositions);
    setGcData(prev => {
      const newMoves = [...prev.moves];
      indices.forEach(idx => {
        if (!newMoves[idx]) return;
        newMoves[idx] = { ...newMoves[idx], [axis]: newMoves[idx][axis] + amount };
      });
      return { ...prev, moves: newMoves };
    });
  }, [gcData, selection, pushHistory]);

  // ── Operations ───────────────────────────────────────────────────────────
  const applyRedistribute = useCallback(() => {
    if (!gcData || selection.size < 3) {
      setError('Select at least 3 points to redistribute.'); return;
    }
    const sorted = [...selection].sort((a, b) => a - b);
    const moves  = gcData.moves;
    const first  = moves[sorted[0]];
    const last   = moves[sorted[sorted.length - 1]];
    // Compute total arc length
    let totalLen = 0;
    sorted.forEach((idx, i) => {
      if (i === 0) return;
      const a = moves[sorted[i - 1]], b = moves[idx];
      totalLen += Math.sqrt((b.x-a.x)**2 + (b.y-a.y)**2 + (b.z-a.z)**2);
    });
    const step = totalLen / (sorted.length - 1);
    const oldPositions = {};
    sorted.forEach(idx => {
      const m = moves[idx];
      oldPositions[idx] = { x: m.x, y: m.y, z: m.z };
    });
    pushHistory(sorted, oldPositions);
    setGcData(prev => {
      const newMoves = [...prev.moves];
      let accLen = 0;
      sorted.forEach((idx, i) => {
        if (i === 0 || i === sorted.length - 1) return;
        const target = step * i;
        // Walk through selected moves to find interpolated position
        let walkLen = 0;
        for (let j = 0; j < sorted.length - 1; j++) {
          const a = prev.moves[sorted[j]], b = prev.moves[sorted[j + 1]];
          const segLen = Math.sqrt((b.x-a.x)**2 + (b.y-a.y)**2 + (b.z-a.z)**2);
          if (walkLen + segLen >= target) {
            const t = (target - walkLen) / (segLen || 1);
            newMoves[idx] = {
              ...newMoves[idx],
              x: a.x + t * (b.x - a.x),
              y: a.y + t * (b.y - a.y),
              z: a.z + t * (b.z - a.z),
            };
            break;
          }
          walkLen += segLen;
        }
      });
      return { ...prev, moves: newMoves };
    });
  }, [gcData, selection, pushHistory]);

  const applySmooth = useCallback(() => {
    if (!gcData || selection.size < 3) {
      setError('Select at least 3 points to smooth.'); return;
    }
    const sorted = [...selection].sort((a, b) => a - b);
    const moves  = gcData.moves;
    const oldPositions = {};
    sorted.forEach(idx => {
      const m = moves[idx];
      oldPositions[idx] = { x: m.x, y: m.y, z: m.z };
    });
    pushHistory(sorted, oldPositions);
    setGcData(prev => {
      const newMoves = [...prev.moves];
      // Simple Laplacian smooth — skip first and last
      for (let i = 1; i < sorted.length - 1; i++) {
        const prev_m = prev.moves[sorted[i - 1]];
        const next_m = prev.moves[sorted[i + 1]];
        const curr_m = prev.moves[sorted[i]];
        newMoves[sorted[i]] = {
          ...curr_m,
          x: curr_m.x * 0.5 + (prev_m.x + next_m.x) * 0.25,
          y: curr_m.y * 0.5 + (prev_m.y + next_m.y) * 0.25,
          // Keep Z unchanged to preserve layer integrity
        };
      }
      return { ...prev, moves: newMoves };
    });
  }, [gcData, selection, pushHistory]);

  // ── Export ───────────────────────────────────────────────────────────────
  const handleExport = useCallback(() => {
    if (!gcData || !rawTextRef.current) return;
    try {
      const modified = exportGcode(rawTextRef.current, originalMovesRef.current, gcData.moves);
      const blob = new Blob([modified], { type: 'text/plain' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `edited_${fileName || 'output.gcode'}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch (err) {
      setError(`Export failed: ${err.message}`);
    }
  }, [gcData, fileName]);

  // ── Computed ──────────────────────────────────────────────────────────────
  const stats      = gcData?.stats;
  const maxLayer   = Math.max(0, (gcData?.layers.length || 1) - 1);
  const currentZ   = gcData?.layers[currentLayer]?.z?.toFixed(2) ?? '—';
  const selCount   = selection.size;
  const featSet    = useMemo(() => [...(stats?.features || [])].filter(f => FEATURE_LABELS[f]), [stats]);

  // Right panel: show ~50 lines around the first selected move
  const codeSnippet = useMemo(() => {
    if (!showRight || !rawTextRef.current || !gcData) return [];
    const lines  = rawTextRef.current.split('\n');
    const refLine = selCount > 0
      ? (gcData.moves[[...selection][0]]?.lineIdx || 0)
      : (gcData.layers[currentLayer]?.startMoveIdx != null
          ? gcData.moves[gcData.layers[currentLayer].startMoveIdx]?.lineIdx || 0
          : 0);
    const selLines = new Set();
    if (selCount > 0 && selCount < 200) {
      for (const idx of selection) {
        selLines.add(gcData.moves[idx]?.lineIdx);
      }
    }
    const start = Math.max(0, refLine - 24);
    const end   = Math.min(lines.length - 1, refLine + 25);
    return lines.slice(start, end + 1).map((text, i) => ({
      lineNum:    start + i + 1,
      text:       text.slice(0, 60),
      isRef:      start + i === refLine,
      isSelected: selLines.has(start + i),
    }));
  }, [showRight, gcData, selection, currentLayer, selCount]);

  // ─── JSX ─────────────────────────────────────────────────────────────────
  return (
    <div className="ge-root">
      {/* ── Top Navigation ──────────────────────────────────────────────── */}
      <nav className="ge-nav" role="navigation">
        <a href="#/" className="ge-nav-logo" aria-label="Back to parametric generator">DENMO_PROJECT</a>
        <div className="ge-nav-divider" aria-hidden="true" />
        <button className="ge-nav-link" onClick={() => { window.location.hash = '/'; }}>Generator</button>
        <button className="ge-nav-link" onClick={() => { window.location.hash = '/lampifier'; }}>Lamp-ifier</button>
        <button className="ge-nav-link active" aria-current="page">G-Code Editor</button>

        <div className="ge-nav-actions">
          {fileName && <div className="ge-nav-file" title={fileName}>{fileName}</div>}
          <button
            className="ge-nav-btn"
            onClick={handleUndo}
            disabled={!gcData || historyRef.current.length === 0}
            aria-label="Undo last operation"
          >⟲ Undo</button>
          <button
            className="ge-nav-btn"
            onClick={() => setShowRight(p => !p)}
            aria-label="Toggle raw G-code panel"
          >{showRight ? 'Hide Code' : 'Raw Code'}</button>
          <button
            className="ge-nav-btn primary"
            onClick={handleExport}
            disabled={!gcData}
            aria-label="Export modified G-code file"
          >Export G-Code ↗</button>
        </div>
      </nav>

      <div className="ge-layout">
        {/* ── Left Panel ───────────────────────────────────────────────── */}
        <aside className="ge-panel" aria-label="Editor controls">

          {/* 01 – Tools */}
          <div className="ge-section">
            <div className="ge-section-header">01 — Tools</div>
            <div className="ge-tool-grid">
              {[
                { id: 'orbit',     label: 'Orbit',    icon: '⟳' },
                { id: 'brush',     label: 'Brush Sel',icon: '⬤' },
                { id: 'pattern',   label: 'Pattern',  icon: '⁞⁞' },
                { id: 'transform', label: 'Transform', icon: '⤢' },
              ].map(({ id, label, icon }) => (
                <button
                  key={id}
                  className={`ge-tool-btn${activeTool === id ? ' active' : ''}`}
                  onClick={() => setActiveTool(id)}
                  aria-pressed={activeTool === id}
                >
                  <span aria-hidden="true">{icon}</span>{label}
                </button>
              ))}
            </div>
          </div>

          {/* Brush Settings */}
          {activeTool === 'brush' && (
            <div className="ge-section">
              <div className="ge-section-header">Brush Settings</div>
              <div className="ge-field">
                <div className="ge-label">
                  <span>Brush Radius</span>
                  <span className="ge-label-val">{brushRadius} mm</span>
                </div>
                <input type="range" className="ge-range" min={1} max={60} value={brushRadius}
                  onChange={e => setBrushRadius(Number(e.target.value))}
                  aria-label={`Brush radius: ${brushRadius}mm`} />
              </div>
              <div className="ge-field" style={{ fontSize: 9, color: 'var(--ge-text-3)', letterSpacing: '0.06em' }}>
                Click in the 3D viewport to select points within brush radius. Hold Shift to add to selection.
              </div>
            </div>
          )}

          {/* Pattern Settings */}
          {activeTool === 'pattern' && (
            <div className="ge-section">
              <div className="ge-section-header">Pattern Select</div>
              <div className="ge-field">
                <div className="ge-label"><span>Mode</span></div>
                <select className="ge-select" value={patternCfg.mode}
                  onChange={e => setPatternCfg(p => ({ ...p, mode: e.target.value }))}>
                  <option value="nth">Every Nth Point</option>
                  <option value="height">Height Band (Z)</option>
                  <option value="feature">Feature Type</option>
                </select>
              </div>
              {patternCfg.mode === 'nth' && (
                <div className="ge-field">
                  <div className="ge-label">
                    <span>N (every)</span>
                    <span className="ge-label-val">{patternCfg.n}</span>
                  </div>
                  <input type="range" className="ge-range" min={2} max={100} value={patternCfg.n}
                    onChange={e => setPatternCfg(p => ({ ...p, n: Number(e.target.value) }))} />
                </div>
              )}
              {patternCfg.mode === 'height' && (
                <>
                  <div className="ge-field">
                    <div className="ge-label"><span>Z Min</span><span className="ge-label-val">{patternCfg.zMin} mm</span></div>
                    <input type="range" className="ge-range" min={0} max={Math.ceil(stats?.maxZ || 200)}
                      value={patternCfg.zMin} onChange={e => setPatternCfg(p => ({ ...p, zMin: Number(e.target.value) }))} />
                  </div>
                  <div className="ge-field">
                    <div className="ge-label"><span>Z Max</span><span className="ge-label-val">{patternCfg.zMax} mm</span></div>
                    <input type="range" className="ge-range" min={0} max={Math.ceil(stats?.maxZ || 200)}
                      value={patternCfg.zMax} onChange={e => setPatternCfg(p => ({ ...p, zMax: Number(e.target.value) }))} />
                  </div>
                </>
              )}
              {patternCfg.mode === 'feature' && (
                <div className="ge-field">
                  <div className="ge-label"><span>Feature</span></div>
                  <select className="ge-select" value={patternCfg.feature}
                    onChange={e => setPatternCfg(p => ({ ...p, feature: e.target.value }))}>
                    {[...Object.entries(FEATURE_LABELS)].map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
              )}
              <button className="ge-op-btn" onClick={applyPatternSelect} disabled={!gcData} style={{ marginTop: 4 }}>
                Apply Pattern Select <span>→</span>
              </button>
            </div>
          )}

          {/* Transform Panel */}
          {activeTool === 'transform' && (
            <div className="ge-section">
              <div className="ge-section-header">Transform Selection</div>
              {selCount === 0 && (
                <div style={{ fontSize: 9, color: 'var(--ge-text-3)', letterSpacing: '0.06em', marginBottom: 10 }}>
                  Select points first using Brush or Pattern tools.
                </div>
              )}
              <div className="ge-field">
                <div className="ge-label">
                  <span>Step Size</span>
                  <span className="ge-label-val">{transformStep} mm</span>
                </div>
                <input type="range" className="ge-range" min={0.1} max={20} step={0.1} value={transformStep}
                  onChange={e => setTransformStep(Number(e.target.value))} />
              </div>
              {[
                { axis: 'x', label: 'X', cls: 'x' },
                { axis: 'y', label: 'Y (depth)', cls: 'y' },
                { axis: 'z', label: 'Z (height)', cls: 'z' },
              ].map(({ axis, label, cls }) => (
                <div className="ge-axis-row" key={axis}>
                  <div className={`ge-axis-label ${cls}`}>{label[0]}</div>
                  <button className="ge-axis-btn" onClick={() => applyTransform(axis, -transformStep)} disabled={selCount === 0}>
                    −{transformStep}
                  </button>
                  <button className="ge-axis-btn" onClick={() => applyTransform(axis, transformStep)} disabled={selCount === 0}>
                    +{transformStep}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 02 – View */}
          <div className="ge-section">
            <div className="ge-section-header">02 — View</div>
            <div className="ge-toggle-row">
              <span className="ge-toggle-label">Show Travel Moves</span>
              <label className="ge-toggle" aria-label="Toggle travel moves">
                <input type="checkbox" checked={showTravel} onChange={e => setShowTravel(e.target.checked)} />
                <div className="ge-toggle-track" /><div className="ge-toggle-knob" />
              </label>
            </div>
          </div>

          {/* 03 – Feature Legend */}
          {gcData && featSet.length > 0 && (
            <div className="ge-section">
              <div className="ge-section-header">03 — Features</div>
              <div className="ge-feature-list">
                {featSet.map(f => (
                  <div className="ge-feature-item" key={f}>
                    <div className="ge-feature-dot" style={{ background: FEATURE_COLORS[f] || '#555' }} />
                    <span>{FEATURE_LABELS[f] || f}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Selection Info */}
          {selCount > 0 && (
            <div className="ge-section">
              <div className="ge-selection-info">
                <span>⬤ {selCount.toLocaleString()} selected</span>
                <button className="ge-selection-clear" onClick={() => setSelection(new Set())} aria-label="Clear selection">✕</button>
              </div>
            </div>
          )}

          {/* 04 – Operations */}
          <div className="ge-section">
            <div className="ge-section-header">04 — Operations</div>
            <button className="ge-op-btn" onClick={applyRedistribute} disabled={!gcData || selCount < 3}
              aria-label="Evenly redistribute selected points along their path">
              Redistribute Points <span>→</span>
            </button>
            <button className="ge-op-btn" onClick={applySmooth} disabled={!gcData || selCount < 3}
              aria-label="Laplacian smooth selected points">
              Smooth Selection <span>→</span>
            </button>
            <button className="ge-op-btn danger" onClick={() => setSelection(new Set())} disabled={selCount === 0}
              aria-label="Clear current point selection">
              Clear Selection <span>✕</span>
            </button>
          </div>

          {/* 05 – Stats */}
          {gcData && (
            <div className="ge-section">
              <div className="ge-section-header">05 — Stats</div>
              {[
                ['Total Layers',    gcData.layers.length.toLocaleString()],
                ['Total Moves',     stats.totalMoves.toLocaleString()],
                ['Extruded Moves',  stats.extrudedMoves.toLocaleString()],
                ['Print Height',    `${stats.maxZ.toFixed(1)} mm`],
                ['Undo Stack',      `${historyRef.current.length}/${MAX_UNDO}`],
              ].map(([label, val]) => (
                <div key={label} className="ge-toggle-row" style={{ marginBottom: 4 }}>
                  <span style={{ fontSize: 9, letterSpacing: '0.08em', color: 'var(--ge-text-3)', textTransform: 'uppercase' }}>{label}</span>
                  <span style={{ fontSize: 10, color: 'var(--ge-text-2)', fontWeight: 600 }}>{val}</span>
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* ── Main Viewport ────────────────────────────────────────────── */}
        <main
          className={`ge-viewport ${activeTool === 'brush' ? 'brush-mode' : 'orbit-mode'}`}
          role="main"
          aria-label="3D G-code viewport"
        >
          {/* Corner labels */}
          <div className="ge-corner-label tl" aria-hidden="true">G-CODE EDITOR · VIEWPORT</div>
          <div className="ge-corner-label tr" aria-hidden="true">
            {gcData ? `LAYER ${currentLayer + 1}/${gcData.layers.length} · Z ${currentZ}mm` : 'NO FILE LOADED'}
          </div>
          <div className="ge-corner-label bl" aria-hidden="true">ORBIT: DRAG · ZOOM: SCROLL · PAN: RMB</div>
          <div className="ge-corner-label br" aria-hidden="true">
            {selCount > 0 ? `◼ ${selCount.toLocaleString()} PTS SELECTED` : activeTool.toUpperCase() + ' MODE'}
          </div>

          {/* Empty state + dropzone */}
          {!gcData && !isLoading && (
            <div className="ge-empty" aria-live="polite">
              <div {...getRootProps()} className="ge-dropzone-overlay">
                <input {...getInputProps()} />
              </div>
              <svg className="ge-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
                <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/>
              </svg>
              <div className="ge-empty-title">{isDragActive ? 'Drop it!' : 'No G-code Loaded'}</div>
              <div className="ge-empty-sub">Drop a .gcode or .3mf file here to begin</div>
            </div>
          )}

          {/* Loading overlay */}
          {isLoading && (
            <div className="ge-loading" aria-live="polite" role="status">
              <div className="ge-loading-spinner" aria-hidden="true" />
              <div className="ge-loading-text">Parsing G-Code…</div>
              <div className="ge-loading-bar">
                <div className="ge-loading-fill" style={{ width: `${loadProgress}%` }} />
              </div>
            </div>
          )}

          {/* 3D Canvas */}
          <Canvas
            shadows={false}
            camera={{ position: [0, 18, 28], fov: 42 }}
            dpr={[1, 1.5]}
            aria-label="3D G-code path viewport"
            style={{ background: '#080808' }}
          >
            <color attach="background" args={['#080808']} />
            <Suspense fallback={null}>
              <EditorScene
                gcData={gcData}
                currentLayer={currentLayer}
                showTravel={showTravel}
                activeTool={activeTool}
                brushRadius={brushRadius}
                selection={selection}
                onBrushClick={handleBrushClick}
              />
            </Suspense>
          </Canvas>

          {/* ── Bottom Bar ─────────────────────────────────────────────── */}
          <div className="ge-bottombar" aria-label="Layer scrubber">
            <div className="ge-layer-label">
              Layer<span className="ge-layer-val"> {gcData ? currentLayer + 1 : '—'}</span>
            </div>
            <input
              type="range"
              className="ge-layer-range"
              min={0}
              max={maxLayer}
              value={currentLayer}
              onChange={e => setCurrentLayer(Number(e.target.value))}
              disabled={!gcData}
              aria-label={`Layer ${currentLayer + 1} of ${maxLayer + 1}`}
            />
            <div className="ge-layer-label">
              / <span className="ge-layer-val">{gcData ? gcData.layers.length : '—'}</span>
            </div>
            <div className="ge-stat-pill hi">Z: {currentZ} mm</div>
            {stats && (
              <>
                <div className="ge-stat-pill">{stats.extrudedMoves.toLocaleString()} moves</div>
                {selCount > 0 && <div className="ge-stat-pill" style={{ color: 'var(--ge-accent)' }}>◼ {selCount.toLocaleString()} selected</div>}
              </>
            )}
          </div>
        </main>

        {/* ── Right Panel (raw code) ────────────────────────────────────── */}
        {showRight && (
          <aside className="ge-panel-right" aria-label="Raw G-code viewer">
            <div className="ge-code-header">
              <span>Raw G-Code</span>
              {selCount > 0 && <span style={{ color: 'var(--ge-accent)' }}>{selCount} lines tagged</span>}
            </div>
            <div className="ge-code-scroll">
              {codeSnippet.map(line => (
                <div
                  key={line.lineNum}
                  className={`ge-code-line${line.isSelected ? ' selected' : line.isRef ? ' highlight' : ''}`}
                >
                  <span className="ge-code-num">{line.lineNum}</span>
                  <span>{line.text}</span>
                </div>
              ))}
              {codeSnippet.length === 0 && gcData && (
                <div className="ge-code-line" style={{ color: 'var(--ge-text-3)', fontSize: 9, padding: '16px 10px' }}>
                  Select points or scrub layers to see code
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* ── Error Toast ─────────────────────────────────────────────────── */}
      {error && <div className="ge-toast" role="alert">⚠ {error}</div>}
    </div>
  );
}
