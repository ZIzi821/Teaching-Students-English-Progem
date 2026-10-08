const getImageInfo = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (
    buffer.length >= 24
    && buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { type: "png", width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 10 && buffer.slice(0, 3).toString("ascii") === "GIF") {
    return { type: "gif", width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (buffer.slice(0, 2).toString("ascii") === "BM" && buffer.length >= 26) {
    return { type: "bmp", width: buffer.readUInt32LE(18), height: Math.abs(buffer.readInt32LE(22)) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const blockLength = buffer.readUInt16BE(offset + 2);
      if (blockLength < 2 || offset + blockLength + 2 > buffer.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return {
          type: "jpg",
          width: buffer.readUInt16BE(offset + 7),
          height: buffer.readUInt16BE(offset + 5),
        };
      }
      offset += blockLength + 2;
    }
  }
  return null;
};

const fitImage = (width, height, maxWidth = 520, maxHeight = 620) => {
  const safeWidth = Math.max(1, Number(width) || maxWidth);
  const safeHeight = Math.max(1, Number(height) || Math.round(maxWidth * 0.7));
  const ratio = Math.min(maxWidth / safeWidth, maxHeight / safeHeight, 1);
  return {
    width: Math.max(1, Math.round(safeWidth * ratio)),
    height: Math.max(1, Math.round(safeHeight * ratio)),
  };
};

const normalizeText = (value, fallback = "") => {
  const text = String(value || "").trim();
  return text || fallback;
};

const buildMistakeExportDocx = async ({ student, lessons, mistakes, imageBuffers, exportLabel, createdLabel }) => {
  // docx is a cloud dependency. Keep it lazy so pure business-rule tests do not require npm install.
  const {
    Document,
    HeadingLevel,
    ImageRun,
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
    children: [new TextRun("第一部分保留题目与原图，第二部分集中列出答案和解析，方便交给 AI 继续生成复习试卷。")],
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
      if (normalizeText(mistake.questionText)) addField("题目文字", mistake.questionText);
      const tags = Array.isArray(mistake.skillTags) && mistake.skillTags.length
        ? mistake.skillTags
        : Array.isArray(mistake.tags) ? mistake.tags : [];
      if (tags.length) addField("知识点", tags.join("、"));
      const imageBuffer = imageBuffers.get(String(mistake._id));
      if (imageBuffer) {
        const info = getImageInfo(imageBuffer);
        if (!info) {
          const err = new Error(`错题 ${normalizeText(mistake.questionNo, String(sequence))} 的图片格式暂不支持，请重新上传 PNG 或 JPG 后再导出`);
          err.code = "UNSUPPORTED_EXPORT_IMAGE";
          throw err;
        }
        children.push(new Paragraph({
          spacing: { before: 80, after: 180 },
          children: [new ImageRun({
            data: imageBuffer,
            type: info.type,
            transformation: fitImage(info.width, info.height),
            altText: {
              title: `错题 ${sequence}`,
              description: normalizeText(mistake.questionText, "错题图片"),
              name: `mistake-${sequence}`,
            },
          })],
        }));
      }
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
  fitImage,
  getImageInfo,
};
