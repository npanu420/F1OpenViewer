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
  /**
   * Emits decoded frame dimensions from the video element (videoWidth / videoHeight).
   * UI-only; does not affect Shaka configuration or playback.
   */
  onIntrinsicVideoSize?: (width: number, height: number) => void;
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
  const intrinsicCbRef = useRef(props.onIntrinsicVideoSize);
  intrinsicCbRef.current = props.onIntrinsicVideoSize;

  const redact = (v: unknown) => {
    if (v == null) return '';
    const s = String(v);
    if (!s) return '';
    return s.length <= 16 ? `${s.slice(0, 4)}…(len:${s.length})` : `${s.slice(0, 8)}…${s.slice(-4)}(len:${s.length})`;
  };

  useImperativeHandle(ref, () => ({
    getVideoElement: () => videoRef.current,
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
        // Lower buffer when many streams (compact/embedded) to avoid all of them buffering heavily
        const streaming =
          props.compact
            ? { bufferingGoal: 10, rebufferingGoal: 3 }
            : { bufferingGoal: 20, rebufferingGoal: 6 };
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
              // Electron spesso serializza gli argomenti come "[object Object]" nel main log:
              // logghiamo JSON per vedere davvero uris/bodyBytes.
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

      const loadWith = async (manifestUrl: string, licenseUrl: string, headers?: Record<string, string>) => {
        applyConfig(licenseUrl);
        setLicenseHeaders(headers, !Boolean(licenseUrl?.trim()));
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
        playsInline
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
