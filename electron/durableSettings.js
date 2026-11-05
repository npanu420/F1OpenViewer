/**
 * Durable renderer settings: the allowlist of localStorage keys mirrored to userData, and a tiny
 * JSON store with an in-memory cache and atomic writes. Kept free of `electron` imports so it can
 * be unit-tested; session.js supplies the file path.
 *
 * KEEP IN SYNC with DURABLE_KEYS in src/services/durableStorage.ts (a test enforces this).
 */

const fs = require('fs');
const path = require('path');

const DURABLE_SETTINGS_KEYS = new Set([
  'f1openviewer-locale',
  'f1-theme',
  'f1-dismissed-update-version',
  'f1openviewer-saved-grids',
  'f1openviewer-sync-offset-threshold',
  'f1openviewer-sync-done-delay-ms',
  'f1openviewer-sync-keep-locked',
  'f1openviewer-sync-reference-mode',
  'f1openviewer-livetiming-dock-width',
  'f1openviewer-header-collapsed',
]);

/** Keys that are a prefix + free-form suffix (e.g. per-session live-timing sync offsets). */
const DURABLE_SETTINGS_PREFIXES = ['f1lt-sync:'];

/** Upper bound for one value; a corrupted renderer must not be able to fill the disk. */
const MAX_VALUE_LENGTH = 512 * 1024;

function isDurableKey(key) {
  if (typeof key !== 'string' || !key) return false;
  if (DURABLE_SETTINGS_KEYS.has(key)) return true;
  return DURABLE_SETTINGS_PREFIXES.some((p) => key.startsWith(p) && key.length > p.length && key.length <= 300);
}

/** @param {string} filePath JSON file path (parent directory must exist). */
function createSettingsStore(filePath) {
  let cache = null;

  function load() {
    if (cache) return cache;
    try {
      if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } else {
        cache = {};
      }
    } catch (_) {
      cache = {};
    }
    return cache;
  }

  function flush() {
    const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(cache));
    fs.renameSync(tmp, filePath);
  }

  return {
    getAll() {
      return { ...load() };
    },
    /** Forget everything (used by "reset all data"): empties the cache and deletes the file. */
    clear() {
      cache = {};
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (e) {
        console.warn('[settings] clear failed:', e?.message);
      }
    },
    /** @returns {boolean} true when the value was accepted and written. */
    set(key, value) {
      if (!isDurableKey(key) || typeof value !== 'string' || value.length > MAX_VALUE_LENGTH) return false;
      const all = load();
      if (all[key] === value) return true;
      all[key] = value;
      try {
        flush();
        return true;
      } catch (e) {
        console.warn('[settings] persist failed:', e?.message);
        return false;
      }
    },
  };
}

module.exports = { DURABLE_SETTINGS_KEYS, DURABLE_SETTINGS_PREFIXES, isDurableKey, createSettingsStore };
