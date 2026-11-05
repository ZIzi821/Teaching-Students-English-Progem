const {
  ALGORITHM_VERSION,
  DAY_MS,
  FORGETTING_CURVE_DECAY,
  FORGETTING_CURVE_FACTOR,
  MAX_MEMORY_FACTOR,
  MIN_MEMORY_FACTOR,
  normalizeMemoryFactor,
} = require("./englishMemoryScheduler");

const MIN_EVALUATION_SAMPLE = 20;
const MIN_UNIQUE_WORDS = 5;
const RECOMMENDED_SAMPLE = 50;
const HISTORY_LIMIT_PER_WORD = 30;
const CALIBRATION_BIN_COUNT = 5;
const FUTURE_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;
// 校准：先把样本收缩到当前系数（样本越少越保守），再限制单次调整幅度。
const CALIBRATION_PRIOR_SAMPLE = 100;
const CALIBRATION_MIN_SAMPLE = 50;
// 预测与实际的差距至少要超过约两个标准误，才认为不是偶然波动。
const CALIBRATION_SIGNIFICANCE_Z = 2;
const CALIBRATION_MAX_STEP = 0.2;
const CALIBRATION_MIN_CHANGE = 0.05;
const CALIBRATION_REVIEW_SAMPLE = 50;
const CALIBRATION_HISTORY_LIMIT = 20;
const CALIBRATION_SEARCH_MIN = 0.5;
const CALIBRATION_SEARCH_MAX = 2;
const CALIBRATION_SEARCH_STEP = 0.01;
const SUCCESS_RATINGS = new Set(["hard", "known", "easy"]);
const VALID_RATINGS = new Set(["forgot", "hard", "known", "easy"]);

const SOURCE_LABELS = {
  self_rating: "学生自评",
  quiz_input: "主动拼写正确",
  quiz_input_wrong: "主动拼写答错",
  quiz_choice_wrong: "选择题答错",
};

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const round = (value, digits = 3) => {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
};
const asFiniteNumber = (value, fallback = null) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const asTimestamp = (value) => Math.max(0, asFiniteNumber(value, 0));
const asPercent = (value) => Math.round(clamp(value, 0, 1) * 100);

const getSourceKey = (value) => {
  const source = String(value || "unknown").toLowerCase().slice(0, 30);
  return SOURCE_LABELS[source] ? source : "other";
};

const getSourceLabel = (sourceKey) => SOURCE_LABELS[sourceKey] || "其他反馈";

const isObjectiveSource = (value) => String(value || "").toLowerCase().startsWith("quiz_");

const summarizeEvents = (events) => {
  const sampleSize = events.length;
  if (!sampleSize) {
    return {
      sampleSize: 0,
      successCount: 0,
      failureCount: 0,
      predictedRetentionPercent: null,
      actualRecallPercent: null,
      calibrationGapPoints: null,
      absoluteGapPoints: null,
      brierScore: null,
      logLoss: null,
    };
  }

  const totals = events.reduce((result, event) => {
    const outcome = event.outcome;
    const predicted = event.predicted;
    const clipped = clamp(predicted, 0.01, 0.99);
    result.successCount += outcome;
    result.predicted += predicted;
    result.brier += (predicted - outcome) ** 2;
    result.logLoss += -(outcome * Math.log(clipped) + (1 - outcome) * Math.log(1 - clipped));
    return result;
  }, {
    successCount: 0,
    predicted: 0,
    brier: 0,
    logLoss: 0,
  });
  const actual = totals.successCount / sampleSize;
  const predicted = totals.predicted / sampleSize;
  const gapPoints = (actual - predicted) * 100;

  return {
    sampleSize,
    successCount: totals.successCount,
    failureCount: sampleSize - totals.successCount,
    predictedRetentionPercent: asPercent(predicted),
    actualRecallPercent: asPercent(actual),
    calibrationGapPoints: round(gapPoints, 1),
    absoluteGapPoints: round(Math.abs(gapPoints), 1),
    brierScore: round(totals.brier / sampleSize, 3),
    logLoss: round(totals.logLoss / sampleSize, 3),
  };
};

