import { useMemo } from 'react';
import { useStore } from '../../store';
import ParameterSlider from '../controls/ParameterSlider';
import SliderGroup from '../controls/SliderGroup';
import { ACOUSTIC_RANGES, SPEED_OF_SOUND } from '../../utils/constants';
import { validateAcoustic } from '../../math/validation';
import { findPressureNodes } from '../../math/acousticWave';
import { useValueFlash } from '../../utils/useValueFlash';
import { Radio, BarChart3 } from 'lucide-react';

/**
 * Module 2 controls: Acoustic Levitation Standing Wave Visualizer
 *
 * Output section (computed values) renders first for immediate visibility.
 * Inputs follow below.
 */
export default function AcousticControls() {
  const acoustic    = useStore((s) => s.acoustic);
  const setParam    = useStore((s) => s.setAcousticParam);
  const pushHistory = useStore((s) => s.pushHistory);

  const validation = useMemo(
    () => validateAcoustic(acoustic),
    [acoustic]
  );

  // λ = c/f,  k = 2πf/c,  ω = 2πf
  const wavelength = useMemo(() => {
    if (acoustic.frequency <= 0) return null;
    return SPEED_OF_SOUND / (acoustic.frequency * 1000);
  }, [acoustic.frequency]);

  const wavenumber = useMemo(() => {
    if (acoustic.frequency <= 0) return null;
    return (2 * Math.PI * acoustic.frequency * 1000) / SPEED_OF_SOUND;
  }, [acoustic.frequency]);

  const angularFrequency = useMemo(() => {
    if (acoustic.frequency <= 0) return null;
    return 2 * Math.PI * acoustic.frequency * 1000;
  }, [acoustic.frequency]);

  const nodePositions = useMemo(
    () => findPressureNodes(acoustic.frequency, acoustic.transducerDistance, acoustic.phaseShift),
    [acoustic.frequency, acoustic.transducerDistance, acoustic.phaseShift]
  );

  // Value flash refs
  const wavelengthRef  = useValueFlash(wavelength);
  const wavenumberRef  = useValueFlash(wavenumber);
  const omegaRef       = useValueFlash(angularFrequency);
  const nodeCountRef   = useValueFlash(nodePositions.length);
  const instanceRef    = useValueFlash(acoustic.fieldResolution);

  const totalInstances = acoustic.fieldResolution ** 3;

  const getErrorForParam = (key) => {
    if (key === 'fieldResolution') {
      return validation.errors.find((e) => e.includes('Resolution') || e.includes('GPU')) ?? null;
    }
    return null;
  };

  return (
    <div className="module-controls">
      {/* ── Computed outputs — pinned at top, always in view ── */}
      <SliderGroup id="acoustic-info" title="FIELD ANALYSIS" icon={BarChart3}>
        <div className="computed-values">
          <div className="computed-value">
            <span className="computed-value__label">Wavelength (λ)</span>
            <span ref={wavelengthRef} className="computed-value__number">
              {wavelength ? `${(wavelength * 1000).toFixed(2)} mm` : '—'}
            </span>
          </div>
          <div className="computed-value">
            <span className="computed-value__label">Wavenumber (k)</span>
            <span ref={wavenumberRef} className="computed-value__number">
              {wavenumber ? `${wavenumber.toFixed(1)} rad/m` : '—'}
            </span>
          </div>
          <div className="computed-value">
            <span className="computed-value__label">Angular Freq (ω)</span>
            <span ref={omegaRef} className="computed-value__number">
              {angularFrequency ? `${(angularFrequency / 1000).toFixed(1)} krad/s` : '—'}
            </span>
          </div>
          <div className="computed-value">
            <span className="computed-value__label">Pressure Nodes</span>
            <span ref={nodeCountRef} className="computed-value__number computed-value__number--accent">
              {nodePositions.length} trap{nodePositions.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="computed-value">
            <span className="computed-value__label">Total Instances</span>
            <span
              ref={instanceRef}
              className={`computed-value__number ${!validation.valid ? 'computed-value__number--error' : ''}`}
            >
              {totalInstances.toLocaleString()}
            </span>
          </div>
        </div>
      </SliderGroup>

      {/* ── Parameter inputs ── */}
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
    </div>
  );
}
