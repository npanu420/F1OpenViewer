import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import ac from './archiveCache.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'f1ov-cache-'));
const DAY = 24 * 3600 * 1000;

test('sessionDateFromPath reads the date of the session folder', () => {
  assert.equal(
    ac.sessionDateFromPath('2024/2024-05-05_Miami_Grand_Prix/2024-05-05_Race/'),
    Date.parse('2024-05-05T00:00:00Z')
  );
  assert.equal(ac.sessionDateFromPath('2024/2024-05-05_Miami_Grand_Prix/2024-05-04_Qualifying'), Date.parse('2024-05-04T00:00:00Z'));
  assert.equal(ac.sessionDateFromPath('nonsense/'), null);
  assert.equal(ac.sessionDateFromPath(undefined), null);
});

test('isCacheableSessionPath only accepts sessions older than the min age', () => {
  const now = Date.parse('2026-09-29T12:00:00Z');
  assert.equal(ac.isCacheableSessionPath('2026/2026-09-27_X/2026-09-27_Race/', now), false); // 2 days
  assert.equal(ac.isCacheableSessionPath('2026/2026-09-26_X/2026-09-26_Race/', now), true); // 3+ days
  assert.equal(ac.isCacheableSessionPath('2024/2024-05-05_M/2024-05-05_Race/', now), true);
  assert.equal(ac.isCacheableSessionPath('weird/', now), false);
});

test('disk cache round-trips text (gzip) and misses cleanly', () => {
  const dir = tmp();
  const c = ac.createDiskCache(dir);
  assert.equal(c.get('https://x/a.jsonStream'), null);
  const big = 'line\n'.repeat(50000);
  assert.equal(c.set('https://x/a.jsonStream', big), true);
  assert.equal(c.get('https://x/a.jsonStream'), big);
  assert.equal(c.get('https://x/other'), null);
  const [file] = fs.readdirSync(dir);
  assert.ok(fs.statSync(path.join(dir, file)).size < big.length / 10, 'stored compressed');
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
});

test('disk cache: a corrupt file behaves like a miss', () => {
  const dir = tmp();
  const c = ac.createDiskCache(dir);
  c.set('k', 'hello');
  const [file] = fs.readdirSync(dir);
  fs.writeFileSync(path.join(dir, file), 'not gzip');
  assert.equal(c.get('k'), null);
});

test('disk cache prune removes only entries unused for longer than maxAge', () => {
  const dir = tmp();
  const c = ac.createDiskCache(dir);
  c.set('old', '1');
  c.set('new', '2');
  const files = fs.readdirSync(dir).map((f) => path.join(dir, f));
  const oldTime = new Date(Date.now() - 90 * DAY);
  // make the entry for 'old' ancient
  for (const f of files) {
    const buf = fs.readFileSync(f);
    if (zlib.gunzipSync(buf).toString() === '1') fs.utimesSync(f, oldTime, oldTime);
  }
  assert.equal(c.prune(60 * DAY), 1);
  assert.equal(c.get('old'), null);
  assert.equal(c.get('new'), '2');
});

test('memo cache shares one in-flight load and serves later calls from memory', async () => {
  const m = ac.createMemoCache(1000);
  let calls = 0;
  const load = async () => { calls++; return 'v'; };
  const [a, b] = await Promise.all([m.get('k', load), m.get('k', load)]);
  assert.equal(a, 'v');
  assert.equal(b, 'v');
  await m.get('k', load);
  assert.equal(calls, 1);
});

test('memo cache drops failures so the next call retries', async () => {
  const m = ac.createMemoCache(1000);
  let calls = 0;
  const load = async () => { calls++; if (calls === 1) throw new Error('boom'); return 'ok'; };
  await assert.rejects(m.get('k', load), /boom/);
  await new Promise((r) => setImmediate(r));
  assert.equal(await m.get('k', load), 'ok');
  assert.equal(calls, 2);
});

test('memo cache expires by ttl and evicts the least recently used beyond max', async () => {
  let t = 0;
  const m = ac.createMemoCache(100, 2, () => t);
  let calls = 0;
  const load = (v) => async () => { calls++; return v; };
  await m.get('a', load('a'));
  t = 150;
  await m.get('a', load('a')); // expired -> reload
  assert.equal(calls, 2);
  await m.get('b', load('b'));
  await m.get('c', load('c')); // evicts a (max 2)
  assert.equal(m.size, 2);
  await m.get('a', load('a'));
  assert.equal(calls, 5);
});

test('disk cache clear removes every entry', () => {
  const dir = tmp();
  const c = ac.createDiskCache(dir);
  c.set('a', '1');
  c.set('b', '2');
  assert.equal(c.clear(), 2);
  assert.equal(c.get('a'), null);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(ac.createDiskCache(path.join(dir, 'missing')).clear(), 0); // missing dir is fine
});
