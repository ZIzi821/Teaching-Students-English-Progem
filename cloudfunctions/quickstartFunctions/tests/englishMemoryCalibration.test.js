const assert = require("assert");
const {
  CALIBRATION_MAX_STEP,
  buildMemoryEvaluation,
  fitMemoryFactor,
} = require("../englishMemoryAnalytics");
const {
  ALGORITHM_VERSION,
  DAY_MS,
  FORGETTING_CURVE_DECAY,
  FORGETTING_CURVE_FACTOR,
  getStudentMemoryFactor,
  normalizeMemoryFactor,
  scheduleReview,
} = require("../englishMemoryScheduler");

const now = Date.UTC(2026, 10, 6, 8, 0, 0);

// 可重复的伪随机数，保证测试结果稳定。
const createRandom = (seed) => {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
};

// 按“真实系数”生成复习记录：预测按 recordedFactor 计算，结果按 trueFactor 抽样。
const buildProgressItems = ({ trueFactor, recordedFactor = 1, count, seed, startMs = now - 30 * DAY_MS }) => {
  const random = createRandom(seed);
  const items = [];
  for (let index = 0; index < count; index += 1) {
    const elapsedRatio = 0.2 + random() * 6;
    const predicted = Math.pow(1 + FORGETTING_CURVE_FACTOR * elapsedRatio / recordedFactor, FORGETTING_CURVE_DECAY);
    const truth = Math.pow(1 + FORGETTING_CURVE_FACTOR * elapsedRatio / trueFactor, FORGETTING_CURVE_DECAY);
    items.push({
      wordKey: `word-${index % 25}-${index}`,
      algorithmVersion: ALGORITHM_VERSION,
      reviewHistory: [{
        algorithmVersion: ALGORITHM_VERSION,
        reviewedAtMs: startMs + index * 60 * 1000,
        rating: random() < truth ? "known" : "forgot",
        source: "self_rating",
        stateBefore: "review",
        stabilityBeforeDays: 3,
        retrievabilityBefore: Number(predicted.toFixed(4)),
        memoryFactor: recordedFactor,
      }],
    });
  }
  return items;
};

const eventsOf = (items) => items.map((item) => {
  const event = item.reviewHistory[0];
  const predicted = event.retrievabilityBefore;
  return {
    predicted,
    memoryFactor: event.memoryFactor,
    outcome: event.rating === "forgot" ? 0 : 1,
    baseElapsedRatio: event.memoryFactor * (Math.pow(predicted, -2) - 1) / FORGETTING_CURVE_FACTOR,
  };
});

// 1. 数据足够多时，拟合能找回真实系数。
[0.8, 1, 1.3].forEach((trueFactor) => {
  const fitted = fitMemoryFactor(eventsOf(buildProgressItems({ trueFactor, count: 4000, seed: 7 })));
  assert(Math.abs(fitted - trueFactor) <= 0.08, `fit ${fitted} should recover ${trueFactor}`);
});

// 2. 数据偏少时，建议值靠近当前系数，并受单次 20% 限制。
const strongSignal = buildMemoryEvaluation(buildProgressItems({ trueFactor: 2, count: 400, seed: 11 }), now);
assert.strictEqual(strongSignal.calibration.currentFactor, 1);
assert(strongSignal.calibration.canApply, "a clear signal should be applicable");
assert(strongSignal.calibration.suggestedFactor <= 1 + CALIBRATION_MAX_STEP + 1e-9, "single step must stay within 20%");
assert(strongSignal.calibration.previewPredictedPercent > strongSignal.predictedRetentionPercent, "longer intervals predict higher recall");

const smallSample = buildMemoryEvaluation(buildProgressItems({ trueFactor: 1.3, count: 25, seed: 3 }), now);
const largeSample = buildMemoryEvaluation(buildProgressItems({ trueFactor: 1.3, count: 1500, seed: 3 }), now);
assert(
  Math.abs(smallSample.calibration.suggestedFactor - 1) <= Math.abs(largeSample.calibration.suggestedFactor - 1) + 1e-9,
  "fewer samples must be shrunk closer to the current factor"
);

