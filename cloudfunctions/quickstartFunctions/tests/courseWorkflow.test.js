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
