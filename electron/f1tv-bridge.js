/**
 * Bridge per F1 TV: login (api.formula1.com) + client @exhumer/f1tv-api.
 * Esegue tutto nel main process (Node) per evitare CORS e per usare undici.
 */

const axios = require('axios');
const { fetch: undiciFetch } = require('undici');
const { F1TVClient, F1TV } = require('@exhumer/f1tv-api');

const F1TV_BASE = 'https://f1tv.formula1.com';
const F1TV_PLATFORM = 'WEB_DASH';
const F1TV_LANG = 'ENG';
const F1TV_ENTITLEMENT = 'F1_TV_Pro_Annual';
const F1TV_GROUP = '2';

/** Estrae l'URL del server licenze dal manifest MPD se presente (fallback quando l'API non restituisce laURL). */
async function extractLicenseUrlFromManifest(manifestUrl) {
  try {
    const client = getClient();
    const headers = { Accept: 'application/dash+xml, application/xml, */*' };
    if (client?.entitlement) headers.entitlementtoken = client.entitlement;
    if (client?.ascendon) headers.ascendontoken = client.ascendon;
    const res = await undiciFetch(manifestUrl, { headers });
    if (!res.ok) return '';
    const text = await res.text();
    const xml = text.slice(0, 20000);
    const laurlMatch = xml.match(/(?:laurl|Laurl|LAURL)\s*[=:]\s*["']([^"']+)["']/i)
      || xml.match(/<(?:dashif:|ms:)?(?:Laurl|laurl)[^>]*>([^<]+)</i)
      || xml.match(/<[^>]*(?:laurl|Laurl)[^>]*>([^<]+)</i)
      || xml.match(/license[^"']*["']([^"']+)/i);
    if (laurlMatch && laurlMatch[1] && laurlMatch[1].startsWith('http')) {
      console.log('[playback] licenseUrl estratto dal manifest');
      return laurlMatch[1].trim();
    }
    const f1La = xml.match(/https:\/\/f1tv\.formula1\.com\/[^\s"'<>]*CONTENT\/LA[^\s"'<>]*/i);
    if (f1La) {
      console.log('[playback] licenseUrl (F1 LA) estratto dal manifest');
      return f1La[0].trim().replace(/&amp;/g, '&');
    }
    const anyHttps = xml.match(/https:\/\/[^\s"'<>]+(?:license|widevine|drm|entitlement|acquire)[^\s"'<>]*/i);
    if (anyHttps) {
      console.log('[playback] licenseUrl (pattern) estratto dal manifest');
      return anyHttps[0].trim();
    }
  } catch (e) {
    console.warn('[playback] estrazione licenseUrl da manifest:', e?.message);
  }
  return '';
}

/** URL di fallback per License Acquisition F1 quando API/manifest non forniscono laURL. Stesso pattern di PAGE: entitlement + groupId nel path. Se autenticati ma location dice ANONYMOUS, proviamo con F1_TV_Pro_Annual. */
function getFallbackLicenseUrl(client) {
  if (!client) return '';
  const auth = client.ascendon ? 'R' : 'A';
  const userLoc = client.location?.userLocation?.[0];
  let entitlement = userLoc?.entitlement || F1TV_ENTITLEMENT;
  if (auth === 'R' && (entitlement === 'ANONYMOUS' || !entitlement)) {
    entitlement = F1TV_ENTITLEMENT;
  }
  const groupId = String(userLoc?.groupId ?? F1TV_GROUP);
  return `${F1TV_BASE}/2.0/${auth}/${F1TV_LANG}/${F1TV_PLATFORM}/ALL/CONTENT/LA/${entitlement}/${groupId}`;
}

/**
 * Fetch una pagina F1 TV senza autenticazione (contenuti pubblici/archivio).
 * @param {string|number} pageId
 */
async function fetchPage(pageId) {
  const loginStatus = f1Client?.ascendon ? 'R' : 'A';
  const userLoc = f1Client?.location?.userLocation?.[0];
  const entitlement = userLoc?.entitlement || F1TV_ENTITLEMENT;
  const groupId = String(userLoc?.groupId || F1TV_GROUP);
  const url = `${F1TV_BASE}/2.0/${loginStatus}/${F1TV_LANG}/${F1TV_PLATFORM}/ALL/PAGE/${pageId}/${entitlement}/${groupId}`;
  const headers = { 'User-Agent': 'F1 OpenViewer/1.0' };
  if (f1Client?.entitlement) headers.entitlementtoken = f1Client.entitlement;
  if (f1Client?.ascendon) headers.ascendontoken = f1Client.ascendon;
  console.log('[fetchPage]', url, '| entitlement:', entitlement, '| groupId:', groupId, '| auth:', loginStatus);
  const res = await undiciFetch(url, { headers });
  if (!res.ok) throw new Error(`fetchPage ${pageId} → HTTP ${res.status}`);
  const json = await res.json();
  if (json.resultCode !== 'OK') throw new Error(`fetchPage ${pageId} → resultCode ${json.resultCode}: ${json.message}`);
  return json.resultObj?.containers || [];
}

const F1_AUTH_URL = 'https://api.formula1.com/v2/account/subscriber/authenticate/by-password';
const F1_AUTH_ORIGIN = 'https://account.formula1.com';

/** @type {F1TVClient | null} */
let f1Client = null;
/** @type {string | null} */
let subscriptionToken = null;

const defaultHeaders = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
  'Content-Type': 'application/json',
  'Origin': F1_AUTH_ORIGIN,
  'Referer': F1_AUTH_ORIGIN + '/',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

/**
 * Login con email/password su F1 TV.
 * Prova body con Login/Password (Ascendon) e fallback email/password.
 * @returns {{ subscriptionToken: string }}
 */
async function login(email, password) {
  const bodies = [
    { Login: email, Password: password },
    { email, password },
  ];

  let lastError = null;
  for (const body of bodies) {
    try {
      const res = await axios.post(F1_AUTH_URL, body, {
        headers: defaultHeaders,
        timeout: 15000,
        validateStatus: () => true,
        maxRedirects: 0,
      });

      if (res.status === 403) {
        lastError = new Error(
          'HTTP 403: il server F1 blocca il login diretto (protezione Imperva). ' +
          'Usa "Accedi con token" qui sotto: fai login su account.formula1.com nel browser, ' +
          'apri DevTools (F12) → Network, fai login, cerca la richiesta "by-password", ' +
          'copia la risposta (Response) e incollala nel campo Token.'
        );
        continue;
      }
      if (res.status !== 200) {
        lastError = new Error(`Login fallito: HTTP ${res.status}`);
        continue;
      }

      const data = res.data;
      let token = null;
      if (typeof data === 'string' && data.length > 100) {
        token = data;
      } else if (data && typeof data === 'object') {
        token = data.subscriptionToken ?? data.token ?? data.accessToken ?? data.access_token ?? data.resultObj?.subscriptionToken;
      }
      if (token) {
        subscriptionToken = token;
        return { subscriptionToken: token };
      }
      lastError = new Error('Risposta login senza token');
    } catch (e) {
      lastError = e?.response?.data ? new Error(String(e.response.data?.message || e.response.data)) : e;
    }
  }
  throw lastError || new Error('Login non riuscito');
}

/**
 * Login usando un token già ottenuto (es. copiato dalla richiesta by-password in DevTools).
 * @param {string} tokenOrJson - JWT token oppure JSON della risposta (con subscriptionToken/token)
 * @returns {{ subscriptionToken: string }}
 */
function loginWithToken(tokenOrJson) {
  const raw = typeof tokenOrJson === 'string' ? tokenOrJson.trim() : '';
  if (!raw) throw new Error('Token vuoto.');
  let token = raw;
  if (raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw);
      token = obj.subscriptionToken ?? obj.token ?? obj.accessToken ?? obj.access_token
        ?? obj.resultObj?.subscriptionToken ?? obj.data?.subscriptionToken ?? obj.data?.token ?? '';
    } catch (_) {
      throw new Error('Token non valido: non è un JSON valido.');
    }
  }
  token = typeof token === 'string' ? token.trim() : '';
  if (!token || token.length < 50) throw new Error('Token non valido o troppo corto.');
  subscriptionToken = token;
  return { subscriptionToken: token };
}

/**
 * Inizializza il client F1 TV con il token e aspetta ready.
 * @param {string} token - subscription token (ascendon)
 * @param {number} readyTimeoutMs
 */
function initClient(token, readyTimeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (f1Client) {
      f1Client.ascendon = null;
      f1Client = null;
    }
    const client = new F1TVClient(token, F1TV.Language.ENGLISH, F1TV.Platform.WEB_DASH);
    f1Client = client;

    const t = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout inizializzazione F1 TV'));
    }, readyTimeoutMs);

    function cleanup() {
      clearTimeout(t);
      client.removeAllListeners();
    }

    client.once('ready', async () => {
      cleanup();
      try {
        // Dopo entitlement aggiornato, location iniziale può restare ANONYMOUS.
        // Forziamo refresh location per ottenere entitlement/groupId reali account.
        if (typeof client.refreshLocation === 'function') {
          await new Promise((r) => {
            let done = false;
            const finish = () => {
              if (done) return;
              done = true;
              client.removeListener('locationUpdated', onUpdated);
              client.removeListener('locationError', onError);
              clearTimeout(tt);
              r();
            };
            const onUpdated = () => finish();
            const onError = () => finish();
            const tt = setTimeout(finish, 2500);
            client.once('locationUpdated', onUpdated);
            client.once('locationError', onError);
            try {
              client.refreshLocation();
            } catch (_) {
              finish();
            }
          });
        }
      } catch (_) {}

      // ascendon viene impostato in modo asincrono (verifica JWT). Aspettiamo ascendonUpdated.
      if (!client.ascendon) {
        await new Promise((res, rej) => {
          const t = setTimeout(() => {
            client.removeListener('ascendonUpdated', onOk);
            client.removeListener('ascendonError', onErr);
            rej(new Error('Verifica token in corso: timeout (ascendon non ricevuto). Riprova il login.'));
          }, 10000);
          const onOk = () => {
            clearTimeout(t);
            client.removeListener('ascendonUpdated', onOk);
            client.removeListener('ascendonError', onErr);
            res();
          };
          const onErr = (err) => {
            clearTimeout(t);
            client.removeListener('ascendonUpdated', onOk);
            client.removeListener('ascendonError', onErr);
            rej(err);
          };
          client.once('ascendonUpdated', onOk);
          client.once('ascendonError', onErr);
        }).catch((err) => {
          f1Client = null;
          reject(err);
          return;
        });
      }
      if (!client.ascendon) return;

      // Entitlement può arrivare in ritardo dopo ascendon: aspettiamo.
      if (!client.entitlement) {
        await new Promise((r) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            client.removeListener('entitlementUpdated', onUpdated);
            client.removeListener('entitlementError', onError);
            clearTimeout(tt);
            r();
          };
          const onUpdated = () => finish();
          const onError = () => finish();
          const tt = setTimeout(finish, 6000);
          client.once('entitlementUpdated', onUpdated);
          client.once('entitlementError', onError);
        });
      }
      if (!client.entitlement) {
        f1Client = null;
        reject(new Error('Sessione non valida: entitlement non disponibile (account non autenticato lato API).'));
        return;
      }

      console.log('[F1TV] Client pronto. ascendon:', !!client.ascendon, '| entitlement:', !!client.entitlement, '| location:', !!client.location);
      if (client.location) {
        const loc = client.location.userLocation?.[0];
        console.log('[F1TV] UserLocation:', JSON.stringify({ entitlement: loc?.entitlement, groupId: loc?.groupId, country: loc?.registeredCountryIsoCode }));
      }
      resolve();
    });
    client.once('ascendonError', (err) => {
      cleanup();
      console.error('[F1TV] ascendonError:', err?.message);
      f1Client = null;
      reject(err);
    });
    client.once('configError', (err) => {
      cleanup();
      console.error('[F1TV] configError:', err?.message);
      reject(err);
    });
    client.once('locationError', (err) => {
      cleanup();
      console.error('[F1TV] locationError:', err?.message);
      reject(err);
    });
  });
}

