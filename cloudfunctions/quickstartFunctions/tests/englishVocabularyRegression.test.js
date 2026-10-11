const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vocabulary = require("../vocabulary");
const frenchContent = require("../frenchContent");

assert.strictEqual(vocabulary.normalizeWordKey("  HELLO  "), "hello");
assert.strictEqual(vocabulary.normalizeWordKey("don't"), "don't");
assert.strictEqual(vocabulary.normalizeWordKey("well—known"), "well-known");
assert(vocabulary.loadVocabularyLibrary().words.length > 0);
const library = vocabulary.loadVocabularyLibrary();
const beginnerLevel = library.levels.find((level) => level.id === "0A");
const beginnerWords = library.words.filter((word) => word.levelId === "0A");
assert(beginnerLevel, "0A beginner level must be available");
assert.strictEqual(library.levels[0].id, "0A", "Beginner vocabulary must appear before Grade 1A");
assert.strictEqual(beginnerLevel.label, "英语启蒙（零基础）");
assert.strictEqual(beginnerWords.length, 89);
assert.strictEqual(beginnerWords.filter((word) => word.unitId === "letters").length, 26);
assert.strictEqual(beginnerWords.filter((word) => /^numbers-/.test(word.unitId)).length, 21);
assert(beginnerWords.every((word) => vocabulary.getVocabularyAudioInfo(word.key).fileId));
assert(beginnerWords.every((word) => vocabulary.getVocabularyAudioInfo(word.key).directFileId));
assert(beginnerWords.every((word) => vocabulary.getVocabularyAudioInfo(word.key).directDurationMs > 0));
assert(!vocabulary.getRecommendedVocabularySettings({ name: "普通学生" }, library).levelIds.includes("0A"));

const beginnerCatalog = vocabulary.buildVocabularyCatalog({
  library,
  settings: { levelIds: ["0A"] },
});
assert.strictEqual(beginnerCatalog.length, 1);
assert.strictEqual(beginnerCatalog[0].id, "primary-beginner");
assert.strictEqual(beginnerCatalog[0].wordCount, 89);

const yilinLevelIds = library.levels
  .filter((level) => level.id.indexOf("yilin-old-") === 0)
  .map((level) => level.id);
const yilinCatalog = vocabulary.buildVocabularyCatalog({
  library,
  settings: { levelIds: yilinLevelIds },
});
assert.strictEqual(yilinCatalog.length, 1, "Selected Yilin volumes must be grouped as one library");
assert.strictEqual(yilinCatalog[0].id, "yilin-junior-old");
assert.strictEqual(yilinCatalog[0].edition, "译林版 · 2012课标旧版");
assert.strictEqual(yilinCatalog[0].wordCount, 2183);
assert.deepStrictEqual(yilinCatalog[0].levelIds, yilinLevelIds);

const yilin2024Level = library.levels.find((level) => level.id === "yilin-2024-7A");
const yilin2024Words = library.words.filter((word) => word.levelId === "yilin-2024-7A");
assert(yilin2024Level, "Yilin 2024 Grade 7A must be available separately from the legacy edition");
assert.strictEqual(yilin2024Level.edition, "译林版 · 2024新教材（2022课标）");
assert.strictEqual(yilin2024Level.isbn, "978-7-5753-0036-0");
assert.strictEqual(yilin2024Words.length, 421);
assert.strictEqual(new Set(yilin2024Words.map((word) => word.key)).size, 407);
assert.deepStrictEqual(
  Array.from({ length: 8 }, (_, index) => (
    yilin2024Words.filter((word) => word.unitId === `yilin-2024-7A-u${index + 1}`).length
  )),
  [40, 47, 47, 54, 55, 56, 64, 58]
);
assert.deepStrictEqual(
  yilin2024Words.filter((word) => word.unitId === "yilin-2024-7A-u3").slice(-4).map((word) => word.word),
  ["together", "quite", "large", "special"],
  "Unit 3 tail must match the photographed textbook"
);
assert.deepStrictEqual(
  yilin2024Words.filter((word) => word.unitId === "yilin-2024-7A-u4").slice(0, 4).map((word) => word.word),
  ["a.m.", "get up", "activity", "housework"],
  "Unit 4 opening must match the photographed textbook"
);
assert(yilin2024Words.every((word) => vocabulary.getVocabularyAudioInfo(word.key).directFileId));
assert(yilin2024Words.every((word) => vocabulary.getVocabularyAudioInfo(word.key).directDurationMs > 0));

