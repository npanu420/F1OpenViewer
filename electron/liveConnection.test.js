import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import lc from './liveConnection.js';

const RS = '\x1e';

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
    this.closed = false;
    this.terminated = false;
  }
  send(m) { this.sent.push(m); }
  close() {
    this.closed = true;
    setImmediate(() => this.emit('close'));
  }
  terminate() {
    this.terminated = true;
    this.emit('close');
  }
}

const splitFrames = (raw) => String(raw).split(RS).filter(Boolean).map((p) => JSON.parse(p));
const toRecords = (frames) =>
  frames.filter((f) => f.type === 1 && f.target === 'feed').map((f) => ({ feed: f.arguments[0], data: f.arguments[1] }));

function harness(over = {}) {
  const sockets = [];
  const statuses = [];
  const records = [];
  const negotiate = vi.fn(over.negotiate || (async () => ({ token: 't' })));
  const conn = lc.createLiveConnection({
    negotiate,
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    splitFrames,
    toRecords,
    feeds: ['TimingData'],
    onRecord: (feed, data) => records.push({ feed, data }),
    onStatus: (s, d) => statuses.push(d ? `${s}:${d}` : s),
    random: () => 0.5, // jitter factor exactly 1
    ...over.deps,
  });
  return { conn, sockets, statuses, records, negotiate };
}

/** Drive a socket through open + handshake so the connection reports "connected". */
function handshake(sock) {
  sock.emit('open');
  sock.emit('message', '{}' + RS);
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

test('backoffDelay doubles up to the cap and jitters within +/-20%', () => {
  expect(lc.backoffDelay(0, {}, () => 0.5)).toBe(1000);
  expect(lc.backoffDelay(1, {}, () => 0.5)).toBe(2000);
  expect(lc.backoffDelay(3, {}, () => 0.5)).toBe(8000);
  expect(lc.backoffDelay(20, {}, () => 0.5)).toBe(30000);
  expect(lc.backoffDelay(2, {}, () => 0)).toBe(3200);
  expect(lc.backoffDelay(2, {}, () => 1)).toBe(4800);
});

test('start is idempotent, even while negotiate is still in flight (no duplicate sockets)', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness({ negotiate: async () => { await gate; return { token: 't' }; } });
  h.conn.start();
  h.conn.start();
  h.conn.start();
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.negotiate).toHaveBeenCalledTimes(1);
  expect(h.sockets).toHaveLength(1);
  h.conn.stop();
});

test('handshake -> Subscribe -> records are forwarded; status connected', async () => {
  const h = harness();
  h.conn.start();
  await vi.advanceTimersByTimeAsync(0);
  const s = h.sockets[0];
  handshake(s);
  expect(h.statuses).toContain('connected');
  expect(s.sent[0]).toContain('"protocol":"json"');
  expect(s.sent[1]).toContain('"target":"Subscribe"');
  s.emit('message', JSON.stringify({ type: 1, target: 'feed', arguments: ['TimingData', { a: 1 }] }) + RS);
  expect(h.records).toEqual([{ feed: 'TimingData', data: { a: 1 } }]);
  h.conn.stop();
});

test('a dropped socket reconnects with backoff, and a failing reconnect keeps retrying (old bug: gave up)', async () => {
  let failNegotiate = false;
  const h = harness({ negotiate: async () => { if (failNegotiate) throw new Error('net down'); return { token: 't' }; } });
  h.conn.start();
  await vi.advanceTimersByTimeAsync(0);
  handshake(h.sockets[0]);

  failNegotiate = true;
  h.sockets[0].emit('close');
  expect(h.statuses).toContain('disconnected');
  await vi.advanceTimersByTimeAsync(1000); // 1st retry -> negotiate fails
  expect(h.negotiate).toHaveBeenCalledTimes(2);
  expect(h.statuses.some((s) => s.startsWith('error:net down'))).toBe(true);
  await vi.advanceTimersByTimeAsync(2000); // 2nd retry (backoff doubled) -> fails again
  expect(h.negotiate).toHaveBeenCalledTimes(3);

  failNegotiate = false;
  await vi.advanceTimersByTimeAsync(4000); // 3rd retry succeeds
  expect(h.negotiate).toHaveBeenCalledTimes(4);
  expect(h.sockets).toHaveLength(2);
  handshake(h.sockets[1]);
  expect(h.statuses.filter((s) => s === 'connected')).toHaveLength(2);
  h.conn.stop();
});

test('backoff resets after a healthy handshake', async () => {
  const h = harness();
  h.conn.start();
  await vi.advanceTimersByTimeAsync(0);
  handshake(h.sockets[0]);
  h.sockets[0].emit('close');
  await vi.advanceTimersByTimeAsync(1000); // attempt 0 -> 1s
  handshake(h.sockets[1]);
  h.sockets[1].emit('close');
  await vi.advanceTimersByTimeAsync(1000); // reset => 1s again, not 2s
  expect(h.sockets).toHaveLength(3);
  h.conn.stop();
});

test('handshake error closes the socket and schedules a reconnect', async () => {
  const h = harness();
  h.conn.start();
  await vi.advanceTimersByTimeAsync(0);
  h.sockets[0].emit('open');
  h.sockets[0].emit('message', JSON.stringify({ error: 'bad protocol' }) + RS);
  expect(h.statuses).toContain('error:bad protocol');
  await vi.advanceTimersByTimeAsync(1000); // close (setImmediate) then backoff
  expect(h.sockets.length).toBeGreaterThanOrEqual(2);
  h.conn.stop();
});

