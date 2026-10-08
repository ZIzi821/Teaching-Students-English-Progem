const normalizeText = (value, fallback = "") => {
  const text = String(value || "").replace(/\r\n/g, "\n").trim();
  return text || fallback;
};

const headingText = (value, fallback = "") => normalizeText(value, fallback)
  .replace(/\s+/g, " ")
  .replace(/#/g, "＃");

const buildMistakeExportMarkdown = ({ student, lessons, mistakes, exportLabel, createdLabel }) => {
  const lessonById = new Map((lessons || []).map((item) => [String(item._id), item]));
  const lines = [
    `# ${headingText(student && student.name, "学生")}英语错题汇总`,
    "",
    `- 导出时间：${normalizeText(createdLabel, "未填写")}`,
    `- 课程范围：${normalizeText(exportLabel, "未填写")}`,
    `- 错题数量：${(mistakes || []).length} 道`,
    "",
    "> 第一部分只放题目，第二部分集中放答案与解析，适合直接粘贴或上传给 AI 生成复习试卷。带原图的题目会明确标注，请同时把相应原图交给 AI。",
    "",
    "## 第一部分：错题题目",
    "",
  ];

  (mistakes || []).forEach((mistake, index) => {
    const lesson = lessonById.get(String(mistake.lessonId)) || {};
    lines.push(`### ${index + 1}. ${headingText(mistake.questionNo, "错题")} · ${headingText(lesson.title, "英语课")}`);
    lines.push("");
    lines.push(`- 课程：${normalizeText(lesson.exportLabel, lesson.title || "英语课")}`);
    if (normalizeText(mistake.paperSection)) lines.push(`- 所属部分：${normalizeText(mistake.paperSection)}`);
    if (normalizeText(mistake.questionType)) lines.push(`- 题型：${normalizeText(mistake.questionType)}`);
    const tags = Array.isArray(mistake.skillTags) && mistake.skillTags.length
      ? mistake.skillTags
      : Array.isArray(mistake.tags) ? mistake.tags : [];
    if (tags.length) lines.push(`- 知识点：${tags.map((item) => normalizeText(item)).filter(Boolean).join("、")}`);
    lines.push("");
    lines.push("**题目文字**");
    lines.push("");
    lines.push(normalizeText(mistake.questionText, "未填写题目文字，请结合原题图片。"));
    if (normalizeText(mistake.questionImageFileId)) {
      lines.push("");
      lines.push("> 本题另有原题图片；向 AI 提问时请同时附上该题原图。 ");
    }
    lines.push("");
  });

  lines.push("## 第二部分：答案与解析", "");
  (mistakes || []).forEach((mistake, index) => {
    const lesson = lessonById.get(String(mistake.lessonId)) || {};
    lines.push(`### ${index + 1}. ${headingText(mistake.questionNo, "错题")} · ${headingText(lesson.title, "英语课")}`);
    lines.push("");
    lines.push(`- 学生原答案：${normalizeText(mistake.studentAnswer, "未填写")}`);
    lines.push(`- 正确答案：${normalizeText(mistake.correctAnswer, "未填写")}`);
    lines.push(`- 错因：${normalizeText(mistake.reason || mistake.mistakeReasonType, "未填写")}`);
    lines.push(`- 复习状态：${normalizeText(mistake.reviewStatus || mistake.status, "未填写")}`);
    lines.push("");
    lines.push("**解析**");
    lines.push("");
    lines.push(normalizeText(mistake.explanation, "未填写"));
    lines.push("");
  });

  return `${lines.join("\n").trim()}\n`;
};

module.exports = {
  buildMistakeExportMarkdown,
};
