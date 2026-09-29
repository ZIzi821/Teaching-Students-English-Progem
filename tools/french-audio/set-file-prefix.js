/*
 * Fill only currently-null CloudBase File IDs after a verified batch upload.
 * This script never uploads files and never overwrites an existing fileId.
 */
'use strict';

const fs = require('fs');
const path = require('path');

function usage(exitCode = 0) {
  const text = `Usage:
  node tools/french-audio/set-file-prefix.js <cloud-file-id> --uploaded-list <paths.txt> [--version v1|v2|all] [--dry-run] [--manifest <manifest.json>]

<paths.txt> must list exactly the uploaded target paths, one per line, such as
french-audio/v2/words/a1-daily-maison.mp3. Full cloud:// File IDs are accepted.
Without --dry-run, the script refuses to change the manifest unless that list
matches every selected currently-null manifest entry.`;
  (exitCode ? console.error : console.log)(text);
  process.exit(exitCode);
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) usage();
const prefixFileId = args.shift();
if (!prefixFileId || !prefixFileId.startsWith('cloud://')) usage(2);

let version = 'all';
let uploadedListPath = null;
let manifestPath = null;
let dryRun = false;
while (args.length) {
  const option = args.shift();
  if (option === '--dry-run') { dryRun = true; continue; }
  if (!['--version', '--uploaded-list', '--manifest'].includes(option)) usage(2);
  const value = args.shift();
  if (!value || value.startsWith('--')) usage(2);
  if (option === '--version') version = value;
  else if (option === '--uploaded-list') uploadedListPath = value;
  else manifestPath = value;
}
if (!['v1', 'v2', 'all'].includes(version)) {
  console.error('--version must be v1, v2, or all.');
  process.exit(2);
}

const root = path.resolve(__dirname, '..', '..');
manifestPath = manifestPath ? path.resolve(manifestPath) : path.join(root, 'cloudfunctions', 'quickstartFunctions', 'data', 'french-audio-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const suppliedItem = manifest.items.find((item) => prefixFileId.endsWith(item.cloudPath));
if (!suppliedItem) {
  console.error('The supplied File ID must end with one exact manifest cloudPath.');
  process.exit(2);
}
const bucketPrefix = prefixFileId.slice(0, -suppliedItem.cloudPath.length);
if (!bucketPrefix.startsWith('cloud://')) {
  console.error('The supplied File ID does not have a valid cloud:// prefix.');
  process.exit(2);
}

const selected = manifest.items.filter((item) => version === 'all' || item.cloudPath.startsWith(`french-audio/${version}/`));
const targets = selected.filter((item) => item.fileId == null);
const preserved = selected.filter((item) => item.fileId != null);
if (!targets.length) {
  console.log(`No null fileId entries matched --version ${version}; ${preserved.length} existing IDs were preserved.`);
  process.exit(0);
}

function normalizeUploadedPath(line) {
  const value = line.trim();
  if (!value || value.startsWith('#')) return null;
  if (value.startsWith('cloud://')) {
    const found = manifest.items.find((item) => value.endsWith(item.cloudPath));
    if (!found) throw new Error(`Uploaded-list File ID does not end with a manifest cloudPath: ${value}`);
    return found.cloudPath;
  }
  return value.replaceAll('\\', '/');
}

let uploaded = null;
if (uploadedListPath) {
  const listPath = path.resolve(uploadedListPath);
  if (!fs.existsSync(listPath)) {
    console.error(`Uploaded-list file was not found: ${listPath}`);
    process.exit(2);
  }
  const uploadedPaths = fs.readFileSync(listPath, 'utf8').split(/\r?\n/).map(normalizeUploadedPath).filter(Boolean);
  uploaded = new Set(uploadedPaths);
  if (uploaded.size !== uploadedPaths.length) {
    console.error('Upload evidence contains duplicate paths; provide one exact path per intended target.');
    process.exit(2);
  }
  const targetPaths = new Set(targets.map((item) => item.cloudPath));
  const missing = [...targetPaths].filter((item) => !uploaded.has(item));
  const unexpected = [...uploaded].filter((item) => !targetPaths.has(item));
  if (missing.length || unexpected.length) {
    console.error(`Upload evidence does not exactly match the intended null-ID target set. Missing: ${missing.length}; unexpected: ${unexpected.length}.`);
    if (missing.length) console.error(`First missing: ${missing.slice(0, 5).join(', ')}`);
    if (unexpected.length) console.error(`First unexpected: ${unexpected.slice(0, 5).join(', ')}`);
    process.exit(2);
  }
}
if (!dryRun && !uploaded) {
  console.error('Refusing to write without --uploaded-list evidence for every intended target. Use --dry-run to inspect the target set first.');
  process.exit(2);
}

console.log(`Selected ${targets.length} null fileId entry/entries for ${version}; preserving ${preserved.length} existing ID(s).`);
console.log(`Example target: ${targets[0].cloudPath}`);
if (dryRun) {
  console.log(uploaded ? 'Dry run: upload evidence matched; manifest was not changed.' : 'Dry run: upload evidence was not checked; manifest was not changed.');
  process.exit(0);
}
for (const item of targets) item.fileId = `${bucketPrefix}${item.cloudPath}`;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Updated ${targets.length} null file IDs. Existing non-null IDs were preserved.`);
