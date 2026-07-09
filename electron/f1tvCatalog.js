/**
 * F1 TV archive browsing: live-now, search, and the season → GP → session catalog walk.
 * Pages are plain F1TV "PAGE" containers; the parsing here maps their nested container shape
 * into the flat season/event/session lists the renderer works with.
 */

const client = require('./f1tvClient');

async function getLiveNow() {
  try {
    const c = client.getClient();
    const result = await c.liveNow();
    const items = (result?.resultObj?.items || []).map((item) => {
      const contentId = item.metadata?.contentId;
      if (!contentId) return null;
      return {
        id: String(item.id || contentId),
        title: item.metadata?.title || item.metadata?.emfAttributes?.Global_Title || 'Live',
        kind: 'live',
        contentId: Number(contentId),
        meetingKey: item.metadata?.emfAttributes?.MeetingKey,
        sessionKey: item.metadata?.emfAttributes?.SessionKey,
      };
    }).filter(Boolean);
    return items;
  } catch (e) {
    return [];
  }
}

async function searchVod(params = {}) {
  try {
    const c = client.getClient();
    const result = await c.searchVod(params);
    const containers = result?.resultObj?.containers || [];
    const items = containers.map((con) => {
      const contentId = con.metadata?.contentId ?? con.id;
      if (contentId == null) return null;
      return {
        id: String(con.id ?? contentId),
        title: con.metadata?.title || con.uiMetadata?.mainTitle || 'VOD',
        kind: 'replay',
        season: con.metadata?.season != null ? String(con.metadata.season) : undefined,
        contentId: Number(contentId),
      };
    }).filter(Boolean);
    return items;
  } catch (e) {
    return [];
  }
}

/**
 * F1 TV archive page ID and mapping year → season pageId.
 * Obtained by exploring https://f1tv.formula1.com/2.0/A/ENG/WEB_DASH/ALL/PAGE/493/F1_TV_Pro_Annual/2
 */
const ARCHIVE_PAGE_ID = 493;
const LEGACY_SEASON_PAGE_TO_YEAR = {
  12343: 2026,
  10295: 2025,
  8192: 2024,
  6603: 2023,
  4319: 2022,
  1510: 2021,
  392: 2020,
  2128: 2019,
  2130: 2018,
};

