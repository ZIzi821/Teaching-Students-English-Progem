const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { getFriendlyCloudErrorMessage, isTransactionBusyError } = require("../miniprogram/utils/cloudError");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const backend = read("cloudfunctions/quickstartFunctions/index.js");
const studyPage = read("miniprogram/pages/vocabulary-study/index.js");
const detailPage = read("miniprogram/pages/vocabulary/index.js");

const busy = new Error("document.get:fail -501001 Transaction Busy. Transaction is busy.");
busy.errCode = -501001;
assert.strictEqual(isTransactionBusyError(busy), true);
assert.strictEqual(
  getFriendlyCloudErrorMessage(busy, "保存失败"),
  "云数据库暂时繁忙，已自动重试，请再点一次"
);
assert.strictEqual(getFriendlyCloudErrorMessage(new Error("自定义提示"), "保存失败"), "自定义提示");
assert.strictEqual(
  getFriendlyCloudErrorMessage(new Error("document.get:fail internal system error"), "保存失败"),
  "保存失败"
);

assert(backend.includes("const runVocabularyReviewTransaction"), "Vocabulary review retry wrapper is missing");
assert.strictEqual(
  (backend.match(/runVocabularyReviewTransaction\(async \(transaction\)/g) || []).length,
  2,
  "Both word ratings and quiz answers must use the retry wrapper"
);
assert(backend.includes('"TRANSACTION_BUSY"') && backend.includes("retryDelaysMs: [200, 500, 1000]"));
assert(studyPage.includes("getFriendlyCloudErrorMessage"), "Study page can still expose raw cloud errors");
assert(detailPage.includes("getFriendlyCloudErrorMessage"), "Vocabulary detail can still expose raw cloud errors");

console.log("vocabulary review retry validation passed");
