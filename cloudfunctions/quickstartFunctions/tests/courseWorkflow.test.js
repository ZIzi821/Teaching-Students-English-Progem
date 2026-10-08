const assert = require("assert");
const courseWorkflow = require("../courseWorkflow");

const mollyProgress = courseWorkflow.buildLessonProgress({
  name: "Molly",
  plannedLessonCount: 5,
  completedLessonCount: 3,
});
assert.strictEqual(mollyProgress.lessonPackageSize, 5);
assert.strictEqual(mollyProgress.remainingLessonCount, 2);
assert.strictEqual(mollyProgress.lessonReminderThreshold, 2);
assert.strictEqual(mollyProgress.progressTone, "near-end");
assert.strictEqual(mollyProgress.progressMarkerPercent, 60);

const renewedMollyProgress = courseWorkflow.buildLessonProgress({
  name: "Molly",
  plannedLessonCount: 10,
  completedLessonCount: 5,
});
assert.strictEqual(renewedMollyProgress.progressTone, "normal");
assert.strictEqual(renewedMollyProgress.progressMarkerPercent, 80);

const fengProgress = courseWorkflow.buildLessonProgress({
  name: "冯嘉文",
  plannedLessonCount: 3,
  completedLessonCount: 2,
});
assert.strictEqual(fengProgress.lessonPackageSize, 3);
assert.strictEqual(fengProgress.lessonReminderThreshold, 1);
assert.strictEqual(fengProgress.progressTone, "near-end");

const customProgress = courseWorkflow.buildLessonProgress({
  name: "Molly",
  lessonPackageSize: 4,
  plannedLessonCount: 8,
  completedLessonCount: 8,
});
assert.strictEqual(customProgress.lessonPackageSize, 4);
assert.strictEqual(customProgress.progressTone, "complete");

assert.strictEqual(
  courseWorkflow.countLessonProgressRecords([
    { _id: "personal-legacy" },
    { _id: "personal-explicit", institutionCourse: false },
    { _id: "institution", institutionCourse: true },
  ]),
  2,
  "institution courses must stay in course records without increasing lesson progress"
);
assert.strictEqual(courseWorkflow.countsTowardLessonProgress({}), true, "legacy lessons must keep counting by default");
assert.strictEqual(courseWorkflow.countsTowardLessonProgress({ institutionCourse: true }), false);
assert.strictEqual(
  courseWorkflow.getEffectiveCompletedLessonCount(
    { completedLessonCount: 7, recordedLessonCount: 7 },
    4
  ),
  4,
  "marking three existing lessons as institution courses must remove them from progress"
);
assert.strictEqual(
  courseWorkflow.getEffectiveCompletedLessonCount(
    { completedLessonCount: 10, recordedLessonCount: 7 },
    4
  ),
  7,
  "manual lesson baseline must remain while institution lessons are excluded"
);
assert.strictEqual(
  courseWorkflow.getEffectiveCompletedLessonCount(
    { completedLessonCount: 4, recordedLessonCount: 4 },
    5
  ),
  5,
  "switching a lesson back to personal must restore one progress lesson"
);

