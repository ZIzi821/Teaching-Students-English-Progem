const assert = require("assert");
const {
  ALGORITHM_VERSION,
  DAY_MS,
  buildRetentionCurve,
  getRetrievability,
  migrateLegacyProgress,
  scheduleReview,
} = require("../frenchReviewEngine");

const now = Date.UTC(2026, 8, 10, 8, 0, 0);

const initial = ["again", "hard", "good", "easy"].map((rating) => (
  scheduleReview(null, rating, now)
));
assert.strictEqual(initial[0].lapses, 1, "A first-review Again must record one failed recall");
assert.deepStrictEqual(
  initial.map((item) => item.nextReviewAtMs),
  initial.map((item) => item.nextReviewAtMs).slice().sort((a, b) => a - b),
  "Initial Again/Hard/Good/Easy schedules must become progressively longer"
);
assert.strictEqual(new Set(initial.map((item) => item.nextReviewAtMs)).size, 4);
assert(initial[0].difficulty > initial[1].difficulty);
assert(initial[3].difficulty < initial[2].difficulty);

const firstGood = scheduleReview(null, "good", now);
assert.strictEqual(firstGood.migratedFromAlgorithmVersion, undefined);
const secondGood = scheduleReview(firstGood, "good", now + DAY_MS);
assert.strictEqual(secondGood.algorithmVersion, ALGORITHM_VERSION);
assert(secondGood.stabilityDays > firstGood.stabilityDays, "Good should increase stability");
assert(secondGood.nextReviewAtMs > firstGood.nextReviewAtMs);

const easyAfterGood = scheduleReview(firstGood, "easy", now + DAY_MS);
const hardAfterGood = scheduleReview(firstGood, "hard", now + DAY_MS);
assert(easyAfterGood.stabilityDays > secondGood.stabilityDays);
assert(secondGood.stabilityDays > hardAfterGood.stabilityDays);

const lapse = scheduleReview(secondGood, "again", secondGood.nextReviewAtMs);
assert.strictEqual(lapse.lapses, 1);
assert(lapse.stabilityDays < secondGood.stabilityDays, "Again should reduce memory strength");
assert(lapse.nextReviewAtMs < secondGood.nextReviewAtMs + DAY_MS);

const retentionNow = getRetrievability(secondGood, secondGood.lastReviewedAtMs);
const retentionLater = getRetrievability(secondGood, secondGood.lastReviewedAtMs + 7 * DAY_MS);
assert.strictEqual(retentionNow, 1);
assert(retentionLater < retentionNow, "Estimated retention must fall as elapsed time increases");

const curveBefore = buildRetentionCurve(secondGood, secondGood.lastReviewedAtMs + DAY_MS);
const curveAfter = buildRetentionCurve(
  scheduleReview(secondGood, "easy", secondGood.lastReviewedAtMs + DAY_MS),
  secondGood.lastReviewedAtMs + DAY_MS
);
assert(curveBefore.length >= 4);
assert(curveAfter.length >= 4);
assert.notDeepStrictEqual(curveAfter, curveBefore, "A review must recompute the retention curve");

const legacy = {
  stage: 3,
  reviewCount: 4,
  lastResult: "good",
  lastReviewedAtMs: now - 2 * DAY_MS,
  nextReviewAtMs: now + 5 * DAY_MS,
};
const migrated = migrateLegacyProgress(legacy, now);
assert.strictEqual(migrated.algorithmVersion, ALGORITHM_VERSION);
assert.strictEqual(migrated.migratedFromAlgorithmVersion, "legacy-v1");
assert.strictEqual(migrated.reviewCount, 4, "Migration must preserve historical review count");
assert.strictEqual(migrated.lastReviewedAtMs, legacy.lastReviewedAtMs);
assert.strictEqual(migrated.nextReviewAtMs, legacy.nextReviewAtMs);
assert(migrated.stabilityDays > 0);

const adaptiveAgain = migrateLegacyProgress(migrated, now);
assert.strictEqual(adaptiveAgain.migratedFromAlgorithmVersion, "legacy-v1");
assert.strictEqual(adaptiveAgain.algorithmVersion, ALGORITHM_VERSION);

const corrupt = migrateLegacyProgress({
  algorithmVersion: ALGORITHM_VERSION,
  reviewCount: 2,
  successfulReviews: 99,
  lapses: 99,
  state: "finished-forever",
  stabilityDays: 1e308,
  currentIntervalDays: Infinity,
  lastReviewedAtMs: now,
}, NaN);
assert.strictEqual(corrupt.successfulReviews, 2);
assert.strictEqual(corrupt.lapses, 2);
assert.strictEqual(corrupt.state, "review");
assert.strictEqual(corrupt.stabilityDays, 3650);
assert(Number.isFinite(corrupt.currentIntervalDays));
const safeSchedule = scheduleReview(corrupt, "good", NaN);
assert(Number.isFinite(safeSchedule.nextReviewAtMs));
assert(Number.isFinite(safeSchedule.currentIntervalDays));

const ordinaryBase = scheduleReview(scheduleReview(null, "good", now), "good", now + DAY_MS);
const ordinarySchedules = ["again", "hard", "good", "easy"].map((rating) => (
  scheduleReview(ordinaryBase, rating, now + 2 * DAY_MS)
));
assert.deepStrictEqual(
  ordinarySchedules.map((item) => item.nextReviewAtMs),
  ordinarySchedules.map((item) => item.nextReviewAtMs).slice().sort((a, b) => a - b),
  "Mature Again/Hard/Good/Easy schedules must remain progressively longer"
);

console.log("frenchReviewEngine.test.js: passed");
