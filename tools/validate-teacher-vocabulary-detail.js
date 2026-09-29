const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const app = JSON.parse(read("miniprogram/app.json"));
const homeJs = read("miniprogram/pages/index/index.js");
const homeWxml = read("miniprogram/pages/index/index.wxml");
const pageJs = read("miniprogram/pages/teacher-vocabulary-detail/index.js");
const pageWxml = read("miniprogram/pages/teacher-vocabulary-detail/index.wxml");
const backend = read("cloudfunctions/quickstartFunctions/index.js");
const vocabulary = read("cloudfunctions/quickstartFunctions/vocabulary.js");

assert(app.pages.includes("pages/teacher-vocabulary-detail/index"), "Teacher vocabulary detail page is not registered");
assert(homeWxml.includes('bindtap="goVocabularyDetail"'), "Teacher home is missing the vocabulary detail entry");
assert(homeJs.includes('/pages/teacher-vocabulary-detail/index'), "Teacher home does not navigate to vocabulary detail");
assert(pageJs.includes('type: "listStudents"'), "Vocabulary detail does not load the protected student list");
assert(pageJs.includes('type: "getVocabularyData"'), "Vocabulary detail does not load real vocabulary progress");
assert(pageJs.includes('masteryFilter: this.data.activeFilter'), "Vocabulary detail filters are not sent to the backend");
assert(pageWxml.includes("查看不会改变孩子的学习进度"), "Read-only teacher behavior is not explained");
assert(pageWxml.includes("复习表现") && pageWxml.includes("上次学习") && pageWxml.includes("下次复习"), "Word-level evidence is incomplete");
assert(backend.includes('masteryFilter === "due"'), "Backend due-word filtering is missing");
assert(backend.includes("word.reviewCount > 0 && word.isDue"), "Never-studied words can be misclassified as due");
assert(
  vocabulary.includes("unlearnedCount")
    && vocabulary.includes("reviewDueCount")
    && vocabulary.includes("activeLearningCount")
    && vocabulary.includes("strictMasteredCount"),
  "Teacher summary counts are incomplete"
);

console.log("Teacher vocabulary detail validation passed.");
