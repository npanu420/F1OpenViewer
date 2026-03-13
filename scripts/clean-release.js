/**
 * Removes the release/ folder (electron-builder output).
 * Run with the app closed; otherwise on Windows files in use will cause "Access is denied".
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const releaseDir = path.join(root, 'release');

if (!fs.existsSync(releaseDir)) {
  console.log('[clean-release] release/ not found, nothing to do.');
  process.exit(0);
}

try {
  fs.rmSync(releaseDir, { recursive: true, force: true });
  console.log('[clean-release] release/ folder removed.');
} catch (err) {
  console.error('[clean-release] Cannot remove release/:', err.message);
  console.error('Close F1 OpenViewer (and any process using files in release/) and try again.');
  process.exit(1);
}
