const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vocabulary = require("../cloudfunctions/quickstartFunctions/vocabulary");

const root = path.resolve(__dirname, "..");
const dataRoot = path.join(root, "cloudfunctions", "quickstartFunctions", "data");
const audioRoot = path.join(root, "output", "vocabulary-audio");
const libraryPath = path.join(dataRoot, "molly-ket-a2-words.json");
const runtimeManifestPath = path.join(dataRoot, "vocabulary-audio-sprites.json");
const directDir = path.join(audioRoot, "molly-ket-direct-v1");
const directManifestPath = path.join(audioRoot, "molly-ket-direct-v1-manifest.json");
const directCloudRoot = "vocabulary-audio/molly-ket-direct-v1";
const removedSpriteId = "molly-ket-1";

const sourceSets = [
  {
    name: "molly",
    manifestPath: path.join(audioRoot, "molly-ket-v1-manifest.json"),
    sourceDir: path.join(audioRoot, "molly-ket-v1"),
  },
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

fs.mkdirSync(directDir, { recursive: true });
const directItems = (library.words || []).map((word, index) => {
  const key = vocabulary.normalizeWordKey(word.key || word.word);
  if (!runtimeByKey.has(key)) throw new Error(`Molly word is missing from runtime audio manifest: ${key}`);
  const sourceSet = sourceSets.find((candidate) => candidate.byKey.has(key));
  if (!sourceSet) throw new Error(`No individual WAV source for Molly item: ${key}`);
  const sourceItem = sourceSet.byKey.get(key);
  const sourcePath = path.join(sourceSet.sourceDir, sourceItem.fileName);
  if (!fs.existsSync(sourcePath)) throw new Error(`Missing individual WAV source: ${sourcePath}`);

  const sequence = String(index + 1).padStart(3, "0");
  const slug = toReadableSlug(word.word || word.audioText || key) || "word";
  const fileName = `${sequence}-${slug}.wav`;
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

if (directItems.length !== 640 || new Set(directItems.map((item) => item.key)).size !== 640) {
  throw new Error("Molly direct-audio output must contain 640 unique words");
}
if (new Set(directItems.map((item) => item.fileName)).size !== 640) {
  throw new Error("Molly direct-audio filenames must be unique");
}

const expectedFileNames = new Set(directItems.map((item) => item.fileName));
fs.readdirSync(directDir)
  .filter((fileName) => fileName.toLowerCase().endsWith(".wav") && !expectedFileNames.has(fileName))
  .forEach((fileName) => fs.unlinkSync(path.join(directDir, fileName)));

const directByKey = new Map(directItems.map((item) => [item.key, item]));
const runtimeItems = (runtimeManifest.items || []).map((item) => {
  const direct = directByKey.get(vocabulary.normalizeWordKey(item.key));
  if (!direct) return item;
  const shouldKeepBeginnerDirect = String(item.directCloudPath || "")
    .startsWith("vocabulary-audio/beginner-direct-v1/");
  if (shouldKeepBeginnerDirect) return item;
  const next = Object.assign({}, item, {
    directFileId: direct.fileId,
    directCloudPath: direct.cloudPath,
    directDurationMs: direct.durationMs,
    directBytes: direct.bytes,
    directSha256: direct.sha256,
  });
  if (String(item.spriteId || "") === removedSpriteId) {
    next.spriteId = "";
    next.startMs = 0;
    next.durationMs = 0;
  }
  return next;
});
const runtimeSprites = (runtimeManifest.sprites || []).filter((item) => String(item.id || "") !== removedSpriteId);

fs.writeFileSync(directManifestPath, `${JSON.stringify({
  version: 2,
  voice: runtimeManifest.voice,
  format: runtimeManifest.format,
  naming: "NNN-readable-word.wav",
  cloudRoot: directCloudRoot,
  total: directItems.length,
  totalBytes: directItems.reduce((sum, item) => sum + item.bytes, 0),
  items: directItems,
}, null, 2)}\n`, "utf8");
fs.writeFileSync(runtimeManifestPath, `${JSON.stringify(Object.assign({}, runtimeManifest, {
  spriteCount: runtimeSprites.length,
  sprites: runtimeSprites,
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
  naming: "001-name.wav ... 640-word.wav",
  directDir,
  directManifestPath,
  uploadTo: directCloudRoot,
  mollySpriteRemovedFromRuntime: true,
}, null, 2));
