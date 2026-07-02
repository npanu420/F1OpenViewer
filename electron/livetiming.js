/**
 * F1 Live Timing data backbone (main process).
 *
 * Live timing is a separate, DRM-free public system from F1 TV video. It has two transports
 * that deliver byte-identical JSON feeds, so a single parser/reducer serves both:
 *   - Replay/VOD: static `.jsonStream` files under https://livetiming.formula1.com/static/{Path}
 *   - Live:       SignalR WebSocket at https://livetiming.formula1.com/signalr (auth-gated)
 *
 * This module (M1) owns parsing, decompression, and the static archive fetch. The SignalR
 * transport and the state reducer are layered on top in later milestones, reusing these helpers.
 */

const zlib = require('zlib');
const { execFile } = require('child_process');
const { fetch: undiciFetch } = require('undici');

const LIVETIMING_BASE = 'https://livetiming.formula1.com';
const STATIC_BASE = `${LIVETIMING_BASE}/static`;

/** Feeds whose payload is a base64-encoded raw-deflate blob (vs. plain JSON). */
const COMPRESSED_FEEDS = new Set(['CarData.z', 'Position.z']);

/** CarData channel ids → meaning (telemetry overlay). */
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
  'CarData.z',
  'Position.z',
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

/** base64 raw-deflate blob → parsed JSON object (CarData.z / Position.z). */
function inflateZ(b64) {
  const buf = Buffer.from(String(b64), 'base64');
  const json = zlib.inflateRawSync(buf).toString('utf8');
  return JSON.parse(json);
}

/**
 * Decode one jsonStream record payload for a feed.
 * - Plain feeds: payload is a JSON value → JSON.parse.
 * - Compressed feeds: payload is a JSON-quoted base64 string → unquote → inflateRaw → JSON.parse.
 * Returns null on malformed input (a single bad record must not abort the whole stream).
 */
function decodePayload(feed, payloadStr) {
  if (payloadStr == null) return null;
  try {
    if (isCompressedFeed(feed)) {
      const b64 = JSON.parse(payloadStr); // quoted base64 string → string
      return inflateZ(b64);
    }
    return JSON.parse(payloadStr);
  } catch (_) {
    return null;
  }
}

/**
 * Parse a `.jsonStream` body into ordered records.
 * Format: newline-delimited; each line = `HH:MM:SS.mmm` (12 chars) + payload.
 * @returns {{offsetMs:number, ts:string, data:any}[]}
 */
function parseJsonStream(text, feed) {
  const out = [];
  const body = stripBom(text);
  if (!body) return out;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/^﻿/, '');
    if (line.length < 12) continue;
    const ts = line.slice(0, 12);
    const offsetMs = parseOffset(ts);
    if (offsetMs == null) continue;
    const data = decodePayload(feed, line.slice(12));
    if (data == null) continue;
    out.push({ offsetMs, ts, data });
  }
  return out;
}

/** Lowercase, strip diacritics, canonicalize known F1TV↔archive aliases, collapse spaces. */
function normalizeName(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\bbarcelona\b/g, 'spanish') // 2026 archive: "Barcelona GP" === F1TV "Spanish GP"
    .replace(/\s+/g, ' ')
    .trim();
}

/** F1TV `type` enum → archive session Name (lowercased). Practice/sprint-qual rely on the title. */
const SESSION_TYPE_TO_NAME = { race: 'race', qualifying: 'qualifying', sprint: 'sprint' };

/**
 * Find a session's archive Path in a season Index.json.
 * Replays resolve by name: F1TV titles are noisy ("FORMULA 1 HEINEKEN CHINESE GRAND PRIX 2026",
 * session title "2026 Chinese Grand Prix"), so meetings match by substring either direction and
 * sessions match by exact title → archive-name-contained-in-title → `type` mapping.
 * @param {object} index - parsed Index.json
 * @param {{sessionKey?:string|number, meetingKey?:string|number, meetingName?:string, sessionName?:string, sessionType?:string}} q
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
  // Trailing number in the session title (e.g. "Practice 2" / "Prove Libere 2" → 2) to disambiguate
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
    if (typeName && n && n === typeName) return 6;             // type → archive Name
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
    execFile(WIN_CURL, args, { maxBuffer: 256 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
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
    execFile(WIN_CURL, args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
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

/** Season index: meetings → sessions → Path/Key. */
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

// MultiViewer's open, no-auth curated sync API. Returns the video→timing anchor (`session_start`,
// seconds) + per-channel camera diffs they computed once and serve to everyone. Same value their
// app uses for "perfect" auto-sync; we just read it instead of making the user hand-align.
const MV_SYNC_BASE = 'https://api.multiviewer.app/api/v1';

function curlGetText(url) {
  return new Promise((resolve, reject) => {
    const args = ['-s', '-S', '--compressed', '--max-time', '20', '-w', '\\n%{http_code}',
      '-H', 'User-Agent: F1OpenViewer', '-H', 'Accept: application/json', url];
    execFile(WIN_CURL, args, { maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err) return reject(new Error(`curl ${url} failed: ${err.message}`));
      const nl = stdout.lastIndexOf('\n');
      const code = Number(stdout.slice(nl + 1).trim());
      if (code < 200 || code >= 300) return reject(new Error(`GET ${url} → HTTP ${code}`));
      resolve(stdout.slice(0, nl));
    });
  });
}

async function httpGetText(url) {
  if (USE_CURL) return curlGetText(url); // curl.exe is VPN-split-tunnelled; reaches it directly
  const res = await undiciFetch(url, { headers: { 'User-Agent': 'F1OpenViewer', Accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return res.text();
}

/**
 * Fetch MultiViewer's curated sync record for a session. Returns the video→timing offset in seconds
 * and per-channel diffs, or null if the session isn't synced / the request fails.
 * @returns {{sessionStartSec:number, channelDiffs:Record<string,{diff:number,diffV2:number}>, contentId:string|null}|null}
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
};
