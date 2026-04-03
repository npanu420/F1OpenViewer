/**
 * Build with code signing, then run VMP signing with --force (fresh signature for the new exe).
 * Usage: npm run build:signed   or   node scripts/build-and-sign-vmp.js
 *
 * --force is used by default so the new exe always gets a fresh VMP signature from CastLabs EVS,
 * rather than reusing a cached signature from a previous build that no longer matches the exe.
 * A stale cached signature causes DRM 403 / ACN_5002 on Widevine-protected content.
 *
 * Set SKIP_VMP_FORCE=1 to use the cached signature instead (useful when EVS is unreachable).
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

// Default: always use --force so the fresh exe gets a fresh VMP signature from CastLabs EVS.
// Without --force, EVS reuses the cached signature from the previous build, which no longer
// matches the new exe and causes DRM 403 / ACN_5002 on Widevine-protected content.
// Set SKIP_VMP_FORCE=1 only when EVS is unreachable (e.g. VPN/firewall blocking evs-api.castlabs.com).
const skipForce = process.env.SKIP_VMP_FORCE === '1' || process.env.SKIP_VMP_FORCE === 'true';
const useForce = !skipForce;

const signArgs = ['-m', 'castlabs_evs.vmp', 'sign-pkg', winUnpacked];
if (useForce) {
  signArgs.push('--force');
  console.log('\n[build-and-sign-vmp] Running VMP signing with --force on', winUnpacked, '...');
  console.log('[build-and-sign-vmp] (Use SKIP_VMP_FORCE=1 to skip --force and use cached signature instead)');
} else {
  console.log('\n[build-and-sign-vmp] Running VMP signing (cached, SKIP_VMP_FORCE=1) on', winUnpacked, '...');
  console.log('[build-and-sign-vmp] WARNING: cached signature may not match the new exe → DRM 403 risk.');
}

const py = 'py';
const sign = spawnSync(py, signArgs, {
  cwd: root,
  stdio: 'inherit',
});

if (sign.status !== 0) {
  if (useForce) {
    // --force failed (EVS unreachable or auth error). Try without --force as last resort.
    console.warn('\n[build-and-sign-vmp] --force VMP signing failed (exit', sign.status, ').');
    console.warn('[build-and-sign-vmp] Retrying without --force (will use cached signature if available)...');
    const fallbackArgs = ['-m', 'castlabs_evs.vmp', 'sign-pkg', winUnpacked];
    const fallback = spawnSync(py, fallbackArgs, { cwd: root, stdio: 'inherit' });
    if (fallback.status !== 0) {
      console.warn('[build-and-sign-vmp] VMP signing failed completely.');
      console.warn('[build-and-sign-vmp] The exe in release\\win-unpacked is code-signed but NOT VMP-signed.');
      console.warn('[build-and-sign-vmp] Widevine-protected content (e.g. 2026 on-demand races) will return DRM 403.');
      console.warn('[build-and-sign-vmp] Fix: run VMP signing manually when EVS is reachable:');
      console.warn('[build-and-sign-vmp]   py -m castlabs_evs.vmp sign-pkg --force release\\win-unpacked');
    } else {
      console.warn('\n[build-and-sign-vmp] VMP signing complete (used cached signature).');
      console.warn('[build-and-sign-vmp] WARNING: cached signature may not match the new exe → DRM 403 risk.');
      console.warn('[build-and-sign-vmp] Run with --force when EVS is reachable for a guaranteed fresh signature.');
    }
  } else {
    console.warn('[build-and-sign-vmp] VMP signing failed (exit', sign.status, ').');
    console.warn('[build-and-sign-vmp] The exe in release\\win-unpacked is code-signed but NOT VMP-signed.');
  }
  process.exit(0);
}

console.log('\n[build-and-sign-vmp] Build and VMP signing complete (fresh signature).');
