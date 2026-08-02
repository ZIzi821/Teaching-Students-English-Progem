const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const sourceManifestPath = path.join(
  projectRoot,
  "cloudfunctions",
  "quickstartFunctions",
  "data",
  "vocabulary-audio-manifest.json"
);
const sourceDir = path.join(projectRoot, "output", "vocabulary-audio", "v1");
const outputDir = path.join(projectRoot, "output", "vocabulary-audio", "sprites-v1");
const spriteManifestPath = path.join(
  projectRoot,
  "cloudfunctions",
  "quickstartFunctions",
  "data",
  "vocabulary-audio-sprites.json"
);
const bucketIds = "0123456789abcdef".split("");
const gapMs = 120;

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

const sourceManifest = JSON.parse(fs.readFileSync(sourceManifestPath, "utf8"));
const buckets = new Map(bucketIds.map((id) => [id, []]));
sourceManifest.items.forEach((item) => {
  const bucketId = String(item.fileName || "").slice(0, 1).toLowerCase();
  if (!buckets.has(bucketId)) throw new Error(`Unexpected audio filename: ${item.fileName}`);
  buckets.get(bucketId).push(item);
});

fs.mkdirSync(outputDir, { recursive: true });
const gapBytes = Math.round((32000 * gapMs) / 1000 / 2) * 2;
const silence = Buffer.alloc(gapBytes);
const sprites = [];
const items = [];

bucketIds.forEach((bucketId) => {
  const bucketItems = buckets.get(bucketId);
  const pcmParts = [];
  let pcmBytes = 0;
  let waveFormat = null;

  bucketItems.forEach((item, index) => {
    const wave = readWave(path.join(sourceDir, item.fileName));
    waveFormat = waveFormat || wave.format;
    const startMs = Number(((pcmBytes / wave.format.byteRate) * 1000).toFixed(3));
    const durationMs = Number(((wave.data.length / wave.format.byteRate) * 1000).toFixed(3));
    pcmParts.push(wave.data);
    pcmBytes += wave.data.length;
    items.push({
      key: item.key,
      word: item.word,
      spriteId: bucketId,
      startMs,
      durationMs,
    });
    if (index < bucketItems.length - 1) {
      pcmParts.push(silence);
      pcmBytes += silence.length;
    }
  });

  const fileName = `vocabulary-audio-sprite-${bucketId}.wav`;
  const waveFile = createWave(Buffer.concat(pcmParts), waveFormat);
  fs.writeFileSync(path.join(outputDir, fileName), waveFile);
  sprites.push({
    id: bucketId,
    fileName,
    cloudPath: `vocabulary-audio/sprites-v1/${fileName}`,
    fileId: "",
    itemCount: bucketItems.length,
    bytes: waveFile.length,
    durationMs: Math.round((pcmBytes / waveFormat.byteRate) * 1000),
  });
});

items.sort((a, b) => a.key.localeCompare(b.key, "en"));
fs.writeFileSync(
  spriteManifestPath,
  `${JSON.stringify({
    version: 1,
    voice: sourceManifest.voice,
    format: sourceManifest.format,
    gapMs,
    total: items.length,
    spriteCount: sprites.length,
    sprites,
    items,
  }, null, 2)}\n`,
  "utf8"
);

console.log(JSON.stringify({
  spriteCount: sprites.length,
  totalItems: items.length,
  totalBytes: sprites.reduce((sum, item) => sum + item.bytes, 0),
  smallestSpriteBytes: Math.min(...sprites.map((item) => item.bytes)),
  largestSpriteBytes: Math.max(...sprites.map((item) => item.bytes)),
  outputDir,
  spriteManifestPath,
}, null, 2));
