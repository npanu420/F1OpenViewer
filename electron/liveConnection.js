/**
 * Resilient SignalR Core live connection, decoupled from the network so it can be unit-tested with
 * fakes. Guarantees:
 *  - one connection at a time (start() is idempotent, including while a negotiate is in flight);
 *  - automatic reconnect with exponential backoff, also when the *reconnect attempt itself* fails
 *    (negotiate/network error) - the old code gave up silently in that case;
 *  - a watchdog that drops connections the server stopped talking on (half-open sockets);
 *  - stop() cancels every timer and any in-flight negotiate, so a late result can't resurrect it.
 */

const SIGNALR_RS = '\x1e';

const DEFAULTS = {
  keepaliveMs: 15000,
  /** No frame (incl. server pings) for this long => the socket is dead. */
  watchdogMs: 45000,
  watchdogCheckMs: 5000,
  /** The socket must open and complete the SignalR handshake within this time (ws has no default timeout). */
  handshakeTimeoutMs: 20000,
  backoffBaseMs: 1000,
  backoffMaxMs: 30000,
};

/** Delay before reconnect attempt number `attempt` (0-based): 1s, 2s, 4s ... capped, +/-20% jitter. */
function backoffDelay(attempt, opts = {}, random = Math.random) {
  const base = opts.backoffBaseMs ?? DEFAULTS.backoffBaseMs;
  const max = opts.backoffMaxMs ?? DEFAULTS.backoffMaxMs;
  const raw = Math.min(max, base * 2 ** Math.max(0, attempt));
  const jitter = 1 + (random() * 0.4 - 0.2);
  return Math.round(raw * jitter);
}

/**
 * @param {object} deps
 * @param {() => Promise<any>} deps.negotiate   resolves connection info handed to createSocket
 * @param {(info:any) => any} deps.createSocket returns a `ws`-like emitter (open/message/close/error, send, close, terminate)
 * @param {(raw:string) => any[]} deps.splitFrames
 * @param {(frames:any[]) => Array<{feed:string,data:any}>} deps.toRecords
 * @param {string[]} deps.feeds
 * @param {(feed:string, data:any) => void} deps.onRecord
 * @param {(status:string, detail?:string) => void} [deps.onStatus]
 * @param {object} [deps.options] overrides for DEFAULTS
 * @param {() => number} [deps.random]
 */
