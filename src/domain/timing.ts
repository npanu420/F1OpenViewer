/**
 * Live-timing state reducer + selectors (transport-agnostic).
 *
 * Both transports emit records of shape `(feed, data)`:
 *   - SignalR: an initial full snapshot, then deep-merge deltas.
 *   - Static `.jsonStream`: the first record is a full snapshot, later records are deltas.
 * F1's delta semantics are a recursive merge: objects merge by key, arrays merge by index,
 * scalars replace. High-frequency telemetry feeds (CarData/Position) are snapshots, not deltas,
 * so we keep only the latest.
 *
 * Pure module, no Electron, no React. Unit-tested in timing.test.ts.
 */

export type Json = any;
export type TimingStore = Record<string, Json>;

/** Feeds where each record is a complete snapshot to replace (not merge). */
const REPLACE_FEEDS = new Set(['CarData', 'Position']);

/** Removes the compression suffix from feed names used as store keys. */
export function feedKey(feed: string): string {
  return feed.endsWith('.z') ? feed.slice(0, -2) : feed;
}

function isPlainContainer(v: unknown): v is Record<string, Json> {
  return v != null && typeof v === 'object';
}

/**
 * Recursive merge of an F1 delta into the existing value. Mutates and returns `target`.
 * - Source arrays merge by index, recursing into each element.
 * - Source objects merge by key; numeric keys preserve array targets.
 *   index into it (covers RaceControlMessages: snapshot is an array, deltas are keyed objects)
 * - Source scalars replace the target.
 */
export function mergeDeep(target: Json, source: Json): Json {
  if (Array.isArray(source)) {
    const base = Array.isArray(target) ? target : [];
    source.forEach((v, i) => {
      if (v === undefined) return; // sparse delta hole: keep existing element
      base[i] = mergeDeep(base[i], v);
    });
    return base;
  }
  if (isPlainContainer(source)) {
    const base = isPlainContainer(target) ? target : {};
    for (const k of Object.keys(source)) {
      // Feed data is untrusted JSON; skip keys that could reach Object.prototype instead of
      // just this object's own properties.
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      base[k] = mergeDeep((base as Record<string, Json>)[k], source[k]);
    }
    return base;
  }
  return source;
}

export function createStore(): TimingStore {
  return {};
}

/** Apply one feed record to the store (in place). Returns the same store for chaining. */
export function applyRecord(store: TimingStore, feed: string, data: Json): TimingStore {
  const key = feedKey(feed);
  if (REPLACE_FEEDS.has(key)) {
    store[key] = data;
  } else {
    store[key] = mergeDeep(store[key], data);
  }
  return store;
}

/** Apply many records in order (e.g. a replayed archive window). */
export function applyRecords(
  store: TimingStore,
  records: Array<{ feed: string; data: Json }>
): TimingStore {
  for (const r of records) applyRecord(store, r.feed, r.data);
  return store;
}

// View model selectors

export interface SectorView {
  value: string;
  overallFastest: boolean;
  personalFastest: boolean;
  /** Mini-sector segment status codes (F1: 0 none, 2049 green, 2051 purple, 2048 yellow). */
  segments: number[];
}

export interface DriverRow {
  number: string;
  tla: string;
  name: string;
  teamColour: string;
  line: number;
  position: string;
  gapToLeader: string;
  interval: string;
  lastLap: string;
  bestLap: string;
  inPit: boolean;
  pitOut: boolean;
  retired: boolean;
  sectors: SectorView[];
  tyre: string;
  stintLaps: number | null;
  speedKmh: number | null;
  gear: number | null;
  drs: boolean;
  /** Full stint history (tyre changes = pit stops), oldest first. */
  stints: StintView[];
}

export interface StintView {
  compound: string;
  laps: number | null;
  isNew: boolean;
}

const CH = { RPM: 0, Speed: 2, Gear: 3, Throttle: 4, Brake: 5, DRS: 45 };

/** Latest CarData snapshot (Entries are time-ordered). */
function latestCarChannels(store: TimingStore, num: string): Record<string, number> | null {
  const entries = store.CarData?.Entries;
  if (!Array.isArray(entries) || !entries.length) return null;
  const last = entries[entries.length - 1];
  return last?.Cars?.[num]?.Channels ?? null;
}

/** Full stint history (tyre changes = pit stops); Stints may be an array or a keyed object. */
function allStints(appLine: Json): StintView[] {
  const stints = appLine?.Stints;
  if (!stints) return [];
  const list = Array.isArray(stints) ? stints : Object.values(stints);
  return list.filter(Boolean).map((s: Json) => {
    const laps = s.TotalLaps ?? s.StartLaps ?? null;
    return {
      compound: String(s.Compound || '').toUpperCase(),
      laps: typeof laps === 'number' ? laps : null,
      isNew: String(s.New).toLowerCase() === 'true',
    };
  });
}

/** Segments may be an array or a keyed object (delta). Returns status codes in index order. */
function toSegments(sec: Json): number[] {
  const seg = sec?.Segments;
  if (!seg) return [];
  const list = Array.isArray(seg) ? seg : Object.values(seg);
  return list.map((x: Json) => Number(x?.Status ?? 0));
}

function toSectors(timingLine: Json): SectorView[] {
  const s = timingLine?.Sectors;
  const list = Array.isArray(s) ? s : s ? Object.values(s) : [];
  return list.map((sec: Json) => ({
    value: String(sec?.Value ?? ''),
    overallFastest: !!sec?.OverallFastest,
    personalFastest: !!sec?.PersonalFastest,
    segments: toSegments(sec),
  }));
}

