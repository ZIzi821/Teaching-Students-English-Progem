const assert = require("assert");
const vocabulary = require("../vocabulary");
const teacherTodos = require("../teacherTodos");

const nowMs = Date.UTC(2026, 9, 10, 4, 0, 0);
const currentLearningDay = vocabulary.getLearningDay(nowMs);
const daysAgo = (days) => nowMs - days * 24 * 60 * 60 * 1000;
const students = [
  { _id: "student-recording", name: "录音学生", englishCourseEnabled: true },
  { _id: "student-homework", name: "作业学生", englishCourseEnabled: true },
  { _id: "student-overdue", name: "逾期学生", englishCourseEnabled: true },
  { _id: "student-vocabulary", name: "单词学生", vocabularyEnabled: true },
  {
    _id: "student-inactive",
    name: "停学学生",
    vocabularyEnabled: true,
    createdAt: daysAgo(10),
  },
  {
    _id: "student-active",
    name: "活跃学生",
    vocabularyEnabled: true,
    createdAt: daysAgo(10),
  },
];
const lessons = [
  {
    _id: "lesson-pending",
    studentId: "student-recording",
    title: "朗读练习",
    lessonDate: "2026-10-08",
    recordingTaskEnabled: true,
    homeworkDueDays: 2,
    homeworkTaskVersion: 1,
    homeworkTeacherReviewStatus: "unreviewed",
  },
  {
    _id: "lesson-review",
    studentId: "student-homework",
    title: "句型练习",
    lessonDate: "2026-10-08",
    recordingTaskEnabled: true,
    homeworkDueDays: 2,
    homeworkTaskVersion: 1,
    homeworkTeacherReviewStatus: "unreviewed",
  },
  {
    _id: "lesson-overdue",
    studentId: "student-overdue",
    title: "逾期练习",
    lessonDate: "2026-10-01",
    recordingTaskEnabled: true,
    homeworkDueDays: 1,
    homeworkTaskVersion: 1,
    homeworkTeacherReviewStatus: "unreviewed",
  },
  {
    _id: "lesson-completed",
    studentId: "student-homework",
    title: "已完成练习",
    lessonDate: "2026-10-07",
    recordingTaskEnabled: true,
    homeworkDueDays: 1,
    homeworkTaskVersion: 1,
    homeworkTeacherReviewStatus: "completed",
    homeworkCompleted: true,
    homeworkCompletedFrom: "teacher",
  },
];
const submissions = [
  {
    _id: "submission-pending",
    studentId: "student-recording",
    lessonId: "lesson-pending",
    kind: "audio",
    status: "待检查",
    homeworkTaskVersion: 1,
    createdAtMs: nowMs - 60 * 60 * 1000,
  },
  {
    _id: "submission-reviewed",
    studentId: "student-homework",
    lessonId: "lesson-review",
    kind: "audio",
    status: "朗读正确",
    homeworkTaskVersion: 1,
    createdAtMs: nowMs - 2 * 60 * 60 * 1000,
  },
  {
    _id: "submission-completed",
    studentId: "student-homework",
    lessonId: "lesson-completed",
    kind: "audio",
    status: "朗读正确",
    homeworkTaskVersion: 1,
    createdAtMs: nowMs - 3 * 60 * 60 * 1000,
  },
];
const vocabularyAlerts = [{
  _id: "quiz-low:student-vocabulary",
  studentId: "student-vocabulary",
  studentName: "单词学生",
  activityType: "quiz_low_accuracy",
  severity: "attention",
  title: "单词小测需要关注",
  activityText: "最近一次正确率 50%",
  detail: "建议查看答错词",
  activityAtMs: nowMs - 3 * 60 * 60 * 1000,
}];
const dailyStats = [
  {
    studentId: "student-inactive",
    learningDay: currentLearningDay - 4,
    reviewedWordCount: 3,
    updatedAt: daysAgo(4),
  },
  {
    studentId: "student-active",
    learningDay: currentLearningDay,
    reviewedWordCount: 2,
    updatedAt: nowMs - 30 * 60 * 1000,
  },
];
const quizSessions = [{
  studentId: "student-vocabulary",
  learningDay: currentLearningDay,
  totalQuestions: 8,
  completedAtMs: nowMs - 3 * 60 * 60 * 1000,
}];

const result = teacherTodos.buildTeacherTodos({
  students,
  lessons,
  submissions,
  vocabularyAlerts,
  dailyStats,
  quizSessions,
  nowMs,
});

assert.strictEqual(result.summary.totalCount, 5);
assert.strictEqual(result.summary.recordingCount, 1);
assert.strictEqual(result.summary.homeworkCount, 2);
assert.strictEqual(result.summary.vocabularyCount, 1);
assert.strictEqual(result.summary.inactivityCount, 1);
assert.strictEqual(result.summary.urgentCount, 1);
assert.deepStrictEqual(
  result.items.map((item) => item.kind),
  [
    "homework_overdue",
    "recording_review",
    "homework_review",
    "quiz_low_accuracy",
    "learning_inactivity",
  ]
);
assert(result.items.find((item) => item.kind === "recording_review").detail.includes("1 份录音"));
assert(result.items.find((item) => item.kind === "homework_overdue").detail.includes("已逾期"));
assert(result.items.find((item) => item.kind === "learning_inactivity").detail.includes("只统计小程序内"));
assert(!result.items.some((item) => item.lessonId === "lesson-completed"));

