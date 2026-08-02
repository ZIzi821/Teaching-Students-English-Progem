const fs = require("fs");
const path = require("path");

const sampleFileId = String(process.argv[2] || "").trim();
if (!sampleFileId.startsWith("cloud://")) {
  throw new Error("Pass one uploaded vocabulary audio cloud File ID");
}

const projectRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(
  projectRoot,
  "cloudfunctions",
  "quickstartFunctions",
  "data",
  "vocabulary-audio-sprites.json"
);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const matchingSprite = (manifest.sprites || []).find((sprite) => (
  sampleFileId.endsWith(String(sprite.cloudPath || ""))
));
if (!matchingSprite) {
  throw new Error("The sample File ID does not match any sprite cloudPath");
}

const prefix = sampleFileId.slice(0, -matchingSprite.cloudPath.length);
if (!/^cloud:\/\/[^/]+\/$/.test(prefix)) {
  throw new Error(`Unexpected cloud File ID prefix: ${prefix}`);
}

manifest.sprites = manifest.sprites.map((sprite) => ({
  ...sprite,
  fileId: `${prefix}${sprite.cloudPath}`,
}));
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  prefix,
  spriteCount: manifest.sprites.length,
  mappedFileIds: manifest.sprites.filter((sprite) => sprite.fileId).length,
}, null, 2));
