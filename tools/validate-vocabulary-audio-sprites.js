const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vocabulary = require("../cloudfunctions/quickstartFunctions/vocabulary");

const projectRoot = path.resolve(__dirname, "..");
const audioRoot = path.join(projectRoot, "output", "vocabulary-audio");
const spriteManifest = require("../cloudfunctions/quickstartFunctions/data/vocabulary-audio-sprites.json");
const errors = [];

const readManifest = (relativePath, label) => {
  const filePath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    errors.push(`Missing ${label}: ${relativePath}`);
    return { items: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    errors.push(`Invalid ${label}: ${err.message}`);
    return { items: [] };
  }
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

const runtimeByKey = new Map((spriteManifest.items || []).map((item) => [
  vocabulary.normalizeWordKey(item.key),
  item,
]));
const spriteConfigs = {
  "extra-1": {
    sourceManifest: readManifest("output/vocabulary-audio/extra-v1-manifest.json", "extra source manifest"),
    sourceDir: path.join(audioRoot, "extra-v1"),
    spriteDir: path.join(audioRoot, "sprites-extra-v1"),
  },
  "beginner-1": {
    sourceManifest: readManifest("output/vocabulary-audio/beginner-v1-manifest.json", "beginner source manifest"),
    sourceDir: path.join(audioRoot, "beginner-v1"),
    spriteDir: path.join(audioRoot, "sprites-beginner-v1"),
  },
};

(spriteManifest.sprites || []).forEach((sprite) => {
  const config = spriteConfigs[String(sprite.id || "")];
  if (!config) {
    errors.push(`Unexpected legacy sprite remains: ${sprite.id}`);
    return;
  }
  const spritePath = path.join(config.spriteDir, sprite.fileName);
  if (!fs.existsSync(spritePath)) {
    errors.push(`Missing sprite: ${sprite.fileName}`);
    return;
  }
  const spriteBuffer = fs.readFileSync(spritePath);
  if (spriteBuffer.length !== Number(sprite.bytes)) errors.push(`Sprite size mismatch: ${sprite.fileName}`);
  const spritePcm = readPcmData(spritePath);
  const sourceByKey = new Map((config.sourceManifest.items || []).map((item) => [
    vocabulary.normalizeWordKey(item.key),
    item,
  ]));
  (spriteManifest.items || []).filter((item) => String(item.spriteId || "") === String(sprite.id)).forEach((item) => {
    const key = vocabulary.normalizeWordKey(item.key);
    const sourceItem = sourceByKey.get(key);
    if (!sourceItem) {
      errors.push(`Missing sprite source mapping: ${key}`);
      return;
    }
    const sourcePath = path.join(config.sourceDir, sourceItem.fileName);
    if (!fs.existsSync(sourcePath)) {
      errors.push(`Missing sprite source WAV: ${sourceItem.fileName}`);
      return;
    }
    const sourcePcm = readPcmData(sourcePath);
    const startByte = Math.round((Number(item.startMs) / 1000) * 32000);
    if (!spritePcm.subarray(startByte, startByte + sourcePcm.length).equals(sourcePcm)) {
      errors.push(`PCM mismatch: ${key}`);
    }
  });
});

const directConfigs = [
  { label: "beginner", folder: "beginner-direct-v1", manifest: "beginner-direct-v1-manifest.json", expected: 89 },
  { label: "Molly KET", folder: "molly-ket-direct-v1", manifest: "molly-ket-direct-v1-manifest.json", expected: 640 },
  { label: "Yilin 2024 7A", folder: "yilin-2024-7a-direct-v1", manifest: "yilin-2024-7a-direct-v1-manifest.json", expected: 307 },
  { label: "shared current", folder: "shared-current-direct-v1", manifest: "shared-current-direct-v1-manifest.json", expected: 206 },
];
const directSummary = {};
directConfigs.forEach((config) => {
  const manifest = readManifest(`output/vocabulary-audio/${config.manifest}`, `${config.label} direct manifest`);
  const items = manifest.items || [];
  const directory = path.join(audioRoot, config.folder);
  if (Number(manifest.total) !== config.expected || items.length !== config.expected) {
    errors.push(`${config.label} direct manifest must contain ${config.expected} items`);
  }
  const names = new Set();
  let totalBytes = 0;
  items.forEach((item) => {
    const key = vocabulary.normalizeWordKey(item.key);
    const fileName = String(item.fileName || "");
    if (!/^(?:\d{3}-)?[a-z0-9]+(?:-[a-z0-9]+)*\.wav$/.test(fileName)) {
      errors.push(`Unreadable ${config.label} filename: ${fileName || key}`);
    }
    if (names.has(fileName)) errors.push(`Duplicate ${config.label} filename: ${fileName}`);
    names.add(fileName);
    const filePath = path.join(directory, fileName);
    if (!fs.existsSync(filePath)) {
      errors.push(`Missing ${config.label} WAV: ${fileName}`);
      return;
    }
    const source = fs.readFileSync(filePath);
    totalBytes += source.length;
    if (source.length !== Number(item.bytes)) errors.push(`${config.label} size mismatch: ${fileName}`);
    if (crypto.createHash("sha256").update(source).digest("hex") !== item.sha256) {
      errors.push(`${config.label} hash mismatch: ${fileName}`);
    }
    readPcmData(filePath);
    const runtimeItem = runtimeByKey.get(key);
    if (!runtimeItem || !runtimeItem.directFileId || !runtimeItem.directCloudPath || !runtimeItem.directDurationMs) {
      errors.push(`${config.label} runtime direct mapping missing: ${key}`);
    }
    if (config.label === "shared current" && runtimeItem && runtimeItem.directCloudPath !== item.cloudPath) {
      errors.push(`Shared runtime mapping mismatch: ${key}`);
    }
  });
  const actualFiles = fs.existsSync(directory)
    ? fs.readdirSync(directory).filter((name) => name.endsWith(".wav"))
    : [];
  if (actualFiles.length !== config.expected) {
    errors.push(`${config.label} directory contains ${actualFiles.length} WAV files instead of ${config.expected}`);
  }
  directSummary[config.label] = { files: names.size, bytes: totalBytes };
});

const library = vocabulary.loadVocabularyLibrary();
const currentKeys = new Set(library.words.map((word) => vocabulary.normalizeWordKey(word.key || word.word)));
currentKeys.forEach((key) => {
  const item = runtimeByKey.get(key);
  if (!item || !item.directFileId || !item.directCloudPath || !item.directDurationMs) {
    errors.push(`Current vocabulary has no direct audio: ${key}`);
  }
});
if (library.levels.some((level) => String(level.id || "").startsWith("yilin-old-"))) {
  errors.push("Removed Yilin 2012 levels are still loaded");
}
if ((spriteManifest.sprites || []).some((item) => String(item.cloudPath || "").startsWith("vocabulary-audio/sprites-v1/"))) {
  errors.push("Legacy sprites-v1 cloud paths are still referenced");
}
if ((spriteManifest.items || []).some((item) => String(item.directCloudPath || "").startsWith("vocabulary-audio/v1/"))) {
  errors.push("Legacy v1 direct paths are still referenced");
}
[
  "output/vocabulary-audio/v1",
  "output/vocabulary-audio/sprites-v1",
].forEach((relativePath) => {
  if (fs.existsSync(path.join(projectRoot, relativePath))) errors.push(`Legacy local folder still exists: ${relativePath}`);
});

assert.strictEqual(spriteManifest.total, (spriteManifest.items || []).length, "Runtime audio total must match its items");
const result = {
  currentVocabularyKeys: currentKeys.size,
  mappedWords: (spriteManifest.items || []).length,
  spriteCount: (spriteManifest.sprites || []).length,
  directSummary,
  errors: errors.length,
};
console.log(JSON.stringify(result, null, 2));
if (errors.length) {
  console.error(errors.slice(0, 30).join("\n"));
  process.exit(1);
}
