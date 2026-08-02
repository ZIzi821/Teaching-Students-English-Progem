const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(
  projectRoot,
  "cloudfunctions",
  "quickstartFunctions",
  "data",
  "vocabulary-audio-manifest.json"
);
const outputDir = path.join(projectRoot, "output", "vocabulary-audio", "v1");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const missing = [];
const invalid = [];
let totalBytes = 0;

manifest.items.forEach((item) => {
  const audioPath = path.join(outputDir, item.fileName);
  if (!fs.existsSync(audioPath)) {
    missing.push(item.key);
    return;
  }
  const stats = fs.statSync(audioPath);
  totalBytes += stats.size;
  const file = fs.readFileSync(audioPath);
  if (
    file.length <= 44
    || file.toString("ascii", 0, 4) !== "RIFF"
    || file.toString("ascii", 8, 12) !== "WAVE"
  ) {
    invalid.push(item.key);
  }
});

const outputFiles = fs.existsSync(outputDir)
  ? fs.readdirSync(outputDir).filter((name) => name.endsWith(".wav"))
  : [];
const expectedNames = new Set(manifest.items.map((item) => item.fileName));
const extra = outputFiles.filter((name) => !expectedNames.has(name));

console.log(JSON.stringify({
  expected: manifest.items.length,
  present: outputFiles.length,
  totalBytes,
  missing: missing.length,
  invalid: invalid.length,
  extra: extra.length,
}, null, 2));

if (missing.length || invalid.length || extra.length) {
  console.error(JSON.stringify({
    missing: missing.slice(0, 20),
    invalid: invalid.slice(0, 20),
    extra: extra.slice(0, 20),
  }, null, 2));
  process.exitCode = 1;
}