function getClient() {
  if (!f1Client || !f1Client.isReady) throw new Error('Client F1 TV non pronto');
  return f1Client;
}

async function getLiveNow() {
  try {
    const client = getClient();
    const result = await client.liveNow();
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
    const client = getClient();
    const result = await client.searchVod(params);
    const containers = result?.resultObj?.containers || [];
    const items = containers.map((c) => {
    const contentId = c.metadata?.contentId ?? c.id;
    if (contentId == null) return null;
    return {
      id: String(c.id ?? contentId),
      title: c.metadata?.title || c.uiMetadata?.mainTitle || 'VOD',
      kind: 'replay',
      season: c.metadata?.season != null ? String(c.metadata.season) : undefined,
      contentId: Number(contentId),
    };
  }).filter(Boolean);
    return items;
  } catch (e) {
    return [];
  }
}

/**
 * ID pagina archivio F1 TV e mapping anno → pageId stagione.
 * Ottenuti esplorando https://f1tv.formula1.com/2.0/A/ENG/WEB_DASH/ALL/PAGE/493/F1_TV_Pro_Annual/2
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
    const containers = await fetchPage(pageId);
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
 * Estrae tutti i container GP da una pagina stagione.
 * Ogni container GP ha un'action con pageId per la pagina del GP.
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
      // Filtra solo GP/meeting F1 (esclude F2, F3, ecc.)
      const isF1GP = (
        String(title).toUpperCase().includes('GRAND PRIX') ||
        String(title).toUpperCase().includes('FORMULA 1') ||
        emf.VideoType === 'meetings' ||
        meta.contentSubtype === 'MEETING'
      ) && !String(title).toUpperCase().includes(' F2 ') && !String(title).toUpperCase().includes(' F3 ');
      if (!isF1GP) continue;
      // Non mostrare eventi futuri (es: gare non ancora disputate in stagione corrente).
      const meetingStartMs = Number(props.meeting_Start_Date || props.meeting_start_date || 0);
      if (Number.isFinite(meetingStartMs) && meetingStartMs > 0 && meetingStartMs > nowMs) {
        continue;
      }
      // Estrai pageId dall'URI: /2.0/A/ENG/WEB_DASH/ALL/PAGE/{pageId}/...
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
 * Estrae le sessioni da una pagina GP.
 * Ritorna { sessions, onboard } dove sessions sono FP/Q/Race/Sprint e onboard i canali OBC.
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
      // Salta contenuti F2/F3
      if (/\bF[23]\b/.test(title)) continue;
      const type = mapSubtypeToSessionType(subtype, videoType);
      // Sessioni principali: solo REPLAY di meetingSession (FP, Q, Race, Sprint)
      if (videoType === 'meetingSession' && subtype === 'REPLAY') {
        sessions.push({ contentId, title: String(title).trim(), type });
      }
    }
  }
  return { sessions, onboard };
}

/**
 * Ritorna la lista delle stagioni disponibili nell'archivio F1 TV.
 * Ogni stagione ha: { year, pageId }
 */