test('watchdog terminates a socket that went silent', async () => {
  const h = harness({ deps: { options: { watchdogMs: 20000, watchdogCheckMs: 1000, keepaliveMs: 999999 } } });
  h.conn.start();
  await vi.advanceTimersByTimeAsync(0);
  handshake(h.sockets[0]);
  await vi.advanceTimersByTimeAsync(21000);
  expect(h.sockets[0].terminated).toBe(true);
  expect(h.statuses).toContain('error:connection stalled');
  h.conn.stop();
});

test('server traffic keeps the watchdog quiet', async () => {
  const h = harness({ deps: { options: { watchdogMs: 20000, watchdogCheckMs: 1000, keepaliveMs: 999999 } } });
  h.conn.start();
  await vi.advanceTimersByTimeAsync(0);
  handshake(h.sockets[0]);
  for (let i = 0; i < 6; i++) {
    await vi.advanceTimersByTimeAsync(10000);
    h.sockets[0].emit('message', JSON.stringify({ type: 6 }) + RS);
  }
  expect(h.sockets[0].terminated).toBe(false);
  h.conn.stop();
});

test('stop() cancels reconnects and an in-flight negotiate cannot resurrect the connection', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness({ negotiate: async () => { await gate; return { token: 't' }; } });
  h.conn.start();
  h.conn.stop(); // negotiate still pending
  release();
  await vi.advanceTimersByTimeAsync(5000);
  expect(h.sockets).toHaveLength(0);
  expect(h.conn.isRunning()).toBe(false);

  const h2 = harness();
  h2.conn.start();
  await vi.advanceTimersByTimeAsync(0);
  handshake(h2.sockets[0]);
  h2.sockets[0].emit('close');
  h2.conn.stop(); // reconnect timer pending
  await vi.advanceTimersByTimeAsync(60000);
  expect(h2.sockets).toHaveLength(1);
});

test('stop() then start() creates a fresh connection', async () => {
  const h = harness();
  h.conn.start();
  await vi.advanceTimersByTimeAsync(0);
  handshake(h.sockets[0]);
  h.conn.stop();
  expect(h.sockets[0].closed).toBe(true);
  h.conn.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.sockets).toHaveLength(2);
  h.conn.stop();
});

test('a socket that never opens/handshakes is terminated after the handshake timeout and retried', async () => {
  const h = harness({ deps: { options: { handshakeTimeoutMs: 5000 } } });
  h.conn.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.sockets).toHaveLength(1); // created, but no 'open' and no handshake ever arrives
  await vi.advanceTimersByTimeAsync(5001);
  expect(h.sockets[0].terminated).toBe(true);
  expect(h.statuses).toContain('error:handshake timed out');
  await vi.advanceTimersByTimeAsync(1500); // backoff, then a new attempt
  expect(h.sockets).toHaveLength(2);
  h.conn.stop();
});

test('a completed handshake cancels the handshake timeout', async () => {
  const h = harness({ deps: { options: { handshakeTimeoutMs: 5000, watchdogMs: 999999, keepaliveMs: 999999 } } });
  h.conn.start();
  await vi.advanceTimersByTimeAsync(0);
  handshake(h.sockets[0]);
  await vi.advanceTimersByTimeAsync(20000);
  expect(h.sockets[0].terminated).toBe(false);
  h.conn.stop();
});

test('a throwing record consumer does not break the connection', async () => {
  const seen = [];
  const h = harness({
    deps: {
      onRecord: (feed) => { seen.push(feed); throw new Error('window destroyed'); },
    },
  });
  h.conn.start();
  await vi.advanceTimersByTimeAsync(0);
  handshake(h.sockets[0]);
  const frame = (feed) => JSON.stringify({ type: 1, target: 'feed', arguments: [feed, {}] }) + RS;
  expect(() => h.sockets[0].emit('message', frame('A') + frame('B'))).not.toThrow();
  expect(() => h.sockets[0].emit('message', frame('C'))).not.toThrow();
  expect(seen.length).toBeGreaterThanOrEqual(2); // kept receiving after the first throw
  expect(h.sockets[0].terminated).toBe(false);
  h.conn.stop();
});

test('resubscribe: a window attaching to a running connection gets a fresh Subscribe (snapshot) and "connected"', async () => {
  const h = harness();
  h.conn.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.conn.resubscribe()).toBe(false); // before the handshake: nothing to do, the handshake will subscribe
  handshake(h.sockets[0]);
  const subscribes = () => h.sockets[0].sent.filter((m) => m.includes('"target":"Subscribe"'));
  expect(subscribes()).toHaveLength(1);
  const connectedBefore = h.statuses.filter((s) => s === 'connected').length;
  expect(h.conn.resubscribe()).toBe(true);
  expect(subscribes()).toHaveLength(2);
  expect(JSON.parse(subscribes()[0].slice(0, -1)).invocationId).not.toBe(JSON.parse(subscribes()[1].slice(0, -1)).invocationId);
  expect(h.statuses.filter((s) => s === 'connected').length).toBe(connectedBefore + 1);
  h.sockets[0].emit('close');
  expect(h.conn.resubscribe()).toBe(false); // dropped socket: the reconnect will subscribe
  h.conn.stop();
  expect(h.conn.resubscribe()).toBe(false);
});