assert.strictEqual(courseWorkflow.getLessonAccountingMode({ name: "徐浩成" }), "minute");
assert.strictEqual(
  courseWorkflow.usesLessonDurationMinutes({ name: "徐浩成" }, "general"),
  true,
  "Xu Haocheng's ordinary lessons must keep minute accounting"
);
assert.strictEqual(
  courseWorkflow.usesLessonDurationMinutes({ name: "冯嘉文" }, "vocabulary_coaching"),
  true,
  "vocabulary coaching must record its actual duration for every student"
);
assert.strictEqual(
  courseWorkflow.usesLessonDurationMinutes({ name: "冯嘉文" }, "feng_beginner"),
  false,
  "Feng Jiawen's ordinary lessons must not receive the minute-only field"
);
assert.deepStrictEqual(
  courseWorkflow.withApplicableLessonDuration(
    { lessonTemplateKey: "feng_beginner", durationMinutes: 60 },
    { name: "冯嘉文" }
  ),
  { lessonTemplateKey: "feng_beginner", durationMinutes: 0 },
  "legacy stray duration values must be hidden outside their valid context"
);
assert.strictEqual(
  courseWorkflow.withApplicableLessonDuration(
    { lessonTemplateKey: "general", durationMinutes: 45 },
    { name: "徐浩成" }
  ).durationMinutes,
  45
);
assert.strictEqual(
  courseWorkflow.getLessonAccountingMode({ name: "徐浩成", lessonAccountingMode: "lesson" }),
  "lesson",
  "an explicit accounting mode must override the compatibility name rule"
);
const xuCompatibilityProgress = courseWorkflow.buildLessonProgress({
  name: "徐浩成",
  plannedLessonCount: 10,
  completedLessonCount: 1,
});
assert.strictEqual(xuCompatibilityProgress.plannedLessonMinutes, 600);
assert.strictEqual(xuCompatibilityProgress.completedLessonMinutes, 60);
assert.strictEqual(xuCompatibilityProgress.progressText, "1 小时 / 10 小时");
assert.strictEqual(xuCompatibilityProgress.progressUnit, "minute");
assert.strictEqual(
  courseWorkflow.countLessonProgressMinutes([
    { durationMinutes: 35 },
    { durationMinutes: 45 },
    { durationMinutes: 60, institutionCourse: true },
    { durationMinutes: 7 },
  ]),
  80,
  "only valid five-minute private durations may consume the hour package"
);
assert.strictEqual(
  courseWorkflow.countLessonProgressMinutes([
    {},
    { durationMinutes: "" },
    { durationMinutes: 60, institutionCourse: true },
    { durationMinutes: 7 },
  ], 60),
  120,
  "legacy private lessons without a duration must count as one hour, while institution and invalid explicit durations do not"
);
assert.strictEqual(
  courseWorkflow.getEffectiveCompletedLessonMinutes(
    { completedLessonMinutes: 80, recordedLessonMinutes: 80 },
    90
  ),
  90,
  "editing a recorded duration from 35 to 45 minutes must add ten minutes"
);
assert.strictEqual(
  courseWorkflow.getEffectiveCompletedLessonMinutes(
    { completedLessonMinutes: 80, recordedLessonMinutes: 80 },
    45
  ),
  45,
  "marking one duration lesson as institution course must remove its minutes"
);
const legacyMinuteLessons = [{}, {}, {}];
const legacyBefore = courseWorkflow.countLessonProgressMinutes(legacyMinuteLessons, 60);
const legacyAfter = courseWorkflow.countLessonProgressMinutes([
  { institutionCourse: true },
  {},
  {},
], 60);
assert.strictEqual(legacyBefore, 180);
assert.strictEqual(
  courseWorkflow.getEffectiveCompletedLessonMinutes(
    { completedLessonMinutes: legacyBefore, recordedLessonMinutes: legacyBefore },
    legacyAfter
  ),
  120,
  "marking a legacy Xu lesson as an institution course must subtract one hour"
);
assert.strictEqual(courseWorkflow.normalizeLessonDurationMinutes(35), 35);
assert.strictEqual(courseWorkflow.normalizeLessonDurationMinutes(7), 0);
assert.strictEqual(courseWorkflow.normalizeLessonDurationMinutes(0), 0);

assert.strictEqual(
  courseWorkflow.getLessonMasterySummary({
    taughtContent: "今天简单认识了英文中的 Be 动词",
    summary: "今天简单认识了英文中的 Be 动词",
  }),
  "",
  "structured taught content must not be repeated as mastery"
);
assert.strictEqual(
  courseWorkflow.getLessonMasterySummary({
    taughtContent: "今天学习了新内容",
    masterySummary: "能够独立完成",
    summary: "能够独立完成",
  }),
  "能够独立完成",
  "explicit mastery must remain visible"
);
assert.strictEqual(
  courseWorkflow.getLessonMasterySummary({ summary: "旧版课程摘要" }),
  "旧版课程摘要",
  "legacy summary-only lessons must remain readable"
);

const lesson = {
  lessonDate: "2026-10-03",
  recordingTaskEnabled: true,
  homeworkDueDays: 2,
};
assert.strictEqual(courseWorkflow.getHomeworkDueDate(lesson), "2026-10-05");
assert.strictEqual(courseWorkflow.addDays("2026-01-31", 1), "2026-02-01");

