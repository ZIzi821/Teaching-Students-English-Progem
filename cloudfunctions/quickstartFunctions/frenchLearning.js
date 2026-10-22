const crypto = require("crypto");
const frenchContent = require("./frenchContent");
const {
  buildFrenchContent,
  filterByLevel,
  normalizeFrenchSearch,
} = frenchContent;
const {
  ALGORITHM_VERSION,
  DAY_MS,
  buildRetentionCurve,
  getDifficultyScore,
  getMemorySnapshot,
  migrateLegacyProgress,
  normalizeProgress,
  scheduleReview,
} = require("./frenchReviewEngine");
const {
  DEFAULT_PREFERENCES,
  buildContentSummary,
  buildDashboard,
  getDateKey,
  getLocalDayStartMs,
  normalizePreferences,
} = require("./frenchAnalytics");

// French content and progress remain deliberately separate from the English
// vocabulary module. Canonical French keys keep NFC accents, so `a`/`à` and
// `ou`/`où` can never collapse to the same learning record.
const FRENCH_PROGRESS_COLLECTION = "frenchLearningProgress";
const PROGRESS_PAGE_SIZE = 100;
const REVIEW_RESULTS = new Set(["again", "hard", "good", "easy"]);
const ACTIVITY_TYPES = new Set(["grammar", "expression", "sentence", "reading", "writing"]);
const SESSION_GAP_MS = 30 * 60 * 1000;

const makeHash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const asString = (value) => String(value === undefined || value === null ? "" : value).trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getProgressId = (learnerKey, contentType, contentId) => (
  makeHash(`french-learning-v1|${learnerKey}|${contentType}|${contentId}`)
);

const getDocumentOrNull = async (database, collectionName, id) => {
  try {
    const result = await database.collection(collectionName).doc(id).get();
    return result && result.data ? result.data : null;
  } catch (err) {
    const code = asString(err && (err.code || err.errCode));
    const message = asString(err && (err.message || err.errMsg));
    if (/not.?found|not.?exist|document.?missing/i.test(`${code} ${message}`)) return null;
    throw err;
  }
};

const withoutDocumentId = (value) => {
  const result = Object.assign({}, value || {});
  delete result._id;
  return result;
};

const reviewFieldsForPersistence = (progress) => {
  const source = normalizeProgress(progress);
  const fields = {
    algorithmVersion: ALGORITHM_VERSION,
    state: source.state,
    repetitions: source.repetitions,
    successfulReviews: source.successfulReviews,
    lapses: source.lapses,
    hardCount: source.hardCount,
    difficulty: source.difficulty,
    stabilityDays: source.stabilityDays,
    currentIntervalDays: source.currentIntervalDays,
    reviewCount: source.reviewCount,
    lastRating: source.lastRating,
    lastResult: source.lastResult || source.lastRating,
    lastReviewedAtMs: source.lastReviewedAtMs,
    nextReviewAtMs: source.nextReviewAtMs,
    reviewHistory: asArray(source.reviewHistory).slice(-30),
  };
  if (source.migratedFromAlgorithmVersion) {
    fields.migratedFromAlgorithmVersion = source.migratedFromAlgorithmVersion;
  }
  return fields;
};

const getStageCompatibility = (progress) => {
  const stability = Math.max(0, asNumber(progress && progress.stabilityDays));
  if (stability >= 30) return 5;
  if (stability >= 14) return 4;
  if (stability >= 7) return 3;
  if (stability >= 3) return 2;
  if (stability >= 1) return 1;
  return 0;
};

const getProgressRecords = async (db, learnerKey) => {
  const records = [];
  let offset = 0;
  while (true) {
    let query = db.collection(FRENCH_PROGRESS_COLLECTION).where({ learnerKey });
    if (offset > 0) {
      if (typeof query.skip !== "function") break;
      query = query.skip(offset);
    }
    const result = await query.limit(PROGRESS_PAGE_SIZE).get();
    const page = asArray(result && result.data);
    records.push(...page);
    if (page.length < PROGRESS_PAGE_SIZE) break;
    offset += page.length;
  }
  return records;
};

const progressRecordsToMap = (records) => new Map(asArray(records)
  .filter((item) => item && item.contentType && item.contentId)
  .map((item) => [`${item.contentType}:${item.contentId}`, item]));

