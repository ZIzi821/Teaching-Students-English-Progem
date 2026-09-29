const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const ALGORITHM_VERSION = "adaptive-v2";
const LEGACY_ALGORITHM_VERSION = "legacy-v1";
const TARGET_RETENTION = 0.9;
const MAX_HISTORY_ITEMS = 30;
const RATINGS = new Set(["again", "hard", "good", "easy"]);
const VALID_STATES = new Set(["new", "learning", "review", "mastered"]);

// This adapter intentionally keeps the storage model independent from a
// particular scheduler package.  The curve uses the same useful definition as
// modern FSRS models: stability is the number of days until estimated recall
// falls to 90%.  It is not a claim about a learner's exact memory probability.
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
  if (rating === "again" || successfulReviews < 2 || stabilityDays < 1) return "learning";
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
  const lastRating = String(source.lastRating || source.lastResult || "").toLowerCase();
  const lapses = clamp(
    Math.round(asNumber(source.lapses, lastRating === "again" && reviewCount ? 1 : 0)),
    0,
    reviewCount
  );
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
    asNumber(source.currentIntervalDays, legacyIntervalDays || 0),
    0,
    4200
  );
  const derivedState = deriveState({
    reviewCount,
    successfulReviews,
    stabilityDays,
    lapses,
    rating: lastRating,
  });
  const state = VALID_STATES.has(source.state) ? source.state : derivedState;
  const wasAdaptive = source.algorithmVersion === ALGORITHM_VERSION;
  const migrated = Object.assign({}, source, {
    algorithmVersion: ALGORITHM_VERSION,
    state,
    repetitions: Math.max(0, Math.round(asNumber(source.repetitions, successfulReviews))),
    successfulReviews,
    lapses,
    hardCount: Math.max(0, Math.round(asNumber(source.hardCount, lastRating === "hard" ? 1 : 0))),
    difficulty: round(difficulty),
    stabilityDays: round(stabilityDays),
    currentIntervalDays: round(currentIntervalDays),
    lastRating,
    reviewCount,
    reviewHistory: Array.isArray(source.reviewHistory) ? source.reviewHistory.slice(-MAX_HISTORY_ITEMS) : [],
  });
  if (wasAdaptive) {
    if (source.migratedFromAlgorithmVersion) {
      migrated.migratedFromAlgorithmVersion = source.migratedFromAlgorithmVersion;
    } else {
      delete migrated.migratedFromAlgorithmVersion;
    }
  } else {
    migrated.migratedFromAlgorithmVersion = source.algorithmVersion || LEGACY_ALGORITHM_VERSION;
  }
  migrated.retrievability = round(getRetrievability(migrated, safeNowMs), 4);
  return migrated;
};

const normalizeProgress = (progress, nowMs = Date.now()) => {
  if (!progress) return createEmptyProgress();
  return migrateLegacyProgress(progress, nowMs);
};

const calculateDifficulty = (currentDifficulty, rating) => {
  const changes = { again: 1.35, hard: 0.45, good: -0.15, easy: -0.75 };
  // A small mean reversion prevents difficulty from sticking forever at an
  // extreme after one unusual session.
  const reverted = currentDifficulty + (5 - currentDifficulty) * 0.04;
  return clamp(reverted + changes[rating], 1, 10);
};

const calculateInitialSchedule = (rating) => {
  const schedules = {
    again: { stabilityDays: 0.08, intervalMinutes: 10 },
    hard: { stabilityDays: 0.35, intervalMinutes: 6 * 60 },
    good: { stabilityDays: 1.2, intervalMinutes: 24 * 60 },
    easy: { stabilityDays: 4.5, intervalMinutes: 4 * 24 * 60 },
  };
  return schedules[rating];
};

const calculateReviewSchedule = (current, rating, retrievability) => {
  const stability = Math.max(0.03, current.stabilityDays || 0.03);
  const difficultyFactor = clamp(1.15 - (current.difficulty - 5) * 0.055, 0.65, 1.35);
  const latenessBoost = 1 + Math.max(0, TARGET_RETENTION - retrievability) * 2.2;
  let nextStability;
  let intervalFactor;

  if (rating === "again") {
    nextStability = Math.max(0.08, stability * clamp(0.5 - current.difficulty * 0.018, 0.25, 0.48));
    intervalFactor = 0.2;
  } else if (rating === "hard") {
    nextStability = stability * (1.12 + (1 - retrievability) * 0.22) * Math.min(1, difficultyFactor);
    intervalFactor = 0.65;
  } else if (rating === "good") {
    nextStability = stability * (1.75 + (1 - retrievability) * 1.35) * difficultyFactor * latenessBoost;
    intervalFactor = 1;
  } else {
    nextStability = stability * (2.55 + (1 - retrievability) * 1.7) * difficultyFactor * latenessBoost;
    intervalFactor = 1.15;
  }

  nextStability = clamp(asNumber(nextStability, stability), 0.03, 3650);
  const minimumMinutes = { again: 10, hard: 6 * 60, good: 24 * 60, easy: 4 * 24 * 60 }[rating];
  const intervalMinutes = clamp(
    Math.round(nextStability * intervalFactor * 24 * 60),
    minimumMinutes,
    4200 * 24 * 60
  );
  return {
    stabilityDays: nextStability,
    intervalMinutes,
  };
};

