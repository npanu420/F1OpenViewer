import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, Volume2, VolumeX, Maximize, Minimize, Settings } from 'lucide-react';
import type shaka from 'shaka-player/dist/shaka-player.ui';

/**
 * Custom playback control bar shared by every player surface (embedded panels, single player,
 * multiview). Replaces the native <video controls> bar, whose default time display shows the
 * F1 live wall-clock timeline as a giant "21805:28:14" counter. For live streams we show a
 * YouTube-style LIVE pill + full progress bar instead; for VOD a normal scrubber + clock.
 *
 * Reads state straight off the <video> element (events + a light poll for the live edge) so it
 * stays in sync no matter who else drives playback (sync engine, keyboard, etc.).
 */

type Props = {
  getVideo: () => HTMLVideoElement | null;
  getPlayer: () => shaka.Player | null;
  /** The element to toggle fullscreen on (the player container, so the bar stays visible). */
  getContainer: () => HTMLElement | null;
  /** Embedded slots (StreamPanel/multiview) render the bar more compactly. */
  compact?: boolean;
  /** Called when the user raises volume from muted, so the parent can claim audio focus. */
  onUnmute?: () => void;
};

/** Seconds from the live edge within which we consider the viewer "at" live. */
const LIVE_EDGE_THRESHOLD = 12;

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

type QualityTrack = { id: number; height: number; active: boolean };

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

