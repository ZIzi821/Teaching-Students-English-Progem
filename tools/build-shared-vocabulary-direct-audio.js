const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vocabulary = require("../cloudfunctions/quickstartFunctions/vocabulary");

const root = path.resolve(__dirname, "..");
const dataRoot = path.join(root, "cloudfunctions", "quickstartFunctions", "data");
const audioRoot = path.join(root, "output", "vocabulary-audio");
const runtimeManifestPath = path.join(dataRoot, "vocabulary-audio-sprites.json");
const sourceManifestPath = path.join(audioRoot, "shared-current-direct-v1-source-manifest.json");
const directManifestPath = path.join(audioRoot, "shared-current-direct-v1-manifest.json");
const directDir = path.join(audioRoot, "shared-current-direct-v1");
const directCloudRoot = "vocabulary-audio/shared-current-direct-v1";
const prepareOnly = process.argv.includes("--prepare");
const libraryFiles = [
  "primary-beginner-words.json",
  "primary-1-3-words.json",
  "molly-ket-a2-words.json",
  "yilin-junior-2024-7a-words.json",
  "mistake-word-lexicon.json",
];

const readWaveInfo = (filePath) => {
  const source = fs.readFileSync(filePath);
  if (source.toString("ascii", 0, 4) !== "RIFF" || source.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`Invalid WAV file: ${filePath}`);
  }
  let offset = 12;
  let byteRate = 0;
  let dataBytes = 0;
  while (offset + 8 <= source.length) {
    const chunkId = source.toString("ascii", offset, offset + 4);
    const chunkSize = source.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > source.length) throw new Error(`Truncated WAV chunk: ${filePath}`);
    if (chunkId === "fmt ") byteRate = source.readUInt32LE(chunkStart + 8);
    if (chunkId === "data") dataBytes = chunkSize;
    offset = chunkEnd + (chunkSize % 2);
  }
  if (!byteRate || !dataBytes) throw new Error(`Missing WAV metadata: ${filePath}`);
  return {
    bytes: source.length,
    durationMs: Math.round((dataBytes / byteRate) * 1000),
    sha256: crypto.createHash("sha256").update(source).digest("hex"),
  };
};

