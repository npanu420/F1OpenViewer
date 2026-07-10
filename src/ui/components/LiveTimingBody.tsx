import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, Wind, Thermometer, Droplets, Gauge, CloudRain, Radio, Link2, Unlink } from 'lucide-react';
import { useReplayTiming } from '../hooks/useReplayTiming';
import { useLiveTiming, type LiveTimingQuery } from '../hooks/useLiveTiming';
import type {
  DriverRow,
  SectorView,
  TeamRadioClip,
  WeatherView,
  RaceControlMessage,
} from '../../domain/timing';

/** Replay session query; same shape as liveTiming.openWindow. */
export interface ResolveQuery {
  year: number | null;
  meetingName?: string;
  meetingNumber?: number;
  sessionName?: string;
  sessionType?: string;
  sessionKey?: string;
}

function fmtOffsetSigned(ms: number): string {
  const sign = ms < 0 ? '−' : '+';
  const s = Math.round(Math.abs(ms) / 1000);
  return `${sign}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Auto-sync is good enough now; manual nudge lives behind a click. */
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

/** Mini-sector color. 0 none, 2049 green, 2051 purple, 2064 pit. */
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

/** Stint list in a native title tooltip. */
function stintTooltip(row: DriverRow): string {
  if (!row.stints.length) return '';
  const stops = Math.max(0, row.stints.length - 1);
  const lines = row.stints.map((s, i) => `${i + 1}. ${s.compound || '?'}${s.laps != null ? ` — ${s.laps} laps` : ''}${s.isNew ? ' (new)' : ''}`);
  return `${stops} pit stop${stops === 1 ? '' : 's'}\n${lines.join('\n')}`;
}

/** Numeric timing cells: fixed width, no bleed into the next column. */
function TimingCell({
  value,
  width,
  muted,
}: {
  value: string;
  width: string;
  muted?: boolean;
}) {
  return (
    <div
      className={`${width} shrink-0 overflow-hidden text-ellipsis whitespace-nowrap tabular-nums text-[11px] leading-none ${
        muted ? 'text-muted-foreground' : ''
      }`}
      title={value || undefined}
    >
      {value || '—'}
    </div>
  );
}

function DriverRowItem({
  row,
  index,
  compact,
  docked,
  dockWide,
}: {
  row: DriverRow;
  index: number;
  compact?: boolean;
  docked?: boolean;
  dockWide?: boolean;
}) {
  const tyre = TYRE_COLOR[row.tyre] || '#888';
  const pitStops = Math.max(0, row.stints.length - 1);
  const showInterval = dockWide || (!compact && !docked);
  const showLastLap = dockWide || (!compact && !docked);
  const showBestLap = !compact && !docked;
  const showSectors = !compact && !docked;
  const showSpeed = !compact && !docked;
  return (
    <div
      className={`flex items-center h-9 border-b border-border/40 text-sm hover:bg-white/[0.05] transition-colors ${
        index % 2 === 1 ? 'bg-white/[0.015]' : ''
      } ${row.retired ? 'opacity-50' : ''}`}
    >
      <div className="w-7 shrink-0 text-center font-bold tabular-nums">{row.position}</div>
      <div className="w-1 h-6 shrink-0 rounded-sm mr-2" style={{ backgroundColor: row.teamColour }} />
      <div className={`${compact ? 'w-14' : 'w-24'} shrink-0 font-heading font-bold tracking-wider flex items-center gap-1 min-w-0 overflow-hidden`}>
        <span className="truncate">{row.tla}</span>
        {row.drs && <span className="text-[8px] font-bold text-emerald-400 shrink-0" title="DRS active">DRS</span>}
        {row.retired ? (
          <span className="text-[9px] font-bold text-destructive shrink-0">OUT</span>
        ) : row.inPit ? (
          <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-destructive/80 text-white leading-none shrink-0">PIT</span>
        ) : row.pitOut ? (
          <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-500/80 text-black leading-none shrink-0">OUT</span>
        ) : null}
      </div>
      <TimingCell value={row.gapToLeader} width="w-[3.25rem]" muted />
      {showInterval && <TimingCell value={row.interval} width="w-[3.75rem]" muted />}
      {showLastLap && <TimingCell value={row.lastLap} width="w-[4.25rem]" />}
      {showBestLap && <TimingCell value={row.bestLap} width="w-[4.25rem]" muted />}
      <div className="w-[2.75rem] shrink-0 flex items-center justify-start gap-1 cursor-default" title={stintTooltip(row)}>
        {row.tyre ? (
          <>
            <span
              className="inline-flex items-center justify-center w-4 h-4 rounded-full border text-[9px] font-bold leading-none"
              style={{ borderColor: tyre, color: tyre }}
            >
              {TYRE_LETTER[row.tyre] ?? row.tyre[0]}
            </span>
            {showBestLap && <span className="text-[11px] text-muted-foreground tabular-nums">{row.stintLaps ?? ''}</span>}
            {showBestLap && pitStops > 0 && <span className="text-[9px] text-muted-foreground/70 tabular-nums">×{pitStops}</span>}
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
      {showSectors && (
        <div className="flex-1 flex items-center min-w-0">
          {row.sectors.map((s, i) => <Sector key={i} s={s} />)}
        </div>
      )}
      {showSpeed && (
        <div className="w-16 shrink-0 text-right pr-3">
          {row.speedKmh ? <span className="text-[11px] tabular-nums text-muted-foreground">{row.speedKmh} km/h</span> : null}
        </div>
      )}
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
 * Team radio player. Audio goes through IPC (curl proxy); renderer can't hit the livetiming CDN
 * directly with <audio src>.
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

interface TimingBodyProps {
  title: string;
  drivers: DriverRow[];
  weather: WeatherView | null;
  trackStatus: { status: string; label: string } | null;
  raceControl: RaceControlMessage[];
  clock: { remaining: string; extrapolating: boolean } | null;
  lapCount: { current: number; total: number } | null;
  teamRadio: TeamRadioClip[];
  sessionPath: string;
  headerBadge?: React.ReactNode;
  footer: React.ReactNode;
  /** Dock: narrower rows, no race-control side panel. */
  compact?: boolean;
  /** In-window dock (not popout). */
  docked?: boolean;
  /** Wide dock: interval + last lap, still no sectors sidebar. */
  dockWide?: boolean;
}

/**
 * Shared replay/live body: header, timing table, race control/radio.
 * Mode-specific footer (scrub bar or LIVE pill) comes from the parent.
 */
function TimingBody({
  title,
  drivers,
  weather: w,
  trackStatus,
  raceControl,
  clock,
  lapCount,
  teamRadio,
  sessionPath,
  headerBadge,
  footer,
  compact,
  docked,
  dockWide,
}: TimingBodyProps) {
  const tlaByNum: Record<string, string> = {};
  for (const d of drivers) tlaByNum[d.number] = d.tla;

  return (
    <div className={`${compact ? 'h-full' : 'h-screen'} overflow-hidden bg-background text-foreground flex flex-col`}>
      {/* Header: title, status, weather */}
      <div className={`flex items-center gap-4 border-b border-border bg-card/60 flex-wrap ${compact ? 'px-2 py-1.5' : 'px-4 py-2'}`}>
        <div className="flex items-center gap-2 min-w-0">
          {headerBadge}
          <span className="font-heading font-bold tracking-wider truncate">{title || 'Live Timing'}</span>
          {lapCount && (
            <span className="tabular-nums text-xs font-bold px-2 py-0.5 rounded bg-secondary shrink-0">
              LAP {lapCount.current}/{lapCount.total}
            </span>
          )}
          {clock && <span className="tabular-nums text-primary font-bold shrink-0">{clock.remaining}</span>}
        </div>
        {trackStatus && (
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded shrink-0 ${
              trackStatus.status === '1' ? 'bg-emerald-600/80 text-white' : 'bg-amber-500/80 text-black'
            }`}
          >
            {trackStatus.label}
          </span>
        )}
        {w && !compact && (
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
        <div className={`flex-1 overflow-y-auto thin-scrollbar min-w-0 ${docked ? 'overflow-x-auto' : ''}`}>
          {(dockWide || (!compact && !docked)) && (
            <div className="flex items-center h-7 px-0 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border sticky top-0 bg-background min-w-max">
              <div className="w-7 shrink-0 text-center">P</div>
              <div className="w-3 mr-2 shrink-0" />
              <div className={`${compact ? 'w-14' : 'w-24'} shrink-0`}>Drv</div>
              <div className="w-[3.25rem] shrink-0">Gap</div>
              {(dockWide || !docked) && <div className="w-[3.75rem] shrink-0">Int</div>}
              {(dockWide || !docked) && <div className="w-[4.25rem] shrink-0">Last</div>}
              {!docked && <div className="w-[4.25rem] shrink-0">Best</div>}
              <div className="w-[2.75rem] shrink-0">Tyre</div>
              {!docked && <div className="flex-1">Sectors</div>}
              {!docked && <div className="w-16 text-right pr-3 shrink-0">Spd</div>}
            </div>
          )}
          {drivers.map((row, i) => (
            <DriverRowItem
              key={row.number}
              row={row}
              index={i}
              compact={compact}
              docked={docked}
              dockWide={dockWide}
            />
          ))}
          {!drivers.length && (
            <div className="p-8 text-center text-muted-foreground">No driver data at this point.</div>
          )}
        </div>

        {/* Race control + team radio feed, each panel scrolls on its own and never grows past its share.
            Dropped in compact mode: the dock is a glance surface, full detail stays in the popout. */}
        {!compact && !docked && (
          <div className="w-80 border-l border-border bg-card/30 flex flex-col min-h-0">
            <div className="flex-1 min-h-0 flex flex-col basis-0">
              <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-card/60 shrink-0">
                Race Control
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto thin-scrollbar">
                {raceControl.map((m, i) => (
                  <div key={i} className="px-3 py-2 border-b border-border/40 text-xs">
                    {m.flag && <span className="font-bold mr-1" style={{ color: flagColor(m.flag) }}>{m.flag}</span>}
                    <span className="text-foreground">{m.message}</span>
                    {m.lap != null && <span className="text-muted-foreground ml-1">(L{m.lap})</span>}
                  </div>
                ))}
                {!raceControl.length && <div className="p-3 text-xs text-muted-foreground">No messages yet.</div>}
              </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col basis-0 border-t border-border">
              <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-card/60 shrink-0">
                Team Radio
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto thin-scrollbar">
                {teamRadio.map((clip, i) => (
                  <RadioClip key={i} clip={clip} tla={tlaByNum[clip.number] || ''} sessionPath={sessionPath} />
                ))}
                {!teamRadio.length && <div className="p-3 text-xs text-muted-foreground">No clips yet.</div>}
              </div>
            </div>
          </div>
        )}
      </div>

      {footer}
    </div>
  );
}

