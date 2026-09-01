import { test } from 'vitest';
import assert from 'node:assert/strict';
import utils from './loginUtils.js';

const token = `header.${'x'.repeat(60)}.signature`;

test('buildLoginUserAgent uses the running Chromium version and hides Electron', () => {
  const ua = utils.buildLoginUserAgent('144.0.7559.225');
  assert.match(ua, /Chrome\/144\.0\.7559\.225/);
  assert.doesNotMatch(ua, /Electron\//);
});

test('tokenFromLoginSessionCookie reads the nested encoded F1 cookie', () => {
  const value = encodeURIComponent(JSON.stringify({ data: { subscriptionToken: token } }));
  assert.equal(utils.tokenFromLoginSessionCookie(value), token);
});

test('tokenFromLoginSessionCookie supports the top-level shape and rejects bad data', () => {
  assert.equal(utils.tokenFromLoginSessionCookie(JSON.stringify({ subscriptionToken: token })), token);
  assert.equal(utils.tokenFromLoginSessionCookie('%not-json'), null);
  assert.equal(utils.tokenFromLoginSessionCookie(JSON.stringify({ data: { subscriptionToken: 'short' } })), null);
});