const resubmission = teacherTodos.buildTeacherTodos({
  students: [{ _id: "student-homework", name: "作业学生", englishCourseEnabled: true }],
  lessons: [{
    _id: "lesson-resubmitted",
    studentId: "student-homework",
    title: "重新提交练习",
    lessonDate: "2026-10-08",
    recordingTaskEnabled: true,
    homeworkDueDays: 2,
    homeworkTaskVersion: 2,
    homeworkTeacherReviewStatus: "incomplete",
    homeworkTeacherReviewedAtMs: daysAgo(2),
  }],
  submissions: [{
    _id: "submission-resubmitted",
    studentId: "student-homework",
    lessonId: "lesson-resubmitted",
    kind: "audio",
    status: "朗读正确",
    homeworkTaskVersion: 2,
    createdAtMs: daysAgo(1),
  }],
  nowMs,
});
assert.strictEqual(resubmission.items.length, 1);
assert.strictEqual(resubmission.items[0].kind, "homework_review");

const linkageLesson = {
  _id: "lesson-feedback-linkage",
  studentId: "student-recording",
  title: "反馈联动练习",
  lessonDate: "2026-10-09",
  recordingTaskEnabled: true,
  homeworkDueDays: 2,
  homeworkTaskVersion: 1,
  homeworkTeacherReviewStatus: "unreviewed",
};
const linkagePendingSubmission = {
  _id: "submission-feedback-pending",
  studentId: "student-recording",
  lessonId: linkageLesson._id,
  kind: "audio",
  status: "待检查",
  homeworkTaskVersion: 1,
  createdAtMs: nowMs - 30 * 60 * 1000,
};
const linkagePending = teacherTodos.buildTeacherTodos({
  students: [{ _id: "student-recording", name: "录音学生", englishCourseEnabled: true }],
  lessons: [linkageLesson],
  submissions: [linkagePendingSubmission],
  nowMs,
});
assert.strictEqual(linkagePending.summary.recordingCount, 1);
assert.strictEqual(linkagePending.items[0].kind, "recording_review");

const linkageReviewedSubmission = Object.assign({}, linkagePendingSubmission, {
  status: "朗读正确",
  teacherFeedbackTags: ["发音准确", "注意尾音"],
  teacherFeedbackNote: "最后一句更清楚了。",
  reviewedAtMs: nowMs - 20 * 60 * 1000,
});
const linkageReviewed = teacherTodos.buildTeacherTodos({
  students: [{ _id: "student-recording", name: "录音学生", englishCourseEnabled: true }],
  lessons: [linkageLesson],
  submissions: [linkageReviewedSubmission],
  nowMs,
});
assert.strictEqual(linkageReviewed.summary.recordingCount, 0);
assert(!linkageReviewed.items.some((item) => item.kind === "recording_review"));
assert(linkageReviewed.items.some((item) => item.kind === "homework_review"));

const linkageResubmitted = teacherTodos.buildTeacherTodos({
  students: [{ _id: "student-recording", name: "录音学生", englishCourseEnabled: true }],
  lessons: [linkageLesson],
  submissions: [
    linkageReviewedSubmission,
    Object.assign({}, linkagePendingSubmission, {
      _id: "submission-feedback-resubmitted",
      createdAtMs: nowMs - 5 * 60 * 1000,
    }),
  ],
  nowMs,
});
assert.strictEqual(linkageResubmitted.summary.recordingCount, 1);
assert.strictEqual(
  linkageResubmitted.items.find((item) => item.kind === "recording_review").pendingCount,
  1
);

const ketMockTodo = teacherTodos.buildTeacherTodos({
  students: [{ _id: "student-ket", name: "Molly", englishCourseEnabled: true }],
  lessons: [{
    _id: "lesson-ket-mock",
    studentId: "student-ket",
    title: "KET 口语模拟",
    lessonDate: "2026-10-09",
    recordingTaskEnabled: true,
    recordingTaskType: "ket_mock",
    homeworkDueDays: 2,
    homeworkTaskVersion: 3,
    homeworkTeacherReviewStatus: "unreviewed",
  }],
  submissions: [],
  ketMockSessions: [{
    _id: "ket-session-submitted",
    studentId: "student-ket",
    lessonId: "lesson-ket-mock",
    homeworkTaskVersion: 3,
    status: "submitted",
    submittedAtMs: nowMs - 10 * 60 * 1000,
  }, {
    _id: "ket-session-old-task",
    studentId: "student-ket",
    lessonId: "lesson-ket-mock",
    homeworkTaskVersion: 2,
    status: "submitted",
    submittedAtMs: nowMs - 2 * 24 * 60 * 60 * 1000,
  }],
  nowMs,
});
assert.strictEqual(ketMockTodo.items.length, 1);
assert.strictEqual(ketMockTodo.items[0].kind, "ket_mock_review");
assert.strictEqual(ketMockTodo.items[0].sessionId, "ket-session-submitted");
assert.strictEqual(ketMockTodo.summary.recordingCount, 1);

console.log("teacherTodos.test.js: passed");
