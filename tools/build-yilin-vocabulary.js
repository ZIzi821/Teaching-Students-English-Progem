const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_DIR = path.join(ROOT, "tmp", "yilin-vocabulary-sources");
const OUTPUT_PATH = path.join(
  ROOT,
  "cloudfunctions",
  "quickstartFunctions",
  "data",
  "yilin-junior-old-words.json"
);
const PRIMARY_PATH = path.join(
  ROOT,
  "cloudfunctions",
  "quickstartFunctions",
  "data",
  "primary-1-3-words.json"
);

const BOOKS = [
  { id: "yilin-old-7A", sourceId: "bk_754a11", verifiedSourceId: "16925722", grade: 7, semester: "A", label: "七年级上", order: 101 },
  { id: "yilin-old-7B", sourceId: "bk_9f9df0", verifiedSourceId: "16925725", grade: 7, semester: "B", label: "七年级下", order: 102 },
  { id: "yilin-old-8A", sourceId: "bk_47ff11", verifiedSourceId: "16925723", grade: 8, semester: "A", label: "八年级上", order: 103 },
  { id: "yilin-old-8B", sourceId: "bk_acb20c", verifiedSourceId: "16925724", grade: 8, semester: "B", label: "八年级下", order: 104 },
  { id: "yilin-old-9A", sourceId: "bk_004c6c", verifiedSourceId: "16925718", grade: 9, semester: "A", label: "九年级上", order: 105 },
  { id: "yilin-old-9B", sourceId: "bk_ca3cb4", verifiedSourceId: "16925720", grade: 9, semester: "B", label: "九年级下", order: 106 },
];

const VERIFIED_OVERRIDES = {
  "yilin-old-7A:d like": { meaning: "想，愿意", partOfSpeech: "phr." },
  "yilin-old-8A:spend time on sth": { meaning: "花时间做某事", partOfSpeech: "phr." },
  "yilin-old-8A:birdwatching": { meaning: "观鸟", partOfSpeech: "n." },
  "yilin-old-9A:have difficulty doing sth": { meaning: "做某事费劲", partOfSpeech: "phr." },
  "yilin-old-9A:have difficulty in doing sth": { meaning: "做某事费劲", partOfSpeech: "phr." },
  "yilin-old-9A:d rather": { meaning: "宁愿，更喜欢", partOfSpeech: "phr." },
  "yilin-old-9A:animal-lover": { meaning: "动物爱好者", partOfSpeech: "n." },
};

const decodeHtml = (value) => String(value || "")
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, "\"")
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
  .replace(/\r/g, "")
  .replace(/[ \t]+\n/g, "\n")
  .replace(/\n[ \t]+/g, "\n")
  .trim();

const normalizeKey = (value) => String(value || "")
  .normalize("NFKC")
  .replace(/[’‘]/g, "'")
  .replace(/[‐‑‒–—]/g, "-")
  .toLowerCase()
  .replace(/[^a-z'\-\s]/g, " ")
  .replace(/\s+/g, " ")
  .replace(/^[-'\s]+|[-'\s]+$/g, "")
  .slice(0, 80);

const extractMeaning = (brief) => {
  const lines = decodeHtml(brief).split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const parts = [];
  const meanings = [];
  lines.forEach((line) => {
    const match = line.match(/^((?:adj|adv|art|aux|conj|det|int|n|num|phr|pl|prep|pron|v|vi|vt|abbr|na)\.(?:\s*\/\s*(?:adj|adv|art|aux|conj|det|int|n|num|phr|pl|prep|pron|v|vi|vt|abbr|na)\.)*)\s*(.*)$/i);
    if (!match) {
      if (line !== "无") meanings.push(line);
      return;
    }
    if (parts.indexOf(match[1]) < 0) parts.push(match[1]);
    if (match[2]) meanings.push(match[2]);
  });
  return {
    partOfSpeech: parts.join(" / "),
    meaning: meanings.join("；"),
  };
};

const parseVerifiedBrief = (value) => {
  let text = decodeHtml(value).replace(/^\s*\[[^\]]*\]\s*/, "").trim();
  const posMatch = text.match(
    /^((?:(?:modal\s+v|aux\s+v|adj|adv|art|abbr|conj|det|excl|int|num|phr|pl|prep|pron|vi|vt|v|n)\.(?:\s*&\s*)?)+)\s*(.*)$/i
  );
  if (!posMatch) {
    return { partOfSpeech: "", meaning: text };
  }
  return {
    partOfSpeech: posMatch[1].replace(/\s+/g, ""),
    meaning: posMatch[2].trim(),
  };
};

const extractVerifiedWord = (line) => {
  const chineseIndex = String(line || "").search(/[\u3400-\u9fff]/);
  if (chineseIndex < 0) return "";
  let head = line.slice(0, chineseIndex).trim();
  head = head.replace(/\[[^\]]*\]/g, " ").trim();
  head = head.replace(
    /\s+(?:(?:modal\s+v|aux\s+v|adj|adv|art|abbr|conj|det|excl|int|num|phr|pl|prep|pron|vi|vt|v|n)\.(?:\s*&\s*)?)+\s*$/i,
    ""
  ).trim();
  if (head.indexOf("=") >= 0) head = head.split("=")[0].trim();
  return head;
};

