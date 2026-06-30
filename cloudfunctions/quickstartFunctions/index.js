const cloud = require("wx-server-sdk");
const appConfig = require("./config");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const COLLECTIONS = ["students", "lessons", "papers", "mistakes"];
const SEED_STUDENTS = [
  {
    name: "芮芮",
    nickname: "",
    grade: "三年级",
    parentName: "",
    status: "在读",
    accessCode: "RUIRUI-EN-4829",
    studentOpenId: "",
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

const normalizeCode = (code) => String(code || "").trim().toUpperCase();

const toNonNegativeNumber = (value, fieldName) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num < 0) {
    throw createError("INVALID_PROGRESS", `${fieldName} 必须是非负数字`);
  }
  return num;
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
      : "暂未设置总课时",
  };
};

const getOpenIdFromContext = () => cloud.getWXContext().OPENID;

const isTeacherOpenId = (openid) => appConfig.teacherOpenIds.indexOf(openid) >= 0;

const getBoundStudent = async (openid) => {
  const res = await db.collection("students").where({ studentOpenId: openid }).limit(1).get();
  return res.data && res.data.length ? res.data[0] : null;
};

const getIdentity = async () => {
  const openid = getOpenIdFromContext();
  if (isTeacherOpenId(openid)) {
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
    const students = studentsRes.data || [];
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
    const progress = buildProgress(identity.student);
    return {
      success: true,
      role: "student",
      openid: identity.openid,
      teacherName: appConfig.teacherName,
      currentStudent: sanitizeStudent(identity.student, false),
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
  const identity = await getIdentity();
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

  const accessCode = normalizeCode(event.data && event.data.accessCode);
  if (!accessCode) {
    throw createError("INVALID_ACCESS_CODE", "请输入专属 accessCode");
  }

  const res = await db.collection("students").where({ accessCode }).limit(1).get();
  if (!res.data || !res.data.length) {
    throw createError("ACCESS_CODE_NOT_FOUND", "没有找到对应学生，请检查 accessCode");
  }

  const student = res.data[0];
  if (student.studentOpenId && student.studentOpenId !== identity.openid) {
    throw createError("ACCESS_CODE_USED", "这个 accessCode 已经绑定了其他微信");
  }

  await db.collection("students").doc(student._id).update({
    data: {
      studentOpenId: identity.openid,
    },
  });

  return {
    success: true,
    role: "student",
    openid: identity.openid,
    student: sanitizeStudent(Object.assign({}, student, { studentOpenId: identity.openid }), false),
  };
};

const listStudents = async () => {
  await ensureTeacher();
  const res = await db.collection("students").orderBy("createdAt", "desc").get();
  return {
    success: true,
    role: "teacher",
    data: res.data.map((student) => sanitizeStudent(student, true)),
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
  const plannedLessonCount = toNonNegativeNumber(data.plannedLessonCount, "总课时");
  const completedLessonCount = toNonNegativeNumber(data.completedLessonCount, "已上课时");
  if (completedLessonCount > plannedLessonCount) {
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
  if (completedLessonCount > plannedLessonCount) {
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
  const lessonsRes = await db.collection("lessons").where({ studentId }).orderBy("lessonDate", "desc").get();
  return {
    success: true,
    role: identity.role,
    student: sanitizeStudent(studentRes.data, identity.role === "teacher"),
    lessons: lessonsRes.data || [],
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
  return await db.collection("lessons").add({
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
  return await db.collection("papers").add({
    data: {
      studentId: data.studentId,
      lessonId: data.lessonId,
      title: data.title || data.fileName,
      type: data.type,
      fileID: data.fileID,
      fileName: data.fileName,
      fileSize: data.fileSize || 0,
      createdAt: db.serverDate(),
    },
  });
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
  if (!data.studentId || !data.lessonId || !data.studentAnswer || !data.correctAnswer) {
    throw createError("INVALID_MISTAKE", "请填写学生、课程、学生答案和正确答案");
  }
  return await db.collection("mistakes").add({
    data: {
      studentId: data.studentId,
      lessonId: data.lessonId,
      paperId: data.paperId || "",
      questionImageFileId: data.questionImageFileId || "",
      studentAnswer: data.studentAnswer || "",
      correctAnswer: data.correctAnswer || "",
      explanation: data.explanation || "",
      reason: data.reason || "",
      tags: data.tags || [],
      status: data.status || "待复习",
      createdAt: db.serverDate(),
    },
  });
};

const getMistakeDetail = async (event) => {
  const mistakeId = event.data && event.data.mistakeId;
  if (!mistakeId) throw createError("INVALID_MISTAKE", "缺少错题 ID");
  const identity = await getIdentity();
  if (identity.role === "guest") throw createError("PERMISSION_DENIED", "请先绑定学生身份");

  const res = await db.collection("mistakes").doc(mistakeId).get();
  await ensureStudentAccess(res.data.studentId);
  return {
    success: true,
    role: identity.role,
    mistake: res.data,
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
        return await bindStudent(event);
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
      case "listMistakes":
        return await listMistakes(event);
      case "addMistake":
        return await addMistake(event);
      case "getMistakeDetail":
        return await getMistakeDetail(event);
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
