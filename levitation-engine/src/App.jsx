import TopBar from './components/layout/TopBar';
import LeftPanel from './components/layout/LeftPanel';
import RightPanel from './components/layout/RightPanel';
import { useEffect } from 'react';
import { useStore } from './store';

/**
 * Root application layout — split-screen with top bar.
 * Registers global keyboard shortcuts for undo/redo.
 */
export default function App() {
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  return (
    <div className="app">
      <TopBar />
      <div className="app__workspace">
        <LeftPanel />
        <RightPanel />
      </div>
    </div>
  );
}
