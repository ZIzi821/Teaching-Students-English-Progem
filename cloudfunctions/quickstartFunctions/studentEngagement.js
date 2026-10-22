const DAY_MS = 24 * 60 * 60 * 1000;
const HONG_KONG_OFFSET_MS = 8 * 60 * 60 * 1000;
const REMINDER_VISIBLE_DAYS = 30;
const ketMock = require("./ketMock");

const POINT_RULES = Object.freeze({
  vocabularyPerWord: 2,
  vocabularyDailyCap: 30,
  quizCompletion: 5,
  quizAccuracyMax: 10,
  recordingPerTask: 10,
  homeworkConfirmed: 20,
  ketMockCompleted: 30,
  frenchPerActivity: 2,
  frenchDailyCap: 10,
});

const PK_CHALLENGE_LIMITS = Object.freeze({
  nameLength: 18,
  weeklyBaseScoreMax: 1000,
  dailyIncrementMax: 100,
});

const LEVELS = Object.freeze([
  { level: 1, minimum: 0, title: "学习新芽" },
  { level: 2, minimum: 100, title: "坚持学员" },
  { level: 3, minimum: 250, title: "成长达人" },
  { level: 4, minimum: 500, title: "学习先锋" },
  { level: 5, minimum: 900, title: "自律高手" },
  { level: 6, minimum: 1400, title: "闪耀学霸" },
]);

const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

const getDateLikeTime = (value) => {
  if (!value) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value.getTime === "function") return value.getTime();
  if (typeof value === "object" && value.$date) return getDateLikeTime(value.$date);
  if (typeof value === "object" && Number.isFinite(Number(value.seconds))) {
    return Number(value.seconds) * 1000;
  }
  return 0;
};

const getDocumentTime = (item, fields = []) => {
  const source = item || {};
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const numeric = asNumber(source[field]);
    if (numeric > 0) return numeric;
    const parsed = getDateLikeTime(source[field]);
    if (parsed > 0) return parsed;
  }
  return getDateLikeTime(source.createdAt);
};

const getLearningDay = (nowMs = Date.now()) => (
  Math.floor((asNumber(nowMs, Date.now()) + HONG_KONG_OFFSET_MS) / DAY_MS)
);

const getTimestampForLearningDay = (learningDay) => (
  Math.trunc(asNumber(learningDay)) * DAY_MS - HONG_KONG_OFFSET_MS + 12 * 60 * 60 * 1000
);

const getDateKeyForLearningDay = (learningDay) => {
  const date = new Date(Math.trunc(asNumber(learningDay)) * DAY_MS);
  if (Number.isNaN(date.getTime())) return "";
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
};

const parseDateKeyToLearningDay = (dateKey) => {
  const matched = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return 0;
  return Math.floor(Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3])) / DAY_MS);
};

const getWeekWindow = (nowMs = Date.now()) => {
  const today = getLearningDay(nowMs);
  const dayOfWeek = new Date(today * DAY_MS).getUTCDay() || 7;
  const startDay = today - (dayOfWeek - 1);
  return {
    startDay,
    endDay: startDay + 6,
    label: `${getDateKeyForLearningDay(startDay).slice(5).replace("-", "/")}–${getDateKeyForLearningDay(startDay + 6).slice(5).replace("-", "/")}`,
  };
};

const normalizePkChallengeProfile = (profile = {}) => ({
  _id: String(profile._id || "").trim(),
  name: String(profile.name || "").trim().slice(0, PK_CHALLENGE_LIMITS.nameLength),
  weeklyBaseScore: clamp(
    Math.round(asNumber(profile.weeklyBaseScore)),
    0,
    PK_CHALLENGE_LIMITS.weeklyBaseScoreMax
  ),
  dailyIncrement: clamp(
    Math.round(asNumber(profile.dailyIncrement)),
    0,
    PK_CHALLENGE_LIMITS.dailyIncrementMax
  ),
  enabled: profile.enabled !== false,
});

const getPkChallengeScore = (profile = {}, nowMs = Date.now()) => {
  const normalized = normalizePkChallengeProfile(profile);
  const week = getWeekWindow(nowMs);
  const elapsedDays = clamp(getLearningDay(nowMs) - week.startDay, 0, 6);
  return {
    score: normalized.weeklyBaseScore + normalized.dailyIncrement * elapsedDays,
    elapsedDays,
    week,
  };
};