const buildCalibrationBins = (events) => {
  const bins = Array.from({ length: CALIBRATION_BIN_COUNT }, (_, index) => ({
    index,
    events: [],
  }));
  events.forEach((event) => {
    const binIndex = Math.min(
      CALIBRATION_BIN_COUNT - 1,
      Math.floor(event.predicted * CALIBRATION_BIN_COUNT)
    );
    bins[binIndex].events.push(event);
  });

  return bins.map((bin) => {
    const lower = bin.index * 20;
    const upper = bin.index === CALIBRATION_BIN_COUNT - 1 ? 100 : lower + 19;
    const summary = summarizeEvents(bin.events);
    return Object.assign({}, summary, {
      key: `retention-${lower}`,
      label: `${lower}–${upper}%`,
      hasSample: summary.sampleSize > 0,
      predictedBarPercent: summary.predictedRetentionPercent || 0,
      actualBarPercent: summary.actualRecallPercent || 0,
    });
  });
};

const buildSourceBreakdown = (events) => {
  const groups = new Map();
  events.forEach((event) => {
    const sourceKey = getSourceKey(event.source);
    if (!groups.has(sourceKey)) groups.set(sourceKey, []);
    groups.get(sourceKey).push(event);
  });
  return Array.from(groups.entries())
    .map(([sourceKey, sourceEvents]) => Object.assign(summarizeEvents(sourceEvents), {
      key: sourceKey,
      label: getSourceLabel(sourceKey),
      objective: sourceEvents.some((event) => event.objective),
    }))
    .sort((left, right) => right.sampleSize - left.sampleSize || left.key.localeCompare(right.key));
};

const buildRecommendations = ({
  summary,
  uniqueWordCount,
  objectiveEvidenceCount,
  objectiveEvidencePercent,
}) => {
  const recommendations = [];
  if (summary.sampleSize < MIN_EVALUATION_SAMPLE) {
    recommendations.push(
      `还需要 ${MIN_EVALUATION_SAMPLE - summary.sampleSize} 次可评估复习，达到首轮判断门槛。`
    );
  } else if (summary.sampleSize < RECOMMENDED_SAMPLE) {
    recommendations.push(`已可做初步判断；继续收集到 ${RECOMMENDED_SAMPLE} 次后再考虑调整参数。`);
  }

  if (uniqueWordCount < MIN_UNIQUE_WORDS) {
    recommendations.push(`当前只覆盖 ${uniqueWordCount} 个单词；至少覆盖 ${MIN_UNIQUE_WORDS} 个词后再做首轮判断。`);
  }

  if (summary.sampleSize > 0 && (objectiveEvidenceCount < 5 || objectiveEvidencePercent < 25)) {
    recommendations.push("当前证据以学生自评为主，建议增加拼写等主动回忆题，降低主观偏差。");
  }

  if (summary.sampleSize >= MIN_EVALUATION_SAMPLE && summary.calibrationGapPoints <= -10) {
    recommendations.push("实际回忆率低于预测，算法可能偏乐观；优先检查是否需要缩短复习间隔。");
  } else if (summary.sampleSize >= MIN_EVALUATION_SAMPLE && summary.calibrationGapPoints >= 10) {
    recommendations.push("实际回忆率高于预测，算法可能偏保守；可观察是否存在过度复习。");
  }

  if (summary.sampleSize >= MIN_EVALUATION_SAMPLE && summary.brierScore > 0.2) {
    recommendations.push("单次预测误差仍较大，先按反馈来源和保持率区间定位偏差，再决定参数调整范围。");
  }

  if (!recommendations.length) {
    recommendations.push("当前预测与反馈初步接近，保持现有参数并继续积累新证据。");
  }
  return recommendations;
};

// 由事件记录的预测保持率和当时的系数，反推“距上次复习的天数 / 原始稳定天数”。
const getBaseElapsedRatio = (event) => {
  const retrievability = clamp(event.predicted, 0.001, 0.9999);
  return event.memoryFactor * (Math.pow(retrievability, -1 / -FORGETTING_CURVE_DECAY) - 1) / FORGETTING_CURVE_FACTOR;
};