const xuRecommended = vocabulary.getRecommendedVocabularySettings({ name: "徐浩成" }, library);
assert.deepStrictEqual(xuRecommended.levelIds, ["yilin-2024-7A"]);
assert.strictEqual(xuRecommended.learningOrder, "book");
assert.strictEqual(xuRecommended.hideBasicWords, false);
const xuMigrated = vocabulary.normalizeVocabularySettings({
  profileVersion: 3,
  levelIds: ["1A", "1B", "2A"],
  dailyGoal: 10,
  includeMistakeWords: true,
  hideBasicWords: true,
  learningOrder: "smart",
}, library, { name: "徐浩成" });
assert.deepStrictEqual(xuMigrated.levelIds, ["yilin-2024-7A"]);
assert.strictEqual(xuMigrated.learningOrder, "book", "Xu Haocheng must start the real textbook in unit order");
assert.strictEqual(xuMigrated.hideBasicWords, false, "Every textbook word must remain in Xu Haocheng's daily pool");

const yilin2024Catalog = vocabulary.buildVocabularyCatalog({
  library,
  settings: {
    levelIds: ["yilin-2024-7A"],
    disabledUnitIds: ["yilin-2024-7A-u1"],
  },
});
const expectedEnabledYilinKeys = new Set(
  yilin2024Words.filter((word) => word.unitId !== "yilin-2024-7A-u1").map((word) => word.key)
);
assert.strictEqual(yilin2024Catalog[0].wordCount, 407);
assert.strictEqual(yilin2024Catalog[0].enabledWordCount, expectedEnabledYilinKeys.size);
assert.strictEqual(yilin2024Catalog[0].unitCount, 8);
assert.strictEqual(yilin2024Catalog[0].enabledUnitCount, 7);
const yilin2024View = vocabulary.buildVocabularyView({
  library,
  settings: {
    levelIds: ["yilin-2024-7A"],
    dailyGoal: 10,
    includeMistakeWords: false,
    hideBasicWords: false,
    learningOrder: "book",
    disabledUnitIds: ["yilin-2024-7A-u1"],
  },
  mistakes: [],
  progressItems: [],
  isTeacher: true,
  student: { name: "徐浩成" },
});
assert.strictEqual(yilin2024View.summary.totalCount, expectedEnabledYilinKeys.size);
assert(yilin2024View.words.every((word) => word.unitIds.indexOf("yilin-2024-7A-u1") < 0));

assert.deepStrictEqual(
  vocabulary.buildVocabularyCatalog({ library, settings: { levelIds: [] } }),
  [],
  "An empty selection must not expose default libraries"
);

const beginnerView = vocabulary.buildVocabularyView({
  library,
  settings: {
    levelIds: ["0A"],
    dailyGoal: 5,
    includeMistakeWords: true,
    hideBasicWords: true,
    learningOrder: "smart",
  },
  mistakes: [{
    _id: "mistake-1",
    vocabularyWords: [{ word: "advanced", meaning: "高级的" }],
    vocabularyCandidates: ["advanced"],
  }],
  progressItems: [],
  isTeacher: true,
  nowMs: Date.UTC(2026, 8, 15),
  student: { name: "零基础学生" },
});
assert.strictEqual(beginnerView.summary.totalCount, 90);
assert.strictEqual(beginnerView.summary.basicHiddenCount, 0, "Selected 0A words must not be hidden as basic words");
assert.deepStrictEqual(
  beginnerView.todayWords.map((word) => word.key),
  ["letter-a", "letter-b", "letter-c", "letter-d", "letter-e"],
  "A beginner-only plan must start in teaching order instead of putting mistake words first"
);
assert(beginnerView.todayWords.every((word) => word.pronunciationDirectFileId));
assert(beginnerView.todayWords.every((word) => word.pronunciationDirectDurationMs > 0));

