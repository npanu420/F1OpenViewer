import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, Volume2, VolumeX, Maximize, Minimize } from 'lucide-react';
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
  /** Embedded slots (StreamPanel/multiview) already have a header mute → hide the bar's volume. */
  compact?: boolean;
};

/** Seconds from the live edge within which we consider the viewer "at" live. */
const LIVE_EDGE_THRESHOLD = 12;

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

export function VideoControls({ getVideo, getPlayer, getContainer, compact }: Props) {
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(1);
  const [isLive, setIsLive] = useState(false);
  const [atEdge, setAtEdge] = useState(true);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [liveFill, setLiveFill] = useState(1); // 0..1 position within the DVR window
  const [isFs, setIsFs] = useState(false);
  const [visible, setVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pull current state off the video/player. Cheap; called from events and a 1s poll.
  const sync = useCallback(() => {
    const v = getVideo();
    if (!v) return;
    setPlaying(!v.paused);
    setMuted(v.muted);
    setVolume(v.volume);

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
    const evs = ['play', 'pause', 'timeupdate', 'volumechange', 'durationchange', 'loadedmetadata', 'seeking', 'seeked'];
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

  // Auto-hide while playing; always visible when paused or on mouse move.
  const poke = useCallback(() => {
    setVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    const v = getVideo();
    if (v && !v.paused) hideTimer.current = setTimeout(() => setVisible(false), 2500);
  }, [getVideo]);

  useEffect(() => {
    const c = getContainer();
    if (!c) return;
    const onLeave = () => {
      const v = getVideo();
      if (v && !v.paused) setVisible(false);
    };
    c.addEventListener('mousemove', poke);
    c.addEventListener('mouseleave', onLeave);
    poke();
    return () => {
      c.removeEventListener('mousemove', poke);
      c.removeEventListener('mouseleave', onLeave);
    };
  }, [getContainer, getVideo, poke]);

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
  };
  const setVol = (val: number) => {
    const v = getVideo();
    if (!v) return;
    v.volume = val;
    if (val > 0 && v.muted) v.muted = false;
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
  const toggleFs = () => {
    const c = getContainer();
    if (!c) return;
    if (document.fullscreenElement === c) document.exitFullscreen().catch(() => {});
    else c.requestFullscreen().catch(() => {});
  };

  const vodPct = duration > 0 ? (current / duration) * 100 : 0;

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-10 transition-opacity duration-200"
      style={{ opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none' }}
    >
      <div className="bg-gradient-to-t from-black/85 via-black/50 to-transparent px-3 pt-6 pb-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={togglePlay}
            className="shrink-0 text-white/90 hover:text-white transition-colors"
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
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
              {/* Full bar: filled red shows position within the DVR window; not seekable. */}
              <div className="flex-1 h-1 rounded-full bg-white/20 overflow-hidden">
                <div
                  className="h-full bg-red-600 rounded-full transition-[width] duration-500"
                  style={{ width: `${(atEdge ? 1 : liveFill) * 100}%` }}
                />
              </div>
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

          {!compact && (
            <div className="shrink-0 flex items-center gap-1.5 group">
              <button
                type="button"
                onClick={toggleMute}
                className="text-white/90 hover:text-white transition-colors"
                title={muted ? 'Unmute' : 'Mute'}
              >
                {muted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => setVol(Number(e.target.value))}
                className="w-0 group-hover:w-16 transition-[width] duration-200 accent-red-600 cursor-pointer"
                title="Volume"
              />
            </div>
          )}

          <button
            type="button"
            onClick={toggleFs}
            className="shrink-0 text-white/90 hover:text-white transition-colors"
            title={isFs ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFs ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