const predictWithFactor = (event, memoryFactor) => clamp(
  Math.pow(1 + FORGETTING_CURVE_FACTOR * event.baseElapsedRatio / memoryFactor, FORGETTING_CURVE_DECAY),
  0,
  1
);

const scoreFactor = (events, memoryFactor) => {
  let logLoss = 0;
  let predictedTotal = 0;
  events.forEach((event) => {
    const predicted = predictWithFactor(event, memoryFactor);
    const clipped = clamp(predicted, 0.01, 0.99);
    predictedTotal += predicted;
    logLoss += -(event.outcome * Math.log(clipped) + (1 - event.outcome) * Math.log(1 - clipped));
  });
  return {
    logLoss: events.length ? logLoss / events.length : 0,
    predictedRetention: events.length ? predictedTotal / events.length : 0,
  };
};

const fitMemoryFactor = (events) => {
  let best = { factor: 1, logLoss: Infinity };
  for (let factor = CALIBRATION_SEARCH_MIN; factor <= CALIBRATION_SEARCH_MAX + 1e-9; factor += CALIBRATION_SEARCH_STEP) {
    const { logLoss } = scoreFactor(events, factor);
    if (logLoss < best.logLoss) best = { factor: round(factor, 2), logLoss };
  }
  return best.factor;
};

const normalizeCalibrationRecord = (calibration) => {
  const source = calibration || {};
  return {
    factor: normalizeMemoryFactor(source.factor),
    appliedAtMs: asTimestamp(source.appliedAtMs),
    previousFactor: normalizeMemoryFactor(source.previousFactor),
    history: Array.isArray(source.history) ? source.history.slice(-CALIBRATION_HISTORY_LIMIT) : [],
  };
};

const buildCalibrationSuggestion = ({ events, summary, hasEnoughSample, calibration }) => {
  const currentFactor = calibration.factor;
  const applied = calibration.appliedAtMs > 0 && calibration.history.length > 0;
  const base = {
    currentFactor,
    applied,
    appliedAtMs: calibration.appliedAtMs,
    history: calibration.history,
    sampleSinceCalibration: summary.sampleSize,
    reviewReady: applied && summary.sampleSize >= CALIBRATION_REVIEW_SAMPLE,
    isDefault: currentFactor === 1,
    suggestedFactor: currentFactor,
    changePercent: 0,
    canApply: false,
    previewPredictedPercent: null,
    previewGapPoints: null,
  };
  if (!hasEnoughSample || summary.sampleSize < CALIBRATION_MIN_SAMPLE) {
    return Object.assign(base, { reason: "collecting", minSample: CALIBRATION_MIN_SAMPLE });
  }
  const actualRate = summary.successCount / summary.sampleSize;
  const predictedRate = events.reduce((sum, event) => sum + event.predicted, 0) / summary.sampleSize;
  const standardError = Math.sqrt(Math.max(0.0001, predictedRate * (1 - predictedRate)) / summary.sampleSize);
  if (Math.abs(actualRate - predictedRate) < CALIBRATION_SIGNIFICANCE_Z * standardError) {
    return Object.assign(base, {
      reason: "not_significant",
      minSample: CALIBRATION_MIN_SAMPLE,
      requiredGapPoints: round(CALIBRATION_SIGNIFICANCE_Z * standardError * 100, 1),
    });
  }
  const fitted = fitMemoryFactor(events);
  const weight = summary.sampleSize / (summary.sampleSize + CALIBRATION_PRIOR_SAMPLE);
  const shrunk = currentFactor * Math.pow(fitted / currentFactor, weight);
  const stepped = clamp(
    shrunk,
    currentFactor * (1 - CALIBRATION_MAX_STEP),
    currentFactor * (1 + CALIBRATION_MAX_STEP)
  );
  const suggestedFactor = round(clamp(stepped, MIN_MEMORY_FACTOR, MAX_MEMORY_FACTOR), 2);
  const changePercent = Math.round((suggestedFactor / currentFactor - 1) * 100);
  const currentScore = scoreFactor(events, currentFactor);
  const suggestedScore = scoreFactor(events, suggestedFactor);
  // 方向必须与实际偏差一致：实际记住更多才延长间隔，反之缩短。
  const sameDirection = (actualRate - predictedRate) * (suggestedFactor - currentFactor) > 0;
  const improves = sameDirection && suggestedScore.logLoss < currentScore.logLoss;
  return Object.assign(base, {
    fittedFactor: fitted,
    suggestedFactor,
    changePercent,
    canApply: improves && Math.abs(suggestedFactor / currentFactor - 1) >= CALIBRATION_MIN_CHANGE,
    reason: improves ? "ready" : "already_best",
    previewPredictedPercent: asPercent(suggestedScore.predictedRetention),
    previewGapPoints: round((actualRate - suggestedScore.predictedRetention) * 100, 1),
  });
};

