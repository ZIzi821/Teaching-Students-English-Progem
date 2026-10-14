const fs = require("fs");
const path = require("path");
const vocabulary = require("../cloudfunctions/quickstartFunctions/vocabulary");
const {
  EXPECTED_UNIT_COUNTS,
  METADATA_OVERRIDES,
  SOURCE_REF,
  UNIT_TITLES,
  WORDS_BY_UNIT,
} = require("./yilin-2024-7a-photo-wordlist");

const OUTPUT_PATH = path.join(
  __dirname,
  "..",
  "cloudfunctions",
  "quickstartFunctions",
  "data",
  "yilin-junior-2024-7a-words.json"
);
const LEVEL_ID = "yilin-2024-7A";

const clone = (value) => JSON.parse(JSON.stringify(value));

const addToPool = (pool, key, item) => {
  if (!pool.has(key)) pool.set(key, []);
  pool.get(key).push(item);
};

const main = () => {
  const previous = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8"));
  const unitPools = new Map();
  const globalPools = new Map();
  (previous.words || []).forEach((word) => {
    const key = vocabulary.normalizeWordKey(word.key || word.word);
    if (!key) return;
    addToPool(unitPools, `${word.unitId}:${key}`, clone(word));
    addToPool(globalPools, key, clone(word));
  });

  const words = [];
  WORDS_BY_UNIT.forEach((unitWords, unitIndex) => {
    const unitNo = unitIndex + 1;
    const unitId = `${LEVEL_ID}-u${unitNo}`;
    const unitLabel = `Unit ${unitNo} · ${UNIT_TITLES[unitIndex]}`;
    unitWords.forEach((word, wordIndex) => {
      const key = vocabulary.normalizeWordKey(word);
      const unitPool = unitPools.get(`${unitId}:${key}`) || [];
      const globalPool = globalPools.get(key) || [];
      const previousWord = unitPool.shift() || globalPool[0] || {};
      const override = METADATA_OVERRIDES[key] || {};
      const meaning = String(override.meaning || previousWord.meaning || "").trim();
      const partOfSpeech = Object.prototype.hasOwnProperty.call(override, "partOfSpeech")
        ? String(override.partOfSpeech || "").trim()
        : String(previousWord.partOfSpeech || "").trim();
      if (!key || !meaning) {
        throw new Error(`Missing photographed word metadata: Unit ${unitNo} ${word}`);
      }
      words.push({
        key,
        word,
        meaning,
        partOfSpeech,
        levelId: LEVEL_ID,
        unitId,
        unitLabel,
        order: unitNo * 1000 + wordIndex + 1,
        sourceRef: SOURCE_REF,
      });
    });
  });

  const unitCounts = WORDS_BY_UNIT.map((items) => items.length);
  if (JSON.stringify(unitCounts) !== JSON.stringify(EXPECTED_UNIT_COUNTS)) {
    throw new Error(`Unexpected photographed unit counts: ${unitCounts.join(", ")}`);
  }

  const output = {
    schemaVersion: 3,
    collection: {
      id: "yilin-junior-2024",
      label: "译林初中英语",
      edition: "译林版 · 2024新教材（2022课标）",
      notice: "已按家长提供的七年级上册书后 Wordlist 实拍逐项核对；仅收录印刷词条，不收录手写批注。",
      isbn: "978-7-5753-0036-0",
      sourceRef: SOURCE_REF,
    },
    levels: [{
      id: LEVEL_ID,
      label: "七年级上",
      order: 100,
      collectionId: "yilin-junior-2024",
      collectionLabel: "译林初中英语",
      edition: "译林版 · 2024新教材（2022课标）",
      grade: 7,
      semester: "A",
      bookTitle: "义务教育教科书·英语 七年级上册",
      isTextbook: true,
      isbn: "978-7-5753-0036-0",
      sourceRef: SOURCE_REF,
    }],
    words,
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    output: OUTPUT_PATH,
    sourceRef: SOURCE_REF,
    totalWords: words.length,
    uniqueWords: new Set(words.map((item) => item.key)).size,
    unitCounts,
  }, null, 2));
};

main();
