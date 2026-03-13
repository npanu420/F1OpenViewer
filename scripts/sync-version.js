/**
 * Copia la versione da config/appVersion.json a package.json.
 * Single place to change the app version: config/appVersion.json
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const configPath = path.join(root, 'config', 'appVersion.json');
const pkgPath = path.join(root, 'package.json');

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const version = config.version;
if (!version || typeof version !== 'string') {
  console.error('[sync-version] config/appVersion.json must have a "version" string');
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log('[sync-version] package.json version set to', version);