async function inferSeasonYearFromPage(pageId) {
  try {
    const containers = await client.fetchPage(pageId);
    const years = [];
    for (const c of containers) {
      const subs = c.retrieveItems?.resultObj?.containers || [];
      for (const s of subs) {
        const text = `${s.title || ''} ${s.metadata?.title || ''} ${s.metadata?.plainText || ''}`;
        const m = text.match(/\b(20\d{2}|19\d{2})\b/);
        if (m) years.push(Number(m[1]));
      }
    }
    if (!years.length) return null;
    const counts = new Map();
    for (const y of years) counts.set(y, (counts.get(y) || 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  } catch (_) {
    return null;
  }
}

function mapSubtypeToSessionType(subtype, videoType) {
  const s = String(subtype || videoType || '').toLowerCase();
  if (s === 'live') return 'other';
  if (s.includes('sprint') && s.includes('race')) return 'sprint';
  if (s.includes('sprint')) return 'sprint';
  if ((s.includes('race') || s === 'replay') && !s.includes('qualifying') && !s.includes('practice')) return 'race';
  if (s.includes('qualifying') || s === 'q') return 'qualifying';
  if (s.includes('practice') || s.includes('fp')) return 'practice';
  if (s.includes('onboard') || s === 'obc') return 'onboard';
  if (s.includes('highlight')) return 'other';
  return 'other';
}

/**
 * Extracts all GP containers from a season page.
 * Each GP container has an action with pageId for the GP page.
 */
function extractEventsFromSeasonPage(containers) {
  const events = [];
  const nowMs = Date.now();
  for (const c of containers) {
    const subs = c.retrieveItems?.resultObj?.containers || [];
    for (const s of subs) {
      const action = s.actions?.find(a => a.key === 'onClick');
      if (!action?.uri) continue;
      const meta = s.metadata || {};
      const emf = meta.emfAttributes || {};
      const props = (s.properties && s.properties[0]) || {};
      const title = s.title || meta.title || '';
      // Filter only F1 GP/meetings (exclude F2, F3, etc.)
      const isF1GP = (
        String(title).toUpperCase().includes('GRAND PRIX') ||
        String(title).toUpperCase().includes('FORMULA 1') ||
        emf.VideoType === 'meetings' ||
        meta.contentSubtype === 'MEETING'
      ) && !String(title).toUpperCase().includes(' F2 ') && !String(title).toUpperCase().includes(' F3 ');
      if (!isF1GP) continue;
      // Do not show future events (e.g. races not yet run in the current season).
      const meetingStartMs = Number(props.meeting_Start_Date || props.meeting_start_date || 0);
      if (Number.isFinite(meetingStartMs) && meetingStartMs > 0 && meetingStartMs > nowMs) {
        continue;
      }
      // Extract pageId from URI: /2.0/A/ENG/WEB_DASH/ALL/PAGE/{pageId}/...
      const pageIdMatch = action.uri.match(/\/PAGE\/(\d+)\//);
      if (!pageIdMatch) continue;
      events.push({
        pageId: Number(pageIdMatch[1]),
        meetingName: String(title).trim(),
        contentId: meta.contentId,
        meetingNumber: Number(props.meeting_Number || emf.Meeting_Number || 0),
      });
    }
  }
  return events;
}

/**
 * Extracts the sessions from a GP page.
 * Returns { sessions, onboard } where sessions are FP/Q/Race/Sprint and onboard are OBC channels.
 */
function extractSessionsFromGPPage(containers) {
  const sessions = [];
  const onboard = [];
  for (const c of containers) {
    const containerTitle = String(c.title || '').toLowerCase();
    // Salta F2/F3/Porsche/W-Series/ecc.
    if (/formula [23]|porsche|w series|f[23]:/i.test(containerTitle)) continue;
    const subs = c.retrieveItems?.resultObj?.containers || [];
    for (const s of subs) {
      const meta = s.metadata || {};
      const emf = meta.emfAttributes || {};
      const contentId = meta.contentId;
      if (!contentId) continue;
      const title = s.title || meta.title || '';
      const subtype = meta.contentSubtype || '';
      const videoType = emf.VideoType || '';
      // Skip F2/F3 content
      if (/\bF[23]\b/.test(title)) continue;
      const type = mapSubtypeToSessionType(subtype, videoType);
      // Main sessions only: meetingSession REPLAY (FP, Q, race, sprint).
      if (videoType === 'meetingSession' && subtype === 'REPLAY') {
        sessions.push({ contentId, title: String(title).trim(), type });
      }
    }
  }
  return { sessions, onboard };
}

/**
 * Returns the list of seasons available in the F1 TV archive.
 * Each season has: { year, pageId }
 */
async function getVodSeasons() {
  console.log('[VOD] getVodSeasons: loading archive page', ARCHIVE_PAGE_ID);
  const archiveContainers = await client.fetchPage(ARCHIVE_PAGE_ID);
  const seasonItems = archiveContainers.flatMap((c) => c.retrieveItems?.resultObj?.containers || []);
  if (!seasonItems.length) throw new Error('No season items found on archive page.');
  const seasonsMap = new Map();
  const unresolved = [];
  for (const s of seasonItems) {
    const action = s.actions?.find(a => a.key === 'onClick');
    if (!action?.uri) continue;
    const pageIdMatch = action.uri.match(/\/PAGE\/(\d+)\//);
    if (!pageIdMatch) continue;
    const pageId = Number(pageIdMatch[1]);
    const yearMatch = `${action.href || ''} ${action.uri || ''} ${s.title || ''} ${s.metadata?.title || ''} ${s.metadata?.plainText || ''}`.match(/(20\d{2}|19\d{2})/);
    const year = yearMatch ? Number(yearMatch[1]) : (LEGACY_SEASON_PAGE_TO_YEAR[pageId] || 0);
    if (year >= 2018 && year <= new Date().getFullYear()) {
      seasonsMap.set(year, { year, pageId });
    } else {
      // Avoid probing non-season pages (e.g. full-race-replays-and-highlights)
      const href = String(action.href || '').toLowerCase();
      if (href.includes('season')) unresolved.push(pageId);
    }
  }
  // Dynamic fallback: deduce year directly from the season page (covers new seasons, e.g. 2026).
  for (const pageId of unresolved) {
    const inferredYear = await inferSeasonYearFromPage(pageId);
    if (!inferredYear) continue;
    if (inferredYear < 2018 || inferredYear > new Date().getFullYear()) continue;
    if (!seasonsMap.has(inferredYear)) {
      seasonsMap.set(inferredYear, { year: inferredYear, pageId });
      console.log(`[VOD] inferred year ${inferredYear} from page ${pageId}`);
    }
  }
  // Explicit fallback: some recent seasons do not always appear in PAGE/493.
  for (const [pageIdStr, y] of Object.entries(LEGACY_SEASON_PAGE_TO_YEAR)) {
    const pageId = Number(pageIdStr);
    if (y >= 2018 && y <= new Date().getFullYear() && !seasonsMap.has(y)) {
      seasonsMap.set(y, { year: y, pageId });
    }
  }
  const seasons = Array.from(seasonsMap.values()).sort((a, b) => b.year - a.year);
  console.log('[VOD] seasons:', seasons.map(s => `${s.year}(page:${s.pageId})`).join(', '));
  return seasons;
}

/**
 * Returns the list of GPs for a season given the season pageId.
 * Each GP has: { pageId, meetingName, meetingNumber }
 */
async function getVodEvents(seasonPageId) {
  console.log('[VOD] getVodEvents: loading season page', seasonPageId);
  const containers = await client.fetchPage(seasonPageId);
  const gpItems = extractEventsFromSeasonPage(containers);
  console.log('[VOD] events found (held only):', gpItems.length);
  return gpItems.map((gp, i) => ({
    meetingKey: String(gp.pageId),
    meetingName: gp.meetingName,
    meetingNumber: gp.meetingNumber || (i + 1),
    pageId: gp.pageId,
  }));
}

/**
 * Returns the sessions (FP, Q, Race, Sprint) of a GP given the GP pageId.
 */
async function getVodSessions(gpPageId) {
  console.log('[VOD] getVodSessions: loading event page', gpPageId);
  const containers = await client.fetchPage(gpPageId);
  const { sessions } = extractSessionsFromGPPage(containers);
  console.log('[VOD] sessions found:', sessions.length);
  return sessions;
}

/**
 * Full VOD catalog (legacy, loads everything at once).
 * Prefer getVodSeasons + getVodEvents + getVodSessions for lazy loading.
 */
async function getVodCatalog() {
  const result = { seasons: [] };
  try {
    const seasons = await getVodSeasons();
    for (const { year, pageId } of seasons) {
      const events = await getVodEvents(pageId).catch(e => {
        console.warn(`[VOD] season ${year} failed:`, e.message);
        return [];
      });
      if (!events.length) continue;
      result.seasons.push({ year, events: events.map(ev => ({ ...ev, sessions: [], onboard: [] })) });
    }
    console.log('[VOD] catalog (seasons+events only):', result.seasons.map(s => `${s.year}(${s.events.length} events)`).join(', '));
  } catch (e) {
    console.error('[VOD] getVodCatalog failed:', e?.message, e?.stack);
  }
  return result;
}

function isObcStream(s) {
  return s.type === 'obc' || s.identifier === 'OBC' || String(s.type || '').toLowerCase().includes('onboard');
}

function isDataStream(s) {
  return s.identifier === 'DATA' || String(s.type || '').toLowerCase().includes('data');
}

/** World feed / presentation channel from additionalStreams (live multiview main). */
function pickMainChannelStream(additional) {
  if (!Array.isArray(additional)) return null;
  const eligible = additional.filter((s) => s.channelId && !isObcStream(s) && !isDataStream(s));
  if (!eligible.length) return null;
  return (
    eligible.find((s) => s.default === true)
    || eligible.find((s) => String(s.identifier || '').toUpperCase() === 'PRES')
    || eligible.find((s) => String(s.identifier || '').toUpperCase() === 'WIF')
    || eligible[0]
  );
}

/**
 * Content details for additional streams (onboard).
 */
async function getContentVideo(contentId) {
  try {
    const c = client.getClient();
    const container = await c.contentVideo(contentId);
    const meta = container?.metadata || {};
    const additional = meta.additionalStreams || [];
    const onboard = [];
    const dataChannel = [];
    let mainChannel = null;
    const mainPick = pickMainChannelStream(additional);
    if (mainPick?.channelId) {
      mainChannel = {
        contentId: meta.contentId || contentId,
        channelId: mainPick.channelId,
        title: mainPick.title || mainPick.reportingName || meta.title || 'World Feed',
        identifier: mainPick.identifier,
      };
    }
    for (const s of additional) {
      if (!s.channelId) continue;
      const base = {
        contentId: meta.contentId || contentId,
        channelId: s.channelId,
        title: s.title || s.reportingName || '',
      };
      if (isObcStream(s)) {
        onboard.push({
          ...base,
          title: base.title || `Onboard ${s.racingNumber || ''}`,
          driverName: s.driverFirstName || s.driverLastName ? [s.driverFirstName, s.driverLastName].filter(Boolean).join(' ') : undefined,
          teamName: s.teamName,
          racingNumber: s.racingNumber,
        });
      } else if (isDataStream(s)) {
        dataChannel.push({
          ...base,
          title: base.title || 'Data channel',
        });
      }
    }
    return { onboard, dataChannel, mainChannel, container };
  } catch (e) {
    return { onboard: [], dataChannel: [], container: null };
  }
}

module.exports = {
  getLiveNow,
  searchVod,
  getVodSeasons,
  getVodEvents,
  getVodSessions,
  getVodCatalog,
  getContentVideo,
  pickMainChannelStream,
};
