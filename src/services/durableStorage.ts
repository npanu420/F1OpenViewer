/**
 * localStorage is scoped to the page's file:// origin, which for a packaged Electron app is
 * tied to its install path. A manual "delete old folder, unzip new one elsewhere" update would
 * silently reset these, so this allowlist is mirrored into a userData-backed JSON file that
 * survives regardless of install path, the same place session/cookies already live.
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
] as const;

/** Seeds localStorage from disk before the app renders, so every existing localStorage.getItem
 *  call site keeps working unchanged even after a fresh install at a new path. */
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

/** Call right after localStorage.setItem for any key in DURABLE_KEYS, to mirror it to disk. */
export function persistDurableSetting(key: (typeof DURABLE_KEYS)[number], value: string): void {
  window.f1?.setSetting?.(key, value);
}
