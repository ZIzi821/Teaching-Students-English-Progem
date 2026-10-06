const assert = require("assert");

const sdkPath = require.resolve("wx-server-sdk");
const configPath = require.resolve("../config");
const indexPath = require.resolve("../index");
const originalSdk = require.cache[sdkPath];
const originalConfig = require.cache[configPath];
const originalIndex = require.cache[indexPath];

const makeBusyError = () => {
  const err = new Error("document.get:fail -501001 Transaction Busy. Transaction is busy.");
  err.errCode = -501001;
  return err;
};

const mistakes = new Map();
const lesson = { _id: "lesson-1", studentId: "student-1" };
const getCollection = (name) => ({
  doc: (id) => ({
    get: async () => ({
      data: name === "lessons" && id === lesson._id
        ? lesson
        : name === "mistakes"
          ? (mistakes.get(id) || null)
          : null,
    }),
    set: async ({ data }) => {
      if (name === "mistakes") mistakes.set(id, Object.assign({ _id: id }, data));
    },
    update: async () => {},
    remove: async () => {},
  }),
  where: (query) => ({
    limit: () => ({
      get: async () => {
        if (name === "mistakes" && query && query.importBatchId) {
          return {
            data: Array.from(mistakes.values()).filter((item) => (
              item.importBatchId === query.importBatchId
              && item.studentId === query.studentId
              && item.lessonId === query.lessonId
            )),
          };
        }
        return { data: [] };
      },
    }),
  }),
  get: async () => ({ data: [] }),
});

let transactionCalls = 0;
const db = {
  collection: getCollection,
  serverDate: () => ({ serverDate: true }),
  runTransaction: async (callback) => {
    transactionCalls += 1;
    if (transactionCalls === 1) throw makeBusyError();
    return callback({ collection: getCollection });
  },
};

const cloud = {
  DYNAMIC_CURRENT_ENV: "current",
  init: () => {},
  database: () => db,
  getWXContext: () => ({ OPENID: "teacher-openid" }),
  deleteFile: async () => {},
  downloadFile: async () => ({ fileContent: Buffer.from("image") }),
  openapi: {
    security: {
      msgSecCheck: async () => ({ errCode: 0, result: { suggest: "pass" } }),
      imgSecCheck: async () => ({ errCode: 0, result: { suggest: "pass" } }),
    },
  },
};

require.cache[sdkPath] = { id: sdkPath, filename: sdkPath, loaded: true, exports: cloud };
require.cache[configPath] = {
  id: configPath,
  filename: configPath,
  loaded: true,
  exports: {
    teacherOpenIds: ["teacher-openid"],
    teacherAccessCode: "TEACHER",
    teacherName: "测试老师",
    defaultSubject: "English",
    sharedStudentAccessCodes: [],
    unlimitedStudentAccessCodes: [],
    seedStudents: [],
    subscriptionTemplates: {},
  },
};
delete require.cache[indexPath];

const { main } = require("../index");

const restore = () => {
  if (originalSdk) require.cache[sdkPath] = originalSdk;
  else delete require.cache[sdkPath];
  if (originalConfig) require.cache[configPath] = originalConfig;
  else delete require.cache[configPath];
  if (originalIndex) require.cache[indexPath] = originalIndex;
  else delete require.cache[indexPath];
};

const run = async () => {
  const result = await main({
    type: "batchImportMistakes",
    data: {
      studentId: "student-1",
      lessonId: "lesson-1",
      importBatchId: "import-test",
      importItemOffset: 0,
      items: [{ questionNo: "1", questionText: "Hello", correctAnswer: "hello" }],
    },
  });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.addedCount, 1);
  assert.strictEqual(transactionCalls, 2, "the busy transaction should retry once");
  assert.strictEqual(mistakes.size, 1, "retry must create only one deterministic mistake record");
  console.log("batch import transaction retry test passed");
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(restore);
