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
const studentPageJs = read("miniprogram/pages/vocabulary/index.js");
const studentPageWxml = read("miniprogram/pages/vocabulary/index.wxml");
const studentDetailJs = read("miniprogram/pages/student-detail/index.js");
const backend = read("cloudfunctions/quickstartFunctions/index.js");
const vocabulary = read("cloudfunctions/quickstartFunctions/vocabulary.js");
const yilinLibrary = read("cloudfunctions/quickstartFunctions/data/yilin-junior-old-words.json");

assert(app.pages.includes("pages/teacher-vocabulary-detail/index"), "Teacher vocabulary detail page is not registered");
assert(homeWxml.includes('bindtap="goVocabularyDetail"'), "Teacher home is missing the vocabulary detail entry");
assert(homeJs.includes('/pages/teacher-vocabulary-detail/index'), "Teacher home does not navigate to vocabulary detail");
assert(pageJs.includes('type: "getVocabularyCatalog"'), "Teacher catalog does not use the lightweight endpoint");
assert(!pageJs.includes('type: "getVocabularyData"'), "Teacher catalog still loads all vocabulary progress on entry");
assert(pageJs.includes("/pages/student-detail/index?id=") && pageJs.includes("section=vocabulary"), "Teacher catalog cannot open the existing vocabulary settings");
assert(pageWxml.includes("已配置词库") && pageWxml.includes("library.wordCount"), "Teacher catalog is missing per-library counts");
assert(pageWxml.includes("进入英语学习设置"), "Teacher catalog is missing the student management action");
assert(studentPageJs.includes("catalogMode") && studentPageJs.includes("loadVocabularyCatalog"), "Student catalog mode is missing");
assert(studentPageJs.includes('type: "getVocabularyCatalog"'), "Student catalog does not use the lightweight endpoint");
assert(studentPageJs.includes('type: "getVocabularyData"'), "Full vocabulary detail loading is missing");
assert(studentPageJs.includes('"view=detail"') && studentPageJs.includes('"tab=all"'), "Student cannot open all vocabulary details");
assert(studentPageWxml.includes("已开启的词库") && studentPageWxml.includes("查看全部单词"), "Student catalog content is incomplete");
assert(!studentPageWxml.includes("item.wordCount"), "Student catalog must not expose per-library counts");
assert(studentDetailJs.includes('params.push("view=detail", "tab=all")'), "Teacher management does not open the full detail view");
assert(studentDetailJs.includes('options.section === "vocabulary"'), "Vocabulary settings deep link is missing");
assert(backend.includes("const getVocabularyCatalog"), "Vocabulary catalog backend is missing");
assert(backend.includes('data.scope === "teacher"'), "Teacher catalog scope is not protected");
assert(backend.includes("delete safeItem.wordCount"), "Student catalog responses still expose teacher-only counts");
assert(
  vocabulary.includes("const buildVocabularyCatalog")
    && vocabulary.includes("wordCount: group.wordKeys.size"),
  "Static vocabulary catalog counts are missing"
);
assert(yilinLibrary.includes('"edition": "译林版 · 2012课标旧版"'), "Yilin legacy edition is not clearly named");

console.log("Teacher vocabulary detail validation passed.");
