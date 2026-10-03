const assert = require("assert");
const recordingFeedback = require("../recordingFeedback");

const approved = recordingFeedback.normalizeRecordingFeedback({
  status: "朗读正确",
  teacherFeedbackTags: ["发音准确", "注意尾音", "发音准确", "句子读完整", "未知标签"],
  teacherFeedbackNote: "  今天的句子比上次更连贯。  ",
});
assert.strictEqual(approved.status, "朗读正确");
assert.deepStrictEqual(approved.tags, ["发音准确", "注意尾音"]);
assert.strictEqual(approved.note, "今天的句子比上次更连贯。");
assert.strictEqual(approved.text, "发音准确、注意尾音；今天的句子比上次更连贯。");

const retry = recordingFeedback.normalizeRecordingFeedback({
  status: "需要重录",
  teacherFeedbackTags: [
    "发音准确",
    "注意尾音",
    "注意单词重音",
    "语速再慢一点",
    "句子读完整",
    "声音清楚",
    "注意尾音",
  ],
  teacherFeedbackNote: "请把最后一句重新读一遍。",
});
assert.strictEqual(retry.status, "需要重录");
assert.deepStrictEqual(retry.tags, ["注意尾音", "注意单词重音", "语速再慢一点", "句子读完整"]);
assert.strictEqual(retry.text, "注意尾音、注意单词重音、语速再慢一点、句子读完整；请把最后一句重新读一遍。");

const legacy = recordingFeedback.normalizeRecordingFeedback({
  status: "朗读正确",
  teacherFeedback: "旧版教师短评",
});
assert.deepStrictEqual(legacy.tags, []);
assert.strictEqual(legacy.note, "旧版教师短评");
assert.strictEqual(legacy.text, "旧版教师短评");

const longNote = recordingFeedback.normalizeRecordingFeedback({
  status: "其他状态",
  teacherFeedbackTags: ["发音准确"],
  teacherFeedbackNote: "好".repeat(400),
});
assert.strictEqual(longNote.status, "朗读正确");
assert.strictEqual(longNote.note.length, recordingFeedback.MAX_FEEDBACK_NOTE_LENGTH);
assert(longNote.text.length <= 500);

console.log("recordingFeedback.test.js: passed");