/**
 * Join DriverList + TimingData + TimingAppData + CarData into per-driver rows,
 * sorted by track position. A DRS channel value of eight or more means active.
 */
export function selectDrivers(store: TimingStore): DriverRow[] {
  const drivers = store.DriverList;
  if (!isPlainContainer(drivers)) return [];
  const timingLines = store.TimingData?.Lines ?? {};
  const appLines = store.TimingAppData?.Lines ?? {};

  const rows: DriverRow[] = [];
  for (const num of Object.keys(drivers)) {
    if (num.startsWith('_')) continue; // skip meta keys
    const d = drivers[num] ?? {};
    const tl = timingLines[num] ?? {};
    const stints = allStints(appLines[num]);
    const stint = stints[stints.length - 1] ?? { compound: '', laps: null };
    const ch = latestCarChannels(store, num);
    const drsVal = ch ? Number(ch[CH.DRS] ?? 0) : 0;
    rows.push({
      number: num,
      tla: String(d.Tla || ''),
      name: String(d.BroadcastName || d.FullName || ''),
      teamColour: d.TeamColour ? `#${String(d.TeamColour).replace(/^#/, '')}` : '#666',
      line: Number(tl.Line ?? d.Line ?? 999),
      position: String(tl.Position ?? d.Line ?? ''),
      gapToLeader: String(tl.GapToLeader ?? ''),
      interval: String(tl.IntervalToPositionAhead?.Value ?? ''),
      lastLap: String(tl.LastLapTime?.Value ?? ''),
      bestLap: String(tl.BestLapTime?.Value ?? ''),
      inPit: !!tl.InPit,
      pitOut: !!tl.PitOut,
      retired: !!tl.Retired,
      sectors: toSectors(tl),
      tyre: stint.compound,
      stintLaps: stint.laps,
      speedKmh: ch ? Number(ch[CH.Speed] ?? 0) : null,
      gear: ch ? Number(ch[CH.Gear] ?? 0) : null,
      drs: drsVal >= 8,
      stints,
    });
  }
  rows.sort((a, b) => a.line - b.line);
  return rows;
}

export interface WeatherView {
  airTemp: string;
  trackTemp: string;
  humidity: string;
  pressure: string;
  windSpeed: string;
  windDirection: string;
  rainfall: boolean;
}

export function selectWeather(store: TimingStore): WeatherView | null {
  const w = store.WeatherData;
  if (!isPlainContainer(w)) return null;
  return {
    airTemp: String(w.AirTemp ?? ''),
    trackTemp: String(w.TrackTemp ?? ''),
    humidity: String(w.Humidity ?? ''),
    pressure: String(w.Pressure ?? ''),
    windSpeed: String(w.WindSpeed ?? ''),
    windDirection: String(w.WindDirection ?? ''),
    rainfall: String(w.Rainfall ?? '0') !== '0',
  };
}

const TRACK_STATUS_LABEL: Record<string, string> = {
  '1': 'Track Clear',
  '2': 'Yellow',
  '4': 'Safety Car',
  '5': 'Red Flag',
  '6': 'Virtual Safety Car',
  '7': 'VSC Ending',
};

export function selectTrackStatus(store: TimingStore): { status: string; label: string } | null {
  const t = store.TrackStatus;
  if (!isPlainContainer(t)) return null;
  const status = String(t.Status ?? '');
  return { status, label: TRACK_STATUS_LABEL[status] || String(t.Message || 'Unknown') };
}

export interface RaceControlMessage {
  utc: string;
  lap: number | null;
  category: string;
  message: string;
  flag?: string;
}

/** Race control messages, newest first. Handles both the array snapshot and keyed deltas. */
export function selectRaceControl(store: TimingStore): RaceControlMessage[] {
  const m = store.RaceControlMessages?.Messages;
  if (!m) return [];
  const list = (Array.isArray(m) ? m : Object.values(m)) as Json[];
  return list
    .filter(Boolean)
    .map((x) => ({
      utc: String(x.Utc ?? ''),
      lap: typeof x.Lap === 'number' ? x.Lap : null,
      category: String(x.Category ?? ''),
      message: String(x.Message ?? ''),
      flag: x.Flag ? String(x.Flag) : undefined,
    }))
    .reverse();
}

export function selectClock(store: TimingStore): { remaining: string; extrapolating: boolean } | null {
  const c = store.ExtrapolatedClock;
  if (!isPlainContainer(c)) return null;
  return { remaining: String(c.Remaining ?? ''), extrapolating: !!c.Extrapolating };
}

export function selectLapCount(store: TimingStore): { current: number; total: number } | null {
  const l = store.LapCount;
  if (!isPlainContainer(l)) return null;
  const current = Number(l.CurrentLap ?? 0);
  const total = Number(l.TotalLaps ?? 0);
  if (!total) return null;
  return { current, total };
}

export interface TeamRadioClip {
  utc: string;
  number: string;
  path: string;
}

/** Team radio captures, newest first. Captures may be an array or keyed object. */
export function selectTeamRadio(store: TimingStore): TeamRadioClip[] {
  const c = store.TeamRadio?.Captures;
  if (!c) return [];
  const list = (Array.isArray(c) ? c : Object.values(c)) as Json[];
  return list
    .filter(Boolean)
    .map((x) => ({
      utc: String(x.Utc ?? ''),
      number: String(x.RacingNumber ?? ''),
      path: String(x.Path ?? ''),
    }))
    .reverse();
}
