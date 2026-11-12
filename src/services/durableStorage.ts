/**
 * localStorage follows the Electron install path. Mirror these keys to userData so settings
 * survive "delete folder, unzip elsewhere" updates.
 *
 * KEEP IN SYNC with electron/durableSettings.js (the main process only accepts allowlisted keys;
 * a test in electron/durableSettings.test.js enforces it).
 */
const DURABLE_KEYS = [
  'f1openviewer-locale',
  'f1-theme',
  'f1-dismissed-update-version',
  'f1openviewer-saved-grids',
  'f1openviewer-sync-offset-threshold',
  'f1openviewer-sync-done-delay-ms',
  'f1openviewer-sync-keep-locked',
  'f1openviewer-sync-reference-mode',
  'f1openviewer-livetiming-dock-width',
  'f1openviewer-header-collapsed',
  'f1openviewer-multiview-bar-collapsed',
  'f1openviewer-favorite-drivers',
  'f1openviewer-preferences',
  'f1openviewer-onboarding',
] as const;

/** Free-form keys with a fixed prefix (per-session live-timing sync offsets). */
export const DURABLE_KEY_PREFIXES = ['f1lt-sync:'] as const;

function isDurableKey(key: string): boolean {
  return (DURABLE_KEYS as readonly string[]).includes(key) || DURABLE_KEY_PREFIXES.some((p) => key.startsWith(p));
}

/** Load durable settings into localStorage before first render. */
export async function seedDurableSettings(): Promise<void> {
  if (!window.f1?.getAllSettings) return;
  try {
    const all = await window.f1.getAllSettings();
    for (const [key, v] of Object.entries(all ?? {})) {
      if (isDurableKey(key) && typeof v === 'string') localStorage.setItem(key, v);
    }
  } catch (_) {}
}

/** Mirror a durable-key write to disk (fixed keys or an allowed prefix + suffix). */
export function persistDurableSetting(key: string, value: string): void {
  if (!isDurableKey(key)) return;
  window.f1?.setSetting?.(key, value);
}
