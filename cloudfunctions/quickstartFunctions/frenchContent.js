const LEVELS = ["A1", "A2", "B1", "B2"];
const CONTENT_TYPES = ["word", "grammar", "expression", "sentence", "reading", "writing"];

const TOPIC_LABELS = {
  greetings: "问候与礼貌",
  identity: "个人信息",
  numbers: "数字",
  time: "日期与时间",
  family: "家人与人物",
  people: "人物描述",
  home: "住房与家居",
  food: "饮食与餐馆",
  shopping: "购物与服务",
  school: "学校",
  study: "学习与交流",
  "work-study": "工作与学习",
  work: "工作",
  "daily-life": "日常生活",
  routine: "日常作息",
  weather: "天气",
  transport: "交通",
  travel: "旅行与住宿",
  accommodation: "住宿",
  places: "地点与方向",
  directions: "问路与方向",
  needs: "状态与需求",
  likes: "喜好与活动",
  hobbies: "兴趣爱好",
  sports: "运动",
  health: "健康与身体",
  body: "身体",
  services: "公共服务",
  technology: "基础科技",
  problems: "日常问题",
  emotions: "情绪",
  opinions: "观点与看法",
  plans: "计划与安排",
  relationships: "社交与关系",
  environment: "环境基础",
  communication: "沟通表达",
  description: "描述",
  actions: "常用动作",
  grammar: "语法基础",
};

const DATASETS = [
  { path: "./data/french-a1-words.json", type: "word", defaultLevel: "A1" },
  { path: "./data/french-a2-words.json", type: "word", defaultLevel: "A2" },
  { path: "./data/french-a1-a2-grammar.json", type: "grammar" },
  { path: "./data/french-a1-a2-expressions.json", type: "expression" },
  { path: "./data/french-a1-sentences.json", type: "sentence", defaultLevel: "A1", legacy: true },
  { path: "./data/french-a1-a2-shadowing.json", type: "sentence" },
  { path: "./data/french-a1-a2-readings.json", type: "reading" },
  { path: "./data/french-a1-a2-sentence-builders.json", type: "writing" },
];

const asString = (value) => String(value === undefined || value === null ? "" : value).trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

