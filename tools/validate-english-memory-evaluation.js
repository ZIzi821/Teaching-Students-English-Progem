const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const analytics = require(path.join(
  root,
  "cloudfunctions",
  "quickstartFunctions",
  "englishMemoryAnalytics"
));

const empty = analytics.buildMemoryEvaluation([], Date.UTC(2026, 9, 18));
assert.strictEqual(empty.status.key, "collecting");
assert.strictEqual(empty.sampleTarget, 20);
assert.strictEqual(empty.uniqueWordTarget, 5);
assert.strictEqual(empty.calibrationBins.length, 5);

const appConfig = JSON.parse(read("miniprogram/app.json"));
const insightsPackage = (appConfig.subpackages || []).find((item) => item.root === "insights");
assert(insightsPackage, "insights subpackage is missing");
assert(
  (insightsPackage.pages || []).includes("pages/memory-evaluation/index"),
  "memory evaluation page is missing from insights subpackage"
);

const backend = read("cloudfunctions/quickstartFunctions/index.js");
assert(backend.includes('require("./englishMemoryAnalytics")'), "analytics module is not connected");
assert(backend.includes('case "getEnglishMemoryEvaluation"'), "evaluation API route is missing");
assert(
  /const getEnglishMemoryEvaluation = async \(event\) => \{\s*await ensureTeacher\(\)/.test(backend),
  "evaluation API must be teacher-only"
);

const vocabularyScript = read("miniprogram/pages/vocabulary/index.js");
const vocabularyMarkup = read("miniprogram/pages/vocabulary/index.wxml");
assert(vocabularyScript.includes("goMemoryEvaluation"), "teacher navigation handler is missing");
assert(vocabularyMarkup.includes('wx:if="{{isTeacherManager}}"') && vocabularyMarkup.includes('bindtap="goMemoryEvaluation"'), "teacher-only entry is missing");
assert(!read("miniprogram/pages/student-detail/index.wxml").includes("goMemoryEvaluation"), "diagnostic entry must stay out of the student overview");

const pageMarkup = read("miniprogram/insights/pages/memory-evaluation/index.wxml");
assert(pageMarkup.includes("Brier Score"), "Brier score explanation is missing");
assert(pageMarkup.includes("参数调整由老师结合课堂表现决定"), "teacher decision note is missing");
assert(pageMarkup.includes("参数调整由老师结合课堂表现决定"), "teacher parameter gate is missing");
assert(pageMarkup.includes("校准分组"), "calibration bins are missing");

const scheduler = read("cloudfunctions/quickstartFunctions/englishMemoryScheduler.js");
assert(scheduler.includes("algorithmVersion: ALGORITHM_VERSION"), "review events must retain algorithm version");

console.log("english memory evaluation validation passed");
