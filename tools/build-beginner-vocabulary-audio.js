const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vocabulary = require("../cloudfunctions/quickstartFunctions/vocabulary");

const root = path.resolve(__dirname, "..");
const dataRoot = path.join(root, "cloudfunctions", "quickstartFunctions", "data");
const sourceLibraryPath = path.join(dataRoot, "primary-beginner-words.json");
const runtimeManifestPath = path.join(dataRoot, "vocabulary-audio-sprites.json");
const audioRoot = path.join(root, "output", "vocabulary-audio");
const sourceDir = path.join(audioRoot, "beginner-v1");
const spriteDir = path.join(audioRoot, "sprites-beginner-v1");
const generationManifestPath = path.join(audioRoot, "beginner-v1-manifest.json");
const spriteId = "beginner-1";
const spriteFileName = "vocabulary-audio-sprite-beginner-1.wav";
const spriteCloudPath = `vocabulary-audio/sprites-beginner-v1/${spriteFileName}`;
const gapMs = 160;

const getFileName = (wordKey) => (
  `${crypto.createHash("sha1").update(wordKey).digest("hex").slice(0, 24)}.wav`
);

const readWave = (filePath) => {
  const source = fs.readFileSync(filePath);
  if (source.toString("ascii", 0, 4) !== "RIFF" || source.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`Invalid WAV file: ${filePath}`);
  }
  let offset = 12;
  let format = null;
  let data = null;
  while (offset + 8 <= source.length) {
    const chunkId = source.toString("ascii", offset, offset + 4);
    const chunkSize = source.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > source.length) throw new Error(`Truncated WAV chunk: ${filePath}`);
    if (chunkId === "fmt ") {
      format = {
        audioFormat: source.readUInt16LE(chunkStart),
        channels: source.readUInt16LE(chunkStart + 2),
        sampleRate: source.readUInt32LE(chunkStart + 4),
        byteRate: source.readUInt32LE(chunkStart + 8),
        blockAlign: source.readUInt16LE(chunkStart + 12),
        bitsPerSample: source.readUInt16LE(chunkStart + 14),
      };
    } else if (chunkId === "data") {
      data = source.subarray(chunkStart, chunkEnd);
    }
    offset = chunkEnd + (chunkSize % 2);
  }
  if (!format || !data) throw new Error(`Missing WAV format or data chunk: ${filePath}`);
  if (
    format.audioFormat !== 1
    || format.channels !== 1
    || format.sampleRate !== 16000
    || format.bitsPerSample !== 16
    || format.byteRate !== 32000
    || format.blockAlign !== 2
  ) {
    throw new Error(`Unexpected WAV format: ${filePath}`);
  }
  return { format, data };
};

const createWave = (pcmData, format) => {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(format.audioFormat, 20);
  header.writeUInt16LE(format.channels, 22);
  header.writeUInt32LE(format.sampleRate, 24);
  header.writeUInt32LE(format.byteRate, 28);
  header.writeUInt16LE(format.blockAlign, 32);
  header.writeUInt16LE(format.bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcmData.length, 40);
  return Buffer.concat([header, pcmData]);
};

const sourceLibrary = JSON.parse(fs.readFileSync(sourceLibraryPath, "utf8"));
const runtimeManifest = JSON.parse(fs.readFileSync(runtimeManifestPath, "utf8"));
const baseItems = (runtimeManifest.items || []).filter((item) => item.spriteId !== spriteId);
const baseKeys = new Set(baseItems.map((item) => vocabulary.normalizeWordKey(item.key)));
const generationItems = (sourceLibrary.words || [])
  .map((item) => ({
    key: vocabulary.normalizeWordKey(item.key || item.word),
    word: String(item.audioText || item.word || "").trim(),
  }))
  .filter((item) => item.key && item.word && !baseKeys.has(item.key))
  .filter((item, index, all) => all.findIndex((candidate) => candidate.key === item.key) === index)
  .map((item) => Object.assign({}, item, {
    fileName: getFileName(item.key),
    cloudPath: spriteCloudPath,
  }));

fs.mkdirSync(sourceDir, { recursive: true });
fs.mkdirSync(spriteDir, { recursive: true });
fs.writeFileSync(generationManifestPath, `${JSON.stringify({
  version: 1,
  voice: runtimeManifest.voice,
  format: runtimeManifest.format,
  total: generationItems.length,
  items: generationItems,
}, null, 2)}\n`, "utf8");

const missingAudio = generationItems.filter((item) => !fs.existsSync(path.join(sourceDir, item.fileName)));
if (missingAudio.length) {
  console.log(JSON.stringify({
    beginnerItems: sourceLibrary.words.length,
    reusedAudio: sourceLibrary.words.length - generationItems.length,
    dedicatedAudio: generationItems.length,
    missingAudio: missingAudio.length,
    generationManifestPath,
    sourceDir,
    next: "Generate the missing beginner WAV files, then rerun this script.",
  }, null, 2));
  process.exit(2);
}

const silence = Buffer.alloc(Math.round((32000 * gapMs) / 1000 / 2) * 2);
const pcmParts = [];
const beginnerItems = [];
let pcmBytes = 0;
let waveFormat = null;
generationItems.forEach((item, index) => {
  const wave = readWave(path.join(sourceDir, item.fileName));
  waveFormat = waveFormat || wave.format;
  beginnerItems.push({
    key: item.key,
    word: item.word,
    spriteId,
    startMs: Number(((pcmBytes / wave.format.byteRate) * 1000).toFixed(3)),
    durationMs: Number(((wave.data.length / wave.format.byteRate) * 1000).toFixed(3)),
  });
  pcmParts.push(wave.data);
  pcmBytes += wave.data.length;
  if (index < generationItems.length - 1) {
    pcmParts.push(silence);
    pcmBytes += silence.length;
  }
});

if (!waveFormat || !beginnerItems.length) throw new Error("No dedicated beginner audio was generated");
const spriteBuffer = createWave(Buffer.concat(pcmParts), waveFormat);
const spritePath = path.join(spriteDir, spriteFileName);
fs.writeFileSync(spritePath, spriteBuffer);
const referenceSprite = (runtimeManifest.sprites || []).find((item) => item.fileId && item.cloudPath);
if (!referenceSprite) throw new Error("Cannot derive the CloudBase File ID prefix from the existing audio manifest");
const cloudPrefix = String(referenceSprite.fileId).slice(0, -String(referenceSprite.cloudPath).length);
const beginnerSprite = {
  id: spriteId,
  fileName: spriteFileName,
  cloudPath: spriteCloudPath,
  fileId: `${cloudPrefix}${spriteCloudPath}`,
  itemCount: beginnerItems.length,
  bytes: spriteBuffer.length,
  durationMs: Math.round((pcmBytes / waveFormat.byteRate) * 1000),
};
const sprites = (runtimeManifest.sprites || [])
  .filter((item) => item.id !== spriteId)
  .concat(beginnerSprite);
const items = baseItems.concat(beginnerItems).sort((a, b) => a.key.localeCompare(b.key, "en"));
fs.writeFileSync(runtimeManifestPath, `${JSON.stringify(Object.assign({}, runtimeManifest, {
  total: items.length,
  spriteCount: sprites.length,
  sprites,
  items,
}), null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  beginnerItems: sourceLibrary.words.length,
  reusedAudio: sourceLibrary.words.length - beginnerItems.length,
  dedicatedAudio: beginnerItems.length,
  runtimeAudioItems: items.length,
  spriteBytes: spriteBuffer.length,
  spritePath,
  cloudPath: spriteCloudPath,
}, null, 2));
