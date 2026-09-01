/** localStorage key for sync tolerance (seconds): streams considered "aligned" when within this offset. */
const SYNC_OFFSET_THRESHOLD_KEY = 'f1openviewer-sync-offset-threshold';
/** localStorage key for delay (ms) before showing "Done" after seek. */
const SYNC_DONE_DELAY_KEY = 'f1openviewer-sync-done-delay-ms';
/** localStorage key for "keep streams locked after sync" toggle. */
const SYNC_KEEP_LOCKED_KEY = 'f1openviewer-sync-keep-locked';
/** localStorage key for reference selection mode: 'latest' | 'first' (main feed) | 'manual' */
const SYNC_REFERENCE_MODE_KEY = 'f1openviewer-sync-reference-mode';

export const DEFAULT_SYNC_OFFSET_THRESHOLD = 0.05;
export const DEFAULT_SYNC_DONE_DELAY_MS = 200;
export const MIN_SYNC_OFFSET_THRESHOLD = 0.01;
export const MAX_SYNC_OFFSET_THRESHOLD = 0.5;
export const MIN_SYNC_DONE_DELAY_MS = 50;
export const MAX_SYNC_DONE_DELAY_MS = 1500;

export type SyncReferenceMode = 'latest' | 'first';

export function getSyncOffsetThreshold(): number {
  if (typeof localStorage === 'undefined') return DEFAULT_SYNC_OFFSET_THRESHOLD;
  const raw = localStorage.getItem(SYNC_OFFSET_THRESHOLD_KEY);
  if (raw == null) return DEFAULT_SYNC_OFFSET_THRESHOLD;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SYNC_OFFSET_THRESHOLD;
  return Math.max(MIN_SYNC_OFFSET_THRESHOLD, Math.min(MAX_SYNC_OFFSET_THRESHOLD, n));
}

export function setSyncOffsetThreshold(seconds: number): void {
  const v = Math.max(MIN_SYNC_OFFSET_THRESHOLD, Math.min(MAX_SYNC_OFFSET_THRESHOLD, seconds));
  try {
    localStorage.setItem(SYNC_OFFSET_THRESHOLD_KEY, String(v));
  } catch (_) {}
  window.f1?.setSetting?.(SYNC_OFFSET_THRESHOLD_KEY, String(v));
}

export function getSyncDoneDelayMs(): number {
  if (typeof localStorage === 'undefined') return DEFAULT_SYNC_DONE_DELAY_MS;
  const raw = localStorage.getItem(SYNC_DONE_DELAY_KEY);
  if (raw == null) return DEFAULT_SYNC_DONE_DELAY_MS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SYNC_DONE_DELAY_MS;
  return Math.max(MIN_SYNC_DONE_DELAY_MS, Math.min(MAX_SYNC_DONE_DELAY_MS, Math.round(n)));
}

export function setSyncDoneDelayMs(ms: number): void {
  const v = Math.max(MIN_SYNC_DONE_DELAY_MS, Math.min(MAX_SYNC_DONE_DELAY_MS, Math.round(ms)));
  try {
    localStorage.setItem(SYNC_DONE_DELAY_KEY, String(v));
  } catch (_) {}
  window.f1?.setSetting?.(SYNC_DONE_DELAY_KEY, String(v));
}

export function getSyncKeepLocked(): boolean {
  if (typeof localStorage === 'undefined') return true;
  // Drift correction stays enabled unless the user selects one-shot synchronization.
  const v = localStorage.getItem(SYNC_KEEP_LOCKED_KEY);
  if (v == null) return true;
  return v === '1';
}

export function setSyncKeepLocked(on: boolean): void {
  const v = on ? '1' : '0';
  try {
    localStorage.setItem(SYNC_KEEP_LOCKED_KEY, v);
  } catch (_) {}
  window.f1?.setSetting?.(SYNC_KEEP_LOCKED_KEY, v);
}

export function getSyncReferenceMode(): SyncReferenceMode {
  if (typeof localStorage === 'undefined') return 'first';
  // The race feed remains the anchor so one stalled stream cannot shift the entire multiview.
  const v = localStorage.getItem(SYNC_REFERENCE_MODE_KEY);
  return v === 'latest' ? 'latest' : 'first';
}

export function setSyncReferenceMode(mode: SyncReferenceMode): void {
  try {
    localStorage.setItem(SYNC_REFERENCE_MODE_KEY, mode);
  } catch (_) {}
  window.f1?.setSetting?.(SYNC_REFERENCE_MODE_KEY, mode);
}
