const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const electron = require('electron');
const { app, BrowserWindow, ipcMain, session, Menu } = electron;
const components = electron.components;
const axios = require('axios');
const f1tv = require('./f1tv-bridge');

const memSession = { accessToken: undefined };

const LICENSE_PROXY_PORT_MIN = 18765;
const LICENSE_PROXY_PORT_MAX = 18775;
/** Base proxy URL (without query); per-stream license URL becomes `${licenseProxyBaseUrl}?stream=<key>`. */
let licenseProxyBaseUrl = `http://127.0.0.1:${LICENSE_PROXY_PORT_MIN}/la`;

/**
 * Per-stream proxy state. Each contentPlay registers an entry keyed by `${contentId}:${channelId|0}`,
 * so multiple concurrent streams (multiview / Play All) each forward to their own LA target with
 * their own playToken and entitlement context. Replaces the previous singletons that caused the
 * "last contentPlay wins" race when multiple streams ran at once.
 */
const licenseProxyStreams = new Map();
/** Legacy single-stream identifier used by the custom player window (no streamKey in its license URL). */
const LEGACY_PLAYER_STREAM_KEY = '__player_window__';
/** Dedupe CloudFront HTML error logs within one /la request (PRE text differs per Request ID). */
let lastCloudFront403SemanticKey = '';

function buildStreamKey(contentId, channelId) {
  const c = contentId == null ? '' : String(contentId);
  const ch = channelId == null || channelId === '' || Number.isNaN(Number(channelId)) ? '0' : String(channelId);
  return `${c}:${ch}`;
}

function streamProxyUrl(streamKey) {
  return `${licenseProxyBaseUrl}?stream=${encodeURIComponent(streamKey)}`;
}

function getStreamEntry(streamKey) {
  return licenseProxyStreams.get(streamKey || LEGACY_PLAYER_STREAM_KEY) || null;
}

const F1TV_WEB_BASE = 'https://f1tv.formula1.com';

function redact(value) {
  if (value == null) return '';
  const s = String(value);
  if (!s) return '';
  if (s.length <= 16) return `${s.slice(0, 4)}…(len:${s.length})`;
  return `${s.slice(0, 8)}…${s.slice(-4)}(len:${s.length})`;
}

function summarizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase();
    if (lk.includes('token') || lk === 'authorization' || lk === 'cookie' || lk === 'customdata') out[k] = redact(v);
    else out[k] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}

