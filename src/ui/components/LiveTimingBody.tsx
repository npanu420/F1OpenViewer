import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, Wind, Thermometer, Droplets, Gauge, CloudRain, Radio, Link2, Unlink } from 'lucide-react';
import { useReplayTiming } from '../hooks/useReplayTiming';
import { useLiveTiming, type LiveTimingQuery } from '../hooks/useLiveTiming';
import { useLocale } from '../../i18n/LocaleContext';
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
  const { t } = useLocale();
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
        title={auto ? t('timing.syncAutoHint') : t('timing.syncManualHint')}
      >
        <Link2 className="w-3.5 h-3.5" /> {auto ? t('timing.autoSynced') : t('timing.synced')}
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-64 rounded-md border border-border bg-card shadow-xl p-2.5 flex flex-col gap-2 z-20">
          {!auto && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('timing.videoLap')}</span>
              <input
                value={val}
                onChange={(e) => { setVal(e.target.value.replace(/\D/g, '')); setBad(false); }}
                onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
                placeholder={lap ? String(lap.current) : '—'}
                className={`w-12 bg-secondary text-foreground text-xs rounded px-1 py-0.5 border ${bad ? 'border-destructive' : 'border-border'} text-center`}
              />
              <button type="button" onClick={apply} className="text-[10px] px-1.5 py-0.5 rounded bg-primary text-primary-foreground hover:opacity-90">{t('timing.align')}</button>
            </div>
          )}
          <div className="flex items-center justify-between gap-0.5">
            <button type="button" className={btn} onClick={() => onNudge(-60000)} title={t('timing.earlier')}>−1m</button>
            <button type="button" className={btn} onClick={() => onNudge(-10000)}>−10s</button>
            <button type="button" className={btn} onClick={() => onNudge(-1000)}>−1s</button>
            <span className="w-12 text-center text-[10px] tabular-nums text-muted-foreground" title={t('timing.syncOffset')}>{fmtOffsetSigned(syncOffsetMs)}</span>
            <button type="button" className={btn} onClick={() => onNudge(1000)}>+1s</button>
            <button type="button" className={btn} onClick={() => onNudge(10000)}>+10s</button>
            <button type="button" className={btn} onClick={() => onNudge(60000)} title={t('timing.later')}>+1m</button>
          </div>
          <button type="button" onClick={onUnsync} className="text-[11px] px-2 py-1 rounded border border-border hover:bg-accent flex items-center justify-center gap-1" title={t('timing.detach')}>
            <Unlink className="w-3.5 h-3.5" /> {t('timing.unsync')}
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
    <div className="flex flex-col gap-1 px-2">
      {s.segments.length > 0 && (
        <div className="flex gap-0.5">
          {s.segments.map((st, i) => (
            <span key={i} className="h-1.5 w-3 rounded-[1px]" style={{ backgroundColor: segColor(st) }} />
          ))}
        </div>
      )}
      <span className="tabular-nums text-sm leading-none" style={{ color }}>{s.value || '—'}</span>
    </div>
  );
}

/** Stint list in a native title tooltip. */
function stintTooltip(row: DriverRow, t: (key: string) => string): string {
  if (!row.stints.length) return '';
  const stops = Math.max(0, row.stints.length - 1);
  const lines = row.stints.map((s, i) => `${i + 1}. ${s.compound || '?'}${s.laps != null ? ` — ${t('timing.stintLaps').replace('{laps}', String(s.laps))}` : ''}${s.isNew ? ` (${t('timing.newTyre')})` : ''}`);
  const head = t(stops === 1 ? 'timing.pitStop' : 'timing.pitStops').replace('{count}', String(stops));
  return `${head}\n${lines.join('\n')}`;
}

/** Docked columns grow into the free width; the fixed width becomes their minimum. Literal classes for Tailwind. */
const FLUID_MIN: Record<string, string> = {
  'w-[2.75rem]': 'min-w-[2.75rem]',
  'w-[3.25rem]': 'min-w-[3.25rem]',
  'w-[3.75rem]': 'min-w-[3.75rem]',
  'w-[4.25rem]': 'min-w-[4.25rem]',
};
function col(width: string, fluid?: boolean): string {
  return fluid ? `flex-1 basis-0 ${FLUID_MIN[width] ?? ''}` : `${width} shrink-0`;
}

