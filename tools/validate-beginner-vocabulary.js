const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vocabulary = require("../cloudfunctions/quickstartFunctions/vocabulary");

const root = path.resolve(__dirname, "..");
const dataPath = path.join(root, "cloudfunctions", "quickstartFunctions", "data", "primary-beginner-words.json");
const audioManifestPath = path.join(root, "cloudfunctions", "quickstartFunctions", "data", "vocabulary-audio-sprites.json");
const sourceManifestPath = path.join(root, "output", "vocabulary-audio", "beginner-v1-manifest.json");
const directManifestPath = path.join(root, "output", "vocabulary-audio", "beginner-direct-v1-manifest.json");
const directDir = path.join(root, "output", "vocabulary-audio", "beginner-direct-v1");
const spritePath = path.join(
  root,
  "output",
  "vocabulary-audio",
  "sprites-beginner-v1",
  "vocabulary-audio-sprite-beginner-1.wav"
);

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const audioManifest = JSON.parse(fs.readFileSync(audioManifestPath, "utf8"));
const sourceManifest = JSON.parse(fs.readFileSync(sourceManifestPath, "utf8"));
const directManifest = JSON.parse(fs.readFileSync(directManifestPath, "utf8"));
const studentDetailSource = fs.readFileSync(
  path.join(root, "miniprogram", "pages", "student-detail", "index.js"),
  "utf8"
);
const level = data.levels.find((item) => item.id === "0A");
const getWavePeak = (buffer) => {
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > buffer.length) return 0;
    if (chunkId === "data") {
      let peak = 0;
      for (let position = chunkStart; position + 1 < chunkEnd; position += 2) {
        peak = Math.max(peak, Math.abs(buffer.readInt16LE(position)));
      }
      return peak;
    }
    offset = chunkEnd + (chunkSize % 2);
  }
  return 0;
};
assert(level, "Missing 0A beginner level");
assert.strictEqual(level.label, "英语启蒙（零基础）");
assert.strictEqual(level.order, 0);
assert(studentDetailSource.includes('{ id: "0A", label: "英语启蒙（零基础）" }'), "Teacher settings fallback is missing 0A");
assert.strictEqual(data.words.length, 89);

const expectedUnits = {
  letters: 26,
  "numbers-0-10": 11,
  "numbers-11-20": 10,
  classroom: 12,
  greetings: 8,
  colours: 8,
  "first-words": 14,
};
Object.entries(expectedUnits).forEach(([unitId, count]) => {
  assert.strictEqual(data.words.filter((item) => item.unitId === unitId).length, count, `Unexpected count for ${unitId}`);
});
assert.strictEqual(new Set(data.words.map((item) => item.key)).size, data.words.length, "Beginner keys must be unique");
data.words.forEach((item, index) => {
  assert.strictEqual(item.levelId, "0A");
  assert.strictEqual(item.order, index + 1, `Beginner teaching order must be continuous at ${item.key}`);
  assert(item.word && item.meaning && item.unitId && item.unitLabel && item.audioText, `Incomplete beginner item: ${item.key}`);
  assert.strictEqual(vocabulary.normalizeWordKey(item.key), item.key, `Unstable beginner key: ${item.key}`);
  const audio = vocabulary.getVocabularyAudioInfo(item.key);
  assert(audio.directFileId && audio.directDurationMs > 0, `Missing direct audio mapping: ${item.key}`);
  assert(!audio.fileId || audio.durationMs > 0, `Invalid optional sprite mapping: ${item.key}`);
  assert(audio.directFileId.endsWith(`vocabulary-audio/beginner-direct-v1/${item.key}.wav`), `Direct File ID mismatch: ${item.key}`);
});

assert.strictEqual(sourceManifest.items.length, 60, "Dedicated beginner audio count changed unexpectedly");
assert.strictEqual(directManifest.items.length, data.words.length, "Direct beginner audio count mismatch");
assert.strictEqual(directManifest.total, data.words.length, "Direct beginner manifest total mismatch");
const directByKey = new Map(directManifest.items.map((item) => [item.key, item]));
const runtimeAudioByKey = new Map(audioManifest.items.map((item) => [item.key, item]));
data.words.forEach((word) => {
  const direct = directByKey.get(word.key);
  const runtimeAudio = runtimeAudioByKey.get(word.key);
  assert(direct, `Missing direct manifest item: ${word.key}`);
  assert(runtimeAudio, `Missing runtime audio item: ${word.key}`);
  assert.strictEqual(direct.fileName, `${word.key}.wav`, `Unexpected direct file name: ${word.key}`);
  assert.strictEqual(direct.cloudPath, `vocabulary-audio/beginner-direct-v1/${word.key}.wav`);
  assert(direct.fileId.endsWith(direct.cloudPath), `Direct File ID/path mismatch: ${word.key}`);
  assert.strictEqual(runtimeAudio.directFileId, direct.fileId, `Runtime direct File ID mismatch: ${word.key}`);
  assert.strictEqual(runtimeAudio.directDurationMs, direct.durationMs, `Runtime direct duration mismatch: ${word.key}`);
  assert.strictEqual(runtimeAudio.directBytes, direct.bytes, `Runtime direct byte count mismatch: ${word.key}`);
  assert.strictEqual(runtimeAudio.directSha256, direct.sha256, `Runtime direct hash mismatch: ${word.key}`);
  const filePath = path.join(directDir, direct.fileName);
  assert(fs.existsSync(filePath), `Missing direct WAV: ${word.key}`);
  const buffer = fs.readFileSync(filePath);
  assert.strictEqual(buffer.length, direct.bytes, `Direct WAV byte count mismatch: ${word.key}`);
  assert.strictEqual(
    crypto.createHash("sha256").update(buffer).digest("hex"),
    direct.sha256,
    `Direct WAV hash mismatch: ${word.key}`
  );
  assert(getWavePeak(buffer) > 250, `Direct WAV appears silent: ${word.key}`);
  assert(direct.durationMs > 0 && direct.durationMs < 10000, `Invalid direct WAV duration: ${word.key}`);
});
assert.strictEqual(
  directManifest.totalBytes,
  directManifest.items.reduce((sum, item) => sum + item.bytes, 0),
  "Direct beginner total byte count mismatch"
);
const sprite = audioManifest.sprites.find((item) => item.id === "beginner-1");
assert(sprite, "Beginner audio sprite is missing");
assert.strictEqual(sprite.itemCount, sourceManifest.items.length);
assert.strictEqual(sprite.cloudPath, "vocabulary-audio/sprites-beginner-v1/vocabulary-audio-sprite-beginner-1.wav");
assert(sprite.fileId.endsWith(sprite.cloudPath), "Beginner sprite File ID/path mismatch");
assert(fs.existsSync(spritePath), "Local beginner audio sprite is missing");
assert.strictEqual(fs.statSync(spritePath).size, sprite.bytes, "Beginner sprite byte count mismatch");

const library = vocabulary.loadVocabularyLibrary();
const regularDefaults = vocabulary.getRecommendedVocabularySettings({ name: "普通学生" }, library);
assert(!regularDefaults.levelIds.includes("0A"), "Existing students must not receive 0A automatically");

console.log("Beginner vocabulary valid: 89 items, 7 units, 89 direct WAVs with optional sprite fallback, existing defaults unchanged.");
