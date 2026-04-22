import { useMemo } from 'react';
import { useStore } from '../../store';
import ParameterSlider from '../controls/ParameterSlider';
import SliderGroup from '../controls/SliderGroup';
import { TENSEGRITY_RANGES } from '../../utils/constants';
import { validateTensegrity } from '../../math/validation';
import { Hexagon, Move3D } from 'lucide-react';

/**
 * Module 1 controls: Procedural Tensegrity Generator
 */
export default function TensegrityControls() {
  const tensegrity = useStore((s) => s.tensegrity);
  const setParam = useStore((s) => s.setTensegrityParam);
  const pushHistory = useStore((s) => s.pushHistory);

  // Validate current state
  const validation = useMemo(
    () => validateTensegrity(tensegrity),
    [tensegrity]
  );

  // Map validation errors to specific parameters
  const getErrorForParam = (key) => {
    if (key === 'strutLength' && !validation.valid) {
      const heightError = validation.errors.find((e) => e.includes('Impossible geometry'));
      if (heightError) return heightError;
    }
    if (key === 'twistAngle' && !validation.valid) {
      const heightError = validation.errors.find((e) => e.includes('Impossible geometry'));
      if (heightError) return 'Contributes to impossible geometry';
    }
    return null;
  };

  const getWarningForParam = (key) => {
    if (key === 'twistAngle') {
      return validation.warnings.find((w) => w.includes('twist'));
    }
    return null;
  };

  return (
    <div className="module-controls">
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

      <SliderGroup id="tensegrity-info" title="COMPUTED VALUES" icon={Move3D}>
        <div className="computed-values">
          <div className="computed-value">
            <span className="computed-value__label">Height (H)</span>
            <span className={`computed-value__number ${!validation.valid ? 'computed-value__number--error' : ''}`}>
              {validation.valid && validation.computedHeight !== null
                ? `${validation.computedHeight.toFixed(3)} m`
                : '— invalid —'}
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
    </div>
  );
}
