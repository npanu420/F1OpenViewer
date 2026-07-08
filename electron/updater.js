/** One-shot check against GitHub's public releases API, notifying the main window of a newer build. */

const { app } = require('electron');
const axios = require('axios');
const { getMainWindow } = require('./windows');

const GITHUB_REPO = 'npanu420/F1OpenViewer';

/** Numeric dotted-version compare, e.g. "1.2.1" > "1.2.0". Missing segments count as 0. */
function isNewerVersion(latest, current) {
  const a = latest.split('.').map((n) => parseInt(n, 10) || 0);
  const b = current.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

async function checkForUpdate() {
  try {
    const res = await axios.get(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      timeout: 8000,
    });
    const tag = String(res.data?.tag_name || '').replace(/^v/i, '').trim();
    const url = res.data?.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`;
    if (!tag || !isNewerVersion(tag, app.getVersion())) return;
    console.log('[update] newer version available:', tag);
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:updateAvailable', { version: tag, url });
    }
  } catch (e) {
    console.warn('[update] check failed:', e?.message);
  }
}

module.exports = { checkForUpdate };
