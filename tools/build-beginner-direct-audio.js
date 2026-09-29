const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vocabulary = require("../cloudfunctions/quickstartFunctions/vocabulary");

const root = path.resolve(__dirname, "..");
const dataRoot = path.join(root, "cloudfunctions", "quickstartFunctions", "data");
const audioRoot = path.join(root, "output", "vocabulary-audio");
const beginnerLibraryPath = path.join(dataRoot, "primary-beginner-words.json");
const runtimeManifestPath = path.join(dataRoot, "vocabulary-audio-sprites.json");
const directDir = path.join(audioRoot, "beginner-direct-v1");
const directManifestPath = path.join(audioRoot, "beginner-direct-v1-manifest.json");
const directCloudRoot = "vocabulary-audio/beginner-direct-v1";

const sourceSets = [
  {
    name: "beginner",
    manifestPath: path.join(audioRoot, "beginner-v1-manifest.json"),
    sourceDir: path.join(audioRoot, "beginner-v1"),
  },
  {
    name: "base",
    manifestPath: path.join(dataRoot, "vocabulary-audio-manifest.json"),
    sourceDir: path.join(audioRoot, "v1"),
  },
  {
    name: "extra",
    manifestPath: path.join(audioRoot, "extra-v1-manifest.json"),
    sourceDir: path.join(audioRoot, "extra-v1"),
  },
].map((sourceSet) => {
  const manifest = JSON.parse(fs.readFileSync(sourceSet.manifestPath, "utf8"));
  return Object.assign({}, sourceSet, {
    byKey: new Map((manifest.items || []).map((item) => [
      vocabulary.normalizeWordKey(item.key),
      item,
    ])),
  });
});

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

const beginnerLibrary = JSON.parse(fs.readFileSync(beginnerLibraryPath, "utf8"));
const runtimeManifest = JSON.parse(fs.readFileSync(runtimeManifestPath, "utf8"));
const referenceSprite = (runtimeManifest.sprites || []).find((item) => item.fileId && item.cloudPath);
if (!referenceSprite) throw new Error("Cannot derive the CloudBase File ID prefix");
const cloudPrefix = String(referenceSprite.fileId).slice(0, -String(referenceSprite.cloudPath).length);

fs.mkdirSync(directDir, { recursive: true });
const directItems = (beginnerLibrary.words || []).map((word) => {
  const key = vocabulary.normalizeWordKey(word.key || word.word);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) {
    throw new Error(`Unsafe beginner audio key: ${key}`);
  }
  const sourceSet = sourceSets.find((candidate) => candidate.byKey.has(key));
  if (!sourceSet) throw new Error(`No individual WAV source for beginner item: ${key}`);
  const sourceItem = sourceSet.byKey.get(key);
  const sourcePath = path.join(sourceSet.sourceDir, sourceItem.fileName);
  if (!fs.existsSync(sourcePath)) throw new Error(`Missing individual WAV source: ${sourcePath}`);

  const fileName = `${key}.wav`;
  const targetPath = path.join(directDir, fileName);
  fs.copyFileSync(sourcePath, targetPath);
  const wave = readWaveInfo(targetPath);
  const cloudPath = `${directCloudRoot}/${fileName}`;
  return {
    key,
    word: String(word.audioText || word.word || "").trim(),
    fileName,
    cloudPath,
    fileId: `${cloudPrefix}${cloudPath}`,
    durationMs: wave.durationMs,
    bytes: wave.bytes,
    sha256: wave.sha256,
    sourceSet: sourceSet.name,
  };
});

if (new Set(directItems.map((item) => item.key)).size !== directItems.length) {
  throw new Error("Duplicate beginner direct-audio key");
}
const directByKey = new Map(directItems.map((item) => [item.key, item]));
const runtimeItems = (runtimeManifest.items || []).map((item) => {
  const direct = directByKey.get(vocabulary.normalizeWordKey(item.key));
  if (!direct) return item;
  return Object.assign({}, item, {
    directFileId: direct.fileId,
    directCloudPath: direct.cloudPath,
    directDurationMs: direct.durationMs,
    directBytes: direct.bytes,
    directSha256: direct.sha256,
  });
});

const runtimeKeys = new Set(runtimeItems.map((item) => vocabulary.normalizeWordKey(item.key)));
const missingRuntimeItems = directItems.filter((item) => !runtimeKeys.has(item.key));
if (missingRuntimeItems.length) {
  throw new Error(`Beginner items missing from runtime audio manifest: ${missingRuntimeItems.map((item) => item.key).join(", ")}`);
}

fs.writeFileSync(directManifestPath, `${JSON.stringify({
  version: 1,
  voice: runtimeManifest.voice,
  format: runtimeManifest.format,
  cloudRoot: directCloudRoot,
  total: directItems.length,
  totalBytes: directItems.reduce((sum, item) => sum + item.bytes, 0),
  items: directItems,
}, null, 2)}\n`, "utf8");
fs.writeFileSync(runtimeManifestPath, `${JSON.stringify(Object.assign({}, runtimeManifest, {
  items: runtimeItems,
}), null, 2)}\n`, "utf8");

const sourceCounts = directItems.reduce((result, item) => {
  result[item.sourceSet] = Number(result[item.sourceSet] || 0) + 1;
  return result;
}, {});
console.log(JSON.stringify({
  total: directItems.length,
  totalBytes: directItems.reduce((sum, item) => sum + item.bytes, 0),
  sourceCounts,
  directDir,
  directManifestPath,
  uploadTo: directCloudRoot,
  fallbackPreserved: true,
}, null, 2));