async function getVodSeasons() {
  console.log('[VOD] getVodSeasons: caricamento archivio pagina', ARCHIVE_PAGE_ID);
  const archiveContainers = await fetchPage(ARCHIVE_PAGE_ID);
  const seasonItems = archiveContainers.flatMap((c) => c.retrieveItems?.resultObj?.containers || []);
  if (!seasonItems.length) throw new Error('Nessun item stagione trovato nella pagina archivio');
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
      // Evita di fare probing su pagine non-stagione (es: full-race-replays-and-highlights)
      const href = String(action.href || '').toLowerCase();
      if (href.includes('season')) unresolved.push(pageId);
    }
  }
  // Fallback dinamico: deduce anno direttamente dalla pagina stagione (copre nuove stagioni, es. 2026).
  for (const pageId of unresolved) {
    const inferredYear = await inferSeasonYearFromPage(pageId);
    if (!inferredYear) continue;
    if (inferredYear < 2018 || inferredYear > new Date().getFullYear()) continue;
    if (!seasonsMap.has(inferredYear)) {
      seasonsMap.set(inferredYear, { year: inferredYear, pageId });
      console.log(`[VOD] anno dedotto dinamicamente: ${inferredYear} (page:${pageId})`);
    }
  }
  // Fallback esplicito: alcune stagioni recenti non compaiono sempre in PAGE/493.
  for (const [pageIdStr, y] of Object.entries(LEGACY_SEASON_PAGE_TO_YEAR)) {
    const pageId = Number(pageIdStr);
    if (y >= 2018 && y <= new Date().getFullYear() && !seasonsMap.has(y)) {
      seasonsMap.set(y, { year: y, pageId });
    }
  }
  const seasons = Array.from(seasonsMap.values()).sort((a, b) => b.year - a.year);
  console.log('[VOD] Stagioni disponibili:', seasons.map(s => `${s.year}(page:${s.pageId})`).join(', '));
  return seasons;
}

