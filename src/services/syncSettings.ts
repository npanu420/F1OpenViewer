/** localStorage key for sync tolerance (seconds): streams considered "aligned" when within this offset. */
const SYNC_OFFSET_THRESHOLD_KEY = 'f1openviewer-sync-offset-threshold';
/** localStorage key for delay (ms) before showing "Done" after seek. */
const SYNC_DONE_DELAY_KEY = 'f1openviewer-sync-done-delay-ms';

export const DEFAULT_SYNC_OFFSET_THRESHOLD = 0.02;
export const DEFAULT_SYNC_DONE_DELAY_MS = 200;
export const MIN_SYNC_OFFSET_THRESHOLD = 0.005;
export const MAX_SYNC_OFFSET_THRESHOLD = 0.2;
export const MIN_SYNC_DONE_DELAY_MS = 50;
export const MAX_SYNC_DONE_DELAY_MS = 800;

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
}
