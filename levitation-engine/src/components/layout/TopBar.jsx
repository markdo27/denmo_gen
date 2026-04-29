import { useMemo } from 'react';
import { useStore } from '../../store';
import { MODULES } from '../../utils/constants';
import UndoRedo from '../controls/UndoRedo';
import ToggleSwitch from '../controls/ToggleSwitch';
import { validateTensegrity, validateAcoustic } from '../../math/validation';
import { Orbit } from 'lucide-react';

/**
 * Top application bar — identity + tools only.
 * Module navigation has been promoted into the left panel header.
 *
 * Contains:
 *   Left:  Logo wordmark
 *   Right: Status capsule (always-visible system validity) + Blueprint toggle + Undo/Redo
 */
export default function TopBar() {
  const blueprintMode     = useStore((s) => s.blueprintMode);
  const toggleBlueprintMode = useStore((s) => s.toggleBlueprintMode);
  const activeModule      = useStore((s) => s.activeModule);
  const tensegrity        = useStore((s) => s.tensegrity);
  const acoustic          = useStore((s) => s.acoustic);

  // Derive validity from the active module — single responsibility
  const isValid = useMemo(() => {
    if (activeModule === MODULES.TENSEGRITY) {
      return validateTensegrity(tensegrity).valid;
    }
    return validateAcoustic(acoustic).valid;
  }, [activeModule, tensegrity, acoustic]);

  return (
    <header className="top-bar">
      <div className="top-bar__left">
        <div className="top-bar__logo">
          <Orbit size={16} className="top-bar__logo-icon" />
          <span className="top-bar__title">LEVITATION ENGINE</span>
          <span className="top-bar__version">v2</span>
        </div>
      </div>

      <div className="top-bar__right">
        {/* System status — visible regardless of scroll position */}
        <StatusCapsule valid={isValid} />

        <div className="top-bar__divider" />

        <ToggleSwitch
          label="BLUEPRINT"
          checked={blueprintMode}
          onChange={toggleBlueprintMode}
          accentClass="toggle-switch--blueprint"
        />

        <div className="top-bar__divider" />
        <UndoRedo />
      </div>
    </header>
  );
}

/**
 * Pill-shaped system validity indicator.
 * Renders: ● STABLE (green), ● INVALID (pulsing red), or ● — (neutral on mount).
 */
function StatusCapsule({ valid }) {
  return (
    <div
      className={`status-capsule ${valid ? '' : 'status-capsule--invalid'}`}
      role="status"
      aria-live="polite"
    >
      <span className="status-capsule__dot" />
      {valid ? 'STABLE' : 'INVALID'}
    </div>
  );
}
