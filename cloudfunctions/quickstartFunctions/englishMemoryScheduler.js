const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const ALGORITHM_VERSION = "english-adaptive-v1";
const LEGACY_ALGORITHM_VERSION = "fixed-stage-v1";
const TARGET_RETENTION = 0.9;
const MAX_HISTORY_ITEMS = 30;
const RATINGS = new Set(["forgot", "hard", "known", "easy"]);
const VALID_STATES = new Set(["new", "learning", "review", "mastered"]);

// stabilityDays means the estimated number of days until recall falls to 90%.
// The value is a scheduling estimate, not a test score or diagnosis.
const FORGETTING_CURVE_FACTOR = 19 / 81;
const FORGETTING_CURVE_DECAY = -0.5;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const round = (value, digits = 3) => {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
};
const normalizeNowMs = (value) => Math.max(0, asNumber(value, Date.now()));

const normalizeRating = (value) => {
  const rating = String(value || "").toLowerCase();
  if (RATINGS.has(rating)) return rating;
  if (rating === "again" || rating === "quizwrong") return "forgot";
  if (rating === "good" || rating === "quizcorrect") return "known";
  return "";
};

const getRetrievability = (progress, nowMs = Date.now()) => {
  const source = progress || {};
  const safeNowMs = normalizeNowMs(nowMs);
  const lastReviewedAtMs = Math.max(0, asNumber(source.lastReviewedAtMs));
  const stabilityDays = clamp(asNumber(source.stabilityDays), 0, 3650);
  if (!lastReviewedAtMs || !stabilityDays) return 0;
  const elapsedDays = Math.max(0, (safeNowMs - lastReviewedAtMs) / DAY_MS);
  return clamp(
    Math.pow(1 + FORGETTING_CURVE_FACTOR * (elapsedDays / stabilityDays), FORGETTING_CURVE_DECAY),
    0,
    1
  );
};

const legacyStageToStability = (stage) => {
  const stages = [0.2, 1, 3, 7, 14, 30];
  return stages[clamp(Math.round(asNumber(stage)), 0, stages.length - 1)];
};

const deriveState = ({ reviewCount, successfulReviews, stabilityDays, lapses, rating }) => {
  if (!reviewCount) return "new";
  if (rating === "forgot" || successfulReviews < 2 || stabilityDays < 1) return "learning";
  if (successfulReviews >= 5 && stabilityDays >= 30 && lapses <= Math.max(1, reviewCount * 0.2)) {
    return "mastered";
  }
  return "review";
};

const createEmptyProgress = () => ({
  algorithmVersion: ALGORITHM_VERSION,
  state: "new",
  repetitions: 0,
  successfulReviews: 0,
  lapses: 0,
  hardCount: 0,
  difficulty: 5,
  stabilityDays: 0,
  retrievability: 0,
  currentIntervalDays: 0,
  reviewCount: 0,
  lastRating: "",
  lastReviewedAtMs: 0,
  nextReviewAtMs: 0,
  reviewHistory: [],
});

