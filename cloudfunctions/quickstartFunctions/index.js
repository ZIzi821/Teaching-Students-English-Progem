const cloud = require("wx-server-sdk");
const appConfig = require("./config");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const COLLECTIONS = ["students", "teachers", "lessons", "papers", "mistakes"];
const SHARED_STUDENT_LIMIT = 5;
const SHARED_STUDENT_ACCESS_CODES = ["RUIRUI-EN-4829", "XUANNAN-EN-7316"];
const UNLIMITED_STUDENT_ACCESS_CODES = ["JASON-PRC-0001"];
const DEFAULT_ANALYTICS_LIMIT = 100;
const UNCATEGORIZED_LABEL = "未分类";
const CONTENT_RISK_MESSAGE = "内容含违规信息，请修改后再提交";
const CONTENT_CHECK_UNAVAILABLE_MESSAGE = "内容安全检测暂时不可用，请稍后再试";
const TEXT_CHECK_CHUNK_SIZE = 1800;
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

const chunkText = (text) => {
  const chunks = [];
  for (let i = 0; i < text.length; i += TEXT_CHECK_CHUNK_SIZE) {
    chunks.push(text.slice(i, i + TEXT_CHECK_CHUNK_SIZE));
  }
  return chunks;
};

const checkTextContent = async (textItems) => {
  const texts = collectTextItems(textItems);
  if (!texts.length) return;
  const content = texts.join("\n");
  const chunks = chunkText(content);
  for (let i = 0; i < chunks.length; i++) {
    try {
      const res = await cloud.openapi.security.msgSecCheck({
        content: chunks[i],
        version: 2,
        scene: 1,
        openid: getOpenIdFromContext(),
      });
      if (isRiskySecurityResult(res)) {
        throw createError("CONTENT_RISK", CONTENT_RISK_MESSAGE);
      }
      if (!isSecurityPass(res)) {
        console.error("msgSecCheck unexpected result", res);
        throw createError("CONTENT_CHECK_FAILED", CONTENT_CHECK_UNAVAILABLE_MESSAGE);
      }
    } catch (err) {
      if (err.code === "CONTENT_RISK" || err.code === "CONTENT_CHECK_FAILED") throw err;
      if (err.errCode === 87014 || err.errcode === 87014) {
        throw createError("CONTENT_RISK", CONTENT_RISK_MESSAGE);
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
  try {
    await cloud.deleteFile({
      fileList: safeFileIDs,
    });
  } catch (err) {
    console.error("delete unsafe files failed", err);
  }
};

const assertContentSafe = async ({ texts, imageFileIds }) => {
  await checkTextContent(texts);
  const fileIDs = uniqueValues((imageFileIds || []).filter((fileID) => fileID));
  for (let i = 0; i < fileIDs.length; i++) {
    await checkImageFile(fileIDs[i]);
  }
};

const normalizeCode = (code) => String(code || "").trim().toUpperCase();

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
  if (!value) return 0;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value.getTime === "function") return value.getTime();
  if (typeof value === "object" && value.$date) {
    const parsed = Date.parse(value.$date);
    return Number.isNaN(parsed) ? 0 : parsed;
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
    },
  });
  return completedLessonCount;
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
  const results = [];
  for (let i = 0; i < COLLECTIONS.length; i++) {
    results.push(await createOneCollection(COLLECTIONS[i]));
  }
  return {
    success: true,
    collections: results,
  };
};

