const cloud = require("wx-server-sdk");
const crypto = require("crypto");
const appConfig = require("./config");
const vocabulary = require("./vocabulary");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const COLLECTIONS = [
  "students",
  "teachers",
  "lessons",
  "lessonBookings",
  "papers",
  "mistakes",
  "vocabularyProgress",
  "vocabularyDailyStats",
  "systemLocks",
];
const VOCABULARY_DAY_MS = 24 * 60 * 60 * 1000;
const SHARED_STUDENT_LIMIT = 5;
const SHARED_STUDENT_ACCESS_CODES = ["RUIRUI-EN-4829", "XUANNAN-EN-7316"];
const UNLIMITED_STUDENT_ACCESS_CODES = ["JASON-PRC-0001"];
const UNCATEGORIZED_LABEL = "未分类";
const CONTENT_RISK_MESSAGE = "内容含违规信息，请修改后再提交";
const CONTENT_CHECK_UNAVAILABLE_MESSAGE = "内容安全检测暂时不可用，请稍后再试";
const TEXT_CHECK_CHUNK_SIZE = 1800;
const IMPORT_VOCABULARY_CHECK_GROUP_SIZE = 20;
const SEED_STUDENTS = [
  {
    name: "芮芮",
    nickname: "",
    grade: "三年级",
    parentName: "",
    status: "在读",
    accessCode: "RUIRUI-EN-4829",
    studentOpenId: "",
    studentOpenIds: [],
    teacherName: appConfig.teacherName,
    subject: appConfig.defaultSubject,
    plannedLessonCount: 0,
    completedLessonCount: 0,
    vocabularyEnabled: false,
    vocabularySettings: vocabulary.getRecommendedVocabularySettings({ name: "芮芮", accessCode: "RUIRUI-EN-4829" }),
  },
  {
    name: "任轩楠",
    nickname: "",
    grade: "初二",
    parentName: "",
    status: "在读",
    accessCode: "XUANNAN-EN-7316",
    studentOpenId: "",
    studentOpenIds: [],
    teacherName: appConfig.teacherName,
    subject: appConfig.defaultSubject,
    plannedLessonCount: 0,
    completedLessonCount: 0,
    vocabularyEnabled: false,
    vocabularySettings: vocabulary.getRecommendedVocabularySettings({ name: "任轩楠", accessCode: "XUANNAN-EN-7316" }),
  },
  {
    name: "Jason梁",
    nickname: "Jason",
    grade: "大二",
    parentName: "",
    status: "在读",
    accessCode: "JASON-PRC-0001",
    studentOpenId: "",
    studentOpenIds: [],
    teacherName: appConfig.teacherName,
    subject: appConfig.defaultSubject,
    plannedLessonCount: 0,
    completedLessonCount: 0,
    vocabularyEnabled: false,
    vocabularySettings: vocabulary.getRecommendedVocabularySettings({ name: "Jason梁", accessCode: "JASON-PRC-0001" }),
  },
];

const createError = (code, message) => {
  const err = new Error(message);
  err.code = code;
  return err;
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
        riskMessage: `第 ${importItemOffset + i + 1} 道错题未通过内容安全检测，请检查后重试`,
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
          riskMessage: `单词“${entry.word}”未通过内容安全检测，请检查后重试`,
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

const getStudentBindLimit = (accessCode) => {
  const normalized = normalizeCode(accessCode);
  if (UNLIMITED_STUDENT_ACCESS_CODES.indexOf(normalized) >= 0) return Infinity;
  if (SHARED_STUDENT_ACCESS_CODES.indexOf(normalized) >= 0) return SHARED_STUDENT_LIMIT;
  return 1;
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
    label: !hasPlan ? "暂未设置课程循环" : isReviewPhase ? "本轮课程已完成，进入期末复习期" : "课程循环进行中",
    nextAction: !hasPlan ? "先设置总课时" : isReviewPhase ? "开始期末复习" : `继续第 ${progress.completedLessonCount + 1} 节课`,
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

const getIdentity = async () => {
  const openid = getOpenIdFromContext();
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
  }
  return result;
};

const ensureTeacher = async () => {
  const identity = await getIdentity();
  if (identity.role !== "teacher") {
    throw createError("PERMISSION_DENIED", "只有朱老师可以进行此操作");
  }
  return identity;
};

const ensureStudentAccess = async (studentId) => {
  const identity = await getIdentity();
  if (identity.role === "teacher") return identity;
  if (identity.role === "student" && identity.student && identity.student._id === studentId) return identity;
  throw createError("PERMISSION_DENIED", "无权访问该学生的数据");
};

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

const buildNextLessonBooking = (bookings, students) => {
  const nowMs = Date.now();
  const next = (bookings || [])
    .filter((item) => item && item.status === "已确认" && getBookingStartAtMs(item) > nowMs)
    .sort((a, b) => getBookingStartAtMs(a) - getBookingStartAtMs(b))[0];
  if (!next) return null;
  const safe = sanitizeLessonBookingForClient(next);
  safe.confirmedDate = safe.confirmedDate || safe.requestedDate || "";
  safe.confirmedTime = safe.confirmedTime || safe.requestedTime || "";
  if (!safe.studentName && Array.isArray(students)) {
    const student = students.find((item) => item._id === safe.studentId);
    safe.studentName = student ? student.name || "" : "";
  }
  return safe;
};

const loadUpcomingConfirmedBookings = async (studentId) => {
  const baseCondition = studentId
    ? { studentId, status: "已确认" }
    : { status: "已确认" };
  let indexedBookings = [];
  try {
    const indexedRes = await db.collection("lessonBookings")
      .where(Object.assign({}, baseCondition, {
        confirmedStartAtMs: db.command.gt(Date.now()),
      }))
      .orderBy("confirmedStartAtMs", "asc")
      .limit(10)
      .get();
    indexedBookings = indexedRes.data || [];
  } catch (err) {
    console.warn("load indexed upcoming lesson bookings failed; using bounded fallback", err);
  }
  const fallbackRes = await db.collection("lessonBookings")
    .where(baseCondition)
    .limit(100)
    .get();
  const bookingsById = new Map();
  indexedBookings.concat(fallbackRes.data || []).forEach((booking) => {
    if (booking && booking._id) bookingsById.set(booking._id, booking);
  });
  return Array.from(bookingsById.values());
};

const getHomeData = async () => {
  const identity = await getIdentity();
  if (identity.role !== "guest") {
    await Promise.all([
      createOneCollection("vocabularyDailyStats"),
      createOneCollection("lessonBookings"),
    ]);
  }
  const learningDay = vocabulary.getLearningDay();
  if (identity.role === "teacher") {
    const [studentCount, mistakeCount, studentsRes, recentLessonRes, todayStats, confirmedBookings] = await Promise.all([
      db.collection("students").count(),
      db.collection("mistakes").count(),
      db.collection("students").get(),
      db.collection("lessons").orderBy("lessonDate", "desc").limit(3).get(),
      loadAllVocabularyDocuments("vocabularyDailyStats", { learningDay }),
      loadUpcomingConfirmedBookings(),
    ]);
    const students = attachVocabularyTodayPulses(
      await attachSyncedLessonCounts(studentsRes.data || []),
      todayStats
    );
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
        studentCount: studentCount.total,
        mistakeCount: mistakeCount.total,
        progressOverview,
      },
      studentsProgress,
      nextLessonBooking: buildNextLessonBooking(confirmedBookings, students),
      recentLessons: await attachStudentNames(recentLessonRes.data || [], students),
    };
  }

  if (identity.role === "student") {
    const studentId = identity.student._id;
    const [mistakeCount, recentLessonRes, syncedStudent, todayStats, confirmedBookings] = await Promise.all([
      db.collection("mistakes").where({ studentId }).count(),
      db.collection("lessons").where({ studentId }).orderBy("lessonDate", "desc").limit(3).get(),
      attachSyncedLessonCount(identity.student),
      loadAllVocabularyDocuments("vocabularyDailyStats", { studentId, learningDay }),
      loadUpcomingConfirmedBookings(studentId),
    ]);
    const progress = buildProgress(syncedStudent);
    return {
      success: true,
      role: "student",
      openid: identity.openid,
      teacherName: appConfig.teacherName,
      currentStudent: sanitizeStudent(syncedStudent, false),
      vocabularyPulse: buildVocabularyTodayPulse(syncedStudent, todayStats[0]),
      nextLessonBooking: buildNextLessonBooking(confirmedBookings, [syncedStudent]),
      canShowStudentCount: false,
      stats: {
        mistakeCount: mistakeCount.total,
        progress,
      },
      recentLessons: recentLessonRes.data || [],
    };
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
    nextLessonBooking: null,
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
    throw createError("INVALID_ACCESS_CODE", "请输入专属 accessCode");
  }

  if (isTeacherAccessCode(accessCode)) {
    return await bindTeacher(identity.openid);
  }

  if (identity.role === "teacher") {
    throw createError("ALREADY_TEACHER", "朱老师账号不需要绑定学生");
  }
  if (identity.role === "student") {
    return {
      success: true,
      role: "student",
      openid: identity.openid,
      student: sanitizeStudent(identity.student, false),
      message: "当前微信已经绑定学生",
    };
  }

  const res = await db.collection("students").where({ accessCode }).limit(1).get();
  if (!res.data || !res.data.length) {
    throw createError("ACCESS_CODE_NOT_FOUND", "accessCode 不正确");
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
      throw createError("ACCESS_CODE_NOT_FOUND", "accessCode 不正确");
    }
    if (openIdLock && openIdLock.studentId && openIdLock.studentId !== currentStudent._id) {
      throw createError("ALREADY_BOUND", "当前微信已经绑定其他学生");
    }

    const studentOpenIds = getStudentOpenIds(currentStudent);
    const bindLimit = getStudentBindLimit(currentStudent.accessCode);
    if (
      studentOpenIds.indexOf(identity.openid) < 0
      && Number.isFinite(bindLimit)
      && studentOpenIds.length >= bindLimit
    ) {
      throw createError("ACCESS_CODE_USED", `这个 accessCode 最多只能绑定 ${bindLimit} 个微信`);
    }
    const nextStudentOpenIds = uniqueValues(studentOpenIds.concat(identity.openid));
    const nextStudentOpenId = currentStudent.studentOpenId || identity.openid;

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

