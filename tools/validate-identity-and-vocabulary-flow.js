const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const app = JSON.parse(read("miniprogram", "app.json"));
const backend = read("cloudfunctions", "quickstartFunctions", "index.js");
const homeJs = read("miniprogram", "pages", "index", "index.js");
const homeWxml = read("miniprogram", "pages", "index", "index.wxml");
const studentLearningFlow = read("miniprogram", "utils", "studentLearningFlow.js");
const detailWxml = read("miniprogram", "pages", "student-detail", "index.wxml");
const vocabularyWxml = read("miniprogram", "pages", "vocabulary", "index.wxml");
const studyJs = read("miniprogram", "pages", "vocabulary-study", "index.js");
const studyWxml = read("miniprogram", "pages", "vocabulary-study", "index.wxml");

assert(app.pages.includes("pages/vocabulary-study/index"), "focused vocabulary study page is not registered");
assert(homeJs.includes("/pages/vocabulary-study/index?studentId="), "student home does not open focused study first");
assert(
  homeWxml.includes("studentPrimaryAction.label") && studentLearningFlow.includes("① 开始背单词"),
  "student home is missing the first-step learning label"
);
assert(homeWxml.includes("退出绑定"), "home is missing the identity exit entry");
assert(detailWxml.includes("建议顺序：先背单词，再做小测"), "student detail does not explain learning order");
assert(!vocabularyWxml.includes("今天怎么学？"), "vocabulary overview duplicates the guided route from student home");
assert(vocabularyWxml.indexOf("单词明细") < vocabularyWxml.indexOf("搜索英文、中文或词性"), "search is not nested after the record entry");
assert(vocabularyWxml.includes("老师设置的每日目标"), "daily goal ownership is not explained");
assert(studyWxml.includes("想好了，查看答案"), "study page is missing active-recall answer reveal");
["forgot", "hard", "known", "easy"].forEach((rating) => {
  assert(studyWxml.includes(`data-result="${rating}"`), `study page is missing ${rating} rating`);
});
assert(studyJs.includes("words.push(Object.assign({}, word, { isRetry: true }))"), "weak words are not requeued in the same session");
assert(studyJs.includes("if (this.data.readOnly)"), "teacher preview does not have a read-only branch");
assert(studyJs.includes("prefetchAudioAhead") && studyJs.includes("includeFallback: true"), "focused study does not preload audio for both direct clips and sprite-only words");
assert(studyWxml.includes("audioPreloadLabel"), "focused study does not show whether pronunciation audio is being prepared");

let studyPage = null;
vm.runInNewContext(studyJs, {
  Page: (definition) => { studyPage = definition; },
  require: (modulePath) => {
    if (modulePath === "../../utils/vocabularyAudio") {
      return require(path.join(root, "miniprogram", "utils", "vocabularyAudio"));
    }
    if (modulePath === "../../utils/cloudError") {
      return require(path.join(root, "miniprogram", "utils", "cloudError"));
    }
    throw new Error(`Unexpected page dependency: ${modulePath}`);
  },
  wx: {
    showToast: () => {},
    vibrateShort: () => {},
  },
  console,
  setTimeout,
  clearTimeout,
  encodeURIComponent,
});
assert(studyPage, "study page did not register");
const studyInstance = Object.assign({}, studyPage, {
  data: Object.assign({}, studyPage.data, {
    words: [
      { key: "letter-a", word: "A", isRetry: false },
      { key: "letter-b", word: "B", isRetry: false },
    ],
    currentIndex: 0,
    currentWord: { key: "letter-a", word: "A", isRetry: false },
    resultCounts: { forgot: 0, hard: 0, known: 0, easy: 0 },
  }),
  setData(update, callback) {
    this.data = Object.assign({}, this.data, update);
    if (callback) callback();
  },
});
studyInstance.retryCounts = {};
studyInstance.finishRating("forgot", studyInstance.data.currentWord, false);
assert.strictEqual(studyInstance.data.words.length, 3, "forgotten word was not appended once");
assert.strictEqual(studyInstance.data.words[2].key, "letter-a");
assert.strictEqual(studyInstance.data.currentWord.key, "letter-b", "study flow did not advance to the next word");
studyInstance.setData({ currentIndex: 2, currentWord: studyInstance.data.words[2], answerShown: true });
studyInstance.finishRating("hard", studyInstance.data.currentWord, false);
assert.strictEqual(studyInstance.data.words.length, 3, "retry word was appended more than once");
assert.strictEqual(studyInstance.data.sessionDone, true, "session did not finish after the single retry");

assert(backend.includes("const DEFAULT_STUDENT_BIND_LIMIT = 5;"), "default student bind limit is not five");
assert(backend.includes("return DEFAULT_STUDENT_BIND_LIMIT;"), "ordinary access codes do not use the default bind limit");
assert(backend.includes('mode: "signedOut"'), "identity exit mode is missing");
assert(backend.includes('case "unbindIdentity"'), "unbindIdentity cloud action is not registered");
assert(backend.includes('case "reviewVocabularyQuizAnswer"'), "objective quiz review action is missing");
assert(backend.includes('case "completeVocabularyQuiz"'), "quiz session action is missing");
assert(backend.includes('mode: "student"'), "teacher-to-student identity override is missing");
assert(backend.indexOf('identityMode.mode === "signedOut"') < backend.indexOf("isTeacherOpenId(openid)"), "teacher whitelist is evaluated before signed-out mode");
assert(backend.includes("[a-z0-9]+"), "beginner number word keys are not accepted by review validation");

console.log("identity and vocabulary flow validation passed");
