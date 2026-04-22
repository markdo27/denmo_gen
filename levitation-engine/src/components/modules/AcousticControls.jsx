import { useMemo } from 'react';
import { useStore } from '../../store';
import ParameterSlider from '../controls/ParameterSlider';
import SliderGroup from '../controls/SliderGroup';
import { ACOUSTIC_RANGES, SPEED_OF_SOUND } from '../../utils/constants';
import { validateAcoustic } from '../../math/validation';
import { findPressureNodes } from '../../math/acousticWave';
import { Radio, BarChart3 } from 'lucide-react';

/**
 * Module 2 controls: Acoustic Levitation Standing Wave Visualizer
 */
export default function AcousticControls() {
  const acoustic = useStore((s) => s.acoustic);
  const setParam = useStore((s) => s.setAcousticParam);
  const pushHistory = useStore((s) => s.pushHistory);

  const validation = useMemo(
    () => validateAcoustic(acoustic),
    [acoustic]
  );

  // Compute derived values
  const wavelength = useMemo(() => {
    if (acoustic.frequency <= 0) return null;
    return SPEED_OF_SOUND / (acoustic.frequency * 1000);
  }, [acoustic.frequency]);

  const nodePositions = useMemo(
    () => findPressureNodes(acoustic.frequency, acoustic.transducerDistance, acoustic.phaseShift),
    [acoustic.frequency, acoustic.transducerDistance, acoustic.phaseShift]
  );

  const getErrorForParam = (key) => {
    if (key === 'fieldResolution') {
      return validation.errors.find((e) => e.includes('Resolution') || e.includes('GPU'));
    }
    return null;
  };

  return (
    <div className="module-controls">
      <SliderGroup id="acoustic-wave" title="WAVE PARAMETERS" icon={Radio}>
        {Object.entries(ACOUSTIC_RANGES).map(([key, range]) => (
          <ParameterSlider
            key={key}
            label={range.label}
            symbol={range.symbol}
            unit={range.unit}
            value={acoustic[key]}
            min={range.min}
            max={range.max}
            step={range.step}
            onChange={(v) => setParam(key, v)}
            onCommit={pushHistory}
            error={getErrorForParam(key)}
          />
        ))}
      </SliderGroup>

      <SliderGroup id="acoustic-info" title="FIELD ANALYSIS" icon={BarChart3}>
        <div className="computed-values">
          <div className="computed-value">
            <span className="computed-value__label">Wavelength (λ)</span>
            <span className="computed-value__number">
              {wavelength ? `${(wavelength * 1000).toFixed(2)} mm` : '—'}
            </span>
          </div>
          <div className="computed-value">
            <span className="computed-value__label">Wavenumber (k)</span>
            <span className="computed-value__number">
              {wavelength ? `${((2 * Math.PI) / wavelength).toFixed(1)} rad/m` : '—'}
            </span>
          </div>
          <div className="computed-value">
            <span className="computed-value__label">Pressure Nodes</span>
            <span className="computed-value__number computed-value__number--accent">
              {nodePositions.length} levitation points
            </span>
          </div>
          <div className="computed-value">
            <span className="computed-value__label">Total Instances</span>
            <span className={`computed-value__number ${!validation.valid ? 'computed-value__number--error' : ''}`}>
              {Math.pow(acoustic.fieldResolution, 3).toLocaleString()}
            </span>
          </div>
        </div>
      </SliderGroup>
    </div>
  );
}
