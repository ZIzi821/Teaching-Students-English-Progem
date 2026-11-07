const cloud = require("wx-server-sdk");
const crypto = require("crypto");
const appConfig = require("./config");
const vocabulary = require("./vocabulary");
const vocabularyQuiz = require("./vocabularyQuiz");
const englishMemoryAnalytics = require("./englishMemoryAnalytics");
const englishMemoryScheduler = require("./englishMemoryScheduler");
const frenchLearning = require("./frenchLearning");
const courseWorkflow = require("./courseWorkflow");
const teacherTodos = require("./teacherTodos");
const recordingFeedback = require("./recordingFeedback");
const studentEngagement = require("./studentEngagement");
const ketMock = require("./ketMock");
const learningRadar = require("./learningRadar");
const { createKetMockService } = require("./ketMockService");
const followReading = require("./followReading");
const { createFollowReadingService } = require("./followReadingService");
const { createWeeklyScheduleService } = require("./scheduleService");
const scheduleWorkflow = require("./schedule");
const { createMistakeExportService } = require("./mistakeExportService");
const {
  buildLessonPaperId,
  getMaterialSafetyImageFileID,
  isSameLessonPaperUpload,
} = require("./materialUpload");
const { isTransactionBusyError, runTransactionWithRetry } = require("./transactionRetry");
const KET_SPEAKING_TASKS = require("./data/ket-speaking-tasks.json");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

// 所有事务遇到云数据库“事务繁忙”时自动重试；事务未提交前失败，重试不会重复写入。
const runTransaction = (transactionCallback) => runTransactionWithRetry(
  () => db.runTransaction(transactionCallback)
);
const COLLECTIONS = [
  "students",
  "teachers",
  "lessons",
  "papers",
  "mistakes",
  "vocabularyProgress",
  "vocabularyDailyStats",
  "vocabularyQuizSessions",
  "frenchLearningProgress",
  "lessonSubmissions",
  "ketMockAssets",
  "ketMockSessions",
  "followReadingAssets",
  "studentReminders",
  "pkChallengeProfiles",
  "scheduleEvents",
  "mistakeExports",
  "systemLocks",
];
const VOCABULARY_DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STUDENT_BIND_LIMIT = 5;
const SHARED_STUDENT_LIMIT = 5;
const SHARED_STUDENT_ACCESS_CODES = Array.isArray(appConfig.sharedStudentAccessCodes)
  ? appConfig.sharedStudentAccessCodes
  : [];
const UNLIMITED_STUDENT_ACCESS_CODES = Array.isArray(appConfig.unlimitedStudentAccessCodes)
  ? appConfig.unlimitedStudentAccessCodes
  : [];
const UNCATEGORIZED_LABEL = "未分类";
const CONTENT_RISK_MESSAGE = "内容可能不符合规范，请修改后再提交";
const CONTENT_CHECK_UNAVAILABLE_MESSAGE = "暂时无法检查内容，请稍后再试";
const TEXT_CHECK_CHUNK_SIZE = 1800;
const IMPORT_VOCABULARY_CHECK_GROUP_SIZE = 20;
const SEED_STUDENTS = (Array.isArray(appConfig.seedStudents) ? appConfig.seedStudents : []).map((student) => {
  const seed = Object.assign({
    nickname: "",
    grade: "",
    parentName: "",
    status: "在读",
    studentOpenId: "",
    studentOpenIds: [],
    teacherName: appConfig.teacherName,
    subject: appConfig.defaultSubject,
    plannedLessonCount: 0,
    completedLessonCount: 0,
    vocabularyEnabled: false,
    englishCourseEnabled: true,
    mistakeLearningEnabled: true,
    frenchLearningEnabled: false,
  }, student || {});
  seed.vocabularySettings = seed.vocabularySettings
    || vocabulary.getRecommendedVocabularySettings({ name: seed.name, accessCode: seed.accessCode });
  seed.lessonPackageSize = courseWorkflow.getLessonPackageSize(seed);
  return seed;
});

const createError = (code, message) => {
  const err = new Error(message);
  err.code = code;
  return err;
};

// 多个事务写入流程都需要把“不存在的文档”当作正常的空结果处理。
// 这是课程、身份、词汇和错题共用的基础辅助函数，不属于已删除的预约模块。
const getOptionalTransactionDocument = async (documentRef) => {
  try {
    const result = await documentRef.get();
    return result && result.data ? result.data : null;
  } catch (err) {
    const message = String((err && (err.errMsg || err.message)) || err || "");
    if (/does not exist|not[ _-]?found|不存在/i.test(message)) return null;
    throw err;
  }
};

const isRiskySecurityResult = (res) => {
  if (!res) return false;
  if (res.errCode === 87014 || res.errcode === 87014) return true;
  const result = res.result || {};
  return result.suggest === "risky" || result.suggest === "review";
};

const isSecurityReviewResult = (res) => {
  const result = (res && res.result) || {};
  return result.suggest === "review";
};

const getSecurityResultSummary = (res) => {
  const result = (res && res.result) || {};
  return {
    errCode: res && (res.errCode !== undefined ? res.errCode : res.errcode),
    suggest: result.suggest || "",
    label: result.label === undefined ? "" : result.label,
    traceId: (res && (res.traceId || res.trace_id)) || "",
  };
};

const isSecurityPass = (res) => {
  if (!res) return false;
  if (res.errCode === 0 || res.errcode === 0) {
    const result = res.result || {};
    return !result.suggest || result.suggest === "pass";
  }
  const result = res.result || {};
  return result.suggest === "pass";
};

const collectTextItems = (items) => {
  return (items || [])
    .flat()
    .map((item) => String(item || "").trim())
    .filter((item) => item);
};

const chunkText = (text, chunkSize) => {
  const chunks = [];
  const safeChunkSize = Math.max(1, Number(chunkSize) || TEXT_CHECK_CHUNK_SIZE);
  for (let i = 0; i < text.length; i += safeChunkSize) {
    chunks.push(text.slice(i, i + safeChunkSize));
  }
  return chunks;
};

const chunkTextItems = (textItems, prefix) => {
  const texts = collectTextItems(textItems);
  const safePrefix = String(prefix || "").trim();
  const prefixLength = safePrefix ? safePrefix.length + 1 : 0;
  const bodyLimit = Math.max(1, TEXT_CHECK_CHUNK_SIZE - prefixLength);
  const chunks = [];
  let bodyParts = [];
  let bodyLength = 0;

  const flush = () => {
    if (!bodyParts.length) return;
    const body = bodyParts.join("\n");
    chunks.push(safePrefix ? `${safePrefix}\n${body}` : body);
    bodyParts = [];
    bodyLength = 0;
  };

  texts.forEach((text) => {
    if (text.length > bodyLimit) {
      flush();
      chunkText(text, bodyLimit).forEach((part) => {
        chunks.push(safePrefix ? `${safePrefix}\n${part}` : part);
      });
      return;
    }
    const separatorLength = bodyParts.length ? 1 : 0;
    if (bodyLength + separatorLength + text.length > bodyLimit) flush();
    bodyParts.push(text);
    bodyLength += (bodyParts.length > 1 ? 1 : 0) + text.length;
  });
  flush();
  return chunks;
};

const checkTextContent = async (textItems, options) => {
  const safeOptions = options || {};
  const chunks = chunkTextItems(textItems, safeOptions.prefix);
  if (!chunks.length) return;
  for (let i = 0; i < chunks.length; i++) {
    try {
      const res = await cloud.openapi.security.msgSecCheck({
        content: chunks[i],
        version: 2,
        scene: 1,
        openid: getOpenIdFromContext(),
      });
      if (isSecurityReviewResult(res) && safeOptions.allowReview) {
        console.warn("msgSecCheck manual review accepted", {
          context: safeOptions.contextLabel || "",
          chunk: i + 1,
          totalChunks: chunks.length,
          result: getSecurityResultSummary(res),
        });
        continue;
      }
      if (isRiskySecurityResult(res)) {
        console.warn("msgSecCheck blocked", {
          context: safeOptions.contextLabel || "",
          chunk: i + 1,
          totalChunks: chunks.length,
          result: getSecurityResultSummary(res),
        });
        throw createError("CONTENT_RISK", safeOptions.riskMessage || CONTENT_RISK_MESSAGE);
      }
      if (!isSecurityPass(res)) {
        console.error("msgSecCheck unexpected result", res);
        throw createError("CONTENT_CHECK_FAILED", CONTENT_CHECK_UNAVAILABLE_MESSAGE);
      }
    } catch (err) {
      if (err.code === "CONTENT_RISK" || err.code === "CONTENT_CHECK_FAILED") throw err;
      if (err.errCode === 87014 || err.errcode === 87014) {
        console.warn("msgSecCheck blocked", {
          context: safeOptions.contextLabel || "",
          chunk: i + 1,
          totalChunks: chunks.length,
          result: getSecurityResultSummary(err),
        });
        throw createError("CONTENT_RISK", safeOptions.riskMessage || CONTENT_RISK_MESSAGE);
      }
      console.error("msgSecCheck failed", err);
      throw createError("CONTENT_CHECK_FAILED", CONTENT_CHECK_UNAVAILABLE_MESSAGE);
    }
  }
};

const getImageContentType = (fileID) => {
  const text = String(fileID || "").toLowerCase();
  if (text.endsWith(".jpg") || text.endsWith(".jpeg")) return "image/jpeg";
  if (text.endsWith(".webp")) return "image/webp";
  if (text.endsWith(".gif")) return "image/gif";
  return "image/png";
};

const checkImageFile = async (fileID, options) => {
  if (!fileID) return;
  const safeOptions = options || {};
  try {
    const download = await cloud.downloadFile({ fileID });
    const fileContent = download.fileContent;
    if (!fileContent) {
      throw createError("CONTENT_CHECK_FAILED", CONTENT_CHECK_UNAVAILABLE_MESSAGE);
    }
    const res = await cloud.openapi.security.imgSecCheck({
      media: {
        contentType: getImageContentType(fileID),
        value: fileContent,
      },
    });
    if (isSecurityReviewResult(res) && safeOptions.allowReview) {
      console.warn("imgSecCheck manual review accepted", {
        context: safeOptions.contextLabel || "",
        result: getSecurityResultSummary(res),
      });
      return;
    }
    if (isRiskySecurityResult(res)) {
      throw createError("CONTENT_RISK", CONTENT_RISK_MESSAGE);
    }
    if (!isSecurityPass(res)) {
      console.error("imgSecCheck unexpected result", res);
      throw createError("CONTENT_CHECK_FAILED", CONTENT_CHECK_UNAVAILABLE_MESSAGE);
    }
  } catch (err) {
    if (err.code === "CONTENT_RISK" || err.code === "CONTENT_CHECK_FAILED") throw err;
    if (err.errCode === 87014 || err.errcode === 87014) {
      throw createError("CONTENT_RISK", CONTENT_RISK_MESSAGE);
    }
    console.error("imgSecCheck failed", err);
    throw createError("CONTENT_CHECK_FAILED", CONTENT_CHECK_UNAVAILABLE_MESSAGE);
  }
};

const deleteUnsafeFiles = async (fileIDs) => {
  const safeFileIDs = uniqueValues((fileIDs || []).filter((fileID) => fileID));
  if (!safeFileIDs.length) return;
  for (let index = 0; index < safeFileIDs.length; index += 50) {
    try {
      await cloud.deleteFile({
        fileList: safeFileIDs.slice(index, index + 50),
      });
    } catch (err) {
      console.error("delete unsafe files failed", err);
    }
  }
};

const assertContentSafe = async ({ texts, imageFileIds, allowImageReview, contextLabel }) => {
  await checkTextContent(texts);
  const fileIDs = uniqueValues((imageFileIds || []).filter((fileID) => fileID));
  for (let i = 0; i < fileIDs.length; i++) {
    await checkImageFile(fileIDs[i], {
      allowReview: allowImageReview === true,
      contextLabel,
    });
  }
};

const normalizeAcademicTextForSafety = (value) => String(value || "")
  .replace(/\bsb\b/gi, "somebody")
  .replace(/\bsth\b/gi, "something");

const getImportCoreTextItems = (item) => [
  item.questionNo,
  item.paperSection,
  item.questionType,
  item.questionText,
  item.skillTags,
  item.mistakeReasonType,
  item.studentAnswer,
  item.correctAnswer,
  item.explanation,
  item.reason,
].map(normalizeAcademicTextForSafety);

const getImportVocabularyEntries = (safeItems) => safeItems.flatMap((item, itemIndex) => (
  (item.vocabularyWords || []).map((word) => ({
    itemIndex,
    word: word.word,
    text: [word.word, word.meaning, word.partOfSpeech]
      .filter((value) => value)
      .map(normalizeAcademicTextForSafety)
      .join("\n"),
  }))
));

const checkTeacherImportContent = async (safeItems, importItemOffset) => {
  const lessonPrefix = "以下内容是英语课堂试题、答案和教师讲解，仅用于教学复习。";
  const vocabularyPrefix = "以下内容是英语课堂词汇及中文释义，仅用于教学复习。";

  try {
    await checkTextContent(safeItems.map(getImportCoreTextItems), {
      allowReview: true,
      prefix: lessonPrefix,
      contextLabel: `错题 ${importItemOffset + 1}-${importItemOffset + safeItems.length}`,
    });
  } catch (err) {
    if (err.code !== "CONTENT_RISK") throw err;
    console.warn("batch import text check retrying item by item", {
      importItemOffset,
      itemCount: safeItems.length,
    });
    for (let i = 0; i < safeItems.length; i++) {
      await checkTextContent(getImportCoreTextItems(safeItems[i]), {
        allowReview: true,
        prefix: lessonPrefix,
        contextLabel: `第 ${importItemOffset + i + 1} 道错题`,
        riskMessage: `第 ${importItemOffset + i + 1} 道错题可能不符合内容规范，请检查后重试`,
      });
    }
  }

  const vocabularyEntries = getImportVocabularyEntries(safeItems);
  for (let start = 0; start < vocabularyEntries.length; start += IMPORT_VOCABULARY_CHECK_GROUP_SIZE) {
    const group = vocabularyEntries.slice(start, start + IMPORT_VOCABULARY_CHECK_GROUP_SIZE);
    try {
      await checkTextContent(group.map((entry) => entry.text), {
        allowReview: true,
        prefix: vocabularyPrefix,
        contextLabel: `错题单词 ${start + 1}-${start + group.length}`,
      });
    } catch (err) {
      if (err.code !== "CONTENT_RISK") throw err;
      console.warn("batch vocabulary check retrying word by word", {
        importItemOffset,
        start,
        count: group.length,
      });
      for (let i = 0; i < group.length; i++) {
        const entry = group[i];
        await checkTextContent([entry.text], {
          allowReview: true,
          prefix: vocabularyPrefix,
          contextLabel: `单词 ${entry.word}`,
          riskMessage: `单词“${entry.word}”可能不符合内容规范，请检查后重试`,
        });
      }
    }
  }
};

const normalizeCode = (code) => String(code || "").trim().toUpperCase();

const getSystemLockId = (type, value) => {
  const lockType = String(type || "lock").replace(/[^a-z0-9_-]/gi, "_");
  const lockHash = crypto.createHash("sha1").update(String(value || "")).digest("hex");
  return `${lockType}_${lockHash}`;
};

const getTeacherHomeworkActivityStateId = (openid) => (
  getSystemLockId("teacher_homework_activity", openid)
);

const getStudentLearningActivityStateId = (studentId) => (
  getSystemLockId("student_learning_activity", studentId)
);

const uniqueValues = (values) => {
  const result = [];
  (values || []).forEach((value) => {
    if (value && result.indexOf(value) < 0) result.push(value);
  });
  return result;
};

const getStudentOpenIds = (student) => {
  if (!student) return [];
  return uniqueValues([student.studentOpenId].concat(student.studentOpenIds || []));
};

const getStudentBindLimit = (studentOrAccessCode) => {
  const student = studentOrAccessCode && typeof studentOrAccessCode === "object"
    ? studentOrAccessCode
    : null;
  const normalized = normalizeCode(student ? student.accessCode : studentOrAccessCode);
  if (UNLIMITED_STUDENT_ACCESS_CODES.indexOf(normalized) >= 0) return Infinity;
  const configuredLimit = Number(student && student.studentBindLimit);
  if (Number.isInteger(configuredLimit) && configuredLimit > 0) return configuredLimit;
  if (SHARED_STUDENT_ACCESS_CODES.indexOf(normalized) >= 0) return SHARED_STUDENT_LIMIT;
  return DEFAULT_STUDENT_BIND_LIMIT;
};

const normalizeTags = (tags) => {
  if (Array.isArray(tags)) return uniqueValues(tags.map((item) => String(item || "").trim()).filter((item) => item));
  return uniqueValues(
    String(tags || "")
      .split(/[,，\s]+/)
      .map((item) => item.trim())
      .filter((item) => item)
  );
};

const getReviewStatus = (mistake) => mistake.reviewStatus || mistake.status || "待复习";

const getCreatedTime = (item) => {
  const value = item && item.createdAt;
  return getDateLikeTime(value);
};

const getDateLikeTime = (value) => {
  if (!value) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value.getTime === "function") return value.getTime();
  if (typeof value === "object" && value.$date) {
    return getDateLikeTime(value.$date);
  }
  if (typeof value === "object" && Number.isFinite(Number(value.seconds))) {
    return Number(value.seconds) * 1000;
  }
  return 0;
};

const incrementStat = (stats, key) => {
  const label = key || UNCATEGORIZED_LABEL;
  stats[label] = (stats[label] || 0) + 1;
};

const toRankList = (stats, limit) => {
  return Object.keys(stats)
    .map((label) => ({ label, count: stats[label] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit || 6);
};

const buildCycleStatus = (student) => {
  const progress = buildProgress(student);
  const hasPlan = progress.progressUnit === "minute"
    ? progress.plannedLessonMinutes > 0
    : progress.plannedLessonCount > 0;
  const isReviewPhase = hasPlan && (
    progress.progressUnit === "minute"
      ? progress.completedLessonMinutes >= progress.plannedLessonMinutes
      : progress.completedLessonCount >= progress.plannedLessonCount
  );
  return {
    hasPlan,
    isReviewPhase,
    label: !hasPlan ? "还没设置总课时" : isReviewPhase ? "本轮课程已完成，可以开始复习了" : "课程进行中",
    nextAction: !hasPlan
      ? "设置总课时"
      : isReviewPhase ? "开始复习"
      : progress.progressUnit === "minute" ? "继续安排课程" : `继续第 ${progress.completedLessonCount + 1} 节课`,
  };
};

const toNonNegativeNumber = (value, fieldName) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num < 0) {
    throw createError("INVALID_PROGRESS", `${fieldName} 必须是非负数字`);
  }
  return num;
};

const toLessonPackageSize = (value) => {
  const number = Number(value || 0);
  if (!Number.isInteger(number) || number < 0 || number > 100) {
    throw createError("INVALID_PROGRESS", "常用加课数量必须是 0–100 的整数");
  }
  return number;
};

const toLessonMinutes = (value, fieldName) => {
  const number = Number(value || 0);
  if (!Number.isInteger(number) || number < 0 || number > 60000 || number % 5 !== 0) {
    throw createError("INVALID_PROGRESS", `${fieldName} 必须是 5 分钟的整数倍`);
  }
  return number;
};

const toBookingDurationMinutes = (value, fallback) => {
  const candidate = value === undefined || value === null || value === "" ? fallback : value;
  const number = Number(candidate);
  if (!Number.isInteger(number) || number < 20 || number > 180 || number % 5 !== 0) {
    throw createError("INVALID_PROGRESS", "预约单节时长必须是 20–180 分钟，并按 5 分钟递增");
  }
  return number;
};

const buildProgress = (student) => courseWorkflow.buildLessonProgress(student);

const summarizeProgress = (students) => {
  let plannedLessonCount = 0;
  let completedLessonCount = 0;
  let plannedLessonMinutes = 0;
  let completedLessonMinutes = 0;
  students.forEach((student) => {
    const progress = buildProgress(student);
    if (progress.progressUnit === "minute") {
      plannedLessonMinutes += progress.plannedLessonMinutes;
      completedLessonMinutes += progress.completedLessonMinutes;
    } else {
      plannedLessonCount += progress.plannedLessonCount;
      completedLessonCount += progress.completedLessonCount;
    }
  });
  const progressPercent = plannedLessonCount ? Math.min(100, Math.round((completedLessonCount / plannedLessonCount) * 100)) : 0;
  return {
    plannedLessonCount,
    completedLessonCount,
    progressPercent,
    progressText: `${completedLessonCount} / ${plannedLessonCount}`,
    plannedLessonMinutes,
    completedLessonMinutes,
    timeProgressText: `${courseWorkflow.formatLessonMinutes(completedLessonMinutes)} / ${courseWorkflow.formatLessonMinutes(plannedLessonMinutes)}`,
  };
};

const buildStudentProgressItem = (student) => {
  const safeStudent = sanitizeStudent(student, false);
  const hasPlannedLessonCount = safeStudent.progressUnit === "minute"
    ? safeStudent.plannedLessonMinutes > 0
    : safeStudent.plannedLessonCount > 0;
  return {
    _id: safeStudent._id,
    name: safeStudent.name,
    grade: safeStudent.grade,
    plannedLessonCount: safeStudent.plannedLessonCount,
    completedLessonCount: safeStudent.completedLessonCount,
    progressPercent: safeStudent.progressPercent,
    lessonPackageSize: safeStudent.lessonPackageSize,
    remainingLessonCount: safeStudent.remainingLessonCount,
    lessonReminderThreshold: safeStudent.lessonReminderThreshold,
    showProgressMarker: safeStudent.showProgressMarker,
    progressMarkerPercent: safeStudent.progressMarkerPercent,
    progressTone: safeStudent.progressTone,
    progressUnit: safeStudent.progressUnit,
    progressUnitLabel: safeStudent.progressUnitLabel,
    plannedLessonMinutes: safeStudent.plannedLessonMinutes || 0,
    completedLessonMinutes: safeStudent.completedLessonMinutes || 0,
    hasPlannedLessonCount,
    progressLabel: safeStudent.progressLabel,
  };
};

const getStudentLessonMetrics = async (studentId) => {
  const lessons = [];
  const pageSize = 100;
  for (let skip = 0; ; skip += pageSize) {
    const res = await db.collection("lessons")
      .where({ studentId })
      .skip(skip)
      .limit(pageSize)
      .get();
    const page = res.data || [];
    lessons.push(...page);
    if (page.length < pageSize) break;
  }
  return {
    recordedLessonCount: courseWorkflow.countLessonProgressRecords(lessons),
    // Legacy 徐浩成 lessons did not store duration. Treat each missing duration as
    // one hour so marking an old lesson as an institution course can subtract it.
    recordedLessonMinutes: courseWorkflow.countLessonProgressMinutes(lessons, 60),
  };
};

const getStudentLessonCount = async (studentId) => (
  (await getStudentLessonMetrics(studentId)).recordedLessonCount
);

const getEffectiveCompletedLessonCount = (student, lessonCount) => (
  courseWorkflow.getEffectiveCompletedLessonCount(student, lessonCount)
);

const attachSyncedLessonCount = async (student) => {
  if (!student || !student._id) return student;
  const { recordedLessonCount, recordedLessonMinutes } = await getStudentLessonMetrics(student._id);
  const completedLessonCount = getEffectiveCompletedLessonCount(student, recordedLessonCount);
  const completedLessonMinutes = courseWorkflow.getEffectiveCompletedLessonMinutes(student, recordedLessonMinutes);
  return Object.assign({}, student, {
    completedLessonCount,
    recordedLessonCount,
    completedLessonMinutes,
    recordedLessonMinutes,
  });
};

const attachSyncedLessonCounts = async (students) => {
  return await Promise.all((students || []).map((student) => attachSyncedLessonCount(student)));
};

const syncStudentCompletedLessonCount = async (studentId) => {
  const { recordedLessonCount, recordedLessonMinutes } = await getStudentLessonMetrics(studentId);
  const studentRes = await db.collection("students").doc(studentId).get();
  const completedLessonCount = getEffectiveCompletedLessonCount(studentRes.data, recordedLessonCount);
  const completedLessonMinutes = courseWorkflow.getEffectiveCompletedLessonMinutes(
    studentRes.data,
    recordedLessonMinutes
  );
  await db.collection("students").doc(studentId).update({
    data: {
      completedLessonCount,
      recordedLessonCount,
      completedLessonMinutes,
      recordedLessonMinutes,
    },
  });
  return completedLessonCount;
};

const ensureStudentLessonCountSnapshot = async (studentId) => {
  const studentRes = await db.collection("students").doc(studentId).get();
  if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
  const countSnapshotReady = Object.prototype.hasOwnProperty.call(studentRes.data, "recordedLessonCount")
    && Number.isFinite(Number(studentRes.data.recordedLessonCount));
  const minuteSnapshotReady = courseWorkflow.getLessonAccountingMode(studentRes.data) !== "minute"
    || (
      Object.prototype.hasOwnProperty.call(studentRes.data, "recordedLessonMinutes")
      && Number.isFinite(Number(studentRes.data.recordedLessonMinutes))
    );
  if (countSnapshotReady && minuteSnapshotReady) {
    return studentRes.data;
  }
  const { recordedLessonCount, recordedLessonMinutes } = await getStudentLessonMetrics(studentId);
  const completedLessonCount = getEffectiveCompletedLessonCount(studentRes.data, recordedLessonCount);
  const completedLessonMinutes = courseWorkflow.getEffectiveCompletedLessonMinutes(
    studentRes.data,
    recordedLessonMinutes
  );
  await db.collection("students").doc(studentId).update({
    data: {
      completedLessonCount,
      recordedLessonCount,
      completedLessonMinutes,
      recordedLessonMinutes,
    },
  });
  return Object.assign({}, studentRes.data, {
    completedLessonCount,
    recordedLessonCount,
    completedLessonMinutes,
    recordedLessonMinutes,
  });
};

const getOpenIdFromContext = () => cloud.getWXContext().OPENID;

const isTeacherOpenId = (openid) => appConfig.teacherOpenIds.indexOf(openid) >= 0;

const isTeacherAccessCode = (accessCode) => normalizeCode(accessCode) === normalizeCode(appConfig.teacherAccessCode);

const getBoundTeacher = async (openid) => {
  try {
    const res = await db.collection("teachers").where({ openid }).limit(1).get();
    return res.data && res.data.length ? res.data[0] : null;
  } catch (err) {
    return null;
  }
};

const getBoundStudent = async (openid) => {
  const res = await db.collection("students").where({ studentOpenId: openid }).limit(1).get();
  if (res.data && res.data.length) return res.data[0];
  try {
    const multiRes = await db.collection("students").where({ studentOpenIds: openid }).limit(1).get();
    if (multiRes.data && multiRes.data.length) return multiRes.data[0];
  } catch (err) {
    console.error("query studentOpenIds failed", err);
  }
  const studentsRes = await db.collection("students").get();
  return (studentsRes.data || []).find((student) => getStudentOpenIds(student).indexOf(openid) >= 0) || null;
};

const getIdentityModeId = (openid) => getSystemLockId("identity_mode", openid);

const getIdentityMode = async (openid) => {
  try {
    const res = await db.collection("systemLocks")
      .where({ _id: getIdentityModeId(openid) })
      .limit(1)
      .get();
    return res.data && res.data.length ? res.data[0] : null;
  } catch (err) {
    return null;
  }
};

const setIdentityMode = async (openid, mode, studentId) => {
  await createOneCollection("systemLocks");
  await db.collection("systemLocks").doc(getIdentityModeId(openid)).set({
    data: {
      recordType: "identityMode",
      mode,
      studentId: studentId || "",
      updatedAt: db.serverDate(),
    },
  });
};

const getIdentity = async () => {
  const openid = getOpenIdFromContext();
  const identityMode = await getIdentityMode(openid);
  if (identityMode && identityMode.mode === "signedOut") {
    return {
      role: "guest",
      openid,
      teacherName: appConfig.teacherName,
      isTeacher: false,
      student: null,
    };
  }
  if (identityMode && identityMode.mode === "student" && identityMode.studentId) {
    const studentRes = await db.collection("students")
      .where({ _id: identityMode.studentId })
      .limit(1)
      .get();
    const student = studentRes.data && studentRes.data.length ? studentRes.data[0] : null;
    if (student && getStudentOpenIds(student).indexOf(openid) >= 0) {
      return {
        role: "student",
        openid,
        teacherName: appConfig.teacherName,
        isTeacher: false,
        student,
      };
    }
    return {
      role: "guest",
      openid,
      teacherName: appConfig.teacherName,
      isTeacher: false,
      student: null,
    };
  }
  if (identityMode && identityMode.mode === "teacher") {
    return {
      role: "teacher",
      openid,
      teacherName: appConfig.teacherName,
      isTeacher: true,
      student: null,
    };
  }
  if (isTeacherOpenId(openid) || (await getBoundTeacher(openid))) {
    return {
      role: "teacher",
      openid,
      teacherName: appConfig.teacherName,
      isTeacher: true,
      student: null,
    };
  }
  const student = await getBoundStudent(openid);
  return {
    role: student ? "student" : "guest",
    openid,
    teacherName: appConfig.teacherName,
    isTeacher: false,
    student,
  };
};

const isMistakeLearningEnabled = (student) => {
  if (student && typeof student.mistakeLearningEnabled === "boolean") {
    return student.mistakeLearningEnabled;
  }
  // Legacy French-only profiles used the vocabulary switch as the only visible
  // English feature switch. Preserve that intent when the new field is absent.
  return !(student && student.frenchLearningEnabled === true && student.vocabularyEnabled !== true);
};

const isEnglishCourseEnabled = (student) => {
  if (student && typeof student.englishCourseEnabled === "boolean") {
    return student.englishCourseEnabled;
  }
  // Before the course switch existed, lesson visibility followed the mistake
  // switch. Keep that behaviour for legacy students until the teacher changes it.
  return isMistakeLearningEnabled(student);
};

const isStudentHiddenFromTeacher = (student) => Boolean(student && student.teacherHidden === true);

const LESSON_TEMPLATE_KEYS = ["general", "feng_beginner", "molly_oral_ket", "vocabulary_coaching"];

const getStudentLessonTemplateKey = (student) => {
  if (student && LESSON_TEMPLATE_KEYS.includes(student.lessonTemplateKey)) {
    return student.lessonTemplateKey;
  }
  const name = `${(student && student.name) || ""} ${(student && student.nickname) || ""}`
    .trim()
    .toLowerCase();
  if (name.includes("冯嘉文")) return "feng_beginner";
  if (name.includes("molly")) return "molly_oral_ket";
  return "general";
};

const sanitizeStudent = (student, includePrivate) => {
  if (!student) return null;
  const vocabularySettings = vocabulary.normalizeVocabularySettings(
    student.vocabularySettings,
    vocabulary.loadVocabularyLibrary(),
    student
  );
  const result = {
    _id: student._id,
    name: student.name || "",
    nickname: student.nickname || "",
    grade: student.grade || "",
    parentName: student.parentName || "",
    status: student.status || "在读",
    teacherName: student.teacherName || appConfig.teacherName,
    subject: student.subject || appConfig.defaultSubject,
    createdAt: student.createdAt || "",
    vocabularyEnabled: student.vocabularyEnabled === true,
    englishCourseEnabled: isEnglishCourseEnabled(student),
    mistakeLearningEnabled: isMistakeLearningEnabled(student),
    frenchLearningEnabled: student.frenchLearningEnabled === true,
    lessonTemplateKey: getStudentLessonTemplateKey(student),
    bookingDurationMinutes: scheduleWorkflow.getDefaultBookingDurationMinutes(student),
    vocabularySettings,
    vocabularyDailyPlan: vocabulary.normalizeVocabularyDailyPlan(
      student.vocabularyDailyPlan,
      vocabularySettings.dailyGoal
    ),
  };
  Object.assign(result, buildProgress(student));
  if (includePrivate) {
    const learningPlanDefinition = learningRadar.getPlanForStudent(Object.assign({}, student, {
      lessonTemplateKey: getStudentLessonTemplateKey(student),
    }));
    result.learningPlan = learningPlanDefinition
      ? learningRadar.normalizeLearningPlan(student, learningPlanDefinition)
      : null;
    result.accessCode = student.accessCode || "";
    result.studentOpenId = student.studentOpenId || "";
    result.studentOpenIds = getStudentOpenIds(student);
    const bindLimit = getStudentBindLimit(student);
    result.studentBindLimit = Number.isFinite(bindLimit) ? bindLimit : 0;
    result.boundAccountCount = result.studentOpenIds.length;
    result.teacherHidden = isStudentHiddenFromTeacher(student);
  }
  return result;
};

