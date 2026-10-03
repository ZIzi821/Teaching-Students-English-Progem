const assert = require("assert");
const fs = require("fs");
const path = require("path");
const recordingFeedback = require("../cloudfunctions/quickstartFunctions/recordingFeedback");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const backend = read("cloudfunctions", "quickstartFunctions", "index.js");
const todoLogic = read("cloudfunctions", "quickstartFunctions", "teacherTodos.js");
const todoTest = read("cloudfunctions", "quickstartFunctions", "tests", "teacherTodos.test.js");
const pageJs = read("miniprogram", "pages", "lesson-detail", "index.js");
const pageWxml = read("miniprogram", "pages", "lesson-detail", "index.wxml");

let lessonDetailPage = null;
const originalPage = global.Page;
try {
  global.Page = (definition) => { lessonDetailPage = definition; };
  require(path.join(root, "miniprogram", "pages", "lesson-detail", "index.js"));
} finally {
  if (typeof originalPage === "undefined") delete global.Page;
  else global.Page = originalPage;
}
assert(lessonDetailPage, "Lesson detail page definition could not be loaded for behavior checks");

recordingFeedback.RECORDING_FEEDBACK_TAG_OPTIONS.forEach((option) => {
  assert(pageJs.includes(`label: "${option.label}"`), `Teacher UI is missing feedback tag: ${option.label}`);
});
assert(pageJs.includes("MAX_RECORDING_FEEDBACK_TAGS"), "Teacher UI must cap multi-select feedback tags");
assert(pageJs.includes('type: "reviewLessonRecording"'), "Teacher UI must use the recording review action");
assert(pageJs.includes("teacherFeedbackTags: editor.selectedTags"), "Teacher UI must submit structured feedback tags");
assert(pageJs.includes("teacherFeedbackNote: editor.note"), "Teacher UI must submit the teacher note");
assert(pageWxml.includes("快捷反馈"), "Review sheet must label the quick feedback choices");
assert(pageWxml.includes("可多选"), "Review sheet must explain that quick feedback supports multiple choices");
assert(pageWxml.includes("老师反馈"), "Student-visible recording cards must render teacher feedback");
assert(pageWxml.includes("学生重新提交后会再次进入待检查"), "Review sheet must explain todo linkage");

const preparedSubmissions = lessonDetailPage.prepareSubmissions([
  {
    _id: "structured-feedback",
    attemptNo: 2,
    duration: 12000,
    status: "朗读正确",
    teacherFeedbackTags: ["发音准确", "注意尾音"],
    teacherFeedbackNote: "最后一句更清楚了。",
    reviewedAtMs: Date.UTC(2026, 9, 3, 8, 0, 0),
  },
  {
    _id: "legacy-feedback",
    duration: 9000,
    status: "需要重录",
    teacherFeedback: "旧版短评仍需显示",
  },
]);
assert.deepStrictEqual(preparedSubmissions[0].teacherFeedbackTags, ["发音准确", "注意尾音"]);
assert.strictEqual(preparedSubmissions[0].teacherFeedbackNote, "最后一句更清楚了。");
assert.strictEqual(preparedSubmissions[0].reviewActionLabel, "修改反馈");
assert.strictEqual(preparedSubmissions[1].teacherFeedbackNote, "旧版短评仍需显示");
assert.strictEqual(preparedSubmissions[1].hasTeacherFeedback, true);

assert(backend.includes("recordingFeedback.normalizeRecordingFeedback(data)"), "Backend must normalize feedback centrally");
assert(backend.includes("teacherFeedbackTags: feedback.tags"), "Backend must persist structured feedback tags");
assert(backend.includes("teacherFeedbackNote: feedback.note"), "Backend must persist the supplementary note");
assert(backend.includes("reviewedAtMs: reviewStartedAtMs"), "Backend must persist an auditable review timestamp");
assert(todoLogic.includes('item.status === "待检查"'), "Todo logic must derive pending recordings from review status");
assert(todoTest.includes("linkageReviewed.summary.recordingCount, 0"), "Todo tests must cover removal after feedback");
assert(todoTest.includes("submission-feedback-resubmitted"), "Todo tests must cover re-entry after resubmission");

console.log("Recording feedback validation passed: structured quick feedback, student display, and todo linkage.");
