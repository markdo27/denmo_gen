/**
 * Toggle switch with label — used for Blueprint Mode etc.
 */
export default function ToggleSwitch({ label, checked, onChange, accentClass }) {
  return (
    <label className={`toggle-switch ${accentClass || ''}`}>
      <span className="toggle-switch__label">{label}</span>
      <div className="toggle-switch__track-wrapper">
        <input
          type="checkbox"
          className="toggle-switch__input"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div className={`toggle-switch__track ${checked ? 'toggle-switch__track--active' : ''}`}>
          <div className="toggle-switch__thumb" />
        </div>
      </div>
    </label>
  );
}
