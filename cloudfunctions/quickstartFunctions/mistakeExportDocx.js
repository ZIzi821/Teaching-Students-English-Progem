const normalizeText = (value, fallback = "") => {
  const text = String(value || "").trim();
  return text || fallback;
};

const buildMistakeExportDocx = async ({ student, lessons, mistakes, exportLabel, createdLabel }) => {
  // docx is a cloud dependency. Keep it lazy so pure business-rule tests do not require npm install.
  const {
    Document,
    HeadingLevel,
    PageBreak,
    Packer,
    Paragraph,
    TextRun,
  } = require("docx");
  const children = [];
  const addField = (label, value, fallback = "未填写") => {
    children.push(new Paragraph({
      spacing: { after: 100 },
      children: [
        new TextRun({ text: `${label}：`, bold: true }),
        new TextRun(normalizeText(value, fallback)),
      ],
    }));
  };
  children.push(new Paragraph({
    heading: HeadingLevel.TITLE,
    children: [new TextRun(`${normalizeText(student && student.name, "学生")}英语错题汇总`)],
  }));
  addField("导出时间", createdLabel);
  addField("课程范围", exportLabel);
  addField("错题数量", `${mistakes.length} 道`);
  children.push(new Paragraph({
    spacing: { before: 180, after: 260 },
    children: [new TextRun("第一部分保留完整题目与选项，第二部分集中列出答案和解析，方便交给 AI 继续生成复习试卷。")],
  }));

  const lessonsById = new Map(lessons.map((item) => [String(item._id), item]));
  const grouped = [];
  lessons.forEach((lesson) => {
    const rows = mistakes.filter((item) => String(item.lessonId) === String(lesson._id));
    if (rows.length) grouped.push({ lesson, rows });
  });

  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, text: "第一部分：错题题目" }));
  let sequence = 0;
  grouped.forEach(({ lesson, rows }) => {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, text: normalizeText(lesson.exportLabel, lesson.title || "英语课") }));
    rows.forEach((mistake) => {
      sequence += 1;
      const title = [
        `${sequence}.`,
        normalizeText(mistake.questionNo),
        normalizeText(mistake.paperSection),
        normalizeText(mistake.questionType),
      ].filter(Boolean).join(" ");
      children.push(new Paragraph({
        spacing: { before: 180, after: 100 },
        children: [new TextRun({ text: title || `${sequence}. 错题`, bold: true })],
      }));
      addField("题目与选项", mistake.questionText, "未填写题目文字");
      const tags = Array.isArray(mistake.skillTags) && mistake.skillTags.length
        ? mistake.skillTags
        : Array.isArray(mistake.tags) ? mistake.tags : [];
      if (tags.length) addField("知识点", tags.join("、"));
    });
  });

  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, text: "第二部分：答案与解析" }));
  sequence = 0;
  mistakes.forEach((mistake) => {
    sequence += 1;
    const lesson = lessonsById.get(String(mistake.lessonId)) || {};
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      text: `${sequence}. ${normalizeText(mistake.questionNo, "错题")} · ${normalizeText(lesson.title, "英语课")}`,
    }));
    addField("学生原答案", mistake.studentAnswer);
    addField("正确答案", mistake.correctAnswer);
    addField("解析", mistake.explanation);
    addField("错因", mistake.reason || mistake.mistakeReasonType);
    addField("复习状态", mistake.reviewStatus || mistake.status);
  });

  const document = new Document({
    creator: "朱老师英语课堂",
    title: `${normalizeText(student && student.name, "学生")}英语错题汇总`,
    description: "教师端导出的英语错题汇总",
    styles: {
      default: {
        document: {
          run: { font: "Microsoft YaHei", size: 22 },
          paragraph: { spacing: { line: 340, after: 80 } },
        },
      },
    },
    sections: [{ properties: {}, children }],
  });
  return Packer.toBuffer(document);
};

module.exports = {
  buildMistakeExportDocx,
};