const buildMemoryEvaluation = (progressItems, nowMs = Date.now(), calibrationRecord = null) => {
  const safeNowMs = Math.max(0, asFiniteNumber(nowMs, Date.now()));
  const calibration = normalizeCalibrationRecord(calibrationRecord);
  const events = [];
  let excludedBeforeCalibrationCount = 0;
  let historyEventCount = 0;
  let retainedWordCount = 0;
  let excludedColdStartCount = 0;
  let excludedInvalidCount = 0;
  let excludedOtherVersionCount = 0;

  (Array.isArray(progressItems) ? progressItems : []).forEach((progress, progressIndex) => {
    const history = Array.isArray(progress && progress.reviewHistory)
      ? progress.reviewHistory.slice(-HISTORY_LIMIT_PER_WORD)
      : [];
    if (history.length) retainedWordCount += 1;
    historyEventCount += history.length;
    const wordKey = String(progress && progress.wordKey || `word-${progressIndex}`).slice(0, 80);
    const progressVersion = String(progress && progress.algorithmVersion || "");

    history.forEach((event) => {
      const source = String(event && event.source || "unknown").toLowerCase().slice(0, 30);
      const rating = String(event && event.rating || "").toLowerCase();
      const reviewedAtMs = asTimestamp(event && event.reviewedAtMs);
      const predicted = asFiniteNumber(event && event.retrievabilityBefore);
      const stabilityBeforeDays = asFiniteNumber(event && event.stabilityBeforeDays, 0);
      const stateBefore = String(event && event.stateBefore || "");
      const eventVersion = String(event && event.algorithmVersion || progressVersion || "");

      if (eventVersion !== ALGORITHM_VERSION) {
        excludedOtherVersionCount += 1;
        return;
      }
      if (stateBefore === "new" || stabilityBeforeDays <= 0) {
        excludedColdStartCount += 1;
        return;
      }
      if (calibration.appliedAtMs && reviewedAtMs > 0 && reviewedAtMs < calibration.appliedAtMs) {
        excludedBeforeCalibrationCount += 1;
        return;
      }
      if (
        !VALID_RATINGS.has(rating)
        || reviewedAtMs <= 0
        || reviewedAtMs > safeNowMs + FUTURE_TIMESTAMP_TOLERANCE_MS
        || predicted === null
        || predicted < 0
        || predicted > 1
      ) {
        excludedInvalidCount += 1;
        return;
      }

      const memoryFactor = normalizeMemoryFactor(event && event.memoryFactor);
      const reviewEvent = {
        wordKey,
        reviewedAtMs,
        rating,
        source,
        objective: isObjectiveSource(source),
        predicted,
        memoryFactor,
        outcome: SUCCESS_RATINGS.has(rating) ? 1 : 0,
      };
      reviewEvent.baseElapsedRatio = getBaseElapsedRatio(reviewEvent);
      events.push(reviewEvent);
    });
  });

  events.sort((left, right) => left.reviewedAtMs - right.reviewedAtMs);
  const summary = summarizeEvents(events);
  const objectiveEvidenceCount = events.filter((event) => event.objective).length;
  const objectiveEvidencePercent = summary.sampleSize
    ? Math.round(objectiveEvidenceCount / summary.sampleSize * 100)
    : 0;
  const uniqueWordCount = new Set(events.map((event) => event.wordKey)).size;
  const recentSevenDays = summarizeEvents(events.filter((event) => (
    event.reviewedAtMs > 0
      && event.reviewedAtMs <= safeNowMs
      && event.reviewedAtMs >= safeNowMs - 7 * DAY_MS
  )));
  const recentThirtyDays = summarizeEvents(events.filter((event) => (
    event.reviewedAtMs > 0
      && event.reviewedAtMs <= safeNowMs
      && event.reviewedAtMs >= safeNowMs - 30 * DAY_MS
  )));
  const hasEnoughSample = summary.sampleSize >= MIN_EVALUATION_SAMPLE
    && uniqueWordCount >= MIN_UNIQUE_WORDS;
  const needsCalibration = hasEnoughSample && (
    summary.absoluteGapPoints > 10 || summary.brierScore > 0.2
  );
  const status = !hasEnoughSample
    ? { key: "collecting", label: "收集中", tone: "collecting" }
    : needsCalibration
      ? { key: "needs_calibration", label: "需要校准", tone: "attention" }
      : { key: "initially_stable", label: "初步稳定", tone: "stable" };
  const firstObservedAtMs = events.find((event) => event.reviewedAtMs > 0);
  const lastObservedAtMs = events.slice().reverse().find((event) => event.reviewedAtMs > 0);

  return Object.assign({}, summary, {
    algorithmVersion: ALGORITHM_VERSION,
    generatedAtMs: safeNowMs,
    status,
    sampleTarget: MIN_EVALUATION_SAMPLE,
    uniqueWordTarget: MIN_UNIQUE_WORDS,
    recommendedSample: RECOMMENDED_SAMPLE,
    sampleProgressPercent: Math.min(100, Math.round(Math.min(
      summary.sampleSize / MIN_EVALUATION_SAMPLE,
      uniqueWordCount / MIN_UNIQUE_WORDS
    ) * 100)),
    remainingToFirstEvaluation: Math.max(0, MIN_EVALUATION_SAMPLE - summary.sampleSize),
    remainingUniqueWords: Math.max(0, MIN_UNIQUE_WORDS - uniqueWordCount),
    progressDocumentCount: Array.isArray(progressItems) ? progressItems.length : 0,
    retainedWordCount,
    uniqueWordCount,
    historyEventCount,
    excludedColdStartCount,
    excludedInvalidCount,
    excludedOtherVersionCount,
    excludedBeforeCalibrationCount,
    calibration: buildCalibrationSuggestion({ events, summary, hasEnoughSample, calibration }),
    objectiveEvidenceCount,
    objectiveEvidencePercent,
    firstObservedAtMs: firstObservedAtMs ? firstObservedAtMs.reviewedAtMs : 0,
    lastObservedAtMs: lastObservedAtMs ? lastObservedAtMs.reviewedAtMs : 0,
    calibrationBins: buildCalibrationBins(events),
    sourceBreakdown: buildSourceBreakdown(events),
    recentSevenDays,
    recentThirtyDays,
    recommendations: buildRecommendations({
      summary,
      uniqueWordCount,
      objectiveEvidenceCount,
      objectiveEvidencePercent,
    }),
    outcomeDefinition: "没记住记为 0；有点难、记住了、太简单记为 1。首次学习不参与校准。",
    samplingNote: "评估已发生且保留的复习反馈；每个单词取最近 30 次，用于检查预测校准。",
    evidenceNote: "选择题用于小测分析；主动拼写为记忆调度提供更强证据。",
    scoreNote: "Brier Score 越接近 0，模型概率预测与实际反馈越一致；该指标用于评估记忆调度算法。",
  });
};

module.exports = {
  CALIBRATION_BIN_COUNT,
  CALIBRATION_HISTORY_LIMIT,
  CALIBRATION_MAX_STEP,
  CALIBRATION_MIN_SAMPLE,
  CALIBRATION_REVIEW_SAMPLE,
  fitMemoryFactor,
  HISTORY_LIMIT_PER_WORD,
  MIN_EVALUATION_SAMPLE,
  MIN_UNIQUE_WORDS,
  RECOMMENDED_SAMPLE,
  buildMemoryEvaluation,
  summarizeEvents,
};
