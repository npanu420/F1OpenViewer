/**
 * Build con code signing, poi firma VMP a mano (senza eseguire EVS durante afterSign).
 * Uso: npm run build:signed   oppure   node scripts/build-and-sign-vmp.js
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const isWin = process.platform === 'win32';
const winUnpacked = path.join(root, 'release', 'win-unpacked');

console.log('[build-and-sign-vmp] Build con SKIP_EVS_SIGN=1...\n');
const buildEnv = { ...process.env, SKIP_EVS_SIGN: '1' };
const build = spawnSync('npm', ['run', 'build'], {
  cwd: root,
  env: buildEnv,
  stdio: 'inherit',
  shell: true,
});
if (build.status !== 0) {
  process.exit(build.status || 1);
}

if (!isWin) {
  console.log('[build-and-sign-vmp] Build completata. Firma VMP su macOS: esegui a mano dopo la build.');
  process.exit(0);
}

if (!fs.existsSync(winUnpacked)) {
  console.warn('[build-and-sign-vmp] Cartella release\\win-unpacked non trovata, skip firma VMP.');
  process.exit(0);
}

console.log('\n[build-and-sign-vmp] Firma VMP su', winUnpacked, '...\n');
const py = 'py';
const sign = spawnSync(py, ['-m', 'castlabs_evs.vmp', 'sign-pkg', winUnpacked], {
  cwd: root,
  stdio: 'inherit',
});
if (sign.status !== 0) {
  console.warn('[build-and-sign-vmp] Firma VMP fallita (exit', sign.status, '). Exe in release\\win-unpacked è già code-signed.');
  process.exit(0);
}
console.log('\n[build-and-sign-vmp] Build e firma VMP completate.');
