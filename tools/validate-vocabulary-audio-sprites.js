const fs = require("fs");
const path = require("path");

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
};

const getSourceSet = (spriteId) => (
  String(spriteId || "").startsWith("extra-") ? sourceSets.extra : sourceSets.base
);

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

const result = {
  expectedWords: sourceSets.base.sourceByKey.size + sourceSets.extra.sourceByKey.size,
  mappedWords: spriteManifest.items.length,
  spriteCount: spriteManifest.sprites.length,
  totalBytes: spriteManifest.sprites.reduce((sum, item) => sum + item.bytes, 0),
  errors: errors.length,
};
console.log(JSON.stringify(result, null, 2));
if (errors.length) {
  console.error(errors.slice(0, 20).join("\n"));
  process.exit(1);
}