// 2b. 样本少、差距可能是偶然波动时，不给出任何调整（避免方向调反）。
[3, 7, 11, 19, 23].forEach((seed) => {
  const noisy = buildMemoryEvaluation(buildProgressItems({ trueFactor: 1.4, count: 60, seed }), now);
  const suggestion = noisy.calibration;
  if (suggestion.canApply) {
    assert(suggestion.suggestedFactor > 1, `seed ${seed}: an applicable suggestion must follow the observed direction`);
  } else {
    assert(["not_significant", "already_best"].includes(suggestion.reason), `seed ${seed}: unexpected reason ${suggestion.reason}`);
  }
});

// 3. 已经合适时不建议调整。
const balanced = buildMemoryEvaluation(buildProgressItems({ trueFactor: 1, count: 1500, seed: 5 }), now);
assert.strictEqual(balanced.calibration.canApply, false, "no change when the current factor already fits");

// 4. 数据不足时只收集，不给建议。
const collecting = buildMemoryEvaluation(buildProgressItems({ trueFactor: 1.4, count: 5, seed: 9 }), now);
assert.strictEqual(collecting.calibration.reason, "collecting");
assert.strictEqual(collecting.calibration.canApply, false);

// 5. 校准后只评估之后的记录，并按当时记录的系数还原。
const appliedAtMs = now - 10 * DAY_MS;
const mixed = buildProgressItems({ trueFactor: 1.2, count: 60, seed: 13, startMs: now - 20 * DAY_MS })
  .concat(buildProgressItems({ trueFactor: 1.2, recordedFactor: 1.2, count: 50, seed: 17, startMs: appliedAtMs + DAY_MS }));
const afterCalibration = buildMemoryEvaluation(mixed, now, {
  factor: 1.2,
  appliedAtMs,
  previousFactor: 1,
  history: [{ action: "apply", factor: 1.2, previousFactor: 1, appliedAtMs }],
});
assert.strictEqual(afterCalibration.sampleSize, 50, "only post-calibration feedback is evaluated");
assert.strictEqual(afterCalibration.excludedBeforeCalibrationCount, 60);
assert.strictEqual(afterCalibration.calibration.currentFactor, 1.2);
assert.strictEqual(afterCalibration.calibration.applied, true);
assert.strictEqual(afterCalibration.calibration.reviewReady, true);

// 6. 调度器：系数限制在 0.7–1.5，学生资料缺省为 1；系数影响间隔但不改动保存的稳定天数。
assert.strictEqual(normalizeMemoryFactor(3), 1.5);
assert.strictEqual(normalizeMemoryFactor(0.2), 0.7);
assert.strictEqual(normalizeMemoryFactor("abc"), 1);
assert.strictEqual(getStudentMemoryFactor({}), 1);
assert.strictEqual(getStudentMemoryFactor({ englishMemoryCalibration: { factor: 1.25 } }), 1.25);
let base = null;
let scaled = null;
["known", "known", "known"].forEach((rating, index) => {
  base = scheduleReview(base, rating, now + index * 3 * DAY_MS);
  scaled = scheduleReview(scaled, rating, now + index * 3 * DAY_MS, { memoryFactor: 1.3 });
});
assert(scaled.currentIntervalDays > base.currentIntervalDays, "a higher factor lengthens intervals");
assert.strictEqual(scaled.reviewHistory[scaled.reviewHistory.length - 1].memoryFactor, 1.3);
const forgotBase = scheduleReview(base, "forgot", now + 30 * DAY_MS);
const forgotScaled = scheduleReview(base, "forgot", now + 30 * DAY_MS, { memoryFactor: 1.5 });
assert.strictEqual(forgotScaled.currentIntervalDays, forgotBase.currentIntervalDays, "forgotten words still return after 10 minutes");

console.log("englishMemoryCalibration.test.js: passed");
