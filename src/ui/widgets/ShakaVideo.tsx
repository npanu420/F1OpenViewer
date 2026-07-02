import React, { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import shaka from 'shaka-player/dist/shaka-player.ui';
import { useLocale } from '../../i18n/LocaleContext';
import { VideoControls } from './VideoControls';

export type ShakaVideoHandle = {
  /** Returns the underlying HTMLVideoElement (or null) */
  getVideoElement: () => HTMLVideoElement | null;
  /**
   * Wall-clock UTC (ms) of the current frame, from the DASH presentation timeline. F1's DASH
   * replays are anchored to real broadcast time, so this lets live timing auto-sync. Returns null
   * for HLS / streams without a real wall clock (those report epoch-zero garbage).
   */
  getWallClockMs: () => number | null;
};

type Props = {
  manifestUrl: string;
  licenseUrl: string;
  accessToken?: string;
  licenseHeaders?: Record<string, string>;
  fallbackManifestUrl?: string;
  fallbackLicenseUrl?: string;
  fallbackLicenseHeaders?: Record<string, string>;
  onError: (msg: string) => void;
  /** Hide status pills and let video fill container (for embedded slots) */
  compact?: boolean;
  /**
   * Emits decoded frame dimensions from the video element (videoWidth / videoHeight).
   * UI-only; does not affect Shaka configuration or playback.
   */
  onIntrinsicVideoSize?: (width: number, height: number) => void;
  /**
   * Optional initial playback position (seconds). Used when the standalone multiview window
   * resumes a stream that was already playing in the source window — Shaka seeks here once
   * after the first successful load so the user lands on the same frame.
   * Re-mounting/changing manifestUrl resets the "applied" state so a new initialSeekSeconds
   * value is honored.
   * Ignored for live streams (preferLiveEdge / player.isLive()).
   */
  initialSeekSeconds?: number;
  /** When true, skip DVR start position and jump to the live edge after load. */
  preferLiveEdge?: boolean;
  /** Called when the user raises volume from muted in the control bar (claims audio focus). */
  onAudioFocus?: () => void;
};

function safeErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try { return JSON.stringify(e); } catch { return ''; }
}

