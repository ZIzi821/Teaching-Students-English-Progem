const ALGORITHM_VERSION = "personalized-v2";
const DAY_MS = 24 * 60 * 60 * 1000;

const asText = (value) => String(value || "").trim();
const asNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

const stableNoise = (value) => {
  const text = asText(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
};

const isWeakWord = (word) => {
  const source = word || {};
  const wrong = Math.max(0, asNumber(source.wrongCount));
  const correct = Math.max(0, asNumber(source.correctCount));
  return source.lastResult === "forgot"
    || source.lastResult === "hard"
    || source.lastResult === "quizWrong"
    || source.lastQuizResult === "wrong"
    || (wrong >= 2 && wrong >= correct);
};

const getQuestionTarget = (dailyGoal) => {
  const goal = Math.max(5, asNumber(dailyGoal) || 8);
  if (goal <= 8) return 8;
  if (goal <= 15) return 10;
  if (goal <= 20) return 12;
  return 15;
};

const scoreWord = (word, context) => {
  const nowMs = context.nowMs;
  const todayKeys = context.todayKeys;
  const key = asText(word.key || word.word);
  const reviewCount = Math.max(0, asNumber(word.reviewCount));
  const wrongCount = Math.max(0, asNumber(word.wrongCount));
  const correctCount = Math.max(0, asNumber(word.correctCount));
  const attempts = Math.max(1, wrongCount + correctCount);
  const wrongRate = wrongCount / attempts;
  const overdueDays = word.isDue && word.nextReviewAtMs
    ? Math.min(14, Math.max(0, (nowMs - asNumber(word.nextReviewAtMs)) / DAY_MS))
    : 0;
  let score = 0;
  if (isWeakWord(word)) score += 90;
  if (todayKeys.has(key)) score += 60;
  if (word.reviewedToday === true) score += 30;
  if (word.isDue === true) score += 45;
  score += wrongRate * 35;
  score += overdueDays * 2;
  score += Math.max(0, 5 - asNumber(word.masteryLevel)) * 4;
  score += Math.min(12, reviewCount);
  score += stableNoise(`${context.studentId}:${context.learningDay}:${key}`) * 3;
  return score;
};

const uniqueWords = (items) => {
  const seen = new Set();
  return (items || []).filter((item) => {
    const key = asText(item && (item.key || item.word)).toLowerCase();
    if (!key || !asText(item && item.word) || !asText(item && item.meaning) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const selectFromGroups = (groups, limit) => {
  const selected = [];
  const keys = new Set();
  groups.forEach((group) => {
    (group || []).forEach((word) => {
      if (selected.length >= limit) return;
      const key = asText(word.key || word.word).toLowerCase();
      if (!key || keys.has(key)) return;
      keys.add(key);
      selected.push(word);
    });
  });
  return selected;
};

const buildPersonalizedQuizPlan = ({
  words,
  todayWords,
  dailyGoal,
  studentId,
  learningDay,
  scope = "smart",
  nowMs = Date.now(),
}) => {
  const todayKeys = new Set(uniqueWords(todayWords).map((item) => asText(item.key || item.word)));
  const eligible = uniqueWords(words).filter((word) => (
    word.isEasy !== true
      && word.isBasicHidden !== true
      && Math.max(0, asNumber(word.reviewCount)) > 0
  ));
  const context = { nowMs, todayKeys, studentId, learningDay };
  const ranked = eligible.slice().sort((left, right) => (
    scoreWord(right, context) - scoreWord(left, context)
      || asText(left.word).localeCompare(asText(right.word), "en")
  ));
  const target = Math.min(getQuestionTarget(dailyGoal), ranked.length);
  const weak = ranked.filter(isWeakWord);
  const today = ranked.filter((word) => todayKeys.has(asText(word.key || word.word)));
  const due = ranked.filter((word) => word.isDue === true);
  const learning = ranked.filter((word) => asNumber(word.masteryLevel) < 5);
  const groups = scope === "weak"
    ? [weak]
    : [
      weak.slice(0, Math.ceil(target * 0.45)),
      today.slice(0, Math.ceil(target * 0.35)),
      due,
      learning,
      ranked,
    ];
  const selected = selectFromGroups(groups, target);
  const weakCount = selected.filter(isWeakWord).length;
  const todayCount = selected.filter((word) => todayKeys.has(asText(word.key || word.word))).length;
  const dueCount = selected.filter((word) => word.isDue === true).length;
  const estimatedMinutes = selected.length
    ? Math.max(5, Math.min(15, Math.ceil(selected.length * 0.8)))
    : 0;
  return {
    algorithmVersion: ALGORITHM_VERSION,
    scope,
    dailyGoal: Math.max(5, asNumber(dailyGoal) || 8),
    eligibleCount: eligible.length,
    questionCount: selected.length,
    estimatedMinutes,
    focus: { weakCount, todayCount, dueCount },
    focusLabel: selected.length
      ? `本轮优先安排 ${weakCount} 个薄弱词、${todayCount} 个今日接触词和 ${dueCount} 个到期复习词`
      : "完成今日背词后，系统会根据真实学习记录准备小测",
    words: selected,
  };
};

const buildTeacherVocabularyAlerts = ({ students, sessions, nowMs = Date.now() }) => {
  const studentById = new Map((students || []).map((student) => [String(student._id || ""), student]));
  const sessionsByStudent = new Map();
  (sessions || []).forEach((session) => {
    const studentId = String(session.studentId || "");
    if (!studentById.has(studentId)) return;
    if (!sessionsByStudent.has(studentId)) sessionsByStudent.set(studentId, []);
    sessionsByStudent.get(studentId).push(session);
  });
  const alerts = [];
  sessionsByStudent.forEach((studentSessions, studentId) => {
    const student = studentById.get(studentId) || {};
    const recent = studentSessions
      .filter((item) => nowMs - asNumber(item.completedAtMs) <= 30 * DAY_MS)
      .sort((left, right) => asNumber(right.completedAtMs) - asNumber(left.completedAtMs))
      .slice(0, 5);
    if (!recent.length) return;
    const latest = recent[0];
    const latestAt = asNumber(latest.completedAtMs);
    const latestAccuracy = Math.max(0, Math.min(100, asNumber(latest.accuracy)));
    if (latestAccuracy < 60 && asNumber(latest.totalQuestions) >= 6) {
      alerts.push({
        _id: `quiz-low:${studentId}:${latestAt}`,
        studentId,
        studentName: student.name || "学生",
        activityType: "quiz_low_accuracy",
        severity: "attention",
        title: "单词小测需要关注",
        activityText: `最近一次正确率 ${latestAccuracy}%`,
        detail: "建议先查看答错词，再安排下一轮复习。",
        activityAtMs: latestAt,
      });
    }
    const lastThree = recent.slice(0, 3);
    const evidenceQuestions = recent.reduce(
      (total, item) => total + Math.max(0, asNumber(item.totalQuestions)),
      0
    );
    if (
      recent.length >= 5
      && evidenceQuestions >= 40
      && lastThree.length === 3
      && lastThree.every((item) => asNumber(item.totalQuestions) >= 6 && asNumber(item.accuracy) < 65)
    ) {
      alerts.push({
        _id: `quiz-algorithm:${studentId}:${latestAt}`,
        studentId,
        studentName: student.name || "学生",
        activityType: "quiz_algorithm_review",
        severity: "important",
        title: "建议检查个性化小测算法",
        activityText: "已有 5 次以上记录，最近连续 3 次低于 65%",
        detail: "可让 Codex 根据该学生最近记录调整选词比例或题型难度。",
        activityAtMs: latestAt + 1,
      });
    }
    const failures = new Map();
    recent.forEach((session) => {
      (session.results || []).filter((item) => item.correct !== true).forEach((item) => {
        const key = asText(item.wordKey);
        if (!key) return;
        const current = failures.get(key) || { count: 0, word: asText(item.word) || key };
        current.count += 1;
        failures.set(key, current);
      });
    });
    const repeated = Array.from(failures.entries())
      .map(([wordKey, value]) => ({ wordKey, ...value }))
      .filter((item) => item.count >= 3)
      .sort((left, right) => right.count - left.count)[0];
    if (repeated) {
      alerts.push({
        _id: `quiz-word:${studentId}:${repeated.wordKey}:${latestAt}`,
        studentId,
        studentName: student.name || "学生",
        activityType: "quiz_repeated_word",
        severity: "attention",
        title: "有单词反复答错",
        activityText: `${repeated.word} 最近答错 ${repeated.count} 次`,
        detail: "建议课堂上单独检查读音、拼写和中文意思。",
        activityAtMs: latestAt + 2,
      });
    }
  });
  return alerts.sort((left, right) => asNumber(right.activityAtMs) - asNumber(left.activityAtMs));
};

module.exports = {
  ALGORITHM_VERSION,
  buildPersonalizedQuizPlan,
  buildTeacherVocabularyAlerts,
  getQuestionTarget,
  isWeakWord,
};
