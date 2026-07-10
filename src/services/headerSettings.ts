import { persistDurableSetting } from './durableStorage';

const HEADER_COLLAPSED_KEY = 'f1openviewer-header-collapsed';

export function getHeaderCollapsed(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(HEADER_COLLAPSED_KEY) === '1';
}

export function setHeaderCollapsed(collapsed: boolean): void {
  const v = collapsed ? '1' : '0';
  try {
    localStorage.setItem(HEADER_COLLAPSED_KEY, v);
  } catch (_) {}
  persistDurableSetting(HEADER_COLLAPSED_KEY, v);
}