const teacherDetailNow = Date.UTC(2026, 8, 15, 12);
const teacherDetailView = vocabulary.buildVocabularyView({
  library,
  settings: {
    levelIds: ["0A"],
    dailyGoal: 5,
    includeMistakeWords: false,
    hideBasicWords: false,
    learningOrder: "smart",
  },
  mistakes: [],
  progressItems: [
    { wordKey: beginnerWords[1].key, stage: 2, reviewCount: 2, nextReviewAtMs: teacherDetailNow + 3600000 },
    { wordKey: beginnerWords[2].key, stage: 2, reviewCount: 2, nextReviewAtMs: teacherDetailNow - 3600000 },
    { wordKey: beginnerWords[3].key, stage: 5, reviewCount: 5, nextReviewAtMs: teacherDetailNow + 86400000 },
    { wordKey: beginnerWords[4].key, stage: 5, reviewCount: 1, isEasy: true, nextReviewAtMs: teacherDetailNow + 86400000 },
  ],
  isTeacher: true,
  nowMs: teacherDetailNow,
  student: { name: "明细测试学生" },
});
assert.strictEqual(teacherDetailView.summary.unlearnedCount, 85);
assert.strictEqual(teacherDetailView.summary.activeLearningCount, 1);
assert.strictEqual(teacherDetailView.summary.reviewDueCount, 1);
assert.strictEqual(teacherDetailView.summary.strictMasteredCount, 1);
assert.strictEqual(teacherDetailView.summary.easyCount, 1);
assert.strictEqual(
  teacherDetailView.summary.unlearnedCount
    + teacherDetailView.summary.activeLearningCount
    + teacherDetailView.summary.reviewDueCount
    + teacherDetailView.summary.strictMasteredCount
    + teacherDetailView.summary.easyCount,
  teacherDetailView.summary.totalCount,
  "Teacher mastery groups must cover every word exactly once"
);

const now = Date.UTC(2026, 8, 10);
const results = ["forgot", "hard", "known", "easy"].map((rating) => (
  vocabulary.buildReviewProgress({ stage: 2, reviewCount: 3 }, rating, now)
));
assert(results.every((item) => item.reviewCount === 4));
assert(results[0].nextReviewAtMs < results[1].nextReviewAtMs);
assert(results[1].nextReviewAtMs < results[2].nextReviewAtMs);
assert(results[2].nextReviewAtMs < results[3].nextReviewAtMs);

assert.notStrictEqual(
  frenchContent.normalizeFrenchCanonical("ou"),
  frenchContent.normalizeFrenchCanonical("où"),
  "French canonical keys must stay outside the English ASCII normalizer"
);

const root = path.resolve(__dirname, "..", "..", "..");
const indexSource = fs.readFileSync(path.join(root, "cloudfunctions", "quickstartFunctions", "index.js"), "utf8");
const app = JSON.parse(fs.readFileSync(path.join(root, "miniprogram", "app.json"), "utf8"));
assert(indexSource.includes('case "getVocabularyData"'));
assert(indexSource.includes('case "getVocabularyCatalog"'));
assert(indexSource.includes('case "reviewVocabularyWord"'));
assert(indexSource.includes('case "updateVocabularySettings"'));
assert(app.pages.includes("pages/vocabulary/index"));
assert(app.pages.includes("pages/vocabulary-challenge/index"));

console.log("englishVocabularyRegression.test.js: passed");