function LoadingScreen({ label, compact }: { label: string; compact?: boolean }) {
  return (
    <div className={`${compact ? 'h-full' : 'min-h-screen'} bg-background flex items-center justify-center`}>
      <div className="text-center">
        <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto mb-2" />
        <p className="text-muted-foreground font-heading tracking-wider">{label}</p>
      </div>
    </div>
  );
}

function ErrorScreen({ message, compact }: { message: string; compact?: boolean }) {
  return (
    <div className={`${compact ? 'h-full' : 'min-h-screen'} bg-background flex items-center justify-center text-destructive text-center px-3`}>
      {message}
    </div>
  );
}

/** Replay: archive clock + scrub bar. */
export function ReplayTimingPanel({
  path,
  title,
  syncStart,
  compact,
  docked,
  dockWide,
}: {
  path: string;
  title: string;
  syncStart: number | null;
  compact?: boolean;
  docked?: boolean;
  dockWide?: boolean;
}) {
  const t = useReplayTiming(path, syncStart);
  if (t.loading) return <LoadingScreen label="Loading live timing…" compact={compact} />;
  if (t.error) return <ErrorScreen message={t.error} compact={compact} />;

  const footer = (
    <div className={`flex items-center gap-3 border-t border-border bg-card/60 ${compact ? 'px-2 py-1.5' : 'px-4 py-2'}`}>
      <button
        type="button"
        onClick={t.playing ? t.pause : t.play}
        className="w-8 h-8 flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90 shrink-0"
        title={t.synced ? 'Detach from video and play manually' : t.playing ? 'Pause' : 'Play'}
      >
        {t.playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>
      {!compact && <span className="text-xs tabular-nums text-muted-foreground w-16 shrink-0">{fmtClock(t.offsetMs)}</span>}
      {!compact && (
        <input
          type="range"
          min={0}
          max={t.durationMs || 1}
          value={t.offsetMs}
          onChange={(e) => t.seek(Number(e.target.value))}
          className="flex-1 accent-primary"
        />
      )}
      {!compact && <span className="text-xs tabular-nums text-muted-foreground w-16 shrink-0">{fmtClock(t.durationMs)}</span>}
      {t.synced ? (
        !compact && (
          <SyncControls
            auto={t.autoSynced}
            lap={t.lapCount}
            syncOffsetMs={t.syncOffsetMs}
            onNudge={t.nudgeSync}
            onUnsync={t.unsync}
            onCalibrate={t.calibrateToLap}
          />
        )
      ) : !compact ? (
        <select
          value={t.speed}
          onChange={(e) => t.setSpeed(Number(e.target.value))}
          className="bg-secondary text-foreground text-xs rounded px-2 py-1 border border-border shrink-0"
          title="Playback speed (manual mode). Sync starts automatically when a video stream plays."
        >
          {[1, 2, 5, 10, 30, 60].map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
      ) : null}
    </div>
  );

  return (
    <TimingBody
      title={title}
      drivers={t.drivers}
      weather={t.weather}
      trackStatus={t.trackStatus}
      raceControl={t.raceControl}
      clock={t.clock}
      lapCount={t.lapCount}
      teamRadio={t.teamRadio}
      sessionPath={path}
      footer={footer}
      compact={compact}
      docked={docked}
      dockWide={dockWide}
    />
  );
}

/** Resolve archive path + sync anchor, then render replay timing. */
export function ReplayResolvingPanel({
  path,
  title,
  syncStart,
  query,
  compact,
  docked,
  dockWide,
}: {
  path?: string;
  title: string;
  syncStart?: number | null;
  query?: ResolveQuery | null;
  compact?: boolean;
  docked?: boolean;
  dockWide?: boolean;
}) {
  const [resolved, setResolved] = useState<{
    path: string;
    title: string;
    syncStart: number | null;
  } | null>(
    path ? { path, title, syncStart: syncStart ?? null } : null,
  );
  const [resolveErr, setResolveErr] = useState<string | null>(null);

  useEffect(() => {
    if (resolved || !query) return;
    let cancel = false;
    (async () => {
      try {
        const lt = window.f1?.liveTiming;
        if (!lt?.resolveSession) throw new Error('Live timing unavailable.');
        const found = await lt.resolveSession(query.year as number, query);
        if (!found) throw new Error('Live timing session not found in archive.');
        const sd = lt.getSyncData ? await lt.getSyncData(found.meeting?.Key as any, found.session?.Key as any).catch(() => null) : null;
        if (cancel) return;
        setResolved({
          path: found.path,
          title: title || found.session?.Name || '',
          syncStart: sd?.sessionStartSec ?? null,
        });
      } catch (e: any) {
        if (!cancel) setResolveErr(e?.message || 'Live timing unavailable.');
      }
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (resolveErr) return <ErrorScreen message={resolveErr} compact={compact} />;
  if (!resolved) return <LoadingScreen label="Loading live timing…" compact={compact} />;
  return <ReplayTimingPanel path={resolved.path} title={resolved.title} syncStart={resolved.syncStart} compact={compact} docked={docked} dockWide={dockWide} />;
}

export function LivePill({ connected }: { connected: boolean }) {
  return (
    <span className={`flex items-center gap-1.5 text-xs font-heading font-bold tracking-widest ${connected ? 'text-red-500' : 'text-muted-foreground'}`}>
      <span className="relative flex h-2.5 w-2.5">
        {connected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />}
        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${connected ? 'bg-red-500' : 'bg-muted-foreground'}`} />
      </span>
      {connected ? 'LIVE' : 'CONNECTING…'}
    </span>
  );
}

/** Live: SignalR feed, no scrub bar. */
export function LiveTimingPanel({
  query,
  title,
  compact,
  docked,
  dockWide,
}: {
  query: LiveTimingQuery;
  title: string;
  compact?: boolean;
  docked?: boolean;
  dockWide?: boolean;
}) {
  const t = useLiveTiming(query);
  if (t.loading) return <LoadingScreen label="Connecting to live timing…" compact={compact} />;
  if (t.error) return <ErrorScreen message={t.error} compact={compact} />;

  const footer = (
    <div className={`flex items-center gap-3 border-t border-border bg-card/60 ${compact ? 'px-2 py-1.5' : 'px-4 py-2'}`}>
      <LivePill connected={t.connected} />
    </div>
  );

  return (
    <TimingBody
      title={title}
      drivers={t.drivers}
      weather={t.weather}
      trackStatus={t.trackStatus}
      raceControl={t.raceControl}
      clock={t.clock}
      lapCount={t.lapCount}
      teamRadio={t.teamRadio}
      sessionPath={t.sessionPath || ''}
      headerBadge={<LivePill connected={t.connected} />}
      footer={footer}
      compact={compact}
      docked={docked}
      dockWide={dockWide}
    />
  );
}
