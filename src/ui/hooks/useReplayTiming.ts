import { useCallback, useEffect, useRef, useState } from 'react';
import { buildTimeline, timelineDuration } from '../../domain/replay';
import { ReplayController } from '../../domain/replayController';
import {
  selectDrivers,
  selectWeather,
  selectTrackStatus,
  selectRaceControl,
  selectClock,
  selectLapCount,
  selectTeamRadio,
  type DriverRow,
  type WeatherView,
  type RaceControlMessage,
  type TeamRadioClip,
} from '../../domain/timing';

export interface ReplayTimingState {
  loading: boolean;
  error: string | null;
  drivers: DriverRow[];
  weather: WeatherView | null;
  trackStatus: { status: string; label: string } | null;
  raceControl: RaceControlMessage[];
  clock: { remaining: string; extrapolating: boolean } | null;
  lapCount: { current: number; total: number } | null;
  teamRadio: TeamRadioClip[];
  offsetMs: number;
  durationMs: number;
  playing: boolean;
  speed: number;
  /** True while the clock is being driven by the relayed video position (cross-window sync). */
  synced: boolean;
  /** True when sync is driven by the DASH broadcast wall clock (exact, no calibration needed). */
  autoSynced: boolean;
  /** Manual alignment offset (ms) added to the video time, since video t=0 ≠ session t=0. */
  syncOffsetMs: number;
}

const EMPTY: Omit<ReplayTimingState, 'loading' | 'error' | 'offsetMs' | 'durationMs' | 'playing' | 'speed' | 'synced' | 'autoSynced' | 'syncOffsetMs'> = {
  drivers: [],
  weather: null,
  trackStatus: null,
  raceControl: [],
  clock: null,
  lapCount: null,
  teamRadio: [],
};

const TICK_MS = 200;

function parseHMS(s: string): number | null {
  const m = String(s).match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.\d+)?$/);
  if (!m) return null;
  const [, h, mm, ss] = m;
  return ((Number(h || 0) * 60 + Number(mm)) * 60 + Number(ss)) * 1000;
}

/**
 * The wall-clock UTC (ms) that the replay's offset 0 corresponds to. Any feed record carrying a
 * `Utc` is anchored: baseUtc = Utc - offsetMs (consistent across feeds to the millisecond). This
 * lets us map a video frame's broadcast UTC straight to a replay offset for exact auto-sync.
 */
function computeFeedBaseUtc(byFeed: Record<string, Array<{ offsetMs: number; data: any }>>): number | null {
  const tryRec = (offsetMs: number, utc: any): number | null => {
    const t = Date.parse(String(utc));
    return Number.isFinite(t) ? t - offsetMs : null;
  };
  for (const rec of byFeed?.ExtrapolatedClock ?? []) {
    const b = rec?.data?.Utc != null ? tryRec(rec.offsetMs, rec.data.Utc) : null;
    if (b != null) return b;
  }
  // Fallbacks: keyed-message feeds also carry Utc.
  for (const rec of byFeed?.RaceControlMessages ?? []) {
    const msgs = rec?.data?.Messages;
    const list = Array.isArray(msgs) ? msgs : msgs ? Object.values(msgs) : [];
    for (const m of list as any[]) {
      if (m?.Utc) { const b = tryRec(rec.offsetMs, m.Utc); if (b != null) return b; }
    }
  }
  return null;
}

/**
 * Scheduled session start as UTC ms, from SessionInfo (StartDate is local plus a GmtOffset field).
 * The replay video begins within about a minute of this, so it seeds a near-aligned default offset
 * for streams without a broadcast wall clock. The user can still fine-tune by seconds afterward.
 */
function computeSessionStartUtc(byFeed: Record<string, Array<{ data: any }>>): number | null {
  const si = byFeed?.SessionInfo?.[0]?.data;
  if (!si?.StartDate) return null;
  const localMs = Date.parse(`${si.StartDate}Z`); // treat the naive local time as UTC, then correct
  if (!Number.isFinite(localMs)) return null;
  const m = String(si.GmtOffset || '00:00:00').match(/^(-)?(\d{1,2}):(\d{2})/);
  const offMs = m ? (m[1] ? -1 : 1) * ((Number(m[2]) * 60 + Number(m[3])) * 60000) : 0;
  return localMs - offMs; // UTC = local minus offset
}

