import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ss from './secureStore.js';

/** Fake safeStorage: "encryption" = reversible byte flip, so plaintext never appears on disk. */
const fakeSafeStorage = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(Buffer.from(s, 'utf8').map((b) => b ^ 0x5a)),
  decryptString: (buf) => Buffer.from(Buffer.from(buf).map((b) => b ^ 0x5a)).toString('utf8'),
});

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'f1ov-secure-')), 'session.json');
const TOKEN_JSON = JSON.stringify({ accessToken: 'eyJhbGciOi.SUPER_SECRET_TOKEN.sig' });

test('encrypts at rest and round-trips', () => {
  const file = tmpFile();
  const store = ss.createSecureStore(fakeSafeStorage());
  store.writeText(file, TOKEN_JSON);
  const onDisk = fs.readFileSync(file, 'utf8');
  assert.ok(!onDisk.includes('SUPER_SECRET_TOKEN'), 'token must not be readable on disk');
  assert.ok(onDisk.includes(ss.FORMAT));
  assert.deepEqual(store.readText(file), { text: TOKEN_JSON, encrypted: true });
});

test('falls back to plain text when the OS cannot encrypt', () => {
  const file = tmpFile();
  const store = ss.createSecureStore(fakeSafeStorage(false));
  store.writeText(file, TOKEN_JSON);
  assert.equal(fs.readFileSync(file, 'utf8'), TOKEN_JSON);
  assert.deepEqual(store.readText(file), { text: TOKEN_JSON, encrypted: false });
});

test('legacy plain files stay readable (and are flagged so callers can upgrade them)', () => {
  const file = tmpFile();
  fs.writeFileSync(file, TOKEN_JSON);
  const store = ss.createSecureStore(fakeSafeStorage());
  assert.deepEqual(store.readText(file), { text: TOKEN_JSON, encrypted: false });
  store.writeText(file, TOKEN_JSON); // upgrade
  assert.equal(store.readText(file).encrypted, true);
});

test('unreadable envelope (other machine/user, or encryption gone) reads as missing', () => {
  const file = tmpFile();
  ss.createSecureStore(fakeSafeStorage()).writeText(file, TOKEN_JSON);
  assert.equal(ss.createSecureStore(fakeSafeStorage(false)).readText(file), null);
  const broken = { ...fakeSafeStorage(), decryptString: () => { throw new Error('bad key'); } };
  assert.equal(ss.createSecureStore(broken).readText(file), null);
});

test('missing file and missing safeStorage', () => {
  const file = tmpFile();
  assert.equal(ss.createSecureStore(fakeSafeStorage()).readText(file), null);
  const store = ss.createSecureStore(undefined);
  store.writeText(file, 'x');
  assert.deepEqual(store.readText(file), { text: 'x', encrypted: false });
});

test('atomic write leaves no temp files behind', () => {
  const file = tmpFile();
  ss.createSecureStore(fakeSafeStorage()).writeText(file, 'a');
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['session.json']);
});