function parseJwtPayload(jwt) {
  if (!jwt || typeof jwt !== 'string' || !jwt.includes('.')) return null;
  try {
    const parts = jwt.split('.');
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(b64 + '='.repeat((4 - (b64.length % 4)) % 4), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
}

function laUrlBase(u) {
  if (!u || typeof u !== 'string') return '';
  try {
    const url = new URL(u);
    return `${url.origin}${url.pathname}`;
  } catch (_) {
    return u.split('?')[0] || u;
  }
}

function isCloudFrontHtmlBlock(status, headers, dataBuf) {
  if (status !== 403 || !dataBuf || !dataBuf.length) return false;
  const ct = String(headers?.['content-type'] || '').toLowerCase();
  if (!ct.includes('text/html')) return false;
  const head = dataBuf.slice(0, 80).toString('utf8').trim().toUpperCase();
  return head.startsWith('<!DOCTYPE') || head.startsWith('<HTML');
}

/** Parses CloudFront default error HTML so logs show the real reason (not just "<!DOCTYPE..."). */
function extractCloudFrontErrorSummary(html) {
  if (!html || typeof html !== 'string') return null;
  const h1 = html.match(/<H1[^>]*>([\s\S]*?)<\/H1>/i)?.[1]?.replace(/\s+/g, ' ')?.trim();
  const h2 = html.match(/<H2[^>]*>([\s\S]*?)<\/H2>/i)?.[1]?.replace(/\s+/g, ' ')?.trim();
  const pre = html.match(/<PRE[^>]*>([\s\S]*?)<\/PRE>/i)?.[1]?.replace(/\s+/g, ' ')?.trim();
  const reqId = html.match(/Request ID:\s*([^<\s]+)/i)?.[1]?.trim();
  const genBy = html.match(/Generated\s+by\s+cloudfront\s*\(([^)]+)\)/i)?.[1]?.trim();
  return {
    h1: h1 ? h1.slice(0, 200) : undefined,
    h2: h2 ? h2.slice(0, 400) : undefined,
    pre: pre ? pre.slice(0, 500) : undefined,
    requestId: reqId,
    generatedBy: genBy,
  };
}

function cloudFront403SemanticKey(summary) {
  if (!summary) return '';
  // Ignore PRE/requestId — CloudFront changes Request ID every time so JSON never matches.
  return [summary.h1 || '', summary.h2 || '', summary.generatedBy || ''].join('\u0001');
}

function logCloudFrontHtml403(dataBuf, cfIdHeader) {
  try {
    const html = dataBuf.slice(0, 12000).toString('utf8');
    const summary = extractCloudFrontErrorSummary(html);
    if (summary) {
      const semKey = cloudFront403SemanticKey(summary);
      if (semKey && semKey === lastCloudFront403SemanticKey) {
        console.warn(
          '[license-proxy] CloudFront 403 (stesso messaggio di prima; Request ID diverso nel PRE) | x-amz-cf-id:',
          cfIdHeader || 'n/a'
        );
        return;
      }
      if (semKey) lastCloudFront403SemanticKey = semKey;
      console.warn('[license-proxy] CloudFront 403 detail:', JSON.stringify(summary), cfIdHeader ? `| x-amz-cf-id: ${cfIdHeader}` : '');
    } else {
      console.warn('[license-proxy] CloudFront 403 (could not parse HTML) | len:', dataBuf.length);
    }
  } catch (e) {
    console.warn('[license-proxy] CloudFront 403 parse error:', e?.message);
  }
}

/** Short hint for tiny LICENSE POST bodies (often 2 bytes = Widevine cert/protocol, not full challenge). */
function logLicenseBodyHint(bodyBuf) {
  const n = bodyBuf ? bodyBuf.length : 0;
  if (n === 0 || n > 64) return;
  const hex = Buffer.from(bodyBuf).toString('hex');
  console.warn(
    '[license-proxy] LICENSE body is very small (',
    n,
    'bytes, hex:',
    hex,
    ') — if playback fails, the CDM may still be in cert/handshake; real challenges are usually hundreds+ bytes.'
  );
}

/** Build alternate LA requests after CloudFront HTML 403 on standard F1 LA path. */
function buildLaDiscoveryAttempts(ctx, playToken) {
  const attempts = [];
  if (!ctx?.baseLaUrl) return attempts;
  const base = ctx.baseLaUrl;
  const kid = ctx.paCfKeyGroup && String(ctx.paCfKeyGroup).trim();

  const push = (label, url, extraHeaders) => {
    if (!url) return;
    const key = `${url}|${JSON.stringify(extraHeaders || {})}`;
    if (attempts.some((a) => a._k === key)) return;
    attempts.push({ label, url, extraHeaders: extraHeaders || {}, _k: key });
  };

  // If primary LA was WEB_DASH widevine (pipeline 5+), try BIG_SCREEN_DASH widevine — same pattern as older third-party clients (HLS/DASH).
  if (ctx.contentId != null && !Number.isNaN(Number(ctx.contentId))) {
    try {
      const authMatch = String(ctx.baseLaUrl || '').match(/\/2\.0\/(R|A)\//);
      const auth = authMatch ? authMatch[1] : 'R';
      const u = new URL(`https://f1tv.formula1.com/2.0/${auth}/ENG/BIG_SCREEN_DASH/ALL/CONTENT/LA/widevine`);
      u.searchParams.set('contentId', String(ctx.contentId));
      if (ctx.channelId != null && ctx.channelId !== '' && !Number.isNaN(Number(ctx.channelId))) {
        u.searchParams.set('channelId', String(ctx.channelId));
      }
      push('LA widevine BIG_SCREEN_DASH', u.toString(), {});
    } catch (_) {}
  }

  try {
    if (kid) {
      const u1 = new URL(base);
      u1.searchParams.set('kid', kid);
      push(`LA ?kid=${kid}`, u1.toString(), {});
      const u2 = new URL(base);
      u2.searchParams.set('keygroup', kid);
      push(`LA ?keygroup=${kid}`, u2.toString(), {});
      const u3 = new URL(base);
      u3.searchParams.set('KeyId', kid);
      push(`LA ?KeyId=${kid}`, u3.toString(), {});
    }
  } catch (_) {}

  if (ctx.licenseEntitlementToken) {
    push('LA + customdata(entitlementToken JWT)', base, { customdata: ctx.licenseEntitlementToken });
  }
  if (playToken) {
    push('LA + customdata(playToken)', base, { customdata: playToken });
  }
  try {
    const pl = parseJwtPayload(ctx.licenseEntitlementToken);
    if (pl?.SessionId) {
      push('LA + customdata(SessionId from JWT)', base, { customdata: String(pl.SessionId) });
    }
  } catch (_) {}

  push('LA + Accept: application/json', base, { Accept: 'application/json' });
  return attempts;
}

function buildLicensePlaybackContext(result) {
  const la = result?.licenseUrl;
  if (!la || typeof la !== 'string') return null;
  if (!la.startsWith('https://') || !la.includes('formula1.com')) return null;
  return {
    baseLaUrl: laUrlBase(la),
    pipelineVersion: result.pipelineVersion,
    paCfKeyGroup: result.paCfKeyGroup != null ? String(result.paCfKeyGroup) : '',
    licenseEntitlementToken: result.licenseEntitlementToken || '',
    manifestUrl: result.manifestUrl || '',
    contentId: result.contentId,
    channelId: result.channelId,
  };
}

/**
 * Registers (or refreshes) the per-stream license proxy entry. Returns the proxy URL to expose
 * to the renderer. Caller must replace the original `result.licenseUrl` with this string.
 */
function registerLicenseStream(streamKey, result) {
  const target = result?.licenseUrl && typeof result.licenseUrl === 'string' && result.licenseUrl.startsWith('https://')
    ? result.licenseUrl
    : '';
  if (!target) return null;
  const ctx = buildLicensePlaybackContext(result);
  const entry = {
    target,
    ctx,
    playToken: result.playToken || '',
    licenseEntitlementToken: result.licenseEntitlementToken || '',
    licenseAscendonToken: result.licenseAscendonToken || '',
    drmToken: result.drmToken || '',
    lastError: '',
  };
  licenseProxyStreams.set(streamKey, entry);
  console.log(
    '[license-proxy] stream registered | key:', streamKey,
    '| base:', ctx?.baseLaUrl || '(n/a)',
    '| pipeline:', ctx?.pipelineVersion ?? 'n/a',
    '| paCfKid:', ctx?.paCfKeyGroup || '(none)',
    '| total streams:', licenseProxyStreams.size
  );
  return streamProxyUrl(streamKey);
}

function pickDebugResponseHeaders(h) {
  if (!h) return {};
  const out = {};
  const keys = [
    'content-type',
    'server',
    'date',
    'via',
    'x-cache',
    'x-amz-cf-id',
    'x-amz-cf-pop',
    'cf-ray',
    'x-amzn-requestid',
    'x-request-id',
  ];
  for (const k of keys) {
    const v = h[k];
    if (v != null) out[k] = v;
  }
  return out;
}

/** Slug for F1 TV detail URL: /detail/{contentId}/{slug} */
function slugify(title) {
  if (!title || typeof title !== 'string') return 'video';
  const s = title.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  return s.length ? s : 'video';
}

/**
 * Refreshes the F1 client session (ascendon/entitlement) so license requests use valid tokens.
 * Call before contentPlay when the app has been running for a while; F1 tokens can expire after hours.
 */
async function refreshSessionBeforePlayback() {
  const token = memSession.accessToken;
  if (!token) return;
  try {
    await f1tv.initClient(token);
    console.log('[session] refreshed before playback');
  } catch (e) {
    console.warn('[session] refresh before playback failed:', e?.message);
    persistSession(null);
    memSession.accessToken = undefined;
    const msg = e?.message || String(e);
    throw new Error(
      msg.includes('expired') || msg.includes('timeout') || msg.includes('verification')
        ? 'Session expired or invalid. Please sign in again (e.g. "Sign in with browser") and retry.'
        : msg
    );
  }
}

/**
 * Opens a window with the custom player (local page + Shaka). Same session partition for DRM;
 * license proxy and headers are used by the player window.
 */
async function openCustomPlayerWindow(contentId, title, channelId) {
  const id = Number(contentId);
  if (!Number.isFinite(id) || id <= 0) {
    console.warn('[player] invalid contentId:', contentId);
    return;
  }
  await refreshSessionBeforePlayback();
  let result;
  try {
    result = await f1tv.contentPlay(id, channelId ?? undefined);
  } catch (e) {
    console.warn('[player] contentPlay failed:', e?.message);
    throw e;
  }
  if (!result?.manifestUrl) {
    console.warn('[player] no manifestUrl in response');
    return;
  }
  f1tv.setPlaybackEntitlementOverride(result.licenseEntitlementToken || null);
  if (result.playToken) {
    console.log('[player] playToken stored for license proxy');
    const cdnOrigins = ['https://f1tv.formula1.com', 'https://ott-video-fer-cf.formula1.com', 'https://ott-video-cf.formula1.com'];
    for (const origin of cdnOrigins) {
      session.defaultSession.cookies.set({ url: origin, name: 'playToken', value: result.playToken, path: '/' }).catch(() => {});
    }
  }
  let licenseUrl = result.licenseUrl || '';
  if (licenseUrl.startsWith('https://') && licenseUrl.includes('formula1.com')) {
    const streamKey = buildStreamKey(result.contentId ?? id, result.channelId ?? channelId);
    const proxied = registerLicenseStream(streamKey, result);
    if (proxied) licenseUrl = proxied;
  }
  const licenseHeaders = {};
  if (result.drmToken) {
    licenseHeaders.Authorization = `Bearer ${result.drmToken}`;
    licenseHeaders.drmtoken = result.drmToken;
  }
  if (result.licenseAscendonToken) licenseHeaders.ascendontoken = result.licenseAscendonToken;
  if (result.licenseEntitlementToken) licenseHeaders.entitlementtoken = result.licenseEntitlementToken;
  const fallbackLicenseHeaders = {};
  if (result.fallbackDrmToken) {
    fallbackLicenseHeaders.Authorization = `Bearer ${result.fallbackDrmToken}`;
    fallbackLicenseHeaders.drmtoken = result.fallbackDrmToken;
  }
  if (result.licenseAscendonToken) fallbackLicenseHeaders.ascendontoken = result.licenseAscendonToken;
  if (result.licenseEntitlementToken) fallbackLicenseHeaders.entitlementtoken = result.licenseEntitlementToken;

  const payload = {
    manifestUrl: result.manifestUrl,
    licenseUrl,
    licenseHeaders: Object.keys(licenseHeaders).length ? licenseHeaders : undefined,
    fallbackManifestUrl: result.fallbackManifestUrl,
    fallbackLicenseUrl: result.fallbackLicenseUrl || '',
    fallbackLicenseHeaders: Object.keys(fallbackLicenseHeaders).length ? fallbackLicenseHeaders : undefined,
  };

  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    title: `F1 OpenViewer – ${title || id}`,
    webPreferences: {
      preload: path.join(__dirname, 'player-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'default',
      plugins: true,
      webSecurity: false,
    },
  });
  win.loadFile(path.join(__dirname, 'player.html')).catch((e) => {
    console.warn('[player] loadFile failed:', e?.message);
  });
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('player:load', payload);
  });
  win.webContents.on('before-input-event', (_evt, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.isDevToolsOpened() ? win.webContents.closeDevTools() : win.webContents.openDevTools({ mode: 'detach' });
    }
  });
}

