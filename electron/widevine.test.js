import { test } from 'vitest';
import assert from 'node:assert/strict';
import wv from './widevine.js';

test('a failing CDM install never rejects (it used to abort startup: app running with no window)', async () => {
  const failing = { whenReady: () => Promise.reject(new Error('Failed to install required components')) };
  assert.equal(await wv.waitForWidevineReady(failing, 1000), false);
});

test('a CDM download that hangs is abandoned after the timeout', async () => {
  const hanging = { whenReady: () => new Promise(() => {}) };
  assert.equal(await wv.waitForWidevineReady(hanging, 20), false);
});

test('ready CDM, and builds without the castLabs components API', async () => {
  assert.equal(await wv.waitForWidevineReady({ whenReady: () => Promise.resolve() }, 1000), true);
  assert.equal(await wv.waitForWidevineReady(null, 1000), true);
});
