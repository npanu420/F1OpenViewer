import { persistDurableSetting } from './durableStorage';

const DOCK_WIDTH_KEY = 'f1openviewer-livetiming-dock-width';

export const DEFAULT_DOCK_WIDTH = 360;
export const MIN_DOCK_WIDTH = 280;
/** Hard max. Real cap is ~60% of window width, see LiveTimingDock. */
export const MAX_DOCK_WIDTH = 1600;
/** Below this width the dock uses the compact glance layout instead of full sectors/radio. */
export const WIDE_DOCK_THRESHOLD = 640;

function clamp(width: number): number {
  return Math.max(MIN_DOCK_WIDTH, Math.min(MAX_DOCK_WIDTH, Math.round(width)));
}

export function getDockWidth(): number {
  if (typeof localStorage === 'undefined') return DEFAULT_DOCK_WIDTH;
  const raw = localStorage.getItem(DOCK_WIDTH_KEY);
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) ? clamp(n) : DEFAULT_DOCK_WIDTH;
}

export function setDockWidth(width: number): void {
  const v = clamp(width);
  try {
    localStorage.setItem(DOCK_WIDTH_KEY, String(v));
  } catch (_) {}
  persistDurableSetting(DOCK_WIDTH_KEY, String(v));
}