export function VideoControls({ getVideo, getPlayer, getContainer, compact, onUnmute }: Props) {
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(1);
  const [isLive, setIsLive] = useState(false);
  const [atEdge, setAtEdge] = useState(true);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [liveFill, setLiveFill] = useState(1); // 0..1 position within the DVR window
  const [behindLive, setBehindLive] = useState(0); // seconds behind the live edge
  const [isFs, setIsFs] = useState(false);
  const [visible, setVisible] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [tracks, setTracks] = useState<QualityTrack[]>([]);
  const [autoQuality, setAutoQuality] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Pull current state off the video/player. Cheap; called from events and a 1s poll.
  const sync = useCallback(() => {
    const v = getVideo();
    if (!v) return;
    setPlaying(!v.paused);
    setMuted(v.muted);
    setVolume(v.volume);
    setSpeed(v.playbackRate);

    const p = getPlayer();
    let live = false;
    let range: { start: number; end: number } | null = null;
    try { live = !!p && typeof p.isLive === 'function' && p.isLive(); } catch (_) {}
    try {
      const r = p && typeof p.seekRange === 'function' ? p.seekRange() : null;
      if (r && Number.isFinite(r.end)) range = r;
    } catch (_) {}
    // Manifests with a wall-clock timeline report a huge/non-finite duration → also "live".
    const dur = v.duration;
    if (!Number.isFinite(dur) || dur > 60 * 60 * 24) live = true;
    setIsLive(live);

    if (live) {
      const end = range ? range.end : (v.seekable.length ? v.seekable.end(v.seekable.length - 1) : v.currentTime);
      const start = range ? range.start : (v.seekable.length ? v.seekable.start(0) : 0);
      setAtEdge(end - v.currentTime <= LIVE_EDGE_THRESHOLD);
      setBehindLive(Math.max(0, end - v.currentTime));
      const span = end - start;
      setLiveFill(span > 0 ? Math.min(1, Math.max(0, (v.currentTime - start) / span)) : 1);
    } else {
      setCurrent(v.currentTime);
      setDuration(Number.isFinite(dur) ? dur : 0);
    }
  }, [getVideo, getPlayer]);

  useEffect(() => {
    const v = getVideo();
    if (!v) return;
    const evs = ['play', 'pause', 'timeupdate', 'volumechange', 'durationchange', 'loadedmetadata', 'seeking', 'seeked', 'ratechange'];
    evs.forEach((e) => v.addEventListener(e, sync));
    const poll = setInterval(sync, 1000); // live edge distance isn't event-driven
    sync();
    return () => {
      evs.forEach((e) => v.removeEventListener(e, sync));
      clearInterval(poll);
    };
  }, [getVideo, sync]);

  useEffect(() => {
    const onFs = () => setIsFs(document.fullscreenElement === getContainer());
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, [getContainer]);

  // Auto-hide while playing; always visible when paused, on mouse move, or with the menu open.
  const poke = useCallback(() => {
    setVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    const v = getVideo();
    if (v && !v.paused && !menuOpen) hideTimer.current = setTimeout(() => setVisible(false), 2500);
  }, [getVideo, menuOpen]);

  useEffect(() => {
    const c = getContainer();
    if (!c) return;
    const onLeave = () => {
      const v = getVideo();
      if (v && !v.paused && !menuOpen) setVisible(false);
    };
    c.addEventListener('mousemove', poke);
    c.addEventListener('mouseleave', onLeave);
    poke();
    return () => {
      c.removeEventListener('mousemove', poke);
      c.removeEventListener('mouseleave', onLeave);
    };
  }, [getContainer, getVideo, poke, menuOpen]);

  // Close the settings menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const refreshTracks = () => {
    const p = getPlayer();
    if (!p || typeof p.getVariantTracks !== 'function') { setTracks([]); return; }
    try {
      const seen = new Map<number, QualityTrack>();
      for (const t of p.getVariantTracks() as any[]) {
        if (!t.height) continue;
        const prev = seen.get(t.height);
        if (!prev || t.active) seen.set(t.height, { id: t.id, height: t.height, active: !!t.active });
      }
      setTracks(Array.from(seen.values()).sort((a, b) => b.height - a.height));
      try { setAutoQuality(!!(p.getConfiguration() as any)?.abr?.enabled); } catch (_) {}
    } catch (_) { setTracks([]); }
  };

  const togglePlay = () => {
    const v = getVideo();
    if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
  };
  const toggleMute = () => {
    const v = getVideo();
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    if (!v.muted) onUnmute?.();
  };
  const setVol = (val: number) => {
    const v = getVideo();
    if (!v) return;
    v.volume = val;
    if (val > 0 && v.muted) { v.muted = false; onUnmute?.(); }
    if (val === 0) v.muted = true;
  };
  const setRate = (r: number) => {
    const v = getVideo();
    if (v) v.playbackRate = r;
    setSpeed(r);
  };
  const setQuality = (track: QualityTrack | null) => {
    const p = getPlayer();
    if (!p) return;
    try {
      if (track == null) {
        p.configure({ abr: { enabled: true } });
        setAutoQuality(true);
      } else {
        p.configure({ abr: { enabled: false } });
        const full = (p.getVariantTracks() as any[]).find((t) => t.id === track.id);
        if (full && typeof p.selectVariantTrack === 'function') p.selectVariantTrack(full, true);
        setAutoQuality(false);
      }
      refreshTracks();
    } catch (_) {}
  };
  const goLive = () => {
    const v = getVideo();
    const p = getPlayer();
    if (!v) return;
    try {
      if (p && typeof (p as any).goToLive === 'function') (p as any).goToLive();
      else {
        const r = p && typeof p.seekRange === 'function' ? p.seekRange() : null;
        if (r && Number.isFinite(r.end)) v.currentTime = r.end - 2;
      }
      if (v.paused) v.play().catch(() => {});
    } catch (_) {}
  };
  const seekVod = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = getVideo();
    if (!v || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    v.currentTime = ratio * duration;
  };
  /** Seek within the live DVR window (read fresh from the player, state may lag). */
  const seekLive = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = getVideo();
    const p = getPlayer();
    if (!v) return;
    let start = 0;
    let end = 0;
    try {
      const r = p && typeof p.seekRange === 'function' ? p.seekRange() : null;
      if (r && Number.isFinite(r.end) && r.end > r.start) {
        start = r.start;
        end = r.end;
      } else if (v.seekable.length) {
        start = v.seekable.start(0);
        end = v.seekable.end(v.seekable.length - 1);
      }
    } catch (_) {}
    const span = end - start;
    if (span <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const target = start + ratio * span;
    // Snap to the live edge when clicking near the end so playback re-attaches to live.
    if (end - target <= LIVE_EDGE_THRESHOLD) {
      goLive();
      return;
    }
    v.currentTime = target;
    sync();
  };
  const toggleFs = () => {
    const c = getContainer();
    if (!c) return;
    if (document.fullscreenElement === c) document.exitFullscreen().catch(() => {});
    else c.requestFullscreen().catch(() => {});
  };
  const toggleMenu = () => {
    setMenuOpen((open) => {
      if (!open) refreshTracks();
      return !open;
    });
  };

  const vodPct = duration > 0 ? (current / duration) * 100 : 0;
  const iconSize = compact ? 'w-4 h-4' : 'w-5 h-5';

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-10 transition-opacity duration-200"
      style={{ opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <div className="bg-gradient-to-t from-black/85 via-black/50 to-transparent px-3 pt-6 pb-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={togglePlay}
            className="shrink-0 text-white/90 hover:text-white transition-colors"
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause className={iconSize} /> : <Play className={iconSize} />}
          </button>

          {isLive ? (
            <>
              <button
                type="button"
                onClick={atEdge ? undefined : goLive}
                title={atEdge ? 'Live' : 'Go to live'}
                className={`shrink-0 flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-bold tracking-wider uppercase transition-colors ${
                  atEdge
                    ? 'text-white cursor-default'
                    : 'text-white/60 hover:text-white cursor-pointer'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${atEdge ? 'bg-red-600 animate-pulse' : 'bg-white/40'}`}
                />
                Live
              </button>
              {/* DVR scrubber: click to seek back within the live window; clicking near the end snaps to live. */}
              <div
                className="flex-1 h-1.5 rounded-full bg-white/20 cursor-pointer group"
                onClick={seekLive}
                title="Seek within the live window"
              >
                <div
                  className="h-full bg-red-600 rounded-full relative transition-[width] duration-500"
                  style={{ width: `${(atEdge ? 1 : liveFill) * 100}%` }}
                >
                  <span className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-3 h-3 rounded-full bg-red-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
              {!atEdge && (
                <span className="shrink-0 text-[11px] tabular-nums text-white/80" title="Behind live">
                  -{fmt(behindLive)}
                </span>
              )}
            </>
          ) : (
            <>
              <span className="shrink-0 text-[11px] tabular-nums text-white/80 w-10 text-right">
                {fmt(current)}
              </span>
              <div
                className="flex-1 h-1.5 rounded-full bg-white/20 cursor-pointer group"
                onClick={seekVod}
              >
                <div
                  className="h-full bg-red-600 rounded-full relative"
                  style={{ width: `${vodPct}%` }}
                >
                  <span className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-3 h-3 rounded-full bg-red-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-white/80 w-10">
                {fmt(duration)}
              </span>
            </>
          )}

          <div className="shrink-0 flex items-center gap-1.5 group">
            <button
              type="button"
              onClick={toggleMute}
              className="text-white/90 hover:text-white transition-colors"
              title={muted ? 'Unmute' : 'Mute'}
            >
              {muted || volume === 0 ? <VolumeX className={iconSize} /> : <Volume2 className={iconSize} />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => setVol(Number(e.target.value))}
              className={`${compact ? 'w-0 group-hover:w-14' : 'w-16'} transition-[width] duration-200 accent-red-600 cursor-pointer`}
              title="Volume"
            />
          </div>

          {/* Settings: playback speed + quality */}
          <div className="shrink-0 relative" ref={menuRef}>
            <button
              type="button"
              onClick={toggleMenu}
              className={`text-white/90 hover:text-white transition-colors ${menuOpen ? 'text-white' : ''}`}
              title="Settings"
            >
              <Settings className={iconSize} />
            </button>
            {menuOpen && (
              <div className="absolute bottom-8 right-0 w-44 max-h-72 overflow-y-auto rounded-md bg-black/95 border border-white/10 shadow-xl p-2 text-[12px] text-white/90">
                <div className="px-1 pb-1 text-[10px] uppercase tracking-wider text-white/40">Speed</div>
                <div className="grid grid-cols-3 gap-1 mb-2">
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setRate(s)}
                      className={`py-1 rounded text-center transition-colors ${
                        Math.abs(speed - s) < 0.001 ? 'bg-red-600 text-white' : 'bg-white/5 hover:bg-white/15'
                      }`}
                    >
                      {s === 1 ? '1×' : `${s}×`}
                    </button>
                  ))}
                </div>
                <div className="px-1 pb-1 text-[10px] uppercase tracking-wider text-white/40">Quality</div>
                <button
                  type="button"
                  onClick={() => setQuality(null)}
                  className={`w-full text-left px-2 py-1 rounded transition-colors ${
                    autoQuality ? 'bg-red-600 text-white' : 'hover:bg-white/15'
                  }`}
                >
                  Auto
                </button>
                {tracks.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setQuality(t)}
                    className={`w-full text-left px-2 py-1 rounded transition-colors ${
                      !autoQuality && t.active ? 'bg-red-600 text-white' : 'hover:bg-white/15'
                    }`}
                  >
                    {t.height}p
                  </button>
                ))}
                {tracks.length === 0 && (
                  <div className="px-2 py-1 text-white/40">No quality options</div>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={toggleFs}
            className="shrink-0 text-white/90 hover:text-white transition-colors"
            title={isFs ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFs ? <Minimize className={iconSize} /> : <Maximize className={iconSize} />}
          </button>
        </div>
      </div>
    </div>
  );
}