const ensureTeacher = async () => {
  const identity = await getIdentity();
  if (identity.role !== "teacher") {
    throw createError("PERMISSION_DENIED", "请使用教师账号完成此操作");
  }
  return identity;
};

const ensureStudentAccess = async (studentId) => {
  const identity = await getIdentity();
  if (identity.role === "teacher") return identity;
  if (identity.role === "student" && identity.student && identity.student._id === studentId) return identity;
  throw createError("PERMISSION_DENIED", "请从当前绑定的学习账号进入");
};

const ensureMistakeLearningAccess = (identity, student, data = {}) => {
  const isStudentSide = identity.role === "student" || data.mode === "teacherPreview";
  if (isStudentSide && !isMistakeLearningEnabled(student)) {
    throw createError("MISTAKE_LEARNING_DISABLED", "英语错题整理功能尚未开启");
  }
};

const ensureEnglishCourseAccess = (identity, student, data = {}) => {
  const isStudentSide = identity.role === "student" || data.mode === "teacherPreview";
  if (isStudentSide && !isEnglishCourseEnabled(student)) {
    throw createError("ENGLISH_COURSE_DISABLED", "英语课程与作业功能尚未开启");
  }
};

const frenchLearningService = frenchLearning.createFrenchLearningService({
  db,
  cloud,
  getIdentity,
  createError,
  isPrimaryTeacherOpenId: isTeacherOpenId,
});

const getOpenId = async () => {
  const wxContext = cloud.getWXContext();
  return {
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
  };
};

const getMiniProgramCode = async () => {
  await ensureTeacher();
  const resp = await cloud.openapi.wxacode.get({
    path: "pages/index/index",
  });
  const upload = await cloud.uploadFile({
    cloudPath: "zhu-teacher-english-code.png",
    fileContent: resp.buffer,
  });
  return upload.fileID;
};

const createOneCollection = async (name) => {
  try {
    await db.createCollection(name);
    return {
      name,
      created: true,
    };
  } catch (err) {
    return {
      name,
      created: false,
      message: "collection may already exist",
    };
  }
};

const initCollections = async () => {
  await ensureTeacher();
  const results = [];
  for (let i = 0; i < COLLECTIONS.length; i++) {
    results.push(await createOneCollection(COLLECTIONS[i]));
  }
  return {
    success: true,
    collections: results,
  };
};

const attachStudentNames = async (lessons, students) => {
  const studentRes = students ? { data: students } : await db.collection("students").get();
  const studentMap = {};
  studentRes.data.forEach((student) => {
    studentMap[student._id] = student.name || "";
  });
  return lessons.map((lesson) => {
    return Object.assign({}, lesson, {
      studentName: studentMap[lesson.studentId] || "",
    });
  });
};

const buildVocabularyTodayPulse = (student, dailyStats) => {
  const safeStudent = sanitizeStudent(student, false);
  const dailyPlan = safeStudent.vocabularyDailyPlan || {};
  const goal = Math.max(0, Number(dailyPlan.dailyGoal || 0));
  const reviewedCount = Math.max(
    0,
    Number(dailyStats && dailyStats.reviewedWordCount)
      || (Array.isArray(dailyStats && dailyStats.reviewedWordKeys)
        ? dailyStats.reviewedWordKeys.length
        : 0)
  );
  const remainingCount = Math.max(0, goal - reviewedCount);
  return {
    enabled: safeStudent.vocabularyEnabled === true,
    goal,
    reviewedCount,
    remainingCount,
    progressPercent: goal > 0 ? Math.min(100, Math.round(reviewedCount / goal * 100)) : 0,
    completed: goal > 0 && reviewedCount >= goal,
  };
};

const attachVocabularyTodayPulses = (students, dailyStats) => {
  const statsByStudentId = new Map(
    (dailyStats || []).map((item) => [String(item.studentId || ""), item])
  );
  return (students || []).map((student) => Object.assign({}, student, {
    vocabularyPulse: buildVocabularyTodayPulse(
      student,
      statsByStudentId.get(String(student._id || ""))
    ),
  }));
};

const buildStudentHomeData = async (student, identity, options = {}) => {
  const studentId = student._id;
  const syncedStudent = await attachSyncedLessonCount(student);
  const mistakeLearningEnabled = isMistakeLearningEnabled(syncedStudent);
  const englishCourseEnabled = isEnglishCourseEnabled(syncedStudent);
  const learningDay = vocabulary.getLearningDay();
  const [mistakeCount, lessonDocuments, todayStats, quizSessions, learningActivityState, studentReminders] = await Promise.all([
    mistakeLearningEnabled
      ? db.collection("mistakes").where({ studentId }).count()
      : Promise.resolve({ total: 0 }),
    englishCourseEnabled
      ? loadAllStudentDocuments("lessons", studentId)
      : Promise.resolve([]),
    syncedStudent.vocabularyEnabled === true
      ? loadAllVocabularyDocuments("vocabularyDailyStats", { studentId, learningDay })
      : Promise.resolve([]),
    syncedStudent.vocabularyEnabled === true
      ? loadAllStudentDocuments("vocabularyQuizSessions", studentId)
      : Promise.resolve([]),
    getOptionalTransactionDocument(
      db.collection("systemLocks").doc(getStudentLearningActivityStateId(studentId))
    ),
    loadAllStudentDocuments("studentReminders", studentId),
  ]);
  const progress = buildProgress(syncedStudent);
  const studentLessons = courseWorkflow.sortLessonsByNumber(lessonDocuments || [])
    .map(withTeacherConfirmedHomeworkState)
    .map((lesson) => withHomeworkDeadlineState(lesson));
  const homeworkLessons = studentLessons.filter(hasLessonHomework);
  const pendingHomeworkLessons = homeworkLessons.filter((lesson) => !isLessonHomeworkCompleted(lesson));
  const completedHomeworkLessons = homeworkLessons.filter(isLessonHomeworkCompleted);
  const homeworkGrouping = courseWorkflow.buildHomeworkListGrouping({
    pendingLessons: pendingHomeworkLessons,
    completedLessons: completedHomeworkLessons,
  });
  const pendingHomework = homeworkGrouping.pendingLessons.find((lesson) => (
    lesson.homeworkListGroup !== courseWorkflow.HOMEWORK_LIST_GROUPS.awaitingReview
  )) || null;
  return {
    success: true,
    role: identity.role,
    isTeacherPreview: options.isTeacherPreview === true,
    readOnly: options.isTeacherPreview === true,
    openid: identity.openid,
    teacherName: appConfig.teacherName,
    currentStudent: sanitizeStudent(syncedStudent, false),
    vocabularyPulse: buildVocabularyTodayPulse(syncedStudent, todayStats[0]),
    vocabularyQuizPulse: vocabularyQuiz.buildTodayQuizPulse(quizSessions, learningDay),
    canShowStudentCount: false,
    stats: {
      mistakeCount: mistakeCount.total,
      progress,
    },
    recentLessons: studentLessons.slice(0, 3),
    pendingHomework,
    homeworkSummary: homeworkGrouping.summary,
    studentLearningActivities: buildStudentLearningActivities({
      lessons: studentLessons,
      sessions: quizSessions,
      reminders: studentReminders,
      viewedThroughAtMs: Number(learningActivityState && learningActivityState.viewedThroughAtMs || 0),
    }),
  };
};

const loadAllStudentDocuments = async (collectionName, studentId) => {
  const documents = [];
  const pageSize = 100;
  for (let skip = 0; ; skip += pageSize) {
    const res = await db
      .collection(collectionName)
      .where({ studentId })
      .skip(skip)
      .limit(pageSize)
      .get();
    const items = res.data || [];
    documents.push(...items);
    if (items.length < pageSize) break;
  }
  return documents;
};

const getHomeData = async (event = {}) => {
  const identity = await getIdentity();
  if (identity.role !== "guest") {
    await Promise.all([
      createOneCollection("vocabularyDailyStats"),
      createOneCollection("vocabularyQuizSessions"),
      createOneCollection("studentReminders"),
      createOneCollection("scheduleEvents"),
    ]);
  }
  const data = event.data || {};
  const isTeacherPreview = data.mode === "teacherPreview";
  if (isTeacherPreview) {
    if (identity.role !== "teacher") {
      throw createError("PERMISSION_DENIED", "请使用教师账号进入学生视角");
    }
    const previewStudentId = String(data.previewStudentId || "").trim();
    if (!previewStudentId) throw createError("INVALID_STUDENT", "学生信息不完整，请返回后重试");
    await ensureStudentAccess(previewStudentId);
    const studentRes = await db.collection("students").doc(previewStudentId).get();
    if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
    return await buildStudentHomeData(studentRes.data, identity, { isTeacherPreview: true });
  }

  const learningDay = vocabulary.getLearningDay();
  if (identity.role === "teacher") {
    const [studentsRes, todayStats, homeworkActivityState, scheduleEvents] = await Promise.all([
      db.collection("students").get(),
      loadAllVocabularyDocuments("vocabularyDailyStats", { learningDay }),
      getOptionalTransactionDocument(
        db.collection("systemLocks").doc(getTeacherHomeworkActivityStateId(identity.openid))
      ),
      loadAllVocabularyDocuments("scheduleEvents", {}),
    ]);
    const visibleStudents = (studentsRes.data || []).filter((student) => !isStudentHiddenFromTeacher(student));
    const students = attachVocabularyTodayPulses(
      await attachSyncedLessonCounts(visibleStudents),
      todayStats
    );
    const [mistakeCounts, lessonResults, submissionResults, quizSessionResults] = await Promise.all([
      Promise.all(students.map((student) => db.collection("mistakes").where({ studentId: student._id }).count())),
      Promise.all(students.map((student) => (
        loadAllStudentDocuments("lessons", student._id)
      ))),
      Promise.all(students.map((student) => (
        loadAllStudentDocuments("lessonSubmissions", student._id)
      ))),
      Promise.all(students.map((student) => (
        loadAllStudentDocuments("vocabularyQuizSessions", student._id)
      ))),
    ]);
    const allLessons = lessonResults
      .flatMap((items) => items || [])
      .map(withTeacherConfirmedHomeworkState)
      .map((lesson) => withHomeworkDeadlineState(lesson));
    const mistakeCount = mistakeCounts.reduce((total, item) => total + Number(item && item.total || 0), 0);
    const recentLessons = allLessons
      .sort((left, right) => String(right.lessonDate || "").localeCompare(String(left.lessonDate || "")))
      .slice(0, 3);
    const homeworkCompletionNotices = buildTeacherHomeworkActivities({
      lessons: allLessons,
      submissions: submissionResults.flatMap((items) => items || []),
      students,
      viewedThroughAtMs: Number(homeworkActivityState && homeworkActivityState.viewedThroughAtMs || 0),
    });
    const activityCutoffAtMs = Math.max(
      Number(homeworkActivityState && homeworkActivityState.viewedThroughAtMs || 0),
      Date.now() - 30 * VOCABULARY_DAY_MS
    );
    const vocabularyAlerts = vocabularyQuiz.buildTeacherVocabularyAlerts({
      students,
      sessions: quizSessionResults.flatMap((items) => items || []),
    }).filter((item) => Number(item.activityAtMs || 0) > activityCutoffAtMs);
    const scheduleActivities = scheduleWorkflow.buildTeacherScheduleActivities({
      events: scheduleEvents,
      students,
      viewedThroughAtMs: Number(homeworkActivityState && homeworkActivityState.viewedThroughAtMs || 0),
    });
    const learningActivityNotices = homeworkCompletionNotices
      .concat(vocabularyAlerts)
      .concat(scheduleActivities)
      .sort((left, right) => Number(right.activityAtMs || 0) - Number(left.activityAtMs || 0))
      .slice(0, 8);
    const progressOverview = summarizeProgress(students);
    const studentsProgress = students.map((student) => Object.assign(
      buildStudentProgressItem(student),
      { vocabularyPulse: student.vocabularyPulse }
    ));
    return {
      success: true,
      role: "teacher",
      openid: identity.openid,
      teacherName: appConfig.teacherName,
      canShowStudentCount: true,
      stats: {
        studentCount: students.length,
        mistakeCount,
        progressOverview,
      },
      studentsProgress,
      recentLessons: await attachStudentNames(recentLessons, students),
      homeworkCompletionNotices,
      learningActivityNotices,
      vocabularyAlgorithmVersion: vocabularyQuiz.ALGORITHM_VERSION,
    };
  }

  if (identity.role === "student") {
    return await buildStudentHomeData(identity.student, identity);
  }

  return {
    success: true,
    role: "guest",
    openid: identity.openid,
    teacherName: appConfig.teacherName,
    canShowStudentCount: false,
    stats: {
      mistakeCount: 0,
      progress: {
        plannedLessonCount: 0,
        completedLessonCount: 0,
        progressPercent: 0,
        progressText: "0 / 0",
      },
    },
    recentLessons: [],
    homeworkCompletionNotices: [],
  };
};

const buildTeacherHomeworkActivities = ({ lessons, submissions, students, viewedThroughAtMs }) => {
  const lessonById = new Map((lessons || []).map((lesson) => [lesson._id, lesson]));
  const studentById = new Map((students || []).map((student) => [student._id, student]));
  const recordingCountByLesson = new Map();
  const latestByLesson = new Map();
  const cutoffAtMs = Math.max(
    Number(viewedThroughAtMs || 0),
    Date.now() - 30 * VOCABULARY_DAY_MS
  );
  const keepLatest = (activity) => {
    if (!activity || !activity._id || Number(activity.activityAtMs || 0) <= cutoffAtMs) return;
    const current = latestByLesson.get(activity._id);
    if (!current || Number(activity.activityAtMs || 0) >= Number(current.activityAtMs || 0)) {
      latestByLesson.set(activity._id, activity);
    }
  };

  (lessons || []).filter(hasLessonHomework).forEach((lesson) => {
    const completedAtMs = Number(lesson.homeworkCompletedAtMs || 0);
    if (!isLessonHomeworkCompleted(lesson) || !completedAtMs) return;
    const student = studentById.get(lesson.studentId);
    keepLatest({
      _id: lesson._id,
      lessonId: lesson._id,
      studentId: lesson.studentId,
      studentName: student && student.name || "学生",
      title: lesson.title || "英语课",
      activityType: "completed",
      activityText: "完成了课后任务",
      activityAtMs: completedAtMs,
      recordingCount: 0,
    });
  });

  (submissions || []).filter(isUsableLessonRecording).forEach((submission) => {
    const lesson = lessonById.get(submission.lessonId);
    if (!lesson || !hasLessonHomework(lesson)) return;
    recordingCountByLesson.set(
      lesson._id,
      Number(recordingCountByLesson.get(lesson._id) || 0) + 1
    );
    const activityAtMs = Number(submission.createdAtMs || 0) || getCreatedTime(submission);
    const student = studentById.get(lesson.studentId);
    keepLatest({
      _id: lesson._id,
      lessonId: lesson._id,
      studentId: lesson.studentId,
      studentName: student && student.name || submission.studentNameSnapshot || "学生",
      title: lesson.title || submission.lessonTitleSnapshot || "英语课",
      activityType: "recording",
      activityText: "提交了录音",
      activityAtMs,
      recordingCount: 1,
    });
  });

  return Array.from(latestByLesson.values())
    .map((activity) => Object.assign({}, activity, {
      recordingCount: activity.activityType === "recording"
        ? Number(recordingCountByLesson.get(activity._id) || activity.recordingCount || 1)
        : Number(recordingCountByLesson.get(activity._id) || 0),
    }))
    .sort((left, right) => Number(right.activityAtMs || 0) - Number(left.activityAtMs || 0))
    .slice(0, 5);
};

const buildStudentLearningActivities = ({ lessons, sessions, reminders, viewedThroughAtMs }) => {
  const cutoffAtMs = Math.max(
    Number(viewedThroughAtMs || 0),
    Date.now() - 30 * VOCABULARY_DAY_MS
  );
  const activities = [];
  (sessions || []).forEach((session) => {
    const activityAtMs = Number(session.completedAtMs || 0);
    if (activityAtMs <= cutoffAtMs) return;
    const correct = Math.max(0, Number(session.correctCount || 0));
    const total = Math.max(0, Number(session.totalQuestions || 0));
    activities.push({
      _id: `quiz:${session._id || activityAtMs}`,
      activityType: "vocabularyQuiz",
      title: "单词小测已完成",
      activityText: `答对 ${correct}/${total} 题${total > correct ? `，有 ${total - correct} 个词可以再练` : "，全部答对"}`,
      activityAtMs,
    });
  });
  (lessons || []).forEach((lesson) => {
    const reviewedAtMs = Number(lesson.homeworkTeacherReviewedAtMs || 0);
    if (reviewedAtMs > cutoffAtMs) {
      activities.push({
        _id: `review:${lesson._id}:${reviewedAtMs}`,
        lessonId: lesson._id,
        activityType: "homeworkReview",
        title: "老师已检查课后任务",
        activityText: lesson.homeworkTeacherReviewStatus === "completed"
          ? `${lesson.title || "英语课"}：老师确认已完成`
          : `${lesson.title || "英语课"}：老师建议继续完成`,
        activityAtMs: reviewedAtMs,
      });
    }
    const createdAtMs = getCreatedTime(lesson);
    if (createdAtMs > cutoffAtMs) {
      activities.push({
        _id: `lesson:${lesson._id}:${createdAtMs}`,
        lessonId: lesson._id,
        activityType: "newLesson",
        title: "老师布置了新的英语课",
        activityText: lesson.title || "查看课程与课后任务",
        activityAtMs: createdAtMs,
      });
    }
  });
  const reminderActivities = studentEngagement.buildReminderActivities({
    reminders,
    viewedThroughAtMs,
  });
  return activities
    .concat(reminderActivities)
    .sort((left, right) => Number(right.activityAtMs || 0) - Number(left.activityAtMs || 0))
    .slice(0, 8);
};

const markHomeworkActivitiesViewed = async (event = {}) => {
  const identity = await getIdentity();
  if (identity.role !== "teacher") {
    throw createError("PERMISSION_DENIED", "请使用教师账号更新课后任务动态");
  }
  const requestedAtMs = Math.min(
    Date.now(),
    Math.max(0, Number(event.data && event.data.viewedThroughAtMs || 0))
  );
  if (!requestedAtMs) return { success: true, viewedThroughAtMs: 0 };
  await createOneCollection("systemLocks");
  const stateId = getTeacherHomeworkActivityStateId(identity.openid);
  const viewedThroughAtMs = await runTransaction(async (transaction) => {
    const stateRef = transaction.collection("systemLocks").doc(stateId);
    const current = await getOptionalTransactionDocument(stateRef);
    const nextAtMs = Math.max(Number(current && current.viewedThroughAtMs || 0), requestedAtMs);
    await stateRef.set({
      data: {
        lockType: "teacherHomeworkActivityRead",
        teacherOpenId: identity.openid,
        viewedThroughAtMs: nextAtMs,
        updatedAt: db.serverDate(),
      },
    });
    return nextAtMs;
  });
  return { success: true, viewedThroughAtMs };
};

const markStudentLearningActivitiesViewed = async (event = {}) => {
  const identity = await getIdentity();
  if (identity.role !== "student" || !identity.student) {
    throw createError("PERMISSION_DENIED", "当前为老师预览，学生已读状态保持原记录");
  }
  const requestedAtMs = Math.min(
    Date.now(),
    Math.max(0, Number(event.data && event.data.viewedThroughAtMs || 0))
  );
  if (!requestedAtMs) return { success: true, viewedThroughAtMs: 0 };
  await createOneCollection("systemLocks");
  const studentId = identity.student._id;
  const stateId = getStudentLearningActivityStateId(studentId);
  const viewedThroughAtMs = await runTransaction(async (transaction) => {
    const stateRef = transaction.collection("systemLocks").doc(stateId);
    const current = await getOptionalTransactionDocument(stateRef);
    const nextAtMs = Math.max(Number(current && current.viewedThroughAtMs || 0), requestedAtMs);
    await stateRef.set({
      data: {
        lockType: "studentLearningActivityRead",
        studentId,
        viewedThroughAtMs: nextAtMs,
        updatedAt: db.serverDate(),
      },
    });
    return nextAtMs;
  });
  return { success: true, viewedThroughAtMs };
};

const getTeacherLearningAlerts = async () => {
  await ensureTeacher();
  await createOneCollection("vocabularyQuizSessions");
  const studentsRes = await db.collection("students").get();
  const students = (studentsRes.data || []).filter((student) => !isStudentHiddenFromTeacher(student));
  const sessions = (await Promise.all(students.map((student) => (
    loadAllStudentDocuments("vocabularyQuizSessions", student._id)
  )))).flatMap((items) => items || []);
  const alerts = vocabularyQuiz.buildTeacherVocabularyAlerts({ students, sessions });
  return {
    success: true,
    algorithmVersion: vocabularyQuiz.ALGORITHM_VERSION,
    sessionCount: sessions.length,
    alerts,
  };
};

const getTeacherTodos = async () => {
  await ensureTeacher();
  await Promise.all([
    createOneCollection("lessonSubmissions"),
    createOneCollection("vocabularyDailyStats"),
    createOneCollection("vocabularyQuizSessions"),
  ]);
  const studentsRes = await db.collection("students").get();
  const students = (studentsRes.data || [])
    .filter((student) => !isStudentHiddenFromTeacher(student))
    .map((student) => Object.assign({}, student, {
      englishCourseEnabled: isEnglishCourseEnabled(student),
    }));
  const [lessonResults, submissionResults, quizSessionResults, dailyStatsResults, ketMockSessions] = await Promise.all([
    Promise.all(students.map((student) => loadAllStudentDocuments("lessons", student._id))),
    Promise.all(students.map((student) => loadAllStudentDocuments("lessonSubmissions", student._id))),
    Promise.all(students.map((student) => loadAllStudentDocuments("vocabularyQuizSessions", student._id))),
    Promise.all(students.map((student) => (
      loadAllVocabularyDocuments("vocabularyDailyStats", { studentId: student._id })
    ))),
    ketMockService.loadSessionsForStudents(students),
  ]);
  const quizSessions = quizSessionResults.flatMap((items) => items || []);
  const result = teacherTodos.buildTeacherTodos({
    students,
    lessons: lessonResults.flatMap((items) => items || []),
    submissions: submissionResults.flatMap((items) => items || []),
    vocabularyAlerts: vocabularyQuiz.buildTeacherVocabularyAlerts({ students, sessions: quizSessions }),
    dailyStats: dailyStatsResults.flatMap((items) => items || []),
    quizSessions,
    ketMockSessions,
  });
  return Object.assign({
    success: true,
    inactivityThresholdDays: teacherTodos.INACTIVITY_THRESHOLD_DAYS,
  }, result);
};

const normalizeStudentReminderInput = (data = {}) => {
  const rawTitle = String(data.title || "").trim();
  const rawContent = String(data.content || "").trim();
  if (!rawTitle) throw createError("INVALID_REMINDER", "请填写提醒标题");
  if (!rawContent) throw createError("INVALID_REMINDER", "请填写提醒内容");
  if (rawTitle.length > 40) throw createError("INVALID_REMINDER", "提醒标题最多 40 个字");
  if (rawContent.length > 300) throw createError("INVALID_REMINDER", "提醒内容最多 300 个字");
  return { title: rawTitle, content: rawContent };
};

const sanitizeStudentReminder = (reminder) => ({
  _id: reminder._id || "",
  studentId: reminder.studentId || "",
  title: reminder.title || "",
  content: reminder.content || "",
  status: reminder.status === "withdrawn" ? "withdrawn" : "active",
  version: Math.max(1, Number(reminder.version) || 1),
  createdAtMs: Math.max(0, Number(reminder.createdAtMs) || getCreatedTime(reminder)),
  updatedAtMs: Math.max(
    0,
    Number(reminder.updatedAtMs)
      || getDateLikeTime(reminder.updatedAt)
      || Number(reminder.createdAtMs)
      || getCreatedTime(reminder)
  ),
  withdrawnAtMs: Math.max(0, Number(reminder.withdrawnAtMs) || 0),
});

const listStudentReminders = async (event = {}) => {
  await ensureTeacher();
  const studentId = String(event.data && event.data.studentId || "").trim();
  if (!studentId) throw createError("INVALID_STUDENT", "学生信息不完整，请返回后重试");
  await createOneCollection("studentReminders");
  const studentRes = await db.collection("students").doc(studentId).get();
  if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
  const allReminders = (await loadAllStudentDocuments("studentReminders", studentId))
    .map(sanitizeStudentReminder)
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs);
  const activeReminders = allReminders.filter((item) => item.status === "active");
  const recentHistory = allReminders.filter((item) => item.status === "withdrawn").slice(0, 30);
  const reminders = activeReminders.concat(recentHistory)
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs);
  return {
    success: true,
    student: { _id: studentRes.data._id, name: studentRes.data.name || "学生" },
    reminders,
    activeCount: activeReminders.length,
  };
};

const saveStudentReminder = async (event = {}) => {
  const teacherIdentity = await ensureTeacher();
  const data = event.data || {};
  const studentId = String(data.studentId || "").trim();
  const reminderId = String(data.reminderId || "").trim();
  if (!studentId) throw createError("INVALID_STUDENT", "学生信息不完整，请返回后重试");
  if (reminderId && !/^[a-zA-Z0-9_-]{1,120}$/.test(reminderId)) {
    throw createError("INVALID_REMINDER", "提醒信息无效，请刷新后重试");
  }
  const input = normalizeStudentReminderInput(data);
  await assertContentSafe({ texts: [input.title, input.content] });
  await createOneCollection("studentReminders");
  const studentRes = await db.collection("students").doc(studentId).get();
  if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
  const nowMs = Date.now();
  const targetId = reminderId || `student_reminder_${nowMs}_${crypto.randomBytes(6).toString("hex")}`;
  const reminder = await runTransaction(async (transaction) => {
    const reminderRef = transaction.collection("studentReminders").doc(targetId);
    const current = await getOptionalTransactionDocument(reminderRef);
    if (reminderId) {
      if (!current || current.studentId !== studentId) {
        throw createError("REMINDER_NOT_FOUND", "这条提醒不存在或已经撤回");
      }
      if (current.status === "withdrawn") {
        throw createError("REMINDER_WITHDRAWN", "这条提醒已撤回；新建提醒即可继续发布");
      }
      const updateData = {
        title: input.title,
        content: input.content,
        version: Math.max(1, Number(current.version) || 1) + 1,
        updatedAt: db.serverDate(),
        updatedAtMs: nowMs,
        updatedBy: teacherIdentity.openid || "",
      };
      await reminderRef.update({ data: updateData });
      return Object.assign({}, current, updateData, { _id: targetId });
    }
    const created = {
      studentId,
      title: input.title,
      content: input.content,
      status: "active",
      version: 1,
      createdBy: teacherIdentity.openid || "",
      updatedBy: teacherIdentity.openid || "",
      createdAt: db.serverDate(),
      createdAtMs: nowMs,
      updatedAt: db.serverDate(),
      updatedAtMs: nowMs,
    };
    await reminderRef.set({ data: created });
    return Object.assign({ _id: targetId }, created);
  });
  return {
    success: true,
    created: !reminderId,
    reminder: sanitizeStudentReminder(reminder),
  };
};

const withdrawStudentReminder = async (event = {}) => {
  const teacherIdentity = await ensureTeacher();
  const reminderId = String(event.data && event.data.reminderId || "").trim();
  if (!reminderId || !/^[a-zA-Z0-9_-]{1,120}$/.test(reminderId)) {
    throw createError("INVALID_REMINDER", "提醒信息无效，请刷新后重试");
  }
  await createOneCollection("studentReminders");
  const nowMs = Date.now();
  const reminder = await runTransaction(async (transaction) => {
    const reminderRef = transaction.collection("studentReminders").doc(reminderId);
    const current = await getOptionalTransactionDocument(reminderRef);
    if (!current) throw createError("REMINDER_NOT_FOUND", "这条提醒不存在或已经撤回");
    if (current.status === "withdrawn") return Object.assign({}, current, { _id: reminderId });
    const updateData = {
      status: "withdrawn",
      withdrawnAt: db.serverDate(),
      withdrawnAtMs: nowMs,
      withdrawnBy: teacherIdentity.openid || "",
      updatedAt: db.serverDate(),
      updatedAtMs: nowMs,
    };
    await reminderRef.update({ data: updateData });
    return Object.assign({}, current, updateData, { _id: reminderId });
  });
  return { success: true, reminder: sanitizeStudentReminder(reminder) };
};

const loadStudentEngagementParticipant = async (student) => {
  const studentId = student._id;
  const [vocabularyDailyStats, quizSessions, lessons, submissions, ketMockSessions, frenchProgress] = await Promise.all([
    loadAllStudentDocuments("vocabularyDailyStats", studentId),
    loadAllStudentDocuments("vocabularyQuizSessions", studentId),
    loadAllStudentDocuments("lessons", studentId),
    loadAllStudentDocuments("lessonSubmissions", studentId),
    loadAllStudentDocuments("ketMockSessions", studentId),
    loadAllVocabularyDocuments("frenchLearningProgress", { learnerKey: `student:${studentId}` }),
  ]);
  return {
    student,
    records: {
      vocabularyDailyStats,
      quizSessions,
      lessons,
      submissions,
      ketMockSessions,
      frenchProgress,
    },
  };
};

const isStudentManagedByTeacher = (student, teacherIdentity) => {
  const ownerOpenId = String(student && student.teacherOpenId || "").trim();
  const teacherOpenId = String(teacherIdentity && teacherIdentity.openid || "").trim();
  return !ownerOpenId || !teacherOpenId || ownerOpenId === teacherOpenId;
};

const loadTeacherPkChallengeProfiles = async (teacherOpenId) => {
  await createOneCollection("pkChallengeProfiles");
  return loadAllVocabularyDocuments("pkChallengeProfiles", { teacherOpenId: String(teacherOpenId || "").trim() });
};

const sanitizePkChallengeProfile = (profile, nowMs = Date.now()) => {
  const normalized = studentEngagement.normalizePkChallengeProfile(profile);
  const scoreState = studentEngagement.getPkChallengeScore(normalized, nowMs);
  return Object.assign({}, normalized, {
    currentScore: scoreState.score,
    elapsedDays: scoreState.elapsedDays,
    weekLabel: scoreState.week.label,
    updatedAtMs: Math.max(0, Number(profile && profile.updatedAtMs) || 0),
  });
};

const getTeacherEngagementManager = async () => {
  const teacherIdentity = await ensureTeacher();
  await Promise.all([
    createOneCollection("vocabularyDailyStats"),
    createOneCollection("vocabularyQuizSessions"),
    createOneCollection("lessonSubmissions"),
    createOneCollection("ketMockSessions"),
    createOneCollection("frenchLearningProgress"),
    createOneCollection("pkChallengeProfiles"),
  ]);
  const allStudents = await loadAllVocabularyDocuments("students", {});
  const students = allStudents.filter((student) => isStudentManagedByTeacher(student, teacherIdentity));
  const [participantRecords, challengeProfiles] = await Promise.all([
    Promise.all(students.map(loadStudentEngagementParticipant)),
    loadTeacherPkChallengeProfiles(teacherIdentity.openid),
  ]);
  const studentRows = participantRecords.map((participant) => {
    const student = participant.student;
    const score = studentEngagement.buildStudentScore(participant.records);
    const achievements = studentEngagement.buildAchievements(score, student);
    const status = String(student.status || "在读").trim() || "在读";
    return {
      _id: student._id,
      name: String(student.name || "学生").trim(),
      nickname: String(student.nickname || "").trim(),
      grade: String(student.grade || "").trim(),
      status,
      teacherHidden: student.teacherHidden === true,
      pkEnabled: student.pkEnabled !== false,
      statusEligible: status === "在读" && student.teacherHidden !== true,
      effectivePkEnabled: studentEngagement.isPkEligibleStudent(student),
      weeklyPoints: score.weeklyPoints,
      totalPoints: score.totalPoints,
      completedLessonCount: Math.max(
        Number(score.recordedLessonCount) || 0,
        Number(student.completedLessonCount) || 0
      ),
      unlockedAchievementCount: achievements.filter((item) => item.unlocked).length,
      achievementCount: achievements.length,
    };
  }).sort((left, right) => (
    Number(right.effectivePkEnabled) - Number(left.effectivePkEnabled)
    || left.name.localeCompare(right.name, "zh-CN")
  ));
  const nowMs = Date.now();
  const profiles = challengeProfiles
    .map((profile) => sanitizePkChallengeProfile(profile, nowMs))
    .sort((left, right) => Number(right.enabled) - Number(left.enabled) || right.currentScore - left.currentScore);
  return {
    success: true,
    week: studentEngagement.getWeekWindow(nowMs),
    studentRows,
    challengeProfiles: profiles,
    limits: studentEngagement.PK_CHALLENGE_LIMITS,
    pointRules: studentEngagement.POINT_RULES,
  };
};

