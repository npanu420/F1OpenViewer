/**
 * electron-builder afterPack hook: applies the app icon to the Windows portable exe.
 * Runs on every build so the unpacked exe has the correct icon even without code signing.
 */
const path = require('path');
const fs = require('fs');

async function applyIcon(appOutDir, productFilename) {
  if (!appOutDir || process.platform !== 'win32') return;
  const exeName = (productFilename || 'F1 OpenViewer') + '.exe';
  const exePath = path.join(appOutDir, exeName);
  const iconPath = path.join(process.cwd(), 'build', 'icon.ico');
  if (!fs.existsSync(exePath) || !fs.existsSync(iconPath)) return;
  try {
    const rcedit = require('rcedit');
    await rcedit(exePath, { icon: iconPath });
    console.log('[apply-exe-icon] Icon applied to', exeName);
  } catch (err) {
    console.warn('[apply-exe-icon] Could not apply icon:', err?.message || err);
  }
}

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const productFilename = context.packager?.appInfo?.productFilename;
  await applyIcon(appOutDir, productFilename);
};