const migrateLegacyWordRecords = async (db, records, nowMs, { persist = true } = {}) => {
  const migratedRecords = [];
  const pendingWrites = [];
  asArray(records).forEach((record) => {
    if (!record || record.contentType !== "word" || record.algorithmVersion === ALGORITHM_VERSION) {
      migratedRecords.push(record);
      return;
    }
    const migrated = Object.assign({}, record, migrateLegacyProgress(record, nowMs));
    migratedRecords.push(migrated);
    const documentId = record._id || getProgressId(record.learnerKey, "word", record.contentId);
    if (persist) pendingWrites.push({ documentId, migrated });
  });
  for (let start = 0; start < pendingWrites.length; start += 10) {
    const batch = pendingWrites.slice(start, start + 10);
    await Promise.all(batch.map(async ({ documentId, migrated }) => {
      try {
        await db.collection(FRENCH_PROGRESS_COLLECTION).doc(documentId).update({
          data: Object.assign(reviewFieldsForPersistence(migrated), {
            migrationAtMs: nowMs,
            updatedAt: db.serverDate(),
          }),
        });
      } catch (err) {
        console.warn("French progress lazy migration will retry", {
          documentId,
          message: err && err.message,
        });
      }
    }));
  }
  return migratedRecords;
};

const getProgressState = async (
  db,
  learnerKey,
  nowMs = Date.now(),
  { persistMigrations = true } = {}
) => {
  const records = await getProgressRecords(db, learnerKey);
  const migratedRecords = await migrateLegacyWordRecords(db, records, nowMs, {
    persist: persistMigrations,
  });
  const progressByKey = progressRecordsToMap(migratedRecords);
  return {
    records: migratedRecords,
    progressByKey,
    preferences: normalizePreferences(progressByKey.get("settings:profile")),
  };
};

const toPublicProgress = (progress, nowMs) => {
  const normalized = normalizeProgress(progress, nowMs);
  const memory = getMemorySnapshot(normalized, nowMs);
  return {
    algorithmVersion: memory.algorithmVersion,
    state: memory.state,
    stage: getStageCompatibility(normalized),
    reviewCount: memory.reviewCount,
    successfulReviews: normalized.successfulReviews || 0,
    repetitions: normalized.repetitions || 0,
    lapses: memory.lapses,
    hardCount: memory.hardCount,
    difficulty: memory.difficulty,
    stabilityDays: memory.stabilityDays,
    currentIntervalDays: memory.currentIntervalDays,
    estimatedRetention: memory.estimatedRetention,
    estimatedRetentionPercent: memory.estimatedRetentionPercent,
    lastRating: memory.lastRating,
    lastResult: memory.lastRating,
    lastReviewedAtMs: memory.lastReviewedAtMs,
    nextReviewAtMs: memory.nextReviewAtMs,
    isDue: memory.reviewCount > 0 && memory.nextReviewAtMs <= nowMs,
    isNew: memory.reviewCount === 0,
  };
};

const publicWord = (word, progress, nowMs) => ({
  id: word.id,
  key: word.lemma,
  lemma: word.lemma,
  text: word.displayForm,
  display: word.displayForm,
  displayForm: word.displayForm,
  meaning: asString(word.meaningCN || word.meaning),
  meaningCN: asString(word.meaningCN || word.meaning),
  meaningEN: asString(word.meaningEN),
  partOfSpeech: asString(word.partOfSpeech),
  cefrLevel: word.cefrLevel,
  topic: word.topic,
  topicLabel: frenchContent.TOPIC_LABELS[word.topic] || word.topic,
  ipa: asString(word.ipa),
  article: word.article || null,
  gender: word.gender || null,
  plural: word.plural || null,
  exampleSentence: asString(word.exampleSentence),
  exampleMeaningCN: asString(word.exampleMeaningCN),
  contentDifficulty: Math.max(1, asNumber(word.difficulty, 1)),
  tags: asArray(word.tags),
  audioKey: asString(word.audioKey),
  audioRef: asString(word.audioRef),
  source: word.source || null,
  provenance: asString(word.provenance),
  searchIndex: word.searchIndex,
  order: asNumber(word.order),
  progress: toPublicProgress(progress, nowMs),
});

const publicActivity = (item, progress) => {
  const result = Object.assign({}, item, {
    progress: {
      completed: Boolean(progress && progress.completed),
      repeatCount: Math.max(0, asNumber(progress && progress.repeatCount)),
      completedAtMs: Math.max(0, asNumber(progress && progress.completedAtMs)),
      lastPracticedAtMs: Math.max(0, asNumber(progress && progress.lastPracticedAtMs)),
      correctCount: Math.max(0, asNumber(progress && progress.correctCount)),
      questionCount: Math.max(0, asNumber(progress && progress.questionCount)),
      lastCorrect: progress && typeof progress.lastCorrect === "boolean" ? progress.lastCorrect : null,
    },
  });
  delete result._sequence;
  return result;
};