const getStreakDays = (activeDays, nowMs = Date.now()) => {
  const daySet = activeDays instanceof Set ? activeDays : new Set(activeDays || []);
  let cursor = getLearningDay(nowMs);
  if (!daySet.has(cursor)) cursor -= 1;
  let streakDays = 0;
  while (daySet.has(cursor) && streakDays < 3660) {
    streakDays += 1;
    cursor -= 1;
  }
  return streakDays;
};

const isTeacherConfirmedHomework = (lesson) => Boolean(
  lesson
  && (
    lesson.homeworkTeacherReviewStatus === "completed"
    || (
      lesson.homeworkCompletedFrom === "teacher"
      && (lesson.homeworkCompleted === true || asNumber(lesson.homeworkCompletedAtMs) > 0)
    )
  )
);

const isUsableRecording = (submission) => Boolean(
  submission && submission.kind === "audio" && submission.status !== "需要重录"
);

const buildLevel = (totalPoints) => {
  const points = Math.max(0, Math.round(asNumber(totalPoints)));
  let current = LEVELS[0];
  let next = null;
  LEVELS.forEach((level, index) => {
    if (points >= level.minimum) {
      current = level;
      next = LEVELS[index + 1] || null;
    }
  });
  const range = next ? next.minimum - current.minimum : 0;
  return {
    number: current.level,
    title: current.title,
    currentMinimum: current.minimum,
    nextMinimum: next ? next.minimum : 0,
    nextTitle: next ? next.title : "最高等级",
    pointsIntoLevel: points - current.minimum,
    pointsToNext: next ? Math.max(0, next.minimum - points) : 0,
    progressPercent: next && range > 0
      ? clamp(Math.round((points - current.minimum) / range * 100), 0, 100)
      : 100,
  };
};

