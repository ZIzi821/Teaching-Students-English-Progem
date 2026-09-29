const cloud = require("wx-server-sdk");
const crypto = require("crypto");
const appConfig = require("./config");
const vocabulary = require("./vocabulary");
const frenchLearning = require("./frenchLearning");
const KET_SPEAKING_TASKS = require("./data/ket-speaking-tasks.json");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const COLLECTIONS = [
  "students",
  "teachers",
  "lessons",
  "papers",
  "mistakes",
  "vocabularyProgress",
  "vocabularyDailyStats",
  "frenchLearningProgress",
  "lessonSubmissions",
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

const checkImageFile = async (fileID) => {
  if (!fileID) return;
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

const deleteUnreferencedMistakeFiles = async (fileIDs) => {
  const candidates = uniqueValues((fileIDs || []).filter((fileID) => fileID));
  const unreferenced = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const fileID = candidates[index];
    const referenceRes = await db
      .collection("mistakes")
      .where({ questionImageFileId: fileID })
      .limit(1)
      .get();
    if (!(referenceRes.data || []).length) unreferenced.push(fileID);
  }
  await deleteUnsafeFiles(unreferenced);
};

const assertContentSafe = async ({ texts, imageFileIds }) => {
  await checkTextContent(texts);
  const fileIDs = uniqueValues((imageFileIds || []).filter((fileID) => fileID));
  for (let i = 0; i < fileIDs.length; i++) {
    await checkImageFile(fileIDs[i]);
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
  const hasPlan = progress.plannedLessonCount > 0;
  const isReviewPhase = hasPlan && progress.completedLessonCount >= progress.plannedLessonCount;
  return {
    hasPlan,
    isReviewPhase,
    label: !hasPlan ? "还没设置总课时" : isReviewPhase ? "本轮课程已完成，可以开始复习了" : "课程进行中",
    nextAction: !hasPlan ? "设置总课时" : isReviewPhase ? "开始复习" : `继续第 ${progress.completedLessonCount + 1} 节课`,
  };
};

const toNonNegativeNumber = (value, fieldName) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num < 0) {
    throw createError("INVALID_PROGRESS", `${fieldName} 必须是非负数字`);
  }
  return num;
};

const attachQuestionImageUrl = async (mistake) => {
  if (!mistake || !mistake.questionImageFileId) return mistake;
  try {
    const res = await cloud.getTempFileURL({
      fileList: [mistake.questionImageFileId],
    });
    const file = res.fileList && res.fileList[0];
    if (!file || file.status !== 0 || !file.tempFileURL) return mistake;
    return Object.assign({}, mistake, {
      questionImageUrl: file.tempFileURL,
    });
  } catch (err) {
    console.error("get question image temp url failed", err);
    return mistake;
  }
};

const buildProgress = (student) => {
  const plannedRaw = Number(student.plannedLessonCount || 0);
  const completedRaw = Number(student.completedLessonCount || 0);
  const plannedLessonCount = Number.isFinite(plannedRaw) && plannedRaw > 0 ? plannedRaw : 0;
  const completedLessonCount = Number.isFinite(completedRaw) && completedRaw > 0 ? completedRaw : 0;
  const progressPercent = plannedLessonCount ? Math.min(100, Math.round((completedLessonCount / plannedLessonCount) * 100)) : 0;
  return {
    plannedLessonCount,
    completedLessonCount,
    progressPercent,
    progressText: `${completedLessonCount} / ${plannedLessonCount}`,
  };
};

const summarizeProgress = (students) => {
  let plannedLessonCount = 0;
  let completedLessonCount = 0;
  students.forEach((student) => {
    const progress = buildProgress(student);
    plannedLessonCount += progress.plannedLessonCount;
    completedLessonCount += progress.completedLessonCount;
  });
  const progressPercent = plannedLessonCount ? Math.min(100, Math.round((completedLessonCount / plannedLessonCount) * 100)) : 0;
  return {
    plannedLessonCount,
    completedLessonCount,
    progressPercent,
    progressText: `${completedLessonCount} / ${plannedLessonCount}`,
  };
};

const buildStudentProgressItem = (student) => {
  const safeStudent = sanitizeStudent(student, false);
  const hasPlannedLessonCount = safeStudent.plannedLessonCount > 0;
  return {
    _id: safeStudent._id,
    name: safeStudent.name,
    grade: safeStudent.grade,
    plannedLessonCount: safeStudent.plannedLessonCount,
    completedLessonCount: safeStudent.completedLessonCount,
    progressPercent: safeStudent.progressPercent,
    hasPlannedLessonCount,
    progressLabel: hasPlannedLessonCount
      ? `已上 ${safeStudent.completedLessonCount} / ${safeStudent.plannedLessonCount} 节`
      : `已上 ${safeStudent.completedLessonCount} 节，总课时未设置`,
  };
};

const getStudentLessonCount = async (studentId) => {
  const res = await db.collection("lessons").where({ studentId }).count();
  return res.total || 0;
};

