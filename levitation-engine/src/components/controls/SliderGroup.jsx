import { useStore } from '../../store';
import { ChevronDown } from 'lucide-react';

/**
 * Collapsible slider section with uppercase header.
 *
 * Props:
 *   id       - Unique section ID for collapse state
 *   title    - Section header text
 *   icon     - Optional Lucide icon component
 *   children - Slider components
 */
export default function SliderGroup({ id, title, icon: Icon, children }) {
  const collapsed = useStore((s) => s.collapsedSections[id]);
  const toggleSection = useStore((s) => s.toggleSection);

  return (
    <div className={`slider-group ${collapsed ? 'slider-group--collapsed' : ''}`}>
      <button
        className="slider-group__header"
        onClick={() => toggleSection(id)}
        type="button"
      >
        <div className="slider-group__title-row">
          {Icon && <Icon size={14} className="slider-group__icon" />}
          <span className="slider-group__title">{title}</span>
        </div>
        <ChevronDown
          size={14}
          className={`slider-group__chevron ${collapsed ? 'slider-group__chevron--collapsed' : ''}`}
        />
      </button>
      <div className="slider-group__content">
        {children}
      </div>
    </div>
  );
}
