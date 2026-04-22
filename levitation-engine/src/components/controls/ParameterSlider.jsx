import { useCallback } from 'react';
import { formatValue } from '../../utils/formatters';
import { clamp } from '../../utils/formatters';

/**
 * Reusable validated parameter slider with monospace readout.
 *
 * Props:
 *   label    - Display name
 *   symbol   - Mathematical symbol (R₁, θ, etc.)
 *   unit     - Unit label (m, °, kHz)
 *   value    - Current value
 *   min/max/step - Range constraints
 *   onChange - Called on every input event (real-time)
 *   onCommit - Called on mouseup/touchend (triggers history snapshot)
 *   error    - Error message string (turns slider red)
 *   warning  - Warning message string
 */
export default function ParameterSlider({
  label,
  symbol,
  unit,
  value,
  min,
  max,
  step,
  onChange,
  onCommit,
  error,
  warning,
}) {
  const handleInput = useCallback(
    (e) => {
      const raw = parseFloat(e.target.value);
      const clamped = clamp(raw, min, max);
      onChange(clamped);
    },
    [onChange, min, max]
  );

  const handleCommit = useCallback(() => {
    if (onCommit) onCommit();
  }, [onCommit]);

  const percent = ((value - min) / (max - min)) * 100;

  return (
    <div className={`param-slider ${error ? 'param-slider--error' : ''} ${warning ? 'param-slider--warning' : ''}`}>
      <div className="param-slider__header">
        <div className="param-slider__label-row">
          {symbol && <span className="param-slider__symbol">{symbol}</span>}
          <span className="param-slider__label">{label}</span>
        </div>
        <div className="param-slider__value-row">
          <span className="param-slider__value">{formatValue(value, step)}</span>
          {unit && <span className="param-slider__unit">{unit}</span>}
        </div>
      </div>

      <div className="param-slider__track-wrapper">
        <input
          type="range"
          className="param-slider__input"
          min={min}
          max={max}
          step={step}
          value={value}
          onInput={handleInput}
          onMouseUp={handleCommit}
          onTouchEnd={handleCommit}
          style={{
            '--fill-percent': `${percent}%`,
          }}
        />
        <div className="param-slider__range-labels">
          <span>{formatValue(min, step)}</span>
          <span>{formatValue(max, step)}</span>
        </div>
      </div>

      {error && (
        <div className="param-slider__error">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {error}
        </div>
      )}
      {warning && !error && (
        <div className="param-slider__warning">⚠ {warning}</div>
      )}
    </div>
  );
}
