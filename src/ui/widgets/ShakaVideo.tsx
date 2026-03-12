import React, { useEffect, useRef, useState } from 'react';
import shaka from 'shaka-player/dist/shaka-player.ui';

type Props = {
  manifestUrl: string;
  licenseUrl: string;
  accessToken?: string;
  licenseHeaders?: Record<string, string>;
  fallbackManifestUrl?: string;
  fallbackLicenseUrl?: string;
  fallbackLicenseHeaders?: Record<string, string>;
  onError: (msg: string) => void;
};

function safeErr(e: unknown) {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return 'Errore sconosciuto';
  }
}

/** Messaggio chiaro per errore 6001 (Widevine non disponibile in Electron). */
const MSG_6001 =
  'DRM Widevine non disponibile su questo sistema. Contenuti protetti (es. 2026) non possono essere riprodotti. ' +
  'Soluzioni: 1) Installa Google Chrome (il CDM viene rilevato automaticamente). ' +
  '2) Imposta ELECTRON_WIDEVINE_CDM_PATH e ELECTRON_WIDEVINE_CDM_VERSION nel file .env. ' +
  '3) App come MultiViewer usano Electron castLabs per Widevine integrato.';

/** Messaggio per 6007 (richiesta licenza DRM fallita). */
const MSG_6007 =
  'Licenza DRM rifiutata dal server (errore 403 / ACN_5002). Il fornitore Widevine di F1 TV può rifiutare client non certificati (VMP). Prova: 1) Accedi con «Accedi con browser» e riprova. 2) Se persiste, guarda questo contenuto su f1tv.formula1.com nel browser.';

/** Messaggio per 6012 (nessun server licenze configurato). */
const MSG_6012 =
  'URL licenza DRM non disponibile per questo contenuto. L’API F1 non ha restituito laURL e non è stato trovato nel manifest.';

export function ShakaVideo(props: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<shaka.Player | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let destroyed = false;

    async function init() {
      setReady(false);
      props.onError('');

      shaka.polyfill.installAll();

      if (!shaka.Player.isBrowserSupported()) {
        props.onError('Shaka: browser non supportato.');
        return;
      }

      if (!video || !video.isConnected) return;
      const player = new shaka.Player();
      playerRef.current = player;

      await player.attach(video);

      player.addEventListener('error', (evt: any) => {
        const detail = evt?.detail;
        if (destroyed) return;
        if (detail?.code === 7002) return;
        const code = detail?.code;
        const msg =
          code === 6001 ? MSG_6001
          : code === 6007 ? MSG_6007
          : code === 6012 ? MSG_6012
          : (detail?.message ? `Shaka: ${detail.message}` : `Shaka: ${safeErr(detail)}`);
        props.onError(msg);
      });

      const applyConfig = (licenseUrl: string) => {
        const hasWidevineLicense = Boolean(licenseUrl && licenseUrl.trim().length > 0);
        const config: any = {
          streaming: {
            bufferingGoal: 30,
            rebufferingGoal: 10,
          },
        };
        // Config DRM solo quando la licenza esiste davvero.
        if (hasWidevineLicense) {
          config.drm = {
            servers: { 'com.widevine.alpha': licenseUrl },
          };
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
              for (const [k, v] of Object.entries(headers)) {
                request.headers[k] = v;
              }
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
          setTimeout(() => reject(new Error('Timeout caricamento stream (15s)')), 15000);
        });
        await Promise.race([loadPromise, timeoutPromise]);
      };

      try {
        await loadWith(props.manifestUrl, props.licenseUrl, props.licenseHeaders);
        if (!destroyed) {
          setReady(true);
          try {
            await video.play();
          } catch (_) {}
        }
      } catch (e) {
        const code = (e as any)?.code;
        if (destroyed || code === 7002) return;
        // 6001: key-system config unavailable. Prova fallback stream profile.
        if (code === 6001 && props.fallbackManifestUrl) {
          try {
            await loadWith(
              props.fallbackManifestUrl,
              props.fallbackLicenseUrl || '',
              props.fallbackLicenseHeaders
            );
            if (!destroyed) {
              setReady(true);
              props.onError('');
              try {
                await video.play();
              } catch (_) {}
            }
            return;
          } catch (fallbackError) {
            const fc = (fallbackError as any)?.code;
            props.onError(fc === 6001 ? MSG_6001 : fc === 6007 ? MSG_6007 : fc === 6012 ? MSG_6012 : `Load fallito (primary + fallback): ${safeErr(fallbackError)}`);
            return;
          }
        }
        const errMsg = code === 6001 ? MSG_6001 : code === 6012 ? MSG_6012 : code === 6007 ? MSG_6007 : `Load fallito: ${safeErr(e)}`;
        props.onError(errMsg);
      }
    }

    init().catch((e) => props.onError(`Init fallita: ${safeErr(e)}`));

    return () => {
      destroyed = true;
      const p = playerRef.current;
      playerRef.current = null;
      if (p) {
        p.destroy().catch(() => {});
      }
    };
  }, [
    props.manifestUrl,
    props.licenseUrl,
    props.accessToken,
    props.fallbackManifestUrl,
    props.fallbackLicenseUrl,
    JSON.stringify(props.licenseHeaders),
    JSON.stringify(props.fallbackLicenseHeaders),
  ]);

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <video ref={videoRef} controls autoPlay />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="pill">
          shaka: <strong>{ready ? 'pronto' : 'inizializzazione'}</strong>
        </span>
        <span className="pill">drm: widevine</span>
      </div>
    </div>
  );
}