const LICENSE_PROXY_FORWARD_HEADERS = ['authorization', 'drmtoken', 'ascendontoken', 'entitlementtoken'];

/**
 * Builds headers for the outgoing F1 LA fetch. Per-stream tokens (from `entry`) take precedence
 * over both the global f1tv defaults and the renderer-supplied request headers, so concurrent
 * streams never clobber each other's entitlement / DRM tokens.
 */
function buildLicenseProxyHeaders(req, entry) {
  const base = { ...(f1tv.getLicenseRequestHeaders() || {}) };
  const forwarded = {};
  for (const key of LICENSE_PROXY_FORWARD_HEADERS) {
    const v = req.headers[key] || req.headers[key.toLowerCase()];
    if (v) forwarded[key] = Array.isArray(v) ? v[0] : v;
  }
  if (forwarded.ascendontoken) base.ascendontoken = forwarded.ascendontoken;
  if (forwarded.entitlementtoken) base.entitlementtoken = forwarded.entitlementtoken;
  if (forwarded.drmtoken) base.drmtoken = forwarded.drmtoken;
  if (forwarded.authorization && (forwarded.drmtoken || !base.Authorization)) {
    base.Authorization = forwarded.authorization;
  }
  if (entry) {
    if (entry.licenseEntitlementToken) base.entitlementtoken = entry.licenseEntitlementToken;
    if (entry.licenseAscendonToken) base.ascendontoken = entry.licenseAscendonToken;
    if (entry.drmToken) {
      base.drmtoken = entry.drmToken;
      base.Authorization = `Bearer ${entry.drmToken}`;
    }
  }
  return base;
}

/**
 * @param {string} target - F1 LA URL to forward the Widevine challenge to.
 * @param {Buffer} body - raw challenge bytes.
 * @param {Record<string, string>} headers - prebuilt forward headers (entitlement/ascendon/drm tokens etc.).
 * @param {string} [playToken] - per-stream playToken. Inlined into the outgoing Cookie header (via
 *   webRequest hook) so concurrent streams never race on the shared session cookie store.
 * @param {{ quiet?: boolean }} [opts]
 */
async function sendLicenseToF1(target, body, headers, playToken, opts = {}) {
  const quiet = !!opts.quiet;
  const targetUrl = new URL(target);

  // Build the Cookie header explicitly from a snapshot of session cookies, with our per-stream
  // playToken substituted in. setupLicenseRequestHeaders will use this verbatim when it sees the
  // X-F1OV-Cookie marker — Chromium's auto-cookie attachment is bypassed for this request, so
  // simultaneous streams can't race each other through the shared cookie store.
  let cookieOverride = '';
  let cookieDebug = '';
  try {
    const existing = await session.defaultSession.cookies.get({ url: target });
    const others = existing.filter((c) => c.name !== 'playToken').map((c) => `${c.name}=${c.value}`);
    const parts = playToken ? [`playToken=${playToken}`, ...others] : others;
    cookieOverride = parts.join('; ');
    cookieDebug = playToken
      ? `playToken=${redact(playToken)} +${others.length}other`
      : `(no playToken) ${others.length}other`;
  } catch (_) {}

  const reqHeaders = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== 'cookie') reqHeaders[k] = v;
  }
  reqHeaders['Content-Type'] = reqHeaders['Content-Type'] || 'application/octet-stream';
  // Markers so setupLicenseRequestHeaders knows this request is already fully decorated by the
  // proxy and must not overwrite per-stream tokens with the singleton defaults.
  reqHeaders['X-F1OV-Proxy'] = '1';
  if (cookieOverride) reqHeaders['X-F1OV-Cookie'] = cookieOverride;

  const authMode = reqHeaders.drmtoken
    ? 'drmToken'
    : reqHeaders.Authorization
      ? 'authorization'
      : reqHeaders.ascendontoken
        ? 'ascendon-only'
        : 'none';
  const bodyLen = body ? (Buffer.isBuffer(body) ? body.length : (body.byteLength ?? 0)) : 0;
  if (!quiet) {
    console.log(
      '[license-proxy] sending to F1 (Chromium)',
      '| url:', `${targetUrl.origin}${targetUrl.pathname}`,
      '| host:', targetUrl.host,
      '| auth:', authMode,
      '| cookie:', cookieDebug,
      '| body(bytes):', bodyLen
    );
  }

  const res = await session.defaultSession.fetch(target, {
    method: 'POST',
    headers: reqHeaders,
    body,
  });

  const arrayBuf = await res.arrayBuffer();
  const data = Buffer.from(arrayBuf);

  // Build plain headers object from Fetch API Response
  const responseHeaders = {};
  res.headers.forEach((value, key) => { responseHeaders[key] = value; });

  // Extra debug for 4xx/5xx or HTML error pages (CloudFront often returns HTML for 403).
  if (!quiet) {
    try {
      const ct = String(responseHeaders['content-type'] || '');
      const isTextLike = ct.includes('text/') || ct.includes('application/json') || ct.includes('application/xml') || ct.includes('application/xhtml');
      const prefix = data.slice(0, 700).toString(isTextLike ? 'utf8' : 'latin1').replace(/\s+/g, ' ');
      console.log(
        '[license-proxy] F1 response',
        '| status:', res.status,
        '| ct:', ct || '(none)',
        '| headers(debug):', JSON.stringify(pickDebugResponseHeaders(responseHeaders)),
        '| bodyPrefix:', prefix.slice(0, 300)
      );
      if (res.status === 403 && ct.toLowerCase().includes('text/html')) {
        logCloudFrontHtml403(data, responseHeaders['x-amz-cf-id'] || responseHeaders['X-Amz-Cf-Id']);
      }
    } catch (_) {}
  }

  return { status: res.status, headers: responseHeaders, data };
}

