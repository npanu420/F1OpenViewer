/**
 * localStorage follows the Electron install path. Mirror these keys to userData so settings
 * survive "delete folder, unzip elsewhere" updates.
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
] as const;

/** Load durable settings into localStorage before first render. */
export async function seedDurableSettings(): Promise<void> {
  if (!window.f1?.getAllSettings) return;
  try {
    const all = await window.f1.getAllSettings();
    for (const key of DURABLE_KEYS) {
      const v = all?.[key];
      if (typeof v === 'string') localStorage.setItem(key, v);
    }
  } catch (_) {}
}

/** Mirror a DURABLE_KEYS write to disk. */
export function persistDurableSetting(key: (typeof DURABLE_KEYS)[number], value: string): void {
  window.f1?.setSetting?.(key, value);
}