const saveStudentPkEligibility = async (event = {}) => {
  const teacherIdentity = await ensureTeacher();
  const data = event.data || {};
  const studentId = String(data.studentId || "").trim();
  if (!studentId) throw createError("INVALID_STUDENT", "学生信息不完整，请刷新后重试");
  const studentRef = db.collection("students").doc(studentId);
  const student = await getOptionalTransactionDocument(studentRef);
  if (!student || !isStudentManagedByTeacher(student, teacherIdentity)) {
    throw createError("PERMISSION_DENIED", "请从负责该学生的教师账号管理 PK 设置");
  }
  const pkEnabled = data.pkEnabled === true;
  await studentRef.update({
    data: {
      pkEnabled,
      pkUpdatedAt: db.serverDate(),
      pkUpdatedAtMs: Date.now(),
      pkUpdatedBy: teacherIdentity.openid || "",
    },
  });
  return { success: true, studentId, pkEnabled };
};

const normalizePkChallengeInput = (data = {}) => {
  const name = String(data.name || "").trim();
  if (!name) throw createError("INVALID_PK_CHALLENGE", "请填写挑战选手名称");
  if (Array.from(name).length > studentEngagement.PK_CHALLENGE_LIMITS.nameLength) {
    throw createError("INVALID_PK_CHALLENGE", `挑战选手名称最多 ${studentEngagement.PK_CHALLENGE_LIMITS.nameLength} 个字`);
  }
  const weeklyBaseScore = Number(data.weeklyBaseScore);
  const dailyIncrement = Number(data.dailyIncrement);
  if (!Number.isInteger(weeklyBaseScore) || weeklyBaseScore < 0 || weeklyBaseScore > studentEngagement.PK_CHALLENGE_LIMITS.weeklyBaseScoreMax) {
    throw createError("INVALID_PK_CHALLENGE", `周一起始分须为 0–${studentEngagement.PK_CHALLENGE_LIMITS.weeklyBaseScoreMax} 的整数`);
  }
  if (!Number.isInteger(dailyIncrement) || dailyIncrement < 0 || dailyIncrement > studentEngagement.PK_CHALLENGE_LIMITS.dailyIncrementMax) {
    throw createError("INVALID_PK_CHALLENGE", `每日增幅须为 0–${studentEngagement.PK_CHALLENGE_LIMITS.dailyIncrementMax} 的整数`);
  }
  return { name, weeklyBaseScore, dailyIncrement, enabled: data.enabled !== false };
};

const savePkChallengeProfile = async (event = {}) => {
  const teacherIdentity = await ensureTeacher();
  await createOneCollection("pkChallengeProfiles");
  const data = event.data || {};
  const profileId = String(data.profileId || "").trim();
  if (profileId && !/^[a-zA-Z0-9_-]{1,120}$/.test(profileId)) {
    throw createError("INVALID_PK_CHALLENGE", "挑战选手信息无效，请刷新后重试");
  }
  const input = normalizePkChallengeInput(data);
  await assertContentSafe({ texts: [input.name] });
  const nowMs = Date.now();
  const targetId = profileId || `pk_challenge_${nowMs}_${crypto.randomBytes(6).toString("hex")}`;
  const saved = await runTransaction(async (transaction) => {
    const profileRef = transaction.collection("pkChallengeProfiles").doc(targetId);
    const current = await getOptionalTransactionDocument(profileRef);
    if (profileId && !current) throw createError("PK_CHALLENGE_NOT_FOUND", "挑战选手不存在或已删除");
    if (current && String(current.teacherOpenId || "") !== String(teacherIdentity.openid || "")) {
      throw createError("PERMISSION_DENIED", "请管理由当前教师创建的挑战选手");
    }
    const payload = Object.assign({}, input, {
      teacherOpenId: teacherIdentity.openid || "",
      updatedAt: db.serverDate(),
      updatedAtMs: nowMs,
    });
    if (current) {
      await profileRef.update({ data: payload });
    } else {
      await profileRef.set({ data: Object.assign({}, payload, { createdAt: db.serverDate(), createdAtMs: nowMs }) });
    }
    return Object.assign({}, current || {}, payload, { _id: targetId });
  });
  return { success: true, profile: sanitizePkChallengeProfile(saved, nowMs) };
};

const deletePkChallengeProfile = async (event = {}) => {
  const teacherIdentity = await ensureTeacher();
  await createOneCollection("pkChallengeProfiles");
  const profileId = String(event.data && event.data.profileId || "").trim();
  if (!profileId || !/^[a-zA-Z0-9_-]{1,120}$/.test(profileId)) {
    throw createError("INVALID_PK_CHALLENGE", "挑战选手信息无效，请刷新后重试");
  }
  const profileRef = db.collection("pkChallengeProfiles").doc(profileId);
  const current = await getOptionalTransactionDocument(profileRef);
  if (!current) return { success: true, alreadyDeleted: true };
  if (String(current.teacherOpenId || "") !== String(teacherIdentity.openid || "")) {
    throw createError("PERMISSION_DENIED", "请管理由当前教师创建的挑战选手");
  }
  await profileRef.remove();
  return { success: true, profileId };
};

const getStudentEngagement = async (event = {}) => {
  const identity = await getIdentity();
  const data = event.data || {};
  const isTeacherPreview = data.mode === "teacherPreview";
  if (identity.role === "guest") throw createError("PERMISSION_DENIED", "请先绑定学习账号");
  if (isTeacherPreview && identity.role !== "teacher") {
    throw createError("PERMISSION_DENIED", "请使用教师账号进入学生视角");
  }
  if (identity.role === "teacher" && !isTeacherPreview) {
    throw createError("PERMISSION_DENIED", "请从学生详情进入学生端预览");
  }
  const requestedStudentId = String(data.previewStudentId || data.studentId || "").trim();
  const studentId = identity.role === "student" && identity.student
    ? identity.student._id
    : requestedStudentId;
  if (!studentId) throw createError("INVALID_STUDENT", "学生信息不完整，请返回后重试");
  await ensureStudentAccess(studentId);
  await Promise.all([
    createOneCollection("vocabularyDailyStats"),
    createOneCollection("vocabularyQuizSessions"),
    createOneCollection("lessonSubmissions"),
    createOneCollection("ketMockSessions"),
    createOneCollection("frenchLearningProgress"),
    createOneCollection("pkChallengeProfiles"),
  ]);
  const allStudents = await loadAllVocabularyDocuments("students", {});
  const currentStudent = allStudents.find((student) => student._id === studentId);
  if (!currentStudent) throw createError("INVALID_STUDENT", "学生不存在或已删除");
  const currentTeacherOpenId = String(currentStudent.teacherOpenId || "").trim();
  const configuredTeacherOpenId = Array.isArray(appConfig.teacherOpenIds)
    ? String(appConfig.teacherOpenIds[0] || "").trim()
    : "";
  const rankingTeacherOpenId = currentTeacherOpenId || configuredTeacherOpenId;
  const participants = allStudents.filter((student) => {
    if (student._id === studentId) return true;
    if (!studentEngagement.isPkEligibleStudent(student)) return false;
    const participantTeacherOpenId = String(student.teacherOpenId || "").trim();
    return !rankingTeacherOpenId
      || !participantTeacherOpenId
      || participantTeacherOpenId === rankingTeacherOpenId;
  });
  const [participantRecords, challengeProfiles] = await Promise.all([
    Promise.all(participants.map(loadStudentEngagementParticipant)),
    rankingTeacherOpenId
      ? loadTeacherPkChallengeProfiles(rankingTeacherOpenId)
      : Promise.resolve([]),
  ]);
  const dashboard = studentEngagement.buildEngagementDashboard({
    participants: participantRecords,
    challengeProfiles,
    currentStudentId: studentId,
  });
  if (!dashboard) throw createError("ENGAGEMENT_UNAVAILABLE", "成就数据暂时无法计算，请稍后再试");
  return {
    success: true,
    role: identity.role,
    isTeacherPreview,
    readOnly: isTeacherPreview,
    student: sanitizeStudent(currentStudent, false),
    dashboard,
  };
};

const bindStudent = async (event) => {
  return await bindAccessCode(event);
};

const bindTeacher = async (openid) => {
  await createOneCollection("teachers");
  const existing = await db.collection("teachers").where({ openid }).limit(1).get();
  if (!existing.data || !existing.data.length) {
    await db.collection("teachers").add({
      data: {
        openid,
        teacherName: appConfig.teacherName,
        createdAt: db.serverDate(),
      },
    });
  }
  await setIdentityMode(openid, "teacher");

  return {
    success: true,
    role: "teacher",
    openid,
    teacherName: appConfig.teacherName,
    message: "教师身份已绑定",
  };
};

const bindAccessCode = async (event) => {
  const identity = await getIdentity();
  const accessCode = normalizeCode(event.data && event.data.accessCode);
  if (!accessCode) {
    throw createError("INVALID_ACCESS_CODE", "请输入访问码");
  }

  if (isTeacherAccessCode(accessCode)) {
    return await bindTeacher(identity.openid);
  }

  if (identity.role === "teacher") {
    throw createError("ALREADY_TEACHER", "当前是教师账号，可直接进入教师首页");
  }
  if (identity.role === "student") {
    return {
      success: true,
      role: "student",
      openid: identity.openid,
      student: sanitizeStudent(identity.student, false),
      message: "当前微信已绑定学生账号",
    };
  }

  const res = await db.collection("students").where({ accessCode }).limit(1).get();
  if (!res.data || !res.data.length) {
    throw createError("ACCESS_CODE_NOT_FOUND", "访问码不正确，请检查后重试");
  }

  const student = res.data[0];
  await createOneCollection("systemLocks");
  const boundStudent = await runTransaction(async (transaction) => {
    const studentRef = transaction.collection("students").doc(student._id);
    const openIdLockRef = transaction
      .collection("systemLocks")
      .doc(getSystemLockId("student_openid", identity.openid));
    const [currentStudentRes, openIdLock] = await Promise.all([
      studentRef.get(),
      getOptionalTransactionDocument(openIdLockRef),
    ]);
    const currentStudent = currentStudentRes && currentStudentRes.data;
    if (!currentStudent || normalizeCode(currentStudent.accessCode) !== accessCode) {
      throw createError("ACCESS_CODE_NOT_FOUND", "访问码不正确，请检查后重试");
    }
    if (openIdLock && openIdLock.studentId && openIdLock.studentId !== currentStudent._id) {
      throw createError("ALREADY_BOUND", "当前微信已绑定其他学生账号");
    }

    const studentOpenIds = getStudentOpenIds(currentStudent);
    const bindLimit = getStudentBindLimit(currentStudent);
    if (
      studentOpenIds.indexOf(identity.openid) < 0
      && Number.isFinite(bindLimit)
      && studentOpenIds.length >= bindLimit
    ) {
      throw createError("ACCESS_CODE_USED", `这个访问码最多可绑定 ${bindLimit} 个微信账号`);
    }
    const nextStudentOpenIds = uniqueValues(studentOpenIds.concat(identity.openid));
    const nextStudentOpenId = currentStudent.studentOpenId || identity.openid;
    const identityModeRef = transaction
      .collection("systemLocks")
      .doc(getIdentityModeId(identity.openid));

    await studentRef.update({
      data: {
        studentOpenId: nextStudentOpenId,
        studentOpenIds: nextStudentOpenIds,
      },
    });
    await openIdLockRef.set({
      data: {
        recordType: "studentOpenIdLock",
        studentId: currentStudent._id,
        updatedAt: db.serverDate(),
      },
    });
    await identityModeRef.set({
      data: {
        recordType: "identityMode",
        mode: "student",
        studentId: currentStudent._id,
        updatedAt: db.serverDate(),
      },
    });

    return Object.assign({}, currentStudent, {
      studentOpenId: nextStudentOpenId,
      studentOpenIds: nextStudentOpenIds,
    });
  });

  return {
    success: true,
    role: "student",
    openid: identity.openid,
    student: sanitizeStudent(boundStudent, false),
  };
};

const unbindIdentity = async () => {
  await createOneCollection("systemLocks");
  const identity = await getIdentity();
  const openid = identity.openid || getOpenIdFromContext();
  if (identity.role === "student" && identity.student) {
    await runTransaction(async (transaction) => {
      const studentRef = transaction.collection("students").doc(identity.student._id);
      const currentStudentRes = await studentRef.get();
      const currentStudent = currentStudentRes && currentStudentRes.data;
      if (currentStudent) {
        const nextStudentOpenIds = getStudentOpenIds(currentStudent).filter((item) => item !== openid);
        const nextStudentOpenId = currentStudent.studentOpenId === openid
          ? (nextStudentOpenIds[0] || "")
          : currentStudent.studentOpenId || "";
        await studentRef.update({
          data: {
            studentOpenId: nextStudentOpenId,
            studentOpenIds: nextStudentOpenIds,
          },
        });
      }
      await transaction.collection("systemLocks")
        .doc(getSystemLockId("student_openid", openid))
        .set({
          data: {
            recordType: "studentOpenIdLock",
            studentId: "",
            releasedAt: db.serverDate(),
            updatedAt: db.serverDate(),
          },
        });
      await transaction.collection("systemLocks")
        .doc(getIdentityModeId(openid))
        .set({
          data: {
            recordType: "identityMode",
            mode: "signedOut",
            studentId: "",
            updatedAt: db.serverDate(),
          },
        });
    });
  } else {
    await setIdentityMode(openid, "signedOut");
  }
  return {
    success: true,
    previousRole: identity.role,
    message: "已退出当前身份，学习资料和记录均已保留",
  };
};

const listStudents = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  const res = await db.collection("students").orderBy("createdAt", "desc").get();
  const students = await attachSyncedLessonCounts(res.data || []);
  const hiddenCount = students.filter(isStudentHiddenFromTeacher).length;
  const visibleStudents = data.includeHidden === true
    ? students
    : students.filter((student) => !isStudentHiddenFromTeacher(student));
  return {
    success: true,
    role: "teacher",
    activeCount: students.length - hiddenCount,
    hiddenCount,
    data: visibleStudents.map((student) => sanitizeStudent(student, true)),
  };
};

const setStudentVisibility = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  const studentId = String(data.studentId || "").trim();
  if (!studentId) throw createError("INVALID_STUDENT", "学生信息不完整，请返回后重试");
  if (typeof data.hidden !== "boolean") {
    throw createError("INVALID_VISIBILITY", "请选择隐藏或恢复该学生");
  }
  const studentRes = await db.collection("students").doc(studentId).get();
  if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
  await db.collection("students").doc(studentId).update({
    data: {
      teacherHidden: data.hidden,
      teacherHiddenUpdatedAt: db.serverDate(),
    },
  });
  return {
    success: true,
    studentId,
    hidden: data.hidden,
    message: data.hidden ? "学生已移入教师工作台" : "学生已恢复到学生列表",
  };
};

const addStudent = async (event) => {
  const teacherIdentity = await ensureTeacher();
  const data = event.data || {};
  const accessCode = normalizeCode(data.accessCode);
  if (!data.name || !data.grade || !accessCode) {
    throw createError("INVALID_STUDENT", "请填写学生姓名、年级和访问码");
  }
  if (isTeacherAccessCode(accessCode)) {
    throw createError("ACCESS_CODE_RESERVED", "请设置与老师访问码不同的学生访问码");
  }
  const existing = await db.collection("students").where({ accessCode }).limit(1).get();
  if (existing.data && existing.data.length) {
    throw createError("ACCESS_CODE_EXISTS", "这个访问码已被使用");
  }
  await assertContentSafe({
    texts: [data.name, data.nickname, data.grade, data.parentName, data.status, data.teacherName, data.subject],
  });
  const plannedLessonCount = toNonNegativeNumber(data.plannedLessonCount, "总课时");
  const completedLessonCount = toNonNegativeNumber(data.completedLessonCount, "已上课时");
  const lessonPackageSize = Object.prototype.hasOwnProperty.call(data, "lessonPackageSize")
    ? toLessonPackageSize(data.lessonPackageSize)
    : courseWorkflow.getDefaultLessonPackageSize(data);
  if (plannedLessonCount > 0 && completedLessonCount > plannedLessonCount) {
    throw createError("INVALID_PROGRESS", "已上课时范围为 0 至总课时");
  }
  const lessonAccountingMode = courseWorkflow.getLessonAccountingMode(data);
  const plannedLessonMinutes = lessonAccountingMode === "minute" ? plannedLessonCount * 60 : 0;
  const completedLessonMinutes = lessonAccountingMode === "minute" ? completedLessonCount * 60 : 0;
  const bookingDurationMinutes = toBookingDurationMinutes(
    data.bookingDurationMinutes,
    scheduleWorkflow.getDefaultBookingDurationMinutes(data)
  );
  await createOneCollection("systemLocks");
  const studentId = crypto.randomBytes(16).toString("hex");
  const initialStudentOpenId = String(data.studentOpenId || "").trim();
  const studentData = {
    name: data.name,
    nickname: data.nickname || "",
    grade: data.grade || "",
    parentName: data.parentName || "",
    status: data.status || "在读",
    accessCode,
    studentOpenId: initialStudentOpenId,
    studentOpenIds: getStudentOpenIds({ studentOpenId: initialStudentOpenId }),
    studentBindLimit: DEFAULT_STUDENT_BIND_LIMIT,
    teacherOpenId: teacherIdentity.openid,
    teacherName: data.teacherName || appConfig.teacherName,
    subject: data.subject || appConfig.defaultSubject,
    plannedLessonCount,
    completedLessonCount,
    lessonPackageSize,
    lessonAccountingMode,
    plannedLessonMinutes,
    completedLessonMinutes,
    recordedLessonMinutes: 0,
    bookingDurationMinutes,
    recordedLessonCount: 0,
    vocabularyEnabled: false,
    englishCourseEnabled: true,
    mistakeLearningEnabled: true,
    frenchLearningEnabled: false,
    teacherHidden: false,
    vocabularySettings: vocabulary.getDefaultVocabularySettings(),
    createdAt: db.serverDate(),
  };
  return await runTransaction(async (transaction) => {
    const accessCodeLockRef = transaction
      .collection("systemLocks")
      .doc(getSystemLockId("student_access_code", accessCode));
    const openIdLockRef = initialStudentOpenId
      ? transaction.collection("systemLocks").doc(getSystemLockId("student_openid", initialStudentOpenId))
      : null;
    const [accessCodeLock, currentExisting, openIdLock, legacyPrimaryOwner, legacyMultiOwner] = await Promise.all([
      getOptionalTransactionDocument(accessCodeLockRef),
      transaction.collection("students").where({ accessCode }).limit(1).get(),
      openIdLockRef ? getOptionalTransactionDocument(openIdLockRef) : Promise.resolve(null),
      initialStudentOpenId
        ? transaction.collection("students").where({ studentOpenId: initialStudentOpenId }).limit(1).get()
        : Promise.resolve({ data: [] }),
      initialStudentOpenId
        ? transaction.collection("students").where({ studentOpenIds: initialStudentOpenId }).limit(1).get()
        : Promise.resolve({ data: [] }),
    ]);
    if (
      (accessCodeLock && accessCodeLock.studentId)
      || (currentExisting.data && currentExisting.data.length)
    ) {
      throw createError("ACCESS_CODE_EXISTS", "这个访问码已被使用");
    }
    if (
      initialStudentOpenId
      && (
        (openIdLock && openIdLock.studentId)
        || (legacyPrimaryOwner.data && legacyPrimaryOwner.data.length)
        || (legacyMultiOwner.data && legacyMultiOwner.data.length)
      )
    ) {
      throw createError("OPENID_EXISTS", "这个微信账号已绑定其他学生");
    }

    await transaction.collection("students").doc(studentId).set({ data: studentData });
    await accessCodeLockRef.set({
      data: {
        recordType: "studentAccessCodeLock",
        studentId,
        updatedAt: db.serverDate(),
      },
    });
    if (openIdLockRef) {
      await openIdLockRef.set({
        data: {
          recordType: "studentOpenIdLock",
          studentId,
          updatedAt: db.serverDate(),
        },
      });
    }
    return { _id: studentId };
  });
};

const updateStudentProgress = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  if (!data.studentId) {
    throw createError("INVALID_PROGRESS", "学生信息不完整，请返回后重试");
  }
  const [lessonMetrics, studentRes] = await Promise.all([
    getStudentLessonMetrics(data.studentId),
    db.collection("students").doc(data.studentId).get(),
  ]);
  if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
  const lessonAccountingMode = courseWorkflow.getLessonAccountingMode(studentRes.data);
  const bookingDurationMinutes = toBookingDurationMinutes(
    data.bookingDurationMinutes,
    scheduleWorkflow.getDefaultBookingDurationMinutes(studentRes.data)
  );
  if (lessonAccountingMode === "minute") {
    const plannedLessonMinutes = toLessonMinutes(
      Object.prototype.hasOwnProperty.call(data, "plannedLessonMinutes")
        ? data.plannedLessonMinutes
        : Number(data.plannedLessonCount || 0) * 60,
      "总课时"
    );
    const completedLessonMinutes = toLessonMinutes(
      Object.prototype.hasOwnProperty.call(data, "completedLessonMinutes")
        ? data.completedLessonMinutes
        : Number(data.completedLessonCount || 0) * 60,
      "已上课时"
    );
    if (plannedLessonMinutes > 0 && completedLessonMinutes > plannedLessonMinutes) {
      throw createError("INVALID_PROGRESS", "已上时长范围为 0 至总时长");
    }
    const updateData = {
      lessonAccountingMode: "minute",
      plannedLessonMinutes,
      completedLessonMinutes,
      recordedLessonCount: lessonMetrics.recordedLessonCount,
      recordedLessonMinutes: lessonMetrics.recordedLessonMinutes,
      bookingDurationMinutes,
    };
    await db.collection("students").doc(data.studentId).update({ data: updateData });
    return Object.assign({ success: true }, buildProgress(Object.assign({}, studentRes.data, updateData)));
  }
  const plannedLessonCount = toNonNegativeNumber(data.plannedLessonCount, "总课时");
  const completedLessonCount = toNonNegativeNumber(data.completedLessonCount, "已上课时");
  if (plannedLessonCount > 0 && completedLessonCount > plannedLessonCount) {
    throw createError("INVALID_PROGRESS", "已上课时范围为 0 至总课时");
  }
  const lessonPackageSize = Object.prototype.hasOwnProperty.call(data, "lessonPackageSize")
    ? toLessonPackageSize(data.lessonPackageSize)
    : courseWorkflow.getLessonPackageSize(studentRes.data);
  await db.collection("students").doc(data.studentId).update({
    data: {
      plannedLessonCount,
      completedLessonCount,
      lessonPackageSize,
      recordedLessonCount: lessonMetrics.recordedLessonCount,
      bookingDurationMinutes,
    },
  });
  return Object.assign({ success: true }, buildProgress({
    plannedLessonCount,
    completedLessonCount,
    lessonPackageSize,
    bookingDurationMinutes,
  }));
};

const seedStudents = async () => {
  const teacherIdentity = await ensureTeacher();
  await createOneCollection("systemLocks");
  const inserted = [];
  const skipped = [];
  for (let i = 0; i < SEED_STUDENTS.length; i++) {
    const student = Object.assign({}, SEED_STUDENTS[i], {
      accessCode: normalizeCode(SEED_STUDENTS[i].accessCode),
      recordedLessonCount: 0,
      teacherOpenId: teacherIdentity.openid,
    });
    const studentId = `seed_${crypto.createHash("sha1").update(student.accessCode).digest("hex")}`;
    const created = await runTransaction(async (transaction) => {
      const accessCodeLockRef = transaction
        .collection("systemLocks")
        .doc(getSystemLockId("student_access_code", student.accessCode));
      const [accessCodeLock, existing] = await Promise.all([
        getOptionalTransactionDocument(accessCodeLockRef),
        transaction.collection("students").where({ accessCode: student.accessCode }).limit(1).get(),
      ]);
      if (
        (accessCodeLock && accessCodeLock.studentId)
        || (existing.data && existing.data.length)
      ) {
        return false;
      }
      await transaction.collection("students").doc(studentId).set({
        data: Object.assign({}, student, { createdAt: db.serverDate() }),
      });
      await accessCodeLockRef.set({
        data: {
          recordType: "studentAccessCodeLock",
          studentId,
          updatedAt: db.serverDate(),
        },
      });
      return true;
    });
    if (!created) {
      skipped.push({
        name: student.name,
        accessCode: student.accessCode,
      });
      continue;
    }
    inserted.push({
      name: student.name,
      accessCode: student.accessCode,
    });
  }
  return {
    success: true,
    inserted,
    skipped,
    message: `已新增 ${inserted.length} 位学生；另有 ${skipped.length} 位已存在，未重复添加`,
  };
};

const getStudentDetail = async (event) => {
  const identity = await getIdentity();
  const data = event.data || {};
  if (data.mode === "teacherPreview" && identity.role !== "teacher") {
    throw createError("PERMISSION_DENIED", "请使用教师账号进入学生视角");
  }
  const requestedId = data.previewStudentId || data.studentId;
  const studentId = identity.role === "student" ? identity.student._id : requestedId;
  if (!studentId) throw createError("INVALID_STUDENT", "学生信息不完整，请返回后重试");
  await ensureStudentAccess(studentId);

  const studentRes = await db.collection("students").doc(studentId).get();
  if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
  const student = await attachSyncedLessonCount(studentRes.data);
  const isTeacherPreview = identity.role === "teacher" && data.mode === "teacherPreview";
  const isFullTeacherView = identity.role === "teacher" && !isTeacherPreview;
  const canReadCourses = isFullTeacherView
    ? true
    : isEnglishCourseEnabled(student);
  const canReadMistakeLearning = isFullTeacherView
    ? true
    : isMistakeLearningEnabled(student);
  const [lessons, analytics, vocabularyOverview] = await Promise.all([
    canReadCourses
      ? loadAllVocabularyDocuments("lessons", { studentId }, "lessonDate", "desc")
      : Promise.resolve([]),
    canReadMistakeLearning ? buildStudentAnalytics(studentId) : Promise.resolve(null),
    buildStudentVocabularyOverview(student),
  ]);
  const vocabularyLibrary = getVocabularyLibrary();
  const vocabularySettings = vocabulary.normalizeVocabularySettings(
    student.vocabularySettings,
    vocabularyLibrary,
    student
  );
  return {
    success: true,
    role: identity.role,
    student: sanitizeStudent(student, identity.role === "teacher"),
    vocabularyLevels: vocabularyLibrary.levels.filter((level) => !level.isReferenceOnly),
    vocabularyUnits: buildVocabularyUnits(
      vocabularyLibrary,
      vocabularyLibrary.levels.filter((level) => !level.isReferenceOnly).map((level) => level.id),
      vocabularySettings
    ),
    lessons: courseWorkflow.sortLessonsByNumber(lessons)
      .map((lesson) => courseWorkflow.withApplicableLessonDuration(lesson, student))
      .map(withTeacherConfirmedHomeworkState)
      .map((lesson) => withHomeworkDeadlineState(lesson)),
    cycleStatus: canReadMistakeLearning ? buildCycleStatus(student) : null,
    analytics,
    vocabularyOverview,
  };
};

const listStudentHomework = async (event) => {
  const identity = await getIdentity();
  const data = event.data || {};
  const isTeacherPreview = data.mode === "teacherPreview";
  if (isTeacherPreview && identity.role !== "teacher") {
    throw createError("PERMISSION_DENIED", "请使用教师账号进入学生视角");
  }
  if (identity.role === "guest") throw createError("PERMISSION_DENIED", "请先绑定学习账号");
  const requestedStudentId = String(data.previewStudentId || data.studentId || "").trim();
  const studentId = identity.role === "student" ? identity.student._id : requestedStudentId;
  if (!studentId) throw createError("INVALID_STUDENT", "学生信息不完整，请返回后重试");
  await ensureStudentAccess(studentId);
  const studentRes = await db.collection("students").doc(studentId).get();
  if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
  ensureEnglishCourseAccess(identity, studentRes.data, data);
  const lessons = (await loadAllVocabularyDocuments("lessons", { studentId }, "lessonDate", "desc"))
    .map((lesson) => courseWorkflow.withApplicableLessonDuration(lesson, studentRes.data))
    .map(withTeacherConfirmedHomeworkState)
    .map((lesson) => withHomeworkDeadlineState(lesson));
  const homeworkLessons = lessons.filter(hasLessonHomework);
  const pendingLessons = homeworkLessons.filter((lesson) => !isLessonHomeworkCompleted(lesson));
  const completedLessons = homeworkLessons.filter(isLessonHomeworkCompleted);
  const homeworkGrouping = courseWorkflow.buildHomeworkListGrouping({
    pendingLessons,
    completedLessons,
  });
  return {
    success: true,
    role: identity.role,
    readOnly: isTeacherPreview,
    student: sanitizeStudent(studentRes.data, false),
    pendingLessons: homeworkGrouping.pendingLessons,
    completedLessons: homeworkGrouping.completedLessons,
    summary: homeworkGrouping.summary,
  };
};

const listKetSpeakingTasks = async () => {
  await ensureTeacher();
  return { success: true, tasks: KET_SPEAKING_TASKS };
};

const getWeekRangeForLessonDay = (lessonDay) => {
  const matched = String(lessonDay || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return null;
  const base = new Date(Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3])));
  const weekday = base.getUTCDay() || 7;
  const start = new Date(base.getTime() - (weekday - 1) * VOCABULARY_DAY_MS);
  const end = new Date(start.getTime() + 6 * VOCABULARY_DAY_MS);
  const format = (date) => date.toISOString().slice(0, 10);
  return { start: format(start), end: format(end) };
};

const getKetWeeklyStatus = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  const studentId = String(data.studentId || "").trim();
  const lessonDate = String(data.lessonDate || "").trim();
  const excludeLessonId = String(data.lessonId || "").trim();
  const week = getWeekRangeForLessonDay(lessonDate);
  if (!studentId || !week) {
    throw createError("INVALID_LESSON", "请先选择学生和正确的课程日期");
  }
  await ensureStudentAccess(studentId);
  const lessons = await loadAllVocabularyDocuments("lessons", { studentId }, "lessonDate", "desc");
  const existing = lessons.find((lesson) => (
    lesson._id !== excludeLessonId
    && ["ket_official", "ket_mock"].includes(lesson.recordingTaskType)
    && String(lesson.lessonDate || "") >= week.start
    && String(lesson.lessonDate || "") <= week.end
  )) || null;
  return {
    success: true,
    alreadyAssigned: Boolean(existing),
    weekStart: week.start,
    weekEnd: week.end,
    existingLesson: existing ? {
      _id: existing._id,
      title: existing.title || "英语课",
      lessonDate: existing.lessonDate || "",
    } : null,
  };
};