const migrateLegacyProgress = (progress, nowMs = Date.now()) => {
  const source = progress || {};
  const safeNowMs = normalizeNowMs(nowMs);
  const reviewCount = Math.max(0, Math.round(asNumber(source.reviewCount)));
  const lastRating = normalizeRating(source.lastRating || source.lastResult);
  const fallbackLapses = Math.min(reviewCount, Math.max(
    lastRating === "forgot" && reviewCount ? 1 : 0,
    Math.round(asNumber(source.wrongCount))
  ));
  const lapses = clamp(Math.round(asNumber(source.lapses, fallbackLapses)), 0, reviewCount);
  const successfulReviews = clamp(
    Math.round(asNumber(source.successfulReviews, reviewCount - lapses)),
    0,
    reviewCount
  );
  const lastReviewedAtMs = Math.max(0, asNumber(source.lastReviewedAtMs));
  const nextReviewAtMs = Math.max(0, asNumber(source.nextReviewAtMs));
  const legacyIntervalDays = lastReviewedAtMs && nextReviewAtMs > lastReviewedAtMs
    ? (nextReviewAtMs - lastReviewedAtMs) / DAY_MS
    : legacyStageToStability(source.stage);
  const stabilityDays = clamp(
    asNumber(source.stabilityDays, reviewCount ? legacyIntervalDays : 0),
    reviewCount ? 0.03 : 0,
    3650
  );
  const difficulty = clamp(asNumber(source.difficulty, 5), 1, 10);
  const currentIntervalDays = clamp(
    asNumber(source.currentIntervalDays, reviewCount ? legacyIntervalDays : 0),
    0,
    4200
  );
  const state = VALID_STATES.has(source.state)
    ? source.state
    : deriveState({ reviewCount, successfulReviews, stabilityDays, lapses, rating: lastRating });
  const wasAdaptive = source.algorithmVersion === ALGORITHM_VERSION;
  const migrated = {
    algorithmVersion: ALGORITHM_VERSION,
    state,
    repetitions: Math.max(0, Math.round(asNumber(source.repetitions, successfulReviews))),
    successfulReviews,
    lapses,
    hardCount: Math.max(0, Math.round(asNumber(
      source.hardCount,
      lastRating === "hard" && reviewCount ? 1 : 0
    ))),
    difficulty: round(difficulty),
    stabilityDays: round(stabilityDays),
    retrievability: 0,
    currentIntervalDays: round(currentIntervalDays),
    reviewCount,
    lastRating,
    lastReviewedAtMs,
    nextReviewAtMs,
    reviewHistory: Array.isArray(source.reviewHistory)
      ? source.reviewHistory.slice(-MAX_HISTORY_ITEMS)
      : [],
  };
  if (wasAdaptive) {
    if (source.migratedFromAlgorithmVersion) {
      migrated.migratedFromAlgorithmVersion = String(source.migratedFromAlgorithmVersion).slice(0, 40);
    }
  } else {
    migrated.migratedFromAlgorithmVersion = String(
      source.algorithmVersion || LEGACY_ALGORITHM_VERSION
    ).slice(0, 40);
  }
  migrated.retrievability = round(getRetrievability(migrated, safeNowMs), 4);
  return migrated;
};

const normalizeProgress = (progress, nowMs = Date.now()) => (
  progress ? migrateLegacyProgress(progress, nowMs) : createEmptyProgress()
);

const calculateDifficulty = (currentDifficulty, rating) => {
  const changes = { forgot: 1.35, hard: 0.45, known: -0.15, easy: -0.75 };
  const reverted = currentDifficulty + (5 - currentDifficulty) * 0.04;
  return clamp(reverted + changes[rating], 1, 10);
};

const calculateInitialSchedule = (rating) => ({
  forgot: { stabilityDays: 0.08, intervalMinutes: 10 },
  hard: { stabilityDays: 0.35, intervalMinutes: 6 * 60 },
  known: { stabilityDays: 1.2, intervalMinutes: 24 * 60 },
  easy: { stabilityDays: 14, intervalMinutes: 14 * 24 * 60 },
}[rating]);

const calculateReviewSchedule = (current, rating, retrievability) => {
  const stability = Math.max(0.03, current.stabilityDays || 0.03);
  const difficultyFactor = clamp(1.15 - (current.difficulty - 5) * 0.055, 0.65, 1.35);
  const latenessBoost = 1 + Math.max(0, TARGET_RETENTION - retrievability) * 2.2;
  let nextStability;
  let intervalFactor;

  if (rating === "forgot") {
    nextStability = Math.max(0.08, stability * clamp(0.5 - current.difficulty * 0.018, 0.25, 0.48));
    intervalFactor = 0;
  } else if (rating === "hard") {
    nextStability = stability * (1.12 + (1 - retrievability) * 0.22) * Math.min(1, difficultyFactor);
    intervalFactor = 0.65;
  } else if (rating === "known") {
    nextStability = stability * (1.75 + (1 - retrievability) * 1.35) * difficultyFactor * latenessBoost;
    intervalFactor = 1;
  } else {
    nextStability = stability * (2.55 + (1 - retrievability) * 1.7) * difficultyFactor * latenessBoost;
    intervalFactor = 1.15;
  }

  nextStability = clamp(asNumber(nextStability, stability), 0.03, 3650);
  const minimumMinutes = { forgot: 10, hard: 6 * 60, known: 24 * 60, easy: 7 * 24 * 60 }[rating];
  const intervalMinutes = rating === "forgot"
    ? minimumMinutes
    : clamp(
      Math.round(nextStability * intervalFactor * 24 * 60),
      minimumMinutes,
      4200 * 24 * 60
    );
  return { stabilityDays: nextStability, intervalMinutes };
};

