import { useSyncExternalStore } from 'react';
import { persistDurableSetting } from './durableStorage';

const PREFERENCES_KEY = 'f1openviewer-preferences';

/**
 * Video quality of the players.
 *  - auto: adaptive, multiview tiles capped at 720p and sized to the tile;
 *  - max: always the best rendition the stream offers (usually 1080p);
 *  - 720 / 480: never above that height (saves bandwidth and decoding).
 */
export type VideoQuality = 'auto' | 'max' | '720' | '480';
export type BufferSize = 'low' | 'normal' | 'high';
export type StartAudio = 'muted' | 'main';
/** Live data strip over onboards: never, while Live Timing is open somewhere, or always. */
export type DriverHudMode = 'off' | 'timing' | 'always';

export interface Preferences {
  videoQuality: VideoQuality;
  /** Live streams: how far behind the live edge playback is held, in seconds. */
  liveDelaySeconds: number;
  /** Experimental: ignore the stream's own delay and sit about one segment behind the newest video. */
  lowLatencyLive: boolean;
  bufferSize: BufferSize;
  /** Sync the multiview by itself whenever a stream starts. */
  autoSync: boolean;
  /** Floating controls, cursor and panel names hide after this many seconds still; 0 = never. */
  autoHideSeconds: number;
  /** Most streams the auto layout shows at once; 0 = as many as fit. */
  maxAutoTiles: number;
  /** Data channels give way to onboards while live timing is open. */
  hideDataWithTiming: boolean;
  /** Which stream has audio when the multiview starts. */
  startAudio: StartAudio;
  driverHud: DriverHudMode;
  /** Auto layout follows live timing: onboards of retired drivers leave, the others follow the running order. */
  smartAutoLayout: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  videoQuality: 'auto',
  liveDelaySeconds: 4,
  lowLatencyLive: false,
  bufferSize: 'normal',
  autoSync: true,
  autoHideSeconds: 2.5,
  maxAutoTiles: 0,
  hideDataWithTiming: true,
  startAudio: 'muted',
  driverHud: 'timing',
  smartAutoLayout: true,
};

export const LIVE_DELAY_OPTIONS = [4, 10, 20, 30, 45, 60] as const;
export const AUTO_HIDE_OPTIONS = [1.5, 2.5, 5, 10, 0] as const;
export const MAX_AUTO_TILES_OPTIONS = [0, 2, 3, 4, 6, 9, 12] as const;

const oneOf = <T,>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;
const numberIn = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

/** Missing or invalid fields fall back to their default, so old and hand-edited values stay safe. */
export function parsePreferences(raw: string | null): Preferences {
  let value: Record<string, unknown> = {};
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) value = parsed;
  } catch {
    // Corrupt value: defaults.
  }
  const d = DEFAULT_PREFERENCES;
  return {
    videoQuality: oneOf(value.videoQuality, ['auto', 'max', '720', '480'] as const, d.videoQuality),
    liveDelaySeconds: numberIn(value.liveDelaySeconds, 2, 120, d.liveDelaySeconds),
    lowLatencyLive: bool(value.lowLatencyLive, d.lowLatencyLive),
    bufferSize: oneOf(value.bufferSize, ['low', 'normal', 'high'] as const, d.bufferSize),
    autoSync: bool(value.autoSync, d.autoSync),
    autoHideSeconds: numberIn(value.autoHideSeconds, 0, 60, d.autoHideSeconds),
    maxAutoTiles: Math.round(numberIn(value.maxAutoTiles, 0, 30, d.maxAutoTiles)),
    hideDataWithTiming: bool(value.hideDataWithTiming, d.hideDataWithTiming),
    startAudio: oneOf(value.startAudio, ['muted', 'main'] as const, d.startAudio),
    driverHud: oneOf(value.driverHud, ['off', 'timing', 'always'] as const, d.driverHud),
    smartAutoLayout: bool(value.smartAutoLayout, d.smartAutoLayout),
  };
}

let cache: Preferences | null = null;
const listeners = new Set<() => void>();

function emit(next: Preferences): void {
  cache = next;
  for (const listener of listeners) listener();
}

export function getPreferences(): Preferences {
  if (cache == null) {
    try {
      cache = parsePreferences(localStorage.getItem(PREFERENCES_KEY));
    } catch {
      cache = { ...DEFAULT_PREFERENCES };
    }
  }
  return cache;
}

export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
  const next = parsePreferences(JSON.stringify({ ...getPreferences(), [key]: value }));
  const raw = JSON.stringify(next);
  try {
    localStorage.setItem(PREFERENCES_KEY, raw);
  } catch (_) {}
  persistDurableSetting(PREFERENCES_KEY, raw);
  emit(next);
}

export function resetPreferences(): void {
  try {
    localStorage.removeItem(PREFERENCES_KEY);
  } catch (_) {}
  persistDurableSetting(PREFERENCES_KEY, JSON.stringify(DEFAULT_PREFERENCES));
  emit({ ...DEFAULT_PREFERENCES });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Settings changed in another window (multiview popout, main window).
  const onStorage = (event: StorageEvent) => {
    if (event.key === PREFERENCES_KEY) emit(parsePreferences(event.newValue));
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, getPreferences);
}
