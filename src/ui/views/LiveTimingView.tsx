import { useMemo } from 'react';
import type { LiveTimingQuery } from '../hooks/useLiveTiming';
import { ReplayResolvingPanel, LiveTimingPanel, type ResolveQuery } from '../components/LiveTimingBody';

function hashParams(): {
  path: string;
  title: string;
  syncStart: number | null;
  live: boolean;
  query: ResolveQuery | null;
} {
  const raw = window.location.hash.replace(/^#/, '');
  const q = raw.includes('?') ? raw.split('?')[1] : '';
  const p = new URLSearchParams(q);
  const num = (v: string | null) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  const path = p.get('path') || '';
  // Pass path straight through when we have it; otherwise the window resolves the query itself.
  // Main window no longer blocks on archive/sync before opening.
  const query: ResolveQuery | null = path
    ? null
    : {
        year: num(p.get('year')),
        meetingName: p.get('meetingName') || undefined,
        meetingNumber: num(p.get('meetingNumber')) ?? undefined,
        sessionName: p.get('sessionName') || undefined,
        sessionType: p.get('sessionType') || undefined,
        sessionKey: p.get('sessionKey') || undefined,
      };
  return {
    path,
    title: p.get('title') || '',
    syncStart: num(p.get('syncStart')),
    live: p.get('live') === '1',
    query,
  };
}

export function LiveTimingView() {
  const initial = useMemo(hashParams, []);
  if (initial.live) {
    const query: LiveTimingQuery = {
      year: initial.query?.year ?? undefined,
      sessionKey: initial.query?.sessionKey,
      meetingName: initial.query?.meetingName,
      sessionName: initial.query?.sessionName,
    };
    return <LiveTimingPanel query={query} title={initial.title} />;
  }
  return (
    <ReplayResolvingPanel
      path={initial.path}
      title={initial.title}
      syncStart={initial.syncStart}
      query={initial.query}
    />
  );
}
