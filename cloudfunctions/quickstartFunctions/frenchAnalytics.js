const {
  DAY_MS,
  getDifficultyScore,
  getMemorySnapshot,
  getRetrievability,
  normalizeProgress,
} = require("./frenchReviewEngine");

const DEFAULT_TIMEZONE_OFFSET_MINUTES = 8 * 60;
const DEFAULT_PREFERENCES = {
  targetLevel: "A2",
  dailyNewWordLimit: 10,
  dailyGoal: 20,
  timezoneOffsetMinutes: DEFAULT_TIMEZONE_OFFSET_MINUTES,
};
const LEVELS = ["A1", "A2"];
const MEMORY_STATES = ["new", "learning", "review", "mastered"];
const DAILY_FOCUS_ROTATION = [
  { key: "grammar", title: "语法小课", caption: "用一个规则看懂句子" },
  { key: "expression", title: "情境表达", caption: "学一句马上能用的话" },
  { key: "reading", title: "短篇阅读", caption: "读一段真实的小对话" },
  { key: "writing", title: "句子搭建", caption: "把法语词排成完整句子" },
];

const asArray = (value) => (Array.isArray(value) ? value : []);
const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const roundPercent = (value) => Math.round(clamp(asNumber(value), 0, 1) * 1000) / 10;

const normalizePreferences = (preferences) => {
  const source = preferences || {};
  const targetLevel = ["A1", "A2", "B1", "B2"].includes(source.targetLevel)
    ? source.targetLevel
    : DEFAULT_PREFERENCES.targetLevel;
  return {
    targetLevel,
    dailyNewWordLimit: clamp(Math.round(asNumber(source.dailyNewWordLimit, 10)), 1, 30),
    dailyGoal: clamp(Math.round(asNumber(source.dailyGoal, 20)), 5, 100),
    timezoneOffsetMinutes: clamp(
      Math.round(asNumber(source.timezoneOffsetMinutes, DEFAULT_TIMEZONE_OFFSET_MINUTES)),
      -12 * 60,
      14 * 60
    ),
  };
};

const getLocalDayStartMs = (nowMs, timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES) => {
  const offsetMs = timezoneOffsetMinutes * 60 * 1000;
  return Math.floor((nowMs + offsetMs) / DAY_MS) * DAY_MS - offsetMs;
};

