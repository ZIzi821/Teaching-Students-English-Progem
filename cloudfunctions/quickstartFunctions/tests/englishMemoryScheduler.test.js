const assert = require("assert");
const {
  ALGORITHM_VERSION,
  DAY_MS,
  buildMemoryOverview,
  getRetrievability,
  migrateLegacyProgress,
  scheduleReview,
} = require("../englishMemoryScheduler");

const now = Date.UTC(2026, 9, 18, 8, 0, 0);

const initial = ["forgot", "hard", "known", "easy"].map((rating) => (
  scheduleReview(null, rating, now)
));
assert.deepStrictEqual(
  initial.map((item) => item.nextReviewAtMs),
  initial.map((item) => item.nextReviewAtMs).slice().sort((a, b) => a - b),
  "Initial rating intervals must increase from forgot to easy"
);
assert.strictEqual(initial[0].lapses, 1);
assert.strictEqual(initial[3].currentIntervalDays, 14);
assert(initial[0].difficulty > initial[1].difficulty);
assert(initial[3].difficulty < initial[2].difficulty);

const firstKnown = scheduleReview(null, "known", now);
const secondKnown = scheduleReview(firstKnown, "known", now + DAY_MS);
assert.strictEqual(secondKnown.algorithmVersion, ALGORITHM_VERSION);
assert(secondKnown.stabilityDays > firstKnown.stabilityDays);
assert(secondKnown.nextReviewAtMs > firstKnown.nextReviewAtMs);

const easyAfterKnown = scheduleReview(firstKnown, "easy", now + DAY_MS);
const hardAfterKnown = scheduleReview(firstKnown, "hard", now + DAY_MS);
assert(easyAfterKnown.stabilityDays > secondKnown.stabilityDays);
assert(secondKnown.stabilityDays > hardAfterKnown.stabilityDays);

const lapse = scheduleReview(secondKnown, "forgot", secondKnown.nextReviewAtMs);
assert.strictEqual(lapse.lapses, 1);
assert(lapse.stabilityDays < secondKnown.stabilityDays);
assert.strictEqual(lapse.nextReviewAtMs, secondKnown.nextReviewAtMs + 10 * 60 * 1000);

const retentionNow = getRetrievability(secondKnown, secondKnown.lastReviewedAtMs);
const retentionLater = getRetrievability(secondKnown, secondKnown.lastReviewedAtMs + 7 * DAY_MS);
assert.strictEqual(retentionNow, 1);
assert(retentionLater < retentionNow);

const legacy = {
  stage: 3,
  _id: "must-not-be-written-back",
  studentId: "student-legacy",
  reviewCount: 4,
  correctCount: 3,
  wrongCount: 1,
  lastResult: "known",
  lastReviewedAtMs: now - 2 * DAY_MS,
  nextReviewAtMs: now + 5 * DAY_MS,
};
const migrated = migrateLegacyProgress(legacy, now);
assert.strictEqual(migrated.algorithmVersion, ALGORITHM_VERSION);
assert.strictEqual(migrated.migratedFromAlgorithmVersion, "fixed-stage-v1");
assert.strictEqual(migrated.reviewCount, 4);
assert.strictEqual(Object.prototype.hasOwnProperty.call(migrated, "_id"), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(migrated, "studentId"), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(migrated, "stage"), false);
assert.strictEqual(migrated.lastReviewedAtMs, legacy.lastReviewedAtMs);
assert.strictEqual(migrated.nextReviewAtMs, legacy.nextReviewAtMs);

const overview = buildMemoryOverview([
  secondKnown,
  Object.assign({}, firstKnown, { nextReviewAtMs: now - 1 }),
], now);
assert.strictEqual(overview.reviewedWordCount, 2);
assert.strictEqual(overview.dueNowCount, 1);
assert(overview.dueTomorrowCount >= overview.dueNowCount);
assert(overview.dueInSevenDaysCount >= overview.dueTomorrowCount);
assert(Number.isInteger(overview.estimatedRetentionPercent));

const emptyOverview = buildMemoryOverview([], now);
assert.strictEqual(emptyOverview.reviewedWordCount, 0);
assert.strictEqual(emptyOverview.estimatedRetentionPercent, null);

const corrupt = migrateLegacyProgress({
  algorithmVersion: ALGORITHM_VERSION,
  reviewCount: 2,
  successfulReviews: 99,
  lapses: 99,
  state: "invalid",
  stabilityDays: 1e308,
  currentIntervalDays: Infinity,
  lastReviewedAtMs: now,
}, NaN);
assert.strictEqual(corrupt.successfulReviews, 2);
assert.strictEqual(corrupt.lapses, 2);
assert.strictEqual(corrupt.stabilityDays, 3650);
assert(Number.isFinite(corrupt.currentIntervalDays));
assert(Number.isFinite(scheduleReview(corrupt, "known", NaN).nextReviewAtMs));

console.log("englishMemoryScheduler.test.js: passed");
