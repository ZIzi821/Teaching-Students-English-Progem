const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dataPath = path.join(root, "cloudfunctions", "quickstartFunctions", "data", "yilin-junior-2024-7a-words.json");
const runtimePath = path.join(root, "cloudfunctions", "quickstartFunctions", "data", "vocabulary-audio-sprites.json");
const directManifestPath = path.join(root, "output", "vocabulary-audio", "yilin-2024-7a-direct-v1-manifest.json");
const directDir = path.join(root, "output", "vocabulary-audio", "yilin-2024-7a-direct-v1");

const library = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8"));
const directManifest = JSON.parse(fs.readFileSync(directManifestPath, "utf8"));
const words = library.words || [];
const keys = new Set(words.map((word) => word.key));

assert.strictEqual(library.levels[0].id, "yilin-2024-7A");
assert.strictEqual(library.levels[0].isbn, "978-7-5753-0036-0");
assert.strictEqual(words.length, 421);
assert.strictEqual(keys.size, 407);
assert.deepStrictEqual(
  Array.from({ length: 8 }, (_, index) => words.filter((word) => word.unitId.endsWith(`-u${index + 1}`)).length),
  [40, 47, 47, 54, 55, 56, 64, 58]
);

const runtimeByKey = new Map((runtime.items || []).map((item) => [item.key, item]));
keys.forEach((key) => {
  const item = runtimeByKey.get(key);
  assert(item, `Runtime audio item missing: ${key}`);
  assert(item.directFileId && item.directFileId.endsWith(item.directCloudPath), `Direct File ID mismatch: ${key}`);
  assert(Number(item.directDurationMs) > 0, `Direct duration missing: ${key}`);
});

assert.strictEqual(directManifest.total, 307);
assert.strictEqual((directManifest.items || []).length, 307);
(directManifest.items || []).forEach((item) => {
  const filePath = path.join(directDir, item.fileName);
  assert(fs.existsSync(filePath), `Generated WAV missing: ${item.fileName}`);
  const source = fs.readFileSync(filePath);
  assert.strictEqual(source.length, item.bytes, `Generated WAV size mismatch: ${item.fileName}`);
  assert.strictEqual(
    crypto.createHash("sha256").update(source).digest("hex"),
    item.sha256,
    `Generated WAV hash mismatch: ${item.fileName}`
  );
});

console.log(JSON.stringify({
  entries: words.length,
  uniqueWords: keys.size,
  reusedDirectAudio: keys.size - directManifest.total,
  generatedDirectAudio: directManifest.total,
  units: 8,
}, null, 2));
