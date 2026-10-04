const assert = require("assert");
const engagement = require("../studentEngagement");

const DAY_MS = engagement.DAY_MS;
const nowMs = Date.UTC(2026, 9, 7, 4, 0, 0);
const today = engagement.getLearningDay(nowMs);
const atDay = (day, hour = 12) => day * DAY_MS - 8 * 60 * 60 * 1000 + hour * 60 * 60 * 1000;

const studentA = { _id: "student-a", name: "Molly", status: "在读", frenchLearningEnabled: true, completedLessonCount: 40 };
const studentB = { _id: "student-b", name: "冯嘉文", status: "在读" };

const score = engagement.buildStudentScore({
  vocabularyDailyStats: [
    { learningDay: today - 2, reviewedWordCount: 40 },
    { learningDay: today - 1, reviewedWordCount: 8 },
    { learningDay: today, reviewedWordCount: 5 },
  ],
  quizSessions: [
    { _id: "q1", learningDay: today, totalQuestions: 10, correctCount: 5, completedAtMs: atDay(today, 10) },
    { _id: "q2", learningDay: today, totalQuestions: 10, correctCount: 10, completedAtMs: atDay(today, 11) },
  ],
  submissions: [
    { _id: "r1", lessonId: "lesson-1", homeworkTaskVersion: 1, kind: "audio", status: "待检查", createdAtMs: atDay(today - 1, 9) },
    { _id: "r2", lessonId: "lesson-1", homeworkTaskVersion: 1, kind: "audio", status: "朗读正确", createdAtMs: atDay(today, 9) },
    { _id: "r3", lessonId: "lesson-2", homeworkTaskVersion: 1, kind: "audio", status: "需要重录", createdAtMs: atDay(today, 9) },
  ],
  lessons: [
    { _id: "lesson-1", title: "第一课", homeworkTeacherReviewStatus: "completed", homeworkCompletedAtMs: atDay(today) },
  ],
  ketMockSessions: [
    { _id: "k1", lessonId: "ket-lesson", homeworkTaskVersion: 1, status: "submitted", submittedAtMs: atDay(today - 1) },
    { _id: "k2", lessonId: "ket-lesson", homeworkTaskVersion: 1, status: "reviewed", submittedAtMs: atDay(today) },
  ],
  frenchProgress: [
    { contentType: "daily", contentId: engagement.getWeekWindow(nowMs).label ? "2026-10-07" : "", activityCount: 30, lastActivityAtMs: atDay(today) },
  ],
}, nowMs);

assert.strictEqual(score.reviewedWordCount, 43, "English vocabulary points must cap each day at 30 unique words");
assert.strictEqual(score.quizDayCount, 1, "Only one quiz result may score per learning day");
assert.strictEqual(score.recordingCount, 1, "Repeated recordings for the same task version must not farm points");
assert.strictEqual(score.homeworkCount, 1, "Teacher-confirmed homework must score once");
assert.strictEqual(score.ketMockCount, 1, "Repeated KET records for one task version must score once");
assert.strictEqual(score.frenchActivityCount, 10, "French activity points must respect the daily cap");
assert.strictEqual(score.streakDays, 3, "Consecutive verified learning days should build a streak");
assert.strictEqual(score.totalPoints, 181, "Point rules changed unexpectedly");

const dashboard = engagement.buildEngagementDashboard({
  currentStudentId: studentA._id,
  nowMs,
  participants: [
    {
      student: studentA,
      records: {
        vocabularyDailyStats: [{ learningDay: today, reviewedWordCount: 5 }],
      },
    },
    {
      student: studentB,
      records: {
        vocabularyDailyStats: [{ learningDay: today, reviewedWordCount: 8 }],
      },
    },
    {
      student: { _id: "finished", name: "结课学生", status: "结课", teacherHidden: true },
      records: { vocabularyDailyStats: [{ learningDay: today, reviewedWordCount: 30 }] },
    },
  ],
});

