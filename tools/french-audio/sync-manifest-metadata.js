/* Synchronize local MP3 byte counts and SHA-256 values without changing File IDs. */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
let version = 'all';
let manifestPath = null;
let dryRun = false;
while (args.length) {
  const option = args.shift();
  if (option === '--dry-run') {
    dryRun = true;
    continue;
  }
  if (option !== '--version' && option !== '--manifest') {
    throw new Error(`Unknown option: ${option}`);
  }
  const value = args.shift();
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}`);
  if (option === '--version') version = value;
  else manifestPath = value;
}
if (!['v1', 'v2', 'all'].includes(version)) throw new Error('--version must be v1, v2, or all');

const root = path.resolve(__dirname, '..', '..');
const resolvedManifest = manifestPath
  ? path.resolve(manifestPath)
  : path.join(root, 'cloudfunctions', 'quickstartFunctions', 'data', 'french-audio-manifest.json');
const manifest = JSON.parse(fs.readFileSync(resolvedManifest, 'utf8'));
const selected = manifest.items.filter((item) => (
  version === 'all' || String(item.cloudPath).startsWith(`french-audio/${version}/`)
));
let present = 0;
let changed = 0;
let missing = 0;
for (const item of selected) {
  const localPath = path.join(root, item.localPath);
  if (!fs.existsSync(localPath)) {
    missing += 1;
    continue;
  }
  const buffer = fs.readFileSync(localPath);
  if (buffer.length <= 1000) throw new Error(`Local audio is unexpectedly small: ${item.localPath}`);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  present += 1;
  if (item.bytes !== buffer.length || item.sha256 !== sha256) changed += 1;
  item.bytes = buffer.length;
  item.sha256 = sha256;
}
if (!dryRun) fs.writeFileSync(resolvedManifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`French audio metadata ${dryRun ? 'audit' : 'sync'}: ${present} present, ${changed} changed, ${missing} missing (${version}). File IDs untouched.`);
