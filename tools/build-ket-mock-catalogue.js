const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const sourcePath = path.join(root, "miniprogram", "utils", "ketMockSets.js");
const outputPath = path.join(root, "cloudfunctions", "quickstartFunctions", "data", "ket-mock-sets.json");

delete require.cache[require.resolve(sourcePath)];
const { KET_MOCK_SETS } = require(sourcePath);

if (!Array.isArray(KET_MOCK_SETS) || !KET_MOCK_SETS.length) {
  throw new Error("KET mock catalogue is empty");
}

fs.writeFileSync(outputPath, `${JSON.stringify(KET_MOCK_SETS, null, 2)}\n`, "utf8");
console.log(`Wrote ${KET_MOCK_SETS.length} KET mock sets to ${path.relative(root, outputPath)}`);