function startLicenseProxy() {
  function createProxyServer() {
    return http.createServer(async (req, res) => {
      let parsedUrl;
      try {
        parsedUrl = new URL(req.url, 'http://127.0.0.1');
      } catch (_) {
        res.writeHead(400);
        res.end();
        return;
      }
      if (req.method !== 'POST' || parsedUrl.pathname !== '/la') {
        res.writeHead(404);
        res.end();
        return;
      }
      const requestedStreamKey = parsedUrl.searchParams.get('stream') || '';
      const streamKey = requestedStreamKey || LEGACY_PLAYER_STREAM_KEY;
      const entry = licenseProxyStreams.get(streamKey)
        || (requestedStreamKey ? null : licenseProxyStreams.get(LEGACY_PLAYER_STREAM_KEY) || null);

      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      lastCloudFront403SemanticKey = '';

      if (!entry || !entry.target || !entry.target.startsWith('https://')) {
        console.warn('[license-proxy] no LA target for streamKey:', streamKey);
        res.writeHead(502);
        res.end();
        return;
      }

      const target = entry.target;
      const playTokenFromHeader = req.headers['x-f1-play-token'] || req.headers['X-F1-Play-Token'];
      const playTokenHeaderValue = Array.isArray(playTokenFromHeader) ? playTokenFromHeader[0] : playTokenFromHeader;
      const playToken = entry.playToken || playTokenHeaderValue || '';

      try {
        console.log(
          '[license-proxy] incoming LA request',
          '| streamKey:', streamKey,
          '| ua:', String(req.headers['user-agent'] || '').slice(0, 60),
          '| ct:', req.headers['content-type'] || '(none)',
          '| playToken:', playToken ? redact(playToken) : '(none)',
          '| body(bytes):', body.length
        );
        if (body.length) {
          const sig = body.slice(0, 24).toString('base64');
          console.log('[license-proxy] challenge prefix (base64, 24 bytes):', sig);
          if (body.length <= 64) logLicenseBodyHint(body);
        }

        const headers = buildLicenseProxyHeaders(req, entry);
        const licenseReqContentType = req.headers['content-type'] || 'application/octet-stream';
        const baseFwd = { ...headers, 'Content-Type': licenseReqContentType };

        let r = await sendLicenseToF1(target, body, baseFwd, playToken);

        if (r.status === 403 && memSession.accessToken) {
          try {
            await f1tv.initClient(memSession.accessToken);
            const retryHeaders = { ...buildLicenseProxyHeaders(req, entry), 'Content-Type': licenseReqContentType };
            const r2 = await sendLicenseToF1(target, body, retryHeaders, playToken);
            r = r2;
            if (r2.status === 200) console.log('[license-proxy] F1 → 200 after session refresh retry');
          } catch (_) {}
        }

        if (r.status === 403 && isCloudFrontHtmlBlock(r.status, r.headers, r.data)) {
          const ctx = entry.ctx;
          const targetBase = laUrlBase(target);
          if (ctx && ctx.baseLaUrl === targetBase) {
            const attempts = buildLaDiscoveryAttempts(ctx, playToken);
            if (attempts.length) {
              console.log('[license-proxy] LA discovery:', attempts.length, 'variants for streamKey:', streamKey);
            }
            let discoveryIdx = 0;
            for (const att of attempts) {
              discoveryIdx += 1;
              const variantHeaders = { ...buildLicenseProxyHeaders(req, entry), 'Content-Type': licenseReqContentType, ...att.extraHeaders };
              const rTry = await sendLicenseToF1(att.url, body, variantHeaders, playToken, { quiet: true });
              if (rTry.status === 200) {
                r = rTry;
                console.log('[license-proxy] LA discovery OK:', att.label, '| streamKey:', streamKey);
                break;
              }
              if (!isCloudFrontHtmlBlock(rTry.status, rTry.headers, rTry.data)) {
                r = rTry;
                const ctTry = String(rTry.headers?.['content-type'] || '').toLowerCase();
                if (rTry.status !== 403 || ctTry.includes('json')) break;
              }
            }
          }
        }

        const buf = Buffer.from(r.data);
        const outHeaders = {};
        if (r.headers['content-type']) outHeaders['Content-Type'] = r.headers['content-type'];
        res.writeHead(r.status, outHeaders);
        res.end(buf);
        try {
          const u = new URL(target);
          console.log('[license-proxy] F1 → status', r.status, '| streamKey:', streamKey, '| target:', `${u.origin}${u.pathname}`);
        } catch (_) {
          console.log('[license-proxy] F1 → status', r.status, '| streamKey:', streamKey);
        }
        if (r.status === 403) {
          const bodyStr = buf.toString('utf8');
          try {
            const j = JSON.parse(bodyStr);
            const msg = j?.resultObj?.keyos?.errormsg || j?.message || j?.resultObj?.message || '';
            if (msg) {
              entry.lastError = msg;
              console.warn('[license-proxy] 403 message:', msg.slice(0, 200), '| streamKey:', streamKey);
            }
          } catch (_) {
            entry.lastError = bodyStr.slice(0, 300);
          }
        } else if (r.status === 200) {
          entry.lastError = '';
        }
        if (r.status === 200 && r.headers['set-cookie']) {
          const setCookies = Array.isArray(r.headers['set-cookie']) ? r.headers['set-cookie'] : [r.headers['set-cookie']];
          const origin = new URL(target).origin;
          for (const raw of setCookies) {
            const [nameVal, ...rest] = raw.split(';').map((s) => s.trim());
            const eq = nameVal.indexOf('=');
            if (eq <= 0) continue;
            const name = nameVal.slice(0, eq);
            const value = nameVal.slice(eq + 1);
            let cookiePath = '/';
            for (const part of rest) {
              if (part.toLowerCase().startsWith('path=')) cookiePath = part.slice(5).trim();
            }
            session.defaultSession.cookies.set({ url: origin, name, value, path: cookiePath }).catch(() => {});
          }
        }
      } catch (e) {
        console.warn('[license-proxy] error:', e?.message);
        res.writeHead(502);
        res.end();
      }
    });
  }

  function tryListen(port) {
    if (port > LICENSE_PROXY_PORT_MAX) {
      console.warn('[license-proxy] no free port in range', LICENSE_PROXY_PORT_MIN, '-', LICENSE_PROXY_PORT_MAX, '; DRM may not work');
      return;
    }
    const server = createProxyServer();
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        console.warn('[license-proxy] port', port, 'in use, trying', port + 1);
        tryListen(port + 1);
      } else {
        console.warn('[license-proxy] server error:', e?.message);
      }
    });
    server.listen(port, '127.0.0.1', () => {
      licenseProxyBaseUrl = `http://127.0.0.1:${port}/la`;
      console.log('[license-proxy] listening on', licenseProxyBaseUrl);
    });
  }
  tryListen(LICENSE_PROXY_PORT_MIN);
}

