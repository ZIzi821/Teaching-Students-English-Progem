const { ALGORITHM_VERSION, DAY_MS } = require("./englishMemoryScheduler");

const MIN_EVALUATION_SAMPLE = 20;
const MIN_UNIQUE_WORDS = 5;
const RECOMMENDED_SAMPLE = 50;
const HISTORY_LIMIT_PER_WORD = 30;
const CALIBRATION_BIN_COUNT = 5;
const FUTURE_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;
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

const buildMemoryEvaluation = (progressItems, nowMs = Date.now()) => {
  const safeNowMs = Math.max(0, asFiniteNumber(nowMs, Date.now()));
  const events = [];
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

      events.push({
        wordKey,
        reviewedAtMs,
        rating,
        source,
        objective: isObjectiveSource(source),
        predicted,
        outcome: SUCCESS_RATINGS.has(rating) ? 1 : 0,
      });
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
  HISTORY_LIMIT_PER_WORD,
  MIN_EVALUATION_SAMPLE,
  MIN_UNIQUE_WORDS,
  RECOMMENDED_SAMPLE,
  buildMemoryEvaluation,
  summarizeEvents,
};
