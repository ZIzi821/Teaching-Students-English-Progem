const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  buildHomeworkPlanStep,
  buildPrimaryLearningAction,
  getActionableHomeworkCount,
} = require(path.resolve(__dirname, "..", "miniprogram", "utils", "studentLearningFlow"));

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
assert.strictEqual(getActionableHomeworkCount({ pendingCount: 3, actionableCount: 0 }), 0);
assert.strictEqual(buildPrimaryLearningAction({
  student,
  vocabularyPulse: { completed: true },
  vocabularyQuizPulse: { completed: true },
  homeworkSummary: { pendingCount: 1, actionableCount: 0, awaitingReviewCount: 1 },
  englishCourseEnabled: true,
}).label, "③ 查看课后任务");
assert(buildHomeworkPlanStep({
  homeworkSummary: { pendingCount: 1, actionableCount: 0, awaitingReviewCount: 1 },
}).hint.includes("等待老师检查"));

const root = path.resolve(__dirname, "..");
const home = fs.readFileSync(path.join(root, "miniprogram", "pages", "index", "index.js"), "utf8");
const quizPage = fs.readFileSync(path.join(root, "miniprogram", "pages", "vocabulary-challenge", "index.wxml"), "utf8");
assert(home.includes("vocabularyQuizPulse") && home.includes("studentPrimaryAction"));
assert(!home.includes("sampleData"), "cloud failures must not expose sample students, lessons, or mistakes as real data");
const fallbackStart = home.indexOf("setFallbackData(message)");
const fallbackEnd = home.indexOf("prefetchTodayVocabularyAudio(studentId)", fallbackStart);
const fallbackBuilder = home.slice(fallbackStart, fallbackEnd);
assert(fallbackBuilder.includes('currentStudent: null'), "cloud failures must clear stale student identity data");
assert(fallbackBuilder.includes("recentLessons: []"), "cloud failures must clear stale lesson data");
assert(quizPage.includes("③ 查看课后任务"));

const backend = fs.readFileSync(path.join(root, "cloudfunctions", "quickstartFunctions", "index.js"), "utf8");
const homeBuilder = backend.slice(
  backend.indexOf("const buildStudentHomeData"),
  backend.indexOf("const getStudentHomeData")
);
assert(homeBuilder.includes('loadAllStudentDocuments("lessons", studentId)'), "homework summary must inspect all lessons");
assert(!homeBuilder.includes("limit(20)"), "older pending homework must not disappear from the home summary");

console.log("student learning flow validation passed");