const getEffectiveCompletedLessonCount = (student, lessonCount) => {
  const storedRaw = Number(student && student.completedLessonCount ? student.completedLessonCount : 0);
  const storedCount = Number.isFinite(storedRaw) && storedRaw > 0 ? storedRaw : 0;
  const countedRaw = Number(lessonCount || 0);
  const countedCount = Number.isFinite(countedRaw) && countedRaw > 0 ? countedRaw : 0;
  const hasRecordedSnapshot = student
    && Object.prototype.hasOwnProperty.call(student, "recordedLessonCount")
    && Number.isFinite(Number(student.recordedLessonCount));
  if (hasRecordedSnapshot) {
    const previousRecordedCount = Math.max(0, Number(student.recordedLessonCount) || 0);
    return Math.max(0, countedCount, storedCount + countedCount - previousRecordedCount);
  }
  return Math.max(storedCount, countedCount);
};

const attachSyncedLessonCount = async (student) => {
  if (!student || !student._id) return student;
  const recordedLessonCount = await getStudentLessonCount(student._id);
  const completedLessonCount = getEffectiveCompletedLessonCount(student, recordedLessonCount);
  return Object.assign({}, student, { completedLessonCount, recordedLessonCount });
};

const attachSyncedLessonCounts = async (students) => {
  return await Promise.all((students || []).map((student) => attachSyncedLessonCount(student)));
};

const syncStudentCompletedLessonCount = async (studentId) => {
  const recordedLessonCount = await getStudentLessonCount(studentId);
  const studentRes = await db.collection("students").doc(studentId).get();
  const completedLessonCount = getEffectiveCompletedLessonCount(studentRes.data, recordedLessonCount);
  await db.collection("students").doc(studentId).update({
    data: {
      completedLessonCount,
      recordedLessonCount,
    },
  });
  return completedLessonCount;
};

const ensureStudentLessonCountSnapshot = async (studentId) => {
  const studentRes = await db.collection("students").doc(studentId).get();
  if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
  if (
    Object.prototype.hasOwnProperty.call(studentRes.data, "recordedLessonCount")
    && Number.isFinite(Number(studentRes.data.recordedLessonCount))
  ) {
    return studentRes.data;
  }
  const recordedLessonCount = await getStudentLessonCount(studentId);
  const completedLessonCount = getEffectiveCompletedLessonCount(studentRes.data, recordedLessonCount);
  await db.collection("students").doc(studentId).update({
    data: {
      completedLessonCount,
      recordedLessonCount,
    },
  });
  return Object.assign({}, studentRes.data, { completedLessonCount, recordedLessonCount });
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

const LESSON_TEMPLATE_KEYS = ["general", "feng_beginner", "molly_oral_ket"];

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
    vocabularySettings,
    vocabularyDailyPlan: vocabulary.normalizeVocabularyDailyPlan(
      student.vocabularyDailyPlan,
      vocabularySettings.dailyGoal
    ),
  };
  Object.assign(result, buildProgress(student));
  if (includePrivate) {
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
    throw createError("PERMISSION_DENIED", "仅教师端可操作");
  }
  return identity;
};