const buildStudentScore = (records = {}, nowMs = Date.now()) => {
  const events = [];
  const activeDays = new Set();
  const lessonRecords = Array.isArray(records.lessons) ? records.lessons : [];
  const addEvent = ({ key, type, title, points, day, atMs, count = 1 }) => {
    const safePoints = Math.max(0, Math.round(asNumber(points)));
    const safeDay = Math.trunc(asNumber(day, getLearningDay(atMs || nowMs)));
    if (!safePoints || !safeDay) return;
    activeDays.add(safeDay);
    events.push({
      key: String(key || `${type}:${safeDay}`),
      type: String(type || "learning"),
      title: String(title || "完成学习"),
      points: safePoints,
      count: Math.max(0, Math.round(asNumber(count))),
      day: safeDay,
      atMs: Math.max(0, asNumber(atMs)) || getTimestampForLearningDay(safeDay),
    });
  };

  let reviewedWordCount = 0;
  (records.vocabularyDailyStats || []).forEach((item) => {
    const count = clamp(
      Math.max(0, Math.round(asNumber(item.reviewedWordCount, Array.isArray(item.reviewedWordKeys) ? item.reviewedWordKeys.length : 0))),
      0,
      POINT_RULES.vocabularyDailyCap
    );
    if (!count) return;
    const day = Math.trunc(asNumber(item.learningDay)) || getLearningDay(getDocumentTime(item, ["updatedAt", "createdAt"]));
    reviewedWordCount += count;
    addEvent({
      key: `vocabulary:${day}`,
      type: "vocabulary",
      title: `完成 ${count} 个单词复习`,
      points: count * POINT_RULES.vocabularyPerWord,
      day,
      atMs: getDocumentTime(item, ["updatedAt", "createdAt"]),
      count,
    });
  });

  const bestQuizByDay = new Map();
  (records.quizSessions || []).forEach((session) => {
    const total = Math.max(0, Math.round(asNumber(session.totalQuestions)));
    if (!total) return;
    const correct = clamp(Math.round(asNumber(session.correctCount)), 0, total);
    const atMs = getDocumentTime(session, ["completedAtMs", "createdAt"]);
    const day = Math.trunc(asNumber(session.learningDay)) || getLearningDay(atMs);
    const points = POINT_RULES.quizCompletion
      + Math.round(POINT_RULES.quizAccuracyMax * correct / total);
    const candidate = { session, day, atMs, total, correct, points };
    const current = bestQuizByDay.get(day);
    if (!current || points > current.points || (points === current.points && atMs < current.atMs)) {
      bestQuizByDay.set(day, candidate);
    }
  });
  Array.from(bestQuizByDay.values()).forEach((item) => {
    addEvent({
      key: `quiz:${item.day}`,
      type: "quiz",
      title: `单词小测答对 ${item.correct}/${item.total} 题`,
      points: item.points,
      day: item.day,
      atMs: item.atMs,
      count: 1,
    });
  });

  const firstRecordingByTask = new Map();
  (records.submissions || []).filter(isUsableRecording).forEach((submission) => {
    const lessonId = String(submission.lessonId || "").trim();
    if (!lessonId) return;
    const version = Math.max(1, Math.trunc(asNumber(submission.homeworkTaskVersion, 1)));
    const taskKey = `${lessonId}:${version}`;
    const atMs = getDocumentTime(submission, ["createdAtMs", "createdAt"]);
    const current = firstRecordingByTask.get(taskKey);
    if (!current || (atMs && atMs < current.atMs)) firstRecordingByTask.set(taskKey, { submission, atMs });
  });
  Array.from(firstRecordingByTask.entries()).forEach(([taskKey, item]) => {
    const day = getLearningDay(item.atMs);
    addEvent({
      key: `recording:${taskKey}`,
      type: "recording",
      title: "完成一次录音提交",
      points: POINT_RULES.recordingPerTask,
      day,
      atMs: item.atMs,
      count: 1,
    });
  });

  let homeworkCount = 0;
  lessonRecords.forEach((lesson) => {
    if (!isTeacherConfirmedHomework(lesson)) return;
    const atMs = getDocumentTime(lesson, ["homeworkCompletedAtMs", "homeworkTeacherReviewedAtMs", "updatedAt"]);
    if (!atMs) return;
    homeworkCount += 1;
    addEvent({
      key: `homework:${lesson._id || homeworkCount}`,
      type: "homework",
      title: `老师确认完成：${String(lesson.title || "课后任务")}`,
      points: POINT_RULES.homeworkConfirmed,
      day: getLearningDay(atMs),
      atMs,
      count: 1,
    });
  });

  const completedKetByTask = new Map();
  (records.ketMockSessions || []).forEach((session) => {
    if (["submitted", "reviewed"].indexOf(session.status) < 0) return;
    const lessonId = String(session.lessonId || "").trim();
    if (!lessonId) return;
    const version = Math.max(1, Math.trunc(asNumber(session.homeworkTaskVersion, 1)));
    const taskKey = `${lessonId}:${version}`;
    const atMs = getDocumentTime(session, ["submittedAtMs", "reviewedAtMs", "createdAt"]);
    const current = completedKetByTask.get(taskKey);
    if (!current || (atMs && atMs < current.atMs)) completedKetByTask.set(taskKey, { session, atMs });
  });
  Array.from(completedKetByTask.entries()).forEach(([taskKey, item]) => {
    addEvent({
      key: `ket:${taskKey}`,
      type: "ket",
      title: "完成一次 KET 口语模拟",
      points: POINT_RULES.ketMockCompleted,
      day: getLearningDay(item.atMs),
      atMs: item.atMs,
      count: 1,
    });
  });

  let frenchActivityCount = 0;
  (records.frenchProgress || []).forEach((item) => {
    if (item.contentType !== "daily") return;
    const count = clamp(
      Math.max(0, Math.round(asNumber(item.activityCount, item.reviewActionCount))),
      0,
      POINT_RULES.frenchDailyCap
    );
    if (!count) return;
    const day = parseDateKeyToLearningDay(item.contentId)
      || getLearningDay(getDocumentTime(item, ["lastActivityAtMs", "updatedAt", "createdAt"]));
    frenchActivityCount += count;
    addEvent({
      key: `french:${day}`,
      type: "french",
      title: `完成 ${count} 项法语学习`,
      points: count * POINT_RULES.frenchPerActivity,
      day,
      atMs: getDocumentTime(item, ["lastActivityAtMs", "updatedAt", "createdAt"]),
      count,
    });
  });

  const week = getWeekWindow(nowMs);
  const totalPoints = events.reduce((sum, item) => sum + item.points, 0);
  const weeklyPoints = events
    .filter((item) => item.day >= week.startDay && item.day <= week.endDay)
    .reduce((sum, item) => sum + item.points, 0);
  const totalsByType = events.reduce((result, event) => {
    const current = result[event.type] || { points: 0, count: 0 };
    current.points += event.points;
    current.count += event.count;
    result[event.type] = current;
    return result;
  }, {});
  const breakdownDefinitions = [
    { key: "vocabulary", label: "英语单词", detail: `累计复习 ${reviewedWordCount} 个，每天最多计 ${POINT_RULES.vocabularyDailyCap} 个` },
    { key: "quiz", label: "单词小测", detail: `${bestQuizByDay.size} 个学习日，每天只计最好一轮` },
    { key: "recording", label: "录音练习", detail: `${firstRecordingByTask.size} 项，每节任务只计一次` },
    { key: "homework", label: "课后任务", detail: `${homeworkCount} 项，须由老师确认完成` },
    { key: "ket", label: "KET 模拟", detail: `${completedKetByTask.size} 套有效提交` },
    { key: "french", label: "法语学习", detail: `${frenchActivityCount} 项，每天最多计 ${POINT_RULES.frenchDailyCap} 项` },
  ];
  const pointsBreakdown = breakdownDefinitions
    .map((definition) => Object.assign({}, definition, totalsByType[definition.key] || { points: 0, count: 0 }))
    .filter((item) => item.points > 0);

  return {
    totalPoints,
    weeklyPoints,
    week,
    level: buildLevel(totalPoints),
    streakDays: getStreakDays(activeDays, nowMs),
    activeDayCount: activeDays.size,
    reviewedWordCount,
    quizDayCount: bestQuizByDay.size,
    recordingCount: firstRecordingByTask.size,
    homeworkCount,
    ketMockCount: completedKetByTask.size,
    frenchActivityCount,
    recordedLessonCount: new Set(lessonRecords.map((lesson, index) => (
      String(lesson && lesson._id || `lesson-${index + 1}`)
    ))).size,
    pointsBreakdown,
    events: events.sort((left, right) => right.atMs - left.atMs),
  };
};

