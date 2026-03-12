/**
 * Renderer della finestra player: riceve il payload via IPC (player:load) e avvia Shaka con DRM.
 * Logica allineata a ShakaVideo.tsx (init, config DRM, load, fallback su 6001).
 */
(function () {
  const MSG_6001 =
    'DRM Widevine non disponibile. Installa Chrome o imposta ELECTRON_WIDEVINE_CDM_PATH/VERSION nel .env.';
  const MSG_6007 =
    'Licenza DRM rifiutata (403). Prova "Accedi con browser" e riprova, oppure guarda su f1tv.formula1.com.';
  const MSG_6012 = 'URL licenza DRM non disponibile per questo contenuto.';

  function setStatus(text, isError) {
    const el = document.getElementById('status');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'status' + (isError ? ' error' : text ? ' ready' : '');
  }

  function safeErr(e) {
    if (e instanceof Error) return e.message;
    if (typeof e === 'string') return e;
    try {
      return JSON.stringify(e);
    } catch (_) {
      return 'Errore sconosciuto';
    }
  }

  function getMessageForCode(code) {
    if (code === 6001) return MSG_6001;
    if (code === 6007) return MSG_6007;
    if (code === 6012) return MSG_6012;
    return null;
  }

  if (typeof shaka === 'undefined') {
    setStatus('Shaka Player non caricato.', true);
    return;
  }

  const video = document.getElementById('video');
  if (!video) {
    setStatus('Elemento video non trovato.', true);
    return;
  }

  let player = null;

  window.playerIpc.on('player:load', async function (payload) {
    if (!payload || !payload.manifestUrl) {
      setStatus('Payload non valido (manca manifestUrl).', true);
      if (window.playerIpc && window.playerIpc.send) {
        window.playerIpc.send('player:error', 'Payload non valido');
      }
      return;
    }

    setStatus('Preparazione stream…', false);

    shaka.polyfill.installAll();

    if (!shaka.Player.isBrowserSupported()) {
      setStatus('Shaka: browser non supportato.', true);
      if (window.playerIpc && window.playerIpc.send) {
        window.playerIpc.send('player:error', 'Browser non supportato');
      }
      return;
    }

    if (player) {
      try {
        await player.destroy();
      } catch (_) {}
      player = null;
    }

    player = new shaka.Player();
    await player.attach(video);

    player.addEventListener('error', function (evt) {
      const detail = evt && evt.detail;
      if (detail && detail.code === 7002) return;
      const code = detail && detail.code;
      const msg =
        getMessageForCode(code) ||
        (detail && detail.message ? 'Shaka: ' + detail.message : 'Shaka: ' + safeErr(detail));
      setStatus(msg, true);
      if (window.playerIpc && window.playerIpc.send) {
        window.playerIpc.send('player:error', msg);
      }
    });

    function applyConfig(licenseUrl) {
      const hasWidevineLicense = Boolean(licenseUrl && licenseUrl.trim().length > 0);
      const config = {
        streaming: {
          bufferingGoal: 30,
          rebufferingGoal: 10,
        },
      };
      if (hasWidevineLicense) {
        config.drm = {
          servers: { 'com.widevine.alpha': licenseUrl },
        };
      }
      player.configure(config);
    }

    function setLicenseHeaders(headers) {
      const net = player.getNetworkingEngine();
      if (!net) return;
      net.clearAllRequestFilters();
      net.registerRequestFilter(function (type, request) {
        if (type === shaka.net.NetworkingEngine.RequestType.LICENSE && headers) {
          for (const k in headers) {
            if (Object.prototype.hasOwnProperty.call(headers, k)) {
              request.headers[k] = headers[k];
            }
          }
        }
      });
    }

    async function loadWith(manifestUrl, licenseUrl, headers) {
      applyConfig(licenseUrl);
      setLicenseHeaders(headers || undefined);
      const loadPromise = player.load(manifestUrl);
      const timeoutPromise = new Promise(function (_, reject) {
        setTimeout(function () {
          reject(new Error('Timeout caricamento stream (15s)'));
        }, 15000);
      });
      await Promise.race([loadPromise, timeoutPromise]);
    }

    const manifestUrl = payload.manifestUrl;
    const licenseUrl = payload.licenseUrl || '';
    const licenseHeaders = payload.licenseHeaders || undefined;
    const fallbackManifestUrl = payload.fallbackManifestUrl;
    const fallbackLicenseUrl = payload.fallbackLicenseUrl || '';
    const fallbackLicenseHeaders = payload.fallbackLicenseHeaders || undefined;

    try {
      await loadWith(manifestUrl, licenseUrl, licenseHeaders);
      setStatus('Riproduzione in corso.', false);
      if (window.playerIpc && window.playerIpc.send) {
        window.playerIpc.send('player:ready');
      }
      try {
        await video.play();
      } catch (_) {}
    } catch (e) {
      const code = e && e.code;
      if (code === 6001 && fallbackManifestUrl) {
        try {
          await loadWith(fallbackManifestUrl, fallbackLicenseUrl, fallbackLicenseHeaders);
          setStatus('Riproduzione in corso (fallback).', false);
          if (window.playerIpc && window.playerIpc.send) {
            window.playerIpc.send('player:ready');
          }
          try {
            await video.play();
          } catch (_) {}
          return;
        } catch (fallbackError) {
          const fc = fallbackError && fallbackError.code;
          const msg =
            getMessageForCode(fc) ||
            'Load fallito (primary + fallback): ' + safeErr(fallbackError);
          setStatus(msg, true);
          if (window.playerIpc && window.playerIpc.send) {
            window.playerIpc.send('player:error', msg);
          }
          return;
        }
      }
      const errMsg =
        getMessageForCode(code) || 'Load fallito: ' + safeErr(e);
      setStatus(errMsg, true);
      if (window.playerIpc && window.playerIpc.send) {
        window.playerIpc.send('player:error', errMsg);
      }
    }
  });
})();