const buildStudentAnalytics = async (studentId) => {
  const mistakes = await loadAllVocabularyDocuments("mistakes", { studentId }, "createdAt", "desc");
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const questionTypeStats = {};
  const skillStats = {};
  const sectionStats = {};
  const reasonStats = {};
  const reviewStatusStats = {};
  let pendingCount = 0;
  let reviewedCount = 0;
  let masteredCount = 0;
  let recent7Count = 0;
  let recent30Count = 0;
  let lastReviewedAt = "";
  let lastReviewedAtMs = 0;

  mistakes.forEach((mistake) => {
    const reviewStatus = getReviewStatus(mistake);
    const createdTime = getCreatedTime(mistake);
    const skillTags = normalizeTags(mistake.skillTags && mistake.skillTags.length ? mistake.skillTags : mistake.tags);
    incrementStat(questionTypeStats, mistake.questionType);
    incrementStat(sectionStats, mistake.paperSection);
    incrementStat(reasonStats, mistake.mistakeReasonType);
    incrementStat(reviewStatusStats, reviewStatus);
    if (skillTags.length) {
      skillTags.forEach((tag) => incrementStat(skillStats, tag));
    } else {
      incrementStat(skillStats, UNCATEGORIZED_LABEL);
    }
    if (reviewStatus === "已掌握") masteredCount += 1;
    else if (reviewStatus === "已复习") reviewedCount += 1;
    else pendingCount += 1;
    if (createdTime >= sevenDaysAgo) recent7Count += 1;
    if (createdTime >= thirtyDaysAgo) recent30Count += 1;
    const reviewedAtMs = getDateLikeTime(mistake.lastReviewedAt);
    if (reviewedAtMs > lastReviewedAtMs) {
      lastReviewedAtMs = reviewedAtMs;
      lastReviewedAt = mistake.lastReviewedAt;
    }
  });

  const topQuestionTypes = toRankList(questionTypeStats, 5);
  const topSkillTags = toRankList(skillStats, 5);
  const topReasons = toRankList(reasonStats, 5);
  const weakPointTexts = topQuestionTypes.slice(0, 3).map((item) => `${item.label} ${item.count} 题`);
  return {
    totalMistakeCount: mistakes.length,
    pendingCount,
    reviewedCount,
    masteredCount,
    recent7Count,
    recent30Count,
    lastReviewedAt,
    topQuestionTypes,
    topSkillTags,
    topReasons,
    sectionStats: toRankList(sectionStats, 6),
    reviewStatusStats: toRankList(reviewStatusStats, 4),
    weakPointSummary: weakPointTexts.length ? weakPointTexts.join("、") : "目前没有特别薄弱的题型",
    reviewSuggestions: mistakes
      .filter((mistake) => getReviewStatus(mistake) !== "已掌握")
      .sort((a, b) => {
        const statusOrder = { "待复习": 0, "已复习": 1 };
        const aStatus = getReviewStatus(a);
        const bStatus = getReviewStatus(b);
        const aStatusOrder = Object.prototype.hasOwnProperty.call(statusOrder, aStatus)
          ? statusOrder[aStatus]
          : 2;
        const bStatusOrder = Object.prototype.hasOwnProperty.call(statusOrder, bStatus)
          ? statusOrder[bStatus]
          : 2;
        const statusDiff = aStatusOrder - bStatusOrder;
        if (statusDiff) return statusDiff;
        const priorityOrder = { "高": 3, "中": 2, "低": 1 };
        const priorityDiff = (priorityOrder[b.reviewPriority] || 2) - (priorityOrder[a.reviewPriority] || 2);
        if (priorityDiff) return priorityDiff;
        const reviewTimeDiff = getDateLikeTime(a.lastReviewedAt) - getDateLikeTime(b.lastReviewedAt);
        if (reviewTimeDiff) return reviewTimeDiff;
        return getCreatedTime(b) - getCreatedTime(a);
      })
      .slice(0, 5)
      .map((mistake) => ({
        _id: mistake._id,
        title: mistake.questionNo || mistake.questionTitle || "英语错题记录",
        questionType: mistake.questionType || UNCATEGORIZED_LABEL,
        paperSection: mistake.paperSection || UNCATEGORIZED_LABEL,
        reviewPriority: mistake.reviewPriority || "中",
        reviewStatus: getReviewStatus(mistake),
      })),
  };
};

const getStudentAnalytics = async (event) => {
  const identity = await getIdentity();
  const data = event.data || {};
  const studentId = identity.role === "student" ? identity.student._id : data.studentId;
  if (!studentId) throw createError("INVALID_STUDENT", "学生信息不完整，请返回后重试");
  await ensureStudentAccess(studentId);
  const studentRes = await db.collection("students").doc(studentId).get();
  if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
  ensureMistakeLearningAccess(identity, studentRes.data, data);
  const student = await attachSyncedLessonCount(studentRes.data);
  return {
    success: true,
    role: identity.role,
    student: sanitizeStudent(student, identity.role === "teacher"),
    cycleStatus: buildCycleStatus(student),
    analytics: await buildStudentAnalytics(studentId),
  };
};

const getVocabularyLibrary = () => {
  const library = vocabulary.loadVocabularyLibrary();
  if (!library.levels || !library.levels.length || !library.words || !library.words.length) {
    throw createError("VOCABULARY_LIBRARY_UNAVAILABLE", "单词库尚未准备完成，请联系老师");
  }
  return library;
};

const buildStudentVocabularyCatalog = (studentData, options = {}) => {
  const library = getVocabularyLibrary();
  const configuredSettings = vocabulary.normalizeVocabularySettings(
    studentData.vocabularySettings,
    library,
    studentData
  );
  const dailyPlan = vocabulary.normalizeVocabularyDailyPlan(
    studentData.vocabularyDailyPlan,
    configuredSettings.dailyGoal
  );
  const settings = Object.assign({}, configuredSettings, { dailyGoal: dailyPlan.dailyGoal });
  const libraries = vocabulary.buildVocabularyCatalog({ library, settings }).map((item) => {
    if (options.includeCounts === true) return item;
    const safeItem = Object.assign({}, item);
    delete safeItem.wordCount;
    delete safeItem.enabledWordCount;
    delete safeItem.unitCount;
    delete safeItem.enabledUnitCount;
    return safeItem;
  });
  const enabled = studentData.vocabularyEnabled === true;
  return {
    student: sanitizeStudent(
      Object.assign({}, studentData, { vocabularyEnabled: enabled, vocabularySettings: settings }),
      options.includePrivate === true
    ),
    enabled,
    settings,
    dailyPlan,
    libraries,
    libraryCount: libraries.length,
    mistakeWordsEnabled: settings.includeMistakeWords === true,
  };
};

const getVocabularyCatalog = async (event) => {
  const identity = await getIdentity();
  if (identity.role === "guest") throw createError("PERMISSION_DENIED", "请先绑定学习账号");
  const data = event.data || {};
  if (data.scope === "teacher") {
    if (identity.role !== "teacher") throw createError("PERMISSION_DENIED", "请使用教师账号查看学生词库目录");
    const res = await db.collection("students").orderBy("createdAt", "desc").get();
    const students = (res.data || [])
      .filter((student) => !isStudentHiddenFromTeacher(student))
      .map((student) => buildStudentVocabularyCatalog(student, {
        includeCounts: true,
        includePrivate: true,
      }));
    return { success: true, role: "teacher", scope: "teacher", students };
  }

  const requestedStudentId = String(data.previewStudentId || data.studentId || "").trim();
  const studentId = identity.role === "student" && identity.student
    ? identity.student._id
    : requestedStudentId;
  if (!studentId) throw createError("INVALID_STUDENT", "学生信息不完整，请返回后重试");
  await ensureStudentAccess(studentId);
  const studentRes = await db.collection("students").doc(studentId).get();
  if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
  return Object.assign({
    success: true,
    role: identity.role,
    readOnly: identity.role !== "student",
  }, buildStudentVocabularyCatalog(studentRes.data));
};

const validateVocabularySettings = (data, library, student) => {
  if (typeof data.enabled !== "boolean") {
    throw createError("INVALID_VOCABULARY_SETTINGS", "请先选择是否开启英语背单词");
  }
  if (!Array.isArray(data.levelIds)) {
    throw createError("INVALID_VOCABULARY_SETTINGS", "请选择基础词库范围");
  }
  const validLevelIds = new Set(
    library.levels.filter((level) => !level.isReferenceOnly).map((level) => level.id)
  );
  const levelIds = Array.from(new Set(data.levelIds.map((levelId) => String(levelId || "").trim())));
  if (levelIds.some((levelId) => !validLevelIds.has(levelId))) {
    throw createError("INVALID_VOCABULARY_SETTINGS", "所选词库已更新，请刷新后重试");
  }
  if (data.disabledUnitIds !== undefined && !Array.isArray(data.disabledUnitIds)) {
    throw createError("INVALID_VOCABULARY_SETTINGS", "教材单元设置格式不正确，请刷新后重试");
  }
  const selectedLevels = new Set(levelIds);
  const validUnitIds = new Set(
    library.words
      .filter((word) => selectedLevels.has(word.levelId) && word.unitId)
      .map((word) => word.unitId)
  );
  const disabledUnitIds = Array.from(new Set(
    (data.disabledUnitIds || []).map((unitId) => String(unitId || "").trim()).filter(Boolean)
  ));
  if (disabledUnitIds.some((unitId) => !validUnitIds.has(unitId))) {
    throw createError("INVALID_VOCABULARY_SETTINGS", "教材单元已经变化，请刷新后重试");
  }
  const dailyGoal = Number(data.dailyGoal);
  if (
    !Number.isInteger(dailyGoal)
    || dailyGoal < vocabulary.MIN_DAILY_GOAL
    || dailyGoal > vocabulary.MAX_DAILY_GOAL
  ) {
    throw createError("INVALID_VOCABULARY_SETTINGS", "每日目标请设置为 5～30 个单词");
  }
  if (typeof data.includeMistakeWords !== "boolean") {
    throw createError("INVALID_VOCABULARY_SETTINGS", "请选择是否学习错题中的单词");
  }
  if (data.enabled && !levelIds.length && !data.includeMistakeWords) {
    throw createError("INVALID_VOCABULARY_SETTINGS", "请至少选择一种学习内容：错题单词或基础词库");
  }
  const settings = vocabulary.normalizeVocabularySettings({
    profileVersion: vocabulary.VOCABULARY_PROFILE_VERSION,
    levelIds,
    dailyGoal,
    includeMistakeWords: data.includeMistakeWords,
    learningOrder: data.learningOrder,
    disabledUnitIds,
  }, library, student);
  if (data.enabled && !settings.levelIds.length && !settings.includeMistakeWords) {
    throw createError("INVALID_VOCABULARY_SETTINGS", "请至少选择一种学习内容：错题单词或基础词库");
  }
  return {
    enabled: data.enabled,
    settings,
  };
};

const updateVocabularySettings = async (event) => {
  await ensureTeacher();
  await createOneCollection("vocabularyProgress");
  const data = event.data || {};
  const studentId = String(data.studentId || "").trim();
  if (!studentId) throw createError("INVALID_STUDENT", "学生信息不完整，请返回后重试");
  const studentRes = await db.collection("students").doc(studentId).get();
  if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
  const validated = validateVocabularySettings(data, getVocabularyLibrary(), studentRes.data);
  await db.collection("students").doc(studentId).update({
    data: {
      vocabularyEnabled: validated.enabled,
      vocabularySettings: validated.settings,
      vocabularyUpdatedAt: db.serverDate(),
    },
  });
  const student = Object.assign({}, studentRes.data, {
    vocabularyEnabled: validated.enabled,
    vocabularySettings: validated.settings,
  });
  return {
    success: true,
    enabled: validated.enabled,
    settings: validated.settings,
    student: sanitizeStudent(student, true),
  };
};

const setMistakeLearningSettings = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  const studentId = String(data.studentId || "").trim();
  if (!studentId) throw createError("INVALID_STUDENT", "学生信息不完整，请返回后重试");
  if (typeof data.enabled !== "boolean") {
    throw createError("INVALID_MISTAKE_SETTINGS", "请选择是否开启英语错题整理功能");
  }
  const studentRes = await db.collection("students").doc(studentId).get();
  if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
  await db.collection("students").doc(studentId).update({
    data: {
      mistakeLearningEnabled: data.enabled,
      mistakeLearningUpdatedAt: db.serverDate(),
    },
  });
  return {
    success: true,
    studentId,
    enabled: data.enabled,
  };
};

const setEnglishCourseSettings = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  const studentId = String(data.studentId || "").trim();
  if (!studentId) throw createError("INVALID_STUDENT", "学生信息不完整，请返回后重试");
  if (typeof data.enabled !== "boolean") {
    throw createError("INVALID_COURSE_SETTINGS", "请选择是否开启英语课程与作业功能");
  }
  const studentRes = await db.collection("students").doc(studentId).get();
  if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
  await db.collection("students").doc(studentId).update({
    data: {
      englishCourseEnabled: data.enabled,
      englishCourseUpdatedAt: db.serverDate(),
    },
  });
  return {
    success: true,
    studentId,
    enabled: data.enabled,
  };
};

const setStudentLessonTemplate = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  const studentId = String(data.studentId || "").trim();
  const lessonTemplateKey = String(data.lessonTemplateKey || "").trim();
  if (!studentId) throw createError("INVALID_STUDENT", "学生信息不完整，请返回后重试");
  if (!LESSON_TEMPLATE_KEYS.includes(lessonTemplateKey)) {
    throw createError("INVALID_LESSON_TEMPLATE", "请选择有效的英语课程模板");
  }
  const studentRes = await db.collection("students").doc(studentId).get();
  if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
  await db.collection("students").doc(studentId).update({
    data: {
      lessonTemplateKey,
      lessonTemplateUpdatedAt: db.serverDate(),
    },
  });
  return { success: true, studentId, lessonTemplateKey };
};

const getStudentLearningRadar = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  const studentId = String(data.studentId || "").trim();
  if (!studentId) throw createError("INVALID_STUDENT", "学生信息不完整，请返回后重试");
  const studentRes = await db.collection("students").doc(studentId).get();
  if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
  const student = Object.assign({}, studentRes.data, {
    lessonTemplateKey: getStudentLessonTemplateKey(studentRes.data),
  });
  const plan = learningRadar.getPlanForStudent(student);
  if (!plan) {
    return {
      success: true,
      radar: {
        available: false,
        reason: "当前课程模板尚未配置阶段学习计划",
      },
    };
  }
  await Promise.all([
    createOneCollection("vocabularyQuizSessions"),
    createOneCollection("lessonSubmissions"),
    createOneCollection("ketMockSessions"),
  ]);
  const [lessons, quizSessions, submissions, ketSessions, mistakes] = await Promise.all([
    loadAllStudentDocuments("lessons", studentId),
    loadAllStudentDocuments("vocabularyQuizSessions", studentId),
    loadAllStudentDocuments("lessonSubmissions", studentId),
    loadAllStudentDocuments("ketMockSessions", studentId),
    loadAllStudentDocuments("mistakes", studentId),
  ]);
  return {
    success: true,
    radar: learningRadar.buildLearningRadar({
      student,
      lessons,
      quizSessions,
      submissions,
      ketSessions,
      mistakes,
    }),
  };
};

const updateStudentLearningPlan = async (event) => {
  const teacherIdentity = await ensureTeacher();
  const data = event.data || {};
  const studentId = String(data.studentId || "").trim();
  if (!studentId) throw createError("INVALID_STUDENT", "学生信息不完整，请返回后重试");
  const studentRes = await db.collection("students").doc(studentId).get();
  if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
  const student = Object.assign({}, studentRes.data, {
    lessonTemplateKey: getStudentLessonTemplateKey(studentRes.data),
  });
  const plan = learningRadar.getPlanForStudent(student);
  if (!plan) throw createError("LEARNING_PLAN_UNAVAILABLE", "请先选择 Molly 或嘉文的课程记录模板");
  const current = learningRadar.normalizeLearningPlan(student, plan);
  const validStageIds = (plan.stages || []).map((stage) => stage.stageId);
  const requestedStageId = String(data.currentStageId || current.currentStageId).trim();
  if (!validStageIds.includes(requestedStageId)) {
    throw createError("INVALID_LEARNING_STAGE", "请选择有效的学习阶段");
  }
  const stageChanged = requestedStageId !== current.currentStageId;
  if (stageChanged && data.confirmStageChange !== true) {
    throw createError("STAGE_CONFIRMATION_REQUIRED", "切换阶段前需要老师再次确认");
  }
  const targetStage = plan.stages.find((stage) => stage.stageId === requestedStageId);
  const validTargetSkillIds = new Set((targetStage.skills || []).map((skill) => skill.skillId));
  const requestedPins = Array.isArray(data.teacherPinnedSkillIds)
    ? data.teacherPinnedSkillIds
    : current.teacherPinnedSkillIds;
  const teacherPinnedSkillIds = Array.from(new Set(requestedPins
    .map((skillId) => String(skillId || "").trim())
    .filter((skillId) => validTargetSkillIds.has(skillId))))
    .slice(0, 12);
  const changedAtMs = Date.now();
  const stageHistory = current.stageHistory.slice();
  if (stageChanged) {
    stageHistory.push({
      fromStageId: current.currentStageId,
      toStageId: requestedStageId,
      changedAtMs,
    });
  }
  const nextLearningPlan = {
    planKey: plan.planKey,
    planVersion: learningRadar.LEARNING_PLAN_CONFIG.version,
    currentStageId: requestedStageId,
    stageStartedAtMs: stageChanged
      ? changedAtMs
      : current.stageStartedAtMs || changedAtMs,
    teacherPinnedSkillIds,
    stageHistory: stageHistory.slice(-20),
  };
  await db.collection("students").doc(studentId).update({
    data: {
      learningPlan: nextLearningPlan,
      learningPlanUpdatedAt: db.serverDate(),
      learningPlanUpdatedBy: teacherIdentity.openid || "",
    },
  });
  return {
    success: true,
    studentId,
    stageChanged,
    learningPlan: nextLearningPlan,
    currentStage: {
      stageId: targetStage.stageId,
      stageLabel: targetStage.stageLabel,
      stageTitle: targetStage.stageTitle,
      goal: targetStage.goal,
    },
  };
};

const setVocabularyDailyGoal = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  const studentId = String(data.studentId || "").trim();
  if (!studentId) throw createError("INVALID_STUDENT", "学生信息不完整，请返回后重试");
  const dailyGoal = Number(data.dailyGoal);
  if (
    !Number.isInteger(dailyGoal)
    || dailyGoal < vocabulary.MIN_DAILY_GOAL
    || dailyGoal > vocabulary.MAX_DAILY_GOAL
  ) {
    throw createError("INVALID_VOCABULARY_SETTINGS", "今日目标请设置为 5～30 个单词");
  }
  const studentRes = await db.collection("students").doc(studentId).get();
  if (!studentRes.data || studentRes.data.vocabularyEnabled !== true) {
    throw createError("VOCABULARY_DISABLED", "背单词功能尚未开启");
  }
  const nowMs = Date.now();
  const dailyPlan = {
    learningDay: vocabulary.getLearningDay(nowMs),
    dailyGoal,
    selectedAtMs: nowMs,
    selectedByRole: "teacher",
  };
  await createOneCollection("vocabularyDailyStats");
  const dailyStatsId = getVocabularyDailyStatsId(studentId, dailyPlan.learningDay);
  await runTransaction(async (transaction) => {
    const studentRef = transaction.collection("students").doc(studentId);
    const dailyStatsRef = transaction.collection("vocabularyDailyStats").doc(dailyStatsId);
    const [currentStudentRes, currentDailyStats] = await Promise.all([
      studentRef.get(),
      getOptionalTransactionDocument(dailyStatsRef),
    ]);
    if (!currentStudentRes.data || currentStudentRes.data.vocabularyEnabled !== true) {
      throw createError("VOCABULARY_DISABLED", "背单词功能尚未开启");
    }
    const reviewedCount = currentDailyStats
      ? Math.max(
        0,
        Number(currentDailyStats.reviewedWordCount)
          || (Array.isArray(currentDailyStats.reviewedWordKeys)
            ? currentDailyStats.reviewedWordKeys.length
            : 0)
      )
      : 0;
    if (dailyGoal < reviewedCount) {
      throw createError(
        "INVALID_VOCABULARY_SETTINGS",
        `今天已完成 ${reviewedCount} 个，目标下限为当前完成数`
      );
    }
    await studentRef.update({
      data: {
        vocabularyDailyPlan: dailyPlan,
        vocabularyDailyPlanUpdatedAt: db.serverDate(),
      },
    });
    if (currentDailyStats) {
      await dailyStatsRef.update({
        data: {
          dailyGoal,
          updatedAt: db.serverDate(),
        },
      });
    } else {
      await dailyStatsRef.set({
        data: {
          studentId,
          learningDay: dailyPlan.learningDay,
          dailyGoal,
          reviewedWordKeys: [],
          reviewedWordCount: 0,
          reviewActionCount: 0,
          resultCounts: { forgot: 0, hard: 0, known: 0, easy: 0 },
          createdAt: db.serverDate(),
          updatedAt: db.serverDate(),
        },
      });
    }
  });
  const settings = vocabulary.normalizeVocabularySettings(
    studentRes.data.vocabularySettings,
    getVocabularyLibrary(),
    studentRes.data
  );
  return {
    success: true,
    dailyPlan: vocabulary.normalizeVocabularyDailyPlan(dailyPlan, settings.dailyGoal, nowMs),
  };
};

const loadAllVocabularyDocuments = async (collectionName, condition, orderByField, orderDirection) => {
  const documents = [];
  const pageSize = 100;
  for (let skip = 0; ; skip += pageSize) {
    let query = db.collection(collectionName).where(condition);
    if (orderByField) query = query.orderBy(orderByField, orderDirection || "asc");
    query = query.skip(skip).limit(pageSize);
    const res = await query.get();
    const items = res.data || [];
    documents.push(...items);
    if (items.length < pageSize) break;
  }
  return documents;
};

const getEnglishMemoryEvaluation = async (event) => {
  await ensureTeacher();
  await createOneCollection("vocabularyProgress");
  const data = event.data || {};
  const studentId = String(data.studentId || "").trim();
  if (!studentId) throw createError("INVALID_STUDENT", "学生信息不完整，请返回后重试");
  const studentRes = await db.collection("students").doc(studentId).get();
  if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
  const progressItems = await loadAllVocabularyDocuments("vocabularyProgress", { studentId });
  return {
    success: true,
    student: {
      _id: studentId,
      name: String(studentRes.data.name || "学生").slice(0, 40),
      grade: String(studentRes.data.grade || "").slice(0, 40),
      vocabularyEnabled: studentRes.data.vocabularyEnabled === true,
    },
    evaluation: englishMemoryAnalytics.buildMemoryEvaluation(
      progressItems,
      Date.now(),
      studentRes.data.englishMemoryCalibration
    ),
  };
};

// 老师确认后才写入学生的记忆速度系数；建议值由服务端重新计算，不信任前端传来的数值。
const saveEnglishMemoryCalibration = async (studentId, student, record) => {
  const current = student.englishMemoryCalibration || {};
  const history = (Array.isArray(current.history) ? current.history : [])
    .concat(record)
    .slice(-englishMemoryAnalytics.CALIBRATION_HISTORY_LIMIT);
  await db.collection("students").doc(studentId).update({
    data: {
      englishMemoryCalibration: db.command.set({
        factor: record.factor,
        previousFactor: record.previousFactor,
        appliedAtMs: record.appliedAtMs,
        sampleSize: record.sampleSize,
        history,
      }),
    },
  });
};

const updateEnglishMemoryCalibration = async (event) => {
  await ensureTeacher();
  await createOneCollection("vocabularyProgress");
  const data = event.data || {};
  const studentId = String(data.studentId || "").trim();
  const action = String(data.action || "").trim();
  if (!studentId) throw createError("INVALID_STUDENT", "学生信息不完整，请返回后重试");
  if (["apply", "reset"].indexOf(action) < 0) throw createError("INVALID_CALIBRATION", "校准操作无效，请刷新后重试");
  const studentRes = await db.collection("students").doc(studentId).get();
  const student = studentRes.data;
  if (!student) throw createError("INVALID_STUDENT", "学生不存在或已删除");
  const currentFactor = englishMemoryScheduler.getStudentMemoryFactor(student);
  const nowMs = Date.now();
  if (action === "reset") {
    if (currentFactor === englishMemoryScheduler.DEFAULT_MEMORY_FACTOR) {
      throw createError("CALIBRATION_ALREADY_DEFAULT", "当前已经是默认设置");
    }
    await saveEnglishMemoryCalibration(studentId, student, {
      action: "reset",
      factor: englishMemoryScheduler.DEFAULT_MEMORY_FACTOR,
      previousFactor: currentFactor,
      appliedAtMs: nowMs,
      sampleSize: 0,
    });
    return { success: true, factor: englishMemoryScheduler.DEFAULT_MEMORY_FACTOR };
  }
  const progressItems = await loadAllVocabularyDocuments("vocabularyProgress", { studentId });
  const evaluation = englishMemoryAnalytics.buildMemoryEvaluation(progressItems, nowMs, student.englishMemoryCalibration);
  const suggestion = evaluation.calibration;
  if (!suggestion.canApply) {
    throw createError("CALIBRATION_NOT_READY", "当前数据不需要调整，请继续积累复习反馈");
  }
  if (Math.abs(Number(data.expectedFactor) - suggestion.suggestedFactor) > 0.001) {
    throw createError("CALIBRATION_CHANGED", "复习数据刚刚更新，请刷新后再确认");
  }
  await saveEnglishMemoryCalibration(studentId, student, {
    action: "apply",
    factor: suggestion.suggestedFactor,
    previousFactor: currentFactor,
    appliedAtMs: nowMs,
    sampleSize: evaluation.sampleSize,
  });
  return { success: true, factor: suggestion.suggestedFactor };
};

const getEmptyVocabularySummary = (dailyGoal) => ({
  totalCount: 0,
  totalWords: 0,
  libraryWordCount: 0,
  textbookWordCount: 0,
  mistakeWordCount: 0,
  weakCount: 0,
  masteredCount: 0,
  learningCount: 0,
  dueCount: 0,
  pendingCount: 0,
  easyCount: 0,
  dailyGoal,
  todayCount: 0,
  todayReviewedCount: 0,
  todayRemainingCount: 0,
  memoryAlgorithmVersion: "english-adaptive-v1",
  memoryReviewedCount: 0,
  memoryRetentionPercent: null,
  memoryAtRiskCount: 0,
  memoryDueNowCount: 0,
  memoryDueTomorrowCount: 0,
  memoryDueInThreeDaysCount: 0,
  memoryDueInSevenDaysCount: 0,
  memoryNextReviewAtMs: 0,
  memoryDisclaimer: "开始复习后，系统会根据真实反馈逐步安排间隔。",
});

const getVocabularyDailyStatsId = (studentId, learningDay) => (
  crypto.createHash("sha1").update(`${studentId}\n${learningDay}`).digest("hex")
);

const formatVocabularyLearningDay = (learningDay) => {
  const date = new Date(Number(learningDay) * VOCABULARY_DAY_MS);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
};

const buildVocabularyWeeklyStats = (items, nowMs = Date.now()) => {
  const today = vocabulary.getLearningDay(nowMs);
  const byDay = new Map((items || []).map((item) => [Number(item.learningDay), item]));
  const days = [];
  let totalReviewed = 0;
  let activeDays = 0;
  let totalReviewActions = 0;
  let fluentActions = 0;
  for (let learningDay = today - 6; learningDay <= today; learningDay += 1) {
    const source = byDay.get(learningDay) || {};
    const reviewedWordCount = Math.max(
      0,
      Number(source.reviewedWordCount)
        || (Array.isArray(source.reviewedWordKeys) ? source.reviewedWordKeys.length : 0)
    );
    const dailyGoal = Math.max(0, Number(source.dailyGoal) || 0);
    const resultCounts = Object.assign(
      { forgot: 0, hard: 0, known: 0, easy: 0 },
      source.resultCounts || {}
    );
    const resultActionCount = Object.keys(resultCounts)
      .reduce((sum, key) => sum + Math.max(0, Number(resultCounts[key]) || 0), 0);
    const reviewActionCount = Math.max(0, Number(source.reviewActionCount) || 0, resultActionCount);
    const dailyFluentActions = Math.max(0, Number(resultCounts.known) || 0)
      + Math.max(0, Number(resultCounts.easy) || 0);
    totalReviewed += reviewedWordCount;
    totalReviewActions += reviewActionCount;
    fluentActions += dailyFluentActions;
    if (reviewedWordCount > 0) activeDays += 1;
    days.push({
      learningDay,
      label: formatVocabularyLearningDay(learningDay),
      reviewedWordCount,
      dailyGoal,
      reviewActionCount,
      fluentActions: dailyFluentActions,
      completed: dailyGoal > 0 && reviewedWordCount >= dailyGoal,
    });
  }
  const todaySource = byDay.get(today);
  const todayReviewedCount = todaySource
    ? Math.max(0, Number(todaySource.reviewedWordCount) || (todaySource.reviewedWordKeys || []).length)
    : 0;
  let streakDays = 0;
  const streakStartDay = todayReviewedCount > 0 ? today : today - 1;
  for (let learningDay = streakStartDay; learningDay >= today - 365; learningDay -= 1) {
    const source = byDay.get(learningDay);
    const count = source
      ? Math.max(0, Number(source.reviewedWordCount) || (source.reviewedWordKeys || []).length)
      : 0;
    if (!count) break;
    streakDays += 1;
  }
  return {
    days,
    totalReviewed,
    activeDays,
    streakDays,
    totalReviewActions,
    fluentActions,
    fluentRate: totalReviewActions > 0 ? Math.round(fluentActions / totalReviewActions * 100) : 0,
    streakPendingToday: todayReviewedCount === 0 && streakDays > 0,
  };
};

const buildStudentVocabularyOverview = async (student) => {
  const library = getVocabularyLibrary();
  const configuredSettings = vocabulary.normalizeVocabularySettings(
    student.vocabularySettings,
    library,
    student
  );
  const dailyPlan = vocabulary.normalizeVocabularyDailyPlan(
    student.vocabularyDailyPlan,
    configuredSettings.dailyGoal
  );
  const settings = Object.assign({}, configuredSettings, { dailyGoal: dailyPlan.dailyGoal });
  const enabled = student.vocabularyEnabled === true;
  await createOneCollection("vocabularyDailyStats");
  const dailyStats = await loadAllVocabularyDocuments("vocabularyDailyStats", { studentId: student._id });
  if (!enabled) {
    return {
      enabled,
      dailyPlan,
      summary: getEmptyVocabularySummary(dailyPlan.dailyGoal),
      weeklyStats: buildVocabularyWeeklyStats(dailyStats),
    };
  }
  const [mistakes, progressItems] = await Promise.all([
    settings.includeMistakeWords
      ? loadAllVocabularyDocuments("mistakes", { studentId: student._id }, "createdAt", "desc")
      : Promise.resolve([]),
    loadAllVocabularyDocuments("vocabularyProgress", { studentId: student._id }),
  ]);
  const view = vocabulary.buildVocabularyView({
    library,
    settings,
    mistakes,
    progressItems,
    isTeacher: false,
    student,
  });
  return {
    enabled,
    dailyPlan,
    summary: view.summary,
    weeklyStats: buildVocabularyWeeklyStats(dailyStats),
  };
};

const buildVocabularyUnits = (library, selectedLevelIds, settings = {}) => {
  const selectedLevels = new Set(selectedLevelIds || []);
  const disabledUnitIds = new Set(settings.disabledUnitIds || []);
  const unitById = new Map();
  library.words.forEach((word) => {
    if (!selectedLevels.has(word.levelId) || !word.unitId || !word.key) return;
    if (!unitById.has(word.unitId)) {
      unitById.set(word.unitId, {
        id: word.unitId,
        label: word.unitLabel || word.unitId,
        levelId: word.levelId,
        order: Number(word.order || 0),
        wordKeys: new Set(),
      });
    }
    const unit = unitById.get(word.unitId);
    unit.order = Math.min(unit.order, Number(word.order || unit.order || 0));
    unit.wordKeys.add(word.key);
  });
  return Array.from(unitById.values())
    .sort((a, b) => {
      if (a.levelId !== b.levelId) return a.levelId.localeCompare(b.levelId);
      return a.order - b.order;
    })
    .map((unit) => ({
      id: unit.id,
      label: unit.label,
      levelId: unit.levelId,
      order: unit.order,
      wordCount: unit.wordKeys.size,
      enabled: !disabledUnitIds.has(unit.id),
    }));
};

const buildVocabularyBrowsePage = (view, data) => {
  const browseTab = ["today", "all", "textbook", "mistake", "weak", "mastered"].indexOf(data.browseTab) >= 0
    ? data.browseTab
    : "today";
  const keyword = String(data.searchKeyword || "").trim().toLowerCase().slice(0, 40);
  let words = keyword || browseTab === "all" ? view.words : view.todayWords;
  if (!keyword && browseTab === "textbook") {
    words = view.words.filter((word) => word.sources.indexOf("textbook") >= 0);
  }
  if (!keyword && browseTab === "mistake") {
    words = view.words.filter((word) => word.sources.indexOf("mistake") >= 0);
  }
  if (!keyword && browseTab === "weak") {
    words = view.words.filter((word) => vocabulary.isVocabularyWeakWord(word));
  }
  if (!keyword && browseTab === "mastered") {
    words = view.words.filter((word) => word.masteryLevel >= 5 || word.isEasy);
  }
  const masteryFilter = ["all", "unlearned", "learning", "due", "mastered", "easy"].indexOf(data.masteryFilter) >= 0
    ? data.masteryFilter
    : "all";
  if (masteryFilter === "unlearned") {
    words = words.filter((word) => word.masteryLevel <= 0 && !word.isEasy && word.reviewCount <= 0);
  }
  if (masteryFilter === "learning") {
    words = words.filter((word) => (
      word.reviewCount > 0 && !word.isDue && word.masteryLevel < 5 && !word.isEasy
    ));
  }
  if (masteryFilter === "due") {
    words = words.filter((word) => word.reviewCount > 0 && word.isDue && word.masteryLevel < 5 && !word.isEasy);
  }
  if (masteryFilter === "mastered") {
    words = words.filter((word) => word.masteryLevel >= 5 && !word.isEasy);
  }
  if (masteryFilter === "easy") {
    words = words.filter((word) => word.isEasy);
  }
  const levelId = String(data.levelId || "").trim();
  const unitId = String(data.unitId || "").trim();
  words = words.filter((word) => {
    if (keyword && `${word.word} ${word.meaning} ${word.partOfSpeech}`.toLowerCase().indexOf(keyword) < 0) {
      return false;
    }
    if (levelId && levelId !== "all" && word.levelIds.indexOf(levelId) < 0) return false;
    if (unitId && unitId !== "all" && word.unitIds.indexOf(unitId) < 0) return false;
    return true;
  });
  const offset = Math.max(0, Math.trunc(Number(data.offset || 0)));
  const requestedLimit = Math.trunc(Number(data.limit || 40));
  const limit = Math.max(10, Math.min(60, requestedLimit || 40));
  return {
    browseTab,
    masteryFilter,
    browseTotal: words.length,
    browseOffset: offset,
    browseLimit: limit,
    browseHasMore: offset + limit < words.length,
    words: words.slice(offset, offset + limit),
  };
};