const buildAchievements = (score, student = {}) => {
  const source = score || buildStudentScore();
  const completedLessonCount = Math.max(
    0,
    Math.round(asNumber(source.recordedLessonCount)),
    Math.round(asNumber(student.completedLessonCount))
  );
  const definitions = [
    { id: "first_step", mark: "启", title: "第一次出发", description: "留下第 1 天真实学习记录", current: source.activeDayCount, target: 1 },
    { id: "word_sprout", mark: "词", title: "单词小树苗", description: "累计完成 20 个英语单词复习", current: source.reviewedWordCount, target: 20 },
    { id: "quiz_beginner", mark: "测", title: "小测初体验", description: "完成第 1 天单词小测", current: source.quizDayCount, target: 1 },
    { id: "brave_voice", mark: "声", title: "勇敢开口", description: "完成第 1 项录音练习", current: source.recordingCount + source.ketMockCount, target: 1 },
    { id: "homework_finisher", mark: "任", title: "任务完成者", description: "获得老师第 1 次课后任务完成确认", current: source.homeworkCount, target: 1 },
    { id: "steady_three", mark: "3", title: "三日节奏", description: "连续 3 天留下学习记录", current: source.streakDays, target: 3 },
    { id: "steady_seven", mark: "7", title: "一周坚持", description: "连续 7 天留下学习记录", current: source.streakDays, target: 7 },
    { id: "points_hundred", mark: "星", title: "百积分新星", description: "累计获得 100 学习积分", current: source.totalPoints, target: 100 },
    { id: "ket_challenger", mark: "K", title: "KET 挑战者", description: "完成第 1 套 KET 口语模拟", current: source.ketMockCount, target: 1 },
    { id: "lesson_twenty", mark: "20", title: "二十课时里程碑", description: "累计完成 20 节课程，学习正在形成自己的节奏", current: completedLessonCount, target: 20 },
    { id: "lesson_forty", mark: "40", title: "四十课时进阶", description: "累计完成 40 节课程，把坚持变成长期成长", current: completedLessonCount, target: 40 },
  ];
  if (student.frenchLearningEnabled === true || source.frenchActivityCount > 0) {
    definitions.push({
      id: "french_explorer",
      mark: "FR",
      title: "法语探索者",
      description: "累计完成 10 项法语学习",
      current: source.frenchActivityCount,
      target: 10,
    });
  }
  return definitions.map((item) => {
    const current = Math.max(0, Math.round(asNumber(item.current)));
    const unlocked = current >= item.target;
    return Object.assign({}, item, {
      current,
      unlocked,
      progressPercent: clamp(Math.round(current / item.target * 100), 0, 100),
      progressText: unlocked ? "已获得" : `${Math.min(current, item.target)} / ${item.target}`,
    });
  });
};

