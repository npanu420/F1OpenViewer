/**
 * Bridge for F1 TV: login (api.formula1.com) + client (electron/f1tvapi.js).
 * Runs in the main process (Node) to avoid CORS and to use undici.
 *
 * Thin facade over the three modules that actually do the work, kept so callers don't need to
 * know the split: f1tvClient (login/session), f1tvCatalog (archive browsing), f1tvPlayback
 * (manifest/license resolution).
 */

const client = require('./f1tvClient');
const catalog = require('./f1tvCatalog');
const playback = require('./f1tvPlayback');

module.exports = {
  login: client.login,
  loginWithToken: client.loginWithToken,
  initClient: client.initClient,
  getLiveNow: catalog.getLiveNow,
  searchVod: catalog.searchVod,
  getVodCatalog: catalog.getVodCatalog,
  getVodSeasons: catalog.getVodSeasons,
  getVodEvents: catalog.getVodEvents,
  getVodSessions: catalog.getVodSessions,
  getContentVideo: catalog.getContentVideo,
  contentPlay: playback.contentPlay,
  getSubscriptionToken: client.getSubscriptionToken,
  getLicenseRequestHeaders: client.getLicenseRequestHeaders,
  setPlaybackEntitlementOverride: client.setPlaybackEntitlementOverride,
  clearSession: client.clearSession,
  get isClientReady() {
    return client.isClientReady;
  },
  get ascendonToken() {
    return client.ascendonToken;
  },
};
