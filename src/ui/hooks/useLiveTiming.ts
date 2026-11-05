import { useEffect, useRef, useState } from 'react';
import {
  createStore,
  applyRecord,
  feedKey,
  selectDrivers,
  selectWeather,
  selectTrackStatus,
  selectRaceControl,
  selectClock,
  selectLapCount,
  selectTeamRadio,
  stabilizeRows,
  type TimingStore,
  type DriverRow,
  type WeatherView,
  type RaceControlMessage,
  type TeamRadioClip,
} from '../../domain/timing';

/** View-model refresh cap: bursts of feed records (race start) coalesce into one render per interval. */
export const LIVE_FLUSH_MS = 100;
const RESOLVE_RETRY_MS = 60_000;

export interface LiveTimingQuery {
  year?: number;
  sessionKey?: string | number;
  meetingName?: string;
  sessionName?: string;
}

/** connecting: first attempt · connected: receiving · reconnecting: dropped, main process is retrying. */
export type LiveConnectionStatus = 'connecting' | 'connected' | 'reconnecting';

export interface LiveTimingState {
  loading: boolean;
  /** Fatal: the live feed could not be started at all. Transient drops use `status`/`statusDetail`. */
  error: string | null;
  connected: boolean;
  status: LiveConnectionStatus;
  /** Last transport error while reconnecting (cleared as soon as the connection is back). */
  statusDetail: string | null;
  /** Archive Path, resolved separately from the live feed itself, only used for team-radio
   *  audio URLs. Null until resolvable (e.g. very early in a session). */
  sessionPath: string | null;
  drivers: DriverRow[];
  weather: WeatherView | null;
  trackStatus: { status: string; label: string } | null;
  raceControl: RaceControlMessage[];
  clock: { remaining: string; extrapolating: boolean } | null;
  lapCount: { current: number; total: number } | null;
  teamRadio: TeamRadioClip[];
}

const EMPTY: Omit<LiveTimingState, 'loading' | 'error' | 'connected' | 'status' | 'statusDetail' | 'sessionPath'> = {
  drivers: [],
  weather: null,
  trackStatus: null,
  raceControl: [],
  clock: null,
  lapCount: null,
  teamRadio: [],
};

/**
 * Live (SignalR) counterpart to useReplayTiming. Same derived-state shape (drivers/weather/
 * etc via the same transport-agnostic selectors) but pushed by the main process instead of
 * self-driven by a replay clock. No play/pause/seek/sync: it's just "now".
 */
export function useLiveTiming(query: LiveTimingQuery | null) {
  const storeRef = useRef<TimingStore>(createStore());
  const [state, setState] = useState<LiveTimingState>({
    loading: true,
    error: null,
    connected: false,
    status: 'connecting',
    statusDetail: null,
    sessionPath: null,
    ...EMPTY,
  });

  useEffect(() => {
    const lt = window.f1?.liveTiming;
    if (!query || !lt?.liveStart) {
      setState((p) => ({ ...p, loading: false, error: 'Live timing unavailable.' }));
      return;
    }
    let cancelled = false;
    storeRef.current = createStore();
    // New query: drop the previous session's table/status instead of showing it until the first flush.
    setState({ loading: true, error: null, connected: false, status: 'connecting', statusDetail: null, sessionPath: null, ...EMPTY });

    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    /** Feeds touched since the last flush: unchanged lists keep their identity (memoized rows/lists skip). */
    const dirty = new Set<string>();
    let resolveTimer: ReturnType<typeof setInterval> | null = null;
    const flush = () => {
      flushTimer = null;
      if (cancelled) return;
      const store = storeRef.current;
      const touched = new Set(dirty);
      dirty.clear();
      const has = (...feeds: string[]) => feeds.some((f) => touched.has(f));
      setState((prev) => ({
        ...prev,
        drivers: has('TimingData', 'TimingAppData', 'DriverList', 'CarData', 'Position', 'TimingStats')
          ? stabilizeRows(prev.drivers, selectDrivers(store))
          : prev.drivers,
        weather: has('WeatherData') ? selectWeather(store) : prev.weather,
        trackStatus: has('TrackStatus') ? selectTrackStatus(store) : prev.trackStatus,
        raceControl: has('RaceControlMessages') ? selectRaceControl(store) : prev.raceControl,
        clock: selectClock(store),
        lapCount: has('LapCount') ? selectLapCount(store) : prev.lapCount,
        teamRadio: has('TeamRadio') ? selectTeamRadio(store) : prev.teamRadio,
      }));
    };

    const unsubUpdate = lt.onLiveUpdate(({ feed, data }) => {
      applyRecord(storeRef.current, feed, data);
      dirty.add(feedKey(feed));
      // Apply every record immediately (the store is cheap) but render at most once per interval.
      if (flushTimer == null) flushTimer = setTimeout(flush, LIVE_FLUSH_MS);
    });
    const unsubStatus = lt.onLiveStatus(({ status, detail }) => {
      if (cancelled) return;
      setState((p) => {
        if (status === 'connected') return { ...p, connected: true, status: 'connected', statusDetail: null };
        if (status === 'error') {
          return { ...p, connected: false, status: 'reconnecting', statusDetail: detail || p.statusDetail || null };
        }
        // 'disconnected' / 'reconnecting': the main process retries with backoff on its own.
        return { ...p, connected: false, status: 'reconnecting', statusDetail: detail ?? p.statusDetail };
      });
    });

    // The archive Index only lists a session some time after it starts, so the path is often null at
    // first. Without a path the radio clips cannot be fetched, so keep asking (cheap: cached index).
    const resolveLater = () => {
      resolveTimer = setInterval(() => {
        lt.resolveSession(query.year || new Date().getFullYear(), query)
          .then((found) => {
            if (cancelled || !found?.path) return;
            if (resolveTimer) { clearInterval(resolveTimer); resolveTimer = null; }
            setState((p) => ({ ...p, sessionPath: found.path }));
          })
          .catch(() => {});
      }, RESOLVE_RETRY_MS);
    };

    lt.liveStart(query)
      .then(({ path }) => {
        if (cancelled) return;
        setState((p) => ({ ...p, loading: false, sessionPath: path }));
        if (!path) resolveLater();
      })
      .catch((e) => {
        if (!cancelled) setState((p) => ({ ...p, loading: false, error: e?.message || 'Live timing unavailable.' }));
      });

    return () => {
      cancelled = true;
      if (flushTimer != null) clearTimeout(flushTimer);
      if (resolveTimer != null) clearInterval(resolveTimer);
      unsubUpdate();
      unsubStatus();
      lt.liveStop().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query?.sessionKey, query?.year, query?.meetingName, query?.sessionName]);

  return state;
}
