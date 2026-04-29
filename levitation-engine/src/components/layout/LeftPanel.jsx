import { useStore } from '../../store';
import { MODULES } from '../../utils/constants';
import TensegrityControls from '../modules/TensegrityControls';
import AcousticControls from '../modules/AcousticControls';

/**
 * Left panel — module tab navigation + scrollable parameter workspace.
 *
 * Architecture fix: module tabs are now spatially co-located with the content
 * they control, eliminating the broken contract where tabs lived in the top bar
 * but controlled the left panel.
 */
export default function LeftPanel() {
  const activeModule    = useStore((s) => s.activeModule);
  const setActiveModule = useStore((s) => s.setActiveModule);

  return (
    <aside className="left-panel">
      {/* ── Module Tab Header ── */}
      <nav className="left-panel__tabs">
        <button
          className={`left-panel__tab ${activeModule === MODULES.TENSEGRITY ? 'left-panel__tab--active' : ''}`}
          onClick={() => setActiveModule(MODULES.TENSEGRITY)}
          type="button"
        >
          <span className="left-panel__tab-num">01</span>
          TENSEGRITY
        </button>
        <button
          className={`left-panel__tab ${activeModule === MODULES.ACOUSTIC ? 'left-panel__tab--active' : ''}`}
          onClick={() => setActiveModule(MODULES.ACOUSTIC)}
          type="button"
        >
          <span className="left-panel__tab-num">02</span>
          ACOUSTIC
        </button>
      </nav>

      {/* ── Scrollable Parameters ── */}
      <div className="left-panel__scroll">
        {activeModule === MODULES.TENSEGRITY && <TensegrityControls />}
        {activeModule === MODULES.ACOUSTIC   && <AcousticControls />}
      </div>

      {/* ── Footer ── */}
      <div className="left-panel__footer">
        <span className="left-panel__footer-item">
          MOD:{activeModule === MODULES.TENSEGRITY ? 'TENSEGRITY' : 'ACOUSTIC'}
        </span>
        <span className="left-panel__footer-item">CTRL+Z · CTRL+Y</span>
      </div>
    </aside>
  );
}
