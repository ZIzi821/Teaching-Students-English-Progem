const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const COLLECTIONS = ["students", "lessons", "papers", "mistakes"];

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
    cloudPath: "class-mistake-book-code.png",
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

const listStudents = async () => {
  return await db.collection("students").orderBy("createdAt", "desc").get();
};

const addStudent = async (event) => {
  const data = event.data || {};
  const wxContext = cloud.getWXContext();
  return await db.collection("students").add({
    data: {
      name: data.name,
      nickname: data.nickname || "",
      grade: data.grade || "",
      parentName: data.parentName || "",
      status: data.status || "在读",
      teacherOpenId: wxContext.OPENID,
      createdAt: db.serverDate(),
    },
  });
};

const listLessons = async (event) => {
  const data = event.data || {};
  const query = data.studentId ? { studentId: data.studentId } : {};
  return await db.collection("lessons").where(query).orderBy("lessonDate", "desc").get();
};

const addLesson = async (event) => {
  const data = event.data || {};
  return await db.collection("lessons").add({
    data: {
      studentId: data.studentId,
      title: data.title,
      subject: data.subject,
      lessonDate: data.lessonDate,
      summary: data.summary || "",
      paperFileIds: data.paperFileIds || [],
      createdAt: db.serverDate(),
    },
  });
};

const listMistakes = async (event) => {
  const data = event.data || {};
  const query = {};
  if (data.studentId) query.studentId = data.studentId;
  if (data.lessonId) query.lessonId = data.lessonId;
  return await db.collection("mistakes").where(query).orderBy("createdAt", "desc").get();
};

const addMistake = async (event) => {
  const data = event.data || {};
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

exports.main = async (event) => {
  switch (event.type) {
    case "getOpenId":
      return await getOpenId();
    case "getMiniProgramCode":
      return await getMiniProgramCode();
    case "initCollections":
    case "createCollection":
      return await initCollections();
    case "listStudents":
    case "selectRecord":
      return await listStudents();
    case "addStudent":
      return await addStudent(event);
    case "listLessons":
      return await listLessons(event);
    case "addLesson":
      return await addLesson(event);
    case "listMistakes":
      return await listMistakes(event);
    case "addMistake":
      return await addMistake(event);
    default:
      return {
        success: false,
        message: "Unknown function type",
      };
  }
};