const scheduleReview = (progress, rating, nowMs = Date.now(), metadata = {}) => {
  const normalizedRating = normalizeRating(rating);
  if (!RATINGS.has(normalizedRating)) {
    const error = new Error("Invalid English review rating");
    error.code = "INVALID_ENGLISH_REVIEW";
    throw error;
  }

  const safeNowMs = normalizeNowMs(nowMs);
  const current = normalizeProgress(progress, safeNowMs);
  const isFirstReview = current.reviewCount === 0;
  const retrievabilityBefore = isFirstReview ? 0 : getRetrievability(current, safeNowMs);
  const schedule = isFirstReview
    ? calculateInitialSchedule(normalizedRating)
    : calculateReviewSchedule(current, normalizedRating, retrievabilityBefore);
  const difficulty = calculateDifficulty(current.difficulty || 5, normalizedRating);
  const isLapse = normalizedRating === "forgot";
  const isSuccessfulRecall = !isLapse;
  const reviewCount = current.reviewCount + 1;
  const successfulReviews = current.successfulReviews + (isSuccessfulRecall ? 1 : 0);
  const lapses = current.lapses + (isLapse ? 1 : 0);
  const hardCount = current.hardCount + (normalizedRating === "hard" ? 1 : 0);
  const stabilityDays = round(schedule.stabilityDays);
  const currentIntervalDays = round(schedule.intervalMinutes / (24 * 60));
  const nextReviewAtMs = safeNowMs + schedule.intervalMinutes * MINUTE_MS;
  const state = deriveState({
    reviewCount,
    successfulReviews,
    stabilityDays,
    lapses,
    rating: normalizedRating,
  });
  const reviewEvent = {
    algorithmVersion: ALGORITHM_VERSION,
    reviewedAtMs: safeNowMs,
    rating: normalizedRating,
    source: String(metadata.source || "self_rating").slice(0, 30),
    stateBefore: current.state,
    stateAfter: state,
    retrievabilityBefore: round(retrievabilityBefore, 4),
    stabilityBeforeDays: round(current.stabilityDays || 0),
    stabilityAfterDays: stabilityDays,
    difficultyBefore: round(current.difficulty || 5),
    difficultyAfter: round(difficulty),
    intervalDays: currentIntervalDays,
  };

  return Object.assign({}, current, {
    algorithmVersion: ALGORITHM_VERSION,
    state,
    repetitions: current.repetitions + (isSuccessfulRecall ? 1 : 0),
    successfulReviews,
    lapses,
    hardCount,
    difficulty: round(difficulty),
    stabilityDays,
    retrievability: 1,
    currentIntervalDays,
    reviewCount,
    lastRating: normalizedRating,
    lastReviewedAtMs: safeNowMs,
    nextReviewAtMs,
    reviewHistory: current.reviewHistory.concat(reviewEvent).slice(-MAX_HISTORY_ITEMS),
  });
};

