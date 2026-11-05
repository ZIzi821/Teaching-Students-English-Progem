const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { loadSandboxCloud } = require("./sandbox-cloud");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const source = (...parts) => read("miniprogram", ...parts);
const requiredPages = [
  "pages/french-learning/index", "pages/french-dashboard/index", "pages/french-vocabulary/index",
  "pages/french-memory/index", "pages/french-grammar/index", "pages/french-expressions/index",
  "pages/french-shadowing/index", "pages/french-reading/index", "pages/french-writing/index",
];

const appConfig = JSON.parse(read("miniprogram", "app.json"));
requiredPages.forEach((page) => assert(appConfig.pages.includes(page), `French page is not registered: ${page}`));
requiredPages.forEach((page) => {
  assert(source(`${page}.js`).includes('require("../../utils/frenchPreview")'), `French page is missing preview context: ${page}`);
  assert(source(`${page}.wxml`).includes("<teacher-preview-banner"), `French page is missing the read-only preview banner: ${page}`);
});
const frenchPageSources = requiredPages.flatMap((page) => [source(`${page}.js`), source(`${page}.wxml`), source(`${page}.json`), source(`${page}.wxss`)]).join("\n");
assert(!/getRecorderManager|RecorderManager|startRecord|stopRecord|scope\.record|microphone|createMediaRecorder|recording/i.test(frenchPageSources), "French pages must not request recording or microphone access");

const learningWxml = source("pages", "french-learning", "index.wxml");
const learningJson = JSON.parse(source("pages", "french-learning", "index.json"));
const vocabularyJs = source("pages", "french-vocabulary", "index.js");
const vocabularyWxml = source("pages", "french-vocabulary", "index.wxml");
const dashboardWxml = source("pages", "french-dashboard", "index.wxml");
const dashboardJson = JSON.parse(source("pages", "french-dashboard", "index.json"));
const memoryWxml = source("pages", "french-memory", "index.wxml");
const expressionsJs = source("pages", "french-expressions", "index.js");
const shadowingJs = source("pages", "french-shadowing", "index.js");
const learningJs = source("pages", "french-learning", "index.js");
const homeWxml = source("pages", "index", "index.wxml");
const homeJs = source("pages", "index", "index.js");
const studentDetailWxml = source("pages", "student-detail", "index.wxml");
const studentDetailJs = source("pages", "student-detail", "index.js");
assert(homeWxml.includes('bindtap="goFrenchLearning"'), "Home page is missing the French entry");
assert(homeWxml.includes('wx:if="{{currentStudent.frenchLearningEnabled}}"'), "Student French entry is not guarded by frenchLearningEnabled");
assert(homeWxml.includes('bindtap="toggleStudentSwitcher"'), "Teacher home is missing the student-side switcher");
assert(homeJs.includes('mode=teacherPreview&previewStudentId='), "Teacher student-side switcher must open a read-only preview");
assert(!studentDetailWxml.includes("goLessonBookings") && !studentDetailJs.includes("goLessonBookings"), "Removed booking actions are still present");
assert(studentDetailJs.includes('type: "setFrenchLearningSettings"'), "Teacher French toggle is not wired");
assert(studentDetailJs.includes('type: "setMistakeLearningSettings"'), "Teacher English mistake toggle is not wired");
assert(studentDetailWxml.includes("英语错题整理功能"), "Teacher English settings must expose the mistake-learning switch");
assert(homeWxml.includes('wx:if="{{mistakeLearningEnabled}}"'), "Student English mistake entry must be feature-gated");

const backendJs = read("cloudfunctions", "quickstartFunctions", "index.js");
[
  "getFrenchLearningOverview", "getFrenchWords", "getFrenchReviewQueue", "reviewFrenchWord", "getFrenchWordMemory",
  "getFrenchDashboard", "getFrenchGrammar", "getFrenchExpressions", "getFrenchReadings", "getFrenchWritingActivities",
  "completeFrenchActivity", "getFrenchSentences", "completeFrenchSentence", "getFrenchAudioUrl",
  "setFrenchLearningSettings", "updateFrenchLearningPreferences",
].forEach((action) => assert(backendJs.includes(`case "${action}"`), `Missing dispatcher action: ${action}`));
assert(backendJs.includes('case "setMistakeLearningSettings"'), "Missing mistake-learning settings dispatcher action");

assert(vocabularyWxml.includes('data-level="{{item}}"'), "Vocabulary filter buttons must pass their selected level");
assert(vocabularyJs.includes("getFrenchReviewQueue") && vocabularyJs.includes("getFrenchWords"), "Vocabulary page must support review and browse requests");
assert(dashboardJson.usingComponents && dashboardJson.usingComponents["data-chart"], "Dashboard must register data-chart");
assert(dashboardWxml.includes("<data-chart"), "Dashboard must render data-chart visualizations");
assert(memoryWxml.includes('<data-chart type="line"'), "Memory page must render its retention curve as a line chart");
assert(learningJson.usingComponents && learningJson.usingComponents["data-chart"], "Learning center must register data-chart");
assert(learningWxml.includes('<data-chart type="line"'), "Learning center must render the personal memory curve");
assert(learningWxml.includes("DAILY MIX"), "Learning center must render the daily mixed-skill path");
assert(learningWxml.includes("LA PHRASE DU JOUR"), "Learning center must render the daily French phrase");
assert(learningWxml.includes("practice=difficult"), "Learning center must link to difficult-word practice without overwriting preview mode");
assert(!learningWxml.includes("当前主题"), "Learning center must not render the old topic cloud");
assert(vocabularyJs.includes('difficultyOnly: this.data.reviewMode === "difficult"'), "Vocabulary review must pass its selected practice mode independently of preview mode");
assert(expressionsJs.includes("audioRequestVersion"), "Expression audio must discard stale URL requests");
assert(shadowingJs.includes("audioRequestVersion"), "Shadowing audio must discard stale URL requests");
[learningJs, vocabularyJs, expressionsJs, shadowingJs].forEach((pageSource) => {
  assert(pageSource.includes("obeyMuteSwitch = false"), "French audio playback must not be silenced by the phone mute switch");
});
["french-grammar", "french-expressions", "french-shadowing", "french-reading", "french-writing", "french-dashboard"].forEach((route) => assert(learningWxml.includes(`/pages/${route}/index`), `French learning navigation is missing ${route}`));

