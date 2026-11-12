import { useEffect, useState } from 'react';

/**
 * True once the pointer and keyboard have been still for `delayMs`. Any movement, click, wheel or
 * key press makes it false again. Always false while disabled.
 */
export function usePointerIdle(enabled: boolean, delayMs = 2500): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setIdle(false);
      return;
    }
    let timer = window.setTimeout(() => setIdle(true), delayMs);
    const wake = () => {
      window.clearTimeout(timer);
      setIdle(false);
      timer = window.setTimeout(() => setIdle(true), delayMs);
    };
    const events = ['pointermove', 'pointerdown', 'wheel', 'keydown'] as const;
    for (const name of events) window.addEventListener(name, wake, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const name of events) window.removeEventListener(name, wake);
    };
  }, [enabled, delayMs]);
  return idle;
}
