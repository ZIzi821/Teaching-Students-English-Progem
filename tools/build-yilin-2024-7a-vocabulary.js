const fs = require("fs");
const https = require("https");
const path = require("path");

const SOURCE_URL = "https://yyld.51jiaoxi.com/qishang/njylb_danyuan012.html";
const OUTPUT_PATH = path.resolve(
  __dirname,
  "..",
  "cloudfunctions",
  "quickstartFunctions",
  "data",
  "yilin-junior-2024-7a-words.json"
);
const EXPECTED_UNIT_COUNTS = Object.freeze([40, 47, 47, 54, 55, 56, 64, 58]);
const UNIT_TITLES = Object.freeze([
  "This is me!",
  "Hobbies",
  "Welcome to our school!",
  "School days",
  "A healthy lifestyle",
  "My clothes, my style",
  "Be wise with money",
  "Let's celebrate!",
]);

const fetchText = (url) => new Promise((resolve, reject) => {
  https.get(url, { headers: { "User-Agent": "Mozilla/5.0 vocabulary-source-check" } }, (response) => {
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      response.resume();
      fetchText(new URL(response.headers.location, url).toString()).then(resolve, reject);
      return;
    }
    if (response.statusCode !== 200) {
      response.resume();
      reject(new Error(`Vocabulary source returned HTTP ${response.statusCode}`));
      return;
    }
    response.setEncoding("utf8");
    let body = "";
    response.on("data", (chunk) => { body += chunk; });
    response.on("end", () => resolve(body));
  }).on("error", reject);
});

const decodeHtml = (value) => String(value || "")
  .replace(/<[^>]+>/g, "")
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/\s+/g, " ")
  .trim();

const normalizeWordKey = (value) => String(value || "")
  .normalize("NFKC")
  .replace(/[’‘]/g, "'")
  .replace(/[‐‑‒–—]/g, "-")
  .toLowerCase()
  .replace(/[^a-z'\-\s]/g, " ")
  .replace(/\s+/g, " ")
  .replace(/^[-'\s]+|[-'\s]+$/g, "")
  .slice(0, 80);

const splitDefinition = (definition) => {
  const text = String(definition || "").trim();
  const matched = text.match(/^([^\u3400-\u9fff（]+?)\s*(?=[\u3400-\u9fff（])(.+)$/u);
  if (!matched || !/[a-z]+\./i.test(matched[1])) {
    return { partOfSpeech: "", meaning: text };
  }
  return {
    partOfSpeech: matched[1].trim().slice(0, 50),
    meaning: matched[2].trim(),
  };
};

const parseWordlist = (html) => {
  const start = html.indexOf("Wordlist (by unit)");
  const end = html.indexOf("Wordlist (in alphabetical order)", start + 1);
  if (start < 0 || end <= start) throw new Error("Could not locate the by-unit wordlist section");
  const section = html.slice(start, end);
  const itemPattern = /<li class="s-item"[^>]*>.*?<p class="en"[^>]*>(.*?)<\/p>\s*<p class="cn"[^>]*>(.*?)<\/p>.*?<\/li>/gs;
  const words = [];
  const unitCounts = Array(8).fill(0);
  let currentUnit = 0;
  let match;
  while ((match = itemPattern.exec(section))) {
    const word = decodeHtml(match[1]);
    const definition = decodeHtml(match[2]);
    const unitMatch = word.match(/^Unit ([1-8])$/);
    if (unitMatch) {
      currentUnit = Number(unitMatch[1]);
      continue;
    }
    if (!currentUnit || !word || word === "Wordlist") continue;
    const parsedDefinition = splitDefinition(definition);
    unitCounts[currentUnit - 1] += 1;
    const unitOrder = unitCounts[currentUnit - 1];
    words.push({
      key: normalizeWordKey(word),
      word,
      meaning: parsedDefinition.meaning,
      partOfSpeech: parsedDefinition.partOfSpeech,
      levelId: "yilin-2024-7A",
      unitId: `yilin-2024-7A-u${currentUnit}`,
      unitLabel: `Unit ${currentUnit} · ${UNIT_TITLES[currentUnit - 1]}`,
      order: currentUnit * 1000 + unitOrder,
      sourceRef: SOURCE_URL,
    });
  }
  if (!words.every((item) => item.key && item.meaning)) {
    throw new Error("Parsed wordlist contains an empty key or meaning");
  }
  if (JSON.stringify(unitCounts) !== JSON.stringify(EXPECTED_UNIT_COUNTS)) {
    throw new Error(`Unexpected unit counts: ${unitCounts.join(", ")}`);
  }
  const unit3 = words.filter((item) => item.unitId.endsWith("-u3"));
  const unit4 = words.filter((item) => item.unitId.endsWith("-u4"));
  const unit3Tail = unit3.slice(-4).map((item) => item.word).join("|");
  const unit4Head = unit4.slice(0, 4).map((item) => item.word).join("|");
  if (unit3Tail !== "together|quite|large|special" || unit4Head !== "a.m.|get up|activity|housework") {
    throw new Error("Unit 3/4 boundary no longer matches the photographed textbook wordlist");
  }
  return { words, unitCounts };
};

const main = async () => {
  const html = await fetchText(SOURCE_URL);
  const { words, unitCounts } = parseWordlist(html);
  const output = {
    schemaVersion: 2,
    collection: {
      id: "yilin-junior-2024",
      label: "译林初中英语",
      edition: "译林版 · 2024新教材（2022课标）",
      notice: "家长提供的七年级上册实拍已核对；按2024年新教材的八个单元维护。",
      isbn: "978-7-5753-0036-0",
    },
    levels: [{
      id: "yilin-2024-7A",
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
      sourceRef: SOURCE_URL,
    }],
    words,
  };
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    output: OUTPUT_PATH,
    totalWords: words.length,
    uniqueWords: new Set(words.map((item) => item.key)).size,
    unitCounts,
  }, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
