/**
 * Player window renderer: receives payload via IPC (player:load) and starts Shaka with DRM.
 * Logic aligned with ShakaVideo.tsx (init, DRM config, load, fallback on 6001).
 */
(function () {
  const MSG_1001 =
    'Request failed (e.g. bad HTTP status 403). Content may be unavailable in your region or subscription.';
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

  function redact(v) {
    if (v == null) return '';
    const s = String(v);
    if (!s) return '';
    return s.length <= 16 ? `${s.slice(0, 4)}…(len:${s.length})` : `${s.slice(0, 8)}…${s.slice(-4)}(len:${s.length})`;
  }

  function getMessageForCode(code) {
    if (code === 1001) return MSG_1001;
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

  function reportVideoIntrinsicSize() {
    var w = video.videoWidth;
    var h = video.videoHeight;
    if (w > 0 && h > 0 && window.playerIpc && window.playerIpc.send) {
      window.playerIpc.send('player:intrinsicVideoSize', w, h);
    }
  }
  video.addEventListener('loadedmetadata', reportVideoIntrinsicSize);
  video.addEventListener('resize', reportVideoIntrinsicSize);

  window.playerIpc.on('player:load', async function (payload) {
    if (!payload || !payload.manifestUrl) {
      setStatus('Invalid payload (missing manifestUrl).', true);
      if (window.playerIpc && window.playerIpc.send) {
        window.playerIpc.send('player:error', 'Invalid payload');
      }
      return;
    }

    if (window.playerIpc && window.playerIpc.send) {
      window.playerIpc.send('player:resetAspect');
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
      if ((code === 1001 || code === 6001 || code === 6007) && window.playerIpc && typeof window.playerIpc.getLastLicenseError === 'function') {
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
          bufferingGoal: 20,
          rebufferingGoal: 6,
          returnToEndOfLiveWindowWhenOutside: true,
          liveSync: { enabled: true, targetLatency: 4 },
        },
      };
      if (hasWidevineLicense) {
        config.drm = {
          servers: { 'com.widevine.alpha': licenseUrl },
        };
      }
      player.configure(config);
    }

    function isLikelyLiveVideo() {
      var d = video.duration;
      if (!Number.isFinite(d)) return true;
      return d > 60 * 60 * 24;
    }

    function sleep(ms) {
      return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    var LIVE_EDGE_OFFSET = 6;

    async function seekToLiveEdge() {
      var deadline = Date.now() + 10000;
      var lastTime = -1;
      var stableProgressTicks = 0;

      while (Date.now() < deadline) {
        var isLive = false;
        var range = null;
        try { isLive = typeof player.isLive === 'function' && player.isLive(); } catch (_) {}
        try {
          var r = typeof player.seekRange === 'function' ? player.seekRange() : null;
          if (r && Number.isFinite(r.end)) range = r;
        } catch (_) {}

        var seekableEnd = null;
        var seekableStart = null;
        try {
          var s = video.seekable;
          if (s && s.length > 0) {
            seekableStart = s.start(0);
            seekableEnd = s.end(s.length - 1);
          }
        } catch (_) {}

        console.log('[shaka][live] edge attempt', JSON.stringify({
          isLive: isLive,
          range: range,
          seekableStart: seekableStart,
          seekableEnd: seekableEnd,
          duration: video.duration,
          currentTime: video.currentTime,
          paused: video.paused,
          readyState: video.readyState,
        }));

        var edge = range && range.end > range.start ? range.end : (seekableEnd != null ? seekableEnd : null);
        var start = range ? range.start : (seekableStart != null ? seekableStart : 0);

        if (edge != null) {
          var target = Math.max(start, edge - LIVE_EDGE_OFFSET);
          if (!Number.isFinite(video.currentTime) || Math.abs(video.currentTime - edge) > LIVE_EDGE_OFFSET * 3) {
            try {
              if (typeof player.goToLive === 'function' && isLive) player.goToLive();
              video.currentTime = target;
            } catch (_) {}
          }
          try { if (video.paused) await video.play(); } catch (_) {}
        }

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

    var _manifestFilter = null;
    function setLicenseHeaders(headers, stripManifestDrm) {
      var net = player.getNetworkingEngine();
      if (!net) return;
      net.clearAllRequestFilters();
      if (typeof net.clearAllResponseFilters === 'function') {
        try { net.clearAllResponseFilters(); } catch (_) {}
      }
      if (_manifestFilter && typeof net.unregisterResponseFilter === 'function') {
        net.unregisterResponseFilter(_manifestFilter);
        _manifestFilter = null;
      }
      if (stripManifestDrm) {
        _manifestFilter = function (type, response) {
          if (type === shaka.net.NetworkingEngine.RequestType.MANIFEST) {
            var text = new TextDecoder().decode(response.data);
            // Log ContentProtection blocks before stripping — may contain laURL/laurl
            var cpBlocks = text.match(/<ContentProtection[\s\S]*?(?:\/>|<\/ContentProtection>)/gi) || [];
            console.log('[manifest][ContentProtection blocks]', JSON.stringify(cpBlocks));
            var stripped = text.replace(/<ContentProtection[^>]*(?:\/>|>[\s\S]*?<\/ContentProtection>)/gi, '');
            response.data = new TextEncoder().encode(stripped).buffer;
          }
        };
        if (typeof net.registerResponseFilter === 'function') {
          net.registerResponseFilter(_manifestFilter);
        }
      }

      if (typeof net.registerResponseFilter === 'function') {
        net.registerResponseFilter(function (type, response) {
          if (type === shaka.net.NetworkingEngine.RequestType.LICENSE) {
            try {
              var bytes = response && response.data ? (response.data.byteLength || 0) : 0;
              var ct = (response && response.headers && (response.headers['content-type'] || response.headers['Content-Type'])) || '';
              console.log('[shaka][LICENSE][resp]', { bytes: bytes, contentType: ct });
            } catch (_) {}
          }
        });
      }
      net.registerRequestFilter(function (type, request) {
        if (type === shaka.net.NetworkingEngine.RequestType.LICENSE) {
          try {
            var uris = request && Array.isArray(request.uris) ? request.uris : undefined;
            var method = request && request.method;
            var body = request && request.body;
            var bodyBytes = 0;
            if (body && body.byteLength != null) bodyBytes = body.byteLength;
            var headerKeys = request && request.headers ? Object.keys(request.headers).sort() : [];
            var headerSummary = {};
            if (request && request.headers) {
              for (const hk in request.headers) {
                if (!Object.prototype.hasOwnProperty.call(request.headers, hk)) continue;
                const lk = String(hk).toLowerCase();
                if (lk.includes('token') || lk === 'authorization' || lk === 'cookie' || lk === 'customdata') {
                  headerSummary[hk] = redact(request.headers[hk]);
                }
              }
            }
            // Log JSON string to avoid "[object Object]" in Electron console forwarding.
            console.log('[shaka][LICENSE][req]', JSON.stringify({ method: method, uris: uris, bodyBytes: bodyBytes, headerKeys: headerKeys, headerSummary: headerSummary }));
          } catch (_) {}
          if (headers) {
            for (const k in headers) {
              if (Object.prototype.hasOwnProperty.call(headers, k)) {
                request.headers[k] = headers[k];
              }
            }
          }
        }
      });
    }

    async function loadWith(manifestUrl, licenseUrl, headers) {
      applyConfig(licenseUrl);
      var hasLicense = Boolean(licenseUrl && licenseUrl.trim().length > 0);
      setLicenseHeaders(headers || undefined, !hasLicense);
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
      if (payload.preferLiveEdge || (typeof player.isLive === 'function' && player.isLive()) || isLikelyLiveVideo()) {
        await seekToLiveEdge();
      }
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
          if (payload.preferLiveEdge || (typeof player.isLive === 'function' && player.isLive()) || isLikelyLiveVideo()) {
            await seekToLiveEdge();
          }
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
          let msg =
            getMessageForCode(fc) ||
            'Load failed (primary + fallback): ' + safeErr(fallbackError);
          if ((fc === 1001 || fc === 6001 || fc === 6007) && window.playerIpc && typeof window.playerIpc.getLastLicenseError === 'function') {
            try {
              const f1Msg = await window.playerIpc.getLastLicenseError();
              if (f1Msg && typeof f1Msg === 'string' && f1Msg.trim()) msg = 'F1 TV: ' + f1Msg.trim();
            } catch (_) {}
          }
          setStatus(msg, true);
          if (window.playerIpc && window.playerIpc.send) {
            window.playerIpc.send('player:error', msg);
          }
          return;
        }
      }
      let errMsg =
        getMessageForCode(code) || 'Load failed: ' + safeErr(e);
      if ((code === 1001 || code === 6001 || code === 6007) && window.playerIpc && typeof window.playerIpc.getLastLicenseError === 'function') {
        try {
          const f1Msg = await window.playerIpc.getLastLicenseError();
          if (f1Msg && typeof f1Msg === 'string' && f1Msg.trim()) errMsg = 'F1 TV: ' + f1Msg.trim();
        } catch (_) {}
      }
      setStatus(errMsg, true);
      if (window.playerIpc && window.playerIpc.send) {
        window.playerIpc.send('player:error', errMsg);
      }
    }
  });
})();