/**
 * Ritorna la lista dei GP di una stagione dato il pageId della stagione.
 * Ogni GP ha: { pageId, meetingName, meetingNumber }
 */
async function getVodEvents(seasonPageId) {
  console.log('[VOD] getVodEvents: caricamento stagione pagina', seasonPageId);
  const containers = await fetchPage(seasonPageId);
  const gpItems = extractEventsFromSeasonPage(containers);
  console.log('[VOD] GP trovati (solo disputati):', gpItems.length);
  return gpItems.map((gp, i) => ({
    meetingKey: String(gp.pageId),
    meetingName: gp.meetingName,
    meetingNumber: gp.meetingNumber || (i + 1),
    pageId: gp.pageId,
  }));
}

/**
 * Ritorna le sessioni (FP, Q, Race, Sprint) di un GP dato il pageId del GP.
 */
async function getVodSessions(gpPageId) {
  console.log('[VOD] getVodSessions: caricamento GP pagina', gpPageId);
  const containers = await fetchPage(gpPageId);
  const { sessions } = extractSessionsFromGPPage(containers);
  console.log('[VOD] Sessioni trovate:', sessions.length);
  return sessions;
}

/**
 * Catalogo VOD completo (legacy, carica tutto in una volta).
 * Preferire getVodSeasons + getVodEvents + getVodSessions per caricamento lazy.
 */