const toReadableSlug = (value) => String(value || "")
  .normalize("NFKC")
  .toLowerCase()
  .replace(/[’']/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 60);

const rawLibrary = { levels: [], words: [] };
libraryFiles.forEach((fileName) => {
  const source = JSON.parse(fs.readFileSync(path.join(dataRoot, fileName), "utf8"));
  rawLibrary.levels.push(...(source.levels || []));
  rawLibrary.words.push(...(source.words || []));
});
const library = vocabulary.normalizeLibrary(rawLibrary);
const runtimeManifest = JSON.parse(fs.readFileSync(runtimeManifestPath, "utf8"));
const runtimeByKey = new Map();
(runtimeManifest.items || []).forEach((item) => {
  runtimeByKey.set(vocabulary.normalizeWordKey(item.key), item);
});

const wordByKey = new Map();
library.words.forEach((word) => {
  const key = vocabulary.normalizeWordKey(word.key || word.word);
  if (key && !wordByKey.has(key)) wordByKey.set(key, String(word.word || key).trim());
});
const currentKeys = Array.from(wordByKey.keys()).sort((left, right) => left.localeCompare(right, "en"));
const needsSharedDirect = currentKeys.filter((key) => {
  const existing = runtimeByKey.get(key);
  return !existing
    || !existing.directFileId
    || !existing.directCloudPath
    || !existing.directDurationMs
    || String(existing.directCloudPath).startsWith(`${directCloudRoot}/`);
});
const sourceItems = needsSharedDirect.map((key, index) => {
  const word = wordByKey.get(key) || key;
  const sequence = String(index + 1).padStart(3, "0");
  const fileName = `${sequence}-${toReadableSlug(word) || "word"}.wav`;
  return {
    key,
    word,
    fileName,
    cloudPath: `${directCloudRoot}/${fileName}`,
  };
});

fs.mkdirSync(directDir, { recursive: true });
fs.writeFileSync(sourceManifestPath, `${JSON.stringify({
  version: 1,
  voice: runtimeManifest.voice,
  format: runtimeManifest.format,
  total: sourceItems.length,
  items: sourceItems,
}, null, 2)}\n`, "utf8");

if (prepareOnly) {
  console.log(JSON.stringify({
    currentVocabularyKeys: currentKeys.length,
    alreadyDirect: currentKeys.length - sourceItems.length,
    toGenerate: sourceItems.length,
    sourceManifestPath,
    outputDirectory: directDir,
  }, null, 2));
  process.exit(0);
}

const missingFiles = sourceItems.filter((item) => !fs.existsSync(path.join(directDir, item.fileName)));
if (missingFiles.length) {
  throw new Error(`Missing ${missingFiles.length} shared direct WAV files; run with --prepare and generate them first`);
}

const reference = (runtimeManifest.sprites || []).find((item) => item.fileId && item.cloudPath)
  || (runtimeManifest.items || []).find((item) => item.directFileId && item.directCloudPath);
const referenceFileId = String(reference && (reference.fileId || reference.directFileId) || "");
const referenceCloudPath = String(reference && (reference.cloudPath || reference.directCloudPath) || "");
if (!referenceFileId || !referenceCloudPath || !referenceFileId.endsWith(referenceCloudPath)) {
  throw new Error("Cannot derive the CloudBase File ID prefix");
}
const cloudPrefix = referenceFileId.slice(0, -referenceCloudPath.length);
const directItems = sourceItems.map((item) => {
  const wave = readWaveInfo(path.join(directDir, item.fileName));
  return {
    ...item,
    fileId: `${cloudPrefix}${item.cloudPath}`,
    durationMs: wave.durationMs,
    bytes: wave.bytes,
    sha256: wave.sha256,
  };
});
const directByKey = new Map(directItems.map((item) => [item.key, item]));
const retainedByKey = new Map();
(runtimeManifest.items || []).forEach((item) => {
  const key = vocabulary.normalizeWordKey(item.key);
  if (!key) return;
  const isCurrent = wordByKey.has(key);
  const isDynamicMistakeAudio = String(item.spriteId || "").startsWith("extra-");
  if (!isCurrent && !isDynamicMistakeAudio) return;
  const direct = directByKey.get(key);
  const next = { ...item, key };
  if (direct) {
    Object.assign(next, {
      word: item.word || direct.word,
      directFileId: direct.fileId,
      directCloudPath: direct.cloudPath,
      directDurationMs: direct.durationMs,
      directBytes: direct.bytes,
      directSha256: direct.sha256,
    });
  }
  if (/^[0-9a-f]$/.test(String(next.spriteId || ""))) {
    next.spriteId = "";
    next.startMs = 0;
    next.durationMs = 0;
  }
  retainedByKey.set(key, next);
});
directItems.forEach((direct) => {
  if (retainedByKey.has(direct.key)) return;
  retainedByKey.set(direct.key, {
    key: direct.key,
    word: direct.word,
    spriteId: "",
    startMs: 0,
    durationMs: 0,
    directFileId: direct.fileId,
    directCloudPath: direct.cloudPath,
    directDurationMs: direct.durationMs,
    directBytes: direct.bytes,
    directSha256: direct.sha256,
  });
});
const runtimeItems = Array.from(retainedByKey.values()).sort((left, right) => (
  String(left.key).localeCompare(String(right.key), "en")
));
const finalizedByKey = new Map(runtimeItems.map((item) => [vocabulary.normalizeWordKey(item.key), item]));
const uncovered = currentKeys.filter((key) => {
  const item = finalizedByKey.get(key);
  return !item || !item.directFileId || !item.directCloudPath || !item.directDurationMs;
});
if (uncovered.length) throw new Error(`Current vocabulary direct audio is incomplete: ${uncovered.join(", ")}`);

const sprites = (runtimeManifest.sprites || []).filter((item) => !/^[0-9a-f]$/.test(String(item.id || "")));
fs.writeFileSync(directManifestPath, `${JSON.stringify({
  version: 1,
  voice: runtimeManifest.voice,
  format: runtimeManifest.format,
  naming: "NNN-readable-word.wav",
  cloudRoot: directCloudRoot,
  total: directItems.length,
  totalBytes: directItems.reduce((sum, item) => sum + item.bytes, 0),
  items: directItems,
}, null, 2)}\n`, "utf8");
fs.writeFileSync(runtimeManifestPath, `${JSON.stringify({
  ...runtimeManifest,
  total: runtimeItems.length,
  spriteCount: sprites.length,
  sprites,
  items: runtimeItems,
}, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  currentVocabularyKeys: currentKeys.length,
  sharedDirectFiles: directItems.length,
  runtimeItems: runtimeItems.length,
  retainedSprites: sprites.map((item) => item.id),
  directManifestPath,
  runtimeManifestPath,
}, null, 2));
