import { useRef, useEffect } from 'react';

/**
 * useValueFlash — attaches a CSS flash animation whenever `value` changes.
 *
 * Usage:
 *   const ref = useValueFlash(someNumber);
 *   <span ref={ref} className="computed-value__number">{someNumber}</span>
 *
 * Mechanism:
 *   1. On value change, remove the flash class (no-op if absent)
 *   2. Force a synchronous reflow (void el.offsetWidth) to reset the animation
 *   3. Re-add the flash class — animation fires from frame 0
 *
 * The skip-first-render guard prevents the flash from firing on mount.
 */
export function useValueFlash(value) {
  const ref        = useRef(null);
  const isFirstRun = useRef(true);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    const el = ref.current;
    if (!el) return;

    el.classList.remove('computed-value__number--flash');
    void el.offsetWidth;                           // force reflow
    el.classList.add('computed-value__number--flash');
  }, [value]);

  return ref;
}
