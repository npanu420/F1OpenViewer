/**
 * Build with code signing, then run VMP signing manually (without running EVS during afterSign).
 * Usage: npm run build:signed   or   node scripts/build-and-sign-vmp.js
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const isWin = process.platform === 'win32';
const winUnpacked = path.join(root, 'release', 'win-unpacked');

console.log('[build-and-sign-vmp] Building with SKIP_EVS_SIGN=1...\n');
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
  console.log('[build-and-sign-vmp] Build complete. For VMP signing on macOS: run it manually after the build.');
  process.exit(0);
}

if (!fs.existsSync(winUnpacked)) {
  console.warn('[build-and-sign-vmp] release\\win-unpacked folder not found, skipping VMP signing.');
  process.exit(0);
}

// Use --force to request a fresh VMP signature (avoids DRM 403 when cached signature does not match the exe)
const forceVmp = process.env.FORCE_VMP_SIGN === '1' || process.env.FORCE_VMP_SIGN === 'true';
const signArgs = ['-m', 'castlabs_evs.vmp', 'sign-pkg', winUnpacked];
if (forceVmp) {
  signArgs.push('--force');
  console.log('[build-and-sign-vmp] VMP signing with --force (FORCE_VMP_SIGN=1)');
}
console.log('\n[build-and-sign-vmp] Running VMP signing on', winUnpacked, '...');
const py = 'py';

const sign = spawnSync(py, signArgs, {
  cwd: root,
  stdio: 'inherit',
});

if (sign.status !== 0) {
  console.warn('[build-and-sign-vmp] VMP signing failed (exit', sign.status, '). Exe in release\\win-unpacked is already code-signed.');
  process.exit(0);
}

console.log('\n[build-and-sign-vmp] Build and VMP signing complete.');