const maskStudentName = (name) => {
  const text = String(name || "").trim();
  if (!text) return "同学";
  const first = Array.from(text)[0];
  return `${/[a-z]/i.test(first) ? first.toUpperCase() : first}同学`;
};

const isPkEligibleStudent = (student) => {
  if (!student || !student._id) return false;
  if (student.pkEnabled === false) return false;
  if (student.teacherHidden === true) return false;
  const status = String(student.status || "在读").trim();
  return !status || status === "在读";
};

const buildRankingRows = (ranked, currentStudentId) => {
  let previousPoints = null;
  let displayedRank = 0;
  return (ranked || []).map((item, index) => {
    const pkScore = Math.max(0, Math.round(asNumber(item.pkScore, item.score && item.score.weeklyPoints)));
    if (previousPoints === null || pkScore !== previousPoints) {
      displayedRank = index + 1;
      previousPoints = pkScore;
    }
    const isChallenge = item.participantType === "challenge";
    return {
      rowKey: isChallenge ? `challenge-${item.profile._id}` : `student-${item.student._id}`,
      rank: displayedRank,
      displayName: item.student._id === currentStudentId
        ? "我"
        : isChallenge ? item.profile.name : maskStudentName(item.student.name),
      weeklyPoints: pkScore,
      pkScore,
      verifiedWeeklyPoints: isChallenge ? 0 : item.score.weeklyPoints,
      isCurrent: item.student._id === currentStudentId,
      isChallenge,
      participantLabel: isChallenge ? "挑战选手" : "真实学习积分",
    };
  });
};

