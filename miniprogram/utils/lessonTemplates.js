const LESSON_TEMPLATE_OPTIONS = [
  {
    key: "general",
    label: "通用英语",
    shortLabel: "通用",
    description: "适合常规课程，记录学习内容、掌握情况和复习安排。",
    titlePlaceholder: "例如：Past Simple 过去式练习",
    recordingPlaceholder: "例如：朗读今天的 3 个目标句",
  },
  {
    key: "feng_beginner",
    label: "零基础夯实",
    shortLabel: "冯嘉文 · 零基础",
    description: "少量新内容＋反复提取，观察独立完成、提示后完成和暂时不会。",
    titlePlaceholder: "例如：字母 A–I 与数字 1–3 复习",
    recordingPlaceholder: "例如：依次朗读 A–I 和数字 1–3",
  },
  {
    key: "molly_oral_ket",
    label: "口语＋KET",
    shortLabel: "Molly · 口语＋KET",
    description: "优先记录口语输出与纠正点，再逐步加入 KET 听说读写技能。",
    titlePlaceholder: "例如：My school day 口语表达",
    recordingPlaceholder: "例如：用今天的目标表达说 5 句话",
  },
  {
    key: "vocabulary_coaching",
    label: "单词陪练",
    shortLabel: "单词陪练",
    description: "按实际分钟记录陪练时长，课程编号与课后整理保持简洁。",
    titlePlaceholder: "例如：单词陪练-1",
    recordingPlaceholder: "例如：朗读今天练习的单词",
    requiresLessonNo: false,
    showPostLessonRecord: false,
    requiresDurationMinutes: true,
  },
];

const findTemplate = (key) => LESSON_TEMPLATE_OPTIONS.find((item) => item.key === key)
  || LESSON_TEMPLATE_OPTIONS[0];

const inferLessonTemplateKey = (student) => {
  if (student && LESSON_TEMPLATE_OPTIONS.some((item) => item.key === student.lessonTemplateKey)) {
    return student.lessonTemplateKey;
  }
  const name = `${(student && student.name) || ""} ${(student && student.nickname) || ""}`
    .trim()
    .toLowerCase();
  if (name.indexOf("冯嘉文") >= 0) return "feng_beginner";
  if (name.indexOf("molly") >= 0) return "molly_oral_ket";
  return "general";
};

module.exports = {
  LESSON_TEMPLATE_OPTIONS,
  findTemplate,
  inferLessonTemplateKey,
};
