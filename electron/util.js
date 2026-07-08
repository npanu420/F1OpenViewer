/** Small stateless helpers shared across the main-process modules. */

/** Truncates a secret for logging: keeps a short prefix/suffix + length, never the full value. */
function redact(value) {
  if (value == null) return '';
  const s = String(value);
  if (!s) return '';
  if (s.length <= 16) return `${s.slice(0, 4)}…(len:${s.length})`;
  return `${s.slice(0, 8)}…${s.slice(-4)}(len:${s.length})`;
}

/** Decodes a JWT's payload (no signature check, we don't hold the key). Null if malformed. */
function parseJwtPayload(jwt) {
  if (!jwt || typeof jwt !== 'string' || !jwt.includes('.')) return null;
  try {
    const parts = jwt.split('.');
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(b64 + '='.repeat((4 - (b64.length % 4)) % 4), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
}

/** True for formula1.com itself or any of its subdomains (checks the actual hostname, not a substring match). */
function isFormula1Hostname(hostname) {
  return hostname === 'formula1.com' || hostname.endsWith('.formula1.com');
}

/** Same check, but takes a full URL string and parses it first. */
function hasFormula1Host(urlString) {
  try {
    return isFormula1Hostname(new URL(urlString).hostname);
  } catch {
    return false;
  }
}

module.exports = { redact, parseJwtPayload, isFormula1Hostname, hasFormula1Host };