const attachVocabularyAudioUrls = async (response) => {
  const result = response || {};
  const listNames = ["todayWords", "todayReviewedWords", "words"];
  const audioFileFields = ["pronunciationFileId", "pronunciationDirectFileId"];
  const fileIds = Array.from(new Set(
    listNames.flatMap((name) => (
      Array.isArray(result[name])
        ? result[name].flatMap((word) => (
          audioFileFields.map((field) => String(word[field] || "")).filter(Boolean)
        ))
        : []
    ))
  ));
  if (!fileIds.length) return result;

  try {
    const urlByFileId = new Map();
    const batchSize = 50;
    for (let offset = 0; offset < fileIds.length; offset += batchSize) {
      const batch = fileIds.slice(offset, offset + batchSize);
      try {
        const res = await cloud.getTempFileURL({ fileList: batch });
        (res.fileList || [])
          .filter((item) => item && item.status === 0 && item.fileID && item.tempFileURL)
          .forEach((item) => urlByFileId.set(String(item.fileID), String(item.tempFileURL)));
      } catch (err) {
        console.error("get vocabulary audio temp url batch failed", err);
      }
    }
    listNames.forEach((name) => {
      if (!Array.isArray(result[name])) return;
      result[name] = result[name].map((word) => Object.assign({}, word, {
        pronunciationUrl: urlByFileId.get(String(word.pronunciationFileId || "")) || "",
        pronunciationDirectUrl: urlByFileId.get(String(word.pronunciationDirectFileId || "")) || "",
      }));
    });
  } catch (err) {
    console.error("get vocabulary audio temp urls failed", err);
  }
  return result;
};

const getVocabularyData = async (event) => {
  await Promise.all([
    createOneCollection("vocabularyProgress"),
    createOneCollection("vocabularyDailyStats"),
  ]);
  const identity = await getIdentity();
  if (identity.role === "guest") throw createError("PERMISSION_DENIED", "请先绑定学习账号");
  const data = event.data || {};
  const requestedStudentId = String(data.previewStudentId || data.studentId || "").trim();
  const studentId = identity.role === "student" ? identity.student._id : requestedStudentId;
  if (!studentId) throw createError("INVALID_STUDENT", "学生信息不完整，请返回后重试");
  await ensureStudentAccess(studentId);

  const studentRes = await db.collection("students").doc(studentId).get();
  if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
  const library = getVocabularyLibrary();
  const configuredSettings = vocabulary.normalizeVocabularySettings(
    studentRes.data.vocabularySettings,
    library,
    studentRes.data
  );
  const dailyPlan = vocabulary.normalizeVocabularyDailyPlan(
    studentRes.data.vocabularyDailyPlan,
    configuredSettings.dailyGoal
  );
  const settings = Object.assign({}, configuredSettings, {
    dailyGoal: dailyPlan.dailyGoal,
  });
  const enabled = studentRes.data.vocabularyEnabled === true;
  const student = sanitizeStudent(
    Object.assign({}, studentRes.data, { vocabularyEnabled: enabled, vocabularySettings: settings }),
    identity.role === "teacher"
  );
  const baseResponse = {
    success: true,
    role: identity.role,
    readOnly: identity.role !== "student",
    student,
    enabled,
    settings,
    dailyPlan,
    configuredDailyGoal: configuredSettings.dailyGoal,
    levels: library.levels.filter((level) => !level.isReferenceOnly),
    units: buildVocabularyUnits(library, settings.levelIds, settings).filter((unit) => unit.enabled),
  };
  const dailyStats = await loadAllVocabularyDocuments("vocabularyDailyStats", { studentId });
  const weeklyStats = buildVocabularyWeeklyStats(dailyStats);
  if (!enabled && identity.role === "student") {
    return Object.assign({}, baseResponse, {
      summary: getEmptyVocabularySummary(settings.dailyGoal),
      weeklyStats,
      todayWords: [],
      todayReviewedWords: [],
      words: [],
      pendingWords: [],
      browseTab: "today",
      browseTotal: 0,
      browseOffset: 0,
      browseLimit: 40,
      browseHasMore: false,
    });
  }

  const [mistakes, progressItems] = await Promise.all([
    settings.includeMistakeWords
      ? loadAllVocabularyDocuments("mistakes", { studentId }, "createdAt", "desc")
      : Promise.resolve([]),
    loadAllVocabularyDocuments("vocabularyProgress", { studentId }),
  ]);
  const view = vocabulary.buildVocabularyView({
    library,
    settings,
    mistakes,
    progressItems,
    isTeacher: identity.role === "teacher",
    student: studentRes.data,
  });
  const browsePage = buildVocabularyBrowsePage(view, data);
  const quizPlan = data.quizMode === true
    ? vocabularyQuiz.buildPersonalizedQuizPlan({
      words: view.words,
      todayWords: view.todayWords.concat(view.todayReviewedWords || []),
      dailyGoal: dailyPlan.dailyGoal,
      studentId,
      learningDay: dailyPlan.learningDay,
      scope: data.quizScope === "weak" ? "weak" : "smart",
    })
    : null;
  return attachVocabularyAudioUrls(Object.assign({}, baseResponse, view, browsePage, {
    weeklyStats,
    pendingWords: view.pendingWords.slice(0, 100),
    quizPlan,
  }));
};

const assertVocabularyWordKey = (value) => {
  const wordKey = vocabulary.normalizeWordKey(value);
  if (!wordKey || !/^[a-z0-9]+(?:['-][a-z0-9]+)*(?: [a-z0-9]+(?:['-][a-z0-9]+)*)*$/.test(wordKey)) {
    throw createError("INVALID_VOCABULARY_WORD", "单词信息无效，请刷新后重试");
  }
  return wordKey;
};

const assertVocabularyWordBelongsToStudent = async ({
  studentId,
  student,
  wordKey,
  library,
  settings,
  progressId,
}) => {
  const progressRes = await db.collection("vocabularyProgress")
    .where({ _id: progressId })
    .limit(1)
    .get();
  const progressItem = progressRes.data && progressRes.data.length ? progressRes.data[0] : null;
  if (progressItem && progressItem.excluded === true) {
    throw createError("INVALID_VOCABULARY_WORD", "这个词已不在学习范围内，请刷新列表");
  }

  const selectedLevels = new Set(settings.levelIds || []);
  const selectedLibraryWords = library.words.filter((item) => (
    item.key === wordKey && selectedLevels.has(item.levelId)
  ));
  let hasEnabledSource = selectedLibraryWords.length > 0;
  let confirmedMeaning = selectedLibraryWords.reduce(
    (meaning, item) => meaning || String(item.meaning || "").trim(),
    ""
  );

  if (settings.includeMistakeWords && (!hasEnabledSource || !confirmedMeaning)) {
    const mistakes = await loadAllVocabularyDocuments("mistakes", { studentId }, "createdAt", "desc");
    const libraryWord = library.words.find((item) => item.key === wordKey);
    for (let index = 0; index < mistakes.length; index += 1) {
      const mistake = mistakes[index];
      if (vocabulary.getStoredVocabularyCandidates(mistake, library).indexOf(wordKey) < 0) continue;
      hasEnabledSource = true;
      const explicitWord = vocabulary.normalizeVocabularyWords(mistake.vocabularyWords)
        .find((item) => item.key === wordKey);
      confirmedMeaning = confirmedMeaning
        || String(explicitWord && explicitWord.meaning || "").trim()
        || String(libraryWord && libraryWord.meaning || "").trim();
      if (confirmedMeaning) break;
    }
  }

  confirmedMeaning = String(progressItem && progressItem.customMeaning || "").trim() || confirmedMeaning;
  if (!hasEnabledSource || !confirmedMeaning) {
    throw createError("INVALID_VOCABULARY_WORD", "这个词已不在学习范围内，请刷新列表");
  }
};

const runVocabularyReviewTransaction = async (transactionCallback, context) => {
  try {
    return await runTransactionWithRetry(
      () => db.runTransaction(transactionCallback),
      {
        retryDelaysMs: [200, 500, 1000],
        onRetry: ({ attempt, maxAttempts, waitMs, error }) => {
          console.warn("vocabulary review transaction busy; retrying", {
            context,
            attempt,
            maxAttempts,
            waitMs,
            message: (error && (error.errMsg || error.message)) || "",
          });
        },
      }
    );
  } catch (err) {
    if (!isTransactionBusyError(err)) throw err;
    throw createError(
      "TRANSACTION_BUSY",
      "云数据库暂时繁忙，已自动重试，请再点一次"
    );
  }
};

const reviewVocabularyWord = async (event) => {
  await Promise.all([
    createOneCollection("vocabularyProgress"),
    createOneCollection("vocabularyDailyStats"),
  ]);
  const identity = await getIdentity();
  if (identity.role !== "student" || !identity.student) {
    throw createError("PERMISSION_DENIED", "当前为老师预览，学习进度保持原记录");
  }
  const data = event.data || {};
  const studentId = String(data.studentId || "").trim();
  if (!studentId || studentId !== identity.student._id) {
    throw createError("PERMISSION_DENIED", "请使用当前学生账号记录单词进度");
  }
  if (["forgot", "hard", "known", "easy"].indexOf(data.result) < 0) {
    throw createError("INVALID_VOCABULARY_REVIEW", "请选择没记住、有点难、记住了或太简单");
  }
  const studentRes = await db.collection("students").doc(studentId).get();
  if (!studentRes.data || studentRes.data.vocabularyEnabled !== true) {
    throw createError("VOCABULARY_DISABLED", "背单词功能尚未开启");
  }
  const wordKey = assertVocabularyWordKey(data.wordKey);
  const progressId = vocabulary.getProgressDocumentId(studentId, wordKey);
  const nowMs = Date.now();
  const library = getVocabularyLibrary();
  const settings = vocabulary.normalizeVocabularySettings(
    studentRes.data.vocabularySettings,
    library,
    studentRes.data
  );
  await assertVocabularyWordBelongsToStudent({
    studentId,
    student: studentRes.data,
    wordKey,
    library,
    settings,
    progressId,
  });
  const dailyPlan = vocabulary.normalizeVocabularyDailyPlan(
    studentRes.data.vocabularyDailyPlan,
    settings.dailyGoal,
    nowMs
  );
  const dailyStatsId = getVocabularyDailyStatsId(studentId, dailyPlan.learningDay);
  const progress = await runVocabularyReviewTransaction(async (transaction) => {
    const ref = transaction.collection("vocabularyProgress").doc(progressId);
    const dailyStatsRef = transaction.collection("vocabularyDailyStats").doc(dailyStatsId);
    const [existingRes, dailyStatsRes, currentStudentRes] = await Promise.all([
      transaction.collection("vocabularyProgress").where({ _id: progressId }).limit(1).get(),
      transaction.collection("vocabularyDailyStats").where({ _id: dailyStatsId }).limit(1).get(),
      transaction.collection("students").doc(studentId).get(),
    ]);
    const currentStudent = currentStudentRes && currentStudentRes.data;
    if (!currentStudent || currentStudent.vocabularyEnabled !== true) {
      throw createError("VOCABULARY_DISABLED", "背单词功能尚未开启");
    }
    const currentSettings = vocabulary.normalizeVocabularySettings(
      currentStudent.vocabularySettings,
      library,
      currentStudent
    );
    const currentDailyPlan = vocabulary.normalizeVocabularyDailyPlan(
      currentStudent.vocabularyDailyPlan,
      currentSettings.dailyGoal,
      nowMs
    );
    if (currentDailyPlan.learningDay !== dailyPlan.learningDay) {
      throw createError("VOCABULARY_DAY_CHANGED", "新的一天开始了，请刷新后继续");
    }
    const existing = existingRes.data && existingRes.data.length ? existingRes.data[0] : null;
    const existingDailyStats = dailyStatsRes.data && dailyStatsRes.data.length ? dailyStatsRes.data[0] : null;
    const reviewProgress = vocabulary.buildReviewProgress(
      existing,
      data.result,
      nowMs,
      englishMemoryScheduler.getStudentMemoryFactor(currentStudent)
    );
    const updateData = Object.assign({}, reviewProgress, {
      studentId,
      wordKey,
      lastReviewedAt: db.serverDate(),
      updatedAt: db.serverDate(),
    });
    if (existing) {
      await ref.update({ data: updateData });
    } else {
      await ref.set({
        data: Object.assign({}, updateData, {
          customMeaning: "",
          customPartOfSpeech: "",
          excluded: false,
          createdAt: db.serverDate(),
        }),
      });
    }
    const reviewedWordKeys = Array.isArray(existingDailyStats && existingDailyStats.reviewedWordKeys)
      ? existingDailyStats.reviewedWordKeys.slice()
      : [];
    if (reviewedWordKeys.indexOf(wordKey) < 0) reviewedWordKeys.push(wordKey);
    const resultCounts = Object.assign(
      { forgot: 0, hard: 0, known: 0, easy: 0 },
      (existingDailyStats && existingDailyStats.resultCounts) || {}
    );
    resultCounts[data.result] = Number(resultCounts[data.result] || 0) + 1;
    const dailyStatsData = {
      studentId,
      learningDay: dailyPlan.learningDay,
      dailyGoal: currentDailyPlan.dailyGoal,
      reviewedWordKeys,
      reviewedWordCount: reviewedWordKeys.length,
      reviewActionCount: Number(existingDailyStats && existingDailyStats.reviewActionCount || 0) + 1,
      resultCounts,
      updatedAt: db.serverDate(),
    };
    if (existingDailyStats) {
      await dailyStatsRef.update({ data: dailyStatsData });
    } else {
      await dailyStatsRef.set({ data: Object.assign({}, dailyStatsData, { createdAt: db.serverDate() }) });
    }
    return reviewProgress;
  }, `word:${studentId}:${wordKey}`);
  return Object.assign({ success: true, studentId, wordKey }, progress);
};

const reviewVocabularyQuizAnswer = async (event) => {
  await createOneCollection("vocabularyProgress");
  const identity = await getIdentity();
  if (identity.role !== "student" || !identity.student) {
    throw createError("PERMISSION_DENIED", "当前为老师预览，小测记录保持原状态");
  }
  const data = event.data || {};
  const studentId = String(data.studentId || "").trim();
  if (!studentId || studentId !== identity.student._id) {
    throw createError("PERMISSION_DENIED", "请使用当前学生账号记录小测结果");
  }
  const questionType = String(data.questionType || "").trim();
  if (["wordToMeaning", "meaningToWord", "letterGap", "spelling"].indexOf(questionType) < 0) {
    throw createError("INVALID_VOCABULARY_QUIZ", "小测题型无效，请重新进入");
  }
  const rawAnswerMode = String(data.answerMode || "").trim();
  if (rawAnswerMode && ["choice", "input"].indexOf(rawAnswerMode) < 0) {
    throw createError("INVALID_VOCABULARY_QUIZ", "小测作答方式无效，请重新进入");
  }
  const answerMode = vocabulary.normalizeQuizAnswerMode(questionType, rawAnswerMode);
  const studentRes = await db.collection("students").doc(studentId).get();
  if (!studentRes.data || studentRes.data.vocabularyEnabled !== true) {
    throw createError("VOCABULARY_DISABLED", "背单词功能尚未开启");
  }
  const wordKey = assertVocabularyWordKey(data.wordKey);
  const library = getVocabularyLibrary();
  const settings = vocabulary.normalizeVocabularySettings(
    studentRes.data.vocabularySettings,
    library,
    studentRes.data
  );
  const progressId = vocabulary.getProgressDocumentId(studentId, wordKey);
  await assertVocabularyWordBelongsToStudent({
    studentId,
    student: studentRes.data,
    wordKey,
    library,
    settings,
    progressId,
  });
  const nowMs = Date.now();
  const learningDay = vocabulary.getLearningDay(nowMs);
  const progress = await runVocabularyReviewTransaction(async (transaction) => {
    const ref = transaction.collection("vocabularyProgress").doc(progressId);
    const existingRes = await transaction.collection("vocabularyProgress")
      .where({ _id: progressId }).limit(1).get();
    const existing = existingRes.data && existingRes.data.length ? existingRes.data[0] : null;
    const next = vocabulary.buildQuizProgress(existing, {
      correct: data.correct === true,
      questionType,
      answerMode,
      learningDay,
      memoryFactor: englishMemoryScheduler.getStudentMemoryFactor(studentRes.data),
    }, nowMs);
    const updateData = Object.assign({}, next, {
      studentId,
      wordKey,
      lastReviewedAt: db.serverDate(),
      updatedAt: db.serverDate(),
    });
    if (existing) {
      await ref.update({ data: updateData });
    } else {
      await ref.set({
        data: Object.assign({}, updateData, {
          customMeaning: "",
          customPartOfSpeech: "",
          excluded: false,
          createdAt: db.serverDate(),
        }),
      });
    }
    return next;
  }, `quiz:${studentId}:${wordKey}`);
  return Object.assign({ success: true, studentId, wordKey, questionType, answerMode }, progress);
};

const completeVocabularyQuiz = async (event) => {
  await createOneCollection("vocabularyQuizSessions");
  const identity = await getIdentity();
  if (identity.role !== "student" || !identity.student) {
    throw createError("PERMISSION_DENIED", "当前为老师预览，小测记录保持原状态");
  }
  const data = event.data || {};
  const studentId = String(data.studentId || "").trim();
  if (!studentId || studentId !== identity.student._id) {
    throw createError("PERMISSION_DENIED", "请使用当前学生账号保存小测记录");
  }
  const rawResults = Array.isArray(data.results) ? data.results : [];
  if (!rawResults.length || rawResults.length > 30) {
    throw createError("INVALID_VOCABULARY_QUIZ", "小测记录不完整，请重新完成本轮小测");
  }
  const allowedTypes = new Set(["wordToMeaning", "meaningToWord", "letterGap", "spelling"]);
  const results = rawResults.map((item) => {
    const questionType = String(item && item.questionType || "").trim();
    if (!allowedTypes.has(questionType)) {
      throw createError("INVALID_VOCABULARY_QUIZ", "小测题型无效，请重新进入");
    }
    const rawAnswerMode = String(item && item.answerMode || "").trim();
    if (rawAnswerMode && ["choice", "input"].indexOf(rawAnswerMode) < 0) {
      throw createError("INVALID_VOCABULARY_QUIZ", "小测作答方式无效，请重新进入");
    }
    const answerMode = vocabulary.normalizeQuizAnswerMode(questionType, rawAnswerMode);
    return {
      wordKey: assertVocabularyWordKey(item && item.wordKey),
      word: String(item && item.word || "").trim().slice(0, 80),
      questionType,
      taskType: questionType === "letterGap"
        ? "letterCompletion"
        : questionType === "wordToMeaning"
          ? "wordMeaning"
          : "completeWord",
      answerMode,
      correct: item && item.correct === true,
      responseTimeMs: Math.max(0, Math.min(5 * 60 * 1000, Number(item && item.responseTimeMs || 0))),
    };
  });
  const completedAtMs = Date.now();
  const correctCount = results.filter((item) => item.correct).length;
  const totalQuestions = results.length;
  const accuracy = Math.round(correctCount / totalQuestions * 100);
  const startedAtMs = Math.min(
    completedAtMs,
    Math.max(completedAtMs - 60 * 60 * 1000, Number(data.startedAtMs || completedAtMs))
  );
  const sessionData = {
    studentId,
    learningDay: vocabulary.getLearningDay(completedAtMs),
    algorithmVersion: vocabularyQuiz.ALGORITHM_VERSION,
    scope: data.scope === "weak" ? "weak" : data.scope === "retry" ? "retry" : "smart",
    dailyGoal: Math.max(vocabulary.MIN_DAILY_GOAL, Math.min(vocabulary.MAX_DAILY_GOAL, Number(data.dailyGoal || 8))),
    totalQuestions,
    correctCount,
    wrongCount: totalQuestions - correctCount,
    accuracy,
    startedAtMs,
    completedAtMs,
    durationMs: completedAtMs - startedAtMs,
    results,
    createdAt: db.serverDate(),
  };
  const addRes = await db.collection("vocabularyQuizSessions").add({ data: sessionData });
  return {
    success: true,
    sessionId: addRes._id,
    algorithmVersion: sessionData.algorithmVersion,
    totalQuestions,
    correctCount,
    accuracy,
  };
};

const updateVocabularyWord = async (event) => {
  await ensureTeacher();
  await createOneCollection("vocabularyProgress");
  const data = event.data || {};
  const studentId = String(data.studentId || "").trim();
  if (!studentId) throw createError("INVALID_STUDENT", "学生信息不完整，请返回后重试");
  const studentRes = await db.collection("students").doc(studentId).get();
  if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
  const wordKey = assertVocabularyWordKey(data.wordKey);
  const meaning = String(data.meaning || "").trim();
  const partOfSpeech = String(data.partOfSpeech || "").trim();
  if (meaning.length > 200 || partOfSpeech.length > 50) {
    throw createError("INVALID_VOCABULARY_WORD", "释义或词性内容太长，请精简后再保存");
  }
  if (typeof data.excluded !== "boolean") {
    throw createError("INVALID_VOCABULARY_WORD", "请选择“保留”或“忽略”");
  }
  if (!data.excluded && !meaning) {
    throw createError("INVALID_VOCABULARY_WORD", "请先填写中文释义");
  }
  await assertContentSafe({ texts: [meaning, partOfSpeech] });
  const progressId = vocabulary.getProgressDocumentId(studentId, wordKey);
  await runTransaction(async (transaction) => {
    const ref = transaction.collection("vocabularyProgress").doc(progressId);
    const existingRes = await transaction
      .collection("vocabularyProgress")
      .where({ _id: progressId })
      .limit(1)
      .get();
    const existing = existingRes.data && existingRes.data.length ? existingRes.data[0] : null;
    const updateData = {
      studentId,
      wordKey,
      customMeaning: meaning,
      customPartOfSpeech: partOfSpeech,
      excluded: data.excluded,
      updatedAt: db.serverDate(),
    };
    if (existing) {
      await ref.update({ data: updateData });
    } else {
      await ref.set({
        data: Object.assign({}, updateData, {
          stage: 0,
          status: vocabulary.getProgressLabel(0),
          reviewCount: 0,
          correctCount: 0,
          wrongCount: 0,
          streak: 0,
          lastResult: "",
          lastReviewedAtMs: 0,
          nextReviewAtMs: 0,
          createdAt: db.serverDate(),
        }),
      });
    }
  });
  return {
    success: true,
    studentId,
    wordKey,
    meaning,
    partOfSpeech,
    excluded: data.excluded,
  };
};

const listLessons = async (event) => {
  const identity = await getIdentity();
  const data = event.data || {};
  let studentId = data.studentId || "";
  if (identity.role === "student") studentId = identity.student._id;
  if (studentId) await ensureStudentAccess(studentId);
  if (identity.role === "guest") throw createError("PERMISSION_DENIED", "请先绑定学习账号");
  let lessonStudent = identity.role === "student" ? identity.student : null;
  if (studentId && (identity.role === "student" || data.mode === "teacherPreview")) {
    const studentRes = await db.collection("students").doc(studentId).get();
    if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
    lessonStudent = studentRes.data;
    ensureEnglishCourseAccess(identity, studentRes.data, data);
  } else if (studentId) {
    const studentRes = await db.collection("students").doc(studentId).get();
    if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
    lessonStudent = studentRes.data;
  }

  const lessonCollection = db.collection("lessons");
  const res = studentId
    ? await lessonCollection.where({ studentId }).orderBy("lessonDate", "desc").get()
    : await lessonCollection.orderBy("lessonDate", "desc").get();
  return {
    success: true,
    role: identity.role,
    // 单个学生按节次排列；跨学生列表仍按日期。
    data: (studentId ? courseWorkflow.sortLessonsByNumber(res.data || []) : (res.data || []))
      .map((lesson) => lessonStudent
        ? courseWorkflow.withApplicableLessonDuration(lesson, lessonStudent)
        : lesson)
      .map(withTeacherConfirmedHomeworkState)
      .map((lesson) => withHomeworkDeadlineState(lesson)),
  };
};

const toLessonNoInteger = (value) => {
  const text = String(value === undefined || value === null ? "" : value).trim();
  if (!/^\d+$/.test(text)) return null;
  const num = Number(text);
  return Number.isSafeInteger(num) && num > 0 ? num : null;
};

const buildPreviousLessonReference = (lesson, student = {}) => {
  if (!lesson) return null;
  const reference = {
    _id: String(lesson._id || ""),
    title: String(lesson.title || "").trim(),
    subject: String(lesson.subject || appConfig.defaultSubject || "英语").trim(),
    lessonDate: String(lesson.lessonDate || "").trim(),
    lessonNo: String(lesson.lessonNo || "").trim(),
    institutionCourse: lesson.institutionCourse === true,
    lessonTemplateKey: LESSON_TEMPLATE_KEYS.includes(lesson.lessonTemplateKey)
      ? lesson.lessonTemplateKey
      : "general",
    durationMinutes: courseWorkflow.usesLessonDurationMinutes(student, lesson.lessonTemplateKey)
      ? courseWorkflow.normalizeLessonDurationMinutes(lesson.durationMinutes)
      : 0,
    reviewContent: String(lesson.reviewContent || "").trim(),
    taughtContent: String(lesson.taughtContent || "").trim(),
    masterySummary: courseWorkflow.getLessonMasterySummary(lesson),
    oralTopic: String(lesson.oralTopic || "").trim(),
    targetExpression: String(lesson.targetExpression || "").trim(),
    independentOutput: String(lesson.independentOutput || "").trim(),
    correctionNotes: String(lesson.correctionNotes || "").trim(),
    ketSkill: String(lesson.ketSkill || "").trim(),
    nextReview: String(lesson.nextReview || "").trim(),
    homeworkTask: String(lesson.homeworkTask || "").trim(),
    recordingTaskEnabled: lesson.recordingTaskEnabled === true,
    recordingTaskType: ["follow_reading", "ket_official", "ket_mock"].includes(lesson.recordingTaskType)
      ? lesson.recordingTaskType
      : "manual",
    recordingPrompt: String(lesson.recordingPrompt || "").trim(),
    recordingRepeatCount: normalizeRecordingRepeatCount(lesson.recordingRepeatCount),
    followReadingContent: lesson.recordingTaskType === "follow_reading"
      ? followReading.normalizeTask(lesson).followReadingItems.map((item) => item.text).join("\n")
      : "",
    homeworkDueDays: Number.isInteger(Number(lesson.homeworkDueDays))
      ? Number(lesson.homeworkDueDays)
      : -1,
  };
  reference.hasReferenceContent = Boolean(
    reference.reviewContent
    || reference.taughtContent
    || reference.masterySummary
    || reference.oralTopic
    || reference.targetExpression
    || reference.independentOutput
    || reference.correctionNotes
    || reference.ketSkill
    || reference.nextReview
    || reference.homeworkTask
    || reference.recordingPrompt
    || reference.followReadingContent
  );
  return reference;
};

const findPreviousLessonReference = (lessons, currentLesson, student = {}) => {
  const currentId = String(currentLesson && currentLesson._id || "");
  const currentLessonNo = toLessonNoInteger(currentLesson && currentLesson.lessonNo);
  const candidates = (lessons || []).filter((item) => String(item && item._id || "") !== currentId);
  let eligible = currentLessonNo
    ? candidates.filter((item) => {
      const lessonNo = toLessonNoInteger(item && item.lessonNo);
      return lessonNo && lessonNo < currentLessonNo;
    })
    : [];
  if (!eligible.length) {
    eligible = candidates.filter((item) => (
      String(item && item.lessonDate || "") <= String(currentLesson && currentLesson.lessonDate || "")
    ));
  }
  eligible.sort((left, right) => {
    const lessonNoDiff = (toLessonNoInteger(right.lessonNo) || 0) - (toLessonNoInteger(left.lessonNo) || 0);
    if (lessonNoDiff) return lessonNoDiff;
    const dateDiff = String(right.lessonDate || "").localeCompare(String(left.lessonDate || ""));
    if (dateDiff) return dateDiff;
    return getCreatedTime(right) - getCreatedTime(left);
  });
  return buildPreviousLessonReference(eligible[0], student);
};

const getNextLessonNo = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  const studentId = data.studentId;
  if (!studentId) {
    throw createError("INVALID_STUDENT", "学生信息不完整，请返回后重试");
  }
  const studentRes = await db.collection("students").doc(studentId).get();
  if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");

  let maxLessonNo = 0;
  let previousLesson = null;
  const requestedTemplateKey = LESSON_TEMPLATE_KEYS.includes(data.lessonTemplateKey)
    ? data.lessonTemplateKey
    : "";
  const pageSize = 100;
  const lessonsQuery = db.collection("lessons").where({ studentId });
  const countRes = await lessonsQuery.count();
  for (let skip = 0; skip < countRes.total; skip += pageSize) {
    const res = await lessonsQuery.skip(skip).limit(pageSize).get();
    (res.data || []).forEach((lesson) => {
      const lessonNo = toLessonNoInteger(lesson.lessonNo);
      if (lessonNo && lessonNo > maxLessonNo) {
        maxLessonNo = lessonNo;
      }
      const candidateTemplateKey = LESSON_TEMPLATE_KEYS.includes(lesson.lessonTemplateKey)
        ? lesson.lessonTemplateKey
        : "general";
      if (requestedTemplateKey && candidateTemplateKey !== requestedTemplateKey) return;
      const previousLessonNo = previousLesson ? toLessonNoInteger(previousLesson.lessonNo) : null;
      const hasLaterLessonNo = lessonNo && (!previousLessonNo || lessonNo > previousLessonNo);
      const sameLessonNo = lessonNo && previousLessonNo && lessonNo === previousLessonNo;
      const lessonDate = String(lesson.lessonDate || "");
      const previousDate = String(previousLesson && previousLesson.lessonDate || "");
      const hasLaterDate = lessonDate > previousDate;
      const sameDateIsNewer = lessonDate === previousDate && getCreatedTime(lesson) > getCreatedTime(previousLesson);
      if (
        !previousLesson
        || hasLaterLessonNo
        || (sameLessonNo && (hasLaterDate || sameDateIsNewer))
        || (!lessonNo && !previousLessonNo && (hasLaterDate || sameDateIsNewer))
      ) {
        previousLesson = lesson;
      }
    });
  }

  return {
    success: true,
    maxLessonNo,
    nextLessonNo: maxLessonNo + 1,
    hasHistory: Boolean(maxLessonNo > 0 || previousLesson),
    previousLesson: buildPreviousLessonReference(previousLesson, studentRes.data),
  };
};

const LESSON_EVIDENCE_MODES = [
  "speaking",
  "listening",
  "reading",
  "writing",
  "recognition",
  "phonics",
  "grammar",
  "interaction",
  "mixed",
];
const LESSON_PROMPT_TYPES = ["none", "visual", "verbal", "sentence_frame", "choice", "model", "mixed"];
const LESSON_FOCUS_TYPES = Object.keys(learningRadar.FOCUS_LABELS);
const RECORDING_PREPARATION_OPTIONS = [0, 3, 5, 10, 15];
const HONG_KONG_OFFSET_MS = 8 * 60 * 60 * 1000;
const HOMEWORK_REMINDER_HOUR = 18;

const normalizeLessonText = (value, limit = 1200) => String(value || "").trim().slice(0, limit);

const normalizeLessonDurationInput = (value) => {
  if (value === undefined || value === null || String(value).trim() === "" || Number(value) === 0) return 0;
  const durationMinutes = courseWorkflow.normalizeLessonDurationMinutes(value);
  if (!durationMinutes) {
    throw createError("INVALID_LESSON_DURATION", "本次时长必须是 5–300 分钟，并按 5 分钟递增");
  }
  return durationMinutes;
};

const normalizeRecordingRepeatCount = (value) => {
  const count = Math.trunc(Number(value));
  return Number.isFinite(count) ? Math.max(1, Math.min(5, count)) : 2;
};