const scheduleReview = (progress, rating, nowMs = Date.now()) => {
  const normalizedRating = String(rating || "").toLowerCase();
  if (!RATINGS.has(normalizedRating)) {
    const error = new Error("Invalid French review rating");
    error.code = "INVALID_FRENCH_REVIEW";
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
  // In the product model an Again tap is always a failed recall signal. This
  // includes the first exposure so the difficult-word and dashboard counters
  // match what the learner actually selected.
  const isLapse = normalizedRating === "again";
  const isSuccessfulRecall = normalizedRating !== "again";
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
    reviewedAtMs: safeNowMs,
    rating: normalizedRating,
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
    lastResult: normalizedRating,
    lastReviewedAtMs: safeNowMs,
    nextReviewAtMs,
    reviewHistory: current.reviewHistory.concat(reviewEvent).slice(-MAX_HISTORY_ITEMS),
  });
};

const getMemorySnapshot = (progress, nowMs = Date.now()) => {
  const safeNowMs = normalizeNowMs(nowMs);
  const current = normalizeProgress(progress, safeNowMs);
  const retrievability = getRetrievability(current, safeNowMs);
  const futureMs = safeNowMs + 3 * DAY_MS;
  return {
    algorithmVersion: current.algorithmVersion,
    state: current.state,
    estimatedRetention: round(retrievability, 4),
    estimatedRetentionPercent: Math.round(retrievability * 100),
    estimatedRetentionInThreeDays: round(getRetrievability(current, futureMs), 4),
    estimatedRetentionInThreeDaysPercent: Math.round(getRetrievability(current, futureMs) * 100),
    lastReviewedAtMs: current.lastReviewedAtMs || 0,
    nextReviewAtMs: current.nextReviewAtMs || 0,
    currentIntervalDays: current.currentIntervalDays || 0,
    stabilityDays: current.stabilityDays || 0,
    difficulty: current.difficulty || 5,
    lapses: current.lapses || 0,
    hardCount: current.hardCount || 0,
    reviewCount: current.reviewCount || 0,
    lastRating: current.lastRating || "",
    reviewHistory: current.reviewHistory || [],
  };
};

const buildRetentionCurve = (progress, nowMs = Date.now(), pointCount = 8) => {
  const safeNowMs = normalizeNowMs(nowMs);
  const current = normalizeProgress(progress, safeNowMs);
  if (!current.lastReviewedAtMs || !current.stabilityDays) return [];
  const startMs = current.lastReviewedAtMs;
  const minimumEndMs = safeNowMs + 3 * DAY_MS;
  const scheduledEndMs = (current.nextReviewAtMs || safeNowMs) + 3 * DAY_MS;
  const endMs = Math.max(startMs + DAY_MS, minimumEndMs, scheduledEndMs);
  const count = clamp(Math.round(asNumber(pointCount, 8)), 4, 16);
  const spanMs = endMs - startMs;
  return Array.from({ length: count }, (_, index) => {
    const atMs = startMs + (spanMs * index) / (count - 1);
    return {
      atMs: Math.round(atMs),
      elapsedDays: round((atMs - startMs) / DAY_MS, 2),
      retention: round(getRetrievability(current, atMs), 4),
      retentionPercent: Math.round(getRetrievability(current, atMs) * 100),
      isPast: atMs <= safeNowMs,
      isNow: index > 0 && atMs >= safeNowMs && startMs + (spanMs * (index - 1)) / (count - 1) < safeNowMs,
    };
  });
};

const getDifficultyScore = (progress, nowMs = Date.now()) => {
  const safeNowMs = normalizeNowMs(nowMs);
  const current = normalizeProgress(progress, safeNowMs);
  if (!current.reviewCount) return 0;
  const retrievability = getRetrievability(current, safeNowMs);
  return round(
    current.lapses * 3 + current.hardCount * 1.25 + current.difficulty + (1 - retrievability) * 5,
    2
  );
};

module.exports = {
  ALGORITHM_VERSION,
  DAY_MS,
  LEGACY_ALGORITHM_VERSION,
  RATINGS,
  TARGET_RETENTION,
  buildRetentionCurve,
  createEmptyProgress,
  getDifficultyScore,
  getMemorySnapshot,
  getRetrievability,
  migrateLegacyProgress,
  normalizeProgress,
  scheduleReview,
};