const listStudents = async () => {
  await ensureTeacher();
  const res = await db.collection("students").orderBy("createdAt", "desc").get();
  const students = await attachSyncedLessonCounts(res.data || []);
  return {
    success: true,
    role: "teacher",
    data: students.map((student) => sanitizeStudent(student, true)),
  };
};

const addStudent = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  const accessCode = normalizeCode(data.accessCode);
  if (!data.name || !data.grade || !accessCode) {
    throw createError("INVALID_STUDENT", "请填写学生姓名、年级和 accessCode");
  }
  if (isTeacherAccessCode(accessCode)) {
    throw createError("ACCESS_CODE_RESERVED", "学生 accessCode 不能与教师 accessCode 相同");
  }
  const existing = await db.collection("students").where({ accessCode }).limit(1).get();
  if (existing.data && existing.data.length) {
    throw createError("ACCESS_CODE_EXISTS", "这个 accessCode 已经存在");
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
    teacherName: data.teacherName || appConfig.teacherName,
    subject: data.subject || appConfig.defaultSubject,
    plannedLessonCount,
    completedLessonCount,
    recordedLessonCount: 0,
    vocabularyEnabled: false,
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
      throw createError("ACCESS_CODE_EXISTS", "这个 accessCode 已经存在");
    }
    if (
      initialStudentOpenId
      && (
        (openIdLock && openIdLock.studentId)
        || (legacyPrimaryOwner.data && legacyPrimaryOwner.data.length)
        || (legacyMultiOwner.data && legacyMultiOwner.data.length)
      )
    ) {
      throw createError("OPENID_EXISTS", "这个 studentOpenId 已经绑定其他学生");
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
    throw createError("INVALID_PROGRESS", "缺少学生 ID");
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
  await ensureTeacher();
  await createOneCollection("systemLocks");
  const inserted = [];
  const skipped = [];
  for (let i = 0; i < SEED_STUDENTS.length; i++) {
    const student = Object.assign({}, SEED_STUDENTS[i], {
      accessCode: normalizeCode(SEED_STUDENTS[i].accessCode),
      recordedLessonCount: 0,
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
    message: `新增 ${inserted.length} 位学生，跳过 ${skipped.length} 位已存在学生`,
  };
};

const getStudentDetail = async (event) => {
  const identity = await getIdentity();
  const data = event.data || {};
  if (data.mode === "teacherPreview" && identity.role !== "teacher") {
    throw createError("PERMISSION_DENIED", "只有朱老师可以使用学生视角预览");
  }
  const requestedId = data.previewStudentId || data.studentId;
  const studentId = identity.role === "student" ? identity.student._id : requestedId;
  if (!studentId) throw createError("INVALID_STUDENT", "缺少学生 ID");
  await ensureStudentAccess(studentId);

  const studentRes = await db.collection("students").doc(studentId).get();
  if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
  const student = await attachSyncedLessonCount(studentRes.data);
  const [lessons, analytics, vocabularyOverview] = await Promise.all([
    loadAllVocabularyDocuments("lessons", { studentId }, "lessonDate", "desc"),
    buildStudentAnalytics(studentId),
    buildStudentVocabularyOverview(student),
  ]);
  return {
    success: true,
    role: identity.role,
    student: sanitizeStudent(student, identity.role === "teacher"),
    vocabularyLevels: getVocabularyLibrary().levels.filter((level) => !level.isReferenceOnly),
    lessons,
    cycleStatus: buildCycleStatus(student),
    analytics,
    vocabularyOverview,
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
    weakPointSummary: weakPointTexts.length ? weakPointTexts.join("、") : "暂时没有明显薄弱题型",
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
  if (!studentId) throw createError("INVALID_STUDENT", "缺少学生 ID");
  await ensureStudentAccess(studentId);
  const studentRes = await db.collection("students").doc(studentId).get();
  if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
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
    throw createError("INVALID_VOCABULARY_SETTINGS", "请选择是否开启背单词功能");
  }
  if (!Array.isArray(data.levelIds)) {
    throw createError("INVALID_VOCABULARY_SETTINGS", "请选择基础词库范围");
  }
  const validLevelIds = new Set(
    library.levels.filter((level) => !level.isReferenceOnly).map((level) => level.id)
  );
  const levelIds = Array.from(new Set(data.levelIds.map((levelId) => String(levelId || "").trim())));
  if (levelIds.some((levelId) => !validLevelIds.has(levelId))) {
    throw createError("INVALID_VOCABULARY_SETTINGS", "选择的单词组无效，请刷新后重试");
  }
  const dailyGoal = Number(data.dailyGoal);
  if (
    !Number.isInteger(dailyGoal)
    || dailyGoal < vocabulary.MIN_DAILY_GOAL
    || dailyGoal > vocabulary.MAX_DAILY_GOAL
  ) {
    throw createError("INVALID_VOCABULARY_SETTINGS", "每日单词量应为 5 至 30 个");
  }
  if (typeof data.includeMistakeWords !== "boolean") {
    throw createError("INVALID_VOCABULARY_SETTINGS", "请选择是否加入错题单词");
  }
  if (data.enabled && !levelIds.length && !data.includeMistakeWords) {
    throw createError("INVALID_VOCABULARY_SETTINGS", "请至少开启错题单词或选择一个基础词库");
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
    throw createError("INVALID_VOCABULARY_SETTINGS", "请至少开启错题单词或选择一个基础词库");
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
  if (!studentId) throw createError("INVALID_STUDENT", "缺少学生 ID");
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

const setVocabularyDailyGoal = async (event) => {
  const identity = await getIdentity();
  if (identity.role !== "student" || !identity.student) {
    throw createError("PERMISSION_DENIED", "请使用学生账号选择今日单词数量");
  }
  const data = event.data || {};
  const studentId = String(data.studentId || "").trim();
  if (!studentId || studentId !== identity.student._id) {
    throw createError("PERMISSION_DENIED", "无权修改该学生的今日目标");
  }
  const dailyGoal = Number(data.dailyGoal);
  if (
    !Number.isInteger(dailyGoal)
    || dailyGoal < vocabulary.MIN_DAILY_GOAL
    || dailyGoal > vocabulary.MAX_DAILY_GOAL
  ) {
    throw createError("INVALID_VOCABULARY_SETTINGS", "今日目标应为 5 至 30 个");
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
        `今天已经完成 ${reviewedCount} 个，目标不能低于已完成数量`
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
  const fileIds = Array.from(new Set(
    listNames.flatMap((name) => (
      Array.isArray(result[name])
        ? result[name].map((word) => String(word.pronunciationFileId || "")).filter(Boolean)
        : []
    ))
  ));
  if (!fileIds.length) return result;

  try {
    const res = await cloud.getTempFileURL({ fileList: fileIds });
    const urlByFileId = new Map(
      (res.fileList || [])
        .filter((item) => item && item.status === 0 && item.fileID && item.tempFileURL)
        .map((item) => [String(item.fileID), String(item.tempFileURL)])
    );
    listNames.forEach((name) => {
      if (!Array.isArray(result[name])) return;
      result[name] = result[name].map((word) => Object.assign({}, word, {
        pronunciationUrl: urlByFileId.get(String(word.pronunciationFileId || "")) || "",
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
  if (identity.role === "guest") throw createError("PERMISSION_DENIED", "请先绑定学生身份");
  const data = event.data || {};
  const requestedStudentId = String(data.previewStudentId || data.studentId || "").trim();
  const studentId = identity.role === "student" ? identity.student._id : requestedStudentId;
  if (!studentId) throw createError("INVALID_STUDENT", "缺少学生 ID");
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
  if (!wordKey || !/^[a-z]+(?:['-][a-z]+)*(?: [a-z]+(?:['-][a-z]+)*)*$/.test(wordKey)) {
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
    throw createError("INVALID_VOCABULARY_WORD", "基础词已被隐藏，请刷新后继续学习");
  }
  const progressRes = await db.collection("vocabularyProgress")
    .where({ _id: progressId })
    .limit(1)
    .get();
  const progressItem = progressRes.data && progressRes.data.length ? progressRes.data[0] : null;
  if (progressItem && progressItem.excluded === true) {
    throw createError("INVALID_VOCABULARY_WORD", "这个单词已被老师移出词库，请刷新后重试");
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
    throw createError("INVALID_VOCABULARY_WORD", "这个单词不在当前已启用词库中，请刷新后重试");
  }
};

const reviewVocabularyWord = async (event) => {
  await Promise.all([
    createOneCollection("vocabularyProgress"),
    createOneCollection("vocabularyDailyStats"),
  ]);
  const identity = await getIdentity();
  if (identity.role !== "student" || !identity.student) {
    throw createError("PERMISSION_DENIED", "教师预览为只读，请使用学生账号复习");
  }
  const data = event.data || {};
  const studentId = String(data.studentId || "").trim();
  if (!studentId || studentId !== identity.student._id) {
    throw createError("PERMISSION_DENIED", "无权修改该学生的单词进度");
  }
  if (["forgot", "hard", "known", "easy"].indexOf(data.result) < 0) {
    throw createError("INVALID_VOCABULARY_REVIEW", "请选择忘记、困难、认识或太简单");
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
      throw createError("VOCABULARY_DAY_CHANGED", "学习日期已变化，请刷新后重试");
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
  if (!studentId) throw createError("INVALID_STUDENT", "缺少学生 ID");
  const studentRes = await db.collection("students").doc(studentId).get();
  if (!studentRes.data) throw createError("INVALID_STUDENT", "学生不存在或已删除");
  const wordKey = assertVocabularyWordKey(data.wordKey);
  const meaning = String(data.meaning || "").trim();
  const partOfSpeech = String(data.partOfSpeech || "").trim();
  if (meaning.length > 200 || partOfSpeech.length > 50) {
    throw createError("INVALID_VOCABULARY_WORD", "单词释义或词性过长");
  }
  if (typeof data.excluded !== "boolean") {
    throw createError("INVALID_VOCABULARY_WORD", "请选择保留或忽略这个单词");
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
  if (identity.role === "guest") throw createError("PERMISSION_DENIED", "请先绑定学生身份");

  const lessonCollection = db.collection("lessons");
  const res = studentId
    ? await lessonCollection.where({ studentId }).orderBy("lessonDate", "desc").get()
    : await lessonCollection.orderBy("lessonDate", "desc").get();
  return {
    success: true,
    role: identity.role,
    data: res.data || [],
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
    throw createError("INVALID_STUDENT", "缺少学生 ID");
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

const BOOKING_STATUSES = ["待确认", "已确认", "已取消"];
const BOOKING_NOTE_LIMIT = 300;
const MEETING_NO_LIMIT = 2000;
const LESSON_BOOKING_PAGE = "pages/lesson-bookings/index";
const LESSON_BOOKING_LIST_LIMIT = 100;
const LESSON_BOOKING_HISTORY_LIMIT = 30;
const NOTIFICATION_SENDING_LEASE_MS = 2 * 60 * 1000;
const subscriptionTemplateFieldCache = Object.create(null);

const getSubscriptionTemplateFields = async (templateId) => {
  if (subscriptionTemplateFieldCache[templateId]) {
    return subscriptionTemplateFieldCache[templateId];
  }
  const result = await cloud.openapi.subscribeMessage.getTemplateList({});
  const templates = Array.isArray(result)
    ? result
    : (result && (result.data || result.templateList || result.template_list || result.list)) || [];
  const template = templates.find((item) => {
    return String(item.priTmplId || item.pri_tmpl_id || item.templateId || item.template_id || "") === templateId;
  });
  if (!template) {
    throw createError("SUBSCRIPTION_TEMPLATE_NOT_FOUND", "订阅消息模板不存在，请重新选用模板");
  }
  const fields = Object.create(null);
  String(template.content || template.templateContent || template.template_content || "")
    .split(/\r?\n/)
    .forEach((line) => {
      const match = line.match(/^\s*([^:：{]+?)\s*[:：]?\s*\{\{\s*([0-9A-Za-z_]+)\.DATA\s*\}\}/);
      if (match) fields[match[1].trim()] = match[2];
    });
  subscriptionTemplateFieldCache[templateId] = fields;
  return fields;
};

const buildSubscriptionData = (fields, values) => {
  const data = {};
  Object.keys(values).forEach((label) => {
    const field = fields[label];
    if (!field) {
      throw createError("SUBSCRIPTION_FIELD_NOT_FOUND", `订阅消息模板缺少字段：${label}`);
    }
    data[field] = { value: String(values[label] || "") };
  });
  return data;
};

const formatSubscriptionDateTime = (dateValue, timeValue) => {
  const parts = String(dateValue || "").split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return `${dateValue || ""} ${timeValue || ""}`.trim();
  }
  return `${parts[0]}年${parts[1]}月${parts[2]}日 ${timeValue || ""}`.trim();
};

const getNotificationErrorText = (err) => {
  return String((err && (err.errMsg || err.message)) || "发送失败").slice(0, 180);
};

const getStoredTimestampMs = (numericValue, dateValue) => {
  const numeric = Number(numericValue);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  if (dateValue && typeof dateValue.getTime === "function") return dateValue.getTime();
  const parsed = Date.parse(dateValue);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isStaleNotificationClaim = (booking, prefix) => {
  const attemptedAtMs = getStoredTimestampMs(
    booking[`${prefix}NotifyAttemptedAtMs`],
    booking[`${prefix}NotifyAttemptedAt`]
  );
  return attemptedAtMs <= Date.now() - NOTIFICATION_SENDING_LEASE_MS;
};

const claimBookingConfirmationNotification = async (bookingId, expectedStartAtMs) => {
  const claimId = crypto.randomBytes(16).toString("hex");
  return db.runTransaction(async (transaction) => {
    const result = await transaction.collection("lessonBookings").doc(bookingId).get();
    const booking = result.data;
    const canClaim = booking && (
      booking.confirmationNotifyStatus === "pending"
      || (booking.confirmationNotifyStatus === "sending" && isStaleNotificationClaim(booking, "confirmation"))
    );
    if (
      !booking
      || booking.status !== "已确认"
      || Number(booking.confirmedStartAtMs) !== Number(expectedStartAtMs)
      || !canClaim
    ) {
      return null;
    }
    await transaction.collection("lessonBookings").doc(bookingId).update({
      data: {
        confirmationNotifyStatus: "sending",
        confirmationNotifyClaimId: claimId,
        confirmationNotifyAttemptedAt: db.serverDate(),
        confirmationNotifyAttemptedAtMs: Date.now(),
        confirmationNotifyAttemptCount: Number(booking.confirmationNotifyAttemptCount || 0) + 1,
        updatedAt: db.serverDate(),
      },
    });
    return Object.assign({}, booking, {
      _id: bookingId,
      confirmationNotifyClaimId: claimId,
    });
  });
};

const updateClaimedConfirmationNotification = async (bookingId, claimedBooking, data) => {
  return db.runTransaction(async (transaction) => {
    const result = await transaction.collection("lessonBookings").doc(bookingId).get();
    const booking = result.data;
    if (
      !booking
      || booking.confirmationNotifyStatus !== "sending"
      || !claimedBooking
      || !claimedBooking.confirmationNotifyClaimId
      || booking.confirmationNotifyClaimId !== claimedBooking.confirmationNotifyClaimId
      || Number(booking.confirmedStartAtMs) !== Number(claimedBooking.confirmedStartAtMs)
      || getBookingVersion(booking) !== getBookingVersion(claimedBooking)
    ) {
      return false;
    }
    await transaction.collection("lessonBookings").doc(bookingId).update({ data });
    return true;
  });
};

const sendBookingConfirmedNotification = async ({ booking, studentName, expectedStartAtMs }) => {
  const confirmationOpenId = booking.confirmationNotifyOpenId || booking.notifyOpenId;
  if (!booking.confirmationSubscribed || !confirmationOpenId) {
    return { status: "not_subscribed" };
  }
  const templateId = appConfig.subscriptionTemplates.lessonBookingConfirmed;
  let fields;
  try {
    fields = await getSubscriptionTemplateFields(templateId);
  } catch (err) {
    console.error("load booking notification template failed", err);
    return { status: "failed" };
  }
  const claimedBooking = await claimBookingConfirmationNotification(booking._id, expectedStartAtMs);
  if (!claimedBooking) {
    return { status: "skipped" };
  }

  try {
    await cloud.openapi.subscribeMessage.send({
      touser: claimedBooking.confirmationNotifyOpenId || claimedBooking.notifyOpenId,
      page: `${LESSON_BOOKING_PAGE}?bookingId=${encodeURIComponent(claimedBooking._id)}`,
      lang: "zh_CN",
      templateId,
      data: buildSubscriptionData(fields, {
        "预约名称": `${String(studentName || "学生").slice(0, 12)}英语课`,
        "现时状态": "已确认",
        "备注": claimedBooking.meetingNo
          ? "请打开小程序查看会议信息"
          : "时间已确认，会议信息稍后发布",
        "时间": formatSubscriptionDateTime(claimedBooking.confirmedDate, claimedBooking.confirmedTime),
      }),
    });
  } catch (err) {
    console.error("send booking confirmed notification failed", err);
    try {
      await updateClaimedConfirmationNotification(booking._id, claimedBooking, {
        confirmationNotifyStatus: "failed",
        confirmationNotifyClaimId: "",
        confirmationNotifyError: getNotificationErrorText(err),
        updatedAt: db.serverDate(),
      });
    } catch (updateErr) {
      console.error("record booking notification failure failed", updateErr);
    }
    return { status: "failed" };
  }

  try {
    await updateClaimedConfirmationNotification(booking._id, claimedBooking, {
      confirmationNotifyStatus: "sent",
      confirmationNotifyClaimId: "",
      confirmationNotifySentAt: db.serverDate(),
      confirmationNotifyError: "",
      confirmationNotifyOutdated: false,
      updatedAt: db.serverDate(),
    });
  } catch (err) {
    console.error("booking notification sent but status update failed", err);
  }
  return { status: "sent" };
};

const parseBookingDateTime = (dateValue, timeValue) => {
  const date = String(dateValue || "").trim();
  const time = String(timeValue || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw createError("INVALID_BOOKING_TIME", "请选择正确的上课日期和时间");
  }
  const dateParts = date.split("-").map(Number);
  const timeParts = time.split(":").map(Number);
  const year = dateParts[0];
  const month = dateParts[1];
  const day = dateParts[2];
  const hour = timeParts[0];
  const minute = timeParts[1];
  const dateCheck = new Date(Date.UTC(year, month - 1, day));
  if (
    dateCheck.getUTCFullYear() !== year ||
    dateCheck.getUTCMonth() !== month - 1 ||
    dateCheck.getUTCDate() !== day ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw createError("INVALID_BOOKING_TIME", "请选择正确的上课日期和时间");
  }
  return {
    date,
    time,
    timestamp: Date.UTC(year, month - 1, day, hour - 8, minute),
  };
};

const getBookingVersion = (booking) => {
  const version = Number(booking && booking.bookingVersion);
  return Number.isFinite(version) && version >= 0 ? version : 0;
};

const assertExpectedBookingVersion = (booking, expectedVersion) => {
  if (expectedVersion === undefined || expectedVersion === null || expectedVersion === "") return;
  if (Number(expectedVersion) !== getBookingVersion(booking)) {
    throw createError("BOOKING_CHANGED", "预约状态已变化，请刷新后重试");
  }
};

const isBookingNotificationSending = (booking) => {
  const confirmationSending = booking.confirmationNotifyStatus === "sending"
    && !isStaleNotificationClaim(booking, "confirmation");
  const reminderSending = booking.reminder10mNotifyStatus === "sending"
    && !isStaleNotificationClaim(booking, "reminder10m");
  return confirmationSending || reminderSending;
};

const getBookingStartAtMs = (booking) => {
  const stored = Number(booking && booking.confirmedStartAtMs);
  if (Number.isFinite(stored) && stored > 0) return stored;
  try {
    return parseBookingDateTime(
      (booking && (booking.confirmedDate || booking.requestedDate)) || "",
      (booking && (booking.confirmedTime || booking.requestedTime)) || ""
    ).timestamp;
  } catch (err) {
    return 0;
  }
};

const getBookingSlotId = (startAtMs) => `teacher_${Number(startAtMs)}`;

const getBookingRequestLockId = (studentId, dateValue, timeValue) => {
  const key = `${studentId}|${dateValue}|${timeValue}`;
  return `request_${crypto.createHash("sha1").update(key).digest("hex")}`;
};

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

const acquireBookingSlot = async (transaction, bookingId, startAtMs) => {
  const slotRef = transaction
    .collection("lessonBookings")
    .doc(getBookingSlotId(startAtMs));
  const slot = await getOptionalTransactionDocument(slotRef);
  if (slot && slot.bookingId && slot.bookingId !== bookingId) {
    const owner = await getOptionalTransactionDocument(
      transaction.collection("lessonBookings").doc(slot.bookingId)
    );
    if (
      owner
      && owner.status === "已确认"
      && Number(owner.confirmedStartAtMs) === Number(startAtMs)
    ) {
      throw createError("BOOKING_TIME_CONFLICT", "这个时间已有其他学生上课，请选择其他时间");
    }
  }
  await slotRef.set({
    data: {
      recordType: "bookingTimeSlot",
      bookingId,
      confirmedStartAtMs: Number(startAtMs),
      updatedAt: db.serverDate(),
    },
  });
};

const prepareLessonBooking = (booking) => {
  const status = BOOKING_STATUSES.indexOf(booking.status) >= 0 ? booking.status : "待确认";
  const startAtMs = getBookingStartAtMs(booking);
  const isPast = startAtMs > 0 && startAtMs <= Date.now();
  const bucket = status === "待确认"
    ? "pending"
    : status === "已确认" && !isPast
      ? "upcoming"
      : "history";
  return Object.assign({}, booking, {
    status,
    confirmedDate: booking.confirmedDate || booking.requestedDate || "",
    confirmedTime: booking.confirmedTime || booking.requestedTime || "",
    meetingNo: String(booking.meetingNo || ""),
    confirmedStartAtMs: startAtMs,
    bookingVersion: getBookingVersion(booking),
    isPast,
    bucket,
  });
};

const sortLessonBookings = (bookings) => {
  return (bookings || []).map(prepareLessonBooking).sort((a, b) => {
    const bucketRank = { pending: 0, upcoming: 1, history: 2 };
    const rankDiff = bucketRank[a.bucket] - bucketRank[b.bucket];
    if (rankDiff) return rankDiff;
    const timeA = getBookingStartAtMs(a);
    const timeB = getBookingStartAtMs(b);
    return a.bucket === "history" ? timeB - timeA : timeA - timeB;
  });
};

const sanitizeLessonBookingForClient = (booking) => {
  const safe = Object.assign({}, booking);
  [
    "notifyOpenId",
    "confirmationNotifyOpenId",
    "reminderNotifyOpenId",
    "createdByOpenId",
    "confirmationNotifyError",
    "confirmationNotifyClaimId",
    "confirmationNotifyAttemptedAt",
    "confirmationNotifyAttemptedAtMs",
    "confirmationNotifyAttemptCount",
    "reminder10mNotifyError",
    "reminder10mNotifyClaimId",
    "reminder10mNotifyAttemptedAt",
    "reminder10mNotifyAttemptedAtMs",
    "reminder10mNotifyAttemptCount",
    "reminder10mNotifyNextAttemptAtMs",
    "reminder10mNotifyDispatchStartedAtMs",
  ].forEach((field) => delete safe[field]);
  return safe;
};

const loadLessonBookingList = async (collection, studentId) => {
  const conditionFor = (status) => {
    return studentId ? { studentId, status } : { status };
  };
  const [pendingRes, confirmedRes, cancelledRes] = await Promise.all([
    collection.where(conditionFor("待确认")).limit(LESSON_BOOKING_LIST_LIMIT).get(),
    collection.where(conditionFor("已确认")).limit(LESSON_BOOKING_LIST_LIMIT).get(),
    collection.where(conditionFor("已取消")).limit(LESSON_BOOKING_HISTORY_LIMIT).get(),
  ]);
  return []
    .concat(pendingRes.data || [])
    .concat(confirmedRes.data || [])
    .concat(cancelledRes.data || []);
};

const submitLessonBooking = async (event) => {
  const identity = await getIdentity();
  const data = event.data || {};
  const isTeacherProxy = identity.role === "teacher" && data.mode === "teacherPreview";
  if (identity.role !== "student" && !isTeacherProxy) {
    throw createError("PERMISSION_DENIED", "请先绑定学生身份后再预约");
  }
  await createOneCollection("lessonBookings");
  const requested = parseBookingDateTime(data.requestedDate, data.requestedTime);
  if (requested.timestamp < Date.now() - 60 * 1000) {
    throw createError("INVALID_BOOKING_TIME", "期望上课时间不能早于现在");
  }
  const parentNote = String(data.parentNote || "").trim();
  if (parentNote.length > BOOKING_NOTE_LIMIT) {
    throw createError("INVALID_BOOKING_NOTE", `备注不能超过 ${BOOKING_NOTE_LIMIT} 个字`);
  }
  await assertContentSafe({ texts: [parentNote] });

  const studentId = identity.role === "student"
    ? identity.student._id
    : String(data.previewStudentId || "").trim();
  if (!studentId) throw createError("INVALID_STUDENT", "缺少预约学生 ID");
  let student = identity.student;
  if (isTeacherProxy) {
    const studentRes = await db.collection("students").doc(studentId).get();
    if (!studentRes.data) throw createError("INVALID_STUDENT", "预约学生不存在");
    student = studentRes.data;
  }
  const existingRes = await db.collection("lessonBookings").where({
    studentId,
    requestedDate: requested.date,
    requestedTime: requested.time,
  }).limit(20).get();
  const duplicate = (existingRes.data || []).find((item) => {
    return item.status !== "已取消" && item.requestedDate === requested.date && item.requestedTime === requested.time;
  });
  if (duplicate) {
    throw createError("BOOKING_EXISTS", "这个日期和时间已经提交过了");
  }

  const confirmationSubscribed = identity.role === "student" && data.confirmationSubscribed === true;
  const reminderSubscribed = identity.role === "student" && data.reminderSubscribed === true;
  const notifyOpenId = confirmationSubscribed || reminderSubscribed ? identity.openid : "";
  const bookingId = `booking_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
  const requestLockId = getBookingRequestLockId(studentId, requested.date, requested.time);
  const bookingData = {
    studentId,
    studentNameSnapshot: String((student && student.name) || ""),
    requestedDate: requested.date,
    requestedTime: requested.time,
    confirmedDate: "",
    confirmedTime: "",
    parentNote,
    meetingNo: "",
    status: "待确认",
    createdByOpenId: identity.openid,
    createdByRole: identity.role,
    notifyOpenId,
    confirmationNotifyOpenId: confirmationSubscribed ? identity.openid : "",
    reminderNotifyOpenId: reminderSubscribed ? identity.openid : "",
    confirmationSubscribed,
    reminderSubscribed,
    confirmationNotifyStatus: confirmationSubscribed ? "pending" : "not_subscribed",
    reminder10mNotifyStatus: reminderSubscribed ? "waiting_confirmation" : "not_subscribed",
    confirmedStartAtMs: 0,
    bookingVersion: 1,
    createdAt: db.serverDate(),
    updatedAt: db.serverDate(),
  };
  const addRes = await db.runTransaction(async (transaction) => {
    const lockRef = transaction.collection("lessonBookings").doc(requestLockId);
    const lock = await getOptionalTransactionDocument(lockRef);
    if (lock && lock.bookingId) {
      const lockedBooking = await getOptionalTransactionDocument(
        transaction.collection("lessonBookings").doc(lock.bookingId)
      );
      if (lockedBooking && lockedBooking.status !== "已取消") {
        throw createError("BOOKING_EXISTS", "这个日期和时间已经提交过了");
      }
    }
    await transaction.collection("lessonBookings").doc(bookingId).set({ data: bookingData });
    await lockRef.set({
      data: {
        recordType: "bookingRequestLock",
        bookingId,
        updatedAt: db.serverDate(),
      },
    });
    return { _id: bookingId };
  });
  return Object.assign({}, addRes, {
    success: true,
    confirmationSubscribed,
    reminderSubscribed,
  });
};

const listLessonBookings = async (event) => {
  const identity = await getIdentity();
  if (identity.role === "guest") {
    throw createError("PERMISSION_DENIED", "请先绑定身份");
  }
  const data = event.data || {};
  const isTeacherPreview = data.mode === "teacherPreview";
  if (isTeacherPreview && identity.role !== "teacher") {
    throw createError("PERMISSION_DENIED", "只有朱老师可以使用学生视角预览");
  }
  const previewStudentId = isTeacherPreview ? String(data.previewStudentId || "").trim() : "";
  if (isTeacherPreview && !previewStudentId) {
    throw createError("INVALID_STUDENT", "缺少预览学生 ID");
  }
  await createOneCollection("lessonBookings");
  const collection = db.collection("lessonBookings");
  const targetStudentId = identity.role === "student" ? identity.student._id : previewStudentId;
  const bookingDocuments = await loadLessonBookingList(collection, targetStudentId);
  const bookings = identity.role === "teacher" && !isTeacherPreview
    ? await attachStudentNames(bookingDocuments)
    : bookingDocuments;
  let student = identity.role === "student" ? identity.student : null;
  if (isTeacherPreview) {
    const studentRes = await db.collection("students").doc(previewStudentId).get();
    if (!studentRes.data) throw createError("INVALID_STUDENT", "预览学生不存在");
    student = studentRes.data;
  }
  const namedBookings = student
    ? bookings.map((item) => Object.assign({}, item, { studentName: student.name || "" }))
    : bookings;
  return {
    success: true,
    role: identity.role,
    isTeacherPreview,
    student: student ? sanitizeStudent(student, false) : null,
    data: sortLessonBookings(namedBookings).map(sanitizeLessonBookingForClient),
  };
};

const updateLessonBooking = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  if (!data.bookingId) throw createError("INVALID_BOOKING", "缺少预约 ID");
  const bookingRes = await db.collection("lessonBookings").doc(data.bookingId).get();
  if (!bookingRes.data) throw createError("BOOKING_NOT_FOUND", "预约不存在或已删除");
  const confirmed = parseBookingDateTime(
    data.confirmedDate || bookingRes.data.requestedDate,
    data.confirmedTime || bookingRes.data.requestedTime
  );
  if (confirmed.timestamp <= Date.now()) {
    throw createError("INVALID_BOOKING_TIME", "确认时间必须晚于现在");
  }
  const meetingNo = String(data.meetingNo || "").trim();
  if (meetingNo.length > MEETING_NO_LIMIT) {
    throw createError("INVALID_MEETING_NO", `会议信息不能超过 ${MEETING_NO_LIMIT} 个字`);
  }
  await assertContentSafe({ texts: [meetingNo] });
  // This query catches older confirmed bookings created before slot locks were introduced.
  const [timestampConflictRes, dateTimeConflictRes] = await Promise.all([
    db.collection("lessonBookings").where({ confirmedStartAtMs: confirmed.timestamp }).limit(20).get(),
    db.collection("lessonBookings").where({
      confirmedDate: confirmed.date,
      confirmedTime: confirmed.time,
    }).limit(20).get(),
  ]);
  const legacyConflict = []
    .concat(timestampConflictRes.data || [])
    .concat(dateTimeConflictRes.data || [])
    .find((item) => {
    return item._id !== data.bookingId && item.status === "已确认";
  });
  if (legacyConflict) {
    throw createError("BOOKING_TIME_CONFLICT", "这个时间已有其他学生上课，请选择其他时间");
  }

  const saved = await db.runTransaction(async (transaction) => {
    const currentRes = await transaction.collection("lessonBookings").doc(data.bookingId).get();
    const booking = currentRes.data;
    if (!booking) throw createError("BOOKING_NOT_FOUND", "预约不存在或已删除");
    if (booking.status === "已取消") {
      throw createError("BOOKING_CANCELLED", "预约已被取消，请刷新列表");
    }
    assertExpectedBookingVersion(booking, data.bookingVersion);
    if (booking.status === "已确认" && getBookingStartAtMs(booking) <= Date.now()) {
      throw createError("BOOKING_STARTED", "已开始或已结束的预约不能再修改");
    }
    if (isBookingNotificationSending(booking)) {
      throw createError("BOOKING_NOTIFICATION_SENDING", "微信提醒正在发送，请稍后再保存");
    }
    if (confirmed.timestamp <= Date.now()) {
      throw createError("INVALID_BOOKING_TIME", "确认时间必须晚于现在");
    }

    await acquireBookingSlot(transaction, data.bookingId, confirmed.timestamp);

    const wasConfirmed = booking.status === "已确认";
    const previousStartAtMs = getBookingStartAtMs(booking);
    const scheduleChanged = wasConfirmed && previousStartAtMs !== confirmed.timestamp;
    const previousReminderStatus = booking.reminder10mNotifyStatus || "not_subscribed";
    const reminderWasSentBeforeChange = scheduleChanged && previousReminderStatus === "sent";
    const reminderDeliveryUnknown = previousReminderStatus === "delivery_unknown";
    const schedulingStatus = previousReminderStatus === "sending"
      && isStaleNotificationClaim(booking, "reminder10m")
      ? "failed"
      : previousReminderStatus;
    const reminderCanBeScheduled = booking.reminderSubscribed
      && (booking.reminderNotifyOpenId || booking.notifyOpenId);
    const nextReminderStatus = reminderWasSentBeforeChange
      ? "reauthorization_required"
      : schedulingStatus === "reauthorization_required" || reminderDeliveryUnknown
        ? "reauthorization_required"
        : !reminderCanBeScheduled
          ? "not_subscribed"
          : !wasConfirmed || schedulingStatus === "expired" || schedulingStatus === "failed"
            ? "pending"
            : schedulingStatus;
    const startsNewReminderCycle = nextReminderStatus === "pending" && (
      !wasConfirmed || scheduleChanged || previousReminderStatus !== "pending"
    );
    const nextVersion = getBookingVersion(booking) + 1;
    const updateData = {
      confirmedDate: confirmed.date,
      confirmedTime: confirmed.time,
      confirmedStartAtMs: confirmed.timestamp,
      meetingNo,
      status: "已确认",
      reminderSubscribed: reminderWasSentBeforeChange || reminderDeliveryUnknown
        ? false
        : booking.reminderSubscribed === true,
      reminder10mNotifyStatus: nextReminderStatus,
      confirmationNotifyOutdated: booking.confirmationNotifyOutdated === true
        || (scheduleChanged && booking.confirmationNotifyStatus === "sent"),
      bookingVersion: nextVersion,
      updatedAt: db.serverDate(),
    };
    if (startsNewReminderCycle) {
      updateData.reminder10mNotifyAttemptCount = 0;
      updateData.reminder10mNotifyNextAttemptAtMs = 0;
      updateData.reminder10mNotifyClaimId = "";
      updateData.reminder10mNotifyError = "";
      updateData.reminder10mNotifyDispatchStartedAtMs = 0;
      updateData.reminder10mNotifyFailedAt = null;
      updateData.reminder10mNotifyExpiredAt = null;
      updateData.reminder10mNotifySentAt = null;
    }
    if (!wasConfirmed) updateData.confirmedAt = db.serverDate();
    if (scheduleChanged) updateData.scheduleChangedAt = db.serverDate();
    await transaction.collection("lessonBookings").doc(data.bookingId).update({ data: updateData });
    return {
      booking: Object.assign({}, booking, updateData, { _id: data.bookingId }),
      wasConfirmed,
      scheduleChanged,
      reminderReauthorizationRequired: nextReminderStatus === "reauthorization_required",
      bookingVersion: nextVersion,
    };
  });

  const booking = saved.booking;
  const confirmationNeedsRetry = booking.confirmationNotifyStatus === "pending"
    || (booking.confirmationNotifyStatus === "sending" && isStaleNotificationClaim(booking, "confirmation"));
  if (saved.wasConfirmed && !confirmationNeedsRetry) {
    return {
      success: true,
      notificationStatus: "unchanged",
      reminderStatus: booking.reminder10mNotifyStatus,
      scheduleChanged: saved.scheduleChanged,
      reminderReauthorizationRequired: saved.reminderReauthorizationRequired,
      bookingVersion: saved.bookingVersion,
    };
  }
  let studentName = String(booking.studentNameSnapshot || "");
  if (!studentName) {
    const studentRes = await db.collection("students").doc(booking.studentId).get();
    studentName = String((studentRes.data && studentRes.data.name) || "学生");
  }
  let notification = { status: "failed" };
  try {
    notification = await sendBookingConfirmedNotification({
      booking,
      studentName,
      expectedStartAtMs: confirmed.timestamp,
    });
  } catch (err) {
    console.error("booking saved but notification processing failed", err);
  }
  return {
    success: true,
    notificationStatus: notification.status,
    reminderStatus: booking.reminder10mNotifyStatus,
    scheduleChanged: saved.scheduleChanged,
    reminderReauthorizationRequired: saved.reminderReauthorizationRequired,
    bookingVersion: saved.bookingVersion,
  };
};

const subscribeLessonBookingNotifications = async (event) => {
  const identity = await getIdentity();
  if (identity.role !== "student") {
    throw createError("PERMISSION_DENIED", "请使用家长账号开启微信提醒");
  }
  const data = event.data || {};
  const bookingId = String(data.bookingId || "").trim();
  if (!bookingId) throw createError("INVALID_BOOKING", "缺少预约 ID");
  const confirmationAccepted = data.confirmationSubscribed === true;
  const reminderAccepted = data.reminderSubscribed === true;
  if (!confirmationAccepted && !reminderAccepted) {
    throw createError("SUBSCRIPTION_NOT_ACCEPTED", "没有开启新的微信提醒");
  }

  const saved = await db.runTransaction(async (transaction) => {
    const bookingRes = await transaction.collection("lessonBookings").doc(bookingId).get();
    const booking = bookingRes.data;
    if (!booking) throw createError("BOOKING_NOT_FOUND", "预约不存在或已删除");
    if (booking.studentId !== identity.student._id) {
      throw createError("PERMISSION_DENIED", "无权修改这个预约的提醒");
    }
    if (booking.status === "已取消") {
      throw createError("BOOKING_CANCELLED", "已取消的预约不能开启提醒");
    }
    if (isBookingNotificationSending(booking)) {
      throw createError("BOOKING_NOTIFICATION_SENDING", "微信提醒正在发送，请稍后重试");
    }

    const startAtMs = getBookingStartAtMs(booking);
    if (reminderAccepted && booking.status === "已确认" && startAtMs <= Date.now()) {
      throw createError("BOOKING_STARTED", "课程已经开始，不能再开启课前提醒");
    }
    // Subscription grants are monotonic. Do not reject a freshly granted one
    // just because the booking version changed while the WeChat dialog was open.
    const confirmationApplied = confirmationAccepted && booking.confirmationNotifyStatus !== "sent";
    const reminderApplied = reminderAccepted && booking.reminder10mNotifyStatus !== "sent";
    const nextVersion = getBookingVersion(booking) + 1;
    const updateData = {
      notifyOpenId: booking.notifyOpenId || identity.openid,
      confirmationNotifyOpenId: confirmationApplied
        ? identity.openid
        : booking.confirmationNotifyOpenId || "",
      reminderNotifyOpenId: reminderApplied
        ? identity.openid
        : booking.reminderNotifyOpenId || "",
      confirmationSubscribed: booking.confirmationSubscribed === true || confirmationApplied,
      reminderSubscribed: booking.reminderSubscribed === true || reminderApplied,
      confirmationNotifyStatus: confirmationApplied
        ? "pending"
        : booking.confirmationNotifyStatus || "not_subscribed",
      reminder10mNotifyStatus: reminderApplied
        ? booking.status === "已确认" ? "pending" : "waiting_confirmation"
        : booking.reminder10mNotifyStatus || "not_subscribed",
      bookingVersion: nextVersion,
      updatedAt: db.serverDate(),
    };
    if (reminderApplied) {
      updateData.reminder10mNotifyAttemptCount = 0;
      updateData.reminder10mNotifyNextAttemptAtMs = 0;
      updateData.reminder10mNotifyClaimId = "";
      updateData.reminder10mNotifyError = "";
      updateData.reminder10mNotifyDispatchStartedAtMs = 0;
      updateData.reminder10mNotifyFailedAt = null;
      updateData.reminder10mNotifyExpiredAt = null;
      updateData.reminder10mNotifySentAt = null;
    }
    await transaction.collection("lessonBookings").doc(bookingId).update({ data: updateData });
    return {
      booking: Object.assign({}, booking, updateData, { _id: bookingId }),
      confirmationAccepted: confirmationApplied,
      reminderAccepted: reminderApplied,
      bookingVersion: nextVersion,
    };
  });

  let confirmationStatus = saved.booking.confirmationNotifyStatus;
  if (
    saved.confirmationAccepted
    && saved.booking.status === "已确认"
    && saved.booking.confirmationNotifyStatus !== "sent"
  ) {
    let studentName = String(saved.booking.studentNameSnapshot || "");
    if (!studentName) {
      const studentRes = await db.collection("students").doc(saved.booking.studentId).get();
      studentName = String((studentRes.data && studentRes.data.name) || "学生");
    }
    const notification = await sendBookingConfirmedNotification({
      booking: saved.booking,
      studentName,
      expectedStartAtMs: saved.booking.confirmedStartAtMs,
    });
    confirmationStatus = notification.status;
  }
  return {
    success: true,
    confirmationSubscribed: saved.confirmationAccepted,
    reminderSubscribed: saved.reminderAccepted,
    confirmationStatus,
    reminderStatus: saved.booking.reminder10mNotifyStatus,
    bookingVersion: saved.bookingVersion,
  };
};

const cancelLessonBooking = async (event) => {
  const identity = await getIdentity();
  const data = event.data || {};
  const bookingId = data.bookingId;
  if (!bookingId) throw createError("INVALID_BOOKING", "缺少预约 ID");
  if (identity.role === "guest") throw createError("PERMISSION_DENIED", "请先绑定身份");
  return db.runTransaction(async (transaction) => {
    const bookingRes = await transaction.collection("lessonBookings").doc(bookingId).get();
    const booking = bookingRes.data;
    if (!booking) throw createError("BOOKING_NOT_FOUND", "预约不存在或已删除");
    if (identity.role === "student" && booking.studentId !== identity.student._id) {
      throw createError("PERMISSION_DENIED", "无权取消这个预约");
    }
    assertExpectedBookingVersion(booking, data.bookingVersion);
    if (booking.status === "已取消") {
      return { success: true, bookingVersion: getBookingVersion(booking) };
    }
    if (isBookingNotificationSending(booking)) {
      throw createError("BOOKING_NOTIFICATION_SENDING", "微信提醒正在发送，请稍后再取消");
    }
    if (
      identity.role === "student"
      && booking.status === "已确认"
      && getBookingStartAtMs(booking) <= Date.now()
    ) {
      throw createError("BOOKING_STARTED", "已开始或已结束的预约不能取消");
    }
    const nextVersion = getBookingVersion(booking) + 1;
    await transaction.collection("lessonBookings").doc(bookingId).update({
      data: {
        status: "已取消",
        confirmationNotifyStatus: booking.confirmationNotifyStatus === "sent" ? "sent" : "cancelled",
        reminder10mNotifyStatus: booking.reminder10mNotifyStatus === "sent" ? "sent" : "cancelled",
        bookingVersion: nextVersion,
        cancelledBy: identity.role,
        cancelledAt: db.serverDate(),
        updatedAt: db.serverDate(),
      },
    });
    return { success: true, bookingVersion: nextVersion };
  });
};

const normalizeLessonRequestPayload = (data = {}) => ({
  studentId: String(data.studentId || "").trim(),
  title: String(data.title || "").trim(),
  subject: String(data.subject || appConfig.defaultSubject || "").trim(),
  lessonDate: String(data.lessonDate || "").trim(),
  lessonNo: String(data.lessonNo || "").trim(),
  summary: String(data.summary || "").trim(),
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
    texts: [lessonPayload.title, lessonPayload.subject, lessonPayload.lessonNo, lessonPayload.summary],
  });
  await ensureStudentLessonCountSnapshot(lessonPayload.studentId);
  const requestId = String(data.requestId || "").trim().slice(0, 100);
  const lessonId = requestId
    ? `lesson_${crypto.createHash("sha1").update(`${lessonPayload.studentId}\n${requestId}`).digest("hex")}`
    : `lesson_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
  const requestFingerprint = getLessonRequestFingerprint(lessonPayload);
  const lessonData = {
    ...lessonPayload,
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
        throw createError("LESSON_CONFLICT", "表单内容已变化，请返回后重新提交课程");
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
    throw createError(errorCode, "课程不存在或与学生不匹配");
  }
  if (lesson.deleting === true) {
    throw createError(errorCode, "课程正在删除，请刷新后重试");
  }
  return lesson;
};

const deleteLesson = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  const lessonId = String(data.lessonId || "").trim();
  if (!lessonId) throw createError("INVALID_LESSON", "缺少课程 ID");

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
      throw createError("LESSON_CHANGED", "课程信息已变化，请刷新后重试");
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
    };
  }
  const lesson = deleteState.lesson;
  await ensureStudentLessonCountSnapshot(lesson.studentId);

  const [papers, lessonMistakes] = await Promise.all([
    loadAllLessonDocuments("papers", lessonId),
    loadAllLessonDocuments("mistakes", lessonId),
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

  await removeDocumentsById("mistakes", mistakes);
  await removeDocumentsById("papers", papers);
  await db.collection("lessons").doc(lessonId).remove();
  await deleteUnsafeFiles(paperFileIDs);
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
    completedLessonCount,
  };
};

const getLessonDetail = async (event) => {
  const data = event.data || {};
  const lessonId = data.lessonId;
  if (!lessonId) throw createError("INVALID_LESSON", "缺少课程 ID");
  const identity = await getIdentity();
  if (identity.role === "guest") throw createError("PERMISSION_DENIED", "请先绑定学生身份");
  if (data.mode === "teacherPreview" && identity.role !== "teacher") {
    throw createError("PERMISSION_DENIED", "只有朱老师可以使用学生视角预览");
  }

  const lessonRes = await db.collection("lessons").doc(lessonId).get();
  const lesson = lessonRes.data;
  if (!lesson) throw createError("LESSON_NOT_FOUND", "课程不存在或已删除");
  if (data.mode === "teacherPreview" && data.previewStudentId && lesson.studentId !== data.previewStudentId) {
    throw createError("PERMISSION_DENIED", "预览学生和课程不匹配");
  }
  await ensureStudentAccess(lesson.studentId);
  const [papers, lessonMistakes] = await Promise.all([
    loadAllLessonDocuments("papers", lessonId),
    loadAllLessonDocuments("mistakes", lessonId),
  ]);
  const mistakes = lessonMistakes.filter((item) => item.studentId === lesson.studentId);
  if (mistakes.length !== lessonMistakes.length) {
    console.warn("发现课程错题归属不一致，读取时已隔离", {
      lessonId,
      studentId: lesson.studentId,
      ignoredCount: lessonMistakes.length - mistakes.length,
    });
  }
  papers.sort((a, b) => getCreatedTime(b) - getCreatedTime(a));
  mistakes.sort((a, b) => getCreatedTime(b) - getCreatedTime(a));
  return {
    success: true,
    role: identity.role,
    lesson,
    papers,
    mistakes,
  };
};

const addPaper = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  if (!data.studentId || !data.lessonId || !data.fileID || !data.fileName || !data.type) {
    throw createError("INVALID_PAPER", "请上传资料并填写资料类型");
  }
  const lessonRes = await db.collection("lessons").doc(data.lessonId).get();
  if (!lessonRes.data || lessonRes.data.studentId !== data.studentId) {
    throw createError("INVALID_PAPER", "课程和学生不匹配");
  }
  try {
    await assertContentSafe({
      texts: [data.title, data.paperTitle, data.term, data.fileName],
      imageFileIds: data.type === "image" || data.type === "canva" ? [data.fileID] : [],
    });
  } catch (err) {
    if (err.code === "CONTENT_RISK") {
      await deleteUnsafeFiles([data.fileID]);
    }
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
    fileID: data.fileID,
    fileName: data.fileName,
    fileSize: data.fileSize || 0,
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

const checkUploadedImage = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  const fileID = data.fileID;
  if (!fileID) throw createError("INVALID_FILE", "缺少图片文件");
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
  if (identity.role === "guest") throw createError("PERMISSION_DENIED", "请先绑定学生身份");
  if (identity.role === "student") {
    query.studentId = identity.student._id;
  } else if (data.studentId) {
    query.studentId = data.studentId;
  }
  if (data.lessonId) query.lessonId = data.lessonId;
  if (query.studentId) await ensureStudentAccess(query.studentId);

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
    throw createError("INVALID_MISTAKE", "课程和学生不匹配");
  }
  if (!data.questionImageFileId && !data.questionText && !data.studentAnswer && !data.correctAnswer) {
    throw createError("INVALID_MISTAKE", "请上传题目图片或填写题目、答案");
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
    throw createError("INVALID_MISTAKE", "缺少错题、学生或课程信息");
  }
  if (!data.questionImageFileId && !data.questionText && !data.studentAnswer && !data.correctAnswer) {
    throw createError("INVALID_MISTAKE", "请上传题目图片或填写题目、答案");
  }
  const existingRes = await db.collection("mistakes").doc(data.mistakeId).get();
  if (!existingRes.data) throw createError("MISTAKE_NOT_FOUND", "错题不存在或已删除");
  const lessonRes = await db.collection("lessons").doc(data.lessonId).get();
  if (!lessonRes.data || lessonRes.data.studentId !== data.studentId) {
    throw createError("INVALID_MISTAKE", "课程和学生不匹配");
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
        throw createError("INVALID_MISTAKE", "原课程正在删除，请刷新后重试");
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
    throw createError("INVALID_MISTAKE", "缺少学生或课程信息");
  }
  if (!items.length || items.length > 50) {
    throw createError("INVALID_IMPORT", "每次请导入 1 至 50 道错题");
  }
  if (!importBatchId || importBatchId.length > 100) {
    throw createError("INVALID_IMPORT", "导入批次信息无效，请重新粘贴后再试");
  }
  if (!Number.isInteger(importItemOffset) || importItemOffset < 0 || importItemOffset + items.length > 50) {
    throw createError("INVALID_IMPORT", "导入分批序号无效，请重新导入");
  }
  const lessonRes = await db.collection("lessons").doc(data.lessonId).get();
  if (!lessonRes.data || lessonRes.data.studentId !== data.studentId) {
    throw createError("INVALID_IMPORT", "课程和学生不匹配");
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
    throw createError("INVALID_IMPORT", `第 ${importItemOffset + emptyIndex + 1} 道错题没有题目或答案内容`);
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
    throw createError("INVALID_MISTAKE", "请选择有效的复习状态");
  }
  const identity = await getIdentity();
  if (identity.role === "guest") throw createError("PERMISSION_DENIED", "请先绑定学生身份");
  const res = await db.collection("mistakes").doc(mistakeId).get();
  if (!res.data) throw createError("MISTAKE_NOT_FOUND", "错题不存在或已删除");
  await ensureStudentAccess(res.data.studentId);
  const authorizedStudentId = res.data.studentId;
  const reviewCount = await db.runTransaction(async (transaction) => {
    const ref = transaction.collection("mistakes").doc(mistakeId);
    const currentRes = await ref.get();
    const current = currentRes.data;
    if (!current) throw createError("MISTAKE_NOT_FOUND", "错题不存在或已删除");
    if (current.studentId !== authorizedStudentId) {
      throw createError("PERMISSION_DENIED", "无权修改该错题");
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
  if (!mistakeId) throw createError("INVALID_MISTAKE", "缺少错题 ID");
  const identity = await getIdentity();
  if (identity.role === "guest") throw createError("PERMISSION_DENIED", "请先绑定学生身份");

  const res = await db.collection("mistakes").doc(mistakeId).get();
  if (!res.data) throw createError("MISTAKE_NOT_FOUND", "错题不存在或已删除");
  await ensureStudentAccess(res.data.studentId);
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
  if (!mistakeId) throw createError("INVALID_MISTAKE", "缺少错题 ID");
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
        return await getHomeData();
      case "bindStudent":
      case "bindAccessCode":
        return await bindAccessCode(event);
      case "listStudents":
      case "selectRecord":
        return await listStudents();
      case "addStudent":
        return await addStudent(event);
      case "seedStudents":
        return await seedStudents();
      case "updateStudentProgress":
        return await updateStudentProgress(event);
      case "updateVocabularySettings":
        return await updateVocabularySettings(event);
      case "setVocabularyDailyGoal":
        return await setVocabularyDailyGoal(event);
      case "getVocabularyData":
        return await getVocabularyData(event);
      case "reviewVocabularyWord":
        return await reviewVocabularyWord(event);
      case "updateVocabularyWord":
        return await updateVocabularyWord(event);
      case "getStudentDetail":
        return await getStudentDetail(event);
      case "getStudentAnalytics":
        return await getStudentAnalytics(event);
      case "listLessons":
        return await listLessons(event);
      case "getNextLessonNo":
        return await getNextLessonNo(event);
      case "submitLessonBooking":
        return await submitLessonBooking(event);
      case "listLessonBookings":
        return await listLessonBookings(event);
      case "updateLessonBooking":
        return await updateLessonBooking(event);
      case "subscribeLessonBookingNotifications":
        return await subscribeLessonBookingNotifications(event);
      case "cancelLessonBooking":
        return await cancelLessonBooking(event);
      case "addLesson":
        return await addLesson(event);
      case "deleteLesson":
        return await deleteLesson(event);
      case "getLessonDetail":
        return await getLessonDetail(event);
      case "addPaper":
        return await addPaper(event);
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
          message: "Unknown function type",
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