assert.strictEqual(dashboard.weeklyRank, 2, "Current student weekly rank is incorrect");
assert.strictEqual(dashboard.participantCount, 2, "Students who are no longer active must not enter student PK");
assert.strictEqual(dashboard.weeklyRanking[0].displayName, "冯同学", "Other student names must be masked");
assert.strictEqual(dashboard.weeklyRanking[1].displayName, "我", "Current learner must be shown as me");
assert.strictEqual(dashboard.distanceToNext, 7, "Distance to next rank should require strictly exceeding it");
assert.strictEqual(dashboard.pkScore, dashboard.weeklyPoints, "A real student's PK score must equal verified weekly points");

const challengeState = engagement.getPkChallengeScore({
  _id: "challenge-1",
  name: "闪电挑战者",
  weeklyBaseScore: 15,
  dailyIncrement: 2,
  enabled: true,
}, nowMs);
assert.strictEqual(challengeState.elapsedDays, 2, "Challenge growth must use Hong Kong week days from Monday");
assert.strictEqual(challengeState.score, 19, "Challenge score formula is incorrect");
const challengeDashboard = engagement.buildEngagementDashboard({
  currentStudentId: studentA._id,
  nowMs,
  participants: [
    { student: studentA, records: { vocabularyDailyStats: [{ learningDay: today, reviewedWordCount: 5 }] } },
    { student: Object.assign({}, studentB, { pkEnabled: false }), records: { vocabularyDailyStats: [{ learningDay: today, reviewedWordCount: 30 }] } },
  ],
  challengeProfiles: [{
    _id: "challenge-1",
    name: "闪电挑战者",
    weeklyBaseScore: 15,
    dailyIncrement: 2,
    enabled: true,
  }],
});
assert.strictEqual(challengeDashboard.participantCount, 2, "Opted-out real students must stay off the PK ranking");
assert.strictEqual(challengeDashboard.weeklyRanking[0].displayName, "闪电挑战者");
assert.strictEqual(challengeDashboard.weeklyRanking[0].isChallenge, true, "Configured competitors must be labelled as challenge participants");
assert.strictEqual(challengeDashboard.weeklyRanking[1].pkScore, 10, "Real PK score must remain verified weekly points");

const tiedDashboard = engagement.buildEngagementDashboard({
  currentStudentId: studentA._id,
  nowMs,
  participants: [studentA, studentB].map((student) => ({
    student,
    records: { vocabularyDailyStats: [{ learningDay: today, reviewedWordCount: 5 }] },
  })),
});
assert.deepStrictEqual(tiedDashboard.weeklyRanking.map((item) => item.rank), [1, 1], "Equal weekly points should share the same rank");
assert.strictEqual(tiedDashboard.weeklyRank, 1, "A tied learner should see the shared rank");
assert.ok(tiedDashboard.pkMessage.includes("并列领先"), "A tied lead needs an honest PK message");

const reminderActivities = engagement.buildReminderActivities({
  nowMs,
  viewedThroughAtMs: atDay(today - 1),
  reminders: [
    { _id: "active", status: "active", title: "记得带课本", content: "明天上课请带好课本。", updatedAtMs: atDay(today) },
    { _id: "read", status: "active", title: "旧提醒", content: "已经看过", updatedAtMs: atDay(today - 2) },
    { _id: "withdrawn", status: "withdrawn", title: "已撤回", content: "不应显示", updatedAtMs: atDay(today) },
  ],
});
assert.deepStrictEqual(reminderActivities.map((item) => item.reminderId), ["active"], "Only new active reminders should enter the student feed");

const achievements = engagement.buildAchievements(score, studentA);
assert.ok(achievements.find((item) => item.id === "steady_three" && item.unlocked), "Three-day streak achievement is missing");
assert.ok(achievements.find((item) => item.id === "french_explorer" && item.unlocked), "French achievement should be available to enabled learners");
assert.ok(achievements.find((item) => item.id === "lesson_twenty" && item.unlocked), "Twenty-lesson achievement is missing");
assert.ok(achievements.find((item) => item.id === "lesson_forty" && item.unlocked), "Forty-lesson achievement is missing");

console.log("Student engagement tests passed: verified points, lesson milestones, opt-in PK, labelled challenge participants, and reminder visibility.");
