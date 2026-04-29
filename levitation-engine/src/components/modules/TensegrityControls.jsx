import { useMemo } from 'react';
import { useStore } from '../../store';
import ParameterSlider from '../controls/ParameterSlider';
import SliderGroup from '../controls/SliderGroup';
import { TENSEGRITY_RANGES } from '../../utils/constants';
import { validateTensegrity } from '../../math/validation';
import { computeTensegrityHeight } from '../../math/tensegrity';
import { useValueFlash } from '../../utils/useValueFlash';
import { Hexagon, Move3D } from 'lucide-react';

/**
 * Module 1 controls: Procedural Tensegrity Generator
 *
 * Output section (computed values) renders first for immediate visibility.
 * Inputs follow below.
 */
export default function TensegrityControls() {
  const tensegrity  = useStore((s) => s.tensegrity);
  const setParam    = useStore((s) => s.setTensegrityParam);
  const pushHistory = useStore((s) => s.pushHistory);

  const validation = useMemo(
    () => validateTensegrity(tensegrity),
    [tensegrity]
  );

  const geomExtra = useMemo(() => {
    const { horizontalDistSq } = computeTensegrityHeight(tensegrity);
    const dXZ      = Math.sqrt(Math.max(0, horizontalDistSq));
    const thetaMax = (180 / Math.PI) * (Math.PI / tensegrity.strutCount);
    return { dXZ, thetaMax };
  }, [tensegrity]);

  // Value flash refs — each computed number lights up when it changes
  const heightRef   = useValueFlash(validation.computedHeight);
  const dXZRef      = useValueFlash(geomExtra.dXZ);
  const thetaMaxRef = useValueFlash(geomExtra.thetaMax);

  const getErrorForParam = (key) => {
    if (key === 'strutLength' && !validation.valid) {
      return validation.errors.find((e) => e.includes('Impossible geometry')) ?? null;
    }
    if (key === 'twistAngle' && !validation.valid) {
      return validation.errors.find((e) => e.includes('Impossible geometry'))
        ? 'Contributes to impossible geometry'
        : null;
    }
    return null;
  };

  const getWarningForParam = (key) => {
    if (key === 'twistAngle') {
      return validation.warnings.find((w) => w.includes('twist') || w.includes('Twist')) ?? null;
    }
    return null;
  };

  return (
    <div className="module-controls">
      {/* ── Computed outputs — pinned at top, always in view ── */}
      <SliderGroup id="tensegrity-info" title="COMPUTED VALUES" icon={Move3D}>
        <div className="computed-values">
          <div className="computed-value">
            <span className="computed-value__label">Height (H)</span>
            <span
              ref={heightRef}
              className={`computed-value__number ${!validation.valid ? 'computed-value__number--error' : ''}`}
            >
              {validation.valid && validation.computedHeight !== null
                ? `${validation.computedHeight.toFixed(3)} m`
                : '— invalid —'}
            </span>
          </div>
          <div className="computed-value">
            <span className="computed-value__label">Horiz. span (d&#x2093;&#x2093;)</span>
            <span ref={dXZRef} className="computed-value__number">
              {geomExtra.dXZ.toFixed(3)} m
            </span>
          </div>
          <div className="computed-value">
            <span className="computed-value__label">θ_max = π/N</span>
            <span
              ref={thetaMaxRef}
              className={`computed-value__number ${tensegrity.twistAngle > geomExtra.thetaMax ? 'computed-value__number--error' : ''}`}
            >
              {geomExtra.thetaMax.toFixed(1)}°
            </span>
          </div>
          <div className="computed-value">
            <span className="computed-value__label">Status</span>
            <span className={`computed-value__status ${validation.valid ? 'computed-value__status--valid' : 'computed-value__status--invalid'}`}>
              {validation.valid ? '● STABLE' : '● IMPOSSIBLE'}
            </span>
          </div>
        </div>
      </SliderGroup>

      {/* ── Parameter inputs ── */}
      <SliderGroup id="tensegrity-geometry" title="GEOMETRY" icon={Hexagon}>
        {Object.entries(TENSEGRITY_RANGES).map(([key, range]) => (
          <ParameterSlider
            key={key}
            label={range.label}
            symbol={range.symbol}
            unit={range.unit}
            value={tensegrity[key]}
            min={range.min}
            max={range.max}
            step={range.step}
            onChange={(v) => setParam(key, v)}
            onCommit={pushHistory}
            error={getErrorForParam(key)}
            warning={getWarningForParam(key)}
          />
        ))}
      </SliderGroup>
    </div>
  );
}