function createLiveConnection(deps) {
  const opts = { ...DEFAULTS, ...(deps.options || {}) };
  const random = deps.random || Math.random;
  const status = (s, d) => { try { deps.onStatus && deps.onStatus(s, d); } catch (_) {} };

  let running = false;
  let generation = 0; // bumped by stop(); stale async results compare against it
  let ws = null;
  let attempt = 0;
  let reconnectTimer = null;
  let keepaliveTimer = null;
  let watchdogTimer = null;
  let handshakeTimer = null;
  /** The socket that completed the handshake (and so can take a Subscribe). */
  let readySocket = null;
  let invocationSeq = 0;

  function subscribe(socket) {
    invocationSeq += 1;
    socket.send(JSON.stringify({ type: 1, invocationId: String(invocationSeq), target: 'Subscribe', arguments: [deps.feeds] }) + SIGNALR_RS);
  }
  let lastActivity = 0;
  let connecting = false;

  function clearSocketTimers() {
    if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
    if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
    if (handshakeTimer) { clearTimeout(handshakeTimer); handshakeTimer = null; }
  }

  function scheduleReconnect(gen) {
    if (!running || gen !== generation || reconnectTimer) return;
    const delay = backoffDelay(attempt, opts, random);
    attempt += 1;
    status('reconnecting', `retry in ${Math.max(1, Math.round(delay / 1000))}s`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect(gen);
    }, delay);
  }

  async function connect(gen) {
    if (!running || gen !== generation || connecting || ws) return;
    connecting = true;
    let socket;
    try {
      const info = await deps.negotiate();
      if (!running || gen !== generation) return;
      socket = deps.createSocket(info);
    } catch (e) {
      if (running && gen === generation) {
        status('error', (e && e.message) || 'negotiate failed');
        scheduleReconnect(gen);
      }
      return;
    } finally {
      // A stale attempt (stop() ran meanwhile) must not clear the flag of a newer generation.
      if (gen === generation) connecting = false;
    }

    ws = socket;
    let handshaken = false;
    lastActivity = Date.now();

    // A socket that never opens (or never answers the handshake) would otherwise hang forever:
    // the watchdog below only starts after a successful handshake.
    handshakeTimer = setTimeout(() => {
      handshakeTimer = null;
      if (ws !== socket || handshaken) return;
      status('error', 'handshake timed out');
      try { (socket.terminate || socket.close).call(socket); } catch (_) {}
    }, opts.handshakeTimeoutMs);

    socket.on('open', () => {
      socket.send(JSON.stringify({ protocol: 'json', version: 1 }) + SIGNALR_RS);
    });

    socket.on('message', (raw) => {
      if (ws !== socket) return;
      lastActivity = Date.now();
      const frames = deps.splitFrames(String(raw));
      if (!handshaken) {
        if (!frames.length) return;
        const handshake = frames.shift();
        if (handshake && handshake.error) {
          status('error', String(handshake.error));
          try { socket.close(); } catch (_) {}
          return;
        }
        handshaken = true;
        if (handshakeTimer) { clearTimeout(handshakeTimer); handshakeTimer = null; }
        attempt = 0; // healthy again: next drop starts from the shortest delay
        readySocket = socket;
        subscribe(socket);
        status('connected');
        keepaliveTimer = setInterval(() => {
          try { socket.send(JSON.stringify({ type: 6 }) + SIGNALR_RS); } catch (_) {}
        }, opts.keepaliveMs);
        watchdogTimer = setInterval(() => {
          if (Date.now() - lastActivity > opts.watchdogMs) {
            status('error', 'connection stalled');
            try { (socket.terminate || socket.close).call(socket); } catch (_) {}
          }
        }, opts.watchdogCheckMs);
      }
      // Consumers (window broadcasts) can throw, e.g. a window destroyed mid-send. That must never
      // escape into the socket's event emitter (uncaught exception in the main process).
      try {
        for (const rec of deps.toRecords(frames)) deps.onRecord(rec.feed, rec.data);
      } catch (e) {
        console.warn('[live] record handler failed:', e && e.message);
      }
    });

    socket.on('close', () => {
      if (readySocket === socket) readySocket = null;
      if (ws !== socket) return;
      ws = null;
      clearSocketTimers();
      if (!running || gen !== generation) return;
      status('disconnected');
      scheduleReconnect(gen);
    });

    socket.on('error', (err) => {
      if (ws !== socket) return;
      status('error', err && err.message);
    });
  }

  return {
    /** Idempotent: a second call while running or negotiating is a no-op. */
    start() {
      if (running) return;
      running = true;
      attempt = 0;
      connect(generation);
    },
    stop() {
      running = false;
      generation += 1;
      connecting = false;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      clearSocketTimers();
      const s = ws;
      ws = null;
      readySocket = null;
      if (s) { try { s.close(); } catch (_) {} }
    },
    /**
     * Re-sends Subscribe on the live socket so a newly attached window gets the full snapshot, and
     * re-announces 'connected'. Before the handshake it does nothing: the pending handshake will
     * subscribe and announce anyway. Returns true when a Subscribe was sent.
     */
    resubscribe() {
      if (!running || !readySocket || readySocket !== ws) return false;
      try {
        subscribe(readySocket);
      } catch (_) {
        return false;
      }
      status('connected');
      return true;
    },
    isRunning() {
      return running;
    },
  };
}

module.exports = { createLiveConnection, backoffDelay, SIGNALR_RS, DEFAULTS };