const normalizeFrenchCanonical = (value) => asString(value).normalize("NFC").toLocaleLowerCase("fr-FR");
const normalizeFrenchSearch = (value) => normalizeFrenchCanonical(value)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/œ/g, "oe")
  .replace(/æ/g, "ae")
  .replace(/[’']/g, " ")
  .replace(/[^a-z0-9\s-]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const extractItems = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  return asArray(payload.items || payload.words || payload.sentences || payload.data || payload.files);
};

const loadDataset = (definition, errorFactory) => {
  try {
    return require(definition.path);
  } catch (err) {
    throw errorFactory("FRENCH_CONTENT_UNAVAILABLE", `法语学习内容缺失：${definition.path}`);
  }
};

const normalizeLevel = (value, fallback) => {
  const level = asString(value || fallback).toUpperCase();
  return LEVELS.includes(level) ? level : "";
};

const normalizeItem = (source, definition, sequence) => {
  const item = source && typeof source === "object" ? source : {};
  const id = asString(item.id);
  const cefrLevel = normalizeLevel(item.cefrLevel || item.level, definition.defaultLevel);
  const topic = asString(item.topic || item.topicId);
  const normalized = Object.assign({}, item, {
    id,
    cefrLevel,
    topic,
    contentType: definition.type,
    _sequence: sequence,
  });

  if (definition.type === "word") {
    const lemma = asString(item.lemma || item.key || item.text || item.displayForm || item.display).normalize("NFC");
    const displayForm = asString(item.displayForm || item.display || item.text || lemma).normalize("NFC");
    normalized.lemma = lemma;
    normalized.displayForm = displayForm;
    normalized.canonicalKey = normalizeFrenchCanonical(lemma);
    normalized.searchIndex = normalizeFrenchSearch([
      lemma,
      displayForm,
      item.meaningCN,
      item.meaningEN,
      item.meaning,
      topic,
    ].filter(Boolean).join(" "));
  }

  if (definition.type === "sentence" && definition.legacy) {
    normalized.meaningCN = asString(item.meaningCN || item.translation || item.meaning);
    normalized.meaningEN = asString(item.meaningEN);
    normalized.cueCN = asString(item.cueCN || item.note);
  }
  return normalized;
};

let cachedContent = null;

const buildFrenchContent = (errorFactory, { forceReload = false } = {}) => {
  if (cachedContent && !forceReload) return cachedContent;
  const byType = new Map(CONTENT_TYPES.map((type) => [type, []]));
  const mapsByType = new Map(CONTENT_TYPES.map((type) => [type, new Map()]));
  const topicStats = new Map();
  let sequence = 0;

  DATASETS.forEach((definition) => {
    const payload = loadDataset(definition, errorFactory);
    extractItems(payload).forEach((source) => {
      const item = normalizeItem(source, definition, sequence++);
      if (!item.id || !item.cefrLevel || !item.topic) {
        throw errorFactory("FRENCH_CONTENT_INVALID", `${definition.type} 内容缺少 id、cefrLevel 或 topic`);
      }
      const itemMap = mapsByType.get(definition.type);
      if (itemMap.has(item.id)) {
        throw errorFactory("FRENCH_CONTENT_INVALID", `${definition.type} 内容编号重复：${item.id}`);
      }
      itemMap.set(item.id, item);
      byType.get(definition.type).push(item);
      const topicKey = `${item.cefrLevel}:${item.topic}`;
      const current = topicStats.get(topicKey) || {
        id: item.topic,
        label: TOPIC_LABELS[item.topic] || item.topic,
        cefrLevel: item.cefrLevel,
        count: 0,
      };
      current.count += 1;
      topicStats.set(topicKey, current);
    });
  });

  const audioPayload = loadDataset({ path: "./data/french-audio-manifest.json" }, errorFactory);
  const audioByKey = new Map();
  extractItems(audioPayload).forEach((audio) => {
    const audioKey = asString(audio && (audio.audioKey || audio.key || audio.id));
    if (!audioKey || audioByKey.has(audioKey)) {
      throw errorFactory("FRENCH_CONTENT_INVALID", `音频编号缺失或重复：${audioKey || "(empty)"}`);
    }
    audioByKey.set(audioKey, Object.assign({}, audio, { audioKey }));
  });

  const referencedAudioKeys = new Set();
  CONTENT_TYPES.forEach((type) => {
    byType.get(type).forEach((item) => {
      const audioKey = asString(item.audioKey);
      if (audioKey) referencedAudioKeys.add(audioKey);
    });
  });
  const missingAudioKeys = Array.from(referencedAudioKeys).filter((key) => !audioByKey.has(key));
  if (missingAudioKeys.length) {
    throw errorFactory(
      "FRENCH_CONTENT_INVALID",
      `法语音频清单缺少 ${missingAudioKeys.length} 条映射：${missingAudioKeys.slice(0, 3).join(", ")}`
    );
  }

  cachedContent = {
    levels: LEVELS.slice(),
    byType,
    mapsByType,
    words: byType.get("word"),
    sentences: byType.get("sentence"),
    grammar: byType.get("grammar"),
    expressions: byType.get("expression"),
    readings: byType.get("reading"),
    writing: byType.get("writing"),
    wordById: mapsByType.get("word"),
    sentenceById: mapsByType.get("sentence"),
    audioByKey,
    referencedAudioKeys,
    topics: Array.from(topicStats.values()).sort((left, right) => (
      LEVELS.indexOf(left.cefrLevel) - LEVELS.indexOf(right.cefrLevel)
      || left.label.localeCompare(right.label, "zh-CN")
    )),
  };
  return cachedContent;
};

const filterByLevel = (items, level) => {
  const normalizedLevel = normalizeLevel(level);
  if (!normalizedLevel) return asArray(items).slice();
  return asArray(items).filter((item) => item.cefrLevel === normalizedLevel);
};

module.exports = {
  CONTENT_TYPES,
  DATASETS,
  LEVELS,
  TOPIC_LABELS,
  buildFrenchContent,
  filterByLevel,
  normalizeFrenchCanonical,
  normalizeFrenchSearch,
};