const getMemorySnapshot = (progress, nowMs = Date.now()) => {
  const safeNowMs = normalizeNowMs(nowMs);
  const current = normalizeProgress(progress, safeNowMs);
  const retrievability = getRetrievability(current, safeNowMs);
  return {
    algorithmVersion: current.algorithmVersion,
    state: current.state,
    estimatedRetention: round(retrievability, 4),
    estimatedRetentionPercent: current.reviewCount ? Math.round(retrievability * 100) : null,
    lastReviewedAtMs: current.lastReviewedAtMs || 0,
    nextReviewAtMs: current.nextReviewAtMs || 0,
    currentIntervalDays: current.currentIntervalDays || 0,
    stabilityDays: current.stabilityDays || 0,
    difficulty: current.difficulty || 5,
    lapses: current.lapses || 0,
    hardCount: current.hardCount || 0,
    reviewCount: current.reviewCount || 0,
    lastRating: current.lastRating || "",
  };
};

const getReviewPriorityScore = (progress, nowMs = Date.now()) => {
  const safeNowMs = normalizeNowMs(nowMs);
  const current = normalizeProgress(progress, safeNowMs);
  if (!current.reviewCount || !current.lastReviewedAtMs) return 0;
  const retrievability = getRetrievability(current, safeNowMs);
  const overdueDays = current.nextReviewAtMs && current.nextReviewAtMs < safeNowMs
    ? Math.min(30, (safeNowMs - current.nextReviewAtMs) / DAY_MS)
    : 0;
  return round(
    overdueDays * 4
      + (1 - retrievability) * 100
      + current.lapses * 6
      + current.hardCount * 2
      + current.difficulty,
    2
  );
};

const buildMemoryOverview = (progressItems, nowMs = Date.now()) => {
  const safeNowMs = normalizeNowMs(nowMs);
  const reviewed = (progressItems || [])
    .map((item) => normalizeProgress(item, safeNowMs))
    .filter((item) => item.reviewCount > 0 && item.lastReviewedAtMs > 0);
  if (!reviewed.length) {
    return {
      algorithmVersion: ALGORITHM_VERSION,
      reviewedWordCount: 0,
      estimatedRetentionPercent: null,
      atRiskCount: 0,
      dueNowCount: 0,
      dueTomorrowCount: 0,
      dueInThreeDaysCount: 0,
      dueInSevenDaysCount: 0,
      nextReviewAtMs: 0,
      disclaimer: "开始复习后，系统会根据真实反馈逐步安排间隔。",
    };
  }
  const snapshots = reviewed.map((item) => ({
    progress: item,
    retention: getRetrievability(item, safeNowMs),
  }));
  const dueBy = (offsetDays) => snapshots.filter(({ progress }) => (
    !progress.nextReviewAtMs || progress.nextReviewAtMs <= safeNowMs + offsetDays * DAY_MS
  )).length;
  const nextFuture = reviewed
    .map((item) => item.nextReviewAtMs)
    .filter((value) => value > safeNowMs)
    .sort((a, b) => a - b)[0] || 0;
  return {
    algorithmVersion: ALGORITHM_VERSION,
    reviewedWordCount: reviewed.length,
    estimatedRetentionPercent: Math.round(
      snapshots.reduce((sum, item) => sum + item.retention, 0) / snapshots.length * 100
    ),
    atRiskCount: snapshots.filter(({ progress, retention }) => (
      !progress.nextReviewAtMs || progress.nextReviewAtMs <= safeNowMs || retention < 0.85
    )).length,
    dueNowCount: dueBy(0),
    dueTomorrowCount: dueBy(1),
    dueInThreeDaysCount: dueBy(3),
    dueInSevenDaysCount: dueBy(7),
    nextReviewAtMs: nextFuture,
    disclaimer: "预计保持率只用于安排复习，不是考试成绩。",
  };
};

module.exports = {
  ALGORITHM_VERSION,
  DAY_MS,
  LEGACY_ALGORITHM_VERSION,
  RATINGS,
  TARGET_RETENTION,
  buildMemoryOverview,
  createEmptyProgress,
  getMemorySnapshot,
  getRetrievability,
  getReviewPriorityScore,
  migrateLegacyProgress,
  normalizeProgress,
  normalizeRating,
  scheduleReview,
};
