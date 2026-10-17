const assert = require("assert");
const {
  MIN_EVALUATION_SAMPLE,
  buildMemoryEvaluation,
} = require("../englishMemoryAnalytics");
const { ALGORITHM_VERSION, DAY_MS } = require("../englishMemoryScheduler");

const now = Date.UTC(2026, 9, 18, 8, 0, 0);
const event = ({ predicted, rating, source = "self_rating", daysAgo = 1, stateBefore = "review" }) => ({
  algorithmVersion: ALGORITHM_VERSION,
  reviewedAtMs: now - daysAgo * DAY_MS,
  rating,
  source,
  stateBefore,
  stabilityBeforeDays: stateBefore === "new" ? 0 : 2,
  retrievabilityBefore: predicted,
});

const basic = buildMemoryEvaluation([
  {
    wordKey: "apple",
    algorithmVersion: ALGORITHM_VERSION,
    reviewHistory: [
      event({ predicted: 0, rating: "known", stateBefore: "new" }),
      event({ predicted: 0.9, rating: "known", daysAgo: 3 }),
      event({ predicted: 0.7, rating: "forgot", source: "quiz_input_wrong", daysAgo: 2 }),
    ],
  },
  {
    wordKey: "book",
    algorithmVersion: ALGORITHM_VERSION,
    reviewHistory: [
      event({ predicted: 0.8, rating: "hard", daysAgo: 1 }),
      event({ predicted: 0.2, rating: "forgot", source: "quiz_choice_wrong", daysAgo: 0 }),
      Object.assign(event({ predicted: 0.5, rating: "known" }), {
        algorithmVersion: "future-algorithm",
      }),
      event({ predicted: 3, rating: "known" }),
      Object.assign(event({ predicted: 0.5, rating: "known" }), {
        reviewedAtMs: 0,
      }),
    ],
  },
  {
    wordKey: "legacy",
    algorithmVersion: "",
    reviewHistory: [Object.assign(event({ predicted: 0.5, rating: "known" }), {
      algorithmVersion: undefined,
    })],
  },
], now);

assert.strictEqual(basic.sampleSize, 4);
assert.strictEqual(basic.successCount, 2);
assert.strictEqual(basic.failureCount, 2);
assert.strictEqual(basic.predictedRetentionPercent, 65);
assert.strictEqual(basic.actualRecallPercent, 50);
assert.strictEqual(basic.calibrationGapPoints, -15);
assert.strictEqual(basic.brierScore, 0.145);
assert.strictEqual(basic.excludedColdStartCount, 1);
assert.strictEqual(basic.excludedOtherVersionCount, 2);
assert.strictEqual(basic.excludedInvalidCount, 2);
assert.strictEqual(basic.uniqueWordCount, 2);
assert.strictEqual(basic.objectiveEvidenceCount, 2);
assert.strictEqual(basic.status.key, "collecting");
assert.strictEqual(basic.remainingToFirstEvaluation, MIN_EVALUATION_SAMPLE - 4);
assert.strictEqual(basic.calibrationBins.reduce((sum, item) => sum + item.sampleSize, 0), 4);
assert.strictEqual(basic.sourceBreakdown.reduce((sum, item) => sum + item.sampleSize, 0), 4);
assert.strictEqual(basic.recentSevenDays.sampleSize, 4);

const calibratedEvents = Array.from({ length: MIN_EVALUATION_SAMPLE }, (_, index) => (
  event({
    predicted: 0.8,
    rating: index < 16 ? "known" : "forgot",
    source: index < 5 ? "quiz_input" : "self_rating",
    daysAgo: index % 10,
  })
));
const calibrated = buildMemoryEvaluation(Array.from({ length: 5 }, (_, index) => ({
  wordKey: `calibrated-${index}`,
  algorithmVersion: ALGORITHM_VERSION,
  reviewHistory: calibratedEvents.slice(index * 4, index * 4 + 4),
})), now);
assert.strictEqual(calibrated.actualRecallPercent, 80);
assert.strictEqual(calibrated.predictedRetentionPercent, 80);
assert.strictEqual(calibrated.brierScore, 0.16);
assert.strictEqual(calibrated.status.key, "initially_stable");

const optimisticEvents = Array.from({ length: MIN_EVALUATION_SAMPLE }, (_, index) => (
    event({ predicted: 0.9, rating: index % 2 ? "known" : "forgot", daysAgo: index % 6 })
));
const optimistic = buildMemoryEvaluation(Array.from({ length: 5 }, (_, index) => ({
  wordKey: `optimistic-${index}`,
  algorithmVersion: ALGORITHM_VERSION,
  reviewHistory: optimisticEvents.slice(index * 4, index * 4 + 4),
})), now);
assert.strictEqual(optimistic.actualRecallPercent, 50);
assert.strictEqual(optimistic.calibrationGapPoints, -40);
assert.strictEqual(optimistic.status.key, "needs_calibration");
assert(optimistic.recommendations.some((item) => item.includes("偏乐观")));

const empty = buildMemoryEvaluation([], now);
assert.strictEqual(empty.sampleSize, 0);
assert.strictEqual(empty.brierScore, null);
assert.strictEqual(empty.calibrationBins.length, 5);
assert.strictEqual(empty.sampleProgressPercent, 0);
assert(empty.recommendations[0].includes("20"));

const oneWordOnly = buildMemoryEvaluation([{
  wordKey: "one-word",
  algorithmVersion: ALGORITHM_VERSION,
  reviewHistory: calibratedEvents,
}], now);
assert.strictEqual(oneWordOnly.status.key, "collecting");
assert.strictEqual(oneWordOnly.remainingUniqueWords, 4);
assert(oneWordOnly.recommendations.some((item) => item.includes("至少覆盖 5 个词")));

console.log("englishMemoryAnalytics.test.js: passed");