function getSessionFilePath() {
  return path.join(app.getPath('userData'), 'f1openviewer-session.json');
}

function getCookiesFilePath() {
  return path.join(app.getPath('userData'), 'f1openviewer-cookies.json');
}

function loadPersistedSession() {
  try {
    const p = getSessionFilePath();
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf-8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj.accessToken === 'string' && obj.accessToken.length > 50) {
      return obj.accessToken;
    }
  } catch (_) {}
  return null;
}

function persistSession(token) {
  try {
    const p = getSessionFilePath();
    if (token) {
      fs.writeFileSync(p, JSON.stringify({ accessToken: token }), 'utf-8');
    } else {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  } catch (_) {}
}

/** Saves cookies to disk so they can be restored on next launch (F1 TV window already logged in). */
function persistCookies(cookieList) {
  if (!Array.isArray(cookieList) || !cookieList.length) return;
  try {
    const p = getCookiesFilePath();
    fs.writeFileSync(p, JSON.stringify(cookieList), 'utf-8');
    console.log('[session] salvati', cookieList.length, 'cookie su disco');
  } catch (e) {
    console.warn('[session] persist cookies:', e?.message);
  }
}

/**
 * Full reset: session, cookies, persisted files, F1 client, and all session storage/cache.
 * Use from Settings to guarantee a clean state (e.g. before re-login to fix DRM 403).
 */
async function performFullReset() {
  memSession.accessToken = undefined;
  persistSession(null);
  licenseProxyStreams.clear();
  try {
    const sessionPath = getSessionFilePath();
    if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
    const cookiesPath = getCookiesFilePath();
    if (fs.existsSync(cookiesPath)) fs.unlinkSync(cookiesPath);
  } catch (e) {
    console.warn('[reset] delete session/cookies files:', e?.message);
  }
  f1tv.clearSession();
  try {
    const urls = ['https://formula1.com', 'https://account.formula1.com', 'https://f1tv.formula1.com'];
    for (const u of urls) {
      const list = await session.defaultSession.cookies.get({ url: u });
      for (const c of list) await session.defaultSession.cookies.remove(u, c.name).catch(() => {});
    }
  } catch (_) {}
  try {
    await session.defaultSession.clearCache();
    await session.defaultSession.clearStorageData({
      storages: ['localstorage', 'sessionstorage', 'cookies', 'cachestorage', 'indexdb'],
    });
  } catch (e) {
    console.warn('[reset] clearStorageData/clearCache:', e?.message);
  }
  console.log('[reset] Full reset completed (session, cookies, cache, storage).');
}

/** Restores saved cookies into defaultSession (so the F1 TV window is already logged in). */
async function restorePersistedCookies() {
  try {
    const p = getCookiesFilePath();
    if (!fs.existsSync(p)) return;
    const raw = fs.readFileSync(p, 'utf-8');
    const list = JSON.parse(raw);
    if (!Array.isArray(list) || !list.length) return;
    const defaultCookies = session.defaultSession.cookies;
    for (const c of list) {
      if (!c.url || !c.name) continue;
      await defaultCookies.set({
        url: c.url,
        name: c.name,
        value: c.value || '',
        path: c.path || '/',
        domain: c.domain || undefined,
        secure: !!c.secure,
        httpOnly: !!c.httpOnly,
        expirationDate: c.expirationDate,
      }).catch(() => {});
    }
    console.log('[session] restored', list.length, 'cookies from disk');
  } catch (_) {}
}

/**
 * Finds Chrome Widevine CDM folder on Windows (for use with Electron).
 * Returns { path, version } or null.
 */
function findChromeWidevineWindows() {
  if (process.platform !== 'win32') return null;
  const candidates = [];
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA || '';
  for (const base of [
    path.join(programFiles, 'Google', 'Chrome', 'Application'),
    path.join(programFilesX86, 'Google', 'Chrome', 'Application'),
  ]) {
    if (!fs.existsSync(base)) continue;
    const dirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const d of dirs) {
      const widevineBase = path.join(base, d.name, 'WidevineCdm');
      const platformDir = path.join(widevineBase, '_platform_specific', 'win_x64');
      if (fs.existsSync(platformDir) && fs.existsSync(path.join(platformDir, 'widevinecdm.dll'))) {
        let version = '';
        try {
          const manifestPath = path.join(widevineBase, 'manifest.json');
          if (fs.existsSync(manifestPath)) {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
            version = manifest.version || '';
          }
        } catch (_) {}
        candidates.push({ path: platformDir, version });
      }
    }
  }
  if (localAppData) {
    const wv = path.join(localAppData, 'Google', 'Chrome', 'User Data', 'WidevineCdm');
    if (fs.existsSync(wv)) {
      const vers = fs.readdirSync(wv, { withFileTypes: true }).filter((d) => d.isDirectory());
      for (const v of vers) {
        const platformDir = path.join(wv, v.name, '_platform_specific', 'win_x64');
        if (fs.existsSync(platformDir) && fs.existsSync(path.join(platformDir, 'widevinecdm.dll'))) {
          candidates.push({ path: platformDir, version: v.name });
        }
      }
    }
  }
  return candidates.length ? candidates[candidates.length - 1] : null;
}

function configureWidevineFromEnv() {
  if (components && typeof components.whenReady === 'function') {
    app.commandLine.appendSwitch('enable-widevine-cdm');
    return;
  }
  let cdmPath = process.env.ELECTRON_WIDEVINE_CDM_PATH;
  let cdmVersion = process.env.ELECTRON_WIDEVINE_CDM_VERSION;
  if (!cdmPath && process.platform === 'win32') {
    const found = findChromeWidevineWindows();
    if (found) {
      cdmPath = found.path;
      if (!cdmVersion) cdmVersion = found.version;
      console.log('[Widevine] using Chrome CDM:', cdmPath, '| version:', cdmVersion);
    }
  }
  if (cdmPath) app.commandLine.appendSwitch('widevine-cdm-path', cdmPath);
  if (cdmVersion) app.commandLine.appendSwitch('widevine-cdm-version', cdmVersion);
  app.commandLine.appendSwitch('enable-widevine-cdm');
}

const F1_LOGIN_URL = 'https://account.formula1.com/';

/** Script injected into F1 page to intercept by-password response (fetch and XHR) and send the token. */
const LOGIN_PAGE_INJECT = `
(function() {
  if (window.__f1openviewerPatched) return true;
  window.__f1openviewerPatched = true;
  var sendToken = function(text) {
    if (text && text.length > 20 && window.f1openviewer && window.f1openviewer.captureToken) {
      window.f1openviewer.captureToken(text);
    }
  };
  var origFetch = window.fetch;
  window.fetch = function() {
    var url = typeof arguments[0] === 'string' ? arguments[0] : (arguments[0] && arguments[0].url);
    return origFetch.apply(this, arguments).then(function(res) {
      if (url && url.indexOf('by-password') !== -1 && res.status === 200) {
        res.clone().text().then(function(text) {
          if (text) sendToken(text);
        }).catch(function() {});
      }
      return res;
    });
  };
  var OrigXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function() {
    var xhr = new OrigXHR();
    var origOpen = xhr.open;
    xhr.open = function(method, url) {
      xhr._url = url;
      return origOpen.apply(this, arguments);
    };
    xhr.addEventListener('load', function() {
      if (xhr._url && xhr._url.indexOf('by-password') !== -1 && xhr.status === 200 && xhr.responseText) {
        sendToken(xhr.responseText);
      }
    });
    return xhr;
  };
  return true;
})();
`;