const buildDailySpotlight = (content, nowMs, preferences, dashboard) => {
  const a1Progress = asArray(dashboard && dashboard.levelProgress)
    .find((item) => item && item.cefrLevel === "A1");
  const targetLevel = preferences.targetLevel === "A1"
    || !a1Progress
    || asNumber(a1Progress.overallPercent) < 70
    ? "A1"
    : "A2";
  let candidates = asArray(content.sentences).filter((item) => item.cefrLevel === targetLevel);
  if (!candidates.length) candidates = asArray(content.sentences);
  if (!candidates.length) return null;
  const localDayNumber = Math.floor(
    getLocalDayStartMs(nowMs, preferences.timezoneOffsetMinutes) / DAY_MS
  );
  const item = candidates[
    ((localDayNumber % candidates.length) + candidates.length) % candidates.length
  ];
  return {
    id: item.id,
    cefrLevel: item.cefrLevel,
    topic: item.topic,
    text: asString(item.text || item.sentence),
    translationCN: asString(item.translationCN || item.meaningCN || item.translation || item.meaning),
    noteCN: asString(item.cueCN || item.note || item.cue),
    audioKey: asString(item.audioKey),
  };
};

const incrementDailyStats = (current, details) => {
  const {
    learnerKey,
    learnerType,
    nowMs,
    contentType,
    rating,
    isNewWord = false,
    cefrLevel,
  } = details;
  const existing = current || {};
  const isReview = contentType === "word";
  const isSuccessfulRecall = isReview && rating !== "again";
  const sessionIncrement = !asNumber(existing.lastActivityAtMs)
    || nowMs - asNumber(existing.lastActivityAtMs) > SESSION_GAP_MS
    ? 1
    : 0;
  const result = Object.assign({}, withoutDocumentId(existing), {
    learnerKey,
    learnerType,
    contentType: "daily",
    contentId: existing.contentId,
    activityCount: Math.max(0, asNumber(existing.activityCount)) + 1,
    reviewActionCount: Math.max(0, asNumber(existing.reviewActionCount)) + (isReview ? 1 : 0),
    successfulRecallCount: Math.max(0, asNumber(existing.successfulRecallCount)) + (isSuccessfulRecall ? 1 : 0),
    newWordCount: Math.max(0, asNumber(existing.newWordCount)) + (isNewWord ? 1 : 0),
    againCount: Math.max(0, asNumber(existing.againCount)) + (rating === "again" ? 1 : 0),
    hardCount: Math.max(0, asNumber(existing.hardCount)) + (rating === "hard" ? 1 : 0),
    goodCount: Math.max(0, asNumber(existing.goodCount)) + (rating === "good" ? 1 : 0),
    easyCount: Math.max(0, asNumber(existing.easyCount)) + (rating === "easy" ? 1 : 0),
    studySessionCount: Math.max(0, asNumber(existing.studySessionCount)) + sessionIncrement,
    lastActivityAtMs: nowMs,
  });
  const fieldPrefix = contentType === "word" ? "word" : contentType;
  result[`${fieldPrefix}ActivityCount`] = Math.max(0, asNumber(existing[`${fieldPrefix}ActivityCount`])) + 1;
  if (cefrLevel === "A1" || cefrLevel === "A2") {
    const levelKey = cefrLevel.toLowerCase();
    result[`${levelKey}ActivityCount`] = Math.max(0, asNumber(existing[`${levelKey}ActivityCount`])) + 1;
  }
  return result;
};

