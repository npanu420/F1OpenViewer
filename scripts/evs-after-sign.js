/**
 * electron-builder afterSign hook: VMP (Widevine) signing with Castlabs EVS.
 * On Windows, VMP must be applied AFTER code signing (order required by Castlabs).
 * Requires: pip install castlabs-evs and EVS login (python3 -m castlabs_evs.account reauth).
 *
 * IMPORTANT: Do NOT modify the exe (e.g. with rcedit for icon) after VMP signing.
 * Any change after VMP invalidates the Widevine signature and causes
 * "Verified media path has been tampered" / PLATFORM_TAMPERED. The icon is
 * already applied in afterPack (apply-exe-icon.js) before code sign.
 */
const { spawn } = require('child_process');

function runEvsSignPkg(appOutDir) {
  return new Promise((resolve, reject) => {
    const py = process.platform === 'win32' ? 'py' : 'python3';
    const args = ['-m', 'castlabs_evs.vmp', '-n', 'sign-pkg', appOutDir];
    const env = { ...process.env, EVS_NO_ASK: '1' };
    const child = spawn(py, args, {
      stdio: 'inherit',
      shell: true,
      env,
    });
    const timeoutMs = 35000; // 35 s: if Castlabs doesn't respond, skip and sign manually
    const timeout = setTimeout(() => {
      try {
        if (process.platform === 'win32') {
          require('child_process').execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore', windowsHide: true });
        } else {
          child.kill('SIGKILL');
        }
      } catch (_) {}
      console.warn('[evs-after-sign] VMP signing timeout. Sign manually after build: python -m castlabs_evs.vmp sign-pkg "' + appOutDir + '"');
      resolve();
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timeout);
      if (err.code === 'ENOENT') {
        console.warn('[evs-after-sign] Python/EVS not found; skipping VMP signing. To enable: pip install castlabs-evs');
        resolve();
        return;
      }
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else {
        console.warn('[evs-after-sign] VMP signing skipped (exit code', code, '). Renew login in a terminal: python -m castlabs_evs.account reauth');
        resolve(); // don't fail the build: VMP is optional
      }
    });
  });
}

exports.default = async function afterSign(context) {
  // Windows only: VMP after code sign. On macOS it's done earlier (afterPack), so we do nothing here.
  if (context.electronPlatformName !== 'win32') {
    return;
  }
  if (process.env.SKIP_EVS_SIGN === '1' || process.env.SKIP_EVS_SIGN === 'true') {
    console.warn('[evs-after-sign] SKIP_EVS_SIGN set: VMP signing skipped. To sign manually: python -m castlabs_evs.vmp sign-pkg release\\win-unpacked');
    return;
  }
  const appOutDir = context.appOutDir;
  if (!appOutDir) {
    console.warn('[evs-after-sign] appOutDir missing, skipping VMP signing');
    return;
  }
  console.log('[evs-after-sign] Running Widevine VMP signing on', appOutDir);
  try {
    await runEvsSignPkg(appOutDir);
    console.log('[evs-after-sign] VMP signing complete.');
  } catch (e) {
    console.warn('[evs-after-sign] VMP not run:', e?.message || e);
    // don't throw: build continues without VMP signing
  }

  // Do NOT re-apply icon here after VMP: modifying the exe after Widevine signing
  // causes "Verified media path has been tampered". Icon is applied in afterPack.
};
