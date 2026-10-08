const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildPrimaryLearningAction } = require(path.resolve(__dirname, "..", "miniprogram", "utils", "studentLearningFlow"));

const student = { vocabularyEnabled: true, englishCourseEnabled: true };
assert.strictEqual(buildPrimaryLearningAction({
  student,
  vocabularyPulse: { completed: false, remainingCount: 10 },
  englishCourseEnabled: true,
}).action, "study");
assert.strictEqual(buildPrimaryLearningAction({
  student,
  vocabularyPulse: { completed: true },
  vocabularyQuizPulse: { completed: false },
  englishCourseEnabled: true,
}).action, "quiz");
assert.strictEqual(buildPrimaryLearningAction({
  student,
  vocabularyPulse: { completed: true },
  vocabularyQuizPulse: { completed: true },
  homeworkSummary: { pendingCount: 2 },
  englishCourseEnabled: true,
}).label, "③ 查看课后任务 · 待完成 2 项");

const root = path.resolve(__dirname, "..");
const home = fs.readFileSync(path.join(root, "miniprogram", "pages", "index", "index.js"), "utf8");
const quizPage = fs.readFileSync(path.join(root, "miniprogram", "pages", "vocabulary-challenge", "index.wxml"), "utf8");
assert(home.includes("vocabularyQuizPulse") && home.includes("studentPrimaryAction"));
assert(quizPage.includes("③ 查看课后任务"));

console.log("student learning flow validation passed");
