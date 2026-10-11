const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vocabulary = require("../cloudfunctions/quickstartFunctions/vocabulary");

const root = path.resolve(__dirname, "..");
const dataRoot = path.join(root, "cloudfunctions", "quickstartFunctions", "data");
const audioRoot = path.join(root, "output", "vocabulary-audio");
const libraryPath = path.join(dataRoot, "yilin-junior-2024-7a-words.json");
const runtimeManifestPath = path.join(dataRoot, "vocabulary-audio-sprites.json");
const sourceManifestPath = path.join(audioRoot, "yilin-2024-7a-direct-v1-source-manifest.json");
const directManifestPath = path.join(audioRoot, "yilin-2024-7a-direct-v1-manifest.json");
const directDir = path.join(audioRoot, "yilin-2024-7a-direct-v1");
const directCloudRoot = "vocabulary-audio/yilin-2024-7a-direct-v1";
const prepareOnly = process.argv.includes("--prepare");

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

const library = JSON.parse(fs.readFileSync(libraryPath, "utf8"));
const runtimeManifest = JSON.parse(fs.readFileSync(runtimeManifestPath, "utf8"));
const referenceSprite = (runtimeManifest.sprites || []).find((item) => item.fileId && item.cloudPath);
if (!referenceSprite) throw new Error("Cannot derive the CloudBase File ID prefix");
const cloudPrefix = String(referenceSprite.fileId).slice(0, -String(referenceSprite.cloudPath).length);
const runtimeByKey = new Map((runtimeManifest.items || []).map((item) => [
  vocabulary.normalizeWordKey(item.key),
  item,
]));

const wordByKey = new Map();
(library.words || []).forEach((word) => {
  const key = vocabulary.normalizeWordKey(word.key || word.word);
  if (key && !wordByKey.has(key)) wordByKey.set(key, String(word.word || key).trim());
});
if ((library.words || []).length !== 421 || wordByKey.size !== 407) {
  throw new Error("Yilin 2024 Grade 7A must contain 421 entries and 407 unique audio keys");
}

const wordsNeedingDirectAudio = Array.from(wordByKey.entries()).filter(([key]) => {
  const existing = runtimeByKey.get(key);
  return !existing
    || !existing.directFileId
    || !existing.directCloudPath
    || !existing.directDurationMs
    || String(existing.directCloudPath).startsWith(`${directCloudRoot}/`);
});
const sourceItems = wordsNeedingDirectAudio.map(([key, word], index) => {
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
    textbookUniqueWords: wordByKey.size,
    alreadyDirect: wordByKey.size - sourceItems.length,
    toGenerate: sourceItems.length,
    sourceManifestPath,
    outputDirectory: directDir,
    next: "Run tools/generate-vocabulary-audio.ps1 with this manifest and output directory, then rerun without --prepare.",
  }, null, 2));
  process.exit(0);
}

const missingFiles = sourceItems.filter((item) => !fs.existsSync(path.join(directDir, item.fileName)));
if (missingFiles.length) {
  throw new Error(`Missing ${missingFiles.length} generated WAV files; run this script with --prepare first`);
}

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
const runtimeItems = (runtimeManifest.items || []).map((item) => {
  const direct = directByKey.get(vocabulary.normalizeWordKey(item.key));
  if (!direct) return item;
  return Object.assign({}, item, {
    word: item.word || direct.word,
    directFileId: direct.fileId,
    directCloudPath: direct.cloudPath,
    directDurationMs: direct.durationMs,
    directBytes: direct.bytes,
    directSha256: direct.sha256,
  });
});
const runtimeKeys = new Set(runtimeItems.map((item) => vocabulary.normalizeWordKey(item.key)));
directItems.forEach((direct) => {
  if (runtimeKeys.has(direct.key)) return;
  runtimeItems.push({
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
  runtimeKeys.add(direct.key);
});

const finalizedByKey = new Map(runtimeItems.map((item) => [vocabulary.normalizeWordKey(item.key), item]));
const uncovered = Array.from(wordByKey.keys()).filter((key) => {
  const item = finalizedByKey.get(key);
  return !item || !item.directFileId || !item.directCloudPath || !item.directDurationMs;
});
if (uncovered.length) throw new Error(`Direct audio coverage is incomplete: ${uncovered.join(", ")}`);

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
fs.writeFileSync(runtimeManifestPath, `${JSON.stringify(Object.assign({}, runtimeManifest, {
  items: runtimeItems,
}), null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  textbookUniqueWords: wordByKey.size,
  reusedExistingDirect: wordByKey.size - directItems.length,
  generatedDirect: directItems.length,
  totalBytes: directItems.reduce((sum, item) => sum + item.bytes, 0),
  directDir,
  directManifestPath,
  uploadTo: directCloudRoot,
  runtimeDirectCoverage: wordByKey.size,
}, null, 2));
