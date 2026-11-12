import { useSyncExternalStore } from 'react';
import { persistDurableSetting } from './durableStorage';

const FAVORITE_DRIVERS_KEY = 'f1openviewer-favorite-drivers';
const MAX_FAVORITES = 30;

/** Drivers are matched by name: racing numbers change between seasons (the champion's #1). */
export function favoriteDriverKey(name: string | undefined | null): string {
  return (name ?? '').trim().toLowerCase();
}

function parse(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.filter((name): name is string => {
      if (typeof name !== 'string') return false;
      const key = favoriteDriverKey(name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, MAX_FAVORITES);
  } catch {
    return [];
  }
}

function read(): string[] {
  try {
    return parse(localStorage.getItem(FAVORITE_DRIVERS_KEY));
  } catch {
    return [];
  }
}

// Cached so React subscribers get a stable snapshot.
let cache: string[] | null = null;
const listeners = new Set<() => void>();

function emit(next: string[]): void {
  cache = next;
  for (const listener of listeners) listener();
}

/** Favourite driver names, in the order they were added (their priority in the automatic layout). */
export function getFavoriteDrivers(): string[] {
  if (cache == null) cache = read();
  return cache;
}

function write(next: string[]): void {
  const raw = JSON.stringify(next);
  try {
    localStorage.setItem(FAVORITE_DRIVERS_KEY, raw);
  } catch (_) {}
  persistDurableSetting(FAVORITE_DRIVERS_KEY, raw);
  emit(next);
}

export function isFavoriteDriver(name: string | undefined | null, favorites: readonly string[] = getFavoriteDrivers()): boolean {
  const key = favoriteDriverKey(name);
  return key !== '' && favorites.some((favorite) => favoriteDriverKey(favorite) === key);
}

export function toggleFavoriteDriver(name: string): void {
  const key = favoriteDriverKey(name);
  if (!key) return;
  const current = getFavoriteDrivers();
  const without = current.filter((favorite) => favoriteDriverKey(favorite) !== key);
  write(without.length === current.length ? [...current, name.trim()].slice(0, MAX_FAVORITES) : without);
}

export function clearFavoriteDrivers(): void {
  write([]);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another window (multiview popout, settings in the main window) changed the list.
  const onStorage = (event: StorageEvent) => {
    if (event.key === FAVORITE_DRIVERS_KEY) emit(parse(event.newValue));
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useFavoriteDrivers(): string[] {
  return useSyncExternalStore(subscribe, getFavoriteDrivers);
}
