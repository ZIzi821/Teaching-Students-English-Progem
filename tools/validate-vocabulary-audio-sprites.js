const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const projectRoot = path.resolve(__dirname, "..");
const sourceManifest = require("../cloudfunctions/quickstartFunctions/data/vocabulary-audio-manifest.json");
const spriteManifest = require("../cloudfunctions/quickstartFunctions/data/vocabulary-audio-sprites.json");
const errors = [];

const readManifest = (filePath, label) => {
  if (!fs.existsSync(filePath)) {
    errors.push(`Missing ${label}: ${path.relative(projectRoot, filePath)}`);
    return { items: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    errors.push(`Invalid ${label}: ${err.message}`);
    return { items: [] };
  }
};

const extraSourceManifest = (spriteManifest.sprites || []).some((item) => (
  String(item.id || "").startsWith("extra-")
))
  ? readManifest(
    path.join(projectRoot, "output", "vocabulary-audio", "extra-v1-manifest.json"),
    "extra source manifest"
  )
  : { items: [] };
const beginnerSourceManifest = (spriteManifest.sprites || []).some((item) => (
  String(item.id || "").startsWith("beginner-")
))
  ? readManifest(
    path.join(projectRoot, "output", "vocabulary-audio", "beginner-v1-manifest.json"),
    "beginner source manifest"
  )
  : { items: [] };
const beginnerDirectManifest = readManifest(
  path.join(projectRoot, "output", "vocabulary-audio", "beginner-direct-v1-manifest.json"),
  "beginner direct manifest"
);
const beginnerDirectByKey = new Map((beginnerDirectManifest.items || []).map((item) => [item.key, item]));
const mollySourceManifest = readManifest(
  path.join(projectRoot, "output", "vocabulary-audio", "molly-ket-v1-manifest.json"),
  "Molly KET source manifest"
);
const mollyDirectManifest = readManifest(
  path.join(projectRoot, "output", "vocabulary-audio", "molly-ket-direct-v1-manifest.json"),
  "Molly KET direct manifest"
);
const mollyDirectDir = path.join(projectRoot, "output", "vocabulary-audio", "molly-ket-direct-v1");

const sourceSets = {
  base: {
    sourceDir: path.join(projectRoot, "output", "vocabulary-audio", "v1"),
    spriteDir: path.join(projectRoot, "output", "vocabulary-audio", "sprites-v1"),
    sourceByKey: new Map((sourceManifest.items || []).map((item) => [item.key, item])),
  },
  extra: {
    sourceDir: path.join(projectRoot, "output", "vocabulary-audio", "extra-v1"),
    spriteDir: path.join(projectRoot, "output", "vocabulary-audio", "sprites-extra-v1"),
    sourceByKey: new Map((extraSourceManifest.items || []).map((item) => [item.key, item])),
  },
  beginner: {
    sourceDir: path.join(projectRoot, "output", "vocabulary-audio", "beginner-v1"),
    spriteDir: path.join(projectRoot, "output", "vocabulary-audio", "sprites-beginner-v1"),
    sourceByKey: new Map((beginnerSourceManifest.items || []).map((item) => [item.key, item])),
  },
  molly: {
    sourceDir: path.join(projectRoot, "output", "vocabulary-audio", "molly-ket-v1"),
    sourceByKey: new Map((mollySourceManifest.items || []).map((item) => [item.key, item])),
  },
};

const getSourceSet = (spriteId) => {
  const id = String(spriteId || "");
  if (id.startsWith("extra-")) return sourceSets.extra;
  if (id.startsWith("beginner-")) return sourceSets.beginner;
  if (id.startsWith("molly-ket-")) return sourceSets.molly;
  return sourceSets.base;
};

const readPcmData = (filePath) => {
  const source = fs.readFileSync(filePath);
  if (source.toString("ascii", 0, 4) !== "RIFF" || source.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`Invalid WAV file: ${filePath}`);
  }
  let offset = 12;
  while (offset + 8 <= source.length) {
    const chunkId = source.toString("ascii", offset, offset + 4);
    const chunkSize = source.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > source.length) throw new Error(`Truncated WAV chunk: ${filePath}`);
    if (chunkId === "data") return source.subarray(chunkStart, chunkEnd);
    offset = chunkEnd + (chunkSize % 2);
  }
  throw new Error(`Missing WAV data chunk: ${filePath}`);
};