const setByPath = (target, dataPath, value) => {
  const parts = dataPath.split(".");
  let cursor = target;
  parts.slice(0, -1).forEach((part) => { if (!cursor[part] || typeof cursor[part] !== "object") cursor[part] = {}; cursor = cursor[part]; });
  cursor[parts[parts.length - 1]] = value;
};

const loadVocabularyPage = (queue, counts) => {
  let definition;
  const audioContext = { onError() {}, stop() {}, destroy() {}, play() {} };
  const calls = [];
  const sandbox = {
    console, Page: (value) => { definition = value; },
    require: (request) => {
      if (request === "../../utils/frenchPreview") return require(path.join(root, "miniprogram", "utils", "frenchPreview"));
      if (request === "../../utils/cloud") return loadSandboxCloud(sandbox.wx);
      throw new Error(`Unexpected require: ${request}`);
    },
    wx: { createInnerAudioContext: () => audioContext, showToast() {}, cloud: { callFunction: async ({ data }) => { calls.push(data); return { result: { success: true, data: { enabled: true, queue, counts } } }; } } },
  };
  vm.runInNewContext(vocabularyJs, sandbox);
  assert(definition, "French vocabulary page did not register");
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)), setData(updates) { Object.keys(updates).forEach((key) => setByPath(this.data, key, updates[key])); } });
  return { page, calls };
};

const loadVocabularyPageWithCloud = (callFunction) => {
  let definition;
  const plays = [];
  const audioContext = {
    src: "",
    onError() {},
    stop() {},
    destroy() {},
    play() { plays.push(this.src); },
  };
  const sandbox = {
    console,
    Page: (value) => { definition = value; },
    require: (request) => {
      if (request === "../../utils/frenchPreview") return require(path.join(root, "miniprogram", "utils", "frenchPreview"));
      if (request === "../../utils/cloud") return loadSandboxCloud(sandbox.wx);
      throw new Error(`Unexpected require: ${request}`);
    },
    wx: { createInnerAudioContext: () => audioContext, showToast() {}, cloud: { callFunction } },
  };
  vm.runInNewContext(vocabularyJs, sandbox);
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(updates) { Object.keys(updates).forEach((key) => setByPath(this.data, key, updates[key])); },
  });
  return { page, plays };
};

const run = async () => {
  const words = [
    { id: "due-1", displayForm: "bonjour", meaningCN: "你好", cefrLevel: "A1", progress: { isDue: true } },
    { id: "new-1", displayForm: "merci", meaningCN: "谢谢", cefrLevel: "A1", progress: { isDue: false } },
    { id: "new-2", displayForm: "salut", meaningCN: "嗨", cefrLevel: "A1", progress: { isDue: false } },
  ];
  const { page, calls } = loadVocabularyPage(words, { dueToday: 1, new: 2 });
  page.onLoad(); page.onShow();
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(calls[0].type, "getFrenchReviewQueue", "Vocabulary page must use the review queue dispatcher");
  assert.strictEqual(calls[0].data.level, "A1");
  assert.strictEqual(calls[0].data.difficultyOnly, false);
  assert.deepStrictEqual(page.data.queue.map((item) => item.id), ["due-1", "new-1", "new-2"]);
  assert.strictEqual(page.data.currentWord.id, "due-1", "Queue should open on its first item");
  assert.strictEqual(page.data.roundHint, "到期 1 个 · 新词 2 个");
  assert.strictEqual(page.data.levels.join(","), "A1,A2,All");

  let resolveAudio;
  const pendingAudio = new Promise((resolve) => { resolveAudio = resolve; });
  const race = loadVocabularyPageWithCloud(({ data }) => {
    assert.strictEqual(data.type, "getFrenchAudioUrl");
    return pendingAudio;
  });
  race.page.onLoad();
  race.page.setData({
    queue: [
      { id: "first", audioKey: "first-audio" },
      { id: "second", audioKey: "second-audio" },
    ],
    currentIndex: 0,
    currentWord: { id: "first", audioKey: "first-audio" },
  });
  race.page.playAudio();
  race.page.move(1);
  resolveAudio({ result: { success: true, data: { tempUrl: "https://example.invalid/first.mp3" } } });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(race.plays, [], "A stale word-audio response must not play on the next card");
  console.log("French Phase 2 validation passed: routes, navigation, permissions, dispatcher, charts, filters, and queue contract.");
};
run().catch((err) => { console.error(err); process.exit(1); });
