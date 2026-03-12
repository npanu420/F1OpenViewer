/**
 * Player window renderer: receives payload via IPC (player:load) and starts Shaka with DRM.
 * Logic aligned with ShakaVideo.tsx (init, DRM config, load, fallback on 6001).
 */
(function () {
  const MSG_6001 =
    'DRM Widevine not available. Install Chrome or set ELECTRON_WIDEVINE_CDM_PATH/VERSION in .env.';
  const MSG_6007 =
    'DRM license rejected (403). Try "Sign in with browser" and retry, or watch on f1tv.formula1.com.';
  const MSG_6012 = 'DRM license URL not available for this content.';

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
      return 'Unknown error';
    }
  }

  function getMessageForCode(code) {
    if (code === 6001) return MSG_6001;
    if (code === 6007) return MSG_6007;
    if (code === 6012) return MSG_6012;
    return null;
  }

  if (typeof shaka === 'undefined') {
    setStatus('Shaka Player not loaded.', true);
    return;
  }

  const video = document.getElementById('video');
  if (!video) {
    setStatus('Video element not found.', true);
    return;
  }

  let player = null;

  window.playerIpc.on('player:load', async function (payload) {
    if (!payload || !payload.manifestUrl) {
      setStatus('Invalid payload (missing manifestUrl).', true);
      if (window.playerIpc && window.playerIpc.send) {
        window.playerIpc.send('player:error', 'Invalid payload');
      }
      return;
    }

    setStatus('Preparing stream…', false);

    shaka.polyfill.installAll();

    if (!shaka.Player.isBrowserSupported()) {
      setStatus('Shaka: browser not supported.', true);
      if (window.playerIpc && window.playerIpc.send) {
        window.playerIpc.send('player:error', 'Browser not supported');
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

    player.addEventListener('error', async function (evt) {
      const detail = evt && evt.detail;
      if (detail && detail.code === 7002) return;
      const code = detail && detail.code;
      let msg =
        getMessageForCode(code) ||
        (detail && detail.message ? 'Shaka: ' + detail.message : 'Shaka: ' + safeErr(detail));
      if (code === 6007 && window.playerIpc && typeof window.playerIpc.getLastLicenseError === 'function') {
        try {
          const f1Msg = await window.playerIpc.getLastLicenseError();
          if (f1Msg && typeof f1Msg === 'string' && f1Msg.trim()) {
            msg = 'F1 TV: ' + f1Msg.trim();
          }
        } catch (_) {}
      }
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
          reject(new Error('Stream load timeout (15s)'));
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
      setStatus('Playing.', false);
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
          setStatus('Playing (fallback).', false);
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
            'Load failed (primary + fallback): ' + safeErr(fallbackError);
          setStatus(msg, true);
          if (window.playerIpc && window.playerIpc.send) {
            window.playerIpc.send('player:error', msg);
          }
          return;
        }
      }
      const errMsg =
        getMessageForCode(code) || 'Load failed: ' + safeErr(e);
      setStatus(errMsg, true);
      if (window.playerIpc && window.playerIpc.send) {
        window.playerIpc.send('player:error', errMsg);
      }
    }
  });
})();