/** Numeric timing cells: fixed width, no bleed into the next column. */
function TimingCell({
  value,
  width,
  muted,
  large,
}: {
  value: string;
  width: string;
  muted?: boolean;
  large?: boolean;
}) {
  return (
    <div
      className={`${width} overflow-hidden text-ellipsis whitespace-nowrap tabular-nums text-right pr-3 leading-none ${
        large ? 'text-sm' : 'text-[11px]'
      } ${muted ? 'text-muted-foreground' : ''}`}
      title={value || undefined}
    >
      {value || '—'}
    </div>
  );
}

const DriverRowItem = React.memo(function DriverRowItem({
  row,
  index,
  compact,
  docked,
  dockWide,
  hasTelemetry,
}: {
  row: DriverRow;
  index: number;
  compact?: boolean;
  docked?: boolean;
  dockWide?: boolean;
  /** Telemetry (CarData) present for this session; hides the empty speed column otherwise. */
  hasTelemetry?: boolean;
}) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const tyre = TYRE_COLOR[row.tyre] || '#888';
  const pitStops = Math.max(0, row.stints.length - 1);
  const showInterval = dockWide || (!compact && !docked);
  const showLastLap = dockWide || (!compact && !docked);
  const showBestLap = !compact && !docked;
  // Very wide docks also get best lap and sectors (hidden below 900px by a container query).
  const showDockExtras = !!docked && !!dockWide;
  const showSectors = !compact && !docked;
  const showSpeed = !compact && !docked && !!hasTelemetry;
  const full = !compact && !docked;
  const tlaWidth = compact ? 'w-14' : full ? 'w-32' : 'w-24';
  const fluid = !!docked;
  return (
    <>
    <div
      className={`flex items-center border-b border-border/40 hover:bg-white/[0.05] transition-colors ${
        full ? 'timing-driver-row h-10 text-sm' : 'h-9 text-sm'
      }  ${row.retired ? 'opacity-50' : ''}`}
    >
      <div className={`${full ? 'w-9' : 'w-7'} shrink-0 text-center font-bold tabular-nums`}>{row.position}</div>
      <div className={`${full ? 'w-1.5 h-8' : 'w-1 h-6'} shrink-0 rounded-sm mr-2`} style={{ backgroundColor: row.teamColour }} />
      <div className={`${tlaWidth} shrink-0 font-heading font-bold tracking-wider flex items-center gap-1 min-w-0 overflow-hidden`}>
        <button type="button" className="underline-offset-4 hover:underline min-h-8" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{row.tla}</button>
        {row.drs && <span className="text-[8px] font-bold text-emerald-400 shrink-0" title="DRS active">DRS</span>}
        {row.retired ? (
          <span className="text-[9px] font-bold text-destructive shrink-0">OUT</span>
        ) : row.inPit ? (
          <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-destructive/80 text-white leading-none shrink-0">PIT</span>
        ) : row.pitOut ? (
          <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-500/80 text-black leading-none shrink-0">OUT</span>
        ) : null}
      </div>
      <TimingCell value={row.gapToLeader} width={full ? 'w-20 shrink-0' : col('w-[3.25rem]', fluid)} muted large={full} />
      {showInterval && <TimingCell value={row.interval} width={full ? 'w-20 shrink-0' : col('w-[3.75rem]', fluid)} muted large={full} />}
      {showLastLap && <TimingCell value={row.lastLap} width={full ? 'w-24 shrink-0' : col('w-[4.25rem]', fluid)} large={full} />}
      {showBestLap && <TimingCell value={row.bestLap} width="timing-secondary w-24 shrink-0" muted large={full} />}
      {showDockExtras && <TimingCell value={row.bestLap} width={`dock-xl ${col('w-[4.25rem]', true)}`} muted />}
      <div className={`${full ? 'w-20 shrink-0' : col('w-[2.75rem]', fluid)} flex items-center justify-start gap-1.5 cursor-default`} title={stintTooltip(row, t)}>
        {row.tyre ? (
          <>
            <span
              className={`inline-flex items-center justify-center shrink-0 rounded-full border font-bold leading-none ${
                full ? 'w-6 h-6 text-xs' : 'w-4 h-4 text-[9px]'
              }`}
              style={{ borderColor: tyre, color: tyre }}
            >
              {TYRE_LETTER[row.tyre] ?? row.tyre[0]}
            </span>
            {(showBestLap || showDockExtras) && <span className={`${full ? 'text-sm' : 'text-[11px]'} text-muted-foreground tabular-nums`}>{row.stintLaps ?? ''}</span>}
            {(showBestLap || showDockExtras) && pitStops > 0 && <span className="text-[9px] text-muted-foreground/70 tabular-nums">×{pitStops}</span>}
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
      {showSectors && (
        <div className="timing-secondary flex-1 flex items-center justify-between min-w-[180px]">
          {row.sectors.map((s, i) => <Sector key={i} s={s} />)}
        </div>
      )}
      {showDockExtras && (
        <div className="dock-xl flex-[2] basis-0 flex items-center justify-between min-w-[180px] pr-3">
          {row.sectors.map((s, i) => <Sector key={i} s={s} />)}
        </div>
      )}
      {showSpeed && (
        <div className={`timing-secondary ${full ? 'w-24' : 'w-16'} shrink-0 text-right pr-3`}>
          {row.speedKmh ? <span className={`${full ? 'text-sm' : 'text-[11px]'} tabular-nums text-muted-foreground`}>{row.speedKmh} km/h</span> : null}
        </div>
      )}
    </div>
    {expanded && <div className="px-4 py-3 border-b border-border bg-card text-xs space-y-3">
      <div className="flex flex-wrap gap-4 tabular-nums"><span>{t('timing.colLast')}: {row.lastLap || '—'}</span><span>{t('timing.colBest')}: {row.bestLap || '—'}</span><span>{t('timing.colInt')}: {row.interval || '—'}</span></div>
      <p>{stintTooltip(row, t)}</p>
      <div className="flex gap-4">{row.sectors.map((sector, i) => <div key={i}><span className="text-muted-foreground">S{i + 1}</span><Sector s={sector} /></div>)}</div>
    </div>}
    </>
  );
});

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
  const { t } = useLocale();
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
          title={err ? t('timing.radioFailed') : playing ? t('timing.pause') : t('timing.play')}
          aria-label={err ? t('timing.radioFailed') : playing ? t('timing.pause') : t('timing.play')}
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
          {err ? t('timing.radioError') : `${fmtSec(cur)} / ${fmtSec(dur)}`}
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

function WeatherStat({ icon: Icon, label, value, large }: { icon: React.ElementType; label: string; value: string; large?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className={`text-muted-foreground ${large ? 'w-4 h-4' : 'w-3.5 h-3.5'}`} />
      <span className={`uppercase tracking-wider text-muted-foreground ${large ? 'text-xs' : 'text-[10px]'}`}>{label}</span>
      <span className={`font-semibold tabular-nums ${large ? 'text-base' : 'text-sm'}`}>{value}</span>
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
 * The side feeds can hold hundreds of rows. Their arrays keep their identity until the store
 * actually changes, so memoizing them skips the per-tick (clock/scrub bar) re-renders.
 */
const RaceControlList = React.memo(function RaceControlList({ raceControl, emptyLabel }: { raceControl: RaceControlMessage[]; emptyLabel: string }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto thin-scrollbar">
      {raceControl.map((m, i) => (
        <div key={`${m.utc}|${m.message}|${i}`} className="px-4 py-2.5 border-b border-border/40 text-sm">
          {m.flag && <span className="font-bold mr-1" style={{ color: flagColor(m.flag) }}>{m.flag}</span>}
          <span className="text-foreground">{m.message}</span>
          {m.lap != null && <span className="text-muted-foreground ml-1">(L{m.lap})</span>}
        </div>
      ))}
      {!raceControl.length && <div className="p-4 text-sm text-muted-foreground">{emptyLabel}</div>}
    </div>
  );
});

const TeamRadioList = React.memo(function TeamRadioList({
  teamRadio,
  tlaByNum,
  sessionPath,
  emptyLabel,
}: {
  teamRadio: TeamRadioClip[];
  tlaByNum: Record<string, string>;
  sessionPath: string;
  emptyLabel: string;
}) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto thin-scrollbar">
      {teamRadio.map((clip) => (
        // Newest-first list: an index key would attach a loaded/playing audio element to the wrong clip.
        <RadioClip key={`${clip.utc}|${clip.path}`} clip={clip} tla={tlaByNum[clip.number] || ''} sessionPath={sessionPath} />
      ))}
      {!teamRadio.length && <div className="p-4 text-sm text-muted-foreground">{emptyLabel}</div>}
    </div>
  );
});

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
  const { t } = useLocale();
  const [activePanel, setActivePanel] = useState<'standings' | 'control' | 'radio'>('standings');
  const [density, setDensity] = useState<'normal' | 'compact'>('normal');
  const tlaByNum = useMemo(() => {
    const m: Record<string, string> = {};
    for (const d of drivers) m[d.number] = d.tla;
    return m;
  }, [drivers]);
  const full = !compact && !docked;
  const tlaHeadWidth = compact ? 'w-14' : full ? 'w-32' : 'w-24';
  const hasTelemetry = drivers.some((d) => d.speedKmh != null);

  return (
    <div className={`timing-surface timing-density-${density} ${compact ? 'h-full' : 'h-screen'} overflow-hidden bg-background text-foreground flex flex-col`}>
      {/* Header: title, status, weather */}
      <div className={`flex items-center gap-4 border-b border-border bg-card/60 flex-wrap ${full ? 'px-6 py-3' : compact ? 'px-2 py-1.5' : 'px-4 py-2'}`}>
        <div className="flex items-center gap-2 min-w-0 max-w-full">
          {headerBadge}
          <span className={`font-heading font-bold tracking-wider truncate ${full ? 'text-lg' : ''}`}>{title || t('timing.title')}</span>
          {lapCount && (
            <span className={`tabular-nums font-bold rounded bg-secondary shrink-0 ${full ? 'text-sm px-2.5 py-1' : 'text-xs px-2 py-0.5'}`}>
              LAP {lapCount.current}/{lapCount.total}
            </span>
          )}
          {clock && <span className={`tabular-nums text-primary font-bold shrink-0 ${full ? 'text-lg' : ''}`}>{clock.remaining}</span>}
        </div>
        {trackStatus && (
          <span
            className={`font-bold rounded shrink-0 ${full ? 'text-sm px-2.5 py-1' : 'text-xs px-2 py-0.5'} ${
              trackStatus.status === '1' ? 'bg-emerald-600/80 text-white' : 'bg-amber-500/80 text-black'
            }`}
          >
            {trackStatus.label}
          </span>
        )}
        {w && !compact && (
          <div className={`timing-weather flex items-center ml-auto ${full ? 'gap-6' : 'gap-4'}`}>
            <WeatherStat icon={Wind} label={t('timing.wind')} value={`${w.windSpeed} m/s`} large={full} />
            <WeatherStat icon={Thermometer} label={t('timing.track')} value={`${w.trackTemp}°`} large={full} />
            <WeatherStat icon={Thermometer} label={t('timing.air')} value={`${w.airTemp}°`} large={full} />
            <WeatherStat icon={Droplets} label={t('timing.humidity')} value={`${w.humidity}%`} large={full} />
            <WeatherStat icon={Gauge} label={t('timing.pressure')} value={`${w.pressure}`} large={full} />
            <WeatherStat icon={CloudRain} label={t('timing.rain')} value={w.rainfall ? t('timing.yes') : t('timing.no')} large={full} />
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-center px-3 py-2 border-b border-border">
        <div className="timing-panel-tabs gap-1" role="group" aria-label={t('timing.title')}>
          {(['standings', 'control', 'radio'] as const).map((panel) => <button key={panel} className="ui-button" aria-pressed={activePanel === panel} onClick={() => setActivePanel(panel)}>{t(panel === 'standings' ? 'experience.standings' : panel === 'control' ? 'timing.raceControl' : 'timing.teamRadio')}</button>)}
        </div>
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">{t('experience.density')}
          <select className="ui-input !text-xs" value={density} onChange={(event) => setDensity(event.target.value as 'normal' | 'compact')}>
            <option value="normal">{t('experience.normal')}</option><option value="compact">{t('experience.compact')}</option>
          </select>
        </label>
      </div>
      <div className="flex-1 flex min-h-0">
        {/* Timing table */}
        <div data-active={activePanel === 'standings'} className={`timing-table flex-1 overflow-auto thin-scrollbar min-w-0 ${docked ? 'overflow-x-auto' : ''}`}>
          {(dockWide || full) && (
            <div className={`flex items-center px-0 text-muted-foreground border-b border-border sticky top-0 bg-background min-w-max ${full ? 'h-9 text-xs' : 'h-7 text-[10px]'}`}>
              <div className={`${full ? 'w-9' : 'w-7'} shrink-0 text-center`}>P</div>
              <div className={`${full ? 'w-1.5' : 'w-1'} mr-2 shrink-0`} />
              <div className={`${tlaHeadWidth} shrink-0`}>{t('timing.colDriver')}</div>
              <div className={`${full ? 'w-20 shrink-0' : col('w-[3.25rem]', docked)} text-right pr-3`}>{t('timing.colGap')}</div>
              {(dockWide || !docked) && <div className={`${full ? 'w-20 shrink-0' : col('w-[3.75rem]', docked)} text-right pr-3`}>{t('timing.colInt')}</div>}
              {(dockWide || !docked) && <div className={`${full ? 'w-24 shrink-0' : col('w-[4.25rem]', docked)} text-right pr-3`}>{t('timing.colLast')}</div>}
              {!docked && <div className="timing-secondary w-24 shrink-0 text-right pr-3">{t('timing.colBest')}</div>}
              {docked && dockWide && <div className={`dock-xl ${col('w-[4.25rem]', true)} text-right pr-3`}>{t('timing.colBest')}</div>}
              <div className={full ? 'w-20 shrink-0' : col('w-[2.75rem]', docked)}>{t('timing.colTyre')}</div>
              {!docked && <div className="timing-secondary flex-1 min-w-[180px]">{t('timing.colSectors')}</div>}
              {docked && dockWide && <div className="dock-xl flex-[2] basis-0 min-w-[180px] pr-3">{t('timing.colSectors')}</div>}
              {!docked && hasTelemetry && <div className={`timing-secondary ${full ? 'w-24' : 'w-16'} text-right pr-3 shrink-0`}>{t('timing.colSpeed')}</div>}
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
              hasTelemetry={hasTelemetry}
            />
          ))}
          {!drivers.length && (
            <div className="p-8 text-center text-muted-foreground">{t('timing.noDrivers')}</div>
          )}
        </div>

        {/* Race control + team radio feed, each panel scrolls on its own and never grows past its share.
            Compact views expose the feeds through the panel selector. */}
        {(full || activePanel !== 'standings') && (
          <div data-active={activePanel !== 'standings'} className="timing-feed border-l border-border bg-card/30 flex flex-col min-h-0">
            <div data-active={activePanel === 'control'} className="flex-1 min-h-0 flex flex-col basis-0">
              <div className="px-4 py-2.5 text-xs text-muted-foreground border-b border-border bg-card/60 shrink-0">
                {t('timing.raceControl')}
              </div>
              <RaceControlList raceControl={raceControl} emptyLabel={t('timing.noMessages')} />
            </div>

            <div data-active={activePanel === 'radio'} className="flex-1 min-h-0 flex flex-col basis-0 border-t border-border">
              <div className="px-4 py-2.5 text-xs text-muted-foreground border-b border-border bg-card/60 shrink-0">
                {t('timing.teamRadio')}
              </div>
              <TeamRadioList teamRadio={teamRadio} tlaByNum={tlaByNum} sessionPath={sessionPath} emptyLabel={t('timing.noClips')} />
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
  contentId,
  compact,
  docked,
  dockWide,
}: {
  path: string;
  title: string;
  syncStart: number | null;
  contentId?: number;
  compact?: boolean;
  docked?: boolean;
  dockWide?: boolean;
}) {
  const { t: tr } = useLocale();
  const t = useReplayTiming(path, syncStart, contentId);
  if (t.loading) return <LoadingScreen label={tr('timing.loading')} compact={compact} />;
  if (t.error) return <ErrorScreen message={t.error} compact={compact} />;

  const resyncButton = t.detached && t.videoAvailable ? (
    <button
      type="button"
      onClick={t.resync}
      title={tr('timing.resync')}
      aria-label={tr('timing.resync')}
      className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 px-2 py-1 rounded border border-emerald-400/30 hover:bg-emerald-400/10 shrink-0"
    >
      <Link2 className="w-3.5 h-3.5" /> {compact ? null : tr('timing.resync')}
    </button>
  ) : null;

  const footer = (
    <div className={`flex items-center gap-3 border-t border-border bg-card/60 ${compact ? 'px-2 py-1.5' : 'px-4 py-2'}`}>
      <button
        type="button"
        onClick={t.playing ? t.pause : t.play}
        className="w-8 h-8 flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90 shrink-0"
        title={t.synced ? tr('timing.detachPlay') : t.playing ? tr('timing.pause') : tr('timing.play')}
        aria-label={t.synced ? tr('timing.detachPlay') : t.playing ? tr('timing.pause') : tr('timing.play')}
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
          onChange={(e) => (t.synced ? t.requestVideoSeek(Number(e.target.value)) : t.seek(Number(e.target.value)))}
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
        <>
        {resyncButton}
        <select
          value={t.speed}
          onChange={(e) => t.setSpeed(Number(e.target.value))}
          className="bg-secondary text-foreground text-xs rounded px-2 py-1 border border-border shrink-0"
          title={tr('timing.speedHint')}
        >
          {[1, 2, 5, 10, 30, 60].map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
        </>
      ) : resyncButton}
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
  contentId,
  query,
  compact,
  docked,
  dockWide,
}: {
  path?: string;
  title: string;
  syncStart?: number | null;
  contentId?: number;
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
  const { t: tr } = useLocale();

  useEffect(() => {
    if (resolved || !query) return;
    let cancel = false;
    (async () => {
      try {
        const lt = window.f1?.liveTiming;
        if (!lt?.resolveSession) throw new Error(tr('timing.unavailable'));
        const found = await lt.resolveSession(query.year as number, query);
        if (!found) throw new Error(tr('timing.sessionNotFound'));
        const sd = lt.getSyncData ? await lt.getSyncData(found.meeting?.Key as any, found.session?.Key as any).catch(() => null) : null;
        if (cancel) return;
        setResolved({
          path: found.path,
          title: title || found.session?.Name || '',
          syncStart: sd?.sessionStartSec ?? null,
        });
      } catch (e: any) {
        if (!cancel) setResolveErr(e?.message || tr('timing.unavailable'));
      }
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (resolveErr) return <ErrorScreen message={resolveErr} compact={compact} />;
  if (!resolved) return <LoadingScreen label={tr('timing.loading')} compact={compact} />;
  return <ReplayTimingPanel path={resolved.path} title={resolved.title} syncStart={resolved.syncStart} contentId={contentId} compact={compact} docked={docked} dockWide={dockWide} />;
}

export function LivePill({
  connected,
  reconnecting,
  detail,
}: {
  connected: boolean;
  reconnecting?: boolean;
  detail?: string | null;
}) {
  const { t } = useLocale();
  const label = connected ? t('timing.live') : reconnecting ? t('timing.reconnecting') : t('timing.connectingPill');
  return (
    <span
      className={`flex items-center gap-1.5 text-xs font-heading font-bold tracking-widest ${connected ? 'text-red-500' : reconnecting ? 'text-amber-400' : 'text-muted-foreground'}`}
      title={!connected && detail ? detail : undefined}
    >
      <span className="relative flex h-2.5 w-2.5">
        {connected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />}
        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${connected ? 'bg-red-500' : 'bg-muted-foreground'}`} />
      </span>
      {label}
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
  const { t: tr } = useLocale();
  const t = useLiveTiming(query);
  if (t.loading) return <LoadingScreen label={tr('timing.connecting')} compact={compact} />;
  if (t.error) return <ErrorScreen message={t.error} compact={compact} />;

  const reconnecting = t.status === 'reconnecting';
  const footer = (
    <div className={`flex items-center gap-3 border-t border-border bg-card/60 ${compact ? 'px-2 py-1.5' : 'px-4 py-2'}`}>
      <LivePill connected={t.connected} reconnecting={reconnecting} detail={t.statusDetail} />
      <span className="text-xs text-muted-foreground">{tr('experience.liveWarning')}</span>
      {reconnecting && t.statusDetail && !compact && (
        <span className="text-[11px] text-muted-foreground truncate">{t.statusDetail}</span>
      )}
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
      headerBadge={<LivePill connected={t.connected} reconnecting={reconnecting} detail={t.statusDetail} />}
      footer={footer}
      compact={compact}
      docked={docked}
      dockWide={dockWide}
    />
  );
}