function openLoginWindow() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, token) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { ipcMain.removeAllListeners('f1:login-token'); } catch (_) {}
      if (!loginWin.isDestroyed()) loginWin.close();
      if (err) reject(err);
      else resolve(token);
    };

    // Use a unique in-memory partition so each sign-in has a clean session (no stale cookies/cache).
    const loginPartition = 'temp-login-' + Date.now();

    const loginWin = new BrowserWindow({
      width: 900,
      height: 700,
      title: 'Sign in to F1 TV',
      webPreferences: {
        partition: loginPartition,
        preload: path.join(__dirname, 'login-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    const timeout = setTimeout(() => {
      finish(new Error('Timeout: complete sign-in in the window within a few minutes.'));
    }, 300000);

    ipcMain.once('f1:login-token', async (_, token) => {
      if (settled) return;
      // F1 TV cookies are required for the license server and the F1 TV web window.
      await new Promise((r) => setTimeout(r, 2000));
      if (settled || loginWin.isDestroyed()) return;
      const toPersist = [];
      try {
        const loginSession = loginWin.webContents.session;
        const urls = ['https://formula1.com', 'https://account.formula1.com', 'https://f1tv.formula1.com'];
        const exp = Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000);
        for (const baseUrl of urls) {
          const list = await loginSession.cookies.get({ url: baseUrl });
          const defaultCookies = session.defaultSession.cookies;
          for (const c of list) {
            const expirationDate = c.session ? exp : c.expirationDate;
            await defaultCookies.set({
              url: baseUrl,
              name: c.name,
              value: c.value,
              path: c.path || '/',
              domain: c.domain || undefined,
              secure: c.secure,
              httpOnly: c.httpOnly,
              expirationDate,
            }).catch(() => {});
            toPersist.push({
              url: baseUrl,
              name: c.name,
              value: c.value,
              path: c.path || '/',
              domain: c.domain || undefined,
              secure: !!c.secure,
              httpOnly: !!c.httpOnly,
              expirationDate,
            });
          }
          if (list.length) console.log('[login] copied', list.length, 'cookies for', baseUrl);
        }
        persistCookies(toPersist);
      } catch (e) {
        console.warn('[login] copy cookies:', e?.message);
      }
      finish(null, token);
    });

    loginWin.on('closed', () => {
      if (!settled) finish(new Error('Window closed without completing sign-in.'));
    });

    loginWin.loadURL(F1_LOGIN_URL).then(() => {}).catch((e) => finish(e));

    loginWin.webContents.on('did-finish-load', () => {
      loginWin.webContents.executeJavaScript(LOGIN_PAGE_INJECT).catch(() => {});
    });
  });
}

function createWindow() {
  const iconPath = path.join(__dirname, 'icon.png');
  const iconPathIco = path.join(__dirname, 'icon.ico');
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    backgroundColor: '#0b0f14',
    icon: fs.existsSync(iconPathIco) ? iconPathIco : (fs.existsSync(iconPath) ? iconPath : undefined),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      plugins: true, // required for CDM/DRM in some configurations
      webSecurity: false, // avoid CORS blocks on manifest/segment/license F1 TV CDN
    },
  });

  const startUrl = process.env.ELECTRON_START_URL;
  // Diagnostics for "black screen" / renderer crash: pipe renderer events to main logs.
  win.webContents.on('did-start-loading', () => {
    console.log('[window] did-start-loading');
  });
  win.webContents.on('did-finish-load', () => {
    console.log('[window] did-finish-load | url:', win.webContents.getURL());
  });
  win.webContents.on('did-fail-load', (_evt, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    console.warn('[window] did-fail-load:', errorCode, errorDescription, '| url:', validatedURL);
  });
  win.webContents.on('render-process-gone', (_evt, details) => {
    console.warn('[window] render-process-gone:', details?.reason, details?.exitCode ?? '');
  });
  win.webContents.on('unresponsive', () => {
    console.warn('[window] renderer unresponsive');
  });
  win.webContents.on('responsive', () => {
    console.log('[window] renderer responsive');
  });
  win.webContents.on('console-message', (evt, level, message, line, sourceId) => {
    const lvl = evt.level ?? level ?? 0;
    const msg = evt.message ?? message ?? '';
    const tag = lvl === 2 ? 'error' : lvl === 1 ? 'warn' : 'log';
    if (process.env.ELECTRON_START_URL && typeof msg === 'string' && msg.includes('Electron Security Warning')) return;
    const sid = evt.sourceId ?? sourceId;
    const ln = evt.line ?? line;
    const loc = sid && ln != null ? ` (${sid}:${ln})` : '';
    console.log(`[renderer:${tag}] ${msg}${loc}`);
  });

  if (startUrl) {
    win.loadURL(startUrl);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  if (process.env.ELECTRON_OPEN_DEVTOOLS === 'true') {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  win.webContents.on('before-input-event', (_evt, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.isDevToolsOpened() ? win.webContents.closeDevTools() : win.webContents.openDevTools({ mode: 'detach' });
    }
  });

  return win;
}

/** URL della app principale (stesso usato da createWindow) per aprire la finestra multiview standalone. */
function getMainAppUrl() {
  const startUrl = process.env.ELECTRON_START_URL;
  if (startUrl) return startUrl;
  return 'file://' + path.join(__dirname, '..', 'dist', 'index.html').replace(/\\/g, '/');
}

/** Istanze multiview aperte: id → finestra (più monitor / più layout). */
const multiviewWindows = new Map();
let multiviewInstanceSeq = 0;

function broadcastMultiviewWindows() {
  const ids = Array.from(multiviewWindows.keys()).sort((a, b) => a - b);
  const payload = { ids, count: ids.length };
  for (const bw of BrowserWindow.getAllWindows()) {
    try {
      if (bw.isDestroyed()) continue;
      bw.webContents.send('multiview:windowsChanged', payload);
    } catch (_) {}
  }
}

/** Apre una nuova finestra multiview numerata (#standalone-multiview?mv=n). */
function createMultiviewWindow() {
  const id = ++multiviewInstanceSeq;
  const baseUrl = getMainAppUrl();
  const fragment = `standalone-multiview?mv=${id}`;
  const multiviewUrl = baseUrl.includes('#')
    ? baseUrl.replace(/#.*$/, '') + '#' + fragment
    : baseUrl + '#' + fragment;

  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    backgroundColor: '#0b0f14',
    title: `F1 OpenViewer — Multiview #${id}`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      plugins: true,
    },
  });

  multiviewWindows.set(id, win);
  win.on('closed', () => {
    multiviewWindows.delete(id);
    broadcastMultiviewWindows();
  });

  win.loadURL(multiviewUrl).catch((e) => console.warn('[multiview] load failed:', e?.message));
  broadcastMultiviewWindows();
  return { win, id };
}