/**
 * Feed offset (ms) where the session clock actually starts running: the first ExtrapolatedClock
 * record with Extrapolating true. For a race that's lights-out, for quali/practice it's the session
 * going green. This is the real anchor the sync endpoint's session_start (video-seconds to lights-out)
 * maps onto. SessionInfo.StartDate is only the scheduled start, which sits one formation lap
 * (roughly 3-4 minutes) earlier and would desync by that much if used directly.
 */
function computeClockStartOffset(byFeed: Record<string, Array<{ offsetMs: number; data: any }>>): number | null {
  for (const rec of byFeed?.ExtrapolatedClock ?? []) {
    if (rec?.data?.Extrapolating === true) return rec.offsetMs;
  }
  return null;
}

const SYNC_KEY = (path: string) => `f1lt-sync:${path}`;

function fmtHMS(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p2 = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p2(mm)}:${p2(ss)}` : `${p2(mm)}:${p2(ss)}`;
}

/**
 * Loads an archived session and replays it on a self-advancing clock. Returns the current
 * view-model plus transport controls. The clock source is internal for now; M4 swaps it for
 * the video playback offset (call seek() from a timeupdate listener instead).
 */
export function useReplayTiming(path: string | null, mvSyncStartSec: number | null = null) {
  const controllerRef = useRef<ReplayController | null>(null);
  const durationRef = useRef(0);
  const offsetRef = useRef(0);
  const speedRef = useRef(1);
  const playingRef = useRef(false);
  // Clock extrapolation: remember the Remaining value and the replay offset it was set at,
  // so we can tick it down 1:1 with the replay clock between sparse archive updates.
  const clockBaseRef = useRef<{ raw: string; remainingMs: number; atOffset: number } | null>(null);
  // Cross-window sync: follow the relayed video clock instead of self-advancing.
  const syncedRef = useRef(false);
  const autoSyncedRef = useRef(false); // exact wall-clock sync (dynamic manifests only)
  const mvSyncedRef = useRef(false);   // seeded from the sync endpoint's session_start (exact, no user effort)
  const syncOffsetRef = useRef(0);   // manual lead-in (video-time mode); seeded from sync data/SessionInfo, persisted
  const autoResidualRef = useRef(0); // small fine-tune applied on top of exact wall-clock sync
  const lastVideoSecRef = useRef(0);
  const lastWallClockRef = useRef<number | null>(null);
  const feedBaseUtcRef = useRef<number | null>(null);
  // lap number → first replay offset (ms) it appears at. Used to calibrate sync from the lap
  // shown on the video, since that's the only reliable anchor when the VOD carries no wall clock.
  const lapOffsetsRef = useRef<Map<number, number>>(new Map());

  const [state, setState] = useState<ReplayTimingState>({
    loading: true,
    error: null,
    ...EMPTY,
    offsetMs: 0,
    durationMs: 0,
    playing: false,
    speed: 1,
    synced: false,
    autoSynced: false,
    syncOffsetMs: 0,
  });

  const pushState = useCallback((extra?: Partial<ReplayTimingState>) => {
    const ctl = controllerRef.current;
    if (!ctl) return;
    const store = ctl.seekTo(offsetRef.current);
    const rawClock = selectClock(store);
    let clock = rawClock;
    if (rawClock) {
      const parsed = parseHMS(rawClock.remaining);
      const base = clockBaseRef.current;
      // Re-stamp the base whenever the archive's Remaining string changes (a new record landed)
      // or we seek backward past where it was set.
      if (parsed != null && (!base || base.raw !== rawClock.remaining || offsetRef.current < base.atOffset)) {
        clockBaseRef.current = { raw: rawClock.remaining, remainingMs: parsed, atOffset: offsetRef.current };
      }
      const b = clockBaseRef.current;
      if (b && rawClock.extrapolating) {
        const remaining = b.remainingMs - (offsetRef.current - b.atOffset);
        clock = { remaining: fmtHMS(remaining), extrapolating: true };
      } else if (b) {
        clock = { remaining: fmtHMS(b.remainingMs), extrapolating: false };
      }
    }
    setState((prev) => ({
      ...prev,
      drivers: selectDrivers(store),
      weather: selectWeather(store),
      trackStatus: selectTrackStatus(store),
      raceControl: selectRaceControl(store),
      clock,
      lapCount: selectLapCount(store),
      teamRadio: selectTeamRadio(store),
      offsetMs: offsetRef.current,
      durationMs: durationRef.current,
      playing: playingRef.current,
      speed: speedRef.current,
      synced: syncedRef.current,
      autoSynced: autoSyncedRef.current || mvSyncedRef.current,
      syncOffsetMs: autoSyncedRef.current ? autoResidualRef.current : syncOffsetRef.current,
      ...extra,
    }));
  }, []);

  // Load the session once per path.
  useEffect(() => {
    let cancelled = false;
    if (!path || !window.f1?.liveTiming) {
      setState((p) => ({ ...p, loading: false, error: 'Live timing unavailable.' }));
      return;
    }
    setState((p) => ({ ...p, loading: true, error: null }));
    window.f1.liveTiming
      .loadSession(path)
      .then((byFeed) => {
        if (cancelled) return;
        const timeline = buildTimeline(byFeed as any);
        controllerRef.current = new ReplayController(timeline);
        durationRef.current = timelineDuration(timeline);
        // Map each lap number to the first offset its CurrentLap appears at (for calibrate-by-lap).
        const laps = new Map<number, number>();
        const lapRecs = (byFeed as Record<string, Array<{ offsetMs: number; data: any }>>)?.LapCount ?? [];
        for (const r of lapRecs) {
          const cl = r?.data?.CurrentLap;
          if (typeof cl === 'number' && !laps.has(cl)) laps.set(cl, r.offsetMs);
        }
        lapOffsetsRef.current = laps;
        feedBaseUtcRef.current = computeFeedBaseUtc(byFeed as any);
        // Seed the video-to-timing offset. Priority: a previously-saved manual alignment for this
        // session wins, otherwise the sync endpoint's curated session_start (exact, offset = video
        // minus start), otherwise estimate from the scheduled session start (within about a minute),
        // otherwise just 0.
        let seed = 0;
        let mv = false;
        try {
          const saved = path ? localStorage.getItem(SYNC_KEY(path)) : null;
          if (saved != null && Number.isFinite(Number(saved))) {
            seed = Number(saved);
          } else if (mvSyncStartSec != null && Number.isFinite(mvSyncStartSec)) {
            // session_start is video-seconds to the session's official start (lights out). Our
            // timeline is feed-relative (offset 0 = first record, roughly 30-50 min before lights
            // out), so we bridge with K, the feed offset of lights out:
            //   offset = videoSec*1000 + seed = (videoSec - session_start)*1000 + K
            // K comes from the feed's own clock-start offset (Extrapolating:true). The scheduled
            // SessionInfo start is one formation lap too early (verified 4.000 min off for the 2026
            // Chinese GP), so only fall back to it when the clock anchor is missing.
            let k = computeClockStartOffset(byFeed as any);
            if (k == null) {
              const startUtc = computeSessionStartUtc(byFeed as any);
              k = startUtc != null && feedBaseUtcRef.current != null ? startUtc - feedBaseUtcRef.current : 0;
            }
            seed = k - mvSyncStartSec * 1000;
            mv = true;
          } else {
            const startUtc = computeSessionStartUtc(byFeed as any);
            if (startUtc != null && feedBaseUtcRef.current != null) seed = startUtc - feedBaseUtcRef.current;
          }
        } catch (_) {}
        syncOffsetRef.current = seed;
        mvSyncedRef.current = mv;
        autoResidualRef.current = 0;
        offsetRef.current = 0;
        playingRef.current = true;
        setState((p) => ({ ...p, loading: false }));
        pushState();
      })
      .catch((e) => {
        if (!cancelled) setState((p) => ({ ...p, loading: false, error: e?.message || 'Load failed.' }));
      });
    return () => {
      cancelled = true;
    };
  }, [path, mvSyncStartSec, pushState]);

  // Self-advancing clock. Suspended while synced, since the relayed video clock drives the offset then.
  useEffect(() => {
    if (state.loading || state.error || !controllerRef.current) return;
    const id = setInterval(() => {
      if (syncedRef.current || !playingRef.current) return;
      offsetRef.current = Math.min(offsetRef.current + TICK_MS * speedRef.current, durationRef.current);
      if (offsetRef.current >= durationRef.current) playingRef.current = false;
      pushState();
    }, TICK_MS);
    return () => clearInterval(id);
  }, [state.loading, state.error, pushState]);

  // Subscribe to the relayed video master clock (from the window playing the streams).
  useEffect(() => {
    const lt = window.f1?.liveTiming;
    if (!lt?.onClock) return;
    return lt.onClock(({ timeSec, paused, wallClockMs }) => {
      if (!controllerRef.current) return;
      lastVideoSecRef.current = timeSec;
      lastWallClockRef.current = wallClockMs;
      syncedRef.current = true;
      const base = feedBaseUtcRef.current;
      // Exact auto-sync when the DASH wall clock + feed anchor are both known; else map from video
      // time with the (SessionInfo-seeded / saved / user) lead-in offset.
      if (wallClockMs != null && base != null) {
        autoSyncedRef.current = true;
        offsetRef.current = Math.max(0, Math.min(wallClockMs - base + autoResidualRef.current, durationRef.current));
      } else {
        autoSyncedRef.current = false;
        offsetRef.current = Math.max(0, Math.min(timeSec * 1000 + syncOffsetRef.current, durationRef.current));
      }
      playingRef.current = !paused;
      pushState();
    });
  }, [pushState]);

  const detach = () => { syncedRef.current = false; autoSyncedRef.current = false; mvSyncedRef.current = false; };
  const play = useCallback(() => {
    detach(); // manual transport detaches from video sync
    if (offsetRef.current >= durationRef.current) offsetRef.current = 0;
    playingRef.current = true;
    pushState();
  }, [pushState]);
  const pause = useCallback(() => {
    detach();
    playingRef.current = false;
    pushState();
  }, [pushState]);
  const seek = useCallback((ms: number) => {
    detach();
    offsetRef.current = Math.max(0, Math.min(ms, durationRef.current));
    pushState();
  }, [pushState]);
  const setSpeed = useCallback((s: number) => {
    speedRef.current = s;
    pushState();
  }, [pushState]);
  const persistOffset = useCallback(() => {
    try { if (path) localStorage.setItem(SYNC_KEY(path), String(syncOffsetRef.current)); } catch (_) {}
  }, [path]);
  const recomputeSynced = () => {
    const base = feedBaseUtcRef.current;
    if (autoSyncedRef.current && lastWallClockRef.current != null && base != null) {
      offsetRef.current = Math.max(0, Math.min(lastWallClockRef.current - base + autoResidualRef.current, durationRef.current));
    } else {
      offsetRef.current = Math.max(0, Math.min(lastVideoSecRef.current * 1000 + syncOffsetRef.current, durationRef.current));
    }
  };
  /** Nudge alignment (ms). Adjusts the fine residual (auto) or the lead-in offset (manual). */
  const nudgeSync = useCallback((deltaMs: number) => {
    if (autoSyncedRef.current) {
      autoResidualRef.current += deltaMs;
    } else {
      syncOffsetRef.current += deltaMs;
      mvSyncedRef.current = false; // user tuned it → now a local override, persist
      persistOffset();
    }
    if (syncedRef.current) recomputeSynced();
    pushState();
  }, [pushState, persistOffset]);
  /** Detach from video sync and resume manual self-drive. */
  const unsync = useCallback(() => {
    detach();
    pushState();
  }, [pushState]);
  /**
   * Align sync so the timing matches the lap currently shown on the video. Sets the offset so the
   * current video position maps to where this lap starts in the archive. This is the most reliable
   * anchor when the video has no wall clock, since the lap counter is always visible on screen.
   * Returns false if the lap isn't in the archive (e.g. lap 1 pre-race, or out of range).
   */
  const calibrateToLap = useCallback((lap: number): boolean => {
    const target = lapOffsetsRef.current.get(lap);
    if (target == null) return false;
    syncOffsetRef.current = target - lastVideoSecRef.current * 1000;
    mvSyncedRef.current = false;
    persistOffset();
    if (syncedRef.current) recomputeSynced();
    pushState();
    return true;
  }, [pushState, persistOffset]);

  return { ...state, play, pause, seek, setSpeed, nudgeSync, unsync, calibrateToLap };
}
