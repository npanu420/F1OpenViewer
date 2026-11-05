import { test } from 'vitest';
import assert from 'node:assert/strict';
import np from './navigationPolicy.js';

const FILE_APP = 'file:///C:/Program Files/F1 OpenViewer/resources/app/dist/index.html';
const DEV_APP = 'http://127.0.0.1:5173';

test('packaged app: only its own index.html (any hash/query) is allowed', () => {
  assert.equal(np.isAppNavigation('file:///C:/Program%20Files/F1%20OpenViewer/resources/app/dist/index.html#standalone-multiview?mv=2', FILE_APP), true);
  assert.equal(np.isAppNavigation('file:///C:/Program Files/F1 OpenViewer/resources/app/dist/index.html?x=1', FILE_APP), true);
  assert.equal(np.isAppNavigation('file:///C:/Windows/System32/drivers/etc/hosts', FILE_APP), false);
  assert.equal(np.isAppNavigation('file:///C:/Program Files/F1 OpenViewer/resources/app/dist/other.html', FILE_APP), false);
  assert.equal(np.isAppNavigation('https://evil.example/index.html', FILE_APP), false);
});

test('dev server: same origin only', () => {
  assert.equal(np.isAppNavigation('http://127.0.0.1:5173/#standalone-livetiming?path=x', DEV_APP), true);
  assert.equal(np.isAppNavigation('http://127.0.0.1:5174/', DEV_APP), false);
  assert.equal(np.isAppNavigation('https://127.0.0.1:5173/', DEV_APP), false);
  assert.equal(np.isAppNavigation('http://localhost:5173/', DEV_APP), false);
});

test('garbage input is never allowed', () => {
  assert.equal(np.isAppNavigation('not a url', FILE_APP), false);
  assert.equal(np.isAppNavigation('javascript:alert(1)', DEV_APP), false);
  assert.equal(np.isAppNavigation('http://127.0.0.1:5173/', 'nope'), false);
});

test('permissions: only fullscreen, EME and clipboard write are granted', () => {
  for (const p of ['fullscreen', 'mediaKeySystem', 'clipboard-sanitized-write']) assert.equal(np.isPermissionAllowed(p), true, p);
  for (const p of ['media', 'geolocation', 'notifications', 'clipboard-read', 'openExternal', 'display-capture', 'midiSysex', 'unknown', undefined]) {
    assert.equal(np.isPermissionAllowed(p), false, String(p));
  }
});

test('packaged app under paths with %, # or spaces: the escaped app URL matches what Chromium reports', async () => {
  const { pathToFileURL } = await import('node:url');
  for (const p of ['C:/Users/Nico 100%/F1/dist/index.html', 'C:/Users/F1 #2/dist/index.html', 'C:/Users/Nicolò/Program Files/dist/index.html']) {
    const appUrl = pathToFileURL(p).href; // what getMainAppUrl() now returns
    const reported = pathToFileURL(p).href + '#standalone-livetiming?path=x'; // what the window reports
    assert.equal(np.isAppNavigation(reported, appUrl), true, p);
    assert.equal(np.isAppNavigation(pathToFileURL('C:/Windows/evil.html').href, appUrl), false, p);
  }
});

test('remote windows (login / silent refresh): https only', () => {
  assert.equal(np.isSafeRemoteUrl('https://account.formula1.com/#/en/login'), true);
  assert.equal(np.isSafeRemoteUrl('http://account.formula1.com/'), false);
  assert.equal(np.isSafeRemoteUrl('file:///C:/Windows/System32/drivers/etc/hosts'), false);
  assert.equal(np.isSafeRemoteUrl('javascript:alert(1)'), false);
  assert.equal(np.isSafeRemoteUrl('ms-settings:'), false);
  assert.equal(np.isSafeRemoteUrl('not a url'), false);
});

test('hardenRemoteWebContents: popups denied unless allowed, and allowed ones only over https', () => {
  const make = () => {
    const handlers = {};
    return { handlers, on: (ev, fn) => { handlers[ev] = fn; }, setWindowOpenHandler: (fn) => { handlers.open = fn; } };
  };
  const locked = make();
  np.hardenRemoteWebContents(locked);
  assert.equal(locked.handlers.open({ url: 'https://appleid.apple.com/' }).action, 'deny');
  const sso = make();
  np.hardenRemoteWebContents(sso, { allowPopups: true });
  const ok = sso.handlers.open({ url: 'https://appleid.apple.com/' });
  assert.equal(ok.action, 'allow');
  assert.equal(ok.overrideBrowserWindowOptions.webPreferences.sandbox, true);
  assert.equal(ok.overrideBrowserWindowOptions.webPreferences.nodeIntegration, false);
  assert.equal(sso.handlers.open({ url: 'file:///C:/x' }).action, 'deny');
  let prevented = false;
  sso.handlers['will-navigate']({ url: 'file:///C:/x', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  prevented = false;
  sso.handlers['will-redirect']({ url: 'https://account.formula1.com/', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false);
});