function setupCorsRelaxForDev() {
  // Renderer uses IPC, not direct calls. We still enable a dev-only policy for cross-origin (manifest/segment).
  if (process.env.ELECTRON_RELAX_CORS === 'true') {
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      details.requestHeaders['Origin'] = details.requestHeaders['Origin'] || 'https://localhost';
      callback({ requestHeaders: details.requestHeaders });
    });
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const headers = details.responseHeaders || {};
      headers['access-control-allow-origin'] = ['*'];
      headers['access-control-allow-headers'] = ['*'];
      callback({ responseHeaders: headers });
    });
  }
}

/** Log LA request response status for debug (403/401 = rejected). */
function setupLicenseResponseLog() {
  session.defaultSession.webRequest.onCompleted((details) => {
    const url = details.url || '';
    if (url.includes('formula1.com') && (url.includes('/LA') || url.includes('/CONTENT/LA'))) {
      console.log('[license] LA response status:', details.statusCode, details.statusCode >= 400 ? '(request rejected)' : '');
    }
  });
}

/** Manifest/init/segments on F1 CDNs; without ascendon/entitlement headers many pipeline-3 VODs return HTTP 403. */
function isF1OttVideoCdnUrl(urlString) {
  try {
    const h = new URL(urlString).hostname;
    return h.includes('ott-video') && h.endsWith('formula1.com');
  } catch {
    return false;
  }
}

/** Injects ascendon/entitlement and cookies on F1 license acquisition and ott-video CDN requests. */
function setupLicenseRequestHeaders() {
  session.defaultSession.webRequest.onBeforeSendHeaders(async (details, callback) => {
    const url = details.url || '';
    const isF1License = url.includes('formula1.com') && (url.includes('/LA') || url.includes('/CONTENT/LA'));
    const isF1OttCdn = isF1OttVideoCdnUrl(url);

    if (isF1OttCdn) {
      const requestHeaders = { ...details.requestHeaders };
      const headers = f1tv.getLicenseRequestHeaders();
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          requestHeaders[k] = v;
        }
      }
      try {
        const cookies = await session.defaultSession.cookies.get({ url });
        if (cookies.length) {
          requestHeaders.Cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
        }
      } catch (_) {}
      callback({ requestHeaders });
      return;
    }

    if (!isF1License) {
      callback({ requestHeaders: details.requestHeaders });
      return;
    }
    const requestHeaders = { ...details.requestHeaders };

    // Find our proxy markers case-insensitively (Chromium normalizes header casing
    // inconsistently across releases — exact-case lookups silently miss).
    let proxyMarkerKey = null;
    let cookieMarkerKey = null;
    for (const k of Object.keys(requestHeaders)) {
      const lk = k.toLowerCase();
      if (lk === 'x-f1ov-proxy') proxyMarkerKey = k;
      else if (lk === 'x-f1ov-cookie') cookieMarkerKey = k;
    }
    const isProxyOriginated = proxyMarkerKey != null;

    if (isProxyOriginated) {
      // The license proxy has already filled in per-stream entitlement / ascendon / drm /
      // playToken values. Do NOT touch them — overwriting with the singleton f1tv defaults
      // (which always reflect the LATEST contentPlay) is exactly what produced the
      // "only the main feed gets DRM 403" failure on multi-stream play.
      if (cookieMarkerKey) {
        requestHeaders.Cookie = requestHeaders[cookieMarkerKey];
        delete requestHeaders[cookieMarkerKey];
      }
      delete requestHeaders[proxyMarkerKey];
      callback({ requestHeaders });
      return;
    }

    // Non-proxy path (legacy single-stream player window): fill in missing tokens from the
    // global f1tv state and attach session cookies. This branch only runs when no streamKey
    // was present in the proxy URL.
    const headers = f1tv.getLicenseRequestHeaders();
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        requestHeaders[k] = v;
      }
    }
    try {
      const cookies = await session.defaultSession.cookies.get({ url });
      if (cookies.length) {
        requestHeaders.Cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      }
    } catch (_) {}
    console.log('[license] headers injected on LA request (legacy/non-proxy path)');
    callback({ requestHeaders });
  });
}

