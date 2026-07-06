import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ShakaVideo, type ShakaVideoHandle } from '../widgets/ShakaVideo';
import { resolvePlayback, type PlaybackInfo } from '../../services/entitlement';
import { session } from '../../services/session';
import { getContentVideoStreams } from '../../services/vod';
import { useLocale } from '../../i18n/LocaleContext';
import type { CatalogItem } from '../../domain/catalog';

/**
 * Standalone single-stream player window (frameless). Opened by the main process via
 * `#standalone-player?content=..&channel=..&title=..`. The window content is only the
 * video: main process locks window aspect ratio to the stream's intrinsic dimensions.
 */
type Props = {
  contentId: number;
  channelId?: number;
  title?: string;
};

function reportVideoSize(w: number, h: number) {
  if (w > 0 && h > 0) window.f1?.reportIntrinsicVideoSize?.(w, h);
}

type ChannelOption = { channelId?: number; label: string };

export function StandalonePlayerView({ contentId, channelId, title }: Props) {
  const { t } = useLocale();
  const [playback, setPlayback] = useState<PlaybackInfo | null>(null);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState('');
  const [accessToken, setAccessToken] = useState<string | undefined>(undefined);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [switchSubmenuOpen, setSwitchSubmenuOpen] = useState(false);
  const shakaRef = useRef<ShakaVideoHandle | null>(null);

  // Camera/channel currently playing — switchable at runtime without closing the window.
  // `contentId` (the session) never changes; only the channel does.
  const [activeChannelId, setActiveChannelId] = useState<number | undefined>(channelId);
  const [activeTitle, setActiveTitle] = useState(title);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [channelOptions, setChannelOptions] = useState<ChannelOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    getContentVideoStreams(contentId).then((streams) => {
      if (cancelled) return;
      const opts: ChannelOption[] = [];
      opts.push({ channelId: streams.mainChannel?.channelId, label: t('player.mainFeed') });
      for (const ob of streams.onboard) {
        opts.push({ channelId: ob.channelId, label: ob.title || ob.driverName || `#${ob.racingNumber ?? ''}` });
      }
      for (const dc of streams.dataChannel) {
        opts.push({ channelId: dc.channelId, label: dc.title || t('player.dataChannel') });
      }
      setChannelOptions(opts);
    });
    return () => { cancelled = true; };
  }, [contentId, t]);

  useEffect(() => {
    document.documentElement.classList.add('standalone-player');
    return () => document.documentElement.classList.remove('standalone-player');
  }, []);

  useEffect(() => {
    document.title = `F1 OpenViewer — ${activeTitle || contentId}`;
  }, [activeTitle, contentId]);

  useEffect(() => {
    session.get().then((s) => setAccessToken(s.accessToken));
  }, []);

  // Main process is about to destroy this window: unmount the player first so Shaka/EME
  // tears down cleanly instead of getting killed mid-playback (native crash otherwise).
  useEffect(() => {
    return window.f1?.onPlayerTeardownRequest?.(() => setClosing(true));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError('');
    const item: CatalogItem = {
      id: `window-${contentId}-${activeChannelId ?? 0}`,
      title: activeTitle || '',
      kind: 'replay',
      contentId,
      channelId: activeChannelId,
    };
    // A fresh resolvePlayback() carries a freshly-tokenized manifest URL, so this also
    // doubles as "reload": ShakaVideo reinits whenever manifestUrl actually changes value.
    resolvePlayback(item)
      .then((info) => { if (!cancelled) setPlayback(info); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [contentId, activeChannelId, activeTitle, reloadNonce]);

  const reloadStream = useCallback(() => setReloadNonce((n) => n + 1), []);
  const switchChannel = useCallback((opt: ChannelOption) => {
    setActiveChannelId(opt.channelId);
    setActiveTitle(opt.label);
    setPlayback(null);
  }, []);

  // Unmute in dedicated window + keep reporting intrinsic size until stable (DRM can delay metadata).
  useEffect(() => {
    if (!playback) return;
    let lastW = 0;
    let lastH = 0;
    const tick = () => {
      const v = shakaRef.current?.getVideoElement();
      if (!v) return;
      v.muted = false;
      if (v.volume === 0) v.volume = 1;
      if (v.videoWidth > 0 && v.videoHeight > 0) {
        if (v.videoWidth !== lastW || v.videoHeight !== lastH) {
          lastW = v.videoWidth;
          lastH = v.videoHeight;
          reportVideoSize(lastW, lastH);
        }
      }
    };
    const iv = setInterval(tick, 350);
    tick();
    return () => clearInterval(iv);
  }, [playback]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }, []);

  useEffect(() => {
    if (!menu) return;
    const dismiss = () => { setMenu(null); setSwitchSubmenuOpen(false); };
    window.addEventListener('mousedown', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      window.removeEventListener('mousedown', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [menu]);

  return (
    <div className="standalone-player-root" onContextMenu={onContextMenu}>
      {error && (
        <div className="absolute inset-x-0 top-0 z-30 px-4 py-2 bg-destructive/80 text-white text-sm font-heading" role="alert">
          {error}
        </div>
      )}

      {!playback && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-white/60 text-sm font-heading">
          {t('dashboard.loadingStream')}
        </div>
      )}

      {playback && !closing && (
        <ShakaVideo
          ref={shakaRef}
          manifestUrl={playback.manifestUrl}
          licenseUrl={playback.licenseUrl}
          licenseHeaders={playback.licenseHeaders}
          fallbackManifestUrl={playback.fallbackManifestUrl}
          fallbackLicenseUrl={playback.fallbackLicenseUrl}
          fallbackLicenseHeaders={playback.fallbackLicenseHeaders}
          accessToken={accessToken}
          onError={setError}
          onIntrinsicVideoSize={reportVideoSize}
          fill
        />
      )}

      {/* Overlay drag handle — zero layout impact. */}
      <div className="standalone-player-drag" aria-hidden />

      {menu && (
        <div
          className="fixed z-50 min-w-[170px] rounded-md bg-black/95 border border-white/10 shadow-xl py-1 text-[13px] text-white/90"
          style={{
            left: Math.min(menu.x, window.innerWidth - 180),
            top: Math.min(menu.y, window.innerHeight - 120),
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 hover:bg-white/10 transition-colors"
            onClick={() => { reloadStream(); setMenu(null); }}
          >
            {t('dashboard.reloadStream')}
          </button>

          {channelOptions.length > 0 && (
            <div
              className="relative"
              onMouseEnter={() => setSwitchSubmenuOpen(true)}
              onMouseLeave={() => setSwitchSubmenuOpen(false)}
            >
              <div className="w-full text-left px-3 py-1.5 hover:bg-white/10 transition-colors flex items-center justify-between">
                <span>{t('player.switchStream')}</span>
                <span aria-hidden>›</span>
              </div>
              {switchSubmenuOpen && (
                <div
                  className="absolute left-full top-0 ml-0.5 min-w-[160px] max-h-[70vh] overflow-y-auto rounded-md bg-black/95 border border-white/10 shadow-xl py-1"
                >
                  {channelOptions.map((opt, idx) => (
                    <button
                      key={`${opt.channelId ?? 'main'}-${idx}`}
                      type="button"
                      className={`w-full text-left px-3 py-1.5 hover:bg-white/10 transition-colors ${opt.channelId === activeChannelId ? 'text-primary' : ''}`}
                      onClick={() => { switchChannel(opt); setMenu(null); setSwitchSubmenuOpen(false); }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="border-t border-white/10 my-1" />

          <button
            type="button"
            className="w-full text-left px-3 py-1.5 hover:bg-white/10 transition-colors"
            onClick={() => window.close()}
          >
            {t('player.closeWindow')}
          </button>
        </div>
      )}
    </div>
  );
}
