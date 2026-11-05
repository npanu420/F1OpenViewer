import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ds from './durableSettings.js';

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1ov-settings-'));
  return { dir, file: path.join(dir, 'settings.json') };
}

test('isDurableKey: allowlist, prefixes and rejects', () => {
  assert.equal(ds.isDurableKey('f1-theme'), true);
  assert.equal(ds.isDurableKey('f1openviewer-livetiming-dock-width'), true);
  assert.equal(ds.isDurableKey('f1openviewer-header-collapsed'), true);
  assert.equal(ds.isDurableKey('f1lt-sync:2026/foo/bar/'), true);
  assert.equal(ds.isDurableKey('f1lt-sync:'), false);
  assert.equal(ds.isDurableKey('random-key'), false);
  assert.equal(ds.isDurableKey('__proto__'), false);
  assert.equal(ds.isDurableKey(undefined), false);
});

test('renderer DURABLE_KEYS stay in sync with the main-process allowlist', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'durableStorage.ts'), 'utf8');
  const block = src.match(/DURABLE_KEYS\s*=\s*\[([\s\S]*?)\]\s*as const/);
  assert.ok(block, 'DURABLE_KEYS array not found');
  const rendererKeys = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(rendererKeys.length > 0);
  for (const k of rendererKeys) assert.equal(ds.isDurableKey(k), true, `${k} is not allowed by electron/durableSettings.js`);
  for (const k of ds.DURABLE_SETTINGS_KEYS) assert.ok(rendererKeys.includes(k), `${k} missing from durableStorage.ts`);
});

test('store: persists accepted keys atomically and survives a reload', () => {
  const { dir, file } = tmpFile();
  const a = ds.createSettingsStore(file);
  assert.equal(a.set('f1-theme', 'light'), true);
  assert.equal(a.set('f1openviewer-livetiming-dock-width', '900'), true);
  assert.equal(a.set('not-allowed', 'x'), false);
  assert.equal(a.set('f1-theme', 42), false);
  const b = ds.createSettingsStore(file);
  assert.deepEqual(b.getAll(), { 'f1-theme': 'light', 'f1openviewer-livetiming-dock-width': '900' });
  assert.deepEqual(fs.readdirSync(dir), ['settings.json']); // no leftover tmp file
});

test('store: corrupt or non-object file falls back to empty', () => {
  const { file } = tmpFile();
  fs.writeFileSync(file, '{not json');
  assert.deepEqual(ds.createSettingsStore(file).getAll(), {});
  fs.writeFileSync(file, '[1,2]');
  assert.deepEqual(ds.createSettingsStore(file).getAll(), {});
});

test('store: rejects oversized values', () => {
  const { file } = tmpFile();
  const s = ds.createSettingsStore(file);
  assert.equal(s.set('f1openviewer-saved-grids', 'x'.repeat(600 * 1024)), false);
});

test('store.clear forgets everything, deletes the file and keeps working afterwards', () => {
  const { file } = tmpFile();
  const s = ds.createSettingsStore(file);
  s.set('f1-theme', 'light');
  assert.ok(fs.existsSync(file));
  s.clear();
  assert.deepEqual(s.getAll(), {});
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(ds.createSettingsStore(file).getAll(), {});
  assert.equal(s.set('f1-theme', 'dark'), true);
  assert.deepEqual(ds.createSettingsStore(file).getAll(), { 'f1-theme': 'dark' });
});