const createFrenchLearningService = ({ db, cloud, getIdentity, createError, isPrimaryTeacherOpenId }) => {
  const ensureProgressCollection = async () => {
    try {
      await db.createCollection(FRENCH_PROGRESS_COLLECTION);
    } catch (err) {
      // CloudBase reports an error when the collection already exists.
    }
  };

  const getLearner = async (event, { allowDisabled = false } = {}) => {
    const identity = await getIdentity();
    const data = (event && event.data) || {};
    const isTeacherPreview = data.mode === "teacherPreview";
    if (isTeacherPreview && identity.role !== "teacher") {
      throw createError("PERMISSION_DENIED", "请使用教师账号进入学生视角");
    }
    if (identity.role === "teacher" && isTeacherPreview) {
      const studentId = asString(data.previewStudentId || data.studentId);
      if (!studentId) throw createError("INVALID_STUDENT", "请选择要预览的学生");
      const studentResult = await db.collection("students").doc(studentId).get();
      const student = studentResult && studentResult.data;
      if (!student) throw createError("INVALID_STUDENT", "学生信息不存在或已删除");
      const assignedTeacherOpenId = asString(student.teacherOpenId || student.ownerOpenId);
      if (assignedTeacherOpenId && assignedTeacherOpenId !== identity.openid) {
        throw createError("PERMISSION_DENIED", "请从负责该学生的教师账号进入法语预览");
      }
      if (
        !assignedTeacherOpenId
        && (typeof isPrimaryTeacherOpenId !== "function" || !isPrimaryTeacherOpenId(identity.openid))
      ) {
        throw createError("PERMISSION_DENIED", "旧学生资料缺少教师归属，请由主管老师先完成迁移");
      }
      const enabled = student.frenchLearningEnabled === true;
      if (!enabled && !allowDisabled) {
        throw createError("FRENCH_LEARNING_DISABLED", "这位学生的法语学习功能尚未开启");
      }
      return {
        identity,
        student,
        learnerType: "student",
        learnerKey: `student:${student._id}`,
        enabled,
        readOnly: true,
        isTeacherPreview: true,
      };
    }
    if (identity.role === "teacher") {
      return {
        identity,
        learnerType: "teacher",
        learnerKey: `teacher:${makeHash(identity.openid)}`,
        enabled: true,
        readOnly: false,
        isTeacherPreview: false,
      };
    }
    if (identity.role !== "student" || !identity.student || !identity.student._id) {
      throw createError("PERMISSION_DENIED", "请先绑定学习账号");
    }
    const studentResult = await db.collection("students").doc(identity.student._id).get();
    const student = studentResult && studentResult.data;
    if (!student) throw createError("INVALID_STUDENT", "学生信息不存在或已删除");
    const enabled = student.frenchLearningEnabled === true;
    if (!enabled && !allowDisabled) {
      throw createError("FRENCH_LEARNING_DISABLED", "法语学习功能尚未开启");
    }
    return {
      identity,
      student,
      learnerType: "student",
      learnerKey: `student:${student._id}`,
      enabled,
      readOnly: false,
      isTeacherPreview: false,
    };
  };

  const ensureWritableLearner = (learner) => {
    if (learner && learner.readOnly) {
      throw createError("TEACHER_PREVIEW_READ_ONLY", "当前为老师预览，学生法语学习记录保持原状态");
    }
  };

  const getOverview = async (event) => {
    const learner = await getLearner(event, { allowDisabled: true });
    if (!learner.enabled) {
      return {
        success: true,
        role: learner.identity.role,
        isTeacher: false,
        enabled: false,
        topics: [],
        wordSummary: { totalCount: 0, reviewedCount: 0, masteredCount: 0, dueCount: 0, newCount: 0 },
        sentenceSummary: { totalCount: 0, completedCount: 0, repeatCount: 0 },
        dashboard: null,
      };
    }
    if (!learner.readOnly) await ensureProgressCollection();
    const nowMs = Date.now();
    const content = buildFrenchContent(createError);
    const state = await getProgressState(db, learner.learnerKey, nowMs, {
      persistMigrations: !learner.readOnly,
    });
    const dashboard = buildDashboard(content, state.progressByKey, nowMs, state.preferences);
    return Object.assign({
      success: true,
      role: learner.identity.role,
      isTeacher: learner.identity.role === "teacher",
      enabled: true,
      topics: content.topics,
      learnerName: learner.student ? asString(learner.student.name) : "",
      isTeacherPreview: learner.isTeacherPreview,
      dashboard,
      dailySpotlight: buildDailySpotlight(content, nowMs, state.preferences, dashboard),
    }, buildContentSummary(content, state.progressByKey, nowMs));
  };

  const getDashboard = async (event) => {
    const learner = await getLearner(event);
    if (!learner.readOnly) await ensureProgressCollection();
    const nowMs = Date.now();
    const content = buildFrenchContent(createError);
    const state = await getProgressState(db, learner.learnerKey, nowMs, {
      persistMigrations: !learner.readOnly,
    });
    return {
      success: true,
      enabled: true,
      dashboard: buildDashboard(content, state.progressByKey, nowMs, state.preferences),
      summary: buildContentSummary(content, state.progressByKey, nowMs),
    };
  };

  const getWords = async (event) => {
    const learner = await getLearner(event);
    if (!learner.readOnly) await ensureProgressCollection();
    const data = (event && event.data) || {};
    const level = asString(data.level).toUpperCase();
    const query = normalizeFrenchSearch(data.query);
    const nowMs = Date.now();
    const content = buildFrenchContent(createError);
    const state = await getProgressState(db, learner.learnerKey, nowMs, {
      persistMigrations: !learner.readOnly,
    });
    let words = filterByLevel(content.words, level);
    if (query) words = words.filter((word) => word.searchIndex.includes(query));
    words = words
      .slice()
      .sort((left, right) => left._sequence - right._sequence)
      .map((word) => publicWord(word, state.progressByKey.get(`word:${word.id}`), nowMs));
    const memoryCounts = { new: 0, learning: 0, review: 0, mastered: 0 };
    words.forEach((word) => { memoryCounts[word.progress.state] += 1; });
    return {
      success: true,
      enabled: true,
      selectedLevel: level || "ALL",
      words,
      summary: {
        totalCount: words.length,
        dueCount: words.filter((word) => word.progress.isDue).length,
        reviewedCount: words.filter((word) => !word.progress.isNew).length,
        masteredCount: memoryCounts.mastered,
        memoryCounts,
      },
    };
  };

  const getReviewQueue = async (event) => {
    const learner = await getLearner(event);
    if (!learner.readOnly) await ensureProgressCollection();
    const data = (event && event.data) || {};
    const level = asString(data.level).toUpperCase();
    const reviewMode = asString(data.mode).toLowerCase();
    const difficultyOnly = data.difficultyOnly === true || reviewMode === "difficult";
    const nowMs = Date.now();
    const content = buildFrenchContent(createError);
    const state = await getProgressState(db, learner.learnerKey, nowMs, {
      persistMigrations: !learner.readOnly,
    });
    const todayStartMs = getLocalDayStartMs(nowMs, state.preferences.timezoneOffsetMinutes);
    const todayKey = getDateKey(nowMs, state.preferences.timezoneOffsetMinutes);
    const todayRecord = state.progressByKey.get(`daily:${todayKey}`) || {};
    const remainingNew = Math.max(
      0,
      state.preferences.dailyNewWordLimit - Math.max(0, asNumber(todayRecord.newWordCount))
    );
    const words = filterByLevel(content.words, level)
      .map((word) => publicWord(word, state.progressByKey.get(`word:${word.id}`), nowMs));
    if (difficultyOnly) {
      const queue = words
        .filter((word) => !word.progress.isNew)
        .map((word) => ({
          word,
          score: getDifficultyScore(state.progressByKey.get(`word:${word.id}`), nowMs),
        }))
        .filter(({ word, score }) => (
          score >= 8
          || word.progress.lapses > 0
          || word.progress.hardCount >= 2
          || word.progress.difficulty >= 7
        ))
        .sort((left, right) => right.score - left.score
          || right.word.progress.lapses - left.word.progress.lapses
          || left.word.displayForm.localeCompare(right.word.displayForm, "fr"))
        .slice(0, 20)
        .map(({ word }) => word);
      return {
        success: true,
        enabled: true,
        selectedLevel: level || "ALL",
        reviewMode: "difficult",
        queue,
        counts: {
          total: queue.length,
          difficult: queue.length,
          dueToday: queue.filter((word) => word.progress.isDue).length,
          new: 0,
          newRemainingToday: remainingNew,
        },
        preferences: state.preferences,
      };
    }
    const due = words.filter((word) => word.progress.isDue).sort((left, right) => {
      const leftOverdue = left.progress.nextReviewAtMs < todayStartMs ? 0 : 1;
      const rightOverdue = right.progress.nextReviewAtMs < todayStartMs ? 0 : 1;
      return leftOverdue - rightOverdue
        || left.progress.nextReviewAtMs - right.progress.nextReviewAtMs
        || getDifficultyScore(state.progressByKey.get(`word:${right.id}`), nowMs)
          - getDifficultyScore(state.progressByKey.get(`word:${left.id}`), nowMs);
    });
    const newWords = words.filter((word) => word.progress.isNew).slice(0, remainingNew);
    const queue = due.concat(newWords);
    return {
      success: true,
      enabled: true,
      selectedLevel: level || "ALL",
      reviewMode: "daily",
      queue,
      counts: {
        total: queue.length,
        overdue: due.filter((word) => word.progress.nextReviewAtMs < todayStartMs).length,
        dueToday: due.length,
        learning: due.filter((word) => word.progress.state === "learning").length,
        difficult: due.filter((word) => (
          word.progress.lapses > 0 || word.progress.hardCount >= 2 || word.progress.difficulty >= 7
        )).length,
        new: newWords.length,
        newRemainingToday: remainingNew,
      },
      preferences: state.preferences,
    };
  };

  const reviewWord = async (event) => {
    const learner = await getLearner(event);
    ensureWritableLearner(learner);
    if (!learner.readOnly) await ensureProgressCollection();
    const data = (event && event.data) || {};
    const wordId = asString(data.wordId);
    const rating = asString(data.result || data.rating).toLowerCase();
    if (!wordId) throw createError("INVALID_FRENCH_WORD", "单词信息不完整，请返回后重试");
    if (!REVIEW_RESULTS.has(rating)) {
      throw createError("INVALID_FRENCH_REVIEW", "请选择没记住、有点难、记住了或太简单");
    }
    const content = buildFrenchContent(createError);
    const word = content.wordById.get(wordId);
    if (!word) throw createError("INVALID_FRENCH_WORD", "该法语单词已更新，请刷新后重试");
    const nowMs = Date.now();
    const preferencesId = getProgressId(learner.learnerKey, "settings", "profile");
    const preferences = normalizePreferences(
      await getDocumentOrNull(db, FRENCH_PROGRESS_COLLECTION, preferencesId)
    );
    const dayKey = getDateKey(nowMs, preferences.timezoneOffsetMinutes);
    const progressId = getProgressId(learner.learnerKey, "word", wordId);
    const dailyId = getProgressId(learner.learnerKey, "daily", dayKey);
    const result = await db.runTransaction(async (transaction) => {
      const existing = await getDocumentOrNull(transaction, FRENCH_PROGRESS_COLLECTION, progressId);
      const scheduled = scheduleReview(existing, rating, nowMs);
      const progress = Object.assign({}, reviewFieldsForPersistence(scheduled), {
        learnerKey: learner.learnerKey,
        learnerType: learner.learnerType,
        contentType: "word",
        contentId: wordId,
        cefrLevel: word.cefrLevel,
        stage: getStageCompatibility(scheduled),
        createdAt: existing && existing.createdAt ? existing.createdAt : db.serverDate(),
        updatedAt: db.serverDate(),
      });
      await transaction.collection(FRENCH_PROGRESS_COLLECTION).doc(progressId).set({ data: progress });
      const existingDaily = await getDocumentOrNull(transaction, FRENCH_PROGRESS_COLLECTION, dailyId);
      const daily = incrementDailyStats(Object.assign({ contentId: dayKey }, existingDaily), {
        learnerKey: learner.learnerKey,
        learnerType: learner.learnerType,
        nowMs,
        contentType: "word",
        rating,
        isNewWord: !existing || !asNumber(existing.reviewCount),
        cefrLevel: word.cefrLevel,
      });
      daily.updatedAt = db.serverDate();
      await transaction.collection(FRENCH_PROGRESS_COLLECTION).doc(dailyId).set({ data: daily });
      return { progress, daily };
    });
    return {
      success: true,
      progress: toPublicProgress(result.progress, nowMs),
      today: result.daily,
    };
  };

  const getActivities = async (event, contentType) => {
    const learner = await getLearner(event);
    if (!learner.readOnly) await ensureProgressCollection();
    const data = (event && event.data) || {};
    const level = asString(data.level).toUpperCase();
    const content = buildFrenchContent(createError);
    const source = content.byType.get(contentType);
    if (!source) throw createError("INVALID_FRENCH_CONTENT", "学习内容类型无效");
    const state = await getProgressState(db, learner.learnerKey, Date.now(), {
      persistMigrations: !learner.readOnly,
    });
    const items = filterByLevel(source, level)
      .slice()
      .sort((left, right) => left._sequence - right._sequence)
      .map((item) => publicActivity(item, state.progressByKey.get(`${contentType}:${item.id}`)));
    return {
      success: true,
      enabled: true,
      selectedLevel: level || "ALL",
      contentType,
      items,
      summary: {
        totalCount: items.length,
        completedCount: items.filter((item) => item.progress.completed).length,
      },
    };
  };

  const completeActivity = async (event, forcedType) => {
    const learner = await getLearner(event);
    ensureWritableLearner(learner);
    await ensureProgressCollection();
    const data = (event && event.data) || {};
    const contentType = forcedType || asString(data.contentType);
    const contentId = asString(data.contentId || data.sentenceId || data.id);
    if (!ACTIVITY_TYPES.has(contentType) || !contentId) {
      throw createError("INVALID_FRENCH_ACTIVITY", "学习记录信息不完整，请返回后重试");
    }
    const content = buildFrenchContent(createError);
    const itemMap = content.mapsByType.get(contentType);
    const item = itemMap && itemMap.get(contentId);
    if (!item) throw createError("INVALID_FRENCH_ACTIVITY", "该学习内容已更新，请刷新后重试");
    const nowMs = Date.now();
    const preferencesId = getProgressId(learner.learnerKey, "settings", "profile");
    const preferences = normalizePreferences(
      await getDocumentOrNull(db, FRENCH_PROGRESS_COLLECTION, preferencesId)
    );
    const dayKey = getDateKey(nowMs, preferences.timezoneOffsetMinutes);
    const progressId = getProgressId(learner.learnerKey, contentType, contentId);
    const dailyId = getProgressId(learner.learnerKey, "daily", dayKey);
    const result = await db.runTransaction(async (transaction) => {
      const existing = await getDocumentOrNull(transaction, FRENCH_PROGRESS_COLLECTION, progressId);
      const completed = Boolean(existing && existing.completed)
        || contentType !== "writing"
        || data.correct === true;
      const progress = {
        learnerKey: learner.learnerKey,
        learnerType: learner.learnerType,
        contentType,
        contentId,
        cefrLevel: item.cefrLevel,
        completed,
        completedAtMs: completed
          ? (existing && existing.completedAtMs ? existing.completedAtMs : nowMs)
          : 0,
        lastPracticedAtMs: nowMs,
        repeatCount: Math.max(0, asNumber(existing && existing.repeatCount)) + 1,
        correctCount: Math.max(0, asNumber(existing && existing.correctCount))
          + Math.max(0, asNumber(data.correctCount, data.correct === true ? 1 : 0)),
        questionCount: Math.max(0, asNumber(existing && existing.questionCount))
          + Math.max(0, asNumber(data.questionCount, typeof data.correct === "boolean" ? 1 : 0)),
        lastCorrect: typeof data.correct === "boolean" ? data.correct : null,
        createdAt: existing && existing.createdAt ? existing.createdAt : db.serverDate(),
        updatedAt: db.serverDate(),
      };
      await transaction.collection(FRENCH_PROGRESS_COLLECTION).doc(progressId).set({ data: progress });
      const existingDaily = await getDocumentOrNull(transaction, FRENCH_PROGRESS_COLLECTION, dailyId);
      const daily = incrementDailyStats(Object.assign({ contentId: dayKey }, existingDaily), {
        learnerKey: learner.learnerKey,
        learnerType: learner.learnerType,
        nowMs,
        contentType,
        cefrLevel: item.cefrLevel,
      });
      daily.updatedAt = db.serverDate();
      await transaction.collection(FRENCH_PROGRESS_COLLECTION).doc(dailyId).set({ data: daily });
      return { progress, daily };
    });
    return {
      success: true,
      progress: publicActivity(item, result.progress).progress,
      today: result.daily,
    };
  };

  const getSentences = (event) => getActivities(event, "sentence").then((result) => ({
    success: result.success,
    enabled: result.enabled,
    selectedLevel: result.selectedLevel,
    sentences: result.items,
    summary: result.summary,
  }));

  const completeSentence = (event) => completeActivity(event, "sentence");

  const getWordMemory = async (event) => {
    const learner = await getLearner(event);
    if (!learner.readOnly) await ensureProgressCollection();
    const data = (event && event.data) || {};
    const wordId = asString(data.wordId);
    const content = buildFrenchContent(createError);
    const word = content.wordById.get(wordId);
    if (!word) throw createError("INVALID_FRENCH_WORD", "该法语单词已更新，请刷新后重试");
    const nowMs = Date.now();
    const progressId = getProgressId(learner.learnerKey, "word", wordId);
    const stored = await getDocumentOrNull(db, FRENCH_PROGRESS_COLLECTION, progressId);
    const normalized = stored ? migrateLegacyProgress(stored, nowMs) : normalizeProgress(null, nowMs);
    return {
      success: true,
      word: publicWord(word, stored, nowMs),
      memory: getMemorySnapshot(normalized, nowMs),
      curve: buildRetentionCurve(normalized, nowMs, 9),
      disclaimer: "记忆保持率由当前复习模型估算，用于安排个人复习节奏。",
    };
  };

  const getAudioUrl = async (event) => {
    await getLearner(event);
    const data = (event && event.data) || {};
    const audioKey = asString(data.audioKey);
    if (!audioKey) throw createError("INVALID_FRENCH_AUDIO", "发音信息不完整，请返回后重试");
    const content = buildFrenchContent(createError);
    if (!content.referencedAudioKeys.has(audioKey)) {
      throw createError("INVALID_FRENCH_AUDIO", "该发音内容已更新，请刷新后重试");
    }
    const audio = content.audioByKey.get(audioKey);
    const fileId = asString(audio && (audio.fileId || audio.fileID || audio.cloudFileId));
    if (!fileId || !fileId.startsWith("cloud://")) {
      return {
        success: true,
        available: false,
        audioKey,
        message: "这条新内容的法语音频正在准备中",
      };
    }
    try {
      const result = await cloud.getTempFileURL({ fileList: [fileId] });
      const file = asArray(result && result.fileList).find((item) => (
        item && item.status === 0 && item.tempFileURL
      ));
      if (!file) throw new Error("Cloud storage did not return a temporary URL");
      return {
        success: true,
        available: true,
        audioKey,
        tempUrl: String(file.tempFileURL),
      };
    } catch (err) {
      console.error("get french audio temp url failed", err);
      return {
        success: true,
        available: false,
        audioKey,
        message: "该发音文件暂时不可用，请稍后重试",
      };
    }
  };

  const updatePreferences = async (event) => {
    const learner = await getLearner(event);
    ensureWritableLearner(learner);
    await ensureProgressCollection();
    const data = (event && event.data) || {};
    const preferences = normalizePreferences(data.preferences || data);
    const id = getProgressId(learner.learnerKey, "settings", "profile");
    await db.collection(FRENCH_PROGRESS_COLLECTION).doc(id).set({
      data: Object.assign({}, preferences, {
        learnerKey: learner.learnerKey,
        learnerType: learner.learnerType,
        contentType: "settings",
        contentId: "profile",
        updatedAt: db.serverDate(),
      }),
    });
    return { success: true, preferences };
  };

  const setSettings = async (event) => {
    const identity = await getIdentity();
    if (identity.role !== "teacher") {
      throw createError("PERMISSION_DENIED", "请使用教师账号设置法语学习功能");
    }
    const data = (event && event.data) || {};
    const studentId = asString(data.studentId);
    if (!studentId) throw createError("INVALID_STUDENT", "学生信息不完整，请返回后重试");
    if (typeof data.enabled !== "boolean") {
      throw createError("INVALID_FRENCH_SETTINGS", "请先选择是否开启法语学习");
    }
    const studentResult = await db.collection("students").doc(studentId).get();
    const student = studentResult && studentResult.data;
    if (!student) throw createError("INVALID_STUDENT", "学生不存在或已删除");
    const assignedTeacherOpenId = asString(student.teacherOpenId || student.ownerOpenId);
    if (assignedTeacherOpenId && assignedTeacherOpenId !== identity.openid) {
      throw createError("PERMISSION_DENIED", "请从负责该学生的教师账号设置法语学习功能");
    }
    if (
      !assignedTeacherOpenId
      && (typeof isPrimaryTeacherOpenId !== "function" || !isPrimaryTeacherOpenId(identity.openid))
    ) {
      throw createError("PERMISSION_DENIED", "旧学生资料缺少教师归属，请由主管老师先完成迁移");
    }
    await db.collection("students").doc(studentId).update({
      data: {
        frenchLearningEnabled: data.enabled,
        frenchLearningUpdatedAt: db.serverDate(),
        ...(assignedTeacherOpenId ? {} : { teacherOpenId: identity.openid }),
      },
    });
    return { success: true, studentId, enabled: data.enabled };
  };

  return {
    completeActivity,
    completeSentence,
    getAudioUrl,
    getDashboard,
    getExpressions: (event) => getActivities(event, "expression"),
    getGrammar: (event) => getActivities(event, "grammar"),
    getOverview,
    getReadings: (event) => getActivities(event, "reading"),
    getReviewQueue,
    getSentences,
    getWordMemory,
    getWords,
    getWritingActivities: (event) => getActivities(event, "writing"),
    reviewWord,
    setSettings,
    updatePreferences,
  };
};

module.exports = {
  ALGORITHM_VERSION,
  DEFAULT_PREFERENCES,
  FRENCH_PROGRESS_COLLECTION,
  PROGRESS_PAGE_SIZE,
  REVIEW_RESULTS,
  createFrenchLearningService,
  getProgressId,
  getProgressRecords,
  progressRecordsToMap,
};
