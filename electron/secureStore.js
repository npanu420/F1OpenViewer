/**
 * Encrypted-at-rest storage for the account token and cookies, using Electron's `safeStorage`
 * (DPAPI on Windows, Keychain on macOS, libsecret on Linux). Falls back to plain text only when the
 * OS cannot provide encryption. Files written by older versions (plain JSON) are still readable and
 * are upgraded the next time they are written. `safeStorage` is injected so this stays testable.
 */

const fs = require('fs');
const path = require('path');

const FORMAT = 'f1ov-safestorage-v1';

function createSecureStore(safeStorage) {
  const available = () => {
    try {
      return !!safeStorage && safeStorage.isEncryptionAvailable();
    } catch (_) {
      return false;
    }
  };

  return {
    isEncryptionAvailable: available,

    /** Atomically writes `text`, encrypted when possible. Throws on I/O errors. */
    writeText(filePath, text) {
      const body = available()
        ? JSON.stringify({ format: FORMAT, data: safeStorage.encryptString(String(text)).toString('base64') })
        : String(text);
      const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
      fs.writeFileSync(tmp, body, 'utf8');
      fs.renameSync(tmp, filePath);
    },

    /**
     * @returns {{text:string, encrypted:boolean}|null} null when the file is missing or cannot be
     * decrypted (e.g. copied from another machine/user); `encrypted:false` marks a legacy plain file.
     */
    readText(filePath) {
      let raw;
      try {
        if (!fs.existsSync(filePath)) return null;
        raw = fs.readFileSync(filePath, 'utf8');
      } catch (_) {
        return null;
      }
      let envelope = null;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.format === FORMAT) envelope = parsed;
      } catch (_) {}
      if (!envelope) return { text: raw, encrypted: false };
      try {
        if (!available() || typeof envelope.data !== 'string') return null;
        return { text: safeStorage.decryptString(Buffer.from(envelope.data, 'base64')), encrypted: true };
      } catch (_) {
        return null;
      }
    },
  };
}

module.exports = { createSecureStore, FORMAT };
