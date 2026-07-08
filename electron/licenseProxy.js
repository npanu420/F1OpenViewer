/**
 * Widevine license (LA) proxy + the webRequest hooks that feed it.
 *
 * The custom player (and multiview) send the Widevine challenge to a local HTTP server here
 * instead of straight to F1's LA endpoint, so each concurrent stream can carry its own
 * entitlement/DRM/playToken context (`licenseProxyStreams`, keyed by contentId:channelId) instead
 * of racing on Chromium's shared cookie jar / a singleton token. On a CloudFront HTML 403 it also
 * tries a handful of known-good LA URL variants before giving up.
 */

const http = require('http');
const { session } = require('electron');
const f1tv = require('./f1tv-bridge');
const sessionState = require('./session');
const { redact, parseJwtPayload, isFormula1Hostname, hasFormula1Host } = require('./util');

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

function clearStreams() {
  licenseProxyStreams.clear();
}

/** `player:getLastLicenseError` IPC: the named stream's error, or the most recently failed one. */
function getLastLicenseError(streamKey) {
  if (streamKey && licenseProxyStreams.has(streamKey)) {
    return licenseProxyStreams.get(streamKey).lastError || '';
  }
  let latest = '';
  for (const entry of licenseProxyStreams.values()) {
    if (entry.lastError) latest = entry.lastError;
  }
  return latest;
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
  // Ignore PRE/requestId, CloudFront changes Request ID every time so JSON never matches.
  return [summary.h1 || '', summary.h2 || '', summary.generatedBy || ''].join('');
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

  // If primary LA was WEB_DASH widevine (pipeline 5+), try BIG_SCREEN_DASH widevine, same pattern as older third-party clients (HLS/DASH).
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
  if (!la.startsWith('https://') || !hasFormula1Host(la)) return null;
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
  // X-F1OV-Cookie marker; Chromium's auto-cookie attachment is bypassed for this request, so
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

        if (r.status === 403 && sessionState.memSession.accessToken) {
          try {
            if (sessionState.isTokenExpired(sessionState.memSession.accessToken)) await sessionState.silentTokenRefresh();
            else await f1tv.initClient(sessionState.memSession.accessToken);
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
            for (const att of attempts) {
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
    if (hasFormula1Host(url) && (url.includes('/LA') || url.includes('/CONTENT/LA'))) {
      console.log('[license] LA response status:', details.statusCode, details.statusCode >= 400 ? '(request rejected)' : '');
    }
  });
}

/** Manifest/init/segments on F1 CDNs; without ascendon/entitlement headers many pipeline-3 VODs return HTTP 403. */
function isF1OttVideoCdnUrl(urlString) {
  try {
    const h = new URL(urlString).hostname;
    return h.includes('ott-video') && isFormula1Hostname(h);
  } catch {
    return false;
  }
}

/** Injects ascendon/entitlement and cookies on F1 license acquisition and ott-video CDN requests. */
function setupLicenseRequestHeaders() {
  session.defaultSession.webRequest.onBeforeSendHeaders(async (details, callback) => {
    const url = details.url || '';
    const isF1License = hasFormula1Host(url) && (url.includes('/LA') || url.includes('/CONTENT/LA'));
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
    // inconsistently across releases, so exact-case lookups silently miss).
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
      // playToken values. Do NOT touch them: overwriting with the singleton f1tv defaults
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

/** Installs all three webRequest hooks (dev CORS relax, LA response logging, LA/CDN header injection). */
function installWebRequestHooks() {
  setupCorsRelaxForDev();
  setupLicenseResponseLog();
  setupLicenseRequestHeaders();
}

module.exports = {
  startLicenseProxy,
  installWebRequestHooks,
  registerLicenseStream,
  buildStreamKey,
  clearStreams,
  getLastLicenseError,
};