const normalizeRecordingPreparationSeconds = (value) => {
  const seconds = Math.trunc(Number(value));
  return RECORDING_PREPARATION_OPTIONS.includes(seconds) ? seconds : 5;
};

const normalizeHomeworkDueDays = (value, recordingTaskEnabled) => {
  if (!recordingTaskEnabled) return -1;
  if (value === undefined || value === null || value === "") return -1;
  const days = Number(value);
  if (!Number.isInteger(days) || days < -1 || days > courseWorkflow.MAX_HOMEWORK_DUE_DAYS) {
    throw createError("INVALID_HOMEWORK_DEADLINE", "录音作业期限可设置为当天至 7 天后");
  }
  return days;
};

const normalizeLessonObservationStatus = (value) => (
  learningRadar.STATUS_DEFINITIONS[learningRadar.normalizeObservationStatus(value)].label
);

const normalizeLearningObservations = (items) => (Array.isArray(items) ? items : [])
  .slice(0, 20)
  .map((item) => {
    const status = normalizeLessonObservationStatus(item && item.status);
    const defaultPromptType = status === "独立完成"
      ? "none"
      : status === "提示后完成" ? "verbal" : "mixed";
    return {
      skillId: normalizeLessonText(item && item.skillId, 100),
      content: normalizeLessonText(item && item.content, 200),
      status,
      evidenceMode: LESSON_EVIDENCE_MODES.includes(item && item.evidenceMode)
        ? item.evidenceMode
        : "mixed",
      promptType: LESSON_PROMPT_TYPES.includes(item && item.promptType)
        ? item.promptType
        : defaultPromptType,
      note: normalizeLessonText(item && item.note, 300),
    };
  })
  .filter((item) => item.content);

const normalizeLessonPlanFields = (data, student, existingLesson = null) => {
  const lessonTemplateKey = LESSON_TEMPLATE_KEYS.includes(data.lessonTemplateKey)
    ? data.lessonTemplateKey
    : getStudentLessonTemplateKey(student);
  const studentForPlan = Object.assign({}, student, { lessonTemplateKey });
  const plan = learningRadar.getPlanForStudent(studentForPlan);
  if (!plan) {
    return {
      lessonFocusType: "",
      skillTargetIds: [],
      learningPlanSnapshot: null,
    };
  }
  const normalizedPlan = learningRadar.normalizeLearningPlan(studentForPlan, plan);
  const allSkillIds = new Set(learningRadar.getAllSkills(plan).map((skill) => skill.skillId));
  const hasFocusType = Object.prototype.hasOwnProperty.call(data, "lessonFocusType");
  const hasSkillTargets = Object.prototype.hasOwnProperty.call(data, "skillTargetIds");
  const requestedFocusType = String(
    hasFocusType ? data.lessonFocusType : existingLesson && existingLesson.lessonFocusType || ""
  ).trim();
  const requestedSkillIds = hasSkillTargets
    ? data.skillTargetIds
    : existingLesson && existingLesson.skillTargetIds;
  const existingSnapshot = existingLesson && existingLesson.learningPlanSnapshot;
  return {
    lessonFocusType: LESSON_FOCUS_TYPES.includes(requestedFocusType) ? requestedFocusType : "",
    skillTargetIds: Array.from(new Set((Array.isArray(requestedSkillIds) ? requestedSkillIds : [])
      .map((skillId) => String(skillId || "").trim())
      .filter((skillId) => allSkillIds.has(skillId))))
      .slice(0, 8),
    learningPlanSnapshot: existingSnapshot && existingSnapshot.planKey === plan.planKey
      ? {
        planKey: plan.planKey,
        planVersion: String(existingSnapshot.planVersion || normalizedPlan.planVersion),
        stageId: String(existingSnapshot.stageId || normalizedPlan.currentStageId),
      }
      : {
        planKey: plan.planKey,
        planVersion: normalizedPlan.planVersion,
        stageId: normalizedPlan.currentStageId,
      },
  };
};

const findOfficialKetSpeakingTask = (taskId) => KET_SPEAKING_TASKS.find((item) => item.id === taskId) || null;

const normalizeLessonWorkspacePayload = (data = {}, options = {}) => {
  const lessonTemplateKey = LESSON_TEMPLATE_KEYS.includes(data.lessonTemplateKey)
    ? data.lessonTemplateKey
    : "general";
  const recordingTaskEnabled = lessonTemplateKey === "vocabulary_coaching"
    ? false
    : data.recordingTaskEnabled === true;
  const requestedTaskType = ["follow_reading", "ket_official", "ket_mock"].includes(data.recordingTaskType)
    ? data.recordingTaskType
    : "manual";
  const followReadingTask = followReading.normalizeTask(data);
  const officialTask = lessonTemplateKey === "molly_oral_ket" && recordingTaskEnabled
    ? findOfficialKetSpeakingTask(String(data.ketSpeakingTaskId || "").trim())
    : null;
  const mockSet = lessonTemplateKey === "molly_oral_ket" && recordingTaskEnabled
    ? ketMock.findSet(String(data.ketMockSetId || "").trim())
    : null;
  const recordingTaskType = requestedTaskType === "ket_official" && officialTask
    ? "ket_official"
    : requestedTaskType === "ket_mock" && mockSet
      ? "ket_mock"
      : requestedTaskType === "follow_reading" && recordingTaskEnabled
        ? "follow_reading"
        : "manual";
  if (recordingTaskType === "follow_reading" && !followReadingTask.followReadingItems.length) {
    throw createError("FOLLOW_READING_EMPTY", "请至少填写 1 条跟读内容，每行填写一个单词或句子");
  }
  return {
    title: normalizeLessonText(data.title, 100),
    institutionCourse: data.institutionCourse === true,
    lessonTemplateKey,
    durationMinutes: options.acceptDurationMinutes === false
      ? 0
      : normalizeLessonDurationInput(data.durationMinutes),
    reviewContent: lessonTemplateKey === "vocabulary_coaching" ? "" : normalizeLessonText(data.reviewContent),
    taughtContent: lessonTemplateKey === "vocabulary_coaching" ? "" : normalizeLessonText(data.taughtContent),
    masterySummary: lessonTemplateKey === "vocabulary_coaching" ? "" : normalizeLessonText(data.masterySummary),
    oralTopic: lessonTemplateKey === "vocabulary_coaching" ? "" : normalizeLessonText(data.oralTopic),
    targetExpression: lessonTemplateKey === "vocabulary_coaching" ? "" : normalizeLessonText(data.targetExpression),
    independentOutput: lessonTemplateKey === "vocabulary_coaching" ? "" : normalizeLessonText(data.independentOutput),
    correctionNotes: lessonTemplateKey === "vocabulary_coaching" ? "" : normalizeLessonText(data.correctionNotes),
    ketSkill: lessonTemplateKey === "vocabulary_coaching" ? "" : normalizeLessonText(data.ketSkill, 300),
    nextReview: lessonTemplateKey === "vocabulary_coaching" ? "" : normalizeLessonText(data.nextReview),
    homeworkTask: lessonTemplateKey === "vocabulary_coaching" ? "" : normalizeLessonText(data.homeworkTask),
    recordingTaskEnabled,
    homeworkDueDays: normalizeHomeworkDueDays(data.homeworkDueDays, recordingTaskEnabled),
    recordingTaskType,
    recordingPrompt: recordingTaskType === "ket_official"
      ? officialTask.prompt
      : recordingTaskType === "ket_mock"
        ? `${mockSet.title}：按完整考试流程完成 Part 1 与 Part 2。`
        : normalizeLessonText(data.recordingPrompt, 2000),
    recordingRepeatCount: ["follow_reading", "ket_official", "ket_mock"].includes(recordingTaskType)
      ? 1
      : normalizeRecordingRepeatCount(data.recordingRepeatCount),
    recordingPreparationSeconds: recordingTaskType === "ket_official"
      ? officialTask.preparationSeconds
      : recordingTaskType === "ket_mock" ? 0
      : normalizeRecordingPreparationSeconds(data.recordingPreparationSeconds),
    recordingSuggestedSeconds: recordingTaskType === "ket_official"
      ? officialTask.suggestedRecordingSeconds
      : recordingTaskType === "ket_mock" ? 600 : 0,
    followReadingMode: recordingTaskType === "follow_reading"
      ? followReadingTask.followReadingMode
      : "automatic",
    followReadingGapSeconds: recordingTaskType === "follow_reading"
      ? followReadingTask.followReadingGapSeconds
      : 2,
    followReadingResponseSeconds: recordingTaskType === "follow_reading"
      ? followReadingTask.followReadingResponseSeconds
      : 8,
    followReadingItems: recordingTaskType === "follow_reading"
      ? followReadingTask.followReadingItems
      : [],
    ketSpeakingTaskId: recordingTaskType === "ket_official" ? officialTask.id : "",
    ketSpeakingTask: recordingTaskType === "ket_official" ? officialTask : null,
    ketMockSetId: recordingTaskType === "ket_mock" ? mockSet.id : "",
    ketMockSet: recordingTaskType === "ket_mock" ? {
      id: mockSet.id,
      order: mockSet.order,
      title: mockSet.title,
      shortTitle: mockSet.shortTitle,
      sourceType: mockSet.sourceType,
      sourceBadge: mockSet.sourceBadge,
      sourceLabel: mockSet.sourceLabel,
      sourceReference: mockSet.sourceReference,
      formatLabel: mockSet.formatLabel,
      expectedMinutes: mockSet.expectedMinutes,
    } : null,
    learningObservations: lessonTemplateKey === "vocabulary_coaching"
      ? []
      : normalizeLearningObservations(data.learningObservations),
  };
};

const hasLessonHomework = (lesson) => Boolean(
  lesson && (String(lesson.homeworkTask || "").trim() || lesson.recordingTaskEnabled === true)
);

const isLessonHomeworkCompleted = (lesson) => Boolean(
  lesson
  && (
    lesson.homeworkTeacherReviewStatus === "completed"
    || (
      lesson.homeworkCompletedFrom === "teacher"
      && (lesson.homeworkCompleted === true || Number(lesson.homeworkCompletedAtMs) > 0)
    )
  )
);

const withTeacherConfirmedHomeworkState = (lesson) => {
  if (!lesson || !hasLessonHomework(lesson)) return lesson;
  const teacherConfirmed = isLessonHomeworkCompleted(lesson);
  return Object.assign({}, lesson, {
    homeworkCompleted: teacherConfirmed,
    homeworkCompletedAt: teacherConfirmed ? lesson.homeworkCompletedAt || null : null,
    homeworkCompletedAtMs: teacherConfirmed ? Number(lesson.homeworkCompletedAtMs || 0) : 0,
    homeworkCompletedFrom: teacherConfirmed ? "teacher" : "",
  });
};

const withHomeworkDeadlineState = (lesson, now = Date.now()) => (
  Object.assign({}, lesson, courseWorkflow.buildHomeworkDeadlineState(lesson, now))
);

const getHomeworkTaskSignature = (lesson = {}) => JSON.stringify({
  homeworkTask: String(lesson.homeworkTask || "").trim(),
  recordingTaskEnabled: lesson.recordingTaskEnabled === true,
  recordingPrompt: String(lesson.recordingPrompt || "").trim(),
  recordingRepeatCount: normalizeRecordingRepeatCount(lesson.recordingRepeatCount),
  recordingPreparationSeconds: normalizeRecordingPreparationSeconds(lesson.recordingPreparationSeconds),
  recordingTaskType: ["follow_reading", "ket_official", "ket_mock"].includes(lesson.recordingTaskType)
    ? lesson.recordingTaskType
    : "manual",
  followReadingMode: lesson.followReadingMode || "automatic",
  followReadingGapSeconds: Number(lesson.followReadingGapSeconds) || 2,
  followReadingResponseSeconds: Number(lesson.followReadingResponseSeconds) || 8,
  followReadingItems: followReading.normalizeTask(lesson).followReadingItems.map((item) => ({
    id: item.id,
    text: item.text,
  })),
  ketSpeakingTaskId: String(lesson.ketSpeakingTaskId || ""),
  ketMockSetId: String(lesson.ketMockSetId || ""),
});

const buildHomeworkResetFields = (taskVersion) => ({
  homeworkTaskVersion: Math.max(1, Number(taskVersion) || 1),
  homeworkCompleted: false,
  homeworkCompletedAt: null,
  homeworkCompletedAtMs: 0,
  homeworkCompletedFrom: "",
  homeworkTeacherReviewStatus: "unreviewed",
  homeworkTeacherReviewedAt: null,
  homeworkTeacherReviewedAtMs: 0,
  homeworkFirstSubmittedAtMs: 0,
  homeworkLastSubmittedAtMs: 0,
  homeworkSubmittedLate: false,
  homeworkReminderSubscribed: false,
  homeworkReminderNotifyOpenId: "",
  homeworkReminderNotifyStatus: "not_subscribed",
  homeworkReminderTargetAtMs: 0,
  homeworkReminderTargetDate: "",
  homeworkReminderTaskVersion: 0,
  homeworkReminderNotifyClaimId: "",
  homeworkReminderNotifyAttemptCount: 0,
  homeworkReminderNotifyNextAttemptAtMs: 0,
  homeworkReminderNotifyError: "",
  homeworkReminderNotifySentAt: null,
});

const formatHongKongDay = (timestamp) => {
  const date = new Date(Number(timestamp) + HONG_KONG_OFFSET_MS);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

const parseHongKongDayAtHour = (day, hour) => {
  const matched = String(day || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return 0;
  return Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]), Number(hour) - 8, 0, 0, 0);
};

const getNextHomeworkReminderTarget = (lesson, now = Date.now()) => {
  const today = formatHongKongDay(now);
  let targetAtMs = parseHongKongDayAtHour(today, HOMEWORK_REMINDER_HOUR);
  if (targetAtMs <= now) targetAtMs += VOCABULARY_DAY_MS;
  const lessonDayAtSix = parseHongKongDayAtHour(lesson && lesson.lessonDate, HOMEWORK_REMINDER_HOUR);
  if (lessonDayAtSix > targetAtMs) targetAtMs = lessonDayAtSix;
  return {
    targetAtMs,
    targetDate: formatHongKongDay(targetAtMs),
  };
};

const normalizeLessonRequestPayload = (data = {}, options = {}) => ({
  studentId: String(data.studentId || "").trim(),
  title: String(data.title || "").trim(),
  subject: String(data.subject || appConfig.defaultSubject || "").trim(),
  lessonDate: String(data.lessonDate || "").trim(),
  lessonNo: String(data.lessonNo || "").trim(),
  summary: String(data.summary || "").trim(),
  ...normalizeLessonWorkspacePayload(data, options),
  lessonFocusType: LESSON_FOCUS_TYPES.includes(data.lessonFocusType) ? data.lessonFocusType : "",
  skillTargetIds: Array.isArray(data.skillTargetIds)
    ? Array.from(new Set(data.skillTargetIds.map((skillId) => String(skillId || "").trim()).filter(Boolean))).slice(0, 8)
    : [],
  learningPlanSnapshot: data.learningPlanSnapshot && typeof data.learningPlanSnapshot === "object"
    ? {
      planKey: normalizeLessonText(data.learningPlanSnapshot.planKey, 100),
      planVersion: normalizeLessonText(data.learningPlanSnapshot.planVersion, 40),
      stageId: normalizeLessonText(data.learningPlanSnapshot.stageId, 100),
    }
    : null,
  paperFileIds: Array.isArray(data.paperFileIds)
    ? data.paperFileIds.map((fileId) => String(fileId || "").trim()).filter(Boolean)
    : [],
});

const getLessonRequestFingerprint = (data) => crypto
  .createHash("sha1")
  .update(JSON.stringify(normalizeLessonRequestPayload(data)))
  .digest("hex");