const spriteById = new Map(spriteManifest.sprites.map((item) => [item.id, item]));
const spritePcmById = new Map();

spriteManifest.sprites.forEach((sprite) => {
  const sourceSet = getSourceSet(sprite.id);
  const filePath = path.join(sourceSet.spriteDir, sprite.fileName);
  if (!fs.existsSync(filePath)) {
    errors.push(`Missing sprite: ${sprite.fileName}`);
    return;
  }
  const stats = fs.statSync(filePath);
  if (stats.size !== sprite.bytes) errors.push(`Sprite size mismatch: ${sprite.fileName}`);
  spritePcmById.set(sprite.id, readPcmData(filePath));
});

spriteManifest.items.forEach((item) => {
  if (!item.spriteId) {
    if (!item.directFileId || !item.directCloudPath || !item.directDurationMs) {
      errors.push(`Direct-only item is incomplete: ${item.key}`);
    }
    return;
  }
  const sourceSet = getSourceSet(item.spriteId);
  const sourceItem = sourceSet.sourceByKey.get(item.key);
  const sprite = spriteById.get(item.spriteId);
  const spritePcm = spritePcmById.get(item.spriteId);
  if (!sourceItem || !sprite || !spritePcm) {
    errors.push(`Missing mapping data: ${item.key}`);
    return;
  }
  const sourcePcm = readPcmData(path.join(sourceSet.sourceDir, sourceItem.fileName));
  const startByte = Math.round((item.startMs / 1000) * 32000);
  const endByte = startByte + sourcePcm.length;
  if (!spritePcm.subarray(startByte, endByte).equals(sourcePcm)) {
    errors.push(`PCM mismatch: ${item.key}`);
  }
});

const runtimeByKey = new Map(spriteManifest.items.map((item) => [item.key, item]));
const directFileNames = new Set();
if (mollyDirectManifest.total !== 640 || (mollyDirectManifest.items || []).length !== 640) {
  errors.push("Molly direct manifest must contain 640 items");
}
(mollyDirectManifest.items || []).forEach((item) => {
  const fileName = String(item.fileName || "");
  if (!/^\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*\.wav$/.test(fileName)) {
    errors.push(`Unreadable Molly direct filename: ${fileName || item.key}`);
  }
  if (directFileNames.has(fileName)) errors.push(`Duplicate Molly direct filename: ${fileName}`);
  directFileNames.add(fileName);
  const filePath = path.join(mollyDirectDir, fileName);
  if (!fs.existsSync(filePath)) {
    errors.push(`Missing Molly direct WAV: ${fileName}`);
    return;
  }
  const source = fs.readFileSync(filePath);
  const runtimeItem = runtimeByKey.get(item.key);
  const beginnerDirect = beginnerDirectByKey.get(item.key);
  const usesMollyDirect = runtimeItem
    && runtimeItem.directFileId === item.fileId
    && runtimeItem.directCloudPath === item.cloudPath;
  const usesSharedBeginnerDirect = runtimeItem
    && beginnerDirect
    && runtimeItem.directFileId === beginnerDirect.fileId
    && runtimeItem.directCloudPath === beginnerDirect.cloudPath;
  if (!usesMollyDirect && !usesSharedBeginnerDirect) {
    errors.push(`Molly direct runtime mapping mismatch: ${item.key}`);
  }
  if (source.length !== item.bytes) errors.push(`Molly direct size mismatch: ${fileName}`);
  const sha256 = crypto.createHash("sha256").update(source).digest("hex");
  if (sha256 !== item.sha256) errors.push(`Molly direct hash mismatch: ${fileName}`);
  readPcmData(filePath);
});

const result = {
  expectedWords: sourceSets.base.sourceByKey.size
    + sourceSets.extra.sourceByKey.size
    + sourceSets.beginner.sourceByKey.size
    + sourceSets.molly.sourceByKey.size,
  mappedWords: spriteManifest.items.length,
  spriteCount: spriteManifest.sprites.length,
  totalBytes: spriteManifest.sprites.reduce((sum, item) => sum + item.bytes, 0),
  mollyDirectFiles: directFileNames.size,
  mollyDirectBytes: (mollyDirectManifest.items || []).reduce((sum, item) => sum + Number(item.bytes || 0), 0),
  errors: errors.length,
};
console.log(JSON.stringify(result, null, 2));
if (errors.length) {
  console.error(errors.slice(0, 20).join("\n"));
  process.exit(1);
}
