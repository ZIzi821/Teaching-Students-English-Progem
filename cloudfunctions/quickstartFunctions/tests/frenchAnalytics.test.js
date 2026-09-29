const assert = require("assert");
const { buildFrenchContent } = require("../frenchContent");
const { scheduleReview, DAY_MS } = require("../frenchReviewEngine");
const {
  buildDashboard,
  getDateKey,
  normalizePreferences,
} = require("../frenchAnalytics");

const createError = (code, message) => Object.assign(new Error(message), { code });
const now = Date.UTC(2026, 8, 10, 4, 0, 0);
const preferences = normalizePreferences({ timezoneOffsetMinutes: 8 * 60, dailyGoal: 20 });
const content = buildFrenchContent(createError, { forceReload: true });

const empty = buildDashboard(content, new Map(), now, preferences);
assert.strictEqual(empty.levelProgress[0].overallPercent, 0);
assert.strictEqual(empty.levelProgress[1].overallPercent, 0);
assert.strictEqual(empty.memoryDistribution.new, 400);
assert.strictEqual(empty.memoryOverview.reviewedWordCount, 0);
assert.deepStrictEqual(empty.memoryOverview.points, []);
assert.strictEqual(empty.reviewWorkload.dueToday, 0);
assert(empty.trend7.every((item) => item.value === 0));
assert.strictEqual(empty.dailyPath.steps.length, 3);
assert.strictEqual(empty.dailyPath.steps[0].completed, false);

const firstA1 = content.words.find((word) => word.cefrLevel === "A1");
const firstA2 = content.words.find((word) => word.cefrLevel === "A2");
const a1Progress = scheduleReview(null, "good", now - 2 * DAY_MS);
a1Progress.contentType = "word";
a1Progress.contentId = firstA1.id;
a1Progress.learnerKey = "student:test";
const a2Progress = scheduleReview(null, "again", now - DAY_MS);
a2Progress.contentType = "word";
a2Progress.contentId = firstA2.id;
a2Progress.learnerKey = "student:test";

const todayKey = getDateKey(now, preferences.timezoneOffsetMinutes);
const yesterdayKey = getDateKey(now - DAY_MS, preferences.timezoneOffsetMinutes);
const progressByKey = new Map([
  [`word:${firstA1.id}`, a1Progress],
  [`word:${firstA2.id}`, a2Progress],
  [`daily:${todayKey}`, {
    contentType: "daily",
    contentId: todayKey,
    activityCount: 3,
    reviewActionCount: 2,
    successfulRecallCount: 1,
    againCount: 1,
    studySessionCount: 1,
    wordActivityCount: 2,
    sentenceActivityCount: 1,
    readingActivityCount: 1,
    grammarActivityCount: 1,
    expressionActivityCount: 1,
    writingActivityCount: 1,
  }],
  [`daily:${yesterdayKey}`, {
    contentType: "daily",
    contentId: yesterdayKey,
    activityCount: 2,
    reviewActionCount: 2,
    successfulRecallCount: 2,
    studySessionCount: 1,
  }],
]);

const dashboard = buildDashboard(content, progressByKey, now, preferences);
assert(dashboard.levelProgress[0].dimensions.vocabulary.percent > 0);
assert(dashboard.levelProgress[1].dimensions.vocabulary.percent > 0);
assert.strictEqual(dashboard.streakDays, 2);
assert.strictEqual(dashboard.today.activityCount, 3);
assert.strictEqual(dashboard.accuracy7.accuracyPercent, 75);
assert.strictEqual(dashboard.memoryDistribution.new, 398);
assert.strictEqual(dashboard.memoryDistribution.learning + dashboard.memoryDistribution.review, 2);
assert.strictEqual(dashboard.memoryOverview.reviewedWordCount, 2);
assert.strictEqual(dashboard.memoryOverview.points.length, 4);
assert(dashboard.memoryOverview.points.every((point, index, points) => (
  index === 0 || point.value <= points[index - 1].value
)));
assert(dashboard.reviewWorkload.dueToday >= 1);
assert.strictEqual(dashboard.trend7[6].value, 3);
assert.strictEqual(dashboard.dailyPath.steps.length, 3);
assert.strictEqual(dashboard.dailyPath.steps[0].completedCount, 2);
assert.strictEqual(dashboard.dailyPath.steps[1].completed, true);
assert(dashboard.dailyPath.progressPercent > 0);

const later = buildDashboard(content, progressByKey, now + 5 * DAY_MS, preferences);
const currentDifficult = dashboard.difficultWords.find((word) => word.id === firstA2.id);
const laterDifficult = later.difficultWords.find((word) => word.id === firstA2.id);
assert(currentDifficult && laterDifficult);
assert(laterDifficult.estimatedRetentionPercent < currentDifficult.estimatedRetentionPercent);
assert(later.memoryOverview.currentRetentionPercent < dashboard.memoryOverview.currentRetentionPercent);

console.log("frenchAnalytics.test.js: passed");