const addLesson = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  const requestedStudentId = String(data.studentId || "").trim();
  if (!requestedStudentId) {
    throw createError("INVALID_LESSON", "请填写学生、课程标题和日期");
  }
  const targetStudentRes = await db.collection("students").doc(requestedStudentId).get();
  if (!targetStudentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
  const requestedTemplateKey = LESSON_TEMPLATE_KEYS.includes(data.lessonTemplateKey)
    ? data.lessonTemplateKey
    : "general";
  const acceptDurationMinutes = courseWorkflow.usesLessonDurationMinutes(
    targetStudentRes.data,
    requestedTemplateKey
  );
  const lessonPayload = normalizeLessonRequestPayload(
    Object.assign({}, data, {
      studentId: requestedStudentId,
      lessonTemplateKey: requestedTemplateKey,
    }),
    { acceptDurationMinutes }
  );
  Object.assign(lessonPayload, normalizeLessonPlanFields(
    Object.assign({}, data, { lessonTemplateKey: requestedTemplateKey }),
    targetStudentRes.data
  ));
  if (!acceptDurationMinutes) delete lessonPayload.durationMinutes;
  if (!lessonPayload.title || !lessonPayload.lessonDate) {
    throw createError("INVALID_LESSON", "请填写学生、课程标题和日期");
  }
  const usesMinuteAccounting = courseWorkflow.getLessonAccountingMode(targetStudentRes.data) === "minute";
  if (lessonPayload.lessonTemplateKey === "vocabulary_coaching") {
    lessonPayload.lessonNo = "";
    if (!lessonPayload.durationMinutes) {
      throw createError("INVALID_LESSON_DURATION", "请填写本次单词陪练的实际分钟数");
    }
  } else if (usesMinuteAccounting && lessonPayload.institutionCourse !== true && !lessonPayload.durationMinutes) {
    lessonPayload.durationMinutes = 60;
  }
  await assertContentSafe({
    texts: [
      lessonPayload.title,
      lessonPayload.subject,
      lessonPayload.lessonNo,
      lessonPayload.summary,
      lessonPayload.reviewContent,
      lessonPayload.taughtContent,
      lessonPayload.masterySummary,
      lessonPayload.oralTopic,
      lessonPayload.targetExpression,
      lessonPayload.independentOutput,
      lessonPayload.correctionNotes,
      lessonPayload.ketSkill,
      lessonPayload.nextReview,
      lessonPayload.homeworkTask,
      lessonPayload.recordingPrompt,
      ...lessonPayload.followReadingItems.map((item) => item.text),
      ...lessonPayload.learningObservations.map((item) => [item.content, item.note]),
    ],
  });
  await ensureStudentLessonCountSnapshot(lessonPayload.studentId);
  const requestId = String(data.requestId || "").trim().slice(0, 100);
  const lessonId = requestId
    ? `lesson_${crypto.createHash("sha1").update(`${lessonPayload.studentId}\n${requestId}`).digest("hex")}`
    : `lesson_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
  const requestFingerprint = getLessonRequestFingerprint(lessonPayload);
  const lessonData = {
    ...lessonPayload,
    ...buildHomeworkResetFields(1),
    requestFingerprint,
    createdAt: db.serverDate(),
  };
  const saved = await runTransaction(async (transaction) => {
    const [studentRes, existingLesson] = await Promise.all([
      transaction.collection("students").doc(lessonPayload.studentId).get(),
      getOptionalTransactionDocument(transaction.collection("lessons").doc(lessonId)),
    ]);
    if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
    if (existingLesson) {
      const existingFingerprint = existingLesson.requestFingerprint
        || getLessonRequestFingerprint(existingLesson);
      if (
        existingLesson.studentId !== lessonPayload.studentId
        || existingFingerprint !== requestFingerprint
      ) {
        throw createError("LESSON_CONFLICT", "课程内容已经修改，请重新提交");
      }
      return { created: false };
    }
    await transaction.collection("lessons").doc(lessonId).set({ data: lessonData });
    return { created: true };
  });
  let completedLessonCount;
  try {
    completedLessonCount = await syncStudentCompletedLessonCount(lessonPayload.studentId);
  } catch (err) {
    console.error("sync lesson count after creation failed", err);
  }
  return {
    _id: lessonId,
    success: true,
    created: saved.created,
    completedLessonCount,
  };
};

const updateLessonWorkspace = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  const lessonId = String(data.lessonId || "").trim();
  if (!lessonId) throw createError("INVALID_LESSON", "课程信息不完整，请返回后重试");
  const currentLessonRes = await db.collection("lessons").doc(lessonId).get();
  if (!currentLessonRes.data || currentLessonRes.data.deleting === true) {
    throw createError("LESSON_NOT_FOUND", "课程不存在或已删除");
  }
  const targetStudentRes = await db.collection("students").doc(currentLessonRes.data.studentId).get();
  if (!targetStudentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
  const requestedTemplateKey = LESSON_TEMPLATE_KEYS.includes(data.lessonTemplateKey)
    ? data.lessonTemplateKey
    : LESSON_TEMPLATE_KEYS.includes(currentLessonRes.data.lessonTemplateKey)
      ? currentLessonRes.data.lessonTemplateKey
      : "general";
  const acceptDurationMinutes = courseWorkflow.usesLessonDurationMinutes(
    targetStudentRes.data,
    requestedTemplateKey
  );
  const institutionCourseProvided = Object.prototype.hasOwnProperty.call(data, "institutionCourse");
  const durationMinutesProvided = Object.prototype.hasOwnProperty.call(data, "durationMinutes");
  const workspace = normalizeLessonWorkspacePayload(
    Object.assign({}, data, { lessonTemplateKey: requestedTemplateKey }),
    { acceptDurationMinutes }
  );
  Object.assign(workspace, normalizeLessonPlanFields(
    Object.assign({}, data, { lessonTemplateKey: requestedTemplateKey }),
    targetStudentRes.data,
    currentLessonRes.data
  ));
  if (!workspace.title) throw createError("INVALID_LESSON_TITLE", "请填写课程名称");
  // 上课日期可在编辑时修正（例如补录时选错日期）；不传时保持原日期。
  if (Object.prototype.hasOwnProperty.call(data, "lessonDate")) {
    const lessonDate = String(data.lessonDate || "").trim();
    const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(lessonDate);
    const valid = parsed && (() => {
      const date = new Date(Date.UTC(Number(parsed[1]), Number(parsed[2]) - 1, Number(parsed[3])));
      return date.getUTCFullYear() === Number(parsed[1])
        && date.getUTCMonth() === Number(parsed[2]) - 1
        && date.getUTCDate() === Number(parsed[3]);
    })();
    if (!valid) throw createError("INVALID_LESSON_DATE", "请选择正确的上课日期");
    workspace.lessonDate = lessonDate;
  }
  await assertContentSafe({
    texts: [
      workspace.title,
      workspace.reviewContent,
      workspace.taughtContent,
      workspace.masterySummary,
      workspace.oralTopic,
      workspace.targetExpression,
      workspace.independentOutput,
      workspace.correctionNotes,
      workspace.ketSkill,
      workspace.nextReview,
      workspace.homeworkTask,
      workspace.recordingPrompt,
      ...workspace.followReadingItems.map((item) => item.text),
      ...workspace.learningObservations.map((item) => [item.content, item.note]),
    ],
  });
  const requestedInstitutionCourse = institutionCourseProvided
    ? workspace.institutionCourse
    : currentLessonRes.data.institutionCourse === true;
  const progressCountingChanged = requestedInstitutionCourse !== (currentLessonRes.data.institutionCourse === true);
  workspace.institutionCourse = requestedInstitutionCourse;
  workspace.durationMinutes = acceptDurationMinutes
    ? durationMinutesProvided
      ? workspace.durationMinutes
      : courseWorkflow.normalizeLessonDurationMinutes(currentLessonRes.data.durationMinutes)
    : 0;
  const usesMinuteAccounting = courseWorkflow.getLessonAccountingMode(targetStudentRes.data) === "minute";
  if (workspace.lessonTemplateKey === "vocabulary_coaching" && !workspace.durationMinutes) {
    throw createError("INVALID_LESSON_DURATION", "请填写本次单词陪练的实际分钟数");
  }
  if (usesMinuteAccounting && workspace.institutionCourse !== true && !workspace.durationMinutes) {
    workspace.durationMinutes = 60;
  }
  const durationCountingChanged = usesMinuteAccounting
    && workspace.institutionCourse !== true
    && workspace.durationMinutes !== courseWorkflow.normalizeLessonDurationMinutes(currentLessonRes.data.durationMinutes);
  if (progressCountingChanged || durationCountingChanged) {
    await ensureStudentLessonCountSnapshot(currentLessonRes.data.studentId);
  }
  const saved = await runTransaction(async (transaction) => {
    const lessonRef = transaction.collection("lessons").doc(lessonId);
    const lesson = await getOptionalTransactionDocument(lessonRef);
    if (!lesson || lesson.deleting === true) {
      throw createError("LESSON_NOT_FOUND", "课程不存在或已删除");
    }
    const taskChanged = getHomeworkTaskSignature(lesson) !== getHomeworkTaskSignature(workspace);
    const updateData = {
      ...workspace,
      summary: workspace.masterySummary
        || workspace.independentOutput
        || workspace.taughtContent
        || workspace.oralTopic,
      workspaceUpdatedAt: db.serverDate(),
    };
    if (taskChanged) {
      Object.assign(updateData, buildHomeworkResetFields(Number(lesson.homeworkTaskVersion || 0) + 1));
    } else {
      updateData.homeworkSubmittedLate = courseWorkflow.buildHomeworkDeadlineState(
        Object.assign({}, lesson, workspace),
        Date.now(),
        lesson.homeworkFirstSubmittedAtMs
      ).homeworkSubmittedLate;
    }
    await lessonRef.update({ data: updateData });
    return {
      taskChanged,
      homeworkTaskVersion: updateData.homeworkTaskVersion || lesson.homeworkTaskVersion || 1,
      studentId: lesson.studentId,
      progressCountingChanged: workspace.institutionCourse !== (lesson.institutionCourse === true)
        || (
          usesMinuteAccounting
          && workspace.institutionCourse !== true
          && workspace.durationMinutes !== courseWorkflow.normalizeLessonDurationMinutes(lesson.durationMinutes)
        ),
    };
  });
  let completedLessonCount;
  if (saved.progressCountingChanged) {
    try {
      completedLessonCount = await syncStudentCompletedLessonCount(saved.studentId);
    } catch (err) {
      console.error("sync lesson count after course type update failed", err);
    }
  }
  return { success: true, lessonId, workspace, ...saved, completedLessonCount };
};

const loadAllLessonDocuments = async (collectionName, lessonId) => {
  const documents = [];
  const pageSize = 100;
  for (let skip = 0; ; skip += pageSize) {
    const res = await db
      .collection(collectionName)
      .where({ lessonId })
      .skip(skip)
      .limit(pageSize)
      .get();
    const items = res.data || [];
    documents.push(...items);
    if (items.length < pageSize) break;
  }
  return documents;
};

const removeDocumentsById = async (collectionName, documents) => {
  const batchSize = 20;
  for (let index = 0; index < documents.length; index += batchSize) {
    const batch = documents.slice(index, index + batchSize);
    await Promise.all(
      batch.map((item) => db.collection(collectionName).doc(item._id).remove())
    );
  }
};

const getWritableLessonInTransaction = async (
  transaction,
  lessonId,
  studentId,
  errorCode = "INVALID_LESSON"
) => {
  const lesson = await getOptionalTransactionDocument(
    transaction.collection("lessons").doc(lessonId)
  );
  if (!lesson || lesson.studentId !== studentId) {
    throw createError(errorCode, "课程已删除或不属于这位学生");
  }
  if (lesson.deleting === true) {
    throw createError(errorCode, "课程正在删除，请刷新后再试");
  }
  return lesson;
};

const deleteLesson = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  const lessonId = String(data.lessonId || "").trim();
  if (!lessonId) throw createError("INVALID_LESSON", "课程信息不完整，请返回后重试");

  await createOneCollection("systemLocks");
  const deleteLockId = getSystemLockId("lesson_delete", lessonId);
  const deleteState = await runTransaction(async (transaction) => {
    const lessonRef = transaction.collection("lessons").doc(lessonId);
    const deleteLockRef = transaction.collection("systemLocks").doc(deleteLockId);
    const [currentLesson, deleteLock] = await Promise.all([
      getOptionalTransactionDocument(lessonRef),
      getOptionalTransactionDocument(deleteLockRef),
    ]);
    if (!currentLesson) {
      if (deleteLock && deleteLock.lessonId === lessonId) {
        return { alreadyDeleted: true, studentId: deleteLock.studentId || "" };
      }
      throw createError("LESSON_NOT_FOUND", "课程不存在或已删除");
    }
    if (data.expectedTitle && String(data.expectedTitle) !== String(currentLesson.title || "")) {
      throw createError("LESSON_CHANGED", "课程信息已更新，请刷新后重试");
    }
    if (currentLesson.deleting !== true) {
      await lessonRef.update({
        data: {
          deleting: true,
          deletingAt: db.serverDate(),
          updatedAt: db.serverDate(),
        },
      });
    }
    await deleteLockRef.set({
      data: {
        type: "lesson_delete",
        lessonId,
        studentId: currentLesson.studentId,
        status: "deleting",
        updatedAt: db.serverDate(),
      },
    });
    return { alreadyDeleted: false, lesson: currentLesson };
  });
  if (deleteState.alreadyDeleted) {
    return {
      success: true,
      alreadyDeleted: true,
      deletedLessonId: lessonId,
      deletedPaperCount: 0,
      deletedMistakeCount: 0,
      deletedSubmissionCount: 0,
      deletedKetMockSessionCount: 0,
    };
  }
  const lesson = deleteState.lesson;
  await ensureStudentLessonCountSnapshot(lesson.studentId);
  await createOneCollection("lessonSubmissions");

  const [papers, lessonMistakes, lessonSubmissions] = await Promise.all([
    loadAllLessonDocuments("papers", lessonId),
    loadAllLessonDocuments("mistakes", lessonId),
    loadAllLessonDocuments("lessonSubmissions", lessonId),
  ]);
  const ketMockDeletion = await ketMockService.deleteLessonSessions(lessonId, lesson.studentId);
  const followReadingDeletion = await followReadingService.deleteLessonAssets(lessonId);
  const mistakes = lessonMistakes;
  const mismatchedMistakeCount = mistakes.filter((mistake) => mistake.studentId !== lesson.studentId).length;
  if (mismatchedMistakeCount) {
    console.warn("deleting lesson with mismatched legacy mistakes", {
      lessonId,
      studentId: lesson.studentId,
      mismatchedMistakeCount,
    });
  }
  const paperFileIDs = []
    .concat(lesson.paperFileIds || [])
    .concat(
      papers.reduce((result, paper) => {
        return result.concat(paper.fileID || [], paper.fileIds || []);
      }, [])
    );
  const submissionFileIDs = lessonSubmissions
    .map((submission) => submission.fileID)
    .filter((fileID) => fileID);

  await removeDocumentsById("mistakes", mistakes);
  await removeDocumentsById("papers", papers);
  await removeDocumentsById("lessonSubmissions", lessonSubmissions);
  await db.collection("lessons").doc(lessonId).remove();
  await deleteUnsafeFiles(paperFileIDs.concat(submissionFileIDs));
  await db.collection("systemLocks").doc(deleteLockId).update({
    data: {
      status: "completed",
      completedAt: db.serverDate(),
      updatedAt: db.serverDate(),
    },
  });

  let completedLessonCount;
  try {
    completedLessonCount = await syncStudentCompletedLessonCount(lesson.studentId);
  } catch (err) {
    console.error("sync lesson count after deletion failed", err);
  }
  return {
    success: true,
    deletedLessonId: lessonId,
    deletedPaperCount: papers.length,
    deletedMistakeCount: mistakes.length,
    deletedSubmissionCount: lessonSubmissions.length,
    deletedKetMockSessionCount: ketMockDeletion.deletedSessionCount,
    deletedFollowReadingAssetCount: followReadingDeletion.deletedAssetCount,
    completedLessonCount,
  };
};

const attachLessonSubmissionAudioUrls = async (submissions) => {
  const items = Array.isArray(submissions) ? submissions : [];
  const fileIDs = uniqueValues(items.map((item) => item.fileID).filter(Boolean));
  if (!fileIDs.length) return items;
  const urlByFileID = new Map();
  for (let offset = 0; offset < fileIDs.length; offset += 50) {
    try {
      const res = await cloud.getTempFileURL({ fileList: fileIDs.slice(offset, offset + 50) });
      (res.fileList || [])
        .filter((item) => item && item.status === 0 && item.fileID && item.tempFileURL)
        .forEach((item) => urlByFileID.set(String(item.fileID), String(item.tempFileURL)));
    } catch (err) {
      console.error("get lesson recording temp urls failed", err);
    }
  }
  return items.map((item) => Object.assign({}, item, {
    audioUrl: urlByFileID.get(String(item.fileID || "")) || "",
    audioAvailable: urlByFileID.has(String(item.fileID || "")),
  }));
};

const attachLessonPaperUrls = async (papers) => {
  const items = Array.isArray(papers) ? papers : [];
  const fileIDs = uniqueValues(items.reduce((result, item) => (
    result.concat(item && item.fileID || [], item && item.previewFileID || [])
  ), []).filter(Boolean));
  if (!fileIDs.length) return items;
  const urlByFileID = new Map();
  for (let offset = 0; offset < fileIDs.length; offset += 50) {
    try {
      const res = await cloud.getTempFileURL({ fileList: fileIDs.slice(offset, offset + 50) });
      (res.fileList || [])
        .filter((item) => item && item.status === 0 && item.fileID && item.tempFileURL)
        .forEach((item) => urlByFileID.set(String(item.fileID), String(item.tempFileURL)));
    } catch (err) {
      console.error("get lesson paper temp urls failed", err);
    }
  }
  return items.map((item) => {
    const fileUrl = urlByFileID.get(String(item.fileID || "")) || "";
    const previewUrl = urlByFileID.get(String(item.previewFileID || item.fileID || "")) || fileUrl;
    return Object.assign({}, item, {
      fileUrl,
      previewUrl,
      fileAvailable: Boolean(fileUrl),
      audioUrl: item.type === "audio" ? fileUrl : "",
      audioAvailable: item.type === "audio" && Boolean(fileUrl),
    });
  });
};

const getLessonDetail = async (event) => {
  const data = event.data || {};
  const lessonId = data.lessonId;
  if (!lessonId) throw createError("INVALID_LESSON", "课程信息不完整，请返回后重试");
  const identity = await getIdentity();
  if (identity.role === "guest") throw createError("PERMISSION_DENIED", "请先绑定学习账号");
  if (data.mode === "teacherPreview" && identity.role !== "teacher") {
    throw createError("PERMISSION_DENIED", "请使用教师账号进入学生视角");
  }

  const lessonRes = await db.collection("lessons").doc(lessonId).get();
  const lesson = lessonRes.data;
  if (!lesson) throw createError("LESSON_NOT_FOUND", "课程不存在或已删除");
  if (data.mode === "teacherPreview" && data.previewStudentId && lesson.studentId !== data.previewStudentId) {
    throw createError("PERMISSION_DENIED", "请从对应学生的课程页进入");
  }
  await ensureStudentAccess(lesson.studentId);
  await createOneCollection("lessonSubmissions");
  const studentRes = await db.collection("students").doc(lesson.studentId).get();
  if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
  const student = studentRes.data;
  let canReadMistakes = true;
  if (identity.role === "student" || data.mode === "teacherPreview") {
    ensureEnglishCourseAccess(identity, student, data);
    canReadMistakes = isMistakeLearningEnabled(student);
  }
  const [lessonPapers, lessonMistakes, lessonSubmissions, studentLessons] = await Promise.all([
    loadAllLessonDocuments("papers", lessonId),
    loadAllLessonDocuments("mistakes", lessonId),
    loadAllLessonDocuments("lessonSubmissions", lessonId),
    identity.role === "teacher" && data.mode !== "teacherPreview"
      ? loadAllStudentDocuments("lessons", lesson.studentId)
      : Promise.resolve([]),
  ]);
  const isStudentView = identity.role === "student" || data.mode === "teacherPreview";
  const papers = lessonPapers.filter((item) => (
    item.studentId === lesson.studentId
    && (!isStudentView || item.studentVisible !== false)
  ));
  const mistakes = canReadMistakes
    ? lessonMistakes.filter((item) => item.studentId === lesson.studentId)
    : [];
  const submissions = lessonSubmissions.filter((item) => item.studentId === lesson.studentId);
  const mismatchedMistakeCount = lessonMistakes.filter((item) => item.studentId !== lesson.studentId).length;
  if (mismatchedMistakeCount) {
    console.warn("发现课程错题归属不一致，读取时已隔离", {
      lessonId,
      studentId: lesson.studentId,
      ignoredCount: mismatchedMistakeCount,
    });
  }
  papers.sort((a, b) => {
    if (a.uploadBatchId && a.uploadBatchId === b.uploadBatchId) {
      return (Number(a.batchIndex) || 0) - (Number(b.batchIndex) || 0);
    }
    return (Number(b.uploadedAtMs) || getCreatedTime(b)) - (Number(a.uploadedAtMs) || getCreatedTime(a));
  });
  mistakes.sort((a, b) => getCreatedTime(b) - getCreatedTime(a));
  submissions.sort((a, b) => {
    if (a.recordingMode === "follow_reading" && b.recordingMode === "follow_reading") {
      const attemptDiff = Number(b.attemptNo || 0) - Number(a.attemptNo || 0);
      if (attemptDiff) return attemptDiff;
      return Number(a.followReadingItemOrder || 0) - Number(b.followReadingItemOrder || 0);
    }
    return getCreatedTime(b) - getCreatedTime(a);
  });
  const submissionsWithTiming = submissions.map((item) => Object.assign({}, item, {
    submittedLate: courseWorkflow.isLateHomeworkSubmission(
      lesson,
      Number(item.createdAtMs) || getCreatedTime(item)
    ),
  }));
  const [papersWithUrls, submissionsWithAudioUrls] = await Promise.all([
    attachLessonPaperUrls(papers),
    attachLessonSubmissionAudioUrls(submissionsWithTiming),
  ]);
  const followReadingAudio = lesson.recordingTaskType === "follow_reading"
    ? await followReadingService.getLessonSummary(lesson)
    : null;
  const lessonForResponse = courseWorkflow.withApplicableLessonDuration(lesson, student);
  const lessonAccountingMode = courseWorkflow.getLessonAccountingMode(student);
  return {
    success: true,
    role: identity.role,
    lesson: Object.assign(
      withHomeworkDeadlineState(withTeacherConfirmedHomeworkState(lessonForResponse)),
      followReadingAudio ? {
        followReadingAudioReadyCount: followReadingAudio.readyCount,
        followReadingAudioTotalCount: followReadingAudio.totalCount,
        followReadingAudioComplete: followReadingAudio.complete,
      } : {}
    ),
    student: {
      _id: student._id,
      name: student.name || "学生",
      lessonTemplateKey: getStudentLessonTemplateKey(student),
      lessonAccountingMode,
      progressUnit: lessonAccountingMode === "minute" ? "minute" : "lesson",
    },
    papers: papersWithUrls,
    mistakes,
    submissions: submissionsWithAudioUrls,
    previousLesson: identity.role === "teacher" && data.mode !== "teacherPreview"
      ? findPreviousLessonReference(studentLessons, lesson, student)
      : null,
    mistakeLearningEnabled: canReadMistakes,
  };
};

const MATERIAL_PURPOSES = ["student_reference", "listening", "school_exam", "board_photo", "teacher_only"];

const normalizeMaterialPurpose = (value) => (
  MATERIAL_PURPOSES.includes(value) ? value : "student_reference"
);

const addPaper = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  if (!data.studentId || !data.lessonId || !data.fileID || !data.fileName || !data.type) {
    throw createError("INVALID_PAPER", "请先上传资料，并选择资料类型");
  }
  const lessonRes = await db.collection("lessons").doc(data.lessonId).get();
  if (!lessonRes.data || lessonRes.data.studentId !== data.studentId) {
    throw createError("INVALID_PAPER", "所选课程不属于这位学生，请重新选择");
  }
  const paperId = buildLessonPaperId(data);
  const existingPaper = await getOptionalTransactionDocument(db.collection("papers").doc(paperId));
  if (existingPaper) {
    if (isSameLessonPaperUpload(existingPaper, data)) {
      return { success: true, _id: paperId, reused: true };
    }
    throw createError("PAPER_UPLOAD_CONFLICT", "这份资料的上传编号已被使用，请重新选择文件");
  }
  try {
    await assertContentSafe({
      texts: [data.title, data.paperTitle, data.term, data.fileName],
      imageFileIds: data.type === "image" || data.type === "canva"
        ? [getMaterialSafetyImageFileID(data)]
        : [],
      allowImageReview: true,
      contextLabel: "教师课程资料",
    });
  } catch (err) {
    // 只有明确判定违规才删除；临时检查失败时保留文件，供同一上传请求安全重试。
    if (err.code === "CONTENT_RISK") {
      await deleteUnsafeFiles([data.fileID, data.previewFileID]);
    }
    throw err;
  }
  const paperData = {
    studentId: data.studentId,
    lessonId: data.lessonId,
    title: data.title || data.fileName,
    type: data.type,
    paperType: data.paperType || (data.type === "audio" ? "listening" : "mixed"),
    paperTitle: data.paperTitle || data.title || data.fileName,
    term: data.term || "",
    source: data.source || "practice",
    purpose: normalizeMaterialPurpose(data.purpose),
    studentVisible: typeof data.studentVisible === "boolean"
      ? data.studentVisible
      : data.purpose !== "teacher_only",
    fileID: data.fileID,
    previewFileID: data.previewFileID || data.fileID,
    fileName: data.fileName,
    originalFileName: data.originalFileName || data.fileName,
    fileExtension: normalizeLessonText(data.fileExtension, 12).toLowerCase(),
    fileSize: data.fileSize || 0,
    uploadBatchId: normalizeLessonText(data.uploadBatchId, 80),
    batchIndex: Math.max(0, Number(data.batchIndex) || 0),
    uploadedAtMs: Math.max(0, Number(data.uploadedAtMs) || Date.now()),
    createdAt: db.serverDate(),
  };
  return await runTransaction(async (transaction) => {
    const paperRef = transaction.collection("papers").doc(paperId);
    const currentPaper = await getOptionalTransactionDocument(paperRef);
    if (currentPaper) {
      if (isSameLessonPaperUpload(currentPaper, data)) {
        return { success: true, _id: paperId, reused: true };
      }
      throw createError("PAPER_UPLOAD_CONFLICT", "这份资料的上传编号已被使用，请重新选择文件");
    }
    await getWritableLessonInTransaction(
      transaction,
      data.lessonId,
      data.studentId,
      "INVALID_PAPER"
    );
    await paperRef.set({ data: paperData });
    return { success: true, _id: paperId, reused: false };
  });
};

const updatePaper = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  const paperId = String(data.paperId || "").trim();
  if (!paperId) throw createError("INVALID_PAPER", "资料信息不完整，请刷新后重试");
  const paperRes = await db.collection("papers").doc(paperId).get();
  if (!paperRes.data) throw createError("PAPER_NOT_FOUND", "资料不存在或已删除");
  const updates = {};
  if (Object.prototype.hasOwnProperty.call(data, "paperTitle")) {
    const paperTitle = normalizeLessonText(data.paperTitle, 200);
    if (!paperTitle) throw createError("INVALID_PAPER", "请填写资料标题");
    updates.paperTitle = paperTitle;
  }
  if (Object.prototype.hasOwnProperty.call(data, "purpose")) {
    updates.purpose = normalizeMaterialPurpose(data.purpose);
  }
  if (typeof data.studentVisible === "boolean") {
    updates.studentVisible = data.studentVisible;
  }
  if (!Object.keys(updates).length) {
    return { success: true, paperId, unchanged: true };
  }
  await assertContentSafe({ texts: [updates.paperTitle] });
  await db.collection("papers").doc(paperId).update({
    data: {
      ...updates,
      updatedAt: db.serverDate(),
    },
  });
  return { success: true, paperId, updates };
};

const deletePaper = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  const paperId = String(data.paperId || "").trim();
  if (!paperId) throw createError("INVALID_PAPER", "资料信息不完整，请刷新后重试");
  const paperRes = await db.collection("papers").doc(paperId).get();
  if (!paperRes.data) return { success: true, paperId, alreadyDeleted: true };
  const paper = paperRes.data;
  if (data.lessonId && paper.lessonId !== data.lessonId) {
    throw createError("INVALID_PAPER", "资料所属课程已变化，请刷新后重试");
  }
  await db.collection("papers").doc(paperId).remove();
  await deleteUnsafeFiles([paper.fileID, paper.previewFileID].concat(paper.fileIds || []).filter(Boolean));
  return { success: true, paperId };
};

const replacePaperFile = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  const paperId = String(data.paperId || "").trim();
  const fileID = String(data.fileID || "").trim();
  const fileName = normalizeLessonText(data.fileName, 200);
  const type = ["pdf", "document", "image", "audio", "canva"].includes(data.type) ? data.type : "";
  if (!paperId || !fileID || !fileName || !type) {
    throw createError("INVALID_PAPER", "新文件信息不完整，请重新选择");
  }
  const paperRes = await db.collection("papers").doc(paperId).get();
  if (!paperRes.data) {
    await deleteUnsafeFiles([fileID]);
    throw createError("PAPER_NOT_FOUND", "资料不存在或已删除");
  }
  const paper = paperRes.data;
  if (data.expectedOldFileID && paper.fileID !== data.expectedOldFileID) {
    await deleteUnsafeFiles([fileID]);
    throw createError("PAPER_CHANGED", "资料已被更新，请刷新后重试");
  }
  try {
    await assertContentSafe({
      texts: [fileName],
      imageFileIds: type === "image" || type === "canva" ? [fileID] : [],
      allowImageReview: true,
      contextLabel: "教师替换课程资料",
    });
    await db.collection("papers").doc(paperId).update({
      data: {
        fileID,
        previewFileID: fileID,
        fileName,
        originalFileName: fileName,
        fileExtension: normalizeLessonText(data.fileExtension, 12).toLowerCase(),
        fileSize: Math.max(0, Number(data.fileSize) || 0),
        type,
        updatedAt: db.serverDate(),
      },
    });
  } catch (err) {
    await deleteUnsafeFiles([fileID]);
    throw err;
  }
  if (paper.fileID && paper.fileID !== fileID) await deleteUnsafeFiles([paper.fileID, paper.previewFileID]);
  return { success: true, paperId, fileID, type };
};

const deleteLessonPapers = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  const lessonId = String(data.lessonId || "").trim();
  if (!lessonId) throw createError("INVALID_LESSON", "课程信息不完整，请刷新后重试");
  const lessonRes = await db.collection("lessons").doc(lessonId).get();
  if (!lessonRes.data) throw createError("LESSON_NOT_FOUND", "课程不存在或已删除");
  const papers = (await loadAllLessonDocuments("papers", lessonId))
    .filter((paper) => paper.studentId === lessonRes.data.studentId);
  const fileIDs = papers.reduce((result, paper) => result.concat(
    paper.fileID || [],
    paper.previewFileID || [],
    paper.fileIds || []
  ), []);
  await removeDocumentsById("papers", papers);
  await deleteUnsafeFiles(fileIDs.filter(Boolean));
  return { success: true, lessonId, deletedPaperCount: papers.length };
};

const normalizeCloudPathSegment = (value, fallback, limit = 32) => {
  const segment = String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, limit);
  return segment || fallback;
};

const shortRecordId = (value) => normalizeCloudPathSegment(String(value || "").replace(/^lesson_|^submission_/, ""), "record", 10);

const formatRecordingPathTime = (value) => {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return "未标时间";
  const chinaTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = (part) => String(part).padStart(2, "0");
  return [
    chinaTime.getUTCFullYear(),
    pad(chinaTime.getUTCMonth() + 1),
    pad(chinaTime.getUTCDate()),
    pad(chinaTime.getUTCHours()),
    pad(chinaTime.getUTCMinutes()),
    pad(chinaTime.getUTCSeconds()),
  ].join("-");
};

const buildReadableRecordingCloudPath = ({ student, lesson, submission, attemptNo }) => {
  const studentFolder = `${normalizeCloudPathSegment(student && student.name, "学生", 20)}-${shortRecordId(student && student._id)}`;
  const lessonDate = normalizeCloudPathSegment(lesson && lesson.lessonDate, "未标日期", 16);
  const lessonNo = normalizeCloudPathSegment(lesson && lesson.lessonNo, "未编号", 10);
  const lessonTitle = normalizeCloudPathSegment(lesson && lesson.title, "英语课", 28);
  const durationMinutes = courseWorkflow.normalizeLessonDurationMinutes(lesson && lesson.durationMinutes);
  const lessonMarker = lesson && lesson.lessonNo
    ? `第${lessonNo}节`
    : durationMinutes ? `${durationMinutes}分钟` : lessonNo;
  const lessonFolder = `${lessonDate}-${lessonMarker}-${lessonTitle}-${shortRecordId(lesson && lesson._id)}`;
  const durationSeconds = Math.max(0, Math.round((Number(submission && submission.duration) || 0) / 1000));
  const recordedAt = formatRecordingPathTime(getCreatedTime(submission) || Date.now());
  return `lesson-submissions/${studentFolder}/${lessonFolder}/第${attemptNo}次-${recordedAt}-${durationSeconds}秒-reading.mp3`;
};

const buildHomeworkCompletedFields = (source) => {
  const completionSource = source || "student";
  const teacherConfirmed = completionSource === "teacher";
  return {
    homeworkCompleted: true,
    homeworkCompletedAt: db.serverDate(),
    homeworkCompletedAtMs: Date.now(),
    homeworkCompletedFrom: completionSource,
    homeworkTeacherReviewStatus: teacherConfirmed ? "completed" : "unreviewed",
    homeworkTeacherReviewedAt: teacherConfirmed ? db.serverDate() : null,
    homeworkTeacherReviewedAtMs: teacherConfirmed ? Date.now() : 0,
    homeworkReminderSubscribed: false,
    homeworkReminderNotifyStatus: "cancelled_completed",
    homeworkReminderNotifyClaimId: "",
    homeworkReminderNotifyNextAttemptAtMs: 0,
    homeworkReminderNotifyError: "",
    updatedAt: db.serverDate(),
  };
};

const isUsableLessonRecording = (submission) => Boolean(
  submission && submission.kind === "audio" && submission.status !== "需要重录"
);

const syncLessonSubmissionTiming = async (lessonId) => {
  const lessonRes = await db.collection("lessons").doc(lessonId).get();
  const lesson = lessonRes.data;
  if (!lesson || lesson.deleting === true) return null;
  const currentTaskVersion = Math.max(1, Number(lesson.homeworkTaskVersion) || 1);
  const submissions = (await loadAllLessonDocuments("lessonSubmissions", lessonId))
    .filter((item) => (
      item.studentId === lesson.studentId
      && isUsableLessonRecording(item)
      && Math.max(1, Number(item.homeworkTaskVersion) || 1) === currentTaskVersion
    ))
    .sort((left, right) => (
      (Number(left.createdAtMs) || getCreatedTime(left))
      - (Number(right.createdAtMs) || getCreatedTime(right))
    ));
  const firstSubmittedAtMs = submissions.length
    ? Number(submissions[0].createdAtMs) || getCreatedTime(submissions[0])
    : 0;
  const lastSubmittedAtMs = submissions.length
    ? Number(submissions[submissions.length - 1].createdAtMs) || getCreatedTime(submissions[submissions.length - 1])
    : 0;
  const deadlineState = courseWorkflow.buildHomeworkDeadlineState(
    lesson,
    Date.now(),
    firstSubmittedAtMs
  );
  await db.collection("lessons").doc(lessonId).update({
    data: {
      homeworkFirstSubmittedAtMs: firstSubmittedAtMs,
      homeworkLastSubmittedAtMs: lastSubmittedAtMs,
      homeworkSubmittedLate: deadlineState.homeworkSubmittedLate,
    },
  });
  return Object.assign({ firstSubmittedAtMs, lastSubmittedAtMs }, deadlineState);
};

const syncLessonSubmissionTimingSafely = async (lessonId) => {
  try {
    return await syncLessonSubmissionTiming(lessonId);
  } catch (err) {
    console.error("sync lesson submission timing failed", lessonId, err);
    return null;
  }
};

const resetCompletedHomeworkWhenNoUsableRecording = async (lessonId, invalidatedAtMs) => {
  const submissions = await loadAllLessonDocuments("lessonSubmissions", lessonId);
  const usableSubmissionIds = submissions
    .filter(isUsableLessonRecording)
    .map((item) => item._id)
    .filter(Boolean);
  return runTransaction(async (transaction) => {
    const lessonRef = transaction.collection("lessons").doc(lessonId);
    const lesson = await getOptionalTransactionDocument(lessonRef);
    if (!lesson || lesson.deleting === true || lesson.recordingTaskEnabled !== true) return false;
    if (!isLessonHomeworkCompleted(lesson)) return false;
    if (Number(lesson.homeworkCompletedAtMs || 0) > Number(invalidatedAtMs || 0)) return false;
    const currentTaskVersion = Math.max(1, Number(lesson.homeworkTaskVersion) || 1);
    for (let i = 0; i < usableSubmissionIds.length; i += 1) {
      const current = await getOptionalTransactionDocument(
        transaction.collection("lessonSubmissions").doc(usableSubmissionIds[i])
      );
      if (
        current
        && current.lessonId === lessonId
        && isUsableLessonRecording(current)
        && Math.max(1, Number(current.homeworkTaskVersion) || 1) === currentTaskVersion
      ) return false;
    }
    await lessonRef.update({
      data: buildHomeworkResetFields(lesson.homeworkTaskVersion || 1),
    });
    return true;
  });
};

const submitLessonRecording = async (event) => {
  const identity = await getIdentity();
  if (identity.role !== "student" || !identity.student) {
    throw createError("PERMISSION_DENIED", "请在学生端提交独立朗读录音");
  }
  const data = event.data || {};
  const lessonId = String(data.lessonId || "").trim();
  const fileID = String(data.fileID || "").trim();
  const duration = Math.max(0, Math.min(300000, Number(data.duration) || 0));
  if (!lessonId || !fileID) throw createError("INVALID_RECORDING", "录音信息不完整，请重新录制");
  const lessonRes = await db.collection("lessons").doc(lessonId).get();
  const lesson = lessonRes.data;
  if (!lesson || lesson.studentId !== identity.student._id) {
    throw createError("INVALID_RECORDING", "这份录音不属于当前学生或课程");
  }
  ensureEnglishCourseAccess(identity, identity.student);
  if (lesson.recordingTaskEnabled !== true) {
    throw createError("RECORDING_NOT_ASSIGNED", "老师尚未为这节课布置录音任务");
  }
  if (lesson.recordingTaskType === "ket_mock") {
    throw createError("KET_MOCK_REQUIRES_EXAM", "这项任务需要从 KET 全流程模拟考场完成");
  }
  if (lesson.recordingTaskType === "follow_reading") {
    throw createError("FOLLOW_READING_REQUIRES_FLOW", "这项任务需要从跟读练习页按顺序完成");
  }
  await createOneCollection("lessonSubmissions");
  const submittedAtMs = Date.now();
  const submissionId = `submission_${submittedAtMs}_${crypto.randomBytes(8).toString("hex")}`;
  const cloudPath = normalizeLessonText(data.cloudPath, 500);
  await runTransaction(async (transaction) => {
    const lessonRef = transaction.collection("lessons").doc(lessonId);
    const currentLesson = await getOptionalTransactionDocument(lessonRef);
    if (
      !currentLesson
      || currentLesson.deleting === true
      || currentLesson.studentId !== identity.student._id
      || currentLesson.recordingTaskEnabled !== true
      || ["ket_mock", "follow_reading"].includes(currentLesson.recordingTaskType)
    ) throw createError("RECORDING_NOT_ASSIGNED", "录音任务已经变化，请刷新后重新录制");
    const submission = {
      studentId: identity.student._id,
      lessonId,
      kind: "audio",
      fileID,
      fileName: normalizeLessonText(data.fileName || "student-recording.mp3", 200),
      fileSize: Math.max(0, Number(data.fileSize) || 0),
      duration,
      cloudPath: cloudPath.startsWith("lesson-submissions/") ? cloudPath : "",
      organizedVersion: cloudPath.startsWith("lesson-submissions/") ? 2 : 1,
      studentNameSnapshot: normalizeLessonText(identity.student.name || "学生", 100),
      lessonTitleSnapshot: normalizeLessonText(currentLesson.title || "英语课", 200),
      lessonDateSnapshot: normalizeLessonText(currentLesson.lessonDate, 30),
      lessonNoSnapshot: normalizeLessonText(currentLesson.lessonNo, 30),
      homeworkTaskVersion: Math.max(1, Number(currentLesson.homeworkTaskVersion) || 1),
      attemptNo: Math.max(1, Math.min(99, Math.trunc(Number(data.attemptNo)) || 1)),
      status: "待检查",
      teacherFeedback: "",
      submittedLate: courseWorkflow.isLateHomeworkSubmission(currentLesson, submittedAtMs),
      createdAt: db.serverDate(),
      createdAtMs: submittedAtMs,
    };
    await transaction.collection("lessonSubmissions").doc(submissionId).set({ data: submission });
    const existingFirstSubmittedAtMs = Number(currentLesson.homeworkFirstSubmittedAtMs) || 0;
    const firstSubmittedAtMs = existingFirstSubmittedAtMs || submittedAtMs;
    await lessonRef.update({
      data: {
        homeworkFirstSubmittedAtMs: firstSubmittedAtMs,
        homeworkLastSubmittedAtMs: submittedAtMs,
        homeworkSubmittedLate: courseWorkflow.isLateHomeworkSubmission(currentLesson, firstSubmittedAtMs),
      },
    });
  });
  const submissionTiming = await syncLessonSubmissionTimingSafely(lessonId);
  return {
    success: true,
    _id: submissionId,
    homeworkAutoCompleted: false,
    homeworkSubmittedLate: submissionTiming
      ? submissionTiming.homeworkSubmittedLate
      : courseWorkflow.isLateHomeworkSubmission(lesson, submittedAtMs),
  };
};

const organizeLessonRecordingFiles = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  const lessonId = String(data.lessonId || "").trim();
  if (!lessonId) throw createError("INVALID_LESSON", "课程信息不完整，请返回后重试");
  await createOneCollection("lessonSubmissions");
  const lessonRes = await db.collection("lessons").doc(lessonId).get();
  const lesson = lessonRes.data;
  if (!lesson) throw createError("LESSON_NOT_FOUND", "课程不存在或已删除");
  const studentRes = await db.collection("students").doc(lesson.studentId).get();
  const student = studentRes.data;
  if (!student) throw createError("INVALID_STUDENT", "学生不存在或已删除");
  const submissions = await loadAllLessonDocuments("lessonSubmissions", lessonId);
  submissions.sort((a, b) => getCreatedTime(a) - getCreatedTime(b));
  let organizedCount = 0;
  const failures = [];
  for (let index = 0; index < submissions.length; index += 1) {
    const submission = submissions[index];
    if (!submission.fileID || submission.organizedVersion === 2) continue;
    const attemptNo = index + 1;
    const cloudPath = buildReadableRecordingCloudPath({ student, lesson, submission, attemptNo });
    let newFileID = "";
    try {
      const download = await cloud.downloadFile({ fileID: submission.fileID });
      if (!download.fileContent) throw new Error("云端录音内容为空");
      const upload = await cloud.uploadFile({ cloudPath, fileContent: download.fileContent });
      newFileID = upload.fileID;
      await db.collection("lessonSubmissions").doc(submission._id).update({
        data: {
          fileID: newFileID,
          cloudPath,
          organizedVersion: 2,
          studentNameSnapshot: normalizeLessonText(student.name || "学生", 100),
          lessonTitleSnapshot: normalizeLessonText(lesson.title || "英语课", 200),
          lessonDateSnapshot: normalizeLessonText(lesson.lessonDate, 30),
          lessonNoSnapshot: normalizeLessonText(lesson.lessonNo, 30),
          attemptNo,
          organizedAt: db.serverDate(),
        },
      });
      if (newFileID !== submission.fileID) await deleteUnsafeFiles([submission.fileID]);
      organizedCount += 1;
    } catch (err) {
      console.error("organize lesson recording failed", submission._id, err);
      if (newFileID) await deleteUnsafeFiles([newFileID]);
      failures.push(submission._id);
    }
  }
  return {
    success: failures.length === 0,
    organizedCount,
    skippedCount: submissions.length - organizedCount - failures.length,
    failedCount: failures.length,
    message: failures.length ? `已整理 ${organizedCount} 条，${failures.length} 条失败` : `已整理 ${organizedCount} 条旧录音`,
  };
};

const reviewLessonRecording = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  const submissionId = String(data.submissionId || "").trim();
  const feedback = recordingFeedback.normalizeRecordingFeedback(data);
  const { status } = feedback;
  if (!submissionId) throw createError("INVALID_RECORDING", "录音信息不完整，请刷新后重试");
  await assertContentSafe({ texts: [feedback.text] });
  const reviewStartedAtMs = Date.now();
  const submission = await runTransaction(async (transaction) => {
    const submissionRef = transaction.collection("lessonSubmissions").doc(submissionId);
    const current = await getOptionalTransactionDocument(submissionRef);
    if (!current) throw createError("RECORDING_NOT_FOUND", "录音不存在或已删除");
    await submissionRef.update({
      data: {
        status,
        teacherFeedback: feedback.text,
        teacherFeedbackTags: feedback.tags,
        teacherFeedbackNote: feedback.note,
        teacherFeedbackVersion: 2,
        reviewedAt: db.serverDate(),
        reviewedAtMs: reviewStartedAtMs,
      },
    });
    return current;
  });
  if (status === "需要重录") {
    await resetCompletedHomeworkWhenNoUsableRecording(submission.lessonId, reviewStartedAtMs);
  }
  await syncLessonSubmissionTimingSafely(submission.lessonId);
  return {
    success: true,
    submissionId,
    status,
    teacherFeedback: feedback.text,
    teacherFeedbackTags: feedback.tags,
    teacherFeedbackNote: feedback.note,
  };
};

const deleteLessonRecording = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  const submissionId = String(data.submissionId || "").trim();
  const lessonId = String(data.lessonId || "").trim();
  if (!submissionId || !lessonId) {
    throw createError("INVALID_RECORDING", "录音信息不完整，请刷新后重试");
  }
  const deletionStartedAtMs = Date.now();
  const deleted = await runTransaction(async (transaction) => {
    const submissionRef = transaction.collection("lessonSubmissions").doc(submissionId);
    const [submission, lesson] = await Promise.all([
      getOptionalTransactionDocument(submissionRef),
      getOptionalTransactionDocument(transaction.collection("lessons").doc(lessonId)),
    ]);
    if (!submission) return null;
    if (!lesson || lesson.deleting === true || submission.lessonId !== lessonId || submission.studentId !== lesson.studentId) {
      throw createError("INVALID_RECORDING", "录音所属课程已经变化，请刷新后重试");
    }
    await submissionRef.remove();
    return submission;
  });
  if (!deleted) return { success: true, submissionId, alreadyDeleted: true };
  await deleteUnsafeFiles([deleted.fileID]);
  const homeworkReset = await resetCompletedHomeworkWhenNoUsableRecording(lessonId, deletionStartedAtMs);
  await syncLessonSubmissionTimingSafely(lessonId);
  return { success: true, submissionId, homeworkReset };
};

const reviewLessonHomeworkCompletion = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  const lessonId = String(data.lessonId || "").trim();
  const status = data.status === "completed"
    ? "completed"
    : data.status === "incomplete" ? "incomplete" : "";
  if (!lessonId || !status) {
    throw createError("INVALID_HOMEWORK_REVIEW", "课后任务批改信息不完整，请刷新后重试");
  }
  const reviewedAtMs = Date.now();
  const result = await runTransaction(async (transaction) => {
    const lessonRef = transaction.collection("lessons").doc(lessonId);
    const lesson = await getOptionalTransactionDocument(lessonRef);
    if (!lesson || lesson.deleting === true) {
      throw createError("LESSON_NOT_FOUND", "课程不存在或已删除");
    }
    if (!hasLessonHomework(lesson)) {
      throw createError("HOMEWORK_NOT_ASSIGNED", "这节课没有需要批改的课后任务");
    }
    if (status === "completed") {
      await lessonRef.update({
        data: Object.assign(buildHomeworkCompletedFields("teacher"), {
          homeworkCompletedAtMs: reviewedAtMs,
          homeworkTeacherReviewedAtMs: reviewedAtMs,
        }),
      });
      return { status, homeworkCompleted: true, reviewedAtMs };
    }

    const updateData = {
      homeworkCompleted: false,
      homeworkCompletedAt: null,
      homeworkCompletedAtMs: 0,
      homeworkCompletedFrom: "teacher",
      homeworkTeacherReviewStatus: "incomplete",
      homeworkTeacherReviewedAt: db.serverDate(),
      homeworkTeacherReviewedAtMs: reviewedAtMs,
      updatedAt: db.serverDate(),
    };
    if (lesson.homeworkReminderNotifyStatus === "cancelled_completed") {
      Object.assign(updateData, {
        homeworkReminderSubscribed: false,
        homeworkReminderNotifyOpenId: "",
        homeworkReminderNotifyStatus: "not_subscribed",
        homeworkReminderTargetAtMs: 0,
        homeworkReminderTargetDate: "",
        homeworkReminderTaskVersion: 0,
        homeworkReminderNotifyClaimId: "",
        homeworkReminderNotifyAttemptCount: 0,
        homeworkReminderNotifyNextAttemptAtMs: 0,
        homeworkReminderNotifyError: "",
        homeworkReminderNotifySentAt: null,
      });
    }
    await lessonRef.update({ data: updateData });
    return { status, homeworkCompleted: false, reviewedAtMs };
  });
  return { success: true, lessonId, ...result };
};

const subscribeHomeworkReminder = async (event) => {
  const identity = await getIdentity();
  if (identity.role !== "student" || !identity.student) {
    throw createError("PERMISSION_DENIED", "请在学生端开启课后任务提醒");
  }
  const data = event.data || {};
  const lessonId = String(data.lessonId || "").trim();
  if (!lessonId || data.subscribed !== true) {
    throw createError("SUBSCRIPTION_NOT_ACCEPTED", "请先允许微信课后任务提醒");
  }
  ensureEnglishCourseAccess(identity, identity.student);
  const saved = await runTransaction(async (transaction) => {
    const lessonRef = transaction.collection("lessons").doc(lessonId);
    const lesson = await getOptionalTransactionDocument(lessonRef);
    if (!lesson || lesson.studentId !== identity.student._id || lesson.deleting === true) {
      throw createError("INVALID_LESSON", "这份课后任务不属于当前学生或已删除");
    }
    if (!hasLessonHomework(lesson)) {
      throw createError("HOMEWORK_NOT_ASSIGNED", "老师尚未为这节课布置课后任务");
    }
    if (isLessonHomeworkCompleted(lesson)) {
      throw createError("HOMEWORK_COMPLETED", "课后任务已完成，本次提醒已结束");
    }
    const target = getNextHomeworkReminderTarget(lesson);
    const homeworkTaskVersion = Math.max(1, Number(lesson.homeworkTaskVersion) || 1);
    await lessonRef.update({
      data: {
        homeworkReminderSubscribed: true,
        homeworkReminderNotifyOpenId: identity.openid,
        homeworkReminderNotifyStatus: "pending",
        homeworkReminderTargetAtMs: target.targetAtMs,
        homeworkReminderTargetDate: target.targetDate,
        homeworkReminderTaskVersion: homeworkTaskVersion,
        homeworkReminderNotifyClaimId: "",
        homeworkReminderNotifyAttemptCount: 0,
        homeworkReminderNotifyNextAttemptAtMs: 0,
        homeworkReminderNotifyError: "",
        homeworkReminderNotifySentAt: null,
        updatedAt: db.serverDate(),
      },
    });
    return { ...target, homeworkTaskVersion };
  });
  return { success: true, ...saved };
};

const withoutMistakeImageFields = (mistake) => {
  if (!mistake || typeof mistake !== "object") return mistake;
  const result = Object.assign({}, mistake);
  delete result.questionImageFileId;
  delete result.questionImageUrl;
  delete result.sourceImageName;
  return result;
};

const listMistakes = async (event) => {
  const identity = await getIdentity();
  const data = event.data || {};
  const query = {};
  if (identity.role === "guest") throw createError("PERMISSION_DENIED", "请先绑定学习账号");
  if (identity.role === "student") {
    query.studentId = identity.student._id;
  } else if (data.studentId) {
    query.studentId = data.studentId;
  }
  if (data.lessonId) query.lessonId = data.lessonId;
  if (query.studentId) await ensureStudentAccess(query.studentId);
  if (query.studentId && (identity.role === "student" || data.mode === "teacherPreview")) {
    const studentRes = await db.collection("students").doc(query.studentId).get();
    if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
    ensureMistakeLearningAccess(identity, studentRes.data, data);
  }

  const mistakeCollection = db.collection("mistakes");
  const res = Object.keys(query).length
    ? await mistakeCollection.where(query).orderBy("createdAt", "desc").get()
    : await mistakeCollection.orderBy("createdAt", "desc").get();
  return {
    success: true,
    role: identity.role,
    data: (res.data || []).map(withoutMistakeImageFields),
  };
};

const getMistakeVocabularyFields = (mistake) => ({
  vocabularyCandidates: vocabulary.extractVocabularyCandidates(mistake),
  vocabularyCandidatesVersion: vocabulary.VOCABULARY_CANDIDATES_VERSION,
});

const addMistake = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  if (!data.studentId || !data.lessonId) {
    throw createError("INVALID_MISTAKE", "请选择学生和课程");
  }
  const lessonRes = await db.collection("lessons").doc(data.lessonId).get();
  if (!lessonRes.data || lessonRes.data.studentId !== data.studentId) {
    throw createError("INVALID_MISTAKE", "所选课程不属于这位学生，请重新选择");
  }
  if (!String(data.questionText || "").trim()) {
    throw createError("INVALID_MISTAKE", "请填写完整题目文字和选项");
  }
  const skillTags = normalizeTags(data.skillTags && data.skillTags.length ? data.skillTags : data.tags);
  const reviewStatus = data.reviewStatus || data.status || "待复习";
  const vocabularyWords = vocabulary.normalizeVocabularyWords(data.vocabularyWords);
  const vocabularyFields = getMistakeVocabularyFields(Object.assign({}, data, { vocabularyWords }));
  await assertContentSafe({
    texts: [
      data.questionNo,
      data.paperSection,
      data.questionType,
      data.mistakeReasonType,
      data.studentAnswer,
      data.correctAnswer,
      data.explanation,
      data.reason,
      data.questionText,
      skillTags,
      vocabularyWords.map((item) => [item.word, item.meaning, item.partOfSpeech]),
    ],
  });
  const mistakeId = `mistake_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
  const mistakeData = {
    studentId: data.studentId,
    lessonId: data.lessonId,
    paperId: data.paperId || "",
    questionNo: data.questionNo || "",
    paperSection: data.paperSection || "",
    questionType: data.questionType || "",
    skillTags,
    mistakeReasonType: data.mistakeReasonType || "",
    studentAnswer: data.studentAnswer || "",
    correctAnswer: data.correctAnswer || "",
    explanation: data.explanation || "",
    reason: data.reason || data.mistakeReasonType || "",
    tags: skillTags,
    reviewStatus,
    reviewPriority: data.reviewPriority || "中",
    reviewCount: 0,
    questionText: data.questionText || "",
    entryStatus: data.entryStatus || (data.studentAnswer && data.correctAnswer ? "已整理" : "待整理"),
    status: reviewStatus,
    vocabularyWords,
    vocabularyCandidates: vocabularyFields.vocabularyCandidates,
    vocabularyCandidatesVersion: vocabularyFields.vocabularyCandidatesVersion,
    createdAt: db.serverDate(),
  };
  return await runTransaction(async (transaction) => {
    await getWritableLessonInTransaction(
      transaction,
      data.lessonId,
      data.studentId,
      "INVALID_MISTAKE"
    );
    await transaction.collection("mistakes").doc(mistakeId).set({ data: mistakeData });
    return { _id: mistakeId };
  });
};

