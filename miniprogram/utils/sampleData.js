const students = [
  {
    _id: "sample-student-1",
    name: "小明",
    nickname: "明明",
    grade: "三年级",
    parentName: "李女士",
    status: "在读",
    createdAt: "2026-06-01",
  },
  {
    _id: "sample-student-2",
    name: "小雨",
    nickname: "雨宝",
    grade: "四年级",
    parentName: "王先生",
    status: "在读",
    createdAt: "2026-06-10",
  },
];

const lessons = [
  {
    _id: "sample-lesson-1",
    studentId: "sample-student-1",
    title: "分数应用题复习",
    subject: "数学",
    lessonDate: "2026-06-20",
    summary: "复习分数加减法，重点讲解单位 1 和画线段图的方法。",
    paperFileIds: [],
    createdAt: "2026-06-20",
  },
  {
    _id: "sample-lesson-2",
    studentId: "sample-student-1",
    title: "阅读理解练习",
    subject: "语文",
    lessonDate: "2026-06-24",
    summary: "练习概括段落大意，提醒先找中心句再组织答案。",
    paperFileIds: [],
    createdAt: "2026-06-24",
  },
  {
    _id: "sample-lesson-3",
    studentId: "sample-student-2",
    title: "小数乘法练习",
    subject: "数学",
    lessonDate: "2026-06-22",
    summary: "检查小数点位置，训练估算结果是否合理。",
    paperFileIds: [],
    createdAt: "2026-06-22",
  },
];

const papers = [
  {
    _id: "sample-paper-1",
    studentId: "sample-student-1",
    lessonId: "sample-lesson-1",
    title: "分数应用题课堂练习",
    type: "练习",
    fileIds: [],
    createdAt: "2026-06-20",
  },
];

const mistakes = [
  {
    _id: "sample-mistake-1",
    studentId: "sample-student-1",
    lessonId: "sample-lesson-1",
    paperId: "sample-paper-1",
    questionImageFileId: "",
    questionTitle: "第 3 题：分数应用题",
    studentAnswer: "把两个分数直接相加，忘记统一单位 1。",
    correctAnswer: "先找出单位 1，再列式比较两部分数量关系。",
    explanation: "看到“比……多/少几分之几”时，先圈出被比较的量。画线段图后再列式，能减少漏乘或错加。",
    reason: "没有先判断单位 1，读题太快。",
    tags: ["单位1", "线段图", "分数应用题"],
    status: "待复习",
    createdAt: "2026-06-20",
  },
  {
    _id: "sample-mistake-2",
    studentId: "sample-student-1",
    lessonId: "sample-lesson-2",
    paperId: "",
    questionImageFileId: "",
    questionTitle: "阅读理解：概括段意",
    studentAnswer: "只抄了第一句话。",
    correctAnswer: "用自己的话概括人物做了什么，以及结果是什么。",
    explanation: "概括题不要求逐字抄原文，可以按“谁 + 做什么 + 结果/感受”的句式回答。",
    reason: "没有区分中心句和细节句。",
    tags: ["阅读理解", "概括"],
    status: "已讲解",
    createdAt: "2026-06-24",
  },
];

module.exports = {
  students,
  lessons,
  papers,
  mistakes,
};
