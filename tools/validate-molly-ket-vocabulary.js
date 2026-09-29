const assert = require("assert");
const path = require("path");
const data = require(path.join(__dirname, "..", "cloudfunctions", "quickstartFunctions", "data", "molly-ket-a2-words.json"));
const vocabulary = require(path.join(__dirname, "..", "cloudfunctions", "quickstartFunctions", "vocabulary"));

assert.strictEqual(data.dailyGoal, 8, "Molly daily goal must be 8");
assert.strictEqual(data.studyWeeks, 16, "Molly study plan must have 16 weeks");
assert.strictEqual(data.studyDaysPerWeek, 5, "Molly study plan must have 5 study days per week");
assert.strictEqual(data.words.length, 640, "Molly KET library must contain 640 words");
assert.strictEqual(new Set(data.words.map((item) => item.key)).size, 640, "Molly KET word keys must be unique");
assert(data.words.every((item) => item.meaning && item.unitId && item.unitLabel), "Every Molly KET word needs a meaning and unit");
assert(data.words.every((item) => /cambridgeenglish\.org/.test(item.sourceUrl)), "Every Molly KET word needs an official source URL");

const unitCounts = data.words.reduce((result, item) => {
  result[item.unitId] = (result[item.unitId] || 0) + 1;
  return result;
}, {});
assert.strictEqual(Object.keys(unitCounts).length, 16, "Molly KET library must have 16 weekly units");
Object.values(unitCounts).forEach((count) => assert.strictEqual(count, 40, "Each Molly KET week must contain 40 words"));

const settings = vocabulary.getRecommendedVocabularySettings({ name: "Molly" });
assert.deepStrictEqual(settings.levelIds, ["molly-ket-a2-16w"]);
assert.strictEqual(settings.dailyGoal, 8);
assert.strictEqual(settings.includeMistakeWords, false);
assert.strictEqual(settings.learningOrder, "book");

const library = vocabulary.loadVocabularyLibrary();
assert(library.levels.some((item) => item.id === "molly-ket-a2-16w"), "Molly KET level is not loaded");
assert.strictEqual(library.words.filter((item) => item.levelId === "molly-ket-a2-16w").length, 640);

const view = vocabulary.buildVocabularyView({
  student: { name: "Molly" },
  settings,
  mistakes: [],
  progressItems: [],
  isTeacher: true,
});
const mollyWords = view.words.filter((item) => item.levelIds.includes("molly-ket-a2-16w"));
const missingDirectAudio = mollyWords.filter((item) => (
  !item.pronunciationDirectFileId || !item.pronunciationDirectDurationMs
));
assert.strictEqual(mollyWords.length, 640, "Molly KET runtime view must contain all 640 words");
assert.deepStrictEqual(missingDirectAudio.map((item) => item.word), [], "Every Molly KET word must have short direct audio");

console.log("Molly KET vocabulary valid: 640 words, 16 weeks, 8 words per weekday, 640/640 with short direct audio.");
