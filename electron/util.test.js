import { test } from 'vitest';
import assert from 'node:assert/strict';
import util from './util.js';
import auth from './proxyAuth.js';

test('redactUrl drops query, fragment and long signed path segments', () => {
  const url =
    'https://ott-video-cf.formula1.com/v2/pa_' + 'A'.repeat(300) + '/manifest.mpd?token=SECRET&Signature=ALSO_SECRET#frag';
  const out = util.redactUrl(url);
  assert.ok(out.startsWith('https://ott-video-cf.formula1.com/v2/'));
  assert.ok(!out.includes('SECRET'));
  assert.ok(!out.includes('A'.repeat(30)));
  assert.ok(!out.includes('#'));
  assert.ok(out.length < 140);
  assert.equal(util.redactUrl('not a url'), '(invalid url)');
});

test('redact keeps only a short prefix/suffix', () => {
  const r = util.redact('abcdefghijklmnopqrstuvwxyz');
  assert.ok(!r.includes('ijklmnop'));
  assert.equal(util.redact(''), '');
  assert.equal(util.redact(null), '');
});

test('hasFormula1Host checks the hostname, not a substring', () => {
  assert.equal(util.hasFormula1Host('https://f1tv.formula1.com/x'), true);
  assert.equal(util.hasFormula1Host('https://formula1.com.evil.io/x'), false);
  assert.equal(util.hasFormula1Host('https://evilformula1.com/x'), false);
});

test('proxy secret: random per call, constant-time compare, rejects missing/mismatched', () => {
  const a = auth.createProxySecret();
  const b = auth.createProxySecret();
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.equal(auth.isAuthorized(a, a), true);
  assert.equal(auth.isAuthorized(a, b), false);
  assert.equal(auth.isAuthorized(a, ''), false);
  assert.equal(auth.isAuthorized(a, undefined), false);
  assert.equal(auth.isAuthorized('', ''), false);
  assert.equal(auth.isAuthorized(a, a + 'x'), false);
});

test('isTransientNetworkError: network hiccups yes, auth failures no', () => {
  const yes = [
    new Error('fetch failed'),
    Object.assign(new Error('x'), { code: 'ECONNRESET' }),
    Object.assign(new Error('boom'), { cause: { code: 'ENOTFOUND' } }),
    new Error('F1 TV initialization timeout'),
    new Error('Token verification timeout (ascendon not received). Try signing in again.'),
    new Error('socket hang up'),
  ];
  const no = [
    new Error('jwt expired'),
    new Error('invalid signature!'),
    new Error('Invalid session: entitlement not available (account not authenticated with API).'),
    new Error('HTTP 401: nope'),
    undefined,
    null,
  ];
  for (const e of yes) assert.equal(util.isTransientNetworkError(e), true, String(e && e.message));
  for (const e of no) assert.equal(util.isTransientNetworkError(e), false, String(e && e.message));
});

test('withTimeout: resolves with the promise value when it is fast, with the fallback when it hangs', async () => {
  assert.equal(await util.withTimeout(Promise.resolve('ok'), 50, 'late'), 'ok');
  assert.equal(await util.withTimeout(new Promise(() => {}), 20, 'fallback'), 'fallback');
});

test('withTimeout: a rejecting promise still rejects (errors are not swallowed)', async () => {
  await assert.rejects(util.withTimeout(Promise.reject(new Error('boom')), 50, 'x'), /boom/);
});

test('toPositiveInt: accepts ids as numbers or digit strings, rejects everything else', () => {
  assert.equal(util.toPositiveInt(1000010198), 1000010198);
  assert.equal(util.toPositiveInt('493'), 493);
  for (const bad of [0, -1, 1.5, '12a', '../1', '', ' 1', null, undefined, {}, NaN, Number.MAX_SAFE_INTEGER + 2]) {
    assert.throws(() => util.toPositiveInt(bad, 'pageId'), /Invalid pageId/, String(bad));
  }
});

