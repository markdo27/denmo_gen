import { useStore } from '../../store';
import { Undo2, Redo2 } from 'lucide-react';

/**
 * Undo/Redo button pair — navigates the parameter history stack.
 */
export default function UndoRedo() {
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);

  return (
    <div className="undo-redo">
      <button
        className="undo-redo__btn"
        onClick={undo}
        disabled={!canUndo()}
        title="Undo (Ctrl+Z)"
        type="button"
      >
        <Undo2 size={15} />
      </button>
      <button
        className="undo-redo__btn"
        onClick={redo}
        disabled={!canRedo()}
        title="Redo (Ctrl+Y)"
        type="button"
      >
        <Redo2 size={15} />
      </button>
    </div>
  );
}