async function getVodCatalog() {
  const result = { seasons: [] };
  try {
    const seasons = await getVodSeasons();
    for (const { year, pageId } of seasons) {
      const events = await getVodEvents(pageId).catch(e => {
        console.warn(`[VOD] Stagione ${year} errore:`, e.message);
        return [];
      });
      if (!events.length) continue;
      result.seasons.push({ year, events: events.map(ev => ({ ...ev, sessions: [], onboard: [] })) });
    }
    console.log('[VOD] Catalogo (solo stagioni+GP):', result.seasons.map(s => `${s.year}(${s.events.length}GP)`).join(', '));
  } catch (e) {
    console.error('[VOD] Errore fatale getVodCatalog:', e?.message, e?.stack);
  }
  return result;
}

/**
 * Dettaglio contenuto per stream aggiuntivi (onboard).
 */
async function getContentVideo(contentId) {
  try {
    const client = getClient();
    const container = await client.contentVideo(contentId);
    const meta = container?.metadata || {};
    const additional = meta.additionalStreams || [];
    const onboard = [];
    const dataChannel = [];
    for (const s of additional) {
      if (!s.channelId) continue;
      const base = {
        contentId: meta.contentId || contentId,
        channelId: s.channelId,
        title: s.title || s.reportingName || '',
      };
      if (s.type === 'obc' || s.identifier === 'OBC' || String(s.type || '').toLowerCase().includes('onboard')) {
        onboard.push({
          ...base,
          title: base.title || `Onboard ${s.racingNumber || ''}`,
          driverName: s.driverFirstName || s.driverLastName ? [s.driverFirstName, s.driverLastName].filter(Boolean).join(' ') : undefined,
          teamName: s.teamName,
          racingNumber: s.racingNumber,
        });
      } else if (s.identifier === 'DATA' || String(s.type || '').toLowerCase().includes('data')) {
        dataChannel.push({
          ...base,
          title: base.title || 'Data channel',
        });
      }
    }
    return { onboard, dataChannel, container };
  } catch (e) {
    return { onboard: [], dataChannel: [], container: null };
  }
}

/**
 * Ottiene URL playback con fallback profilo:
 * - primary: WEB_DASH (Widevine)
 * - fallback: WEB_HLS (utile su macchine senza key-system disponibile)
 * @returns {{
 *  manifestUrl: string,
 *  licenseUrl: string,
 *  drmToken?: string,
 *  streamType: string,
 *  fallbackManifestUrl?: string,
 *  fallbackLicenseUrl?: string,
 *  fallbackDrmToken?: string,
 *  fallbackStreamType?: string
 * }}
 */
