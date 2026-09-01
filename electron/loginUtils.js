/** Builds a Chrome UA that matches Electron's Chromium version. */
function buildLoginUserAgent(chromeVersion) {
  const version = typeof chromeVersion === 'string' && /^\d+(?:\.\d+){1,3}$/.test(chromeVersion)
    ? chromeVersion
    : '144.0.0.0';
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
}

/** Extracts the subscription token from F1's URL-encoded login-session cookie. */
function tokenFromLoginSessionCookie(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    const token = parsed?.data?.subscriptionToken ?? parsed?.subscriptionToken;
    return typeof token === 'string' && token.trim().length > 50 ? token.trim() : null;
  } catch (_) {
    return null;
  }
}

module.exports = { buildLoginUserAgent, tokenFromLoginSessionCookie };
