import React, { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import shaka from 'shaka-player/dist/shaka-player.ui';
import { useLocale } from '../../i18n/LocaleContext';

export type ShakaVideoHandle = {
  /** Returns the underlying HTMLVideoElement (or null) */
  getVideoElement: () => HTMLVideoElement | null;
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
};

function safeErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try { return JSON.stringify(e); } catch { return ''; }
}

export const ShakaVideo = forwardRef<ShakaVideoHandle, Props>(function ShakaVideo(props, ref) {
  const { t } = useLocale();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<shaka.Player | null>(null);
  const [ready, setReady] = useState(false);

  useImperativeHandle(ref, () => ({
    getVideoElement: () => videoRef.current,
  }));

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let destroyed = false;
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

      shaka.polyfill.installAll();

      if (!shaka.Player.isBrowserSupported()) {
        props.onError(browserErr);
        return;
      }

      if (!video || !video.isConnected) return;
      const player = new shaka.Player();
      playerRef.current = player;

      await player.attach(video);

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
            const f1Msg = await window.f1.getLastLicenseError();
            if (f1Msg && typeof f1Msg === 'string' && f1Msg.trim()) msg = `F1 TV: ${f1Msg.trim()}`;
          } catch (_) {}
        }
        if (!destroyed) props.onError(msg);
      });

      const applyConfig = (licenseUrl: string) => {
        const hasWidevineLicense = Boolean(licenseUrl && licenseUrl.trim().length > 0);
        const config: any = {
          streaming: { bufferingGoal: 30, rebufferingGoal: 10 },
        };
        if (hasWidevineLicense) {
          config.drm = { servers: { 'com.widevine.alpha': licenseUrl } };
        }
        player.configure(config);
      };

      applyConfig(props.licenseUrl);

      const setLicenseHeaders = (headers?: Record<string, string>) => {
        const net = player.getNetworkingEngine();
        if (!net) return;
        net.clearAllRequestFilters();
        net.registerRequestFilter((type, request) => {
          if (type === shaka.net.NetworkingEngine.RequestType.LICENSE) {
            if (headers) {
              for (const [k, v] of Object.entries(headers)) request.headers[k] = v;
            }
            if (props.accessToken && !request.headers.Authorization) {
              request.headers.Authorization = `Bearer ${props.accessToken}`;
            }
          }
        });
      };

      setLicenseHeaders(props.licenseHeaders);

      const loadWith = async (manifestUrl: string, licenseUrl: string, headers?: Record<string, string>) => {
        applyConfig(licenseUrl);
        setLicenseHeaders(headers);
        const loadPromise = player.load(manifestUrl);
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error(t('ui.timeoutStream'))), 15000);
        });
        await Promise.race([loadPromise, timeoutPromise]);
      };

      try {
        await loadWith(props.manifestUrl, props.licenseUrl, props.licenseHeaders);
        if (!destroyed) {
          setReady(true);
          try { await video.play(); } catch (_) {}
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
              try { await video.play(); } catch (_) {}
            }
            return;
          } catch (fallbackError) {
            const fc = (fallbackError as any)?.code;
            let msg = fc === 1001 ? msg1001 : fc === 6001 ? msg6001 : fc === 6007 ? msg6007 : fc === 6012 ? msg6012 : `${loadFailedFallback}: ${safeErr(fallbackError) || unknownErr}`;
            if ((fc === 1001 || fc === 6001 || fc === 6007) && typeof window.f1?.getLastLicenseError === 'function') {
              try {
                const f1Msg = await window.f1.getLastLicenseError();
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
            const f1Msg = await window.f1.getLastLicenseError();
            if (f1Msg && typeof f1Msg === 'string' && f1Msg.trim()) errMsg = `F1 TV: ${f1Msg.trim()}`;
          } catch (_) {}
        }
        props.onError(errMsg);
      }
    }

    init().catch((e) => props.onError(`${initFailed}: ${safeErr(e) || unknownErr}`));

    return () => {
      destroyed = true;
      const p = playerRef.current;
      playerRef.current = null;
      if (p) p.destroy().catch(() => {});
    };
  }, [
    t,
    props.manifestUrl,
    props.licenseUrl,
    props.accessToken,
    props.fallbackManifestUrl,
    props.fallbackLicenseUrl,
    JSON.stringify(props.licenseHeaders),
    JSON.stringify(props.fallbackLicenseHeaders),
  ]);

  const { compact } = props;
  return (
    <div className={compact ? 'h-full min-h-0 flex flex-col' : ''} style={compact ? {} : { display: 'grid', gap: 10 }}>
      <video
        ref={videoRef}
        controls
        autoPlay
        muted
        className={compact ? 'w-full flex-1 min-h-0 object-contain bg-black' : ''}
      />
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
