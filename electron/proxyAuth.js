/**
 * Shared secret for the local Widevine license proxy. The proxy listens on 127.0.0.1, which any
 * local process (or a web page in the user's browser) can reach; without a secret they could make
 * it send license requests carrying the user's F1 TV tokens. The secret is random per app launch
 * and only travels inside the license URL handed to our own renderer.
 */

const crypto = require('crypto');

function createProxySecret() {
  return crypto.randomBytes(16).toString('hex');
}

/** Constant-time comparison; false for missing/mismatched values. */
function isAuthorized(secret, provided) {
  if (typeof secret !== 'string' || typeof provided !== 'string' || !secret || secret.length !== provided.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(provided));
}

module.exports = { createProxySecret, isAuthorized };
