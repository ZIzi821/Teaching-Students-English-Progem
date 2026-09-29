const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const pageJs = fs.readFileSync(path.join(root, "miniprogram", "pages", "student-detail", "index.js"), "utf8");
const pageWxml = fs.readFileSync(path.join(root, "miniprogram", "pages", "student-detail", "index.wxml"), "utf8");

[
  "英语背单词功能",
  "加入英语错题单词",
  "每天跳过英语基础词",
  "英语课本和基础词库",
  "保存英语单词设置",
].forEach((label) => assert(pageWxml.includes(label), `Missing explicit English label: ${label}`));
assert(!pageWxml.includes(">允许学生背单词<"), "Ambiguous vocabulary switch label must not return");
assert(pageWxml.includes("切换后立即保存"), "Primary English vocabulary switch must explain immediate persistence");

const setByPath = (target, dataPath, value) => {
  const parts = dataPath.split(".");
  let cursor = target;
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== "object") cursor[part] = {};
    cursor = cursor[part];
  });
  cursor[parts[parts.length - 1]] = value;
};

const createPage = (callFunction) => {
  let definition;
  const toasts = [];
  const sandbox = {
    console: { log: console.log, warn: console.warn, error() {} },
    require(request) {
      if (request === "../../utils/lessonTemplates") {
        return require(path.join(root, "miniprogram", "utils", "lessonTemplates"));
      }
      throw new Error(`Unexpected page dependency: ${request}`);
    },
    Page: (value) => { definition = value; },
    wx: {
      cloud: { callFunction },
      showLoading() {},
      hideLoading() {},
      showToast(options) { toasts.push(options); },
    },
  };
  vm.runInNewContext(pageJs, sandbox);
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(updates, callback) {
      Object.keys(updates).forEach((key) => setByPath(this.data, key, updates[key]));
      if (typeof callback === "function") callback();
    },
    loadStudent() { this.reloaded = true; },
  });
  page.setData({
    isTeacher: true,
    student: { _id: "student-1" },
    "vocabularyForm.enabled": true,
    "vocabularyForm.levelIds": ["1A"],
    "vocabularyForm.dailyGoal": 8,
    "vocabularyForm.includeMistakeWords": true,
    "vocabularyForm.hideBasicWords": false,
    "vocabularyForm.learningOrder": "smart",
  });
  return { page, toasts };
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

const run = async () => {
  const calls = [];
  const success = createPage(async (request) => {
    calls.push(request);
    return { result: { success: true, enabled: request.data.data.enabled } };
  });
  success.page.onVocabularyEnabledChange({ detail: { value: false } });
  await flush();
  await flush();
  assert.strictEqual(calls.length, 1, "Changing the English vocabulary switch must save immediately");
  assert.strictEqual(calls[0].data.type, "updateVocabularySettings");
  assert.strictEqual(calls[0].data.data.studentId, "student-1");
  assert.strictEqual(calls[0].data.data.enabled, false);
  assert.strictEqual(success.page.data.vocabularyForm.enabled, false);
  assert.strictEqual(success.page.reloaded, true, "Successful save must reload persisted student settings");
  assert(success.toasts.some((item) => item.title === "英语背单词已关闭"));

  const failure = createPage(async () => ({ result: { success: false, message: "forced failure" } }));
  failure.page.onVocabularyEnabledChange({ detail: { value: false } });
  await flush();
  await flush();
  assert.strictEqual(
    failure.page.data.vocabularyForm.enabled,
    true,
    "A failed immediate save must roll the switch back to its persisted state"
  );

  console.log("Language feature settings validation passed: explicit English labels, immediate save, and rollback.");
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
