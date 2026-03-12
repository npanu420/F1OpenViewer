/**
 * Hook afterSign per electron-builder: firma VMP (Widevine) con Castlabs EVS.
 * Su Windows la VMP va applicata DOPO il code signing (ordine richiesto da Castlabs).
 * Richiede: pip install castlabs-evs e login EVS (python3 -m castlabs_evs.account reauth).
 */
const { spawn } = require('child_process');
const path = require('path');

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
    const timeoutMs = 35000; // 35 s: se Castlabs non risponde, salta e firma a mano
    const timeout = setTimeout(() => {
      try {
        if (process.platform === 'win32') {
          require('child_process').execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore', windowsHide: true });
        } else {
          child.kill('SIGKILL');
        }
      } catch (_) {}
      console.warn('[evs-after-sign] Timeout firma VMP. Firma a mano dopo la build: python -m castlabs_evs.vmp sign-pkg "' + appOutDir + '"');
      resolve();
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timeout);
      if (err.code === 'ENOENT') {
        console.warn('[evs-after-sign] Python/EVS non trovato; salta firma VMP. Per abilitarla: pip install castlabs-evs');
        resolve();
        return;
      }
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else {
        console.warn('[evs-after-sign] Firma VMP saltata (exit code', code, '). Rinnova il login in un terminale: python -m castlabs_evs.account reauth');
        resolve(); // non fallire la build: VMP è opzionale
      }
    });
  });
}

exports.default = async function afterSign(context) {
  // Solo Windows: VMP dopo code sign. Su macOS va fatto prima (afterPack), quindi qui non facciamo nulla.
  if (context.electronPlatformName !== 'win32') {
    return;
  }
  if (process.env.SKIP_EVS_SIGN === '1' || process.env.SKIP_EVS_SIGN === 'true') {
    console.warn('[evs-after-sign] SKIP_EVS_SIGN attivo: firma VMP saltata. Per firmare a mano: python -m castlabs_evs.vmp sign-pkg release\\win-unpacked');
    return;
  }
  const appOutDir = context.appOutDir;
  if (!appOutDir) {
    console.warn('[evs-after-sign] appOutDir mancante, skip VMP signing');
    return;
  }
  console.log('[evs-after-sign] Firma VMP Widevine su', appOutDir);
  try {
    await runEvsSignPkg(appOutDir);
    console.log('[evs-after-sign] VMP signing completato.');
  } catch (e) {
    console.warn('[evs-after-sign] VMP non eseguita:', e?.message || e);
    // non throw: la build prosegue senza firma VMP
  }
};
