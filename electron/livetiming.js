/**
 * Parses archived F1 timing feeds and manages the live SignalR Core connection.
 * Live connections are anonymous because F1TV account tokens use a different backend.
 */

const zlib = require('zlib');
const { execFile } = require('child_process');
const { fetch: undiciFetch } = require('undici');
const WebSocket = require('ws');

const LIVETIMING_BASE = 'https://livetiming.formula1.com';
const STATIC_BASE = `${LIVETIMING_BASE}/static`;

/** Feeds whose payload is a base64-encoded raw-deflate blob (vs. plain JSON). */
const COMPRESSED_FEEDS = new Set(['CarData.z', 'Position.z']);

/** Maps CarData channel IDs to telemetry fields. */
const CAR_DATA_CHANNELS = { RPM: 0, Speed: 2, Gear: 3, Throttle: 4, Brake: 5, DRS: 45 };

/** The feeds a MultiViewer-style timing screen subscribes to. */
const DEFAULT_FEEDS = [
  'SessionInfo',
  'DriverList',
  'TimingData',
  'TimingAppData',
  'TimingStats',
  'WeatherData',
  'TrackStatus',
  'RaceControlMessages',
  'ExtrapolatedClock',
  'LapCount',
  'TeamRadio',
  'SessionData',
  'TopThree',
];

/** Strip a leading UTF-8 BOM (static files start with one). */
function stripBom(text) {
  if (typeof text !== 'string') return '';
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Parse a session-relative timestamp `HH:MM:SS.mmm` (12 chars) into milliseconds.
 * Returns null when the shape doesn't match.
 */
function parseOffset(ts) {
  if (typeof ts !== 'string') return null;
  const m = ts.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/);
  if (!m) return null;
  const [, h, min, s, ms] = m;
  return ((Number(h) * 60 + Number(min)) * 60 + Number(s)) * 1000 + Number(ms);
}

