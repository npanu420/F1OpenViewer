import { useEffect, useState } from 'react';
import { useReplayTiming } from '../hooks/useReplayTiming';
import { useLiveTiming } from '../hooks/useLiveTiming';
import { useHudPublisher } from '../../services/driverHud';
import type { DockSessionQuery } from './LiveTimingDock';

function ReplaySource({ path, syncStart, contentId, telemetry }: { path: string; syncStart: number | null; contentId?: number; telemetry: boolean }) {
  // Follows the players of this window directly: nothing registers with the main process.
  const timing = useReplayTiming(path, syncStart, contentId, { clockSource: 'local', telemetry });
  useHudPublisher(timing.loading || timing.error ? null : timing.drivers);
  return null;
}

function ReplayResolver({ query, telemetry }: { query: DockSessionQuery; telemetry: boolean }) {
  const [resolved, setResolved] = useState<{ path: string; syncStart: number | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setResolved(null);
    (async () => {
      try {
        const lt = window.f1?.liveTiming;
        if (!lt?.resolveSession || query.year == null) return;
        const found = await lt.resolveSession(query.year, {
          meetingName: query.meetingName,
          meetingNumber: query.meetingNumber,
          sessionName: query.sessionName,
          sessionType: query.sessionType,
          sessionKey: query.sessionKey != null ? String(query.sessionKey) : undefined,
        });
        if (!found) return;
        const sync = lt.getSyncData ? await lt.getSyncData(found.meeting?.Key as any, found.session?.Key as any).catch(() => null) : null;
        if (!cancelled) setResolved({ path: found.path, syncStart: sync?.sessionStartSec ?? null });
      } catch (_) {
        // No timing for this session: the tiles simply show no HUD.
      }
    })();
    return () => { cancelled = true; };
  }, [query.year, query.meetingName, query.meetingNumber, query.sessionName, query.sessionType, query.sessionKey]);
  return resolved ? <ReplaySource path={resolved.path} syncStart={resolved.syncStart} contentId={query.contentId} telemetry={telemetry} /> : null;
}

function LiveSource({ query }: { query: DockSessionQuery }) {
  const timing = useLiveTiming({ year: query.year, sessionKey: query.sessionKey, meetingName: query.meetingName, sessionName: query.sessionName });
  useHudPublisher(timing.loading || timing.error ? null : timing.drivers);
  return null;
}

/**
 * Timing without any UI, for the driver HUD and the smart auto layout when no Live Timing dock is
 * open in this window. Mount it only while needed: it downloads and replays the session's timing
 * feed (`telemetry` adds the car data the HUD shows).
 */
export function DriverHudSource({ query, telemetry = true }: { query: DockSessionQuery; telemetry?: boolean }) {
  return query.live ? <LiveSource query={query} /> : <ReplayResolver query={query} telemetry={telemetry} />;
}
