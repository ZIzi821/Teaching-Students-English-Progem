const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vocabulary = require("../cloudfunctions/quickstartFunctions/vocabulary");

const projectRoot = path.resolve(__dirname, "..");
const importRoot = path.join(projectRoot, "output", "import");
const audioRoot = path.join(projectRoot, "output", "vocabulary-audio");
const sourceDir = path.join(audioRoot, "extra-v1");
const spriteDir = path.join(audioRoot, "sprites-extra-v1");
const generationManifestPath = path.join(audioRoot, "extra-v1-manifest.json");
const runtimeManifestPath = path.join(
  projectRoot,
  "cloudfunctions",
  "quickstartFunctions",
  "data",
  "vocabulary-audio-sprites.json"
);
const spriteId = "extra-1";
const spriteFileName = "vocabulary-audio-sprite-extra-1.wav";
const spriteCloudPath = `vocabulary-audio/sprites-extra-v1/${spriteFileName}`;
const gapMs = 120;

const findConfirmedFiles = (directory) => {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findConfirmedFiles(entryPath);
    return entry.isFile() && entry.name === "confirmed.json" ? [entryPath] : [];
  });
};

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

const runtimeManifest = JSON.parse(fs.readFileSync(runtimeManifestPath, "utf8"));
const baseItems = runtimeManifest.items.filter((item) => item.spriteId !== spriteId);
const baseKeys = new Set(baseItems.map((item) => item.key));
const library = vocabulary.loadVocabularyLibrary();
const confirmedFiles = findConfirmedFiles(importRoot);
const mistakes = confirmedFiles.flatMap((filePath) => {
  const source = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Array.isArray(source) ? source : [];
});
const candidateKeys = new Set();
mistakes.forEach((mistake) => {
  vocabulary.getStoredVocabularyCandidates(mistake, library).forEach((key) => candidateKeys.add(key));
});
const extraKeys = Array.from(candidateKeys)
  .filter((key) => !baseKeys.has(key))
  .sort((a, b) => a.localeCompare(b, "en"));
const generationItems = extraKeys.map((key) => ({
  key,
  word: key,
  fileName: getFileName(key),
  cloudPath: "",
}));

fs.mkdirSync(sourceDir, { recursive: true });
fs.mkdirSync(spriteDir, { recursive: true });
fs.writeFileSync(
  generationManifestPath,
  `${JSON.stringify({
    version: 1,
    voice: runtimeManifest.voice,
    format: runtimeManifest.format,
    total: generationItems.length,
    items: generationItems,
  }, null, 2)}\n`,
  "utf8"
);

const missingAudio = generationItems.filter((item) => (
  !fs.existsSync(path.join(sourceDir, item.fileName))
));
if (missingAudio.length) {
  console.log(JSON.stringify({
    confirmedFiles: confirmedFiles.length,
    mistakes: mistakes.length,
    extraWords: generationItems.length,
    missingAudio: missingAudio.length,
    generationManifestPath,
    sourceDir,
    next: "Run tools/generate-vocabulary-audio.ps1 with this manifest and output directory, then rerun this script.",
  }, null, 2));
  process.exit(2);
}

const silence = Buffer.alloc(Math.round((32000 * gapMs) / 1000 / 2) * 2);
const pcmParts = [];
const extraItems = [];
let pcmBytes = 0;
let waveFormat = null;
generationItems.forEach((item, index) => {
  const wave = readWave(path.join(sourceDir, item.fileName));
  waveFormat = waveFormat || wave.format;
  extraItems.push({
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

const spriteBuffer = createWave(Buffer.concat(pcmParts), waveFormat);
fs.writeFileSync(path.join(spriteDir, spriteFileName), spriteBuffer);
const existingPrefix = String(runtimeManifest.sprites[0].fileId || "").slice(
  0,
  -String(runtimeManifest.sprites[0].cloudPath || "").length
);
const extraSprite = {
  id: spriteId,
  fileName: spriteFileName,
  cloudPath: spriteCloudPath,
  fileId: `${existingPrefix}${spriteCloudPath}`,
  itemCount: extraItems.length,
  bytes: spriteBuffer.length,
  durationMs: Math.round((pcmBytes / waveFormat.byteRate) * 1000),
};
const sprites = runtimeManifest.sprites
  .filter((item) => item.id !== spriteId)
  .concat(extraSprite);
const items = baseItems.concat(extraItems).sort((a, b) => a.key.localeCompare(b.key, "en"));
fs.writeFileSync(
  runtimeManifestPath,
  `${JSON.stringify({
    ...runtimeManifest,
    total: items.length,
    spriteCount: sprites.length,
    sprites,
    items,
  }, null, 2)}\n`,
  "utf8"
);

console.log(JSON.stringify({
  confirmedFiles: confirmedFiles.length,
  mistakes: mistakes.length,
  extraWords: extraItems.length,
  totalWords: items.length,
  spriteBytes: spriteBuffer.length,
  spritePath: path.join(spriteDir, spriteFileName),
  cloudPath: spriteCloudPath,
}, null, 2));