const buildEngagementDashboard = ({ participants = [], challengeProfiles = [], currentStudentId, nowMs = Date.now() } = {}) => {
  const scoredParticipants = (participants || [])
    .filter((item) => item && item.student && item.student._id)
    .map((item) => ({
      student: item.student,
      records: item.records || {},
      score: buildStudentScore(item.records || {}, nowMs),
      participantType: "student",
    }));
  const current = scoredParticipants.find((item) => item.student._id === currentStudentId);
  if (!current) return null;
  const challengeParticipants = (challengeProfiles || [])
    .map((profile) => normalizePkChallengeProfile(profile))
    .filter((profile) => profile._id && profile.name && profile.enabled)
    .map((profile) => {
      const challengeScore = getPkChallengeScore(profile, nowMs).score;
      return {
        participantType: "challenge",
        profile,
        student: { _id: `challenge:${profile._id}`, name: profile.name },
        score: { weeklyPoints: challengeScore, totalPoints: challengeScore },
        pkScore: challengeScore,
      };
    });
  const eligible = scoredParticipants
    .filter((item) => isPkEligibleStudent(item.student))
    .map((item) => Object.assign({}, item, { pkScore: item.score.weeklyPoints }))
    .concat(challengeParticipants);
  const sortRanked = (items) => items.slice().sort((left, right) => (
    right.pkScore - left.pkScore
    || Number(right.score.totalPoints || 0) - Number(left.score.totalPoints || 0)
    || String(left.student._id).localeCompare(String(right.student._id))
  ));
  const pkPolicy = {
    realStudentRule: "真实学生 PK 分由本周可核验学习积分按 1:1 生成",
    challengeRule: "挑战选手由教师设置周一起始分和每日增幅，并在榜单中明确标注",
  };
  const ketScoreTrend = ketMock.buildScoreTrend(current.records.ketMockSessions || []);
  if (!isPkEligibleStudent(current.student)) {
    const achievements = buildAchievements(current.score, current.student);
    const inactiveRanking = sortRanked(eligible);
    return {
      totalPoints: current.score.totalPoints,
      weeklyPoints: current.score.weeklyPoints,
      pkScore: current.score.weeklyPoints,
      level: current.score.level,
      streakDays: current.score.streakDays,
      activeDayCount: current.score.activeDayCount,
      weekLabel: current.score.week.label,
      weeklyRank: 0,
      participantCount: eligible.length,
      challengeParticipantCount: challengeParticipants.length,
      distanceToNext: 0,
      pkMessage: "当前学习状态不参与本周同学 PK",
      achievements,
      unlockedAchievementCount: achievements.filter((item) => item.unlocked).length,
      pointsBreakdown: current.score.pointsBreakdown,
      weeklyRanking: buildRankingRows(inactiveRanking, ""),
      recentPoints: current.score.events.slice(0, 8).map((event) => ({
        key: event.key,
        title: event.title,
        points: event.points,
        dateLabel: getDateKeyForLearningDay(event.day).slice(5).replace("-", "/"),
      })),
      rules: POINT_RULES,
      pkPolicy,
      ketScoreTrend,
    };
  }
  const ranked = sortRanked(eligible);
  const currentIndex = ranked.findIndex((item) => item.student._id === currentStudentId);
  const next = currentIndex > 0
    ? ranked.slice(0, currentIndex).reverse().find((item) => item.pkScore > current.score.weeklyPoints) || null
    : null;
  const weeklyRanking = buildRankingRows(ranked, currentStudentId);
  const currentRanking = weeklyRanking.find((item) => item.isCurrent);
  const tiedForLead = currentRanking && currentRanking.rank === 1
    && ranked.filter((item) => item.pkScore === current.score.weeklyPoints).length > 1;
  const achievements = buildAchievements(current.score, current.student);
  return {
    totalPoints: current.score.totalPoints,
    weeklyPoints: current.score.weeklyPoints,
    pkScore: current.score.weeklyPoints,
    level: current.score.level,
    streakDays: current.score.streakDays,
    activeDayCount: current.score.activeDayCount,
    weekLabel: current.score.week.label,
    weeklyRank: currentRanking ? currentRanking.rank : currentIndex + 1,
    participantCount: ranked.length,
    challengeParticipantCount: challengeParticipants.length,
    distanceToNext: next ? Math.max(0, next.pkScore - current.score.weeklyPoints + 1) : 0,
    pkMessage: next
      ? `再得 ${Math.max(0, next.pkScore - current.score.weeklyPoints + 1)} 分可以超过上一名`
      : tiedForLead
        ? "本周并列领先，再得 1 分就能单独领先"
        : ranked.length > 1 ? "本周暂时领先，继续保持" : "有更多同学学习后，这里会出现本周 PK",
    achievements,
    unlockedAchievementCount: achievements.filter((item) => item.unlocked).length,
    pointsBreakdown: current.score.pointsBreakdown,
    weeklyRanking,
    recentPoints: current.score.events.slice(0, 8).map((event) => ({
      key: event.key,
      title: event.title,
      points: event.points,
      dateLabel: getDateKeyForLearningDay(event.day).slice(5).replace("-", "/"),
    })),
    rules: POINT_RULES,
    pkPolicy,
    ketScoreTrend,
  };
};

const buildReminderActivities = ({ reminders = [], viewedThroughAtMs = 0, nowMs = Date.now() } = {}) => {
  const cutoffAtMs = Math.max(
    Math.max(0, asNumber(viewedThroughAtMs)),
    asNumber(nowMs, Date.now()) - REMINDER_VISIBLE_DAYS * DAY_MS
  );
  return (reminders || [])
    .filter((reminder) => reminder && reminder.status === "active")
    .map((reminder) => {
      const activityAtMs = getDocumentTime(reminder, ["updatedAtMs", "createdAtMs", "updatedAt", "createdAt"]);
      return {
        _id: `reminder:${reminder._id || activityAtMs}:${activityAtMs}`,
        reminderId: reminder._id || "",
        activityType: "teacherReminder",
        title: String(reminder.title || "老师提醒").trim().slice(0, 40),
        activityText: String(reminder.content || "").trim().slice(0, 300),
        activityAtMs,
      };
    })
    .filter((activity) => activity.activityText && activity.activityAtMs > cutoffAtMs)
    .sort((left, right) => right.activityAtMs - left.activityAtMs);
};

module.exports = {
  DAY_MS,
  LEVELS,
  PK_CHALLENGE_LIMITS,
  POINT_RULES,
  REMINDER_VISIBLE_DAYS,
  buildAchievements,
  buildEngagementDashboard,
  buildLevel,
  buildReminderActivities,
  buildStudentScore,
  getPkChallengeScore,
  getLearningDay,
  getStreakDays,
  getWeekWindow,
  isPkEligibleStudent,
  maskStudentName,
  normalizePkChallengeProfile,
  parseDateKeyToLearningDay,
};