/** Inverse of parseOffset: `123456` becomes `00:02:03.456`. Used by tests and replay tooling. */
function formatOffset(totalMs) {
  if (!Number.isFinite(totalMs) || totalMs < 0) return '00:00:00.000';
  const ms = Math.floor(totalMs % 1000);
  const totalS = Math.floor(totalMs / 1000);
  const s = totalS % 60;
  const min = Math.floor(totalS / 60) % 60;
  const h = Math.floor(totalS / 3600);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(h)}:${p2(min)}:${p2(s)}.${String(ms).padStart(3, '0')}`;
}

function isCompressedFeed(feed) {
  return COMPRESSED_FEEDS.has(feed);
}

/** Inflates a base64 raw-deflate telemetry payload. */
function inflateZ(b64) {
  const buf = Buffer.from(String(b64), 'base64');
  const json = zlib.inflateRawSync(buf).toString('utf8');
  return JSON.parse(json);
}

/**
 * Decode one jsonStream record payload for a feed.
 * Plain feeds contain JSON. Compressed feeds contain a JSON-quoted base64 payload.
 * Returns null on malformed input (a single bad record must not abort the whole stream).
 */
function decodePayload(feed, payloadStr) {
  if (payloadStr == null) return null;
  try {
    if (isCompressedFeed(feed)) {
      const b64 = JSON.parse(payloadStr);
      return inflateZ(b64);
    }
    return JSON.parse(payloadStr);
  } catch (_) {
    return null;
  }
}

/**
 * CarData.z/Position.z arrive roughly every ~250ms and each already bundles a few timestamped
 * snapshots, so a full session is ~30-35k snapshots per feed. Sent whole, that's an ~80MB IPC
 * payload the renderer has to deserialize into millions of JS objects synchronously on its one
 * thread, which is slow enough to look like a frozen window (confirmed: only that window froze,
 * not the video window, since each Electron window is its own process). Keeping 1 line in
 * SAMPLE_STRIDE cuts the payload proportionally. Skipped lines aren't even decoded, so this
 * also cuts the main-process decode cost, not just the transfer size.
 */
const SAMPLE_STRIDE = 5;

/**
 * Parse a `.jsonStream` body into ordered records.
 * Format: newline-delimited; each line = `HH:MM:SS.mmm` (12 chars) + payload.
 * @returns {{offsetMs:number, ts:string, data:any}[]}
 */
function parseJsonStream(text, feed) {
  const out = [];
  const body = stripBom(text);
  if (!body) return out;
  const stride = isCompressedFeed(feed) ? SAMPLE_STRIDE : 1;
  let i = 0;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/^﻿/, '');
    if (line.length < 12) continue;
    const ts = line.slice(0, 12);
    const offsetMs = parseOffset(ts);
    if (offsetMs == null) continue;
    const keep = i++ % stride === 0;
    if (!keep) continue;
    const data = decodePayload(feed, line.slice(12));
    if (data == null) continue;
    out.push({ offsetMs, ts, data });
  }
  return out;
}

/** Normalizes names and aliases shared by F1TV and the timing archive. */
function normalizeName(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\bbarcelona\b/g, 'spanish') // 2026 archive: "Barcelona GP" === F1TV "Spanish GP"
    .replace(/\s+/g, ' ')
    .trim();
}

/** Maps F1TV session types to lowercase timing archive names. */
const SESSION_TYPE_TO_NAME = { race: 'race', qualifying: 'qualifying', sprint: 'sprint' };

/**
 * Find a session's archive Path in a season Index.json.
 * Replays resolve by name: F1TV titles are noisy ("FORMULA 1 HEINEKEN CHINESE GRAND PRIX 2026",
 * session title "2026 Chinese Grand Prix"), so meetings match by substring either direction and
 * sessions match by exact title, contained archive name, and then `type` mapping.
 * @param {object} index - parsed Index.json
 * @param {{sessionKey?:string|number, meetingKey?:string|number, meetingName?:string,
 * sessionName?:string, sessionType?:string}} q
 * @returns {{path:string, meeting:object, session:object}|null}
 */
function findSession(index, q = {}) {
  const meetings = index?.Meetings;
  if (!Array.isArray(meetings)) return null;
  const wantSession = q.sessionKey != null ? String(q.sessionKey) : null;
  const wantMeeting = q.meetingKey != null ? String(q.meetingKey) : null;
  const wantMeetingNumber = q.meetingNumber != null && q.meetingNumber !== '' ? Number(q.meetingNumber) : null;
  const wantMeetingName = q.meetingName ? normalizeName(q.meetingName) : null;
  const wantName = q.sessionName ? normalizeName(q.sessionName) : null;
  const wantType = q.sessionType ? String(q.sessionType).toLowerCase() : null;
  const typeName = wantType ? SESSION_TYPE_TO_NAME[wantType] : null;
  // A trailing practice number disambiguates sessions with the same type.
  // the three practices when the title is localized and the archive Name doesn't match.
  const numMatch = q.sessionName ? String(q.sessionName).match(/(\d+)\s*$/) : null;
  const wantSessionNum = numMatch ? Number(numMatch[1]) : null;
  // "Sprint" is a brand term and rarely gets translated, so use it to split Sprint vs Race and
  // Sprint-Q vs Q on sprint weekends, where the archive session Type is identical for both.
  const wantIsSprint = q.sessionName ? /sprint/i.test(String(q.sessionName)) : false;

  // Meeting names are localized per F1TV account ("Gran Premio d'Italia" vs archive "Italian Grand
  // Prix"), so match on the language-stable round Number when given, falling back to name substring.
  const meetingMatches = (meeting) => {
    if (wantMeeting) return String(meeting?.Key) === wantMeeting;
    const byNumber = wantMeetingNumber != null && Number(meeting?.Number) === wantMeetingNumber;
    const mn = normalizeName(meeting?.Name);
    const byName = wantMeetingName != null && !!mn && (mn.includes(wantMeetingName) || wantMeetingName.includes(mn));
    if (wantMeetingNumber == null && wantMeetingName == null) return true; // no meeting filter
    return byNumber || byName;
  };

  // Score a candidate so the *most specific* match wins (e.g. "Sprint Qualifying" over "Qualifying"),
  // independent of session order. Uses the archive session Type (language-stable) + the title. 0 = no match.
  const scoreSession = (session) => {
    const n = normalizeName(session?.Name);
    const type = String(session?.Type || '').toLowerCase();
    if (wantName && n && n === wantName) return 100;            // exact title
    if (wantName && n && wantName.includes(n)) return 10 + n.length; // archive name inside title
    // Type matches (handles localized titles); refine by practice number + sprint/non-sprint variant.
    if (wantType && type && type === wantType) {
      const numOk = wantSessionNum != null && session?.Number != null && Number(session.Number) === wantSessionNum;
      const archiveIsSprint = /\bsprint\b/.test(n);
      let score = numOk ? 8 : 5;
      score += wantIsSprint === archiveIsSprint ? 1 : -3; // wrong sprint variant loses
      return score;
    }
    if (typeName && n && n === typeName) return 6;
    return 0;
  };

  for (const meeting of meetings) {
    if (!meetingMatches(meeting)) continue;
    let best = null;
    let bestScore = 0;
    for (const session of meeting?.Sessions || []) {
      if (wantSession) {
        if (String(session?.Key) === wantSession) return { path: session.Path, meeting, session };
        continue;
      }
      const score = scoreSession(session);
      if (score > bestScore) {
        bestScore = score;
        best = { path: session.Path, meeting, session };
      }
    }
    if (best) return best;
  }
  return null;
}

// ----- network (thin; covered by integration/manual checks, not unit tests) -----

const STATIC_HEADERS = { 'User-Agent': 'BestHTTP' };

/**
 * On Windows we fetch the archive via the system `curl.exe` (a separate process) rather than
 * in-process undici. This lets a full-tunnel VPN (e.g. NordVPN, which only split-tunnels by app)
 * exclude *just* `curl.exe`, so live-timing leaves on the real IP while F1TV video stays on the
 * VPN. The livetiming host's WAF blocks many VPN exit IPs, so this is the only way to keep both.
 * Set LIVETIMING_NO_CURL=1 to force in-process fetch.
 */
const WIN_CURL = 'C:\\Windows\\System32\\curl.exe';
const USE_CURL = process.platform === 'win32' && process.env.LIVETIMING_NO_CURL !== '1';

function curlFetchText(url) {
  return new Promise((resolve, reject) => {
    const args = ['-s', '-S', '--compressed', '--max-time', '30', '-w', '\\n%{http_code}'];
    for (const [k, v] of Object.entries(STATIC_HEADERS)) args.push('-H', `${k}: ${v}`);
    args.push(url);
    // Node-level backstop on top of curl's own --max-time: if curl itself gets stuck (seen on
    // some Windows/VPN combos where --max-time doesn't fire reliably), this still kills it
    // instead of the caller hanging forever.
    execFile(WIN_CURL, args, { maxBuffer: 256 * 1024 * 1024, windowsHide: true, timeout: 35000 }, (err, stdout) => {
      if (err) return reject(new Error(`curl ${url} failed: ${err.message}`));
      const nl = stdout.lastIndexOf('\n');
      const code = Number(stdout.slice(nl + 1).trim());
      if (code < 200 || code >= 300) return reject(new Error(`GET ${url} → HTTP ${code}`));
      resolve(stdout.slice(0, nl));
    });
  });
}

async function fetchText(url) {
  if (USE_CURL) return curlFetchText(url);
  const res = await undiciFetch(url, { headers: STATIC_HEADERS });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return res.text();
}

/** Same VPN-split-tunnel rationale as curlFetchText, but for binary payloads (team radio mp3s).
 *  The renderer's own network stack can't reach this host either, so audio has to go through curl too. */
function curlFetchBinary(url) {
  return new Promise((resolve, reject) => {
    const args = ['-s', '-S', '--max-time', '30'];
    for (const [k, v] of Object.entries(STATIC_HEADERS)) args.push('-H', `${k}: ${v}`);
    args.push(url);
    execFile(WIN_CURL, args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: 35000 }, (err, stdout) => {
      if (err) return reject(new Error(`curl ${url} failed: ${err.message}`));
      if (!stdout || !stdout.length) return reject(new Error(`GET ${url} → empty response`));
      resolve(stdout);
    });
  });
}

async function fetchBinary(url) {
  if (USE_CURL) return curlFetchBinary(url);
  const res = await undiciFetch(url, { headers: STATIC_HEADERS });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Fetch a team radio clip and return it as a base64 string (renderer builds a data: URL from it). */
async function fetchTeamRadioClip(sessionPath, clipPath) {
  const p = String(sessionPath || '').replace(/^\/+/, '');
  const cp = String(clipPath || '').replace(/^\/+/, '');
  const buf = await fetchBinary(`${STATIC_BASE}/${p}${cp}`);
  return buf.toString('base64');
}

async function getIndex(year) {
  const txt = await fetchText(`${STATIC_BASE}/${year}/Index.json`);
  return JSON.parse(stripBom(txt));
}

/** Fetch + parse one feed's full archived stream for a session Path. */
async function getSessionFeed(sessionPath, feed) {
  const p = String(sessionPath || '').replace(/^\/+/, '');
  const txt = await fetchText(`${STATIC_BASE}/${p}${feed}.jsonStream`);
  return parseJsonStream(txt, feed);
}

/** Light feed set for replay (excludes the heavy per-tick telemetry blobs). */
const REPLAY_FEEDS = DEFAULT_FEEDS.filter((f) => !COMPRESSED_FEEDS.has(f));

/** Resolve a season + session query to its archive Path via Index.json. */
async function resolveSessionPath(year, query) {
  const index = await getIndex(year);
  const found = findSession(index, query || {});
  return found ? { path: found.path, meeting: found.meeting, session: found.session } : null;
}

/**
 * Fetch + parse every requested feed for a session in parallel. Missing feeds (some sessions
 * lack TeamRadio / TopThree) resolve to [] instead of failing the whole load.
 * @returns {Record<string, {offsetMs:number, ts:string, data:any}[]>}
 */
async function loadSession(sessionPath, feeds) {
  const list = Array.isArray(feeds) && feeds.length ? feeds : REPLAY_FEEDS;
  const results = await Promise.all(
    list.map((feed) => getSessionFeed(sessionPath, feed).catch(() => []))
  );
  const out = {};
  list.forEach((feed, i) => {
    if (results[i].length) out[feed] = results[i];
  });
  return out;
}

// MultiViewer's open, no-auth curated sync API. Returns the video-to-timing anchor (`session_start`,
// seconds) + per-channel camera diffs they computed once and serve to everyone. Same value their
// app uses for "perfect" auto-sync; we just read it instead of making the user hand-align.
const MV_SYNC_BASE = 'https://api.multiviewer.app/api/v1';

function curlGetText(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-s', '-S', '--compressed', '--max-time', '20', '-w', '\\n%{http_code}',
      '-H', 'User-Agent: F1OpenViewer', '-H', 'Accept: application/json'];
    for (const [k, v] of Object.entries(extraHeaders)) args.push('-H', `${k}: ${v}`);
    args.push(url);
    execFile(WIN_CURL, args, { maxBuffer: 32 * 1024 * 1024, windowsHide: true, timeout: 25000 }, (err, stdout) => {
      if (err) return reject(new Error(`curl ${url} failed: ${err.message}`));
      const nl = stdout.lastIndexOf('\n');
      const code = Number(stdout.slice(nl + 1).trim());
      if (code < 200 || code >= 300) return reject(new Error(`GET ${url} → HTTP ${code}`));
      resolve(stdout.slice(0, nl));
    });
  });
}

async function httpGetText(url, extraHeaders = {}) {
  if (USE_CURL) return curlGetText(url, extraHeaders); // curl.exe is VPN-split-tunnelled; reaches it directly
  const res = await undiciFetch(url, { headers: { 'User-Agent': 'F1OpenViewer', Accept: 'application/json', ...extraHeaders } });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return res.text();
}

/**
 * Fetch MultiViewer's curated sync record for a session. Returns the video-to-timing offset in seconds
 * and per-channel diffs, or null if the session isn't synced / the request fails.
 * @returns {{sessionStartSec:number,
 * channelDiffs:Record<string,{diff:number,diffV2:number}>, contentId:string|null}|null}
 */
async function fetchSyncData(meetingKey, sessionKey) {
  if (meetingKey == null || sessionKey == null) return null;
  try {
    const txt = await httpGetText(`${MV_SYNC_BASE}/meetings/${meetingKey}/sessions/${sessionKey}`);
    const j = JSON.parse(stripBom(txt));
    const start = j && j.session_start != null ? parseFloat(j.session_start) : NaN;
    if (!Number.isFinite(start)) return null;
    const offs = j.sync_offsets && Array.isArray(j.sync_offsets.sync_offsets) ? j.sync_offsets.sync_offsets : [];
    const channelDiffs = {};
    for (const o of offs) {
      const cid = o && o.streamData && o.streamData.channelId;
      if (cid != null) channelDiffs[cid] = { diff: Number(o.diff) || 0, diffV2: Number(o.diffV2) || 0 };
    }
    return { sessionStartSec: start, channelDiffs, contentId: j.f1tv_content_id || null };
  } catch (_) {
    return null;
  }
}

// SignalR Core uses an ALB affinity cookie, a negotiate request, and a WebSocket handshake.
// The socket runs in Electron, so application-based VPN split tunneling may not bypass its WAF.

const SIGNALR_RS = '\x1e';
const CORE_KEEPALIVE_MS = 15000;
const LIVE_RECONNECT_MS = 2000;

let liveSocket = null;
let liveReconnectTimer = null;
let liveKeepaliveTimer = null;

function curlOptionsCookie(url) {
  return new Promise((resolve, reject) => {
    const args = ['-s', '-S', '--max-time', '15', '-i', '-X', 'OPTIONS'];
    for (const [k, v] of Object.entries(STATIC_HEADERS)) args.push('-H', `${k}: ${v}`);
    args.push(url);
    execFile(WIN_CURL, args, { maxBuffer: 1024 * 1024, windowsHide: true, timeout: 20000 }, (err, stdout) => {
      if (err) return reject(new Error(`curl OPTIONS ${url} failed: ${err.message}`));
      resolve(stdout);
    });
  });
}

function curlPostText(url, headers) {
  return new Promise((resolve, reject) => {
    const args = ['-s', '-S', '--max-time', '15', '-X', 'POST', '-w', '\n%{http_code}'];
    for (const [k, v] of Object.entries({ ...STATIC_HEADERS, ...headers })) args.push('-H', `${k}: ${v}`);
    args.push(url);
    execFile(WIN_CURL, args, { maxBuffer: 1024 * 1024, windowsHide: true, timeout: 20000 }, (err, stdout) => {
      if (err) return reject(new Error(`curl POST ${url} failed: ${err.message}`));
      const nl = stdout.lastIndexOf('\n');
      const code = Number(stdout.slice(nl + 1).trim());
      if (code < 200 || code >= 300) return reject(new Error(`POST ${url} returned HTTP ${code}`));
      resolve(stdout.slice(0, nl));
    });
  });
}

/** Attempts to obtain the optional ALB affinity cookie. */
async function fetchAwsAlbCookie() {
  const url = `${LIVETIMING_BASE}/signalrcore/negotiate`;
  try {
    if (USE_CURL) {
      const raw = await curlOptionsCookie(url);
      const m = raw.match(/^set-cookie:\s*(AWSALBCORS=[^;]+)/im);
      return m ? m[1] : null;
    }
    const res = await undiciFetch(url, { method: 'OPTIONS', headers: STATIC_HEADERS });
    const getSetCookie = res.headers.getSetCookie;
    const cookies = typeof getSetCookie === 'function' ? getSetCookie.call(res.headers) : [res.headers.get('set-cookie')].filter(Boolean);
    const hit = cookies.find((c) => c && c.startsWith('AWSALBCORS='));
    return hit ? hit.split(';')[0] : null;
  } catch (_) {
    return null;
  }
}

async function negotiateCore(cookie) {
  const url = `${LIVETIMING_BASE}/signalrcore/negotiate?negotiateVersion=1`;
  const headers = cookie ? { Cookie: cookie } : {};
  let txt;
  if (USE_CURL) {
    txt = await curlPostText(url, headers);
  } else {
    const res = await undiciFetch(url, { method: 'POST', headers: { ...STATIC_HEADERS, ...headers } });
    if (!res.ok) throw new Error(`POST ${url} returned HTTP ${res.status}`);
    txt = await res.text();
  }
  const j = JSON.parse(stripBom(txt));
  const token = j && (j.connectionToken || j.connectionId);
  if (!token) throw new Error('SignalR Core negotiate: no connectionToken in response');
  return token;
}

/**
 * `.z` feeds (CarData.z/Position.z) arrive over the live socket the same way they do in the
 * static archive: a base64 raw-deflate string, just already JSON-parsed into a JS string (not a
 * JSON-quoted text line like jsonStream), so this inflates without decodePayload's unquoting
 * step. Returns null on a bad blob so the caller can drop the record instead of applying garbage.
 */
function decodeLiveValue(feed, value) {
  if (!isCompressedFeed(feed)) return value;
  if (typeof value !== 'string') return null;
  try { return inflateZ(value); } catch (_) { return null; }
}

function splitCoreFrames(raw) {
  const out = [];
  for (const part of String(raw).split(SIGNALR_RS)) {
    if (!part) continue;
    try { out.push(JSON.parse(part)); } catch (_) {}
  }
  return out;
}

function recordsFromCoreMessages(msgs) {
  const out = [];
  const push = (feed, rawData) => {
    const data = decodeLiveValue(feed, rawData);
    if (data != null) out.push({ feed, data });
  };
  for (const msg of msgs) {
    const isFeedUpdate = msg
      && msg.type === 1
      && msg.target === 'feed'
      && Array.isArray(msg.arguments)
      && msg.arguments.length >= 2;
    if (isFeedUpdate) {
      push(String(msg.arguments[0]), msg.arguments[1]);
    } else if (msg && msg.type === 3 && msg.result && typeof msg.result === 'object') {
      for (const feed of Object.keys(msg.result)) push(feed, msg.result[feed]);
    }
  }
  return out;
}

function parseCoreFrame(raw) {
  return recordsFromCoreMessages(splitCoreFrames(raw));
}

function sendCoreMessage(ws, message) {
  ws.send(JSON.stringify(message) + SIGNALR_RS);
}

async function connectLiveSocket(feeds, onRecord, onStatus) {
  if (liveSocket) return;
  const cookie = await fetchAwsAlbCookie();
  const token = await negotiateCore(cookie);
  const wsUrl = `wss://livetiming.formula1.com/signalrcore?id=${encodeURIComponent(token)}`;
  const ws = new WebSocket(wsUrl, {
    headers: { ...STATIC_HEADERS, ...(cookie ? { Cookie: cookie } : {}) },
  });
  liveSocket = ws;
  let handshaken = false;

  ws.on('open', () => {
    sendCoreMessage(ws, { protocol: 'json', version: 1 });
  });
  ws.on('message', (raw) => {
    const frames = splitCoreFrames(raw.toString());
    if (!handshaken) {
      if (!frames.length) return;
      const handshake = frames.shift();
      if (handshake?.error) {
        if (onStatus) onStatus('error', handshake.error);
        ws.close();
        return;
      }
      handshaken = true;
      sendCoreMessage(ws, { type: 1, invocationId: '1', target: 'Subscribe', arguments: [feeds] });
      if (onStatus) onStatus('connected');
      liveKeepaliveTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) sendCoreMessage(ws, { type: 6 });
      }, CORE_KEEPALIVE_MS);
    }
    for (const rec of recordsFromCoreMessages(frames)) onRecord(rec.feed, rec.data);
  });
  ws.on('close', () => {
    if (liveSocket !== ws) return;
    liveSocket = null;
    if (liveKeepaliveTimer) { clearInterval(liveKeepaliveTimer); liveKeepaliveTimer = null; }
    if (onStatus) onStatus('disconnected');
    liveReconnectTimer = setTimeout(() => {
      connectLiveSocket(feeds, onRecord, onStatus).catch((e) => onStatus && onStatus('error', e?.message));
    }, LIVE_RECONNECT_MS);
  });
  ws.on('error', (err) => {
    if (onStatus) onStatus('error', err && err.message);
  });
}

function disconnectLiveSocket() {
  if (liveReconnectTimer) {
    clearTimeout(liveReconnectTimer);
    liveReconnectTimer = null;
  }
  if (liveKeepaliveTimer) {
    clearInterval(liveKeepaliveTimer);
    liveKeepaliveTimer = null;
  }
  if (liveSocket) {
    try { liveSocket.close(); } catch (_) {}
    liveSocket = null;
  }
}

module.exports = {
  LIVETIMING_BASE,
  fetchSyncData,
  fetchTeamRadioClip,
  STATIC_BASE,
  COMPRESSED_FEEDS,
  CAR_DATA_CHANNELS,
  DEFAULT_FEEDS,
  stripBom,
  parseOffset,
  formatOffset,
  isCompressedFeed,
  inflateZ,
  decodePayload,
  parseJsonStream,
  findSession,
  fetchText,
  getIndex,
  getSessionFeed,
  REPLAY_FEEDS,
  resolveSessionPath,
  loadSession,
  parseCoreFrame,
  connectLiveSocket,
  disconnectLiveSocket,
};
