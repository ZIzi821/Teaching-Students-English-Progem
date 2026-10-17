const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const scheduler = require(path.join(
  root,
  "cloudfunctions",
  "quickstartFunctions",
  "englishMemoryScheduler"
));

const now = Date.UTC(2026, 9, 18, 8, 0, 0);
const schedules = ["forgot", "hard", "known", "easy"].map((rating) => (
  scheduler.scheduleReview(null, rating, now)
));
assert.deepStrictEqual(
  schedules.map((item) => item.nextReviewAtMs),
  schedules.map((item) => item.nextReviewAtMs).slice().sort((a, b) => a - b)
);
assert(schedules.every((item) => item.algorithmVersion === "english-adaptive-v1"));
assert.strictEqual(schedules[0].nextReviewAtMs, now + 10 * 60 * 1000);

const vocabulary = read("cloudfunctions/quickstartFunctions/vocabulary.js");
const backend = read("cloudfunctions/quickstartFunctions/index.js");
const packageJson = read("cloudfunctions/quickstartFunctions/package.json");
const detailScript = read("miniprogram/pages/vocabulary/index.js");
const detailMarkup = read("miniprogram/pages/vocabulary/index.wxml");
const studyScript = read("miniprogram/pages/vocabulary-study/index.js");
const studyMarkup = read("miniprogram/pages/vocabulary-study/index.wxml");

assert(vocabulary.includes('require("./englishMemoryScheduler")'));
assert(vocabulary.includes("englishMemoryScheduler.scheduleReview"));
assert(vocabulary.includes("englishMemoryScheduler.buildMemoryOverview"));
assert(vocabulary.includes("lastQuizChangedMemorySchedule"));
assert(backend.includes("memoryRetentionPercent") && backend.includes("memoryDueInSevenDaysCount"));
assert(packageJson.includes("tests/englishMemoryScheduler.test.js"));
assert(detailMarkup.includes("英语记忆调度"));
assert(detailMarkup.includes("预计保持率只用于安排复习" ) === false);
assert(detailMarkup.includes("summary.memoryDisclaimer"));
assert(detailMarkup.includes("现在到期") && detailMarkup.includes("7 天内"));
assert(detailScript.includes("memoryRetentionPercent"));
assert(detailScript.includes("formatNextReviewHint"));
assert(studyScript.includes("schedule && schedule.nextReviewAtMs"));
assert(studyMarkup.includes("缩短复习间隔"));
assert(studyMarkup.includes("明显延长间隔"));

console.log("english memory scheduler validation passed");