async function contentPlay(contentId, channelId) {
  const client = getClient();
  if (!client.entitlement) {
    throw new Error('Sessione non pronta: entitlement mancante. Esci e riloggati con "Accedi con browser", poi riprova.');
  }
  const contentIdNum = typeof contentId === 'string' ? parseInt(contentId, 10) : contentId;
  const platformOrder = [
    F1TV.Platform.WEB_DASH,
    F1TV.Platform.WEB_HLS,
    F1TV.Platform.BIG_SCREEN_HLS,
    F1TV.Platform.MOBILE_HLS,
    F1TV.Platform.TABLET_HLS,
    F1TV.Platform.BIG_SCREEN_DASH,
  ];
  const candidates = [];
  let firstError = null;
  for (const p of platformOrder) {
    const res = await client.contentPlay(contentIdNum, channelId, p).catch((e) => {
      if (!firstError) firstError = e;
      return null;
    });
    const obj = res?.resultObj;
    if (obj?.url) {
      candidates.push({
        platform: p,
        ...obj,
      });
    }
  }
  if (!candidates.length) {
    const detail = firstError ? (firstError.message || String(firstError)) : 'nessun URL restituito dall’API';
    console.error('[playback] tutti i profili falliti. Primo errore:', detail);
    throw new Error('Nessun profilo playback disponibile. ' + (firstError ? `Dettaglio: ${detail}` : 'Riloggati e riprova.'));
  }
  // Preferisci stream NON Widevine quando disponibile (evita Shaka 6001 su host senza key-system).
  const nonWv = candidates.find((c) => !String(c.streamType || '').toUpperCase().includes('WV'));
  const primary = nonWv || candidates[0];
  const fallback = candidates.find((c) => c !== primary) || null;
  if (!primary?.url) throw new Error('Risposta content/play senza URL valido (DASH/HLS).');

  let licenseUrl = primary.laURL || primary.laUrl || '';
  if (!licenseUrl && primary.url) {
    licenseUrl = await extractLicenseUrlFromManifest(primary.url);
  }
  if (!licenseUrl) {
    licenseUrl = getFallbackLicenseUrl(client);
    if (licenseUrl) {
      const pathPart = licenseUrl.replace(F1TV_BASE, '');
      console.log('[playback] licenseUrl fallback F1 LA:', pathPart);
    }
  }
  console.log('[playback] selected platform:', primary.platform, '| streamType:', primary.streamType, '| manifest:', primary.url);
  console.log('[playback] licenseUrl:', licenseUrl ? `${licenseUrl.slice(0, 80)}…` : '(vuoto)', '| drmToken:', !!primary.drmToken);
  if (fallback?.url) {
    console.log('[playback] fallback platform:', fallback.platform, '| streamType:', fallback.streamType, '| manifest:', fallback.url);
  }
  return {
    manifestUrl: primary.url,
    licenseUrl,
    drmToken: primary.drmToken,
    licenseAscendonToken: client.ascendon || undefined,
    licenseEntitlementToken: client.entitlement || undefined,
    streamType: primary.streamType || 'UNKNOWN',
    fallbackManifestUrl: fallback?.url || undefined,
    fallbackLicenseUrl: fallback?.laURL || fallback?.laUrl || '',
    fallbackDrmToken: fallback?.drmToken || undefined,
    fallbackStreamType: fallback?.streamType || undefined,
  };
}

function getSubscriptionToken() {
  return subscriptionToken;
}

/** Header da iniettare su ogni richiesta al server licenze F1 (usato dal main per webRequest). */
function getLicenseRequestHeaders() {
  try {
    const client = getClient();
    const out = {
      Origin: 'https://f1tv.formula1.com',
      Referer: 'https://f1tv.formula1.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    };
    if (client.ascendon) {
      out.ascendontoken = client.ascendon;
      out.Authorization = `Bearer ${client.ascendon}`;
    }
    if (client.entitlement) out.entitlementtoken = client.entitlement;
    return (out.ascendontoken || out.entitlementtoken) ? out : null;
  } catch (_) {
    return null;
  }
}

function clearSession() {
  subscriptionToken = null;
  if (f1Client) {
    f1Client.ascendon = null;
    f1Client = null;
  }
}

module.exports = {
  login,
  loginWithToken,
  initClient,
  getLiveNow,
  searchVod,
  getVodCatalog,
  getVodSeasons,
  getVodEvents,
  getVodSessions,
  getContentVideo,
  contentPlay,
  getSubscriptionToken,
  getLicenseRequestHeaders,
  clearSession,
  get isClientReady() {
    return !!f1Client && f1Client.isReady;
  },
};
