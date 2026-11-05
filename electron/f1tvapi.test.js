import { test, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import api from './f1tvapi.js';

afterEach(() => api._setFetch(null));

const reset = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
const fast = { tries: 3, baseDelayMs: 1 };

test('fetchWithRetry: recovers from transient resets and returns the first good response', async () => {
  let calls = 0;
  api._setFetch(async () => {
    calls++;
    if (calls < 3) throw reset();
    return { ok: true, status: 200 };
  });
  const res = await api.fetchWithRetry('https://x/y', {}, fast);
  assert.equal(res.status, 200);
  assert.equal(calls, 3);
});

test('fetchWithRetry: gives up after the configured number of tries and rethrows the network error', async () => {
  let calls = 0;
  api._setFetch(async () => { calls++; throw reset(); });
  await assert.rejects(api.fetchWithRetry('https://x/y', {}, fast), /fetch failed/);
  assert.equal(calls, 3);
});

test('fetchWithRetry: non-transient errors are thrown immediately, not retried', async () => {
  let calls = 0;
  api._setFetch(async () => { calls++; throw new TypeError('Invalid URL'); });
  await assert.rejects(api.fetchWithRetry('nope', {}, fast), /Invalid URL/);
  assert.equal(calls, 1);
});

test('fetchWithRetry: HTTP error statuses are returned as-is (not retried)', async () => {
  let calls = 0;
  api._setFetch(async () => { calls++; return { ok: false, status: 403 }; });
  const res = await api.fetchWithRetry('https://x/y', {}, fast);
  assert.equal(res.status, 403);
  assert.equal(calls, 1);
});

test('fetchWithRetry: every attempt gets its own timeout signal; a hanging request times out and is retried', async () => {
  const signals = [];
  api._setFetch((_url, init) => new Promise((_resolve, reject) => {
    signals.push(init.signal);
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  }));
  await assert.rejects(api.fetchWithRetry('https://x/y', {}, { tries: 2, baseDelayMs: 1, timeoutMs: 30 }), /timeout|aborted/i);
  assert.equal(signals.length, 2);
  assert.notEqual(signals[0], signals[1]);
});