const getDateKey = (nowMs, timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES) => {
  const shifted = new Date(nowMs + timezoneOffsetMinutes * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getProgress = (progressByKey, type, id) => progressByKey.get(`${type}:${id}`) || null;

const getWordState = (progress, nowMs) => {
  if (!progress || !asNumber(progress.reviewCount)) return "new";
  return normalizeProgress(progress, nowMs).state;
};

const getWordLearningScore = (progress, nowMs) => {
  if (!progress || !asNumber(progress.reviewCount)) return 0;
  const memory = getMemorySnapshot(progress, nowMs);
  if (memory.state === "mastered") return 1;
  if (memory.state === "review") return clamp(0.55 + memory.estimatedRetention * 0.3, 0, 0.9);
  return clamp(0.18 + Math.min(0.25, memory.reviewCount * 0.06), 0, 0.48);
};

const getCompletionScore = (progress) => (progress && progress.completed === true ? 1 : 0);

const summarizeDimension = (items, progressByKey, type, nowMs) => {
  const list = asArray(items);
  const scores = list.map((item) => (
    type === "word"
      ? getWordLearningScore(getProgress(progressByKey, type, item.id), nowMs)
      : getCompletionScore(getProgress(progressByKey, type, item.id))
  ));
  const completedCount = scores.filter((score) => score >= 0.999).length;
  const startedCount = scores.filter((score) => score > 0).length;
  const score = scores.length ? scores.reduce((sum, item) => sum + item, 0) / scores.length : 0;
  return {
    totalCount: list.length,
    startedCount,
    completedCount,
    percent: roundPercent(score),
  };
};

const buildLevelProgress = (content, progressByKey, nowMs) => {
  const dimensions = [
    { key: "vocabulary", type: "word", source: content.words, weight: 0.35 },
    { key: "grammar", type: "grammar", source: content.grammar, weight: 0.2 },
    { key: "expressions", type: "expression", source: content.expressions, weight: 0.15 },
    { key: "listening", type: "sentence", source: content.sentences, weight: 0.15 },
    { key: "reading", type: "reading", source: content.readings, weight: 0.1 },
    { key: "writing", type: "writing", source: content.writing, weight: 0.05 },
  ];
  return LEVELS.map((level) => {
    const summary = {};
    let weighted = 0;
    dimensions.forEach((dimension) => {
      const items = asArray(dimension.source).filter((item) => item.cefrLevel === level);
      summary[dimension.key] = summarizeDimension(items, progressByKey, dimension.type, nowMs);
      weighted += summary[dimension.key].percent * dimension.weight;
    });
    const overallPercent = Math.round(weighted * 10) / 10;
    return {
      cefrLevel: level,
      label: level === "A1" ? "A1 基础" : "A2 进阶",
      overallPercent,
      status: overallPercent >= 85 ? "课程覆盖接近完成" : "学习中",
      dimensions: summary,
      disclaimer: "课程覆盖率依据小程序内 A1/A2 内容计算，用于安排 CEFR 学习进度。",
    };
  });
};

const buildMemoryDistribution = (content, progressByKey, nowMs, level) => {
  const counts = { new: 0, learning: 0, review: 0, mastered: 0 };
  content.words
    .filter((word) => !level || word.cefrLevel === level)
    .forEach((word) => {
      const state = getWordState(getProgress(progressByKey, "word", word.id), nowMs);
      counts[state] = (counts[state] || 0) + 1;
    });
  return counts;
};

const buildMemoryOverview = (content, progressByKey, nowMs) => {
  const reviewed = content.words
    .map((word) => getProgress(progressByKey, "word", word.id))
    .filter((progress) => progress && asNumber(progress.reviewCount) > 0)
    .map((progress) => normalizeProgress(progress, nowMs));
  if (!reviewed.length) {
    return {
      reviewedWordCount: 0,
      currentRetentionPercent: 0,
      atRiskCount: 0,
      averageStabilityDays: 0,
      points: [],
      disclaimer: "完成首次单词复习后，将根据你的个人记录生成预计记忆曲线。",
    };
  }

  const offsets = [
    { days: 0, label: "现在" },
    { days: 1, label: "明天" },
    { days: 3, label: "3天后" },
    { days: 7, label: "7天后" },
  ];
  const points = offsets.map((offset) => {
    const atMs = nowMs + offset.days * DAY_MS;
    const average = reviewed.reduce(
      (sum, progress) => sum + getRetrievability(progress, atMs),
      0
    ) / reviewed.length;
    return {
      label: offset.label,
      value: Math.round(clamp(average, 0, 1) * 100),
      atMs,
    };
  });
  const atRiskCount = reviewed.filter((progress) => (
    asNumber(progress.nextReviewAtMs) <= nowMs || getRetrievability(progress, nowMs) < 0.8
  )).length;
  const averageStabilityDays = reviewed.reduce(
    (sum, progress) => sum + Math.max(0, asNumber(progress.stabilityDays)),
    0
  ) / reviewed.length;
  return {
    reviewedWordCount: reviewed.length,
    currentRetentionPercent: points[0].value,
    atRiskCount,
    averageStabilityDays: Math.round(averageStabilityDays * 10) / 10,
    points,
    disclaimer: "依据复习时间与记忆稳定度动态估算，用于安排复习节奏。",
  };
};

const getDayRecords = (progressByKey) => Array.from(progressByKey.values())
  .filter((item) => item && item.contentType === "daily" && /^\d{4}-\d{2}-\d{2}$/.test(item.contentId || ""));

const buildStreak = (progressByKey, nowMs, timezoneOffsetMinutes) => {
  const activeKeys = new Set(getDayRecords(progressByKey)
    .filter((item) => asNumber(item.activityCount) > 0 || asNumber(item.reviewActionCount) > 0)
    .map((item) => item.contentId));
  let streak = 0;
  const todayStartMs = getLocalDayStartMs(nowMs, timezoneOffsetMinutes);
  for (let offset = 0; offset < 3660; offset += 1) {
    const key = getDateKey(todayStartMs - offset * DAY_MS, timezoneOffsetMinutes);
    if (!activeKeys.has(key)) {
      if (offset === 0) continue;
      break;
    }
    streak += 1;
  }
  return streak;
};

const sumDailyRange = (progressByKey, nowMs, timezoneOffsetMinutes, days) => {
  const allowed = new Set();
  const start = getLocalDayStartMs(nowMs, timezoneOffsetMinutes);
  for (let offset = 0; offset < days; offset += 1) {
    allowed.add(getDateKey(start - offset * DAY_MS, timezoneOffsetMinutes));
  }
  const totals = {
    reviewActionCount: 0,
    successfulRecallCount: 0,
    againCount: 0,
    activityCount: 0,
    studySessionCount: 0,
  };
  getDayRecords(progressByKey).forEach((item) => {
    if (!allowed.has(item.contentId)) return;
    Object.keys(totals).forEach((key) => { totals[key] += Math.max(0, asNumber(item[key])); });
  });
  totals.accuracyPercent = totals.reviewActionCount
    ? Math.round(totals.successfulRecallCount / totals.reviewActionCount * 100)
    : 0;
  return totals;
};

const buildSevenDayTrend = (progressByKey, nowMs, preferences) => {
  const start = getLocalDayStartMs(nowMs, preferences.timezoneOffsetMinutes);
  const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];
  return Array.from({ length: 7 }, (_, index) => {
    const atMs = start - (6 - index) * DAY_MS;
    const key = getDateKey(atMs, preferences.timezoneOffsetMinutes);
    const record = getProgress(progressByKey, "daily", key) || {};
    const shifted = new Date(atMs + preferences.timezoneOffsetMinutes * 60 * 1000);
    return {
      date: key,
      label: weekdayLabels[shifted.getUTCDay()],
      value: Math.max(0, asNumber(record.activityCount, record.reviewActionCount)),
      reviewCount: Math.max(0, asNumber(record.reviewActionCount)),
      goal: preferences.dailyGoal,
    };
  });
};

const buildDailyPath = (todayRecord, today, nowMs, preferences) => {
  const source = todayRecord || {};
  const localDayNumber = Math.floor(
    getLocalDayStartMs(nowMs, preferences.timezoneOffsetMinutes) / DAY_MS
  );
  const focus = DAILY_FOCUS_ROTATION[
    ((localDayNumber % DAILY_FOCUS_ROTATION.length) + DAILY_FOCUS_ROTATION.length)
      % DAILY_FOCUS_ROTATION.length
  ];
  const wordActivityCount = Math.max(0, asNumber(source.wordActivityCount));
  const remainingWordCount = Math.max(0, asNumber(today.dueCount) + asNumber(today.newRemainingCount));
  const wordTarget = Math.min(5, Math.max(
    remainingWordCount,
    Math.min(5, wordActivityCount)
  ));
  const definitions = [
    {
      key: "word",
      title: "复习与新词",
      caption: wordTarget ? "先把快忘的词找回来" : "今天的单词任务已清空",
      completedCount: Math.min(wordTarget, wordActivityCount),
      targetCount: wordTarget,
    },
    {
      key: "sentence",
      title: "听力跟读",
      caption: "听一句，再自然地说一遍",
      completedCount: Math.min(1, Math.max(0, asNumber(source.sentenceActivityCount))),
      targetCount: 1,
    },
    {
      key: focus.key,
      title: focus.title,
      caption: focus.caption,
      completedCount: Math.min(1, Math.max(0, asNumber(source[`${focus.key}ActivityCount`]))),
      targetCount: 1,
    },
  ];
  let foundCurrent = false;
  const steps = definitions.map((step, index) => {
    const completed = step.targetCount === 0 || step.completedCount >= step.targetCount;
    const state = completed ? "done" : foundCurrent ? "upcoming" : "current";
    if (!completed && !foundCurrent) foundCurrent = true;
    return Object.assign({}, step, {
      order: index + 1,
      completed,
      state,
      progressText: step.targetCount === 0 ? "今日已完成" : `${step.completedCount}/${step.targetCount}`,
    });
  });
  const totalTarget = steps.reduce((sum, step) => sum + step.targetCount, 0);
  const totalCompleted = steps.reduce((sum, step) => sum + Math.min(step.targetCount, step.completedCount), 0);
  const completedStepCount = steps.filter((step) => step.completed).length;
  return {
    title: "10 分钟今日路线",
    completedStepCount,
    totalStepCount: steps.length,
    progressPercent: totalTarget ? Math.round(totalCompleted / totalTarget * 100) : 100,
    completed: completedStepCount === steps.length,
    estimatedMinutes: completedStepCount === steps.length ? 0 : Math.max(3, (steps.length - completedStepCount) * 3),
    steps,
  };
};

const buildReviewWorkload = (content, progressByKey, nowMs, preferences) => {
  const start = getLocalDayStartMs(nowMs, preferences.timezoneOffsetMinutes);
  let overdueCount = 0;
  const points = Array.from({ length: 7 }, (_, index) => ({
    date: getDateKey(start + index * DAY_MS, preferences.timezoneOffsetMinutes),
    label: index === 0 ? "今天" : index === 1 ? "明天" : `+${index}天`,
    value: 0,
  }));
  content.words.forEach((word) => {
    const progress = getProgress(progressByKey, "word", word.id);
    if (!progress || !asNumber(progress.reviewCount) || !asNumber(progress.nextReviewAtMs)) return;
    const next = asNumber(progress.nextReviewAtMs);
    if (next < start) {
      overdueCount += 1;
      points[0].value += 1;
      return;
    }
    const offset = Math.floor((next - start) / DAY_MS);
    if (offset >= 0 && offset < points.length) points[offset].value += 1;
  });
  return {
    overdueCount,
    dueToday: points[0].value,
    tomorrow: points[1].value,
    nextSevenDays: points.reduce((sum, item) => sum + item.value, 0),
    points,
  };
};

const buildDifficultWords = (content, progressByKey, nowMs) => content.words
  .map((word) => {
    const progress = getProgress(progressByKey, "word", word.id);
    return {
      id: word.id,
      lemma: word.lemma,
      displayForm: word.displayForm,
      meaningCN: word.meaningCN || word.meaning || "",
      cefrLevel: word.cefrLevel,
      score: progress ? getDifficultyScore(progress, nowMs) : 0,
      lapses: progress ? Math.max(0, asNumber(progress.lapses)) : 0,
      hardCount: progress ? Math.max(0, asNumber(progress.hardCount)) : 0,
      estimatedRetentionPercent: progress
        ? getMemorySnapshot(progress, nowMs).estimatedRetentionPercent
        : 0,
    };
  })
  .filter((item) => item.score >= 8 || item.lapses > 0 || item.hardCount >= 2)
  .sort((left, right) => right.score - left.score || left.displayForm.localeCompare(right.displayForm, "fr"))
  .slice(0, 12);

const buildContentSummary = (content, progressByKey, nowMs) => {
  const wordProgress = content.words.map((word) => getProgress(progressByKey, "word", word.id));
  const reviewed = wordProgress.filter((item) => item && asNumber(item.reviewCount));
  const dueCount = reviewed.filter((item) => asNumber(item.nextReviewAtMs) <= nowMs).length;
  const completedSentences = content.sentences.filter((item) => {
    const progress = getProgress(progressByKey, "sentence", item.id);
    return progress && progress.completed === true;
  });
  return {
    wordSummary: {
      totalCount: content.words.length,
      reviewedCount: reviewed.length,
      masteredCount: reviewed.filter((item) => getWordState(item, nowMs) === "mastered").length,
      dueCount,
      newCount: content.words.length - reviewed.length,
      byLevel: Object.fromEntries(LEVELS.map((level) => {
        const words = content.words.filter((item) => item.cefrLevel === level);
        const progresses = words.map((item) => getProgress(progressByKey, "word", item.id));
        return [level, {
          totalCount: words.length,
          reviewedCount: progresses.filter((item) => item && asNumber(item.reviewCount)).length,
          masteredCount: progresses.filter((item) => item && getWordState(item, nowMs) === "mastered").length,
        }];
      })),
    },
    sentenceSummary: {
      totalCount: content.sentences.length,
      completedCount: completedSentences.length,
      repeatCount: completedSentences.reduce((sum, sentence) => {
        const progress = getProgress(progressByKey, "sentence", sentence.id);
        return sum + Math.max(0, asNumber(progress && progress.repeatCount));
      }, 0),
    },
  };
};

const buildDashboard = (content, progressByKey, nowMs, rawPreferences) => {
  const preferences = normalizePreferences(rawPreferences);
  const todayKey = getDateKey(nowMs, preferences.timezoneOffsetMinutes);
  const todayRecord = getProgress(progressByKey, "daily", todayKey) || {};
  const workload = buildReviewWorkload(content, progressByKey, nowMs, preferences);
  const today = {
    date: todayKey,
    dueCount: workload.dueToday,
    newWordCount: Math.max(0, asNumber(todayRecord.newWordCount)),
    reviewedCount: Math.max(0, asNumber(todayRecord.reviewActionCount)),
    successfulRecallCount: Math.max(0, asNumber(todayRecord.successfulRecallCount)),
    againCount: Math.max(0, asNumber(todayRecord.againCount)),
    activityCount: Math.max(0, asNumber(todayRecord.activityCount, todayRecord.reviewActionCount)),
    studySessionCount: Math.max(0, asNumber(todayRecord.studySessionCount)),
    goal: preferences.dailyGoal,
  };
  today.newRemainingCount = Math.max(0, preferences.dailyNewWordLimit - today.newWordCount);
  today.goalPercent = Math.min(100, Math.round(today.activityCount / today.goal * 100));
  return {
    generatedAtMs: nowMs,
    preferences,
    today,
    streakDays: buildStreak(progressByKey, nowMs, preferences.timezoneOffsetMinutes),
    levelProgress: buildLevelProgress(content, progressByKey, nowMs),
    memoryDistribution: buildMemoryDistribution(content, progressByKey, nowMs),
    memoryOverview: buildMemoryOverview(content, progressByKey, nowMs),
    dailyPath: buildDailyPath(todayRecord, today, nowMs, preferences),
    accuracy7: sumDailyRange(progressByKey, nowMs, preferences.timezoneOffsetMinutes, 7),
    accuracy30: sumDailyRange(progressByKey, nowMs, preferences.timezoneOffsetMinutes, 30),
    trend7: buildSevenDayTrend(progressByKey, nowMs, preferences),
    reviewWorkload: workload,
    difficultWords: buildDifficultWords(content, progressByKey, nowMs),
  };
};

module.exports = {
  DEFAULT_PREFERENCES,
  DEFAULT_TIMEZONE_OFFSET_MINUTES,
  buildContentSummary,
  buildDashboard,
  buildDailyPath,
  buildLevelProgress,
  buildMemoryDistribution,
  buildMemoryOverview,
  buildReviewWorkload,
  getDateKey,
  getLocalDayStartMs,
  normalizePreferences,
};
