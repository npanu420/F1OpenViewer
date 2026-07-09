/** OpenF1 headshots. On error return null; shelf falls back to initials. */

const OPENF1_BASE = 'https://api.openf1.org/v1';
const FETCH_TIMEOUT_MS = 8000;
/** Fallback per-number lookups only (after bulk prefetch). */
const MAX_CONCURRENT = 1;
const MIN_GAP_MS = 500;
const MAX_RETRIES = 4;

const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

type OpenF1Driver = {
  driver_number?: number;
  full_name?: string;
  broadcast_name?: string;
  headshot_url?: string | null;
};

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

function cacheKeysForRecord(d: OpenF1Driver): string[] {
  const n = d.driver_number;
  if (n == null || !Number.isFinite(n)) return [];
  const keys = new Set<string>();
  keys.add(`${n}|`);
  if (d.full_name) keys.add(`${n}|${normalizeName(d.full_name)}`);
  if (d.broadcast_name) keys.add(`${n}|${normalizeName(d.broadcast_name)}`);
  return [...keys];
}

function ingestDrivers(drivers: OpenF1Driver[]) {
  for (const d of drivers) {
    const url = d.headshot_url || null;
    for (const key of cacheKeysForRecord(d)) {
      if (url) cache.set(key, url);
      else if (!cache.has(key)) cache.set(key, null);
    }
  }
}

function pickHeadshot(drivers: OpenF1Driver[], driverNumber: number, driverName?: string): string | null {
  const expected = driverName ? normalizeName(driverName) : '';
  const forNumber = drivers.filter((d) => d.driver_number === driverNumber);
  const candidates = expected
    ? forNumber.filter((d) => {
        const full = d.full_name ? normalizeName(d.full_name) : '';
        const broadcast = d.broadcast_name ? normalizeName(d.broadcast_name) : '';
        return full === expected || broadcast === expected || full.includes(expected) || expected.includes(full);
      })
    : forNumber;
  for (let i = candidates.length - 1; i >= 0; i--) {
    if (candidates[i].headshot_url) return candidates[i].headshot_url as string;
  }
  return null;
}

let directoryPromise: Promise<void> | null = null;
let lastFetchAt = 0;

async function openF1Get(path: string, attempt = 0): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${OPENF1_BASE}${path}`, { signal: controller.signal });
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 800 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, waitMs));
      return openF1Get(path, attempt + 1);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function tryBulk(path: string): Promise<boolean> {
  const res = await openF1Get(path);
  if (!res.ok) {
    if (res.status !== 404) console.warn(`[driverHeadshots] bulk ${path} HTTP ${res.status}`);
    return false;
  }
  const drivers = (await res.json()) as OpenF1Driver[];
  if (!Array.isArray(drivers) || drivers.length === 0) return false;
  ingestDrivers(drivers);
  console.log(`[driverHeadshots] loaded ${drivers.length} drivers from ${path}`);
  return true;
}

async function loadDriverDirectory(): Promise<void> {
  if (await tryBulk('/drivers?session_key=latest')) return;

  try {
    const year = new Date().getFullYear();
    const sessionsRes = await openF1Get(`/sessions?year=${year}`);
    if (sessionsRes.ok) {
      const sessions = (await sessionsRes.json()) as Array<{ session_key?: number; session_name?: string; date_start?: string }>;
      const sorted = [...sessions].sort((a, b) => String(b.date_start || '').localeCompare(String(a.date_start || '')));
      const race = sorted.find((s) => /race/i.test(s.session_name || '')) ?? sorted[0];
      if (race?.session_key != null && await tryBulk(`/drivers?session_key=${race.session_key}`)) return;
    }
  } catch (e) {
    console.warn('[driverHeadshots] session lookup failed:', e instanceof Error ? e.message : e);
  }
}

function ensureDirectory(): Promise<void> {
  if (!directoryPromise) directoryPromise = loadDriverDirectory();
  return directoryPromise;
}

/** One OpenF1 round-trip for the whole shelf; call when driver cards mount. */
export function prefetchDriverHeadshots(): Promise<void> {
  return ensureDirectory();
}

let activeCount = 0;
const queue: Array<() => void> = [];
function withConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = async () => {
      const gap = MIN_GAP_MS - (Date.now() - lastFetchAt);
      if (gap > 0) await new Promise((r) => setTimeout(r, gap));
      activeCount++;
      try {
        const out = await fn();
        resolve(out);
      } catch (e) {
        reject(e);
      } finally {
        lastFetchAt = Date.now();
        activeCount--;
        const next = queue.shift();
        if (next) next();
      }
    };
    if (activeCount < MAX_CONCURRENT) run();
    else queue.push(run);
  });
}

/**
 * Headshot by car number, matched by name when possible.
 * Prefers bulk directory; falls back to a single throttled API call.
 */
export async function getDriverHeadshotUrl(driverNumber: number, driverName?: string): Promise<string | null> {
  if (!Number.isFinite(driverNumber) || driverNumber <= 0) return null;
  const expected = driverName ? normalizeName(driverName) : '';
  const cacheKey = `${driverNumber}|${expected}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;
  const existing = inflight.get(cacheKey);
  if (existing) return existing;

  const promise = (async () => {
    await ensureDirectory();
    if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;

    return withConcurrencyLimit(async () => {
      if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;
      let url: string | null = null;
      try {
        const res = await openF1Get(`/drivers?driver_number=${driverNumber}`);
        if (res.ok) {
          const drivers = (await res.json()) as OpenF1Driver[];
          url = pickHeadshot(drivers, driverNumber, driverName);
          if (!url) {
            console.debug(
              `[driverHeadshots] no photo for #${driverNumber} ("${driverName}"): ${drivers.length} record(s)`
            );
          }
        } else if (res.status === 429) {
          console.warn(`[driverHeadshots] rate limited for #${driverNumber} after retries`);
        } else if (res.status !== 404) {
          console.warn(`[driverHeadshots] HTTP ${res.status} for #${driverNumber}`);
        }
      } catch (e) {
        console.warn(`[driverHeadshots] fetch failed for #${driverNumber}:`, e instanceof Error ? e.message : e);
      }
      cache.set(cacheKey, url);
      return url;
    });
  })().finally(() => {
    inflight.delete(cacheKey);
  });

  inflight.set(cacheKey, promise);
  return promise;
}