function setupIpc() {
  ipcMain.handle('session:get', async () => ({ accessToken: memSession.accessToken }));
  ipcMain.handle('session:set', async (_evt, s) => {
    const token = s && typeof s.accessToken === 'string' ? s.accessToken : undefined;
    memSession.accessToken = token;
    persistSession(token);
  });
  ipcMain.handle('session:clear', async () => {
    memSession.accessToken = undefined;
    persistSession(null);
    licenseProxyStreams.clear();
    try {
      const p = getCookiesFilePath();
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (_) {}
    f1tv.clearSession();
    try {
      const urls = ['https://formula1.com', 'https://account.formula1.com', 'https://f1tv.formula1.com'];
      for (const u of urls) {
        const list = await session.defaultSession.cookies.get({ url: u });
        for (const c of list) await session.defaultSession.cookies.remove(u, c.name).catch(() => {});
      }
    } catch (_) {}
  });

  ipcMain.handle('f1:login', async (_evt, email, password) => {
    const { subscriptionToken } = await f1tv.login(email, password);
    await f1tv.initClient(subscriptionToken);
    memSession.accessToken = subscriptionToken;
    persistSession(subscriptionToken);
    return { accessToken: subscriptionToken };
  });
  ipcMain.handle('f1:loginWithToken', async (_evt, tokenOrJson) => {
    const { subscriptionToken } = f1tv.loginWithToken(tokenOrJson);
    await f1tv.initClient(subscriptionToken);
    memSession.accessToken = subscriptionToken;
    persistSession(subscriptionToken);
    return { accessToken: subscriptionToken };
  });
  ipcMain.handle('f1:loginWithBrowser', async () => {
    const raw = await openLoginWindow();
    const { subscriptionToken } = f1tv.loginWithToken(raw);
    await f1tv.initClient(subscriptionToken);
    memSession.accessToken = subscriptionToken;
    persistSession(subscriptionToken);
    return { accessToken: subscriptionToken };
  });
  ipcMain.handle('f1:restoreSession', async () => {
    if (f1tv.isClientReady) return { accessToken: memSession.accessToken, restored: true };
    const token = memSession.accessToken || loadPersistedSession();
    if (!token) return { accessToken: null, restored: false };
    try {
      await f1tv.initClient(token);
      memSession.accessToken = token;
      return { accessToken: token, restored: true };
    } catch (e) {
      console.warn('[session] restore failed, token expired:', e?.message);
      persistSession(null);
      memSession.accessToken = undefined;
      return { accessToken: null, restored: false };
    }
  });
  ipcMain.handle('f1:getLiveNow', async () => f1tv.getLiveNow());
  ipcMain.handle('f1:searchVod', async (_evt, params) => f1tv.searchVod(params || {}));
  ipcMain.handle('f1:getVodCatalog', async () => f1tv.getVodCatalog());
  ipcMain.handle('f1:getVodSeasons', async () => f1tv.getVodSeasons());
  ipcMain.handle('f1:getVodEvents', async (_evt, seasonPageId) => f1tv.getVodEvents(seasonPageId));
  ipcMain.handle('f1:getVodSessions', async (_evt, gpPageId) => f1tv.getVodSessions(gpPageId));
  ipcMain.handle('f1:getContentVideo', async (_evt, contentId) => f1tv.getContentVideo(contentId));

  // Serialize contentPlay so "Play all" / multiple streams don't run initClient in parallel (client gets reset and "not ready")
  // Add delay between requests to avoid CloudFront 403 "Request blocked" / "too much traffic" when opening many streams
  const CONTENT_PLAY_DELAY_MS = 450;
  let contentPlayQueue = Promise.resolve();
  ipcMain.handle('f1:contentPlay', async (_evt, contentId, channelId) => {
    contentPlayQueue = contentPlayQueue
      .catch(() => null)
      .then(async () => {
        if (!f1tv.isClientReady) {
          await refreshSessionBeforePlayback();
        }
        return f1tv.contentPlay(contentId, channelId);
      })
      .then((result) => {
        f1tv.setPlaybackEntitlementOverride(result?.licenseEntitlementToken || null);
        if (result?.playToken) {
          // Cookie write is best-effort: needed by some pipelines for segment fetches.
          // The proxy itself uses the per-stream playToken from the registry, not this cookie.
          const cdnOrigins = ['https://f1tv.formula1.com', 'https://ott-video-fer-cf.formula1.com', 'https://ott-video-cf.formula1.com'];
          for (const origin of cdnOrigins) {
            session.defaultSession.cookies.set({ url: origin, name: 'playToken', value: result.playToken, path: '/' }).catch(() => {});
          }
        }
        if (result?.licenseUrl && result.licenseUrl.startsWith('https://') && result.licenseUrl.includes('formula1.com')) {
          const streamKey = buildStreamKey(result.contentId ?? contentId, result.channelId ?? channelId);
          const proxied = registerLicenseStream(streamKey, result);
          if (proxied) result.licenseUrl = proxied;
        }
        return result;
      })
      .then((result) => new Promise((resolve) => setTimeout(() => resolve(result), CONTENT_PLAY_DELAY_MS)));
    return contentPlayQueue;
  });
  ipcMain.handle('f1:openInF1TVWeb', async (_evt, contentId, title, channelId) => {
    await openCustomPlayerWindow(contentId, title, channelId);
  });
  ipcMain.handle('f1:isReady', () => f1tv.isClientReady);
  ipcMain.handle('f1:fullReset', async () => {
    await performFullReset();
    return { ok: true };
  });
  ipcMain.handle('player:getLastLicenseError', (_evt, streamKey) => {
    if (streamKey && licenseProxyStreams.has(streamKey)) {
      return licenseProxyStreams.get(streamKey).lastError || '';
    }
    // Fallback for legacy callers (single-stream player window): pick the most recently failed
    // stream so the message still surfaces.
    let latest = '';
    for (const entry of licenseProxyStreams.values()) {
      if (entry.lastError) latest = entry.lastError;
    }
    return latest;
  });

  ipcMain.on('player:resetAspect', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win && !win.isDestroyed()) win.setAspectRatio(0);
  });
  ipcMain.on('player:intrinsicVideoSize', (e, w, h) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed()) return;
    const ww = Number(w);
    const hh = Number(h);
    if (!Number.isFinite(ww) || !Number.isFinite(hh) || ww <= 0 || hh <= 0) return;
    win.setAspectRatio(ww / hh);
  });

  ipcMain.handle('multiview:openWindow', () => {
    const { id } = createMultiviewWindow();
    return { id };
  });
  ipcMain.handle('multiview:listWindows', () => {
    return Array.from(multiviewWindows.keys()).sort((a, b) => a - b);
  });
  ipcMain.handle('multiview:closeWindow', (evt) => {
    // BrowserWindow.fromWebContents is documented and stable across Electron versions;
    // getOwnerBrowserWindow is undocumented and was returning undefined in some builds.
    const w = BrowserWindow.fromWebContents(evt.sender)
      || (typeof evt.sender.getOwnerBrowserWindow === 'function' ? evt.sender.getOwnerBrowserWindow() : null);
    if (w && !w.isDestroyed()) w.close();
  });

  ipcMain.handle('net:request', async (_evt, req) => {
    const method = req?.method;
    const url = req?.url;
    if (!method || !url) throw new Error('Invalid request (method/url).');

    const timeout = Number(req?.timeoutMs ?? 30000);
    const headers = Object.assign({}, req?.headers || {});

    // If not provided, inject bearer from in-memory session.
    if (!headers.Authorization && !headers.authorization && memSession.accessToken) {
      headers.Authorization = `Bearer ${memSession.accessToken}`;
    }

    let finalUrl = url;
    if (req?.query && typeof req.query === 'object') {
      const u = new URL(url);
      for (const [k, v] of Object.entries(req.query)) {
        if (v === undefined || v === null) continue;
        u.searchParams.set(k, String(v));
      }
      finalUrl = u.toString();
    }

    try {
      const res = await axios.request({
        method,
        url: finalUrl,
        headers,
        data: req?.body,
        timeout,
        validateStatus: () => true,
      });

      const outHeaders = {};
      for (const [k, v] of Object.entries(res.headers || {})) {
        outHeaders[String(k).toLowerCase()] = Array.isArray(v) ? v.join(',') : String(v);
      }

      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        headers: outHeaders,
        data: res.data,
      };
    } catch (e) {
      const msg = e?.message || 'Network error.';
      return { ok: false, status: 0, headers: {}, data: { message: msg } };
    }
  });
}

configureWidevineFromEnv();

// On Windows avoid "Sandbox cannot access executable" which can block CDM/DRM
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('no-sandbox');
}

// Avoid "Unable to move the cache: Access denied" and "Gpu Cache Creation failed" on Windows:
// use a dedicated per-process cache directory and disable GPU shader disk cache
const cacheDir = path.join(os.tmpdir(), 'f1openviewer-cache', String(process.pid));
app.commandLine.appendSwitch('disk-cache-dir', cacheDir);
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

app.whenReady().then(async () => {
  if (components && typeof components.whenReady === 'function') {
    console.log('[Widevine] waiting for castLabs CDM…');
    await components.whenReady();
    console.log('[Widevine] castLabs CDM ready.');
  }
  startLicenseProxy();
  setupCorsRelaxForDev();
  setupLicenseResponseLog();
  setupLicenseRequestHeaders();
  setupIpc();

  const savedToken = loadPersistedSession();
  await restorePersistedCookies();
  if (savedToken) {
    memSession.accessToken = savedToken;
    console.log('[session] token found on disk, restoring F1 TV client…');
    f1tv.initClient(savedToken).then(() => {
      console.log('[session] F1 TV client restored successfully');
    }).catch((e) => {
      console.warn('[session] token expired, new login required:', e?.message);
      persistSession(null);
      memSession.accessToken = undefined;
    });
  }

  Menu.setApplicationMenu(null);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