/** Extracts the per-stream key from a license proxy URL like http://127.0.0.1:NNN/la?stream=<key>. */
function extractStreamKey(licenseUrl: string | undefined): string | undefined {
  if (!licenseUrl || typeof licenseUrl !== 'string') return undefined;
  if (!licenseUrl.includes('/la?')) return undefined;
  try {
    const u = new URL(licenseUrl);
    return u.searchParams.get('stream') || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Stable content-based hash of header dict. Used as a useEffect dep so the player isn't
 * re-initialized on every parent render that produces a fresh `licenseHeaders` object with
 * the same content (parent code currently builds new objects each render).
 */
function hashHeaders(h: Record<string, string> | undefined): string {
  if (!h) return '';
  const keys = Object.keys(h).sort();
  return keys.map((k) => `${k}=${h[k] ?? ''}`).join('|');
}

/** Live DASH manifests often report a huge or non-finite duration in the video element. */
function isLikelyLiveVideo(video: HTMLVideoElement): boolean {
  const d = video.duration;
  if (!Number.isFinite(d)) return true;
  return d > 60 * 60 * 24;
}

/** Live edge offset (seconds behind the end of the seek range). */
const LIVE_EDGE_OFFSET = 6;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Robustly move a live stream to the live edge.
 *
 * The F1 world feed manifest can report a wall-clock presentation timeline (currentTime in the
 * tens of millions of seconds). Shaka may not have a usable seek range immediately after load,
 * so we poll for a few seconds: as soon as a finite seek range (or a populated `seekable`) is
 * available we jump near its end. We also keep nudging until the video actually starts advancing,
 * because a single seek to a not-yet-buffered position can leave the element paused on a black frame.
 */
async function seekToLiveEdge(player: shaka.Player, video: HTMLVideoElement): Promise<void> {
  const deadline = Date.now() + 10000;
  let lastTime = -1;
  let stableProgressTicks = 0;

  while (Date.now() < deadline) {
    let isLive = false;
    let range: { start: number; end: number } | null = null;
    try {
      isLive = typeof player.isLive === 'function' && player.isLive();
    } catch (_) {}
    try {
      const r = typeof player.seekRange === 'function' ? player.seekRange() : null;
      if (r && Number.isFinite(r.end)) range = r;
    } catch (_) {}

    let seekableEnd: number | null = null;
    let seekableStart: number | null = null;
    try {
      const s = video.seekable;
      if (s && s.length > 0) {
        seekableStart = s.start(0);
        seekableEnd = s.end(s.length - 1);
      }
    } catch (_) {}

    // eslint-disable-next-line no-console
    console.log('[shaka][live] edge attempt', {
      isLive,
      range,
      seekableStart,
      seekableEnd,
      duration: video.duration,
      currentTime: video.currentTime,
      paused: video.paused,
      readyState: video.readyState,
    });

    const edge =
      range && range.end > range.start ? range.end
      : seekableEnd != null ? seekableEnd
      : null;
    const start =
      range ? range.start
      : seekableStart != null ? seekableStart
      : 0;

    if (edge != null) {
      const target = Math.max(start, edge - LIVE_EDGE_OFFSET);
      // Only seek when we're meaningfully off the edge (avoids fighting normal playback).
      if (!Number.isFinite(video.currentTime) || Math.abs(video.currentTime - edge) > LIVE_EDGE_OFFSET * 3) {
        try {
          if (typeof (player as any).goToLive === 'function' && isLive) {
            (player as any).goToLive();
          }
          video.currentTime = target;
        } catch (_) {}
      }
      try { if (video.paused) await video.play(); } catch (_) {}
    }

    // Consider it started once currentTime advances across a couple of ticks while not paused.
    if (!video.paused && Number.isFinite(video.currentTime)) {
      if (lastTime >= 0 && video.currentTime > lastTime + 0.05) {
        stableProgressTicks += 1;
        if (stableProgressTicks >= 2) return;
      }
      lastTime = video.currentTime;
    }

    await sleep(300);
  }
}

export const ShakaVideo = forwardRef<ShakaVideoHandle, Props>(function ShakaVideo(props, ref) {
  const { t } = useLocale();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<shaka.Player | null>(null);
  /** Outstanding destroy() of the previous player instance. The next init awaits this so two
   *  Shaka instances never coexist on the same video element when props change rapidly. */
  const destroyChainRef = useRef<Promise<void>>(Promise.resolve());
  const [ready, setReady] = useState(false);
  const intrinsicCbRef = useRef(props.onIntrinsicVideoSize);
  intrinsicCbRef.current = props.onIntrinsicVideoSize;
  const propsRef = useRef(props);
  propsRef.current = props;
  // Stable hashes of header dicts so identical content doesn't churn the effect.
  const licenseHeadersHash = hashHeaders(props.licenseHeaders);
  const fallbackLicenseHeadersHash = hashHeaders(props.fallbackLicenseHeaders);
  /**
   * Last known playback position keyed by manifestUrl. On a re-init triggered by header changes
   * (same manifest, different tokens) we resume from here rather than restarting at zero or
   * jumping back to the parent's port-in time.
   */
  const lastPositionRef = useRef<{ manifestUrl: string; time: number } | null>(null);
  /** Manifest URL for which the parent-supplied initialSeekSeconds has already been consumed. */
  const initialSeekConsumedRef = useRef<string>('');

  const redact = (v: unknown) => {
    if (v == null) return '';
    const s = String(v);
    if (!s) return '';
    return s.length <= 16 ? `${s.slice(0, 4)}…(len:${s.length})` : `${s.slice(0, 8)}…${s.slice(-4)}(len:${s.length})`;
  };

  useImperativeHandle(ref, () => ({
    getVideoElement: () => videoRef.current,
    getWallClockMs: () => {
      const p: any = playerRef.current;
      if (!p || typeof p.getPlayheadTimeAsDate !== 'function') return null;
      try {
        const d = p.getPlayheadTimeAsDate();
        // Only DASH replays carry a real wall clock; HLS reports 1970-epoch garbage.
        if (d instanceof Date) {
          const ms = d.getTime();
          if (Number.isFinite(ms) && ms > 9.46e11) return ms; // after year 2000
        }
      } catch (_) {}
      return null;
    },
  }));

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const report = () => {
      const cb = intrinsicCbRef.current;
      if (!cb) return;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw > 0 && vh > 0) cb(vw, vh);
    };
    video.addEventListener('loadedmetadata', report);
    video.addEventListener('resize', report);
    report();
    return () => {
      video.removeEventListener('loadedmetadata', report);
      video.removeEventListener('resize', report);
    };
  }, [props.manifestUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let destroyed = false;
    let manifestFilter: ((type: any, response: any) => void) | null = null;
    const msg1001 = t('drm.error1001');
    const msg6001 = t('drm.error6001');
    const msg6007 = t('drm.error6007');
    const msg6012 = t('drm.error6012');
    const unknownErr = t('drm.errorUnknown');
    const browserErr = t('drm.browserNotSupported');
    const loadFailed = t('drm.loadFailed');
    const loadFailedFallback = t('drm.loadFailedFallback');
    const initFailed = t('drm.initFailed');

    async function init() {
      setReady(false);
      props.onError('');

      // Wait for any in-flight destroy of a previous Shaka instance to complete before creating
      // a new one. Prevents the "two players on the same <video>" race when manifest/headers
      // change in rapid succession (e.g. user reassigning a slot).
      try { await destroyChainRef.current; } catch (_) {}
      if (destroyed) return;

      shaka.polyfill.installAll();

      if (!shaka.Player.isBrowserSupported()) {
        props.onError(browserErr);
        return;
      }

      if (!video || !video.isConnected) return;
      const player = new shaka.Player();
      playerRef.current = player;

      await player.attach(video);
      if (destroyed) {
        // The cleanup callback fired while we were attaching; tear down immediately and exit.
        player.destroy().catch(() => {});
        return;
      }

      player.addEventListener('error', async (evt: any) => {
        const detail = evt?.detail;
        if (destroyed) return;
        if (detail?.code === 7002) return;
        const code = detail?.code;
        const fallback = safeErr(detail) || unknownErr;
        let msg =
          code === 1001 ? msg1001
          : code === 6001 ? msg6001
          : code === 6007 ? msg6007
          : code === 6012 ? msg6012
          : (detail?.message ? `Shaka: ${detail.message}` : `Shaka: ${fallback}`);
        if ((code === 1001 || code === 6001 || code === 6007) && typeof window.f1?.getLastLicenseError === 'function') {
          try {
            const sk = extractStreamKey(props.licenseUrl) ?? extractStreamKey(props.fallbackLicenseUrl);
            const f1Msg = await window.f1.getLastLicenseError(sk);
            if (f1Msg && typeof f1Msg === 'string' && f1Msg.trim()) msg = `F1 TV: ${f1Msg.trim()}`;
          } catch (_) {}
        }
        if (!destroyed) props.onError(msg);
      });

      const applyConfig = (licenseUrl: string) => {
        const hasWidevineLicense = Boolean(licenseUrl && licenseUrl.trim().length > 0);
        // Lower buffer when many streams (compact/embedded) to avoid all of them buffering heavily
        const streaming: Record<string, unknown> =
          props.compact
            ? { bufferingGoal: 10, rebufferingGoal: 3 }
            : { bufferingGoal: 20, rebufferingGoal: 6 };
        streaming.returnToEndOfLiveWindowWhenOutside = true;
        streaming.liveSync = { enabled: true, targetLatency: 4 };
        const config: any = { streaming };
        if (props.compact) {
          config.abr = { restrictions: { maxHeight: 720 } };
        }
        if (hasWidevineLicense) {
          config.drm = { servers: { 'com.widevine.alpha': licenseUrl } };
        }
        player.configure(config);
      };

      applyConfig(props.licenseUrl);

      const setLicenseHeaders = (headers?: Record<string, string>, stripManifestDrm = false) => {
        const net = player.getNetworkingEngine();
        if (!net) return;
        net.clearAllRequestFilters();
        if (manifestFilter) {
          (net as any).unregisterResponseFilter(manifestFilter);
          manifestFilter = null;
        }
        if (typeof (net as any).clearAllResponseFilters === 'function') {
          // shaka v4+ supports this; safe-guard for older builds
          try { (net as any).clearAllResponseFilters(); } catch (_) {}
        }
        if (stripManifestDrm) {
          manifestFilter = (type: any, response: any) => {
            if (type === shaka.net.NetworkingEngine.RequestType.MANIFEST) {
              const text = new TextDecoder().decode(response.data);
              // Log ContentProtection blocks before stripping — may contain laURL/laurl
              const cpBlocks = text.match(/<ContentProtection[\s\S]*?(?:\/>|<\/ContentProtection>)/gi) ?? [];
              // eslint-disable-next-line no-console
              console.log('[manifest][ContentProtection blocks]', JSON.stringify(cpBlocks));
              const stripped = text.replace(/<ContentProtection[^>]*(?:\/>|>[\s\S]*?<\/ContentProtection>)/gi, '');
              response.data = new TextEncoder().encode(stripped).buffer;
            }
          };
          (net as any).registerResponseFilter(manifestFilter);
        }

        // Debug: log LICENSE requests/responses so we can see actual body sizes and URLs
        const debugResponseFilter = (type: any, response: any) => {
          if (type === shaka.net.NetworkingEngine.RequestType.LICENSE) {
            const bytes = response?.data ? (response.data.byteLength ?? 0) : 0;
            const ct = response?.headers?.['content-type'] || response?.headers?.['Content-Type'] || '';
            // eslint-disable-next-line no-console
            console.log('[shaka][LICENSE][resp]', { bytes, contentType: ct });
          }
        };
        try { (net as any).registerResponseFilter(debugResponseFilter); } catch (_) {}

        net.registerRequestFilter((type, request) => {
          if (type === shaka.net.NetworkingEngine.RequestType.LICENSE) {
            try {
              const uris = Array.isArray((request as any)?.uris) ? (request as any).uris : undefined;
              const method = (request as any)?.method;
              const body = (request as any)?.body;
              const bodyBytes =
                body instanceof ArrayBuffer ? body.byteLength
                : ArrayBuffer.isView(body) ? body.byteLength
                : (body?.byteLength ?? 0);
              const headerKeys = request?.headers ? Object.keys(request.headers).sort() : [];
              const headerSummary: Record<string, string> = {};
              if (request?.headers) {
                for (const [k, v] of Object.entries(request.headers)) {
                  const lk = k.toLowerCase();
                  if (lk.includes('token') || lk === 'authorization' || lk === 'cookie' || lk === 'customdata') headerSummary[k] = redact(v);
                }
              }
              // Electron often serializes args as "[object Object]" in the main log,
              // so log JSON to actually see uris/bodyBytes.
              // eslint-disable-next-line no-console
              console.log('[shaka][LICENSE][req]', JSON.stringify({
                method,
                uris,
                bodyBytes,
                headerKeys,
                headerSummary,
              }));
            } catch (_) {}
            if (headers) {
              for (const [k, v] of Object.entries(headers)) request.headers[k] = v;
            }
          }
        });
      };

      setLicenseHeaders(props.licenseHeaders, !Boolean(props.licenseUrl?.trim()));

      /**
       * Compute the start time to pass to player.load:
       *   1. Last captured position for THIS manifest (re-init from header change) — wins.
       *   2. Parent-supplied initialSeekSeconds, but only if not already consumed for this manifest.
       *   3. Otherwise undefined (start at default).
       */
      const computeStartTime = (manifestUrl: string): number | undefined => {
        if (propsRef.current.preferLiveEdge) return undefined;
        const lp = lastPositionRef.current;
        if (lp && lp.manifestUrl === manifestUrl && Number.isFinite(lp.time) && lp.time > 0) {
          return lp.time;
        }
        const seek = propsRef.current.initialSeekSeconds;
        if (
          initialSeekConsumedRef.current !== manifestUrl &&
          seek != null && Number.isFinite(seek) && seek > 0
        ) {
          return seek;
        }
        return undefined;
      };

      const finalizePlaybackStart = async () => {
        let playerIsLive = false;
        try { playerIsLive = typeof player.isLive === 'function' && player.isLive(); } catch (_) {}
        const isLive = propsRef.current.preferLiveEdge || playerIsLive || isLikelyLiveVideo(video);
        // eslint-disable-next-line no-console
        console.log('[shaka][load] finished', {
          preferLiveEdge: propsRef.current.preferLiveEdge,
          playerIsLive,
          isLikelyLive: isLikelyLiveVideo(video),
          duration: video.duration,
          currentTime: video.currentTime,
        });
        if (isLive) {
          await seekToLiveEdge(player, video);
          initialSeekConsumedRef.current = propsRef.current.manifestUrl;
        } else {
          applyInitialSeek();
        }
        try { if (video.paused) await video.play(); } catch (_) {}
      };

      const loadWith = async (manifestUrl: string, licenseUrl: string, headers?: Record<string, string>) => {
        applyConfig(licenseUrl);
        setLicenseHeaders(headers, !Boolean(licenseUrl?.trim()));
        const startTime = computeStartTime(manifestUrl);
        // Shaka's player.load(uri, startTime) honours startTime on the initial load — better than
        // seeking after-the-fact because the buffer fetches around the right segment immediately.
        const loadPromise = startTime != null ? player.load(manifestUrl, startTime) : player.load(manifestUrl);
        let timer: ReturnType<typeof setTimeout> | null = null;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            // Actually abort the load so background fetches stop and the player can be re-used.
            player.unload().catch(() => {});
            reject(new Error(t('ui.timeoutStream')));
          }, 15000);
        });
        try {
          await Promise.race([loadPromise, timeoutPromise]);
          if (startTime != null) initialSeekConsumedRef.current = manifestUrl;
        } finally {
          if (timer != null) clearTimeout(timer);
        }
      };

      const applyInitialSeek = () => {
        // Fallback path: if for some reason player.load didn't honour startTime (e.g. live edge
        // override, or initial load returned at zero) and we still have a target, seek manually.
        const target = computeStartTime(propsRef.current.manifestUrl);
        if (target == null) return;
        if (Math.abs(video.currentTime - target) < 0.5) return;
        try {
          const range = video.seekable;
          let clamped = target;
          if (range && range.length > 0) {
            const start = range.start(0);
            const end = range.end(range.length - 1);
            if (clamped < start) clamped = start;
            if (clamped > end) clamped = Math.max(start, end - 0.5);
          }
          video.currentTime = clamped;
        } catch (_) {}
      };

      try {
        await loadWith(props.manifestUrl, props.licenseUrl, props.licenseHeaders);
        if (!destroyed) {
          setReady(true);
          await finalizePlaybackStart();
        }
      } catch (e) {
        const code = (e as any)?.code;
        if (destroyed || code === 7002) return;
        if (code === 6001 && props.fallbackManifestUrl) {
          try {
            await loadWith(props.fallbackManifestUrl, props.fallbackLicenseUrl || '', props.fallbackLicenseHeaders);
            if (!destroyed) {
              setReady(true);
              props.onError('');
              await finalizePlaybackStart();
            }
            return;
          } catch (fallbackError) {
            const fc = (fallbackError as any)?.code;
            let msg = fc === 1001 ? msg1001 : fc === 6001 ? msg6001 : fc === 6007 ? msg6007 : fc === 6012 ? msg6012 : `${loadFailedFallback}: ${safeErr(fallbackError) || unknownErr}`;
            if ((fc === 1001 || fc === 6001 || fc === 6007) && typeof window.f1?.getLastLicenseError === 'function') {
              try {
                const sk = extractStreamKey(props.fallbackLicenseUrl) ?? extractStreamKey(props.licenseUrl);
                const f1Msg = await window.f1.getLastLicenseError(sk);
                if (f1Msg && typeof f1Msg === 'string' && f1Msg.trim()) msg = `F1 TV: ${f1Msg.trim()}`;
              } catch (_) {}
            }
            props.onError(msg);
            return;
          }
        }
        let errMsg = code === 1001 ? msg1001 : code === 6001 ? msg6001 : code === 6012 ? msg6012 : code === 6007 ? msg6007 : `${loadFailed}: ${safeErr(e) || unknownErr}`;
        if ((code === 1001 || code === 6001 || code === 6007) && typeof window.f1?.getLastLicenseError === 'function') {
          try {
            const sk = extractStreamKey(props.licenseUrl) ?? extractStreamKey(props.fallbackLicenseUrl);
            const f1Msg = await window.f1.getLastLicenseError(sk);
            if (f1Msg && typeof f1Msg === 'string' && f1Msg.trim()) errMsg = `F1 TV: ${f1Msg.trim()}`;
          } catch (_) {}
        }
        props.onError(errMsg);
      }
    }

    init().catch((e) => props.onError(`${initFailed}: ${safeErr(e) || unknownErr}`));

    const onCanPlay = () => {
      if (destroyed || !video) return;
      if (video.paused) {
        video.play().catch(() => {});
      }
    };
    video.addEventListener('canplay', onCanPlay);

    return () => {
      video.removeEventListener('canplay', onCanPlay);
      destroyed = true;
      // Capture the playback position so a re-init (header change, same manifest) can resume
      // here instead of replaying from the parent-supplied initialSeekSeconds (which would
      // throw away whatever the user has watched since the port-in).
      try {
        const url = propsRef.current.manifestUrl;
        if (video && url && Number.isFinite(video.currentTime) && video.currentTime > 0) {
          lastPositionRef.current = { manifestUrl: url, time: video.currentTime };
        }
      } catch (_) {}
      const p = playerRef.current;
      playerRef.current = null;
      if (p) {
        // Chain the destroy onto the previous one and expose it so the next init can await it.
        destroyChainRef.current = destroyChainRef.current
          .catch(() => {})
          .then(() => p.destroy().catch(() => {}));
      }
    };
  }, [
    t,
    props.manifestUrl,
    props.licenseUrl,
    props.fallbackManifestUrl,
    props.fallbackLicenseUrl,
    licenseHeadersHash,
    fallbackLicenseHeadersHash,
    props.preferLiveEdge,
  ]);

  const { compact } = props;
  return (
    <div className={compact ? 'h-full min-h-0 flex flex-col' : ''} style={compact ? {} : { display: 'grid', gap: 10 }}>
      <div
        ref={containerRef}
        className={`player-fs relative bg-black overflow-hidden ${compact ? 'flex-1 min-h-0 flex' : ''}`}
      >
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          onClick={() => { const v = videoRef.current; if (v) { if (v.paused) v.play().catch(() => {}); else v.pause(); } }}
          className={compact ? 'w-full flex-1 min-h-0 object-contain bg-black' : 'w-full bg-black'}
        />
        {ready && (
          <VideoControls
            getVideo={() => videoRef.current}
            getPlayer={() => playerRef.current}
            getContainer={() => containerRef.current}
            compact={compact}
            onUnmute={props.onAudioFocus}
          />
        )}
      </div>
      {!compact && (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="pill">
            shaka: <strong>{ready ? t('drm.ready') : t('drm.initializing')}</strong>
          </span>
          <span className="pill">drm: widevine</span>
        </div>
      )}
    </div>
  );
});
