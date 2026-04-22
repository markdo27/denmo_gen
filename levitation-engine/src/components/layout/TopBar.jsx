import { useStore } from '../../store';
import { MODULES } from '../../utils/constants';
import UndoRedo from '../controls/UndoRedo';
import ToggleSwitch from '../controls/ToggleSwitch';
import { Orbit, Grid3X3 } from 'lucide-react';

/**
 * Top application bar: title, module tabs, blueprint toggle, undo/redo.
 */
export default function TopBar() {
  const activeModule = useStore((s) => s.activeModule);
  const setActiveModule = useStore((s) => s.setActiveModule);
  const blueprintMode = useStore((s) => s.blueprintMode);
  const toggleBlueprintMode = useStore((s) => s.toggleBlueprintMode);

  return (
    <header className="top-bar">
      <div className="top-bar__left">
        <div className="top-bar__logo">
          <Orbit size={18} className="top-bar__logo-icon" />
          <span className="top-bar__title">LEVITATION ENGINE</span>
          <span className="top-bar__version">v1.0</span>
        </div>
      </div>

      <nav className="top-bar__tabs">
        <button
          className={`top-bar__tab ${activeModule === MODULES.TENSEGRITY ? 'top-bar__tab--active' : ''}`}
          onClick={() => setActiveModule(MODULES.TENSEGRITY)}
          type="button"
        >
          <span className="top-bar__tab-label">01</span>
          TENSEGRITY
        </button>
        <button
          className={`top-bar__tab ${activeModule === MODULES.ACOUSTIC ? 'top-bar__tab--active' : ''}`}
          onClick={() => setActiveModule(MODULES.ACOUSTIC)}
          type="button"
        >
          <span className="top-bar__tab-label">02</span>
          ACOUSTIC
        </button>
      </nav>

      <div className="top-bar__right">
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
