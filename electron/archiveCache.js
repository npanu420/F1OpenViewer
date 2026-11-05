/**
 * Caches for the public timing archive.
 *
 *  - createDiskCache(dir): gzip files keyed by URL hash. Only used for sessions that ended long ago,
 *    whose static files no longer change (so a stale entry can't happen).
 *  - createMemoCache(ttl, max): in-memory promise cache, so the dock and a popout opening the same
 *    session (or two feeds asking for the same Index.json) share one download. Failed promises are
 *    dropped immediately so the next call retries.
 *
 * No `electron` imports: the cache directory is supplied by the caller.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

/** A session folder is `<year>/<date>_<meeting>/<date>_<session>/`; the last segment carries the date. */
function sessionDateFromPath(sessionPath) {
  const m = String(sessionPath || '').match(/(\d{4}-\d{2}-\d{2})_[^/]*\/?$/);
  return m ? Date.parse(`${m[1]}T00:00:00Z`) : null;
}

/** True when the session is old enough that its archive files are final and safe to cache on disk. */
function isCacheableSessionPath(sessionPath, now = Date.now(), minAgeMs = 3 * 24 * 3600 * 1000) {
  const t = sessionDateFromPath(sessionPath);
  return t != null && now - t >= minAgeMs;
}

function createDiskCache(dir) {
  const fileFor = (key) => path.join(dir, crypto.createHash('sha1').update(String(key)).digest('hex') + '.gz');
  return {
    /** @returns {string|null} cached text, or null when missing/unreadable. */
    get(key) {
      try {
        const p = fileFor(key);
        if (!fs.existsSync(p)) return null;
        const text = zlib.gunzipSync(fs.readFileSync(p)).toString('utf8');
        // Touch so pruning by age keeps recently used sessions.
        const now = new Date();
        fs.utimesSync(p, now, now);
        return text;
      } catch (_) {
        return null;
      }
    },
    set(key, text) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        const p = fileFor(key);
        const tmp = `${p}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, zlib.gzipSync(Buffer.from(String(text), 'utf8')));
        fs.renameSync(tmp, p);
        return true;
      } catch (e) {
        console.warn('[livetiming-cache] write failed:', e?.message);
        return false;
      }
    },
    /** Delete every cached file. Returns the number removed. */
    clear() {
      let removed = 0;
      try {
        for (const name of fs.readdirSync(dir)) {
          try { fs.unlinkSync(path.join(dir, name)); removed++; } catch (_) {}
        }
      } catch (_) {}
      return removed;
    },
    /** Delete entries not used for `maxAgeMs`. Returns the number removed. */
    prune(maxAgeMs = 60 * 24 * 3600 * 1000, now = Date.now()) {
      let removed = 0;
      try {
        for (const name of fs.readdirSync(dir)) {
          const p = path.join(dir, name);
          try {
            if (now - fs.statSync(p).mtimeMs > maxAgeMs) {
              fs.unlinkSync(p);
              removed++;
            }
          } catch (_) {}
        }
      } catch (_) {}
      return removed;
    },
  };
}

function createMemoCache(ttlMs, max = 4, now = () => Date.now()) {
  const map = new Map(); // key -> { at, promise }
  return {
    /** Returns the cached promise, or runs `load` once and caches its promise (dropped on failure). */
    get(key, load) {
      const hit = map.get(key);
      if (hit && now() - hit.at < ttlMs) {
        // refresh recency (Map keeps insertion order => oldest first)
        map.delete(key);
        map.set(key, hit);
        return hit.promise;
      }
      map.delete(key);
      const promise = Promise.resolve().then(load);
      const entry = { at: now(), promise };
      map.set(key, entry);
      promise.catch(() => {
        if (map.get(key) === entry) map.delete(key);
      });
      while (map.size > max) map.delete(map.keys().next().value);
      return promise;
    },
    clear() {
      map.clear();
    },
    get size() {
      return map.size;
    },
  };
}

module.exports = { sessionDateFromPath, isCacheableSessionPath, createDiskCache, createMemoCache };
