/**
 * electron-builder afterSign hook: VMP (Widevine) signing with Castlabs EVS.
 * On Windows, VMP must be applied AFTER code signing (order required by Castlabs).
 * Requires: pip install castlabs-evs and EVS login (python3 -m castlabs_evs.account reauth).
 * After VMP signing, re-applies the icon to the exe (signing can replace the file and drop the icon).
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

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

  // Re-apply icon to the portable exe: VMP signing may have replaced the file without the icon
  const productName = context.packager?.appInfo?.productFilename || 'F1 OpenViewer';
  const exeName = productName + '.exe';
  const exePath = path.join(appOutDir, exeName);
  const iconPath = path.join(process.cwd(), 'build', 'icon.ico');
  if (fs.existsSync(exePath) && fs.existsSync(iconPath)) {
    try {
      const rcedit = require('rcedit');
      await rcedit(exePath, { icon: iconPath });
      console.log('[evs-after-sign] Icon re-applied to', exeName);
    } catch (err) {
      console.warn('[evs-after-sign] Could not re-apply icon:', err?.message || err);
    }
  }
};
