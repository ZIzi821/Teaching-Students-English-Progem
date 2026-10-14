const assert = require("assert");
const { buildMistakeExportMarkdown } = require("../mistakeExportMarkdown");

const output = buildMistakeExportMarkdown({
  student: { name: "徐浩成" },
  lessons: [{ _id: "lesson-1", title: "单词阶段-1", exportLabel: "2026-10-08 · 单词阶段-1" }],
  mistakes: [{
    _id: "mistake-1",
    lessonId: "lesson-1",
    questionNo: "1",
    questionType: "选择题",
    questionText: "Choose the correct answer.",
    studentAnswer: "A",
    correctAnswer: "B",
    explanation: "根据上下文选择 B。",
    reason: "词义混淆",
    reviewStatus: "待复习",
    skillTags: ["词汇"],
  }],
  exportLabel: "全部课程（1 节）",
  createdLabel: "2026-10-08 12:00",
});

assert(output.includes("# 徐浩成英语错题汇总"));
assert(output.includes("## 第一部分：错题题目"));
assert(output.includes("## 第二部分：答案与解析"));
assert(output.includes("Choose the correct answer."));
assert(output.includes("正确答案：B"));
assert(output.includes("题目与选项"));
assert(!output.includes("原图"));

console.log("mistake export markdown tests passed");