const updateMistake = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  if (!data.mistakeId || !data.studentId || !data.lessonId) {
    throw createError("INVALID_MISTAKE", "错题信息不完整，请返回后重试");
  }
  if (!String(data.questionText || "").trim()) {
    throw createError("INVALID_MISTAKE", "请填写完整题目文字和选项");
  }
  const existingRes = await db.collection("mistakes").doc(data.mistakeId).get();
  if (!existingRes.data) throw createError("MISTAKE_NOT_FOUND", "错题不存在或已删除");
  const lessonRes = await db.collection("lessons").doc(data.lessonId).get();
  if (!lessonRes.data || lessonRes.data.studentId !== data.studentId) {
    throw createError("INVALID_MISTAKE", "所选课程不属于这位学生，请重新选择");
  }
  const skillTags = normalizeTags(data.skillTags && data.skillTags.length ? data.skillTags : data.tags);
  const reviewStatus = data.reviewStatus || data.status || "待复习";
  const vocabularyWords = vocabulary.normalizeVocabularyWords(
    Object.prototype.hasOwnProperty.call(data, "vocabularyWords")
      ? data.vocabularyWords
      : existingRes.data.vocabularyWords
  );
  const vocabularyFields = getMistakeVocabularyFields(Object.assign({}, data, { vocabularyWords }));
  await assertContentSafe({
    texts: [
      data.questionNo,
      data.paperSection,
      data.questionType,
      data.mistakeReasonType,
      data.studentAnswer,
      data.correctAnswer,
      data.explanation,
      data.reason,
      data.questionText,
      skillTags,
      vocabularyWords.map((item) => [item.word, item.meaning, item.partOfSpeech]),
    ],
  });
  const mistakeUpdateData = {
    studentId: data.studentId,
    lessonId: data.lessonId,
    paperId: data.paperId || "",
    questionNo: data.questionNo || "",
    paperSection: data.paperSection || "",
    questionType: data.questionType || "",
    skillTags,
    mistakeReasonType: data.mistakeReasonType || "",
    studentAnswer: data.studentAnswer || "",
    correctAnswer: data.correctAnswer || "",
    explanation: data.explanation || "",
    reason: data.reason || data.mistakeReasonType || "",
    tags: skillTags,
    reviewStatus,
    reviewPriority: data.reviewPriority || "中",
    questionText: data.questionText || "",
    entryStatus: data.entryStatus || (data.studentAnswer && data.correctAnswer ? "已整理" : "待整理"),
    status: reviewStatus,
    vocabularyWords,
    vocabularyCandidates: vocabularyFields.vocabularyCandidates,
    vocabularyCandidatesVersion: vocabularyFields.vocabularyCandidatesVersion,
    updatedAt: db.serverDate(),
  };
  await runTransaction(async (transaction) => {
    const mistakeRef = transaction.collection("mistakes").doc(data.mistakeId);
    const [currentMistake] = await Promise.all([
      getOptionalTransactionDocument(mistakeRef),
      getWritableLessonInTransaction(
        transaction,
        data.lessonId,
        data.studentId,
        "INVALID_MISTAKE"
      ),
    ]);
    if (!currentMistake) throw createError("MISTAKE_NOT_FOUND", "错题不存在或已删除");
    if (currentMistake.lessonId && currentMistake.lessonId !== data.lessonId) {
      const sourceLesson = await getOptionalTransactionDocument(
        transaction.collection("lessons").doc(currentMistake.lessonId)
      );
      if (sourceLesson && sourceLesson.deleting === true) {
        throw createError("INVALID_MISTAKE", "原课程正在删除，请刷新后再试");
      }
    }
    await mistakeRef.update({ data: mistakeUpdateData });
  });
  return { success: true };
};

const runMistakeImportTransaction = async (transactionCallback, importItemIndex) => {
  try {
    return await runTransactionWithRetry(
      () => db.runTransaction(transactionCallback),
      {
        retryDelaysMs: [200, 500, 1000],
        onRetry: ({ attempt, maxAttempts, waitMs, error }) => {
          console.warn("batch mistake import transaction busy; retrying", {
            importItemIndex,
            attempt,
            maxAttempts,
            waitMs,
            message: (error && (error.errMsg || error.message)) || "",
          });
        },
      }
    );
  } catch (err) {
    if (!isTransactionBusyError(err)) throw err;
    throw createError(
      "TRANSACTION_BUSY",
      "云数据库暂时繁忙，已自动重试，请稍后重新导入；已写入错题会按批次去重"
    );
  }
};

const batchImportMistakes = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  const items = Array.isArray(data.items) ? data.items : [];
  const importBatchId = String(data.importBatchId || "").trim();
  const importItemOffset = Number(data.importItemOffset || 0);
  if (!data.studentId || !data.lessonId) {
    throw createError("INVALID_MISTAKE", "学生或课程信息不完整，请重新选择");
  }
  if (!items.length || items.length > 50) {
    throw createError("INVALID_IMPORT", "每次可导入 1～50 道错题");
  }
  if (!importBatchId || importBatchId.length > 100) {
    throw createError("INVALID_IMPORT", "导入信息已失效，请重新粘贴后再试");
  }
  if (!Number.isInteger(importItemOffset) || importItemOffset < 0 || importItemOffset + items.length > 50) {
    throw createError("INVALID_IMPORT", "导入信息已失效，请重新粘贴后再试");
  }
  const lessonRes = await db.collection("lessons").doc(data.lessonId).get();
  if (!lessonRes.data || lessonRes.data.studentId !== data.studentId) {
    throw createError("INVALID_IMPORT", "所选课程不属于这位学生，请重新选择");
  }
  const safeItems = items.map((item) => {
    const source = item || {};
    const skillTags = normalizeTags(source.skillTags && source.skillTags.length ? source.skillTags : source.tags);
    const studentAnswer = String(source.studentAnswer || "").trim();
    const correctAnswer = String(source.correctAnswer || "").trim();
    const safeItem = {
      paperId: source.paperId || data.paperId || "",
      questionNo: String(source.questionNo || "").trim(),
      paperSection: String(source.paperSection || "").trim(),
      questionType: String(source.questionType || "").trim(),
      questionText: String(source.questionText || "").trim(),
      sourcePage: String(source.sourcePage || "").trim(),
      skillTags,
      vocabularyWords: vocabulary.normalizeVocabularyWords(source.vocabularyWords),
      mistakeReasonType: String(source.mistakeReasonType || "").trim(),
      studentAnswer,
      correctAnswer,
      explanation: String(source.explanation || "").trim(),
      reason: String(source.reason || source.mistakeReasonType || "").trim(),
      reviewStatus: ["待复习", "已复习", "已掌握"].indexOf(source.reviewStatus) >= 0 ? source.reviewStatus : "待复习",
      reviewPriority: ["高", "中", "低"].indexOf(source.reviewPriority) >= 0 ? source.reviewPriority : "中",
      entryStatus: studentAnswer && correctAnswer ? "已整理" : "待整理",
    };
    return Object.assign(safeItem, getMistakeVocabularyFields(safeItem));
  });
  const emptyIndex = safeItems.findIndex((item) => !item.questionText);
  if (emptyIndex >= 0) {
    throw createError("INVALID_IMPORT", `第 ${importItemOffset + emptyIndex + 1} 道错题缺少完整题目文字和选项`);
  }
  await checkTeacherImportContent(safeItems, importItemOffset);
  const existingImportRes = await db.collection("mistakes").where({
    importBatchId,
    studentId: data.studentId,
    lessonId: data.lessonId,
  }).limit(100).get();
  const existingItemsByIndex = new Map(
    (existingImportRes.data || []).map((item) => [Number(item.importItemIndex), item])
  );
  let addedCount = 0;
  let skippedCount = 0;
  for (let i = 0; i < safeItems.length; i++) {
    const item = safeItems[i];
    const importItemIndex = importItemOffset + i;
    const existingItem = existingItemsByIndex.get(importItemIndex);
    if (existingItem) {
      const existingResult = await runMistakeImportTransaction(async (transaction) => {
        const existingRef = transaction.collection("mistakes").doc(existingItem._id);
        const [current] = await Promise.all([
          getOptionalTransactionDocument(existingRef),
          getWritableLessonInTransaction(
            transaction,
            data.lessonId,
            data.studentId,
            "INVALID_IMPORT"
          ),
        ]);
        if (!current) return { missing: true };
        const needsVocabularyBackfill =
          Number(current.vocabularyCandidatesVersion) !== vocabulary.VOCABULARY_CANDIDATES_VERSION
          || !Array.isArray(current.vocabularyCandidates);
        const updateData = {};
        if (needsVocabularyBackfill) {
          updateData.vocabularyWords = item.vocabularyWords;
          updateData.vocabularyCandidates = item.vocabularyCandidates;
          updateData.vocabularyCandidatesVersion = item.vocabularyCandidatesVersion;
        }
        const hasUpdates = Object.keys(updateData).length > 0;
        if (hasUpdates) {
          updateData.updatedAt = db.serverDate();
          await existingRef.update({ data: updateData });
        }
        return {
          missing: false,
          skipped: !hasUpdates,
        };
      }, importItemIndex);
      if (!existingResult.missing) {
        if (existingResult.skipped) skippedCount += 1;
        continue;
      }
    }
    const importDocumentId = `import_${crypto.createHash("sha1")
      .update(`${data.studentId}\n${data.lessonId}\n${importBatchId}\n${importItemIndex}`)
      .digest("hex")}`;
    const importData = {
        studentId: data.studentId,
        lessonId: data.lessonId,
        paperId: item.paperId,
        questionNo: item.questionNo,
        paperSection: item.paperSection,
        questionType: item.questionType,
        questionText: item.questionText,
        sourcePage: item.sourcePage,
        skillTags: item.skillTags,
        mistakeReasonType: item.mistakeReasonType,
        studentAnswer: item.studentAnswer,
        correctAnswer: item.correctAnswer,
        explanation: item.explanation,
        reason: item.reason,
        tags: item.skillTags,
        reviewStatus: item.reviewStatus,
        reviewPriority: item.reviewPriority,
        reviewCount: 0,
        entryStatus: item.entryStatus,
        status: item.reviewStatus,
        importBatchId,
        importItemIndex,
        vocabularyWords: item.vocabularyWords,
        vocabularyCandidates: item.vocabularyCandidates,
        vocabularyCandidatesVersion: item.vocabularyCandidatesVersion,
        createdAt: db.serverDate(),
      };
    const upsertResult = await runMistakeImportTransaction(async (transaction) => {
      const ref = transaction.collection("mistakes").doc(importDocumentId);
      const [current] = await Promise.all([
        getOptionalTransactionDocument(ref),
        getWritableLessonInTransaction(
          transaction,
          data.lessonId,
          data.studentId,
          "INVALID_IMPORT"
        ),
      ]);
      if (!current) {
        await ref.set({ data: importData });
        return { created: true, skipped: false };
      }
      const needsVocabularyBackfill =
        Number(current.vocabularyCandidatesVersion) !== vocabulary.VOCABULARY_CANDIDATES_VERSION
        || !Array.isArray(current.vocabularyCandidates);
      const updateData = {};
      if (needsVocabularyBackfill) {
        updateData.vocabularyWords = item.vocabularyWords;
        updateData.vocabularyCandidates = item.vocabularyCandidates;
        updateData.vocabularyCandidatesVersion = item.vocabularyCandidatesVersion;
      }
      const hasUpdates = Object.keys(updateData).length > 0;
      if (hasUpdates) {
        updateData.updatedAt = db.serverDate();
        await ref.update({ data: updateData });
      }
      return {
        created: false,
        skipped: !hasUpdates,
      };
    }, importItemIndex);
    if (upsertResult.created) addedCount += 1;
    if (upsertResult.skipped) skippedCount += 1;
  }
  return {
    success: true,
    importedCount: safeItems.length,
    addedCount,
    skippedCount,
  };
};

const updateMistakeReviewStatus = async (event) => {
  const data = event.data || {};
  const mistakeId = data.mistakeId;
  const reviewStatus = data.reviewStatus;
  if (!mistakeId || ["待复习", "已复习", "已掌握"].indexOf(reviewStatus) < 0) {
    throw createError("INVALID_MISTAKE", "请选择复习状态");
  }
  const identity = await getIdentity();
  if (identity.role === "guest") throw createError("PERMISSION_DENIED", "请先绑定学习账号");
  const res = await db.collection("mistakes").doc(mistakeId).get();
  if (!res.data) throw createError("MISTAKE_NOT_FOUND", "错题不存在或已删除");
  await ensureStudentAccess(res.data.studentId);
  if (identity.role === "student") {
    const studentRes = await db.collection("students").doc(res.data.studentId).get();
    if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
    ensureMistakeLearningAccess(identity, studentRes.data, data);
  }
  const authorizedStudentId = res.data.studentId;
  const reviewCount = await runTransaction(async (transaction) => {
    const ref = transaction.collection("mistakes").doc(mistakeId);
    const currentRes = await ref.get();
    const current = currentRes.data;
    if (!current) throw createError("MISTAKE_NOT_FOUND", "错题不存在或已删除");
    if (current.studentId !== authorizedStudentId) {
      throw createError("PERMISSION_DENIED", "错题信息已更新，请刷新后再试");
    }
    if (getReviewStatus(current) === reviewStatus) {
      return Number(current.reviewCount || 0);
    }
    const nextReviewCount = Number(current.reviewCount || 0) + 1;
    await ref.update({
      data: {
        reviewStatus,
        status: reviewStatus,
        reviewCount: nextReviewCount,
        lastReviewedAt: db.serverDate(),
      },
    });
    return nextReviewCount;
  });
  return {
    success: true,
    reviewStatus,
    reviewCount,
  };
};

const getMistakeDetail = async (event) => {
  const mistakeId = event.data && event.data.mistakeId;
  if (!mistakeId) throw createError("INVALID_MISTAKE", "错题信息不完整，请返回后重试");
  const identity = await getIdentity();
  if (identity.role === "guest") throw createError("PERMISSION_DENIED", "请先绑定学习账号");

  const res = await db.collection("mistakes").doc(mistakeId).get();
  if (!res.data) throw createError("MISTAKE_NOT_FOUND", "错题不存在或已删除");
  await ensureStudentAccess(res.data.studentId);
  if (identity.role === "student") {
    const studentRes = await db.collection("students").doc(res.data.studentId).get();
    if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
    ensureMistakeLearningAccess(identity, studentRes.data, event.data || {});
  }
  const hydratedMistake = Object.assign({}, res.data, {
    reviewStatus: getReviewStatus(res.data),
    status: getReviewStatus(res.data),
    questionType: res.data.questionType || UNCATEGORIZED_LABEL,
    paperSection: res.data.paperSection || UNCATEGORIZED_LABEL,
    skillTags: normalizeTags(res.data.skillTags && res.data.skillTags.length ? res.data.skillTags : res.data.tags),
    reviewPriority: res.data.reviewPriority || "中",
  });
  return {
    success: true,
    role: identity.role,
    mistake: withoutMistakeImageFields(hydratedMistake),
  };
};

const deleteMistake = async (event) => {
  await ensureTeacher();
  const mistakeId = event.data && event.data.mistakeId;
  if (!mistakeId) throw createError("INVALID_MISTAKE", "错题信息不完整，请返回后重试");
  const res = await db.collection("mistakes").doc(mistakeId).get();
  if (!res.data) throw createError("MISTAKE_NOT_FOUND", "错题不存在或已删除");
  await db.collection("mistakes").doc(mistakeId).remove();
  return { success: true };
};

const ketMockService = createKetMockService({
  db,
  cloud,
  courseWorkflow,
  createError,
  createOneCollection,
  deleteUnsafeFiles,
  ensureEnglishCourseAccess,
  ensureStudentAccess,
  ensureTeacher,
  getIdentity,
  getOptionalTransactionDocument,
  assertContentSafe,
});

const followReadingService = createFollowReadingService({
  db,
  cloud,
  courseWorkflow,
  createError,
  createOneCollection,
  deleteUnsafeFiles,
  ensureEnglishCourseAccess,
  ensureStudentAccess,
  ensureTeacher,
  getIdentity,
  getOptionalTransactionDocument,
});

const weeklyScheduleService = createWeeklyScheduleService({
  db,
  createError,
  createOneCollection,
  getIdentity,
  getOptionalTransactionDocument,
  assertContentSafe,
});

const mistakeExportService = createMistakeExportService({
  db,
  cloud,
  createError,
  createOneCollection,
  ensureTeacher,
  getOptionalTransactionDocument,
});

exports.main = async (event) => {
  try {
    switch (event.type) {
      case "getOpenId":
        return await getOpenId();
      case "getMiniProgramCode":
        return await getMiniProgramCode();
      case "initCollections":
      case "createCollection":
        return await initCollections();
      case "getHomeData":
        return await getHomeData(event);
      case "getWeeklySchedule":
        return await weeklyScheduleService.getWeeklySchedule(event);
      case "createScheduleBooking":
        return await weeklyScheduleService.createScheduleBooking(event);
      case "saveTeacherScheduleBlock":
        return await weeklyScheduleService.saveTeacherScheduleBlock(event);
      case "updateScheduleEvent":
        return await weeklyScheduleService.updateScheduleEvent(event);
      case "cancelScheduleEvent":
        return await weeklyScheduleService.cancelScheduleEvent(event);
      case "setScheduleDayAvailability":
        return await weeklyScheduleService.setScheduleDayAvailability(event);
      case "setFixedStudentScheduleEnabled":
        return await weeklyScheduleService.setFixedStudentScheduleEnabled(event);
      case "saveFixedStudentSchedule":
        return await weeklyScheduleService.saveFixedStudentSchedule(event);
      case "markHomeworkActivitiesViewed":
      case "markLearningActivitiesViewed":
        return await markHomeworkActivitiesViewed(event);
      case "markStudentLearningActivitiesViewed":
        return await markStudentLearningActivitiesViewed(event);
      case "getTeacherLearningAlerts":
        return await getTeacherLearningAlerts();
      case "getTeacherTodos":
        return await getTeacherTodos();
      case "listStudentReminders":
        return await listStudentReminders(event);
      case "saveStudentReminder":
        return await saveStudentReminder(event);
      case "withdrawStudentReminder":
        return await withdrawStudentReminder(event);
      case "getStudentEngagement":
        return await getStudentEngagement(event);
      case "getTeacherEngagementManager":
        return await getTeacherEngagementManager();
      case "saveStudentPkEligibility":
        return await saveStudentPkEligibility(event);
      case "savePkChallengeProfile":
        return await savePkChallengeProfile(event);
      case "deletePkChallengeProfile":
        return await deletePkChallengeProfile(event);
      case "bindStudent":
      case "bindAccessCode":
        return await bindAccessCode(event);
      case "unbindIdentity":
        return await unbindIdentity();
      case "listStudents":
      case "selectRecord":
        return await listStudents(event);
      case "setStudentVisibility":
        return await setStudentVisibility(event);
      case "addStudent":
        return await addStudent(event);
      case "seedStudents":
        return await seedStudents();
      case "updateStudentProgress":
        return await updateStudentProgress(event);
      case "updateVocabularySettings":
        return await updateVocabularySettings(event);
      case "setMistakeLearningSettings":
        return await setMistakeLearningSettings(event);
      case "setEnglishCourseSettings":
        return await setEnglishCourseSettings(event);
      case "setStudentLessonTemplate":
        return await setStudentLessonTemplate(event);
      case "getStudentLearningRadar":
        return await getStudentLearningRadar(event);
      case "updateStudentLearningPlan":
        return await updateStudentLearningPlan(event);
      case "setVocabularyDailyGoal":
        return await setVocabularyDailyGoal(event);
      case "getVocabularyData":
        return await getVocabularyData(event);
      case "getEnglishMemoryEvaluation":
        return await getEnglishMemoryEvaluation(event);
      case "updateEnglishMemoryCalibration":
        return await updateEnglishMemoryCalibration(event);
      case "getVocabularyCatalog":
        return await getVocabularyCatalog(event);
      case "reviewVocabularyWord":
        return await reviewVocabularyWord(event);
      case "reviewVocabularyQuizAnswer":
        return await reviewVocabularyQuizAnswer(event);
      case "completeVocabularyQuiz":
        return await completeVocabularyQuiz(event);
      case "updateVocabularyWord":
        return await updateVocabularyWord(event);
      case "getFrenchLearningOverview":
        return await frenchLearningService.getOverview(event);
      case "getFrenchWords":
        return await frenchLearningService.getWords(event);
      case "getFrenchReviewQueue":
        return await frenchLearningService.getReviewQueue(event);
      case "reviewFrenchWord":
        return await frenchLearningService.reviewWord(event);
      case "getFrenchWordMemory":
        return await frenchLearningService.getWordMemory(event);
      case "getFrenchDashboard":
        return await frenchLearningService.getDashboard(event);
      case "getFrenchGrammar":
        return await frenchLearningService.getGrammar(event);
      case "getFrenchExpressions":
        return await frenchLearningService.getExpressions(event);
      case "getFrenchReadings":
        return await frenchLearningService.getReadings(event);
      case "getFrenchWritingActivities":
        return await frenchLearningService.getWritingActivities(event);
      case "completeFrenchActivity":
        return await frenchLearningService.completeActivity(event);
      case "getFrenchSentences":
        return await frenchLearningService.getSentences(event);
      case "completeFrenchSentence":
        return await frenchLearningService.completeSentence(event);
      case "getFrenchAudioUrl":
        return await frenchLearningService.getAudioUrl(event);
      case "setFrenchLearningSettings":
        return await frenchLearningService.setSettings(event);
      case "updateFrenchLearningPreferences":
        return await frenchLearningService.updatePreferences(event);
      case "getStudentDetail":
        return await getStudentDetail(event);
      case "listStudentHomework":
        return await listStudentHomework(event);
      case "listKetSpeakingTasks":
        return await listKetSpeakingTasks();
      case "getKetWeeklyStatus":
        return await getKetWeeklyStatus(event);
      case "getKetMockLibrary":
        return await ketMockService.listLibrary();
      case "saveKetMockCueAudio":
        return await ketMockService.saveCueAudio(event);
      case "deleteKetMockCueAudio":
        return await ketMockService.deleteCueAudio(event);
      case "getKetMockExam":
        return await ketMockService.getExam(event);
      case "startKetMockSession":
        return await ketMockService.startSession(event);
      case "abortKetMockSession":
        return await ketMockService.abortSession(event);
      case "completeKetMockSession":
        return await ketMockService.completeSession(event);
      case "listKetMockSessions":
        return await ketMockService.listSessions(event);
      case "getKetMockSessionDetail":
        return await ketMockService.getSessionDetail(event);
      case "reviewKetMockSession":
        return await ketMockService.reviewSession(event);
      case "getFollowReadingAudioManager":
        return await followReadingService.getAudioManager(event);
      case "saveFollowReadingDemoAudio":
        return await followReadingService.saveDemoAudio(event);
      case "deleteFollowReadingDemoAudio":
        return await followReadingService.deleteDemoAudio(event);
      case "getFollowReadingPractice":
        return await followReadingService.getPractice(event);
      case "submitFollowReadingBatch":
        return await followReadingService.submitBatch(event);
      case "getStudentAnalytics":
        return await getStudentAnalytics(event);
      case "listLessons":
        return await listLessons(event);
      case "getNextLessonNo":
        return await getNextLessonNo(event);
      case "addLesson":
        return await addLesson(event);
      case "updateLessonWorkspace":
        return await updateLessonWorkspace(event);
      case "deleteLesson":
        return await deleteLesson(event);
      case "getLessonDetail":
        return await getLessonDetail(event);
      case "addPaper":
        return await addPaper(event);
      case "updatePaper":
        return await updatePaper(event);
      case "deletePaper":
        return await deletePaper(event);
      case "deleteLessonPapers":
        return await deleteLessonPapers(event);
      case "replacePaperFile":
        return await replacePaperFile(event);
      case "submitLessonRecording":
        return await submitLessonRecording(event);
      case "organizeLessonRecordingFiles":
        return await organizeLessonRecordingFiles(event);
      case "reviewLessonRecording":
        return await reviewLessonRecording(event);
      case "deleteLessonRecording":
        return await deleteLessonRecording(event);
      case "reviewLessonHomeworkCompletion":
        return await reviewLessonHomeworkCompletion(event);
      case "subscribeHomeworkReminder":
        return await subscribeHomeworkReminder(event);
      case "listMistakes":
        return await listMistakes(event);
      case "getMistakeExportWorkspace":
        return await mistakeExportService.getMistakeExportWorkspace(event);
      case "createMistakeExport":
        return await mistakeExportService.createMistakeExport(event);
      case "addMistake":
        return await addMistake(event);
      case "updateMistake":
        return await updateMistake(event);
      case "batchImportMistakes":
        return await batchImportMistakes(event);
      case "getMistakeDetail":
        return await getMistakeDetail(event);
      case "updateMistakeReviewStatus":
        return await updateMistakeReviewStatus(event);
      case "deleteMistake":
        return await deleteMistake(event);
      default:
        return {
          success: false,
          code: "UNKNOWN_TYPE",
          message: "请刷新页面后重试该操作",
        };
    }
  } catch (err) {
    if (isTransactionBusyError(err)) {
      console.error("transaction busy after retries", event && event.type, err);
      return {
        success: false,
        code: "TRANSACTION_BUSY",
        message: "云数据库暂时繁忙，已自动重试，请稍后再点一次",
      };
    }
    const message = String(err && err.message || "");
    // 云数据库原始报错（英文、含错误码）只写日志，不直接展示给老师和学生。
    if (/(?:document|collection|database|transaction)\.?\w*:fail|DATABASE_/i.test(message)) {
      console.error("database error", event && event.type, err);
      return {
        success: false,
        code: err.code || "DATABASE_ERROR",
        message: "保存或读取遇到问题，请稍后重试",
      };
    }
    return {
      success: false,
      code: err.code || "SERVER_ERROR",
      message: message || "服务暂时不可用",
    };
  }
};
