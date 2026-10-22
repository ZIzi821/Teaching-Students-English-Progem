const assert = require("assert");
const mistakeExport = require("../mistakeExport");

const lessons = [
  { _id: "late-created", lessonDate: "2026-10-02", lessonNo: "1", createdAtMs: 20, title: "重复序号 B" },
  { _id: "first", lessonDate: "2026-09-01", lessonNo: "1", createdAtMs: 10, title: "第一课" },
  { _id: "same-day-first", lessonDate: "2026-10-02", lessonNo: "1", createdAtMs: 10, title: "重复序号 A" },
];
const mistakes = [
  { _id: "m3", lessonId: "late-created", createdAtMs: 3 },
  { _id: "m1", lessonId: "first", createdAtMs: 1 },
  { _id: "m2", lessonId: "same-day-first", createdAtMs: 2 },
];

assert.deepStrictEqual(mistakeExport.sortLessons(lessons).map((item) => item._id), [
  "first",
  "same-day-first",
  "late-created",
]);

const rangePlan = mistakeExport.buildExportPlan({
  lessons,
  mistakes,
  selection: { mode: "range", startLessonId: "same-day-first", endLessonId: "late-created" },
  excludePolicy: "none",
});
assert.deepStrictEqual(rangePlan.selectedLessonIds, ["same-day-first", "late-created"]);
assert.deepStrictEqual(rangePlan.mistakeIds, ["m2", "m3"]);

const history = [{
  status: "ready",
  includedLessonIds: ["first", "same-day-first"],
  mistakeIds: ["m1", "m2"],
}];
const mistakeDedupPlan = mistakeExport.buildExportPlan({
  lessons,
  mistakes,
  history,
  selection: { mode: "all" },
  excludePolicy: "exported_mistakes",
});
assert.deepStrictEqual(mistakeDedupPlan.eligibleLessonIds, ["first", "same-day-first", "late-created"]);
assert.deepStrictEqual(mistakeDedupPlan.includedLessonIds, ["late-created"]);
assert.deepStrictEqual(mistakeDedupPlan.mistakeIds, ["m3"]);
assert.strictEqual(mistakeDedupPlan.excludedMistakeCount, 2);

const lessonDedupPlan = mistakeExport.buildExportPlan({
  lessons,
  mistakes,
  history,
  selection: { mode: "all" },
  excludePolicy: "exported_lessons",
});
assert.deepStrictEqual(lessonDedupPlan.includedLessonIds, ["late-created"]);
assert.deepStrictEqual(lessonDedupPlan.mistakeIds, ["m3"]);
assert.strictEqual(lessonDedupPlan.excludedLessonCount, 2);

assert.throws(() => mistakeExport.resolveLessonSelection(lessons, {
  mode: "range",
  startLessonId: "late-created",
  endLessonId: "first",
}), /请选择早于结束课程的起始课程/);

console.log("mistakeExport tests passed");
