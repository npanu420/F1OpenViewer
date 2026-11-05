/**
 * Debug logging for the renderer. Verbose traces (Shaka load/license details, live-edge polling,
 * manifest inspection) are silent by default: they flooded the console and the main-process log
 * that users paste into bug reports. Enable with `localStorage.setItem('f1-debug', '1')` + reload
 * (or automatically in `npm run dev`). Warnings and errors are never gated.
 */

export function isDebugEnabled(
  storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined,
  dev: boolean = typeof import.meta !== 'undefined' && !!import.meta.env?.DEV
): boolean {
  if (dev) return true;
  try {
    return storage?.getItem('f1-debug') === '1';
  } catch (_) {
    return false;
  }
}

const enabled = isDebugEnabled();

export function debug(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  if (enabled) console.log(...args);
}