const attachStudentNames = async (lessons) => {
  const studentRes = await db.collection("students").get();
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

const getHomeData = async () => {
  const identity = await getIdentity();
  if (identity.role === "teacher") {
    const studentCount = await db.collection("students").count();
    const mistakeCount = await db.collection("mistakes").count();
    const studentsRes = await db.collection("students").get();
    const students = await attachSyncedLessonCounts(studentsRes.data || []);
    const progressOverview = summarizeProgress(students);
    const studentsProgress = students.map((student) => buildStudentProgressItem(student));
    const recentLessonRes = await db.collection("lessons").orderBy("lessonDate", "desc").limit(3).get();
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
      recentLessons: await attachStudentNames(recentLessonRes.data || []),
    };
  }

  if (identity.role === "student") {
    const studentId = identity.student._id;
    const mistakeCount = await db.collection("mistakes").where({ studentId }).count();
    const recentLessonRes = await db.collection("lessons").where({ studentId }).orderBy("lessonDate", "desc").limit(3).get();
    const syncedStudent = await attachSyncedLessonCount(identity.student);
    const progress = buildProgress(syncedStudent);
    return {
      success: true,
      role: "student",
      openid: identity.openid,
      teacherName: appConfig.teacherName,
      currentStudent: sanitizeStudent(syncedStudent, false),
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
  const studentOpenIds = getStudentOpenIds(student);
  const bindLimit = getStudentBindLimit(accessCode);
  if (studentOpenIds.indexOf(identity.openid) < 0 && Number.isFinite(bindLimit) && studentOpenIds.length >= bindLimit) {
    throw createError("ACCESS_CODE_USED", `这个 accessCode 最多只能绑定 ${bindLimit} 个微信`);
  }
  const nextStudentOpenIds = uniqueValues(studentOpenIds.concat(identity.openid));

  await db.collection("students").doc(student._id).update({
    data: {
      studentOpenId: student.studentOpenId || identity.openid,
      studentOpenIds: nextStudentOpenIds,
    },
  });

  return {
    success: true,
    role: "student",
    openid: identity.openid,
    student: sanitizeStudent(
      Object.assign({}, student, {
        studentOpenId: student.studentOpenId || identity.openid,
        studentOpenIds: nextStudentOpenIds,
      }),
      false
    ),
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
  return await db.collection("students").add({
    data: {
      name: data.name,
      nickname: data.nickname || "",
      grade: data.grade || "",
      parentName: data.parentName || "",
      status: data.status || "在读",
      accessCode,
      studentOpenId: data.studentOpenId || "",
      studentOpenIds: getStudentOpenIds({ studentOpenId: data.studentOpenId || "" }),
      teacherName: data.teacherName || appConfig.teacherName,
      subject: data.subject || appConfig.defaultSubject,
      plannedLessonCount,
      completedLessonCount,
      createdAt: db.serverDate(),
    },
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
  await db.collection("students").doc(data.studentId).update({
    data: {
      plannedLessonCount,
      completedLessonCount,
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
  const inserted = [];
  const skipped = [];
  for (let i = 0; i < SEED_STUDENTS.length; i++) {
    const student = Object.assign({}, SEED_STUDENTS[i], {
      accessCode: normalizeCode(SEED_STUDENTS[i].accessCode),
    });
    const existing = await db.collection("students").where({ accessCode: student.accessCode }).limit(1).get();
    if (existing.data && existing.data.length) {
      skipped.push({
        name: student.name,
        accessCode: student.accessCode,
      });
      continue;
    }
    await db.collection("students").add({
      data: Object.assign({}, student, {
        createdAt: db.serverDate(),
      }),
    });
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
  const student = await attachSyncedLessonCount(studentRes.data);
  const lessonsRes = await db.collection("lessons").where({ studentId }).orderBy("lessonDate", "desc").get();
  const analytics = await buildStudentAnalytics(studentId);
  return {
    success: true,
    role: identity.role,
    student: sanitizeStudent(student, identity.role === "teacher"),
    lessons: lessonsRes.data || [],
    cycleStatus: buildCycleStatus(student),
    analytics,
  };
};

const buildStudentAnalytics = async (studentId) => {
  const mistakesRes = await db.collection("mistakes").where({ studentId }).orderBy("createdAt", "desc").limit(DEFAULT_ANALYTICS_LIMIT).get();
  const mistakes = mistakesRes.data || [];
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
    if (mistake.lastReviewedAt && !lastReviewedAt) lastReviewedAt = mistake.lastReviewedAt;
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
  const student = await attachSyncedLessonCount(studentRes.data);
  return {
    success: true,
    role: identity.role,
    student: sanitizeStudent(student, identity.role === "teacher"),
    cycleStatus: buildCycleStatus(student),
    analytics: await buildStudentAnalytics(studentId),
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

const addLesson = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  if (!data.studentId || !data.title || !data.lessonDate) {
    throw createError("INVALID_LESSON", "请填写学生、课程标题和日期");
  }
  await assertContentSafe({
    texts: [data.title, data.subject, data.lessonNo, data.summary],
  });
  const addRes = await db.collection("lessons").add({
    data: {
      studentId: data.studentId,
      title: data.title,
      subject: data.subject || appConfig.defaultSubject,
      lessonDate: data.lessonDate,
      lessonNo: data.lessonNo || "",
      summary: data.summary || "",
      paperFileIds: data.paperFileIds || [],
      createdAt: db.serverDate(),
    },
  });
  const completedLessonCount = await syncStudentCompletedLessonCount(data.studentId);
  return Object.assign({}, addRes, {
    success: true,
    completedLessonCount,
  });
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
  if (data.mode === "teacherPreview" && data.previewStudentId && lesson.studentId !== data.previewStudentId) {
    throw createError("PERMISSION_DENIED", "预览学生和课程不匹配");
  }
  await ensureStudentAccess(lesson.studentId);
  const papersRes = await db.collection("papers").where({ lessonId }).orderBy("createdAt", "desc").get();
  const mistakesRes = await db.collection("mistakes").where({ lessonId }).orderBy("createdAt", "desc").get();
  return {
    success: true,
    role: identity.role,
    lesson,
    papers: papersRes.data || [],
    mistakes: mistakesRes.data || [],
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
  return await db.collection("papers").add({
    data: {
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
    },
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
      await deleteUnsafeFiles([fileID]);
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

const addMistake = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  if (!data.studentId || !data.lessonId) {
    throw createError("INVALID_MISTAKE", "请选择学生和课程");
  }
  if (!data.questionImageFileId && !data.studentAnswer && !data.correctAnswer) {
    throw createError("INVALID_MISTAKE", "请上传题目图片或填写答案");
  }
  const skillTags = normalizeTags(data.skillTags && data.skillTags.length ? data.skillTags : data.tags);
  const reviewStatus = data.reviewStatus || data.status || "待复习";
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
      ],
      imageFileIds: data.questionImageFileId ? [data.questionImageFileId] : [],
    });
  } catch (err) {
    if (err.code === "CONTENT_RISK") {
      await deleteUnsafeFiles([data.questionImageFileId]);
    }
    throw err;
  }
  return await db.collection("mistakes").add({
    data: {
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
      createdAt: db.serverDate(),
    },
  });
};

const updateMistake = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  if (!data.mistakeId || !data.studentId || !data.lessonId) {
    throw createError("INVALID_MISTAKE", "缺少错题、学生或课程信息");
  }
  if (!data.questionImageFileId && !data.studentAnswer && !data.correctAnswer) {
    throw createError("INVALID_MISTAKE", "请上传题目图片或填写答案");
  }
  const skillTags = normalizeTags(data.skillTags && data.skillTags.length ? data.skillTags : data.tags);
  const reviewStatus = data.reviewStatus || data.status || "待复习";
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
    ],
    imageFileIds: data.questionImageFileId ? [data.questionImageFileId] : [],
  });
  await db.collection("mistakes").doc(data.mistakeId).update({
    data: {
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
      updatedAt: db.serverDate(),
    },
  });
  return { success: true };
};

const batchImportMistakes = async (event) => {
  await ensureTeacher();
  const data = event.data || {};
  const items = Array.isArray(data.items) ? data.items : [];
  if (!data.studentId || !data.lessonId) {
    throw createError("INVALID_MISTAKE", "缺少学生或课程信息");
  }
  if (!items.length || items.length > 50) {
    throw createError("INVALID_IMPORT", "每次请导入 1 至 50 道错题");
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
    return {
      paperId: source.paperId || data.paperId || "",
      questionNo: String(source.questionNo || "").trim(),
      paperSection: String(source.paperSection || "").trim(),
      questionType: String(source.questionType || "").trim(),
      questionText: String(source.questionText || "").trim(),
      skillTags,
      mistakeReasonType: String(source.mistakeReasonType || "").trim(),
      studentAnswer,
      correctAnswer,
      explanation: String(source.explanation || "").trim(),
      reason: String(source.reason || source.mistakeReasonType || "").trim(),
      reviewStatus: ["待复习", "已复习", "已掌握"].indexOf(source.reviewStatus) >= 0 ? source.reviewStatus : "待复习",
      reviewPriority: ["高", "中", "低"].indexOf(source.reviewPriority) >= 0 ? source.reviewPriority : "中",
      entryStatus: studentAnswer && correctAnswer ? "已整理" : "待整理",
    };
  });
  const emptyIndex = safeItems.findIndex((item) => !item.questionText && !item.studentAnswer && !item.correctAnswer);
  if (emptyIndex >= 0) {
    throw createError("INVALID_IMPORT", `第 ${emptyIndex + 1} 道错题没有题目或答案内容`);
  }
  await assertContentSafe({
    texts: safeItems.map((item) => [
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
    ]),
  });
  for (let i = 0; i < safeItems.length; i++) {
    const item = safeItems[i];
    await db.collection("mistakes").add({
      data: {
        studentId: data.studentId,
        lessonId: data.lessonId,
        paperId: item.paperId,
        questionImageFileId: "",
        questionNo: item.questionNo,
        paperSection: item.paperSection,
        questionType: item.questionType,
        questionText: item.questionText,
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
        createdAt: db.serverDate(),
      },
    });
  }
  return { success: true, importedCount: safeItems.length };
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
  await ensureStudentAccess(res.data.studentId);
  const reviewCount = Number(res.data.reviewCount || 0) + 1;
  await db.collection("mistakes").doc(mistakeId).update({
    data: {
      reviewStatus,
      status: reviewStatus,
      reviewCount,
      lastReviewedAt: db.serverDate(),
    },
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
      case "getStudentDetail":
        return await getStudentDetail(event);
      case "getStudentAnalytics":
        return await getStudentAnalytics(event);
      case "listLessons":
        return await listLessons(event);
      case "getNextLessonNo":
        return await getNextLessonNo(event);
      case "addLesson":
        return await addLesson(event);
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