const parseVerifiedLine = (line, word) => {
  const chineseIndex = String(line || "").search(/[\u3400-\u9fff]/);
  if (chineseIndex < 0) return parseVerifiedBrief(line.slice(word.length));
  const meaning = line.slice(chineseIndex).trim();
  const meta = line.slice(word.length, chineseIndex).replace(/\[[^\]]*\]/g, " ").trim();
  const posMatch = meta.match(
    /((?:(?:modal\s+v|modal|aux\s+v|adj|adv|art|abbr|conj|det|excl|int|num|phr|pl|prep|pron|vi|vt|v|n)\.(?:\s*&\s*)?)+)\s*$/i
  );
  return {
    partOfSpeech: posMatch ? posMatch[1].replace(/\s+/g, "") : "",
    meaning,
  };
};

const extractVerifiedLines = (html) => {
  const intro = html.match(/<p class="assets-intro">([\s\S]*?)<\/p>/i);
  if (!intro) return [];
  return decodeHtml(
    intro[1]
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
};

const getVerifiedEntry = (lines, word, startIndex, usedIndexes) => {
  const expected = String(word || "").trim().toLowerCase();
  const normalizedExpected = normalizeKey(expected);
  const matches = (line) => {
    const lower = line.toLowerCase();
    if (lower === expected || lower.startsWith(`${expected} `) || lower.startsWith(`${expected}[`)) return true;
    const normalizedLine = normalizeKey(line);
    return normalizedLine === normalizedExpected || normalizedLine.startsWith(`${normalizedExpected} `);
  };
  let foundIndex = -1;
  for (let index = Math.max(0, startIndex); index < lines.length; index += 1) {
    if (!usedIndexes.has(index) && matches(lines[index])) {
      foundIndex = index;
      break;
    }
  }
  if (foundIndex < 0) {
    for (let index = 0; index < Math.max(0, startIndex); index += 1) {
      if (!usedIndexes.has(index) && matches(lines[index])) {
        foundIndex = index;
        break;
      }
    }
  }
  if (foundIndex < 0) return null;
  usedIndexes.add(foundIndex);
  const line = lines[foundIndex];
  const verifiedWord = extractVerifiedWord(line);
  let remainder = line.slice(word.length).trim();
  if (!remainder || normalizeKey(line.slice(0, word.length)) !== normalizedExpected) {
    const englishPrefix = line.match(/^([A-Za-z][A-Za-z0-9'’.\-\s]*(?=\s*\[))/);
    if (englishPrefix && normalizeKey(englishPrefix[1]) === normalizedExpected) {
      remainder = line.slice(englishPrefix[0].length).trim();
    }
  }
  return {
    index: foundIndex,
    word: verifiedWord,
    parsed: verifiedWord ? parseVerifiedLine(line, verifiedWord) : parseVerifiedBrief(remainder),
  };
};

const primary = JSON.parse(fs.readFileSync(PRIMARY_PATH, "utf8"));
const primaryKeys = new Set((primary.words || []).map((word) => normalizeKey(word.key || word.word)).filter(Boolean));
const levels = [];
const words = [];

BOOKS.forEach((book) => {
  const sourcePath = path.join(SOURCE_DIR, `${book.sourceId}.html`);
  const verifiedSourcePath = path.join(SOURCE_DIR, `${book.verifiedSourceId}.html`);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing source file: ${sourcePath}`);
  }
  if (!fs.existsSync(verifiedSourcePath)) {
    throw new Error(`Missing verified source file: ${verifiedSourcePath}`);
  }
  const html = fs.readFileSync(sourcePath, "utf8");
  const verifiedLines = extractVerifiedLines(fs.readFileSync(verifiedSourcePath, "utf8"));
  const usedVerifiedIndexes = new Set();
  let verifiedCursor = 0;
  const headingMatches = Array.from(html.matchAll(/<h4 class="ci-list-h4">([^<]+)<\/h4>/g));
  const sections = headingMatches
    .map((heading, sourceIndex) => {
      const unitLabel = decodeHtml(heading[1]);
      const unitNumberMatch = unitLabel.match(/(\d+)/);
      return {
        heading,
        unitLabel,
        unitNumber: unitNumberMatch ? Number(unitNumberMatch[1]) : sourceIndex + 1,
        sectionStart: heading.index + heading[0].length,
        sectionEnd: headingMatches[sourceIndex + 1] ? headingMatches[sourceIndex + 1].index : html.length,
      };
    })
    .sort((a, b) => a.unitNumber - b.unitNumber);
  levels.push({
    id: book.id,
    label: book.label,
    order: book.order,
    collectionId: "yilin-junior-old",
    collectionLabel: "译林牛津初中英语",
    edition: "译林版 · 2012课标旧版",
    grade: book.grade,
    semester: book.semester,
    bookTitle: `译林版牛津英语初中英语${book.label}册`,
    isTextbook: true,
    sourceRef: `https://fanyi.kkabc.com/list/${book.sourceId}`,
  });
  sections.forEach((bookSection) => {
    const section = html.slice(bookSection.sectionStart, bookSection.sectionEnd);
    const unitLabel = bookSection.unitLabel;
    const unitId = `${book.id}-u${bookSection.unitNumber}`;
    const rows = Array.from(section.matchAll(
      /<div class="dancibiao-tr"><div class="dancibiao-word"><a[^>]*>([^<]+)<\/a><\/div>[\s\S]*?<div class="dancibiao-brief">([\s\S]*?)<\/div><\/div>/g
    ));
    rows.forEach((row, wordIndex) => {
      const sourceWord = decodeHtml(row[1]);
      const sourceKey = normalizeKey(sourceWord);
      if (!sourceKey) return;
      const fallbackParsed = extractMeaning(row[2]);
      const verifiedEntry = getVerifiedEntry(verifiedLines, sourceWord, verifiedCursor, usedVerifiedIndexes);
      if (verifiedEntry) verifiedCursor = verifiedEntry.index + 1;
      const verifiedWordKey = verifiedEntry ? normalizeKey(verifiedEntry.word) : "";
      const canUseVerifiedWord = verifiedWordKey === sourceKey
        || (
          verifiedWordKey.startsWith(`${sourceKey} `)
          && verifiedWordKey.slice(sourceKey.length + 1).split(" ").every((token) => token.length > 1)
        );
      const word = canUseVerifiedWord ? verifiedEntry.word : sourceWord;
      const key = normalizeKey(word);
      if (!key) return;
      const verifiedParsed = verifiedEntry ? verifiedEntry.parsed : null;
      const verifiedOverride = VERIFIED_OVERRIDES[`${book.id}:${key}`];
      const parsed = verifiedOverride || (verifiedParsed && verifiedParsed.meaning
        ? {
            meaning: verifiedParsed.meaning,
            partOfSpeech: verifiedParsed.partOfSpeech
              || (canUseVerifiedWord && verifiedWordKey !== sourceKey ? "phr." : fallbackParsed.partOfSpeech)
              || (key.indexOf(" ") >= 0 ? "phr." : "待确认"),
          }
        : {
            meaning: fallbackParsed.meaning,
            partOfSpeech: fallbackParsed.partOfSpeech || (key.indexOf(" ") >= 0 ? "phr." : "待确认"),
          });
      words.push({
        key,
        word,
        meaning: parsed.meaning,
        partOfSpeech: parsed.partOfSpeech,
        levelId: book.id,
        unitId,
        unitLabel,
        order: bookSection.unitNumber * 1000 + wordIndex + 1,
        isBasic: primaryKeys.has(key),
        sourceRef: verifiedOverride || (verifiedParsed && verifiedParsed.meaning)
          ? `https://zy.21cnjy.com/${book.verifiedSourceId}`
          : `https://fanyi.kkabc.com/list/${book.sourceId}`,
      });
    });
  });
});

const output = {
  schemaVersion: 2,
  collection: {
    id: "yilin-junior-old",
    label: "译林牛津初中英语",
    edition: "译林版 · 2012课标旧版",
    notice: "与任轩楠现有错题所用教材词汇一致；新版教材应另建词库，不与本词库混用。",
  },
  levels,
  words,
};

fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Generated ${levels.length} books and ${words.length} word entries at ${OUTPUT_PATH}`);
