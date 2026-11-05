import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import c from './f1tvClient.js';

/** Minimal stand-in for F1TVClient: ready on demand, fully controllable from the test. */
class FakeClient extends EventEmitter {
  constructor(name, { ascendon = 'asc-' + name, entitlement = 'ent-' + name } = {}) {
    super();
    this.name = name;
    this.ascendon = ascendon;
    this.entitlement = entitlement;
    this.location = { userLocation: [{ entitlement: 'F1_TV_Pro_Annual', groupId: 2 }] };
    this.isReady = true;
  }
  refreshLocation() {
    setImmediate(() => this.emit('locationUpdated'));
  }
}

let created;
function useClients(map) {
  created = [];
  c._setClientFactory((token) => {
    const fc = map[token]();
    created.push(fc);
    return fc;
  });
}

const tick = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  c.clearSession();
});
afterEach(() => {
  c._setClientFactory(null);
  c.clearSession();
});

test('a successful init installs the client', async () => {
  useClients({ a: () => new FakeClient('a') });
  const p = c.initClient('a');
  created[0].emit('ready');
  await p;
  assert.equal(c.isClientReady, true);
  assert.equal(c.getClient().name, 'a');
  assert.equal(c.getLicenseRequestHeaders().ascendontoken, 'asc-a');
});

test('the current client keeps serving while a new one initialises (no license-header gap)', async () => {
  useClients({ a: () => new FakeClient('a'), b: () => new FakeClient('b') });
  const first = c.initClient('a');
  created[0].emit('ready');
  await first;

  const second = c.initClient('b'); // not ready yet
  assert.equal(c.isClientReady, true, 'old client must stay ready during re-init');
  assert.equal(c.getLicenseRequestHeaders().ascendontoken, 'asc-a');

  created[1].emit('ready');
  await second;
  assert.equal(c.getClient().name, 'b');
  assert.equal(c.getLicenseRequestHeaders().ascendontoken, 'asc-b');
});

test('a failed init clears the client (same end state as before) and rejects', async () => {
  useClients({ a: () => new FakeClient('a'), bad: () => new FakeClient('bad') });
  const first = c.initClient('a');
  created[0].emit('ready');
  await first;

  const failing = c.initClient('bad');
  created[1].emit('ascendonError', new Error('jwt expired'));
  await assert.rejects(failing, /jwt expired/);
  assert.equal(c.isClientReady, false);
});

test('missing entitlement rejects and clears', async () => {
  useClients({ x: () => new FakeClient('x', { entitlement: null }) });
  const p = c.initClient('x');
  created[0].emit('ready');
  await tick();
  // entitlement wait is 6s in production; unblock it via the error path the client emits
  created[0].emit('entitlementError', new Error('no entitlement'));
  await assert.rejects(p, /entitlement not available/);
  assert.equal(c.isClientReady, false);
});

test('overlapping inits: a stale init that fails late cannot clear the newer, healthy client', async () => {
  useClients({ slow: () => new FakeClient('slow'), fast: () => new FakeClient('fast') });
  const slow = c.initClient('slow'); // id 1, still pending
  const fast = c.initClient('fast'); // id 2
  created[1].emit('ready');
  await fast;
  assert.equal(c.getClient().name, 'fast');

  created[0].emit('ascendonError', new Error('late failure'));
  await assert.rejects(slow, /late failure/);
  assert.equal(c.isClientReady, true);
  assert.equal(c.getClient().name, 'fast');
});

test('overlapping inits: a stale init that succeeds late does not replace the newer client', async () => {
  useClients({ slow: () => new FakeClient('slow'), fast: () => new FakeClient('fast') });
  const slow = c.initClient('slow');
  const fast = c.initClient('fast');
  created[1].emit('ready');
  await fast;
  created[0].emit('ready');
  await slow; // resolves, but must not swap
  assert.equal(c.getClient().name, 'fast');
});

test('concurrent inits with the same token share one init (startup restore + renderer restore race)', async () => {
  useClients({ a: () => new FakeClient('a') });
  const p1 = c.initClient('a');
  const p2 = c.initClient('a');
  assert.equal(p1, p2, 'same in-flight promise');
  assert.equal(created.length, 1, 'only one client is created and only one set of F1 requests is made');
  created[0].emit('ready');
  await Promise.all([p1, p2]);
  assert.equal(c.getClient().name, 'a');
});

test('after an init settles, the next call with the same token starts a fresh init', async () => {
  useClients({ a: () => new FakeClient('a') });
  const first = c.initClient('a');
  created[0].emit('ready');
  await first;
  const second = c.initClient('a');
  assert.notEqual(first, second);
  assert.equal(created.length, 2);
  created[1].emit('ready');
  await second;
});

test('a superseded init that succeeds still installs its client when nothing else did', async () => {
  useClients({ slow: () => new FakeClient('slow'), fast: () => new FakeClient('fast') });
  const slow = c.initClient('slow'); // id 1
  const fast = c.initClient('fast'); // id 2 (latest) ...
  created[1].emit('ascendonError', new Error('jwt expired')); // ... fails: nothing installed
  await assert.rejects(fast, /jwt expired/);
  assert.equal(c.isClientReady, false);
  created[0].emit('ready'); // the older init finishes fine
  await slow;
  assert.equal(c.isClientReady, true);
  assert.equal(c.getClient().name, 'slow');
});

test('sign-out while an init is in flight: the client is NOT installed afterwards (logout stays a logout)', async () => {
  useClients({ a: () => new FakeClient('a'), b: () => new FakeClient('b') });
  const first = c.initClient('a');
  created[0].emit('ready');
  await first;
  const pending = c.initClient('b'); // e.g. the license-proxy 403 retry or the proactive refresh
  c.clearSession(); // user clicks Sign out
  created[1].emit('ready');
  await assert.rejects(pending, /Session cleared/);
  assert.equal(c.isClientReady, false);
  assert.equal(c.getLicenseRequestHeaders(), null);
});

test('after a sign-out, a new sign-in works normally', async () => {
  useClients({ a: () => new FakeClient('a') });
  c.clearSession();
  const p = c.initClient('a');
  created[0].emit('ready');
  await p;
  assert.equal(c.isClientReady, true);
});
