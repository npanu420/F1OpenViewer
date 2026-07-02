import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, Wind, Thermometer, Droplets, Gauge, CloudRain, Radio, Link2, Unlink } from 'lucide-react';
import { useReplayTiming } from '../hooks/useReplayTiming';
import type { DriverRow, SectorView, TeamRadioClip } from '../../domain/timing';

interface ResolveQuery {
  year: number | null;
  meetingName?: string;
  meetingNumber?: number;
  sessionName?: string;
  sessionType?: string;
  sessionKey?: string;
}

function hashParams(): { path: string; title: string; syncStart: number | null; query: ResolveQuery | null } {
  const raw = window.location.hash.replace(/^#/, '');
  const q = raw.includes('?') ? raw.split('?')[1] : '';
  const p = new URLSearchParams(q);
  const num = (v: string | null) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  const path = p.get('path') || '';
  // A direct path skips resolution, otherwise the window resolves the query itself. That's what
  // keeps the open instant, since the main window no longer waits on the archive and sync lookups
  // before creating this one.
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
  return { path, title: p.get('title') || '', syncStart: num(p.get('syncStart')), query };
}

function fmtOffsetSigned(ms: number): string {
  const sign = ms < 0 ? '−' : '+';
  const s = Math.round(Math.abs(ms) / 1000);
  return `${sign}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Sync badge. Auto-sync is exact now (no manual work needed) so the fine-tune controls are
 * tucked behind a click instead of always taking up transport-bar space.
 */
function SyncControls({
  auto,
  lap,
  syncOffsetMs,
  onNudge,
  onUnsync,
  onCalibrate,
}: {
  auto: boolean;
  lap: { current: number; total: number } | null;
  syncOffsetMs: number;
  onNudge: (deltaMs: number) => void;
  onUnsync: () => void;
  onCalibrate: (lap: number) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState('');
  const [bad, setBad] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const btn = 'text-[10px] px-1.5 py-0.5 rounded border border-border hover:bg-accent tabular-nums';
  const apply = () => {
    const n = parseInt(val, 10);
    if (Number.isFinite(n)) setBad(!onCalibrate(n));
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="relative shrink-0" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 px-2 py-1 rounded border border-emerald-400/30 hover:bg-emerald-400/10"
        title={auto ? 'Locked to the broadcast wall clock, exact. Click for fine-tune / unsync.' : 'Synced to video time. Click to align / adjust.'}
      >
        <Link2 className="w-3.5 h-3.5" /> {auto ? 'AUTO-SYNCED' : 'SYNCED'}
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-64 rounded-md border border-border bg-card shadow-xl p-2.5 flex flex-col gap-2 z-20">
          {!auto && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Video lap</span>
              <input
                value={val}
                onChange={(e) => { setVal(e.target.value.replace(/\D/g, '')); setBad(false); }}
                onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
                placeholder={lap ? String(lap.current) : '—'}
                className={`w-12 bg-secondary text-foreground text-xs rounded px-1 py-0.5 border ${bad ? 'border-destructive' : 'border-border'} text-center`}
              />
              <button type="button" onClick={apply} className="text-[10px] px-1.5 py-0.5 rounded bg-primary text-primary-foreground hover:opacity-90">Align</button>
            </div>
          )}
          <div className="flex items-center justify-between gap-0.5">
            <button type="button" className={btn} onClick={() => onNudge(-60000)} title="Timing 1 min earlier">−1m</button>
            <button type="button" className={btn} onClick={() => onNudge(-10000)}>−10s</button>
            <button type="button" className={btn} onClick={() => onNudge(-1000)}>−1s</button>
            <span className="w-12 text-center text-[10px] tabular-nums text-muted-foreground" title="Sync offset (video → timing)">{fmtOffsetSigned(syncOffsetMs)}</span>
            <button type="button" className={btn} onClick={() => onNudge(1000)}>+1s</button>
            <button type="button" className={btn} onClick={() => onNudge(10000)}>+10s</button>
            <button type="button" className={btn} onClick={() => onNudge(60000)} title="Timing 1 min later">+1m</button>
          </div>
          <button type="button" onClick={onUnsync} className="text-[11px] px-2 py-1 rounded border border-border hover:bg-accent flex items-center justify-center gap-1" title="Detach from video">
            <Unlink className="w-3.5 h-3.5" /> Unsync
          </button>
        </div>
      )}
    </div>
  );
}

function fmtClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p2 = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p2(m)}:${p2(sec)}` : `${p2(m)}:${p2(sec)}`;
}

const TYRE_COLOR: Record<string, string> = {
  SOFT: '#ff3b3b',
  MEDIUM: '#ffd83b',
  HARD: '#ffffff',
  INTERMEDIATE: '#43d675',
  WET: '#3b8cff',
};

const TYRE_LETTER: Record<string, string> = {
  SOFT: 'S',
  MEDIUM: 'M',
  HARD: 'H',
  INTERMEDIATE: 'I',
  WET: 'W',
};

/** F1 mini-sector segment status → color. 0 not driven, 2049 green, 2051 purple, 2064 pit. */
function segColor(status: number): string {
  switch (status) {
    case 2051: return '#b14bff'; // overall fastest (purple)
    case 2049: return '#43d675'; // green
    case 2048: return '#ffd83b'; // yellow
    case 2064: return '#3b8cff'; // pit (blue)
    default: return 'hsl(var(--muted-foreground) / 0.25)';
  }
}

function Sector({ s }: { s: SectorView }) {
  const color = s.overallFastest ? '#b14bff' : s.personalFastest ? '#43d675' : 'hsl(var(--muted-foreground))';
  return (
    <div className="flex flex-col gap-0.5 px-1">
      {s.segments.length > 0 && (
        <div className="flex gap-0.5">
          {s.segments.map((st, i) => (
            <span key={i} className="h-1 w-2 rounded-[1px]" style={{ backgroundColor: segColor(st) }} />
          ))}
        </div>
      )}
      <span className="tabular-nums text-[11px] leading-none" style={{ color }}>{s.value || '—'}</span>
    </div>
  );
}

/** Stint history as a hover tooltip. Native title attribute, simplest way to surface pit-stop history. */
function stintTooltip(row: DriverRow): string {
  if (!row.stints.length) return '';
  const stops = Math.max(0, row.stints.length - 1);
  const lines = row.stints.map((s, i) => `${i + 1}. ${s.compound || '?'}${s.laps != null ? ` — ${s.laps} laps` : ''}${s.isNew ? ' (new)' : ''}`);
  return `${stops} pit stop${stops === 1 ? '' : 's'}\n${lines.join('\n')}`;
}

function DriverRowItem({ row, index }: { row: DriverRow; index: number }) {
  const tyre = TYRE_COLOR[row.tyre] || '#888';
  const pitStops = Math.max(0, row.stints.length - 1);
  return (
    <div
      className={`flex items-center h-9 border-b border-border/40 text-sm hover:bg-white/[0.05] transition-colors ${
        index % 2 === 1 ? 'bg-white/[0.015]' : ''
      } ${row.retired ? 'opacity-50' : ''}`}
    >
      <div className="w-7 text-center font-bold tabular-nums">{row.position}</div>
      <div className="w-1 h-6 rounded-sm mr-2" style={{ backgroundColor: row.teamColour }} />
      <div className="w-24 font-heading font-bold tracking-wider flex items-center gap-1.5">
        {row.tla}
        {row.drs && <span className="text-[8px] font-bold text-emerald-400" title="DRS active">DRS</span>}
        {row.retired ? (
          <span className="text-[9px] font-bold text-destructive">OUT</span>
        ) : row.inPit ? (
          <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-destructive/80 text-white leading-none">PIT</span>
        ) : row.pitOut ? (
          <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-500/80 text-black leading-none">OUT</span>
        ) : null}
      </div>
      <div className="w-16 tabular-nums text-muted-foreground">{row.gapToLeader || '—'}</div>
      <div className="w-16 tabular-nums text-muted-foreground">{row.interval || '—'}</div>
      <div className="w-20 tabular-nums">{row.lastLap || '—'}</div>
      <div className="w-20 tabular-nums text-muted-foreground">{row.bestLap || '—'}</div>
      <div className="w-16 flex items-center gap-1.5 cursor-default" title={stintTooltip(row)}>
        {row.tyre ? (
          <>
            <span
              className="inline-flex items-center justify-center w-4 h-4 rounded-full border text-[9px] font-bold leading-none"
              style={{ borderColor: tyre, color: tyre }}
            >
              {TYRE_LETTER[row.tyre] ?? row.tyre[0]}
            </span>
            <span className="text-[11px] text-muted-foreground tabular-nums">{row.stintLaps ?? ''}</span>
            {pitStops > 0 && <span className="text-[9px] text-muted-foreground/70 tabular-nums">×{pitStops}</span>}
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
      <div className="flex-1 flex items-center">
        {row.sectors.map((s, i) => <Sector key={i} s={s} />)}
      </div>
      <div className="w-16 text-right pr-3">
        {row.speedKmh ? <span className="text-[11px] tabular-nums text-muted-foreground">{row.speedKmh} km/h</span> : null}
      </div>
    </div>
  );
}

const FLAG_COLOR: Record<string, string> = {
  BLUE: '#3b8cff',
  YELLOW: '#ffd83b',
  DOUBLE_YELLOW: '#ffd83b',
  'DOUBLE YELLOW': '#ffd83b',
  GREEN: '#43d675',
  CLEAR: '#43d675',
  RED: '#ff3b3b',
  CHEQUERED: '#ffffff',
  BLACK: '#ffffff',
  'BLACK AND WHITE': '#ffffff',
};

function flagColor(flag: string): string {
  return FLAG_COLOR[flag.toUpperCase()] || 'hsl(var(--primary))';
}

function fmtUtc(utc: string): string {
  // 'Utc' is an ISO-ish timestamp; show HH:MM:SS, fall back to raw.
  const m = utc.match(/T?(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : utc;
}

function fmtSec(s: number): string {
  if (!Number.isFinite(s)) return '0:00';
  const total = Math.max(0, Math.floor(s));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Custom slim player, not the browser's default audio pill. Audio bytes are fetched on first play
 * through the same curl-proxied IPC path as everything else, since the renderer's own network
 * stack can't reach the livetiming CDN directly (VPN split-tunnel). A plain <audio src="https://…">
 * would just sit there and never load.
 */
function RadioClip({ clip, tla, sessionPath }: { clip: TeamRadioClip; tla: string; sessionPath: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [err, setErr] = useState(false);

  const toggle = async () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) { el.pause(); return; }
    if (!loaded) {
      setLoading(true);
      setErr(false);
      try {
        const b64 = await window.f1!.liveTiming!.getAudio!(sessionPath, clip.path);
        el.src = `data:audio/mpeg;base64,${b64}`;
        setLoaded(true);
        await el.play();
      } catch (_) {
        setErr(true);
      } finally {
        setLoading(false);
      }
      return;
    }
    el.play().catch(() => setErr(true));
  };

  return (
    <div className="px-3 py-2 border-b border-border/40">
      <div className="flex items-center gap-2 mb-1.5">
        <Radio className="w-3 h-3 text-primary" />
        <span className="font-heading font-bold tracking-wider text-xs">{tla || `#${clip.number}`}</span>
        <span className="text-[10px] text-muted-foreground tabular-nums ml-auto">{fmtUtc(clip.utc)}</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          disabled={loading}
          className="w-6 h-6 shrink-0 flex items-center justify-center rounded-full bg-secondary hover:bg-accent disabled:opacity-50"
          title={err ? 'Failed to load, click to retry' : playing ? 'Pause' : 'Play'}
        >
          {loading ? (
            <div className="w-3 h-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          ) : playing ? (
            <Pause className="w-3 h-3" />
          ) : (
            <Play className="w-3 h-3 ml-0.5" />
          )}
        </button>
        <input
          type="range"
          min={0}
          max={dur || 1}
          value={cur}
          disabled={!loaded}
          onChange={(e) => { if (audioRef.current) audioRef.current.currentTime = Number(e.target.value); }}
          className="flex-1 accent-primary h-1 disabled:opacity-40"
        />
        <span className="text-[10px] tabular-nums text-muted-foreground w-16 text-right shrink-0">
          {err ? 'error' : `${fmtSec(cur)} / ${fmtSec(dur)}`}
        </span>
      </div>
      <audio
        ref={audioRef}
        preload="none"
        className="hidden"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
        onError={() => { setErr(true); setLoading(false); }}
      />
    </div>
  );
}

function WeatherStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export function LiveTimingView() {
  const initial = useMemo(hashParams, []);
  const [resolved, setResolved] = useState<{ path: string; title: string; syncStart: number | null } | null>(
    initial.path ? { path: initial.path, title: initial.title, syncStart: initial.syncStart } : null,
  );
  const [resolveErr, setResolveErr] = useState<string | null>(null);

  // No direct path means we resolve the archive path and sync anchor here in this window, so the
  // click that opened it could return instantly. Runs once on mount.
  useEffect(() => {
    if (resolved || !initial.query) return;
    let cancel = false;
    (async () => {
      try {
        const lt = window.f1?.liveTiming;
        if (!lt?.resolveSession) throw new Error('Live timing unavailable.');
        const found = await lt.resolveSession(initial.query!.year as number, initial.query!);
        if (!found) throw new Error('Live timing session not found in archive.');
        const sd = lt.getSyncData ? await lt.getSyncData(found.meeting?.Key as any, found.session?.Key as any).catch(() => null) : null;
        if (cancel) return;
        setResolved({
          path: found.path,
          title: initial.title || found.session?.Name || '',
          syncStart: sd?.sessionStartSec ?? null,
        });
      } catch (e: any) {
        if (!cancel) setResolveErr(e?.message || 'Live timing unavailable.');
      }
    })();
    return () => { cancel = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const t = useReplayTiming(resolved?.path || null, resolved?.syncStart ?? null);
  const path = resolved?.path || '';
  const title = resolved?.title || initial.title;

  if (resolveErr) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-destructive">{resolveErr}</div>;
  }
  if (!resolved || t.loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto mb-2" />
          <p className="text-muted-foreground font-heading tracking-wider">Loading live timing…</p>
        </div>
      </div>
    );
  }
  if (t.error) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-destructive">{t.error}</div>;
  }

  const w = t.weather;
  const tlaByNum: Record<string, string> = {};
  for (const d of t.drivers) tlaByNum[d.number] = d.tla;
  return (
    <div className="h-screen overflow-hidden bg-background text-foreground flex flex-col">
      {/* Header: title, status, weather */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-border bg-card/60 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="font-heading font-bold tracking-wider">{title || 'Live Timing'}</span>
          {t.lapCount && (
            <span className="tabular-nums text-xs font-bold px-2 py-0.5 rounded bg-secondary">
              LAP {t.lapCount.current}/{t.lapCount.total}
            </span>
          )}
          {t.clock && <span className="tabular-nums text-primary font-bold">{t.clock.remaining}</span>}
        </div>
        {t.trackStatus && (
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded ${
              t.trackStatus.status === '1' ? 'bg-emerald-600/80 text-white' : 'bg-amber-500/80 text-black'
            }`}
          >
            {t.trackStatus.label}
          </span>
        )}
        {w && (
          <div className="flex items-center gap-4 ml-auto">
            <WeatherStat icon={<Wind className="w-3.5 h-3.5" />} label="Wind" value={`${w.windSpeed} m/s`} />
            <WeatherStat icon={<Thermometer className="w-3.5 h-3.5" />} label="Track" value={`${w.trackTemp}°`} />
            <WeatherStat icon={<Thermometer className="w-3.5 h-3.5" />} label="Air" value={`${w.airTemp}°`} />
            <WeatherStat icon={<Droplets className="w-3.5 h-3.5" />} label="Hum" value={`${w.humidity}%`} />
            <WeatherStat icon={<Gauge className="w-3.5 h-3.5" />} label="Press" value={`${w.pressure}`} />
            <WeatherStat icon={<CloudRain className="w-3.5 h-3.5" />} label="Rain" value={w.rainfall ? 'Yes' : 'No'} />
          </div>
        )}
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Timing table */}
        <div className="flex-1 overflow-y-auto thin-scrollbar">
          <div className="flex items-center h-7 px-0 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border sticky top-0 bg-background">
            <div className="w-7 text-center">P</div>
            <div className="w-3 mr-2" />
            <div className="w-24">Drv</div>
            <div className="w-16">Gap</div>
            <div className="w-16">Int</div>
            <div className="w-20">Last</div>
            <div className="w-20">Best</div>
            <div className="w-16">Tyre</div>
            <div className="flex-1">Sectors</div>
            <div className="w-16 text-right pr-3">Spd</div>
          </div>
          {t.drivers.map((row, i) => <DriverRowItem key={row.number} row={row} index={i} />)}
          {!t.drivers.length && (
            <div className="p-8 text-center text-muted-foreground">No driver data at this point.</div>
          )}
        </div>

        {/* Race control + team radio feed, each panel scrolls on its own and never grows past its share. */}
        <div className="w-80 border-l border-border bg-card/30 flex flex-col min-h-0">
          <div className="flex-1 min-h-0 flex flex-col basis-0">
            <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-card/60 shrink-0">
              Race Control
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto thin-scrollbar">
              {t.raceControl.map((m, i) => (
                <div key={i} className="px-3 py-2 border-b border-border/40 text-xs">
                  {m.flag && <span className="font-bold mr-1" style={{ color: flagColor(m.flag) }}>{m.flag}</span>}
                  <span className="text-foreground">{m.message}</span>
                  {m.lap != null && <span className="text-muted-foreground ml-1">(L{m.lap})</span>}
                </div>
              ))}
              {!t.raceControl.length && <div className="p-3 text-xs text-muted-foreground">No messages yet.</div>}
            </div>
          </div>

          <div className="flex-1 min-h-0 flex flex-col basis-0 border-t border-border">
            <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-card/60 shrink-0">
              Team Radio
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto thin-scrollbar">
              {t.teamRadio.map((clip, i) => (
                <RadioClip key={i} clip={clip} tla={tlaByNum[clip.number] || ''} sessionPath={path} />
              ))}
              {!t.teamRadio.length && <div className="p-3 text-xs text-muted-foreground">No clips yet.</div>}
            </div>
          </div>
        </div>
      </div>

      {/* Transport bar, always visible. Either self-driven or synced to the video master clock. */}
      <div className="flex items-center gap-3 px-4 py-2 border-t border-border bg-card/60">
        <button
          type="button"
          onClick={t.playing ? t.pause : t.play}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90 shrink-0"
          title={t.synced ? 'Detach from video and play manually' : t.playing ? 'Pause' : 'Play'}
        >
          {t.playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <span className="text-xs tabular-nums text-muted-foreground w-16 shrink-0">{fmtClock(t.offsetMs)}</span>
        <input
          type="range"
          min={0}
          max={t.durationMs || 1}
          value={t.offsetMs}
          onChange={(e) => t.seek(Number(e.target.value))}
          className="flex-1 accent-primary"
        />
        <span className="text-xs tabular-nums text-muted-foreground w-16 shrink-0">{fmtClock(t.durationMs)}</span>

        {t.synced ? (
          <SyncControls
            auto={t.autoSynced}
            lap={t.lapCount}
            syncOffsetMs={t.syncOffsetMs}
            onNudge={t.nudgeSync}
            onUnsync={t.unsync}
            onCalibrate={t.calibrateToLap}
          />
        ) : (
          <select
            value={t.speed}
            onChange={(e) => t.setSpeed(Number(e.target.value))}
            className="bg-secondary text-foreground text-xs rounded px-2 py-1 border border-border shrink-0"
            title="Playback speed (manual mode). Sync starts automatically when a video stream plays."
          >
            {[1, 2, 5, 10, 30, 60].map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        )}
      </div>
    </div>
  );
}
