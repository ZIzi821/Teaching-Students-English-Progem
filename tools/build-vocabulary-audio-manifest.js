const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vocabulary = require("../cloudfunctions/quickstartFunctions/vocabulary");

const projectRoot = path.resolve(__dirname, "..");
const outputDir = path.join(projectRoot, "output", "vocabulary-audio", "v1");
const manifestPath = path.join(
  projectRoot,
  "cloudfunctions",
  "quickstartFunctions",
  "data",
  "vocabulary-audio-manifest.json"
);

const getFileName = (wordKey) => (
  `${crypto.createHash("sha1").update(wordKey).digest("hex").slice(0, 24)}.wav`
);

const library = vocabulary.loadVocabularyLibrary();
const wordByKey = new Map();

library.words.forEach((item) => {
  const key = vocabulary.normalizeWordKey(item.key || item.word);
  if (!key || wordByKey.has(key)) return;
  wordByKey.set(key, String(item.word || key).trim());
});

const items = Array.from(wordByKey.entries())
  .map(([key, word]) => {
    const fileName = getFileName(key);
    return {
      key,
      word,
      fileName,
      cloudPath: `vocabulary-audio/v1/${fileName}`,
    };
  })
  .sort((a, b) => a.key.localeCompare(b.key, "en"));

const fileNames = new Set(items.map((item) => item.fileName));
if (fileNames.size !== items.length) {
  throw new Error("Audio filename collision detected");
}

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
fs.writeFileSync(
  manifestPath,
  `${JSON.stringify({
    version: 1,
    voice: "Microsoft Zira Desktop - English (United States)",
    format: "16kHz 16-bit mono WAV",
    total: items.length,
    items,
  }, null, 2)}\n`,
  "utf8"
);

console.log(`Vocabulary audio manifest: ${items.length} unique words and phrases`);
console.log(`Manifest: ${manifestPath}`);
console.log(`Audio output: ${outputDir}`);