const beforeDue = Date.UTC(2026, 9, 4, 4, 0, 0);
const dueDay = Date.UTC(2026, 9, 5, 4, 0, 0);
const afterDue = Date.UTC(2026, 9, 6, 4, 0, 0);
assert.strictEqual(
  courseWorkflow.buildHomeworkDeadlineState(lesson, beforeDue).homeworkDueLabel,
  "距截止还有 1 天"
);
assert.strictEqual(
  courseWorkflow.buildHomeworkDeadlineState(lesson, dueDay).homeworkDueLabel,
  "当天截止"
);
assert.strictEqual(
  courseWorkflow.buildHomeworkDeadlineState(lesson, afterDue).homeworkDueLabel,
  "已逾期 1 天"
);

const onTimeSubmission = Date.UTC(2026, 9, 5, 15, 59, 59);
const lateSubmission = Date.UTC(2026, 9, 5, 16, 0, 0);
assert.strictEqual(courseWorkflow.isLateHomeworkSubmission(lesson, onTimeSubmission), false);
assert.strictEqual(courseWorkflow.isLateHomeworkSubmission(lesson, lateSubmission), true);
assert.strictEqual(
  courseWorkflow.buildHomeworkDeadlineState(lesson, afterDue, onTimeSubmission).homeworkSubmittedOnTime,
  true
);
assert.strictEqual(
  courseWorkflow.buildHomeworkDeadlineState(lesson, afterDue, lateSubmission).homeworkSubmissionTimingLabel,
  "逾期提交"
);

assert.strictEqual(
  courseWorkflow.buildHomeworkDeadlineState({ homeworkDueDays: -1 }, afterDue, onTimeSubmission).homeworkHasSubmission,
  true,
  "submission state must remain visible even when the teacher did not set a deadline"
);

const homeworkGrouping = courseWorkflow.buildHomeworkListGrouping({
  pendingLessons: [
    { _id: "returned", homeworkTeacherReviewStatus: "incomplete", homeworkHasSubmission: true, homeworkDueStatus: "overdue" },
    { _id: "overdue", homeworkTeacherReviewStatus: "unreviewed", homeworkHasSubmission: false, homeworkDueStatus: "overdue" },
    { _id: "today", homeworkTeacherReviewStatus: "unreviewed", homeworkHasSubmission: false, homeworkDueStatus: "today" },
    { _id: "upcoming", homeworkTeacherReviewStatus: "unreviewed", homeworkHasSubmission: false, homeworkDueStatus: "upcoming" },
    { _id: "no-deadline", homeworkTeacherReviewStatus: "unreviewed", homeworkHasSubmission: false, homeworkDueStatus: "none" },
    { _id: "awaiting", homeworkTeacherReviewStatus: "unreviewed", homeworkHasSubmission: true, homeworkDueStatus: "overdue" },
  ],
  completedLessons: [{ _id: "completed", homeworkTeacherReviewStatus: "completed" }],
});
assert.deepStrictEqual(homeworkGrouping.groups.returned.map((item) => item._id), ["returned"]);
assert.deepStrictEqual(homeworkGrouping.groups.overdue.map((item) => item._id), ["overdue"]);
assert.deepStrictEqual(homeworkGrouping.groups.today.map((item) => item._id), ["today"]);
assert.deepStrictEqual(homeworkGrouping.groups.upcoming.map((item) => item._id), ["upcoming"]);
assert.deepStrictEqual(homeworkGrouping.groups.noDeadline.map((item) => item._id), ["no-deadline"]);
assert.deepStrictEqual(homeworkGrouping.groups.awaitingReview.map((item) => item._id), ["awaiting"]);
assert.deepStrictEqual(homeworkGrouping.groups.completed.map((item) => item._id), ["completed"]);
assert.strictEqual(homeworkGrouping.summary.actionableCount, 5);
assert.strictEqual(homeworkGrouping.summary.awaitingReviewCount, 1);
assert.strictEqual(homeworkGrouping.summary.urgentCount, 3);
assert.strictEqual(homeworkGrouping.summary.pendingCount, 6);
assert.strictEqual(homeworkGrouping.summary.completedCount, 1);
assert.strictEqual(
  courseWorkflow.getHomeworkListGroup({ homeworkTeacherReviewStatus: "incomplete", homeworkHasSubmission: true }),
  "returned",
  "teacher-returned work must take priority over an existing submission"
);

console.log("courseWorkflow tests passed");
