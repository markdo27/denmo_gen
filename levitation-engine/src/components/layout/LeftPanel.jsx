import { useStore } from '../../store';
import { MODULES } from '../../utils/constants';
import TensegrityControls from '../modules/TensegrityControls';
import AcousticControls from '../modules/AcousticControls';

/**
 * Left panel — dense slider control panel.
 * 380px fixed width, scrollable, shows active module's controls.
 */
export default function LeftPanel() {
  const activeModule = useStore((s) => s.activeModule);

  return (
    <aside className="left-panel">
      <div className="left-panel__scroll">
        {activeModule === MODULES.TENSEGRITY && <TensegrityControls />}
        {activeModule === MODULES.ACOUSTIC && <AcousticControls />}
      </div>
      <div className="left-panel__footer">
        <span className="left-panel__footer-item">
          MODULE: {activeModule === MODULES.TENSEGRITY ? 'TENSEGRITY' : 'ACOUSTIC'}
        </span>
      </div>
    </aside>
  );
}
