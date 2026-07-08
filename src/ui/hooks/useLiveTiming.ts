import { useEffect, useRef, useState } from 'react';
import {
  createStore,
  applyRecord,
  selectDrivers,
  selectWeather,
  selectTrackStatus,
  selectRaceControl,
  selectClock,
  selectLapCount,
  selectTeamRadio,
  type TimingStore,
  type DriverRow,
  type WeatherView,
  type RaceControlMessage,
  type TeamRadioClip,
} from '../../domain/timing';

export interface LiveTimingQuery {
  year?: number;
  sessionKey?: string | number;
  meetingName?: string;
  sessionName?: string;
}

export interface LiveTimingState {
  loading: boolean;
  error: string | null;
  connected: boolean;
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

const EMPTY: Omit<LiveTimingState, 'loading' | 'error' | 'connected' | 'sessionPath'> = {
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

    const pushDerived = () => {
      const store = storeRef.current;
      setState((prev) => ({
        ...prev,
        drivers: selectDrivers(store),
        weather: selectWeather(store),
        trackStatus: selectTrackStatus(store),
        raceControl: selectRaceControl(store),
        clock: selectClock(store),
        lapCount: selectLapCount(store),
        teamRadio: selectTeamRadio(store),
      }));
    };

    const unsubUpdate = lt.onLiveUpdate(({ feed, data }) => {
      applyRecord(storeRef.current, feed, data);
      pushDerived();
    });
    const unsubStatus = lt.onLiveStatus(({ status, detail }) => {
      if (cancelled) return;
      setState((p) => ({
        ...p,
        connected: status === 'connected',
        error: status === 'error' ? detail || 'Live connection error.' : p.error,
      }));
    });

    lt.liveStart(query)
      .then(({ path, hasToken }) => {
        if (cancelled) return;
        setState((p) => ({
          ...p,
          loading: false,
          sessionPath: path,
          error: hasToken ? null : 'Sign in required for live timing.',
        }));
      })
      .catch((e) => {
        if (!cancelled) setState((p) => ({ ...p, loading: false, error: e?.message || 'Live timing unavailable.' }));
      });

    return () => {
      cancelled = true;
      unsubUpdate();
      unsubStatus();
      lt.liveStop().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query?.sessionKey, query?.year, query?.meetingName, query?.sessionName]);

  return state;
}