test('rendererPlayback: account tokens never reach the renderer', () => {
  const result = {
    manifestUrl: 'https://cdn/x.mpd', licenseUrl: 'http://127.0.0.1:18765/la?stream=1:0&k=s',
    licenseAscendonToken: 'ASC', licenseEntitlementToken: 'ENT', playToken: 'PLAY', drmToken: 'DRM',
    fallbackDrmToken: 'FBDRM', streamType: 'SDR',
  };
  const proxied = util.rendererPlayback(result, true);
  assert.deepEqual(Object.keys(proxied).sort(), ['fallbackDrmToken', 'licenseUrl', 'manifestUrl', 'streamType']);
  // not proxied: the per-play drmToken is still needed by the player, nothing else
  const direct = util.rendererPlayback(result, false);
  assert.equal(direct.drmToken, 'DRM');
  for (const k of ['licenseAscendonToken', 'licenseEntitlementToken', 'playToken']) assert.equal(k in direct, false, k);
  assert.equal(result.licenseAscendonToken, 'ASC'); // input untouched
});

test('isTransientNetworkError: HTTP status decides over words in the response body', () => {
  assert.equal(util.isTransientNetworkError(new Error('HTTP 403: {"message":"network timeout policy"}')), false);
  assert.equal(util.isTransientNetworkError(new Error('fetchPage 12 → HTTP 401')), false);
  assert.equal(util.isTransientNetworkError(new Error('HTTP 503: Service Unavailable')), true);
});

test('isOfflineError: only "could not reach anyone", not app-level timeouts or HTTP answers', () => {
  assert.equal(util.isOfflineError(new Error('fetch failed')), true);
  assert.equal(util.isOfflineError(Object.assign(new Error('x'), { cause: { code: 'ENOTFOUND' } })), true);
  assert.equal(util.isOfflineError(new Error('F1 TV initialization timeout')), false);
  assert.equal(util.isOfflineError(new Error('Token verification timeout (ascendon not received).')), false);
  assert.equal(util.isOfflineError(new Error('HTTP 500: fetch failed upstream')), false);
  // ...but those timeouts still keep the saved session
  assert.equal(util.isTransientNetworkError(new Error('F1 TV initialization timeout')), true);
});

test('isF1LicenseUrl matches the LA path segment only (never a query string)', () => {
  assert.equal(util.isF1LicenseUrl('https://f1tv.formula1.com/2.0/R/ENG/BIG_SCREEN_DASH/ALL/CONTENT/LA/widevine?contentId=1&channelId=2'), true);
  assert.equal(util.isF1LicenseUrl('https://f1tv.formula1.com/2.0/A/ENG/WEB_DASH/ALL/CONTENT/LA/ent/123'), true);
  assert.equal(util.isF1LicenseUrl('https://f1tv.formula1.com/2.0/R/ENG/WEB_DASH/ALL/CONTENT/LA'), true);
  assert.equal(util.isF1LicenseUrl('https://www.formula1.com/en/page?x=/LA'), false);
  assert.equal(util.isF1LicenseUrl('https://www.formula1.com/LAYOUT/x'), false);
  assert.equal(util.isF1LicenseUrl('https://evil.example/CONTENT/LA/widevine'), false);
  assert.equal(util.isF1LicenseUrl('http://f1tv.formula1.com/CONTENT/LA/widevine'), false);
});

test('sanitizeSearchParams keeps only known keys with plain short values', () => {
  assert.deepEqual(util.sanitizeSearchParams({ maxResults: '50', orderBy: 'startDate', sortOrder: 'desc' }), { maxResults: '50', orderBy: 'startDate', sortOrder: 'desc' });
  assert.deepEqual(util.sanitizeSearchParams({ filter_year: '2026', evil: 'x', maxResults: '5&x=1' }), { filter_year: '2026' });
  assert.deepEqual(util.sanitizeSearchParams(null), {});
  assert.deepEqual(util.sanitizeSearchParams({ orderBy: 'a'.repeat(65) }), {});
});

test('isAllowedExternalUrl only opens this project on GitHub over https', () => {
  assert.equal(util.isAllowedExternalUrl('https://github.com/npanu420/F1OpenViewer/releases/tag/v1.3.0'), true);
  assert.equal(util.isAllowedExternalUrl('https://github.com/npanu420/F1OpenViewer'), true);
  assert.equal(util.isAllowedExternalUrl('https://github.com/attacker/repo'), false);
  assert.equal(util.isAllowedExternalUrl('https://github.com/npanu420/F1OpenViewerEvil'), false);
  assert.equal(util.isAllowedExternalUrl('http://github.com/npanu420/F1OpenViewer'), false);
  assert.equal(util.isAllowedExternalUrl('https://github.com.evil.io/npanu420/F1OpenViewer'), false);
  assert.equal(util.isAllowedExternalUrl(undefined), false);
});