const ensureStudentAccess = async (studentId) => {
  const identity = await getIdentity();
  if (identity.role === "teacher") return identity;
  if (identity.role === "student" && identity.student && identity.student._id === studentId) return identity;
  throw createError("PERMISSION_DENIED", "你只能查看自己绑定的学习数据");
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
  const [mistakeCount, recentLessonRes, todayStats] = await Promise.all([
    mistakeLearningEnabled
      ? db.collection("mistakes").where({ studentId }).count()
      : Promise.resolve({ total: 0 }),
    englishCourseEnabled
      ? db.collection("lessons").where({ studentId }).orderBy("lessonDate", "desc").limit(20).get()
      : Promise.resolve({ data: [] }),
    syncedStudent.vocabularyEnabled === true
      ? loadAllVocabularyDocuments("vocabularyDailyStats", { studentId, learningDay })
      : Promise.resolve([]),
  ]);
  const progress = buildProgress(syncedStudent);
  const studentLessons = (recentLessonRes.data || []).map(withTeacherConfirmedHomeworkState);
  const homeworkLessons = studentLessons.filter(hasLessonHomework);
  const pendingHomeworkLessons = homeworkLessons.filter((lesson) => !isLessonHomeworkCompleted(lesson));
  return {
    success: true,
    role: identity.role,
    isTeacherPreview: options.isTeacherPreview === true,
    readOnly: options.isTeacherPreview === true,
    openid: identity.openid,
    teacherName: appConfig.teacherName,
    currentStudent: sanitizeStudent(syncedStudent, false),
    vocabularyPulse: buildVocabularyTodayPulse(syncedStudent, todayStats[0]),
    canShowStudentCount: false,
    stats: {
      mistakeCount: mistakeCount.total,
      progress,
    },
    recentLessons: studentLessons.slice(0, 3),
    pendingHomework: pendingHomeworkLessons[0] || null,
    homeworkSummary: {
      pendingCount: pendingHomeworkLessons.length,
      completedCount: homeworkLessons.length - pendingHomeworkLessons.length,
      totalCount: homeworkLessons.length,
    },
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
  if (identity.role !== "guest") await createOneCollection("vocabularyDailyStats");
  const data = event.data || {};
  const isTeacherPreview = data.mode === "teacherPreview";
  if (isTeacherPreview) {
    if (identity.role !== "teacher") {
      throw createError("PERMISSION_DENIED", "仅教师端可使用学生视角");
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
    const [studentsRes, todayStats, homeworkActivityState] = await Promise.all([
      db.collection("students").get(),
      loadAllVocabularyDocuments("vocabularyDailyStats", { learningDay }),
      getOptionalTransactionDocument(
        db.collection("systemLocks").doc(getTeacherHomeworkActivityStateId(identity.openid))
      ),
    ]);
    const visibleStudents = (studentsRes.data || []).filter((student) => !isStudentHiddenFromTeacher(student));
    const students = attachVocabularyTodayPulses(
      await attachSyncedLessonCounts(visibleStudents),
      todayStats
    );
    const [mistakeCounts, lessonResults, submissionResults] = await Promise.all([
      Promise.all(students.map((student) => db.collection("mistakes").where({ studentId: student._id }).count())),
      Promise.all(students.map((student) => (
        loadAllStudentDocuments("lessons", student._id)
      ))),
      Promise.all(students.map((student) => (
        loadAllStudentDocuments("lessonSubmissions", student._id)
      ))),
    ]);
    const allLessons = lessonResults
      .flatMap((items) => items || [])
      .map(withTeacherConfirmedHomeworkState);
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

const markHomeworkActivitiesViewed = async (event = {}) => {
  const identity = await getIdentity();
  if (identity.role !== "teacher") {
    throw createError("PERMISSION_DENIED", "仅教师端可更新课后任务动态");
  }
  const requestedAtMs = Math.min(
    Date.now(),
    Math.max(0, Number(event.data && event.data.viewedThroughAtMs || 0))
  );
  if (!requestedAtMs) return { success: true, viewedThroughAtMs: 0 };
  await createOneCollection("systemLocks");
  const stateId = getTeacherHomeworkActivityStateId(identity.openid);
  const viewedThroughAtMs = await db.runTransaction(async (transaction) => {
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
    throw createError("ALREADY_TEACHER", "当前是教师账号，无需绑定学生");
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
  const boundStudent = await db.runTransaction(async (transaction) => {
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
    await db.runTransaction(async (transaction) => {
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
    throw createError("ACCESS_CODE_RESERVED", "学生访问码不能与老师访问码相同");
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
  if (plannedLessonCount > 0 && completedLessonCount > plannedLessonCount) {
    throw createError("INVALID_PROGRESS", "已上课时不能大于总课时");
  }
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
    recordedLessonCount: 0,
    vocabularyEnabled: false,
    englishCourseEnabled: true,
    mistakeLearningEnabled: true,
    frenchLearningEnabled: false,
    teacherHidden: false,
    vocabularySettings: vocabulary.getDefaultVocabularySettings(),
    createdAt: db.serverDate(),
  };
  return await db.runTransaction(async (transaction) => {
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
  const plannedLessonCount = toNonNegativeNumber(data.plannedLessonCount, "总课时");
  const completedLessonCount = toNonNegativeNumber(data.completedLessonCount, "已上课时");
  if (plannedLessonCount > 0 && completedLessonCount > plannedLessonCount) {
    throw createError("INVALID_PROGRESS", "已上课时不能大于总课时");
  }
  const recordedLessonCount = await getStudentLessonCount(data.studentId);
  await db.collection("students").doc(data.studentId).update({
    data: {
      plannedLessonCount,
      completedLessonCount,
      recordedLessonCount,
    },
  });
  return {
    success: true,
    plannedLessonCount,
    completedLessonCount,
    progressPercent: plannedLessonCount ? Math.round((completedLessonCount / plannedLessonCount) * 100) : 0,
  };
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
    const created = await db.runTransaction(async (transaction) => {
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
    throw createError("PERMISSION_DENIED", "仅教师端可使用学生视角");
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
  return {
    success: true,
    role: identity.role,
    student: sanitizeStudent(student, identity.role === "teacher"),
    vocabularyLevels: getVocabularyLibrary().levels.filter((level) => !level.isReferenceOnly),
    lessons: lessons.map(withTeacherConfirmedHomeworkState),
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
    throw createError("PERMISSION_DENIED", "仅教师端可使用学生视角");
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
    .map(withTeacherConfirmedHomeworkState);
  const homeworkLessons = lessons.filter(hasLessonHomework);
  const pendingLessons = homeworkLessons.filter((lesson) => !isLessonHomeworkCompleted(lesson));
  const completedLessons = homeworkLessons.filter(isLessonHomeworkCompleted);
  return {
    success: true,
    role: identity.role,
    readOnly: isTeacherPreview,
    student: sanitizeStudent(studentRes.data, false),
    pendingLessons,
    completedLessons,
    summary: {
      pendingCount: pendingLessons.length,
      completedCount: completedLessons.length,
      totalCount: homeworkLessons.length,
    },
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
    && lesson.recordingTaskType === "ket_official"
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
    hideBasicWords: typeof data.hideBasicWords === "boolean" ? data.hideBasicWords : undefined,
    learningOrder: data.learningOrder,
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

const setVocabularyDailyGoal = async (event) => {
  const identity = await getIdentity();
  if (identity.role !== "student" || !identity.student) {
    throw createError("PERMISSION_DENIED", "请在学生端选择今天的单词数量");
  }
  const data = event.data || {};
  const studentId = String(data.studentId || "").trim();
  if (!studentId || studentId !== identity.student._id) {
    throw createError("PERMISSION_DENIED", "只能修改自己的今日目标");
  }
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
  };
  await createOneCollection("vocabularyDailyStats");
  const dailyStatsId = getVocabularyDailyStatsId(studentId, dailyPlan.learningDay);
  await db.runTransaction(async (transaction) => {
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
        `今天已完成 ${reviewedCount} 个，目标不能调到更低`
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
  basicHiddenCount: 0,
  dailyGoal,
  todayCount: 0,
  todayReviewedCount: 0,
  todayRemainingCount: 0,
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

const buildVocabularyUnits = (library, selectedLevelIds) => {
  const selectedLevels = new Set(selectedLevelIds || []);
  const unitById = new Map();
  library.words.forEach((word) => {
    if (!selectedLevels.has(word.levelId) || !word.unitId || unitById.has(word.unitId)) return;
    unitById.set(word.unitId, {
      id: word.unitId,
      label: word.unitLabel || word.unitId,
      levelId: word.levelId,
      order: Number(word.order || 0),
    });
  });
  return Array.from(unitById.values()).sort((a, b) => {
    if (a.levelId !== b.levelId) return a.levelId.localeCompare(b.levelId);
    return a.order - b.order;
  });
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
    units: buildVocabularyUnits(library, settings.levelIds),
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
  return attachVocabularyAudioUrls(Object.assign({}, baseResponse, view, browsePage, {
    weeklyStats,
    pendingWords: view.pendingWords.slice(0, 100),
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
  const matchingLibraryWord = library.words.find((item) => item.key === wordKey);
  if (
    settings.hideBasicWords === true
    && matchingLibraryWord
    && matchingLibraryWord.isBasic === true
  ) {
    throw createError("INVALID_VOCABULARY_WORD", "这个词已不在学习范围内，请刷新列表");
  }
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

const reviewVocabularyWord = async (event) => {
  await Promise.all([
    createOneCollection("vocabularyProgress"),
    createOneCollection("vocabularyDailyStats"),
  ]);
  const identity = await getIdentity();
  if (identity.role !== "student" || !identity.student) {
    throw createError("PERMISSION_DENIED", "当前是老师预览，不能记录学习进度");
  }
  const data = event.data || {};
  const studentId = String(data.studentId || "").trim();
  if (!studentId || studentId !== identity.student._id) {
    throw createError("PERMISSION_DENIED", "只能记录自己的单词进度");
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
  const progress = await db.runTransaction(async (transaction) => {
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
    const reviewProgress = vocabulary.buildReviewProgress(existing, data.result, nowMs);
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
  });
  return Object.assign({ success: true, studentId, wordKey }, progress);
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
  await db.runTransaction(async (transaction) => {
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
  if (studentId && (identity.role === "student" || data.mode === "teacherPreview")) {
    const studentRes = await db.collection("students").doc(studentId).get();
    if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
    ensureEnglishCourseAccess(identity, studentRes.data, data);
  }

  const lessonCollection = db.collection("lessons");
  const res = studentId
    ? await lessonCollection.where({ studentId }).orderBy("lessonDate", "desc").get()
    : await lessonCollection.orderBy("lessonDate", "desc").get();
  return {
    success: true,
    role: identity.role,
    data: (res.data || []).map(withTeacherConfirmedHomeworkState),
  };
};

const toLessonNoInteger = (value) => {
  const text = String(value === undefined || value === null ? "" : value).trim();
  if (!/^\d+$/.test(text)) return null;
  const num = Number(text);
  return Number.isSafeInteger(num) && num > 0 ? num : null;
};

const getNextLessonNo = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  const studentId = data.studentId;
  if (!studentId) {
    throw createError("INVALID_STUDENT", "学生信息不完整，请返回后重试");
  }

  let maxLessonNo = 0;
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
    });
  }

  return {
    success: true,
    maxLessonNo,
    nextLessonNo: maxLessonNo + 1,
    hasHistory: maxLessonNo > 0,
  };
};

const LESSON_OBSERVATION_STATUSES = ["独立完成", "提示后完成", "暂未掌握"];
const RECORDING_PREPARATION_OPTIONS = [0, 3, 5, 10, 15];
const HONG_KONG_OFFSET_MS = 8 * 60 * 60 * 1000;
const HOMEWORK_REMINDER_HOUR = 18;

const normalizeLessonText = (value, limit = 1200) => String(value || "").trim().slice(0, limit);

const normalizeRecordingRepeatCount = (value) => {
  const count = Math.trunc(Number(value));
  return Number.isFinite(count) ? Math.max(1, Math.min(5, count)) : 2;
};

const normalizeRecordingPreparationSeconds = (value) => {
  const seconds = Math.trunc(Number(value));
  return RECORDING_PREPARATION_OPTIONS.includes(seconds) ? seconds : 5;
};

const normalizeLearningObservations = (items) => (Array.isArray(items) ? items : [])
  .slice(0, 20)
  .map((item) => ({
    content: normalizeLessonText(item && item.content, 200),
    status: LESSON_OBSERVATION_STATUSES.includes(item && item.status)
      ? item.status
      : LESSON_OBSERVATION_STATUSES[0],
    note: normalizeLessonText(item && item.note, 300),
  }))
  .filter((item) => item.content);

const findOfficialKetSpeakingTask = (taskId) => KET_SPEAKING_TASKS.find((item) => item.id === taskId) || null;

const normalizeLessonWorkspacePayload = (data = {}) => {
  const lessonTemplateKey = LESSON_TEMPLATE_KEYS.includes(data.lessonTemplateKey)
    ? data.lessonTemplateKey
    : "general";
  const recordingTaskEnabled = data.recordingTaskEnabled === true;
  const requestedTaskType = data.recordingTaskType === "ket_official" ? "ket_official" : "manual";
  const officialTask = lessonTemplateKey === "molly_oral_ket" && recordingTaskEnabled
    ? findOfficialKetSpeakingTask(String(data.ketSpeakingTaskId || "").trim())
    : null;
  const recordingTaskType = requestedTaskType === "ket_official" && officialTask
    ? "ket_official"
    : "manual";
  return {
    lessonTemplateKey,
    reviewContent: normalizeLessonText(data.reviewContent),
    taughtContent: normalizeLessonText(data.taughtContent),
    masterySummary: normalizeLessonText(data.masterySummary),
    oralTopic: normalizeLessonText(data.oralTopic),
    targetExpression: normalizeLessonText(data.targetExpression),
    independentOutput: normalizeLessonText(data.independentOutput),
    correctionNotes: normalizeLessonText(data.correctionNotes),
    ketSkill: normalizeLessonText(data.ketSkill, 300),
    nextReview: normalizeLessonText(data.nextReview),
    homeworkTask: normalizeLessonText(data.homeworkTask),
    recordingTaskEnabled,
    recordingTaskType,
    recordingPrompt: recordingTaskType === "ket_official"
      ? officialTask.prompt
      : normalizeLessonText(data.recordingPrompt, 2000),
    recordingRepeatCount: recordingTaskType === "ket_official"
      ? 1
      : normalizeRecordingRepeatCount(data.recordingRepeatCount),
    recordingPreparationSeconds: recordingTaskType === "ket_official"
      ? officialTask.preparationSeconds
      : normalizeRecordingPreparationSeconds(data.recordingPreparationSeconds),
    recordingSuggestedSeconds: recordingTaskType === "ket_official"
      ? officialTask.suggestedRecordingSeconds
      : 0,
    ketSpeakingTaskId: recordingTaskType === "ket_official" ? officialTask.id : "",
    ketSpeakingTask: recordingTaskType === "ket_official" ? officialTask : null,
    learningObservations: normalizeLearningObservations(data.learningObservations),
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

const getHomeworkTaskSignature = (lesson = {}) => JSON.stringify({
  homeworkTask: String(lesson.homeworkTask || "").trim(),
  recordingTaskEnabled: lesson.recordingTaskEnabled === true,
  recordingPrompt: String(lesson.recordingPrompt || "").trim(),
  recordingRepeatCount: normalizeRecordingRepeatCount(lesson.recordingRepeatCount),
  recordingPreparationSeconds: normalizeRecordingPreparationSeconds(lesson.recordingPreparationSeconds),
  recordingTaskType: lesson.recordingTaskType === "ket_official" ? "ket_official" : "manual",
  ketSpeakingTaskId: String(lesson.ketSpeakingTaskId || ""),
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

const normalizeLessonRequestPayload = (data = {}) => ({
  studentId: String(data.studentId || "").trim(),
  title: String(data.title || "").trim(),
  subject: String(data.subject || appConfig.defaultSubject || "").trim(),
  lessonDate: String(data.lessonDate || "").trim(),
  lessonNo: String(data.lessonNo || "").trim(),
  summary: String(data.summary || "").trim(),
  ...normalizeLessonWorkspacePayload(data),
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
  const lessonPayload = normalizeLessonRequestPayload(data);
  if (!lessonPayload.studentId || !lessonPayload.title || !lessonPayload.lessonDate) {
    throw createError("INVALID_LESSON", "请填写学生、课程标题和日期");
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
  const saved = await db.runTransaction(async (transaction) => {
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
  const workspace = normalizeLessonWorkspacePayload(data);
  await assertContentSafe({
    texts: [
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
      ...workspace.learningObservations.map((item) => [item.content, item.note]),
    ],
  });
  const saved = await db.runTransaction(async (transaction) => {
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
    }
    await lessonRef.update({ data: updateData });
    return { taskChanged, homeworkTaskVersion: updateData.homeworkTaskVersion || lesson.homeworkTaskVersion || 1 };
  });
  return { success: true, lessonId, workspace, ...saved };
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
  const deleteState = await db.runTransaction(async (transaction) => {
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
  const mistakeImageFileIDs = mistakes
    .map((mistake) => mistake.questionImageFileId)
    .filter((fileID) => fileID);
  const submissionFileIDs = lessonSubmissions
    .map((submission) => submission.fileID)
    .filter((fileID) => fileID);

  await removeDocumentsById("mistakes", mistakes);
  await removeDocumentsById("papers", papers);
  await removeDocumentsById("lessonSubmissions", lessonSubmissions);
  await db.collection("lessons").doc(lessonId).remove();
  await deleteUnsafeFiles(paperFileIDs.concat(submissionFileIDs));
  await deleteUnreferencedMistakeFiles(mistakeImageFileIDs);
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
    throw createError("PERMISSION_DENIED", "仅教师端可使用学生视角");
  }

  const lessonRes = await db.collection("lessons").doc(lessonId).get();
  const lesson = lessonRes.data;
  if (!lesson) throw createError("LESSON_NOT_FOUND", "课程不存在或已删除");
  if (data.mode === "teacherPreview" && data.previewStudentId && lesson.studentId !== data.previewStudentId) {
    throw createError("PERMISSION_DENIED", "当前课程不属于这位学生，请刷新后重试");
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
  const [lessonPapers, lessonMistakes, lessonSubmissions] = await Promise.all([
    loadAllLessonDocuments("papers", lessonId),
    loadAllLessonDocuments("mistakes", lessonId),
    loadAllLessonDocuments("lessonSubmissions", lessonId),
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
  submissions.sort((a, b) => getCreatedTime(b) - getCreatedTime(a));
  const [papersWithUrls, submissionsWithAudioUrls] = await Promise.all([
    attachLessonPaperUrls(papers),
    attachLessonSubmissionAudioUrls(submissions),
  ]);
  return {
    success: true,
    role: identity.role,
    lesson: withTeacherConfirmedHomeworkState(lesson),
    student: {
      _id: student._id,
      name: student.name || "学生",
    },
    papers: papersWithUrls,
    mistakes,
    submissions: submissionsWithAudioUrls,
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
  try {
    await assertContentSafe({
      texts: [data.title, data.paperTitle, data.term, data.fileName],
      imageFileIds: data.type === "image" || data.type === "canva" ? [data.fileID] : [],
    });
  } catch (err) {
    await deleteUnsafeFiles([data.fileID, data.previewFileID]);
    throw err;
  }
  const paperId = `paper_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
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
  return await db.runTransaction(async (transaction) => {
    await getWritableLessonInTransaction(
      transaction,
      data.lessonId,
      data.studentId,
      "INVALID_PAPER"
    );
    await transaction.collection("papers").doc(paperId).set({ data: paperData });
    return { _id: paperId };
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
    if (!paperTitle) throw createError("INVALID_PAPER", "资料标题不能为空");
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
  const lessonFolder = `${lessonDate}-第${lessonNo}节-${lessonTitle}-${shortRecordId(lesson && lesson._id)}`;
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

const resetCompletedHomeworkWhenNoUsableRecording = async (lessonId, invalidatedAtMs) => {
  const submissions = await loadAllLessonDocuments("lessonSubmissions", lessonId);
  const usableSubmissionIds = submissions
    .filter(isUsableLessonRecording)
    .map((item) => item._id)
    .filter(Boolean);
  return db.runTransaction(async (transaction) => {
    const lessonRef = transaction.collection("lessons").doc(lessonId);
    const lesson = await getOptionalTransactionDocument(lessonRef);
    if (!lesson || lesson.deleting === true || lesson.recordingTaskEnabled !== true) return false;
    if (!isLessonHomeworkCompleted(lesson)) return false;
    if (Number(lesson.homeworkCompletedAtMs || 0) > Number(invalidatedAtMs || 0)) return false;
    for (let i = 0; i < usableSubmissionIds.length; i += 1) {
      const current = await getOptionalTransactionDocument(
        transaction.collection("lessonSubmissions").doc(usableSubmissionIds[i])
      );
      if (current && current.lessonId === lessonId && isUsableLessonRecording(current)) return false;
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
    throw createError("PERMISSION_DENIED", "请在学生端提交跟读录音");
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
  await createOneCollection("lessonSubmissions");
  const submissionId = `submission_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
  const cloudPath = normalizeLessonText(data.cloudPath, 500);
  await db.runTransaction(async (transaction) => {
    const lessonRef = transaction.collection("lessons").doc(lessonId);
    const currentLesson = await getOptionalTransactionDocument(lessonRef);
    if (
      !currentLesson
      || currentLesson.deleting === true
      || currentLesson.studentId !== identity.student._id
      || currentLesson.recordingTaskEnabled !== true
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
      attemptNo: Math.max(1, Math.min(99, Math.trunc(Number(data.attemptNo)) || 1)),
      status: "待检查",
      teacherFeedback: "",
      createdAt: db.serverDate(),
      createdAtMs: Date.now(),
    };
    await transaction.collection("lessonSubmissions").doc(submissionId).set({ data: submission });
  });
  return { success: true, _id: submissionId, homeworkAutoCompleted: false };
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
  const status = data.status === "需要重录" ? "需要重录" : "朗读正确";
  const teacherFeedback = normalizeLessonText(data.teacherFeedback, 500);
  if (!submissionId) throw createError("INVALID_RECORDING", "录音信息不完整，请刷新后重试");
  await assertContentSafe({ texts: [teacherFeedback] });
  const reviewStartedAtMs = Date.now();
  const submission = await db.runTransaction(async (transaction) => {
    const submissionRef = transaction.collection("lessonSubmissions").doc(submissionId);
    const current = await getOptionalTransactionDocument(submissionRef);
    if (!current) throw createError("RECORDING_NOT_FOUND", "录音不存在或已删除");
    await submissionRef.update({
      data: {
        status,
        teacherFeedback,
        reviewedAt: db.serverDate(),
      },
    });
    return current;
  });
  if (status === "需要重录") {
    await resetCompletedHomeworkWhenNoUsableRecording(submission.lessonId, reviewStartedAtMs);
  }
  return { success: true, submissionId, status, teacherFeedback };
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
  const deleted = await db.runTransaction(async (transaction) => {
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
  const result = await db.runTransaction(async (transaction) => {
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
  const saved = await db.runTransaction(async (transaction) => {
    const lessonRef = transaction.collection("lessons").doc(lessonId);
    const lesson = await getOptionalTransactionDocument(lessonRef);
    if (!lesson || lesson.studentId !== identity.student._id || lesson.deleting === true) {
      throw createError("INVALID_LESSON", "这份课后任务不属于当前学生或已删除");
    }
    if (!hasLessonHomework(lesson)) {
      throw createError("HOMEWORK_NOT_ASSIGNED", "老师尚未为这节课布置课后任务");
    }
    if (isLessonHomeworkCompleted(lesson)) {
      throw createError("HOMEWORK_COMPLETED", "课后任务已经完成，不需要再开启提醒");
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

const checkUploadedImage = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  const fileID = data.fileID;
  if (!fileID) throw createError("INVALID_FILE", "图片信息不完整，请重新选择");
  try {
    await assertContentSafe({
      imageFileIds: [fileID],
    });
  } catch (err) {
    if (err.code === "CONTENT_RISK") {
      await deleteUnreferencedMistakeFiles([fileID]);
    }
    throw err;
  }
  return {
    success: true,
  };
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
    data: res.data || [],
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
  if (!data.questionImageFileId && !data.questionText && !data.studentAnswer && !data.correctAnswer) {
    throw createError("INVALID_MISTAKE", "请上传题目图片，或填写题目和答案");
  }
  const skillTags = normalizeTags(data.skillTags && data.skillTags.length ? data.skillTags : data.tags);
  const reviewStatus = data.reviewStatus || data.status || "待复习";
  const vocabularyWords = vocabulary.normalizeVocabularyWords(data.vocabularyWords);
  const vocabularyFields = getMistakeVocabularyFields(Object.assign({}, data, { vocabularyWords }));
  try {
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
      imageFileIds: data.questionImageFileId ? [data.questionImageFileId] : [],
    });
  } catch (err) {
    if (err.code === "CONTENT_RISK") {
      await deleteUnreferencedMistakeFiles([data.questionImageFileId]);
    }
    throw err;
  }
  const mistakeId = `mistake_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
  const mistakeData = {
    studentId: data.studentId,
    lessonId: data.lessonId,
    paperId: data.paperId || "",
    questionImageFileId: data.questionImageFileId || "",
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
  return await db.runTransaction(async (transaction) => {
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
  if (!data.questionImageFileId && !data.questionText && !data.studentAnswer && !data.correctAnswer) {
    throw createError("INVALID_MISTAKE", "请上传题目图片，或填写题目和答案");
  }
  const existingRes = await db.collection("mistakes").doc(data.mistakeId).get();
  if (!existingRes.data) throw createError("MISTAKE_NOT_FOUND", "错题不存在或已删除");
  const lessonRes = await db.collection("lessons").doc(data.lessonId).get();
  if (!lessonRes.data || lessonRes.data.studentId !== data.studentId) {
    throw createError("INVALID_MISTAKE", "所选课程不属于这位学生，请重新选择");
  }
  const previousImageFileId = existingRes.data.questionImageFileId || "";
  const skillTags = normalizeTags(data.skillTags && data.skillTags.length ? data.skillTags : data.tags);
  const reviewStatus = data.reviewStatus || data.status || "待复习";
  const vocabularyWords = vocabulary.normalizeVocabularyWords(
    Object.prototype.hasOwnProperty.call(data, "vocabularyWords")
      ? data.vocabularyWords
      : existingRes.data.vocabularyWords
  );
  const vocabularyFields = getMistakeVocabularyFields(Object.assign({}, data, { vocabularyWords }));
  try {
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
      imageFileIds: data.questionImageFileId ? [data.questionImageFileId] : [],
    });
  } catch (err) {
    if (
      err.code === "CONTENT_RISK"
      && data.questionImageFileId
      && data.questionImageFileId !== previousImageFileId
    ) {
      await deleteUnreferencedMistakeFiles([data.questionImageFileId]);
    }
    throw err;
  }
  const mistakeUpdateData = {
    studentId: data.studentId,
    lessonId: data.lessonId,
    paperId: data.paperId || "",
    questionImageFileId: data.questionImageFileId || "",
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
  const replacedImageFileId = await db.runTransaction(async (transaction) => {
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
    return String(currentMistake.questionImageFileId || "");
  });
  if (replacedImageFileId && replacedImageFileId !== (data.questionImageFileId || "")) {
    await deleteUnreferencedMistakeFiles([replacedImageFileId]);
  }
  return { success: true };
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
      questionImageFileId: String(source.questionImageFileId || "").trim(),
      sourcePage: String(source.sourcePage || "").trim(),
      sourceImageName: String(source.sourceImageName || "").trim(),
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
  const emptyIndex = safeItems.findIndex((item) => !item.questionText && !item.studentAnswer && !item.correctAnswer);
  if (emptyIndex >= 0) {
    throw createError("INVALID_IMPORT", `第 ${importItemOffset + emptyIndex + 1} 道错题内容为空，请至少填写题目或答案`);
  }
  await checkTeacherImportContent(safeItems, importItemOffset);
  const importImageFileIds = uniqueValues(
    safeItems.map((item) => item.questionImageFileId).filter((fileID) => fileID)
  );
  for (let imageIndex = 0; imageIndex < importImageFileIds.length; imageIndex += 1) {
    await checkImageFile(importImageFileIds[imageIndex]);
  }
  const existingImportRes = await db.collection("mistakes").where({
    importBatchId,
    studentId: data.studentId,
    lessonId: data.lessonId,
  }).limit(100).get();
  const existingItemsByIndex = new Map(
    (existingImportRes.data || []).map((item) => [Number(item.importItemIndex), item])
  );
  let addedCount = 0;
  let updatedImageCount = 0;
  let skippedCount = 0;
  const unusedImageFileIds = [];
  for (let i = 0; i < safeItems.length; i++) {
    const item = safeItems[i];
    const importItemIndex = importItemOffset + i;
    const existingItem = existingItemsByIndex.get(importItemIndex);
    if (existingItem) {
      const existingResult = await db.runTransaction(async (transaction) => {
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
        const currentImageFileId = String(current.questionImageFileId || "").trim();
        const needsVocabularyBackfill =
          Number(current.vocabularyCandidatesVersion) !== vocabulary.VOCABULARY_CANDIDATES_VERSION
          || !Array.isArray(current.vocabularyCandidates);
        const updateData = {};
        let updatedImage = false;
        let unusedImageFileId = "";
        if (item.questionImageFileId && !currentImageFileId) {
          updateData.questionImageFileId = item.questionImageFileId;
          updateData.sourcePage = item.sourcePage;
          updateData.sourceImageName = item.sourceImageName;
          updatedImage = true;
        } else if (item.questionImageFileId && item.questionImageFileId !== currentImageFileId) {
          unusedImageFileId = item.questionImageFileId;
        }
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
          updatedImage,
          skipped: !hasUpdates,
          unusedImageFileId,
        };
      });
      if (!existingResult.missing) {
        if (existingResult.updatedImage) updatedImageCount += 1;
        if (existingResult.skipped) skippedCount += 1;
        if (existingResult.unusedImageFileId) {
          unusedImageFileIds.push(existingResult.unusedImageFileId);
        }
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
        questionImageFileId: item.questionImageFileId,
        questionNo: item.questionNo,
        paperSection: item.paperSection,
        questionType: item.questionType,
        questionText: item.questionText,
        sourcePage: item.sourcePage,
        sourceImageName: item.sourceImageName,
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
    const upsertResult = await db.runTransaction(async (transaction) => {
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
        return { created: true, updatedImage: false, skipped: false, unusedImageFileId: "" };
      }
      const currentImageFileId = String(current.questionImageFileId || "").trim();
      const needsVocabularyBackfill =
        Number(current.vocabularyCandidatesVersion) !== vocabulary.VOCABULARY_CANDIDATES_VERSION
        || !Array.isArray(current.vocabularyCandidates);
      const updateData = {};
      let updatedImage = false;
      let unusedImageFileId = "";
      if (item.questionImageFileId && !currentImageFileId) {
        updateData.questionImageFileId = item.questionImageFileId;
        updateData.sourcePage = item.sourcePage;
        updateData.sourceImageName = item.sourceImageName;
        updatedImage = true;
      } else if (item.questionImageFileId && item.questionImageFileId !== currentImageFileId) {
        unusedImageFileId = item.questionImageFileId;
      }
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
        updatedImage,
        skipped: !hasUpdates,
        unusedImageFileId,
      };
    });
    if (upsertResult.created) addedCount += 1;
    if (upsertResult.updatedImage) updatedImageCount += 1;
    if (upsertResult.skipped) skippedCount += 1;
    if (upsertResult.unusedImageFileId) unusedImageFileIds.push(upsertResult.unusedImageFileId);
  }
  await deleteUnreferencedMistakeFiles(unusedImageFileIds);
  return {
    success: true,
    importedCount: safeItems.length,
    addedCount,
    updatedImageCount,
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
  const reviewCount = await db.runTransaction(async (transaction) => {
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
  const mistake = await attachQuestionImageUrl(hydratedMistake);
  return {
    success: true,
    role: identity.role,
    mistake,
  };
};

const deleteMistake = async (event) => {
  await ensureTeacher();
  const mistakeId = event.data && event.data.mistakeId;
  if (!mistakeId) throw createError("INVALID_MISTAKE", "错题信息不完整，请返回后重试");
  const res = await db.collection("mistakes").doc(mistakeId).get();
  if (!res.data) throw createError("MISTAKE_NOT_FOUND", "错题不存在或已删除");
  await db.collection("mistakes").doc(mistakeId).remove();
  if (res.data.questionImageFileId) {
    await deleteUnreferencedMistakeFiles([res.data.questionImageFileId]);
  }
  return { success: true };
};

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
      case "markHomeworkActivitiesViewed":
        return await markHomeworkActivitiesViewed(event);
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
      case "setVocabularyDailyGoal":
        return await setVocabularyDailyGoal(event);
      case "getVocabularyData":
        return await getVocabularyData(event);
      case "reviewVocabularyWord":
        return await reviewVocabularyWord(event);
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
      case "checkUploadedImage":
        return await checkUploadedImage(event);
      case "listMistakes":
        return await listMistakes(event);
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
          message: "暂不支持该操作，请刷新后重试",
        };
    }
  } catch (err) {
    return {
      success: false,
      code: err.code || "SERVER_ERROR",
      message: err.message || "服务暂时不可用",
    };
  }
};
